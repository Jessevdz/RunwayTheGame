package api

import (
	"context"
	"encoding/json"
	"fmt"
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

type ChallengeStartRequest struct {
	WaypointID     string  `json:"waypoint_id"`
	RoadID         string  `json:"road_id,omitempty"`
	Lat            float64 `json:"lat"`
	Lon            float64 `json:"lon"`
	AccuracyM      float64 `json:"accuracy_m"`
	IdempotencyKey string  `json:"idempotency_key"`
}

// PresignRequest payload for requesting an upload URL.
type PresignRequest struct {
	ContentType string `json:"content_type"`
}

type SubmissionRequest struct {
	WaypointID  string `json:"waypoint_id"`
	RoadID      string `json:"road_id,omitempty"`
	ChallengeID string `json:"challenge_id"`
	BlobRef     string `json:"blob_ref"`
	// Lat, Lon, and AccuracyM represent the GPS location recorded during photo capture.
	Lat              *float64  `json:"lat"`
	Lon              *float64  `json:"lon"`
	AccuracyM        float64   `json:"accuracy_m"`
	IdempotencyKey   string    `json:"idempotency_key"`
	ClientCapturedAt time.Time `json:"client_captured_at"`
}

type VetoRequest struct {
	WaypointID     string `json:"waypoint_id"`
	RoadID         string `json:"road_id,omitempty"`
	IdempotencyKey string `json:"idempotency_key"`
}

// challengeStartResponse acknowledges a challenge start request with prompt details.
type challengeStartResponse struct {
	ChallengeID string `json:"challenge_id"`
	Prompt      string `json:"prompt"`
}

// presignResponse contains a presigned upload URL and blob reference.
type presignResponse struct {
	UploadURL string `json:"upload_url"`
	BlobRef   string `json:"blob_ref"`
}

// submissionResponse acknowledges evidence submission and reports the resulting status.
type submissionResponse struct {
	SubmissionID string `json:"submission_id"`
	Status       string `json:"status"`
}

// vetoResponseBody reports the cost of walking away from a challenge.
type vetoResponseBody struct {
	Status             string `json:"status"`
	PenaltyUntil       string `json:"penalty_until"`
	CooldownSeconds    int    `json:"cooldown_seconds"`
	TimePenaltySeconds int    `json:"time_penalty_seconds"`
}

func (s *Server) handleChallengeStart(w http.ResponseWriter, r *http.Request) {
	gameID := chi.URLParam(r, "game_id")

	var req ChallengeStartRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(r.Context(), w, http.StatusBadRequest, "invalid request body")
		return
	}
	waypointID := req.WaypointID
	if waypointID == "" {
		waypointID = req.RoadID
	}
	if waypointID == "" {
		writeError(r.Context(), w, http.StatusBadRequest, "waypoint_id is required")
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

	prog := proj.Progress[team.ID]
	if reason, locked := coinRushLocksOut(game.Mode, prog); locked {
		writeError(r.Context(), w, http.StatusForbidden, reason)
		return
	}
	if prog.CurrentWaypointID != waypointID {
		writeError(r.Context(), w, http.StatusForbidden, "you must be at the waypoint to attempt its challenge")
		return
	}

	// Verify GPS range
	var wpLat, wpLon, arrivalRadiusM float64
	var wpIsFinish bool
	err = s.DB.Pool.QueryRow(r.Context(), `
		SELECT ST_Y(location::geometry), ST_X(location::geometry), arrival_radius_m, is_finish
		FROM board_waypoints
		WHERE board_id = $1 AND board_version = $2 AND id = $3
	`, game.BoardID, game.BoardVersion, waypointID).Scan(&wpLat, &wpLon, &arrivalRadiusM, &wpIsFinish)
	if err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to query waypoint coordinates")
		return
	}

	// Finish line waypoints carry no challenges.
	if wpIsFinish {
		writeError(r.Context(), w, http.StatusBadRequest, "the finish line carries no challenge: arriving here is the objective")
		return
	}

	dist := geo.DistanceM(req.Lat, req.Lon, wpLat, wpLon)
	if check := rules.CheckArrival(dist, arrivalRadiusM, req.AccuracyM); !check.Allowed {
		writeError(r.Context(), w, http.StatusUnprocessableEntity, "GPS verification failed: "+check.Message)
		return
	}

	// Load challenge definition
	var challengeID, prompt string
	err = s.DB.Pool.QueryRow(r.Context(), `
		SELECT id::text, prompt
		FROM challenges
		WHERE board_id = $1 AND board_version = $2 AND waypoint_id = $3
	`, game.BoardID, game.BoardVersion, waypointID).Scan(&challengeID, &prompt)
	if err != nil {
		// Fallback query for backwards compatibility
		err = s.DB.Pool.QueryRow(r.Context(), `
			SELECT c.id::text, c.prompt
			FROM challenges c
			JOIN board_roads s ON s.challenge_id = c.id
			WHERE s.board_id = $1 AND s.board_version = $2 AND s.id = $3
		`, game.BoardID, game.BoardVersion, waypointID).Scan(&challengeID, &prompt)
		if err != nil {
			writeError(r.Context(), w, http.StatusNotFound, "challenge definition not found")
			return
		}
	}

	// Check freeze/veto penalties
	now := time.Now().UTC()
	effects := proj.Effects[team.ID]
	if rules.IsFrozen(effects, now) {
		writeError(r.Context(), w, http.StatusForbidden, "team is frozen")
		return
	}
	// Verify team is not under an active veto cooldown.
	if rules.IsVetoLocked(effects, now) {
		writeError(r.Context(), w, http.StatusForbidden, "team is under a veto cooldown and cannot take on a challenge yet")
		return
	}

	nonce := uuid.New().String()
	payloadBytes, _ := json.Marshal(eventstore.ChallengeAttemptStartedPayload{
		TeamID:      team.ID,
		WaypointID:  waypointID,
		RoadID:      req.RoadID,
		ChallengeID: challengeID,
		Prompt:      prompt,
		Nonce:       nonce,
	})

	expectedSeq, err := s.nextSequence(r.Context(), gameID)
	if err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to resolve sequence")
		return
	}

	cmdReq := commands.CommandRequest{
		GameID:         gameID,
		CommandType:    "ChallengeAttemptStarted",
		ExpectedSeq:    expectedSeq,
		IdempotencyKey: req.IdempotencyKey,
		Payload:        payloadBytes,
	}
	_, err = s.CmdProcessor.Process(r.Context(), cmdReq, func(ctx context.Context, tx pgx.Tx, cr commands.CommandRequest) (*commands.CommandResult, error) {
		return &commands.CommandResult{
			ResponseCode: http.StatusOK,
			ResponseBody: challengeStartResponse{ChallengeID: challengeID, Prompt: prompt},
			Events: []eventstore.Event{
				{Type: "ChallengeAttemptStarted", Payload: string(cr.Payload)},
			},
		}, nil
	})
	if err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to start challenge: "+err.Error())
		return
	}

	writeJSON(r.Context(), w, http.StatusOK, challengeStartResponse{ChallengeID: challengeID, Prompt: prompt})
}

func (s *Server) handlePresign(w http.ResponseWriter, r *http.Request) {
	gameID := chi.URLParam(r, "game_id")

	var req PresignRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(r.Context(), w, http.StatusBadRequest, "invalid request body")
		return
	}

	game, team, ok := s.requireTeam(w, r, gameID)
	if !ok {
		return
	}
	if !requireNotPurging(r.Context(), w, game) {
		return
	}

	if s.BlobStore == nil {
		writeError(r.Context(), w, http.StatusServiceUnavailable, "blob store not configured")
		return
	}

	// Generate a secure object storage key scoped to this game and team.
	blobKey, err := blobstore.MintEvidenceKey(gameID, team.ID)
	if err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to mint blob key: "+err.Error())
		return
	}

	contentType := req.ContentType
	if contentType == "" {
		contentType = "image/jpeg"
	}

	reqHost, reqScheme := forwardedHostAndScheme(r)

	var url string
	if presignerWithHost, ok := s.BlobStore.(interface {
		PresignUploadWithHost(ctx context.Context, key string, contentType string, ttl time.Duration, reqHost string, reqScheme string) (string, error)
	}); ok {
		url, err = presignerWithHost.PresignUploadWithHost(r.Context(), blobKey, contentType, 15*time.Minute, reqHost, reqScheme)
	} else {
		url, err = s.BlobStore.PresignUpload(r.Context(), blobKey, contentType, 15*time.Minute)
	}

	if err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to generate presigned URL: "+err.Error())
		return
	}

	writeJSON(r.Context(), w, http.StatusOK, presignResponse{UploadURL: url, BlobRef: blobKey})
}

// requireNotPurging verifies that the target game is not currently undergoing retention purge.
func requireNotPurging(ctx context.Context, w http.ResponseWriter, game *gameRecord) bool {
	if game.PurgingAt != nil {
		writeError(ctx, w, http.StatusConflict, "this race is being deleted and is no longer accepting evidence")
		return false
	}
	return true
}

// requireOwnedBlobRef validates that the storage object key was issued to the requesting team.
func requireOwnedBlobRef(ctx context.Context, w http.ResponseWriter, blobRef, gameID, teamID string) bool {
	if !blobstore.KeyBelongsToTeam(blobRef, gameID, teamID) {
		writeError(ctx, w, http.StatusForbidden, "blob_ref was not issued to this team: request a fresh upload URL")
		return false
	}
	return true
}

func (s *Server) handleSubmission(w http.ResponseWriter, r *http.Request) {
	gameID := chi.URLParam(r, "game_id")

	var req SubmissionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(r.Context(), w, http.StatusBadRequest, "invalid request body")
		return
	}
	waypointID := req.WaypointID
	if waypointID == "" {
		waypointID = req.RoadID
	}
	if req.BlobRef == "" || waypointID == "" || req.ChallengeID == "" || req.IdempotencyKey == "" {
		writeError(r.Context(), w, http.StatusBadRequest, "blob_ref, waypoint_id, challenge_id, and idempotency_key are required")
		return
	}
	if req.Lat == nil || req.Lon == nil {
		writeError(r.Context(), w, http.StatusBadRequest, "lat and lon are required: evidence is graded against where it was taken")
		return
	}
	// A blob_ref is an object key, never a URL — the worker fetches it
	// server-side, so a URL here would be an SSRF primitive.
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

	// Validate team position and game state.
	proj, err := projections.RebuildProjection(r.Context(), s.DB.Pool, gameID, 0)
	if err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to load game state")
		return
	}
	if reason, locked := coinRushLocksOut(game.Mode, proj.Progress[team.ID]); locked {
		writeError(r.Context(), w, http.StatusForbidden, reason)
		return
	}
	if prog := proj.Progress[team.ID]; prog.CurrentWaypointID != waypointID {
		writeError(r.Context(), w, http.StatusForbidden, "you must be at the waypoint to submit evidence for its challenge")
		return
	}

	// Verify an active challenge attempt exists.
	if err := s.requireChallengeAttempt(r.Context(), gameID, team.ID, waypointID); err != nil {
		writeError(r.Context(), w, http.StatusForbidden, err.Error())
		return
	}

	// Validate location coordinates against waypoint arrival radius.
	var wpLat, wpLon, arrivalRadiusM float64
	err = s.DB.Pool.QueryRow(r.Context(), `
		SELECT ST_Y(location::geometry), ST_X(location::geometry), arrival_radius_m
		FROM board_waypoints
		WHERE board_id = $1 AND board_version = $2 AND id = $3
	`, game.BoardID, game.BoardVersion, waypointID).Scan(&wpLat, &wpLon, &arrivalRadiusM)
	if err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to query waypoint coordinates")
		return
	}
	dist := geo.DistanceM(*req.Lat, *req.Lon, wpLat, wpLon)
	if check := rules.CheckArrival(dist, arrivalRadiusM, req.AccuracyM); !check.Allowed {
		logger.Warn(r.Context(), "submission rejected by GPS gate", map[string]interface{}{
			"game_id": gameID, "team_id": team.ID, "waypoint_id": waypointID,
			"distance_m": dist, "accuracy_m": req.AccuracyM, "reason": check.Reason,
		})
		writeError(r.Context(), w, http.StatusUnprocessableEntity, "GPS verification failed: "+check.Message)
		return
	}

	submissionID := uuid.New().String()
	serverReceivedAt := time.Now().UTC()

	var prompt, rubricJSON string
	err = s.DB.Pool.QueryRow(r.Context(), `
		SELECT prompt, rubric::text
		FROM challenges
		WHERE (id::text = $1 OR waypoint_id::text = $1) AND board_id = $2 AND board_version = $3
		LIMIT 1
	`, req.ChallengeID, game.BoardID, game.BoardVersion).Scan(&prompt, &rubricJSON)
	if err != nil {
		err = s.DB.Pool.QueryRow(r.Context(), `
			SELECT c.prompt, c.rubric::text
			FROM challenges c
			JOIN board_roads s ON s.challenge_id = c.id
			WHERE (c.id::text = $1 OR c.waypoint_id::text = $1 OR s.id::text = $1) AND c.board_id = $2 AND c.board_version = $3
			LIMIT 1
		`, req.ChallengeID, game.BoardID, game.BoardVersion).Scan(&prompt, &rubricJSON)
		if err != nil {
			// Ensure challenge definition belongs to the current board version.
			writeError(r.Context(), w, http.StatusNotFound, "challenge not found on this game's board")
			return
		}
	}

	payloadBytes, _ := json.Marshal(eventstore.SubmissionCreatedPayload{
		SubmissionID:   submissionID,
		TeamID:         team.ID,
		WaypointID:     waypointID,
		RoadID:         req.RoadID,
		ChallengeID:    req.ChallengeID,
		BlobRef:        req.BlobRef,
		IdempotencyKey: req.IdempotencyKey,
	})

	clientCapturedAt := sanitizeClientCapturedAt(req.ClientCapturedAt, serverReceivedAt)

	verifyPayload := map[string]interface{}{
		"submission_id": submissionID,
		"game_id":       gameID,
		"team_id":       team.ID,
		"waypoint_id":   waypointID,
		"road_id":       req.RoadID,
		"challenge_id":  req.ChallengeID,
		"blob_ref":      req.BlobRef,
		"prompt":        prompt,
		"rubric":        json.RawMessage(rubricJSON),
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
	// Determine submission status based on ruleset verification mode.
	grading := game.Ruleset.Verification
	submissionStatus := "pending"

	_, err = s.CmdProcessor.Process(r.Context(), cmdReq, func(ctx context.Context, tx pgx.Tx, cr commands.CommandRequest) (*commands.CommandResult, error) {
		var roadIDNull *string
		if waypointID != "" {
			roadIDNull = &waypointID
		} else if req.RoadID != "" {
			roadIDNull = &req.RoadID
		}
		_, dbErr := tx.Exec(ctx, `
			INSERT INTO challenge_submissions
			  (id, game_id, team_id, road_id, challenge_id, blob_ref, idempotency_key, client_captured_at, server_received_at, lat, lon, accuracy_m)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
		`, submissionID, gameID, team.ID, roadIDNull, req.ChallengeID, req.BlobRef, req.IdempotencyKey, clientCapturedAt, serverReceivedAt,
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
			// Auto-approve submission under trust verification mode.
			events, _, applyErr := s.applyVerdict(ctx, tx, game,
				gradedSubmission{
					ID:               submissionID,
					TeamID:           team.ID,
					RoadID:           derefOr(roadIDNull, ""),
					ChallengeID:      req.ChallengeID,
					Kind:             "challenge",
					ServerReceivedAt: &serverReceivedAt,
				},
				"pass", 1.0, trustRationale, rules.VerificationTrust)
			if applyErr != nil {
				return nil, applyErr
			}
			result.Events = append(result.Events, events...)
			submissionStatus = "pass"

		case rules.VerificationHost:
			// Submissions remain pending until reviewed by the host.
			submissionStatus = "pending_review"

		default:
			result.Jobs = []commands.JobOutboxEntry{
				{Type: "verification", Payload: verifyPayload},
			}
		}

		result.ResponseBody = map[string]string{"submission_id": submissionID, "status": submissionStatus}
		return result, nil
	})
	if err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to record submission: "+err.Error())
		return
	}

	writeJSON(r.Context(), w, http.StatusCreated, submissionResponse{
		SubmissionID: submissionID,
		Status:       submissionStatus,
	})
}

func (s *Server) handleVeto(w http.ResponseWriter, r *http.Request) {
	gameID := chi.URLParam(r, "game_id")

	var req VetoRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(r.Context(), w, http.StatusBadRequest, "invalid request body")
		return
	}
	waypointID := req.WaypointID
	if waypointID == "" {
		waypointID = req.RoadID
	}
	if waypointID == "" {
		writeError(r.Context(), w, http.StatusBadRequest, "waypoint_id is required")
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

	var challengeID string
	var vetoPenaltySeconds int
	err := s.DB.Pool.QueryRow(r.Context(), `
		SELECT id::text, veto_penalty_seconds FROM challenges
		WHERE board_id = $1 AND board_version = $2 AND waypoint_id = $3
	`, game.BoardID, game.BoardVersion, waypointID).Scan(&challengeID, &vetoPenaltySeconds)
	if err != nil {
		// Fallback query
		err = s.DB.Pool.QueryRow(r.Context(), `
			SELECT c.id::text, c.veto_penalty_seconds FROM challenges c
			JOIN board_roads s ON s.challenge_id = c.id
			WHERE s.board_id = $1 AND s.board_version = $2 AND s.id = $3
		`, game.BoardID, game.BoardVersion, waypointID).Scan(&challengeID, &vetoPenaltySeconds)
		if err != nil {
			// Fallback to ruleset minimum penalty when challenge definition specifies none.
			vetoPenaltySeconds = game.Ruleset.VetoPenaltyMinSeconds
		}
	}
	// Calculate veto penalty cost based on game mode and ruleset.
	cost := game.Ruleset.VetoCostFor(game.Mode, vetoPenaltySeconds)

	proj, err := projections.RebuildProjection(r.Context(), s.DB.Pool, gameID, 0)
	if err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to load projection")
		return
	}

	if reason, locked := coinRushLocksOut(game.Mode, proj.Progress[team.ID]); locked {
		writeError(r.Context(), w, http.StatusForbidden, reason)
		return
	}

	effects := proj.Effects[team.ID]
	if rules.IsFrozen(effects, time.Now().UTC()) {
		writeError(r.Context(), w, http.StatusForbidden, "team is frozen")
		return
	}

	now := time.Now().UTC()
	// Set veto penalty duration.
	penaltyUntil := now
	if cost.CooldownSeconds > 0 {
		penaltyUntil = now.Add(time.Duration(cost.CooldownSeconds) * time.Second)
	}
	payloadBytes, _ := json.Marshal(eventstore.ChallengeVetoedPayload{
		TeamID:             team.ID,
		WaypointID:         waypointID,
		RoadID:             req.RoadID,
		ChallengeID:        challengeID,
		PenaltyUntil:       penaltyUntil,
		TimePenaltySeconds: cost.TimePenaltySeconds,
	})

	// Build veto response payload.
	vetoResponse := vetoResponseBody{
		Status:             "vetoed",
		PenaltyUntil:       penaltyUntil.Format(time.RFC3339),
		CooldownSeconds:    cost.CooldownSeconds,
		TimePenaltySeconds: cost.TimePenaltySeconds,
	}

	expectedSeq, err := s.nextSequence(r.Context(), gameID)
	if err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to resolve sequence")
		return
	}
	cmdReq := commands.CommandRequest{
		GameID:         gameID,
		CommandType:    "ChallengeVetoed",
		ExpectedSeq:    expectedSeq,
		IdempotencyKey: req.IdempotencyKey,
		Payload:        payloadBytes,
	}
	_, err = s.CmdProcessor.Process(r.Context(), cmdReq, func(ctx context.Context, tx pgx.Tx, cr commands.CommandRequest) (*commands.CommandResult, error) {
		// Record veto bypass for team progression.
		if _, err := tx.Exec(ctx, `
			INSERT INTO team_road_bypass (game_id, team_id, road_id, reason)
			VALUES ($1, $2, $3, 'veto')
			ON CONFLICT (game_id, team_id, road_id) DO UPDATE SET reason = EXCLUDED.reason
		`, gameID, team.ID, waypointID); err != nil {
			return nil, fmt.Errorf("recording the veto bypass: %w", err)
		}

		// Record active veto penalty effect when cooldown is greater than zero.
		if cost.CooldownSeconds > 0 {
			if _, err := tx.Exec(ctx, `
				INSERT INTO team_effects (id, game_id, team_id, kind, until, meta)
				VALUES ($1, $2, $3, 'veto_penalty', $4, to_jsonb($5::text))
			`, uuid.New().String(), gameID, team.ID, penaltyUntil, waypointID); err != nil {
				return nil, fmt.Errorf("recording the veto penalty: %w", err)
			}
		}

		return &commands.CommandResult{
			ResponseCode: http.StatusOK,
			ResponseBody: vetoResponse,
			Events: []eventstore.Event{
				{Type: "ChallengeVetoed", Payload: string(cr.Payload)},
			},
		}, nil
	})
	if err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to apply veto: "+err.Error())
		return
	}

	writeJSON(r.Context(), w, http.StatusOK, vetoResponse)
}

const (
	// maxClientClockSkew is the maximum allowed future clock offset for client capture timestamps.
	maxClientClockSkew = 5 * time.Minute
	// maxOfflineCaptureAge is the maximum allowed age for offline client capture timestamps.
	maxOfflineCaptureAge = 24 * time.Hour
)

// sanitizeClientCapturedAt validates client timestamp against server arrival time.
func sanitizeClientCapturedAt(claimed, serverReceivedAt time.Time) *time.Time {
	if claimed.IsZero() {
		return nil
	}
	t := claimed.UTC()
	if t.After(serverReceivedAt.Add(maxClientClockSkew)) {
		return nil
	}
	if t.Before(serverReceivedAt.Add(-maxOfflineCaptureAge)) {
		return nil
	}
	return &t
}

// lastKnownFix returns the team's last recorded position for velocity verification.
func (s *Server) lastKnownFix(ctx context.Context, gameID, teamID string) map[string]interface{} {
	var lat, lon, accuracyM float64
	var reportedAt time.Time
	err := s.DB.Pool.QueryRow(ctx, `
		SELECT lat, lon, COALESCE(accuracy_m, 0), reported_at
		FROM team_positions WHERE game_id = $1 AND team_id = $2
	`, gameID, teamID).Scan(&lat, &lon, &accuracyM, &reportedAt)
	if err != nil {
		return nil
	}
	return map[string]interface{}{
		"lat":        lat,
		"lon":        lon,
		"accuracy_m": accuracyM,
		"timestamp":  reportedAt.UTC(),
	}
}
