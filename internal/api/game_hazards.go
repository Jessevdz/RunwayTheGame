package api

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v4"

	"github.com/Jessevdz/RunwayTheGame/internal/blobstore"
	"github.com/Jessevdz/RunwayTheGame/internal/commands"
	"github.com/Jessevdz/RunwayTheGame/internal/eventstore"
	"github.com/Jessevdz/RunwayTheGame/internal/geo"
	"github.com/Jessevdz/RunwayTheGame/internal/logger"
	"github.com/Jessevdz/RunwayTheGame/internal/projections"
	"github.com/Jessevdz/RunwayTheGame/internal/rules"
)

// RoadblockClearRequest payload for clearing a roadblock card with evidence.
type RoadblockClearRequest struct {
	RoadID  string `json:"road_id"`
	BlobRef string `json:"blob_ref"`
	// Optional location coordinates captured with the photo.
	Lat              *float64  `json:"lat"`
	Lon              *float64  `json:"lon"`
	AccuracyM        float64   `json:"accuracy_m"`
	IdempotencyKey   string    `json:"idempotency_key"`
	ClientCapturedAt time.Time `json:"client_captured_at"`
}

// CurseResolveRequest payload for resolving an active curse.
type CurseResolveRequest struct {
	CardID         string `json:"card_id"`
	IdempotencyKey string `json:"idempotency_key"`
}

// roadblockClearResponse acknowledges evidence filed against a roadblock. Status
// reads the same as a challenge submission's.
type roadblockClearResponse struct {
	SubmissionID string `json:"submission_id"`
	RoadID       string `json:"road_id"`
	Status       string `json:"status"`
}

// curseResolvedResponse names the curse card a team has worked off.
type curseResolvedResponse struct {
	Status string `json:"status"`
	CardID string `json:"card_id"`
}

// handleRoadblockClear submits photo evidence to remove a roadblock card on a road.
func (s *Server) handleRoadblockClear(w http.ResponseWriter, r *http.Request) {
	gameID := chi.URLParam(r, "game_id")

	var req RoadblockClearRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(r.Context(), w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.RoadID == "" || req.BlobRef == "" || req.IdempotencyKey == "" {
		writeError(r.Context(), w, http.StatusBadRequest, "road_id, blob_ref, and idempotency_key are required")
		return
	}
	if req.Lat == nil || req.Lon == nil {
		writeError(r.Context(), w, http.StatusBadRequest, "lat and lon are required: evidence is graded against where it was taken")
		return
	}
	if err := blobstore.ValidateKey(req.BlobRef); err != nil {
		writeError(r.Context(), w, http.StatusBadRequest, "invalid blob_ref: "+err.Error())
		return
	}

	game, team, ok := s.requireTeam(w, r, gameID)
	if !ok {
		return
	}
	if game.Status != "live" {
		writeError(r.Context(), w, http.StatusForbidden, "game is not live")
		return
	}
	if !requireNotPurging(r.Context(), w, game) {
		return
	}
	if !requireOwnedBlobRef(r.Context(), w, req.BlobRef, gameID, team.ID) {
		return
	}

	proj, err := projections.RebuildProjection(r.Context(), s.DB.Pool, gameID, 0)
	if err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to load game state")
		return
	}

	roadblock, exists := proj.Roadblocks[req.RoadID]
	if !exists {
		writeError(r.Context(), w, http.StatusNotFound, "no roadblock on that road")
		return
	}
	if !roadblock.BlocksTeam(team.ID) {
		// Placer or already-cleared: there is nothing to work off, and letting
		// the call through would queue an LLM job for no reason.
		writeError(r.Context(), w, http.StatusConflict, "this roadblock does not block your team")
		return
	}

	// The card is a physical challenge at the blocked stretch of road, so the team has
	// to actually be at one end of it.
	var connects bool
	err = s.DB.Pool.QueryRow(r.Context(), `
		SELECT EXISTS(
			SELECT 1 FROM board_roads
			WHERE board_id = $1 AND board_version = $2 AND id = $3
			  AND (waypoint_id_a = $4 OR waypoint_id_b = $4)
		)
	`, game.BoardID, game.BoardVersion, req.RoadID, proj.Progress[team.ID].CurrentWaypointID).Scan(&connects)
	if err != nil || !connects {
		writeError(r.Context(), w, http.StatusForbidden, "you must be at one end of the blocked road to clear it")
		return
	}

	// Verify that the reported position matches the waypoint where the team is located.
	var wpLat, wpLon, arrivalRadiusM float64
	if qErr := s.DB.Pool.QueryRow(r.Context(), `
		SELECT ST_Y(location::geometry), ST_X(location::geometry), arrival_radius_m
		FROM board_waypoints
		WHERE board_id = $1 AND board_version = $2 AND id = $3
	`, game.BoardID, game.BoardVersion, proj.Progress[team.ID].CurrentWaypointID).Scan(&wpLat, &wpLon, &arrivalRadiusM); qErr != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to query waypoint coordinates")
		return
	}
	dist := geo.DistanceM(*req.Lat, *req.Lon, wpLat, wpLon)
	if check := rules.CheckArrival(dist, arrivalRadiusM, req.AccuracyM); !check.Allowed {
		logger.Warn(r.Context(), "roadblock clear rejected by GPS gate", map[string]interface{}{
			"game_id": gameID, "team_id": team.ID, "road_id": req.RoadID,
			"distance_m": dist, "accuracy_m": req.AccuracyM, "reason": check.Reason,
		})
		writeError(r.Context(), w, http.StatusUnprocessableEntity, "GPS verification failed: "+check.Message)
		return
	}

	submissionID := uuid.New().String()
	serverReceivedAt := time.Now().UTC()
	clientCapturedAt := sanitizeClientCapturedAt(req.ClientCapturedAt, serverReceivedAt)

	// The roadblock card stands in for a challenge definition: its text is the
	// prompt, and the rubric asks only that the photo show the card being done.
	rubric := map[string]interface{}{
		"must_show":            []string{roadblock.ChallengeText},
		"fails_if":             []string{"the photo does not show the described challenge being performed"},
		"acceptable_ambiguity": "accept any good-faith attempt that plainly shows the challenge",
	}
	rubricBytes, _ := json.Marshal(rubric)

	// challenge_id is NOT NULL, and the roadblock's card id is the closest thing
	// to a challenge definition this submission has.
	challengeID := roadblock.CardID
	if challengeID == "" {
		challengeID = uuid.New().String()
	}

	verifyPayload := map[string]interface{}{
		"submission_id": submissionID,
		"game_id":       gameID,
		"team_id":       team.ID,
		"road_id":       req.RoadID,
		"challenge_id":  challengeID,
		"blob_ref":      req.BlobRef,
		"prompt":        roadblock.ChallengeText,
		"rubric":        json.RawMessage(rubricBytes),
		"gps": map[string]interface{}{
			"lat":        *req.Lat,
			"lon":        *req.Lon,
			"accuracy_m": req.AccuracyM,
			"timestamp":  serverReceivedAt,
		},
		"exif": map[string]interface{}{
			"timestamp": clientCapturedAt,
		},
	}
	if prev := s.lastKnownFix(r.Context(), gameID, team.ID); prev != nil {
		verifyPayload["previous_gps"] = prev
	}

	payloadBytes, _ := json.Marshal(eventstore.SubmissionCreatedPayload{
		SubmissionID:   submissionID,
		TeamID:         team.ID,
		RoadID:         req.RoadID,
		ChallengeID:    challengeID,
		BlobRef:        req.BlobRef,
		IdempotencyKey: req.IdempotencyKey,
	})

	expectedSeq, err := s.nextSequence(r.Context(), gameID)
	if err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to resolve sequence: "+err.Error())
		return
	}
	cmdReq := commands.CommandRequest{
		GameID:         gameID,
		CommandType:    "SubmissionCreated",
		ExpectedSeq:    expectedSeq,
		IdempotencyKey: req.IdempotencyKey,
		Payload:        payloadBytes,
	}
	// Evaluate roadblock clearance evidence according to the configured verification mode.
	grading := game.Ruleset.Verification
	submissionStatus := "pending"

	_, err = s.CmdProcessor.Process(r.Context(), cmdReq, func(ctx context.Context, tx pgx.Tx, cr commands.CommandRequest) (*commands.CommandResult, error) {
		_, dbErr := tx.Exec(ctx, `
			INSERT INTO challenge_submissions
			  (id, game_id, team_id, road_id, challenge_id, blob_ref, idempotency_key, kind, client_captured_at, server_received_at, lat, lon, accuracy_m)
			VALUES ($1, $2, $3, $4, $5, $6, $7, 'roadblock', $8, $9, $10, $11, $12)
		`, submissionID, gameID, team.ID, req.RoadID, challengeID, req.BlobRef, req.IdempotencyKey, clientCapturedAt, serverReceivedAt,
			*req.Lat, *req.Lon, req.AccuracyM)
		if dbErr != nil {
			return nil, dbErr
		}

		result := &commands.CommandResult{
			ResponseCode: http.StatusCreated,
			Events: []eventstore.Event{
				{Type: "SubmissionCreated", Payload: string(cr.Payload)},
			},
		}

		switch grading {
		case rules.VerificationTrust:
			events, _, applyErr := s.applyVerdict(ctx, tx, game,
				gradedSubmission{
					ID:               submissionID,
					TeamID:           team.ID,
					RoadID:           req.RoadID,
					ChallengeID:      challengeID,
					Kind:             "roadblock",
					ServerReceivedAt: &serverReceivedAt,
				},
				"pass", 1.0, trustRationale, rules.VerificationTrust)
			if applyErr != nil {
				return nil, applyErr
			}
			result.Events = append(result.Events, events...)
			submissionStatus = "pass"

		case rules.VerificationHost:
			submissionStatus = "pending_review"

		default:
			result.Jobs = []commands.JobOutboxEntry{
				{Type: "verification", Payload: verifyPayload},
			}
		}

		result.ResponseBody = submissionResponse{SubmissionID: submissionID, Status: submissionStatus}
		return result, nil
	})
	if err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to record roadblock clearance attempt: "+err.Error())
		return
	}

	writeJSON(r.Context(), w, http.StatusCreated, roadblockClearResponse{
		SubmissionID: submissionID,
		RoadID:       req.RoadID,
		Status:       submissionStatus,
	})
}

// handleCurseResolve clears an active curse card effect satisfied by the team.
func (s *Server) handleCurseResolve(w http.ResponseWriter, r *http.Request) {
	gameID := chi.URLParam(r, "game_id")

	var req CurseResolveRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(r.Context(), w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.CardID == "" {
		writeError(r.Context(), w, http.StatusBadRequest, "card_id is required")
		return
	}

	game, team, ok := s.requireTeam(w, r, gameID)
	if !ok {
		return
	}
	if game.Status != "live" {
		writeError(r.Context(), w, http.StatusForbidden, "game is not live")
		return
	}

	proj, err := projections.RebuildProjection(r.Context(), s.DB.Pool, gameID, 0)
	if err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to load game state")
		return
	}

	now := time.Now().UTC()
	active := false
	for _, eff := range proj.Effects[team.ID] {
		if eff.Kind == "curse" && eff.Meta == req.CardID && now.Before(eff.Until) {
			active = true
			break
		}
	}
	if !active {
		writeError(r.Context(), w, http.StatusNotFound, "no active curse with that card id on your team")
		return
	}

	payloadBytes, _ := json.Marshal(eventstore.CurseClearedPayload{
		TargetTeamID: team.ID,
		CardID:       req.CardID,
		Reason:       "resolved",
	})

	expectedSeq, err := s.nextSequence(r.Context(), gameID)
	if err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to resolve sequence")
		return
	}
	cmdReq := commands.CommandRequest{
		GameID:         gameID,
		CommandType:    "CurseCleared",
		ExpectedSeq:    expectedSeq,
		IdempotencyKey: req.IdempotencyKey,
		Payload:        payloadBytes,
	}
	_, err = s.CmdProcessor.Process(r.Context(), cmdReq, func(ctx context.Context, tx pgx.Tx, cr commands.CommandRequest) (*commands.CommandResult, error) {
		// team_effects is the runtime mirror of the projection; leaving the row
		// behind would resurrect the curse for anything that reads the table.
		_, dbErr := tx.Exec(ctx, `
			DELETE FROM team_effects
			WHERE game_id = $1 AND team_id = $2 AND kind = 'curse' AND meta = to_jsonb($3::text)
		`, gameID, team.ID, req.CardID)
		if dbErr != nil {
			return nil, dbErr
		}
		return &commands.CommandResult{
			ResponseCode: http.StatusOK,
			ResponseBody: curseResolvedResponse{Status: "resolved", CardID: req.CardID},
			Events: []eventstore.Event{
				{Type: "CurseCleared", Payload: string(cr.Payload)},
			},
		}, nil
	})
	if err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to resolve curse: "+err.Error())
		return
	}

	writeJSON(r.Context(), w, http.StatusOK, curseResolvedResponse{Status: "resolved", CardID: req.CardID})
}
