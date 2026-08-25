package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v4"

	"github.com/Jessevdz/RunwayTheGame/internal/commands"
	"github.com/Jessevdz/RunwayTheGame/internal/eventstore"
	"github.com/Jessevdz/RunwayTheGame/internal/geo"
	"github.com/Jessevdz/RunwayTheGame/internal/logger"
	"github.com/Jessevdz/RunwayTheGame/internal/projections"
	"github.com/Jessevdz/RunwayTheGame/internal/rules"
)

// ArriveRequest defines the payload for submitting a waypoint arrival.
type ArriveRequest struct {
	WaypointID     string  `json:"waypoint_id"`
	Lat            float64 `json:"lat"`
	Lon            float64 `json:"lon"`
	AccuracyM      float64 `json:"accuracy_m"`
	IdempotencyKey string  `json:"idempotency_key"`
}

// PositionRequest defines the payload for reporting team GPS coordinates.
type PositionRequest struct {
	Lat       float64 `json:"lat"`
	Lon       float64 `json:"lon"`
	AccuracyM float64 `json:"accuracy_m"`
}

// arrivalResponse acknowledges the waypoint a team was recorded as reaching.
type arrivalResponse struct {
	Status     string `json:"status"`
	WaypointID string `json:"waypoint_id"`
}

// handleArrive processes team waypoint arrival reports and triggers completion logic.
func (s *Server) handleArrive(w http.ResponseWriter, r *http.Request) {
	gameID := chi.URLParam(r, "game_id")

	var req ArriveRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(r.Context(), w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.WaypointID == "" {
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

	var wpLat, wpLon, arrivalRadiusM float64
	var wpIsFinish bool
	err := s.DB.Pool.QueryRow(r.Context(), `
		SELECT ST_Y(location::geometry), ST_X(location::geometry), arrival_radius_m, is_finish
		FROM board_waypoints
		WHERE board_id = $1 AND board_version = $2 AND id = $3
	`, game.BoardID, game.BoardVersion, req.WaypointID).Scan(&wpLat, &wpLon, &arrivalRadiusM, &wpIsFinish)
	if err != nil {
		writeError(r.Context(), w, http.StatusNotFound, "waypoint not found on board")
		return
	}

	// Validate GPS distance against waypoint arrival radius and location accuracy bounds.
	dist := geo.DistanceM(req.Lat, req.Lon, wpLat, wpLon)
	if check := rules.CheckArrival(dist, arrivalRadiusM, req.AccuracyM); !check.Allowed {
		logger.Warn(r.Context(), "arrival rejected by GPS gate", map[string]interface{}{
			"game_id":     gameID,
			"team_id":     team.ID,
			"waypoint_id": req.WaypointID,
			"reason":      check.Reason,
			"distance_m":  dist,
			"accuracy_m":  req.AccuracyM,
		})
		writeError(r.Context(), w, http.StatusUnprocessableEntity, "GPS verification failed: "+check.Message)
		return
	}

	proj, err := projections.RebuildProjection(r.Context(), s.DB.Pool, gameID, 0)
	if err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to load projection")
		return
	}

	effects := proj.Effects[team.ID]
	if rules.IsFrozen(effects, time.Now().UTC()) {
		writeError(r.Context(), w, http.StatusForbidden, "team is frozen")
		return
	}

	prog := proj.Progress[team.ID]

	// Prevent coin rush teams that have reached the finish line from submitting further arrivals.
	if reason, locked := coinRushLocksOut(game.Mode, prog); locked {
		writeError(r.Context(), w, http.StatusForbidden, reason)
		return
	}

	// A team cannot return to a waypoint they have already cleared.
	targetCleared := rules.IsWaypointCleared(proj.WaypointStates[req.WaypointID], team.ID)
	if !targetCleared {
		for _, id := range prog.ClearedWaypoints {
			if id == req.WaypointID {
				targetCleared = true
				break
			}
		}
	}
	if targetCleared {
		writeError(r.Context(), w, http.StatusForbidden, "cannot return to an already cleared waypoint")
		return
	}

	// Ensure the current waypoint challenge is cleared before moving to connected waypoints.
	if prog.CurrentWaypointID != "" {
		currWaypointState := proj.WaypointStates[prog.CurrentWaypointID]
		// Verify gating challenge state before allowing movement.
		var hasGatingChallenge bool
		if err := s.DB.Pool.QueryRow(r.Context(), `
			SELECT EXISTS(SELECT 1 FROM challenges WHERE board_id = $1 AND board_version = $2 AND waypoint_id = $3)
		`, game.BoardID, game.BoardVersion, prog.CurrentWaypointID).Scan(&hasGatingChallenge); err != nil {
			writeError(r.Context(), w, http.StatusInternalServerError, "failed to check the waypoint challenge: "+err.Error())
			return
		}

		if hasGatingChallenge && !rules.IsWaypointOpen(currWaypointState, team.ID) {
			writeError(r.Context(), w, http.StatusForbidden, "current waypoint challenge must be cleared before moving to attached waypoints")
			return
		}
	}

	// Locate the connecting road between current and target waypoints.
	var roadID string
	err = s.DB.Pool.QueryRow(r.Context(), `
		SELECT id FROM board_roads
		WHERE board_id = $1 AND board_version = $2
		  AND ((waypoint_id_a = $3 AND waypoint_id_b = $4) OR (waypoint_id_a = $4 AND waypoint_id_b = $3))
	`, game.BoardID, game.BoardVersion, prog.CurrentWaypointID, req.WaypointID).Scan(&roadID)
	if err != nil {
		writeError(r.Context(), w, http.StatusBadRequest, "no road connects your current waypoint to target waypoint")
		return
	}

	// Verify road gating challenges and active team roadblocks before traversal.
	var segHasGatingChallenge bool
	if err := s.DB.Pool.QueryRow(r.Context(), `
		SELECT challenge_id IS NOT NULL FROM board_roads
		WHERE board_id = $1 AND board_version = $2 AND id = $3
	`, game.BoardID, game.BoardVersion, roadID).Scan(&segHasGatingChallenge); err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to check the road challenge: "+err.Error())
		return
	}

	gate := rules.RoadGateFor(proj.RoadStates[roadID], team.ID, segHasGatingChallenge)
	gate.Roadblocked = proj.Roadblocks[roadID].BlocksTeam(team.ID)
	if verdict := rules.CanTraverse(gate); !verdict.Allowed {
		writeError(r.Context(), w, http.StatusForbidden, verdict.Message)
		return
	}

	events := []eventstore.Event{}
	arrivePayload, _ := json.Marshal(eventstore.WaypointReachedPayload{
		TeamID:     team.ID,
		WaypointID: req.WaypointID,
		IsFinish:   wpIsFinish,
	})
	events = append(events, eventstore.Event{Type: "WaypointReached", Payload: string(arrivePayload)})

	// Flag and reject arrivals with implausible speed based on location history.
	startWP := ""
	for _, wp := range proj.Board.Waypoints {
		if wp.IsStart {
			startWP = wp.ID
			break
		}
	}
	if reason, speed := s.detectArrivalAnomaly(r.Context(), gameID, team.ID, prog.CurrentWaypointID, startWP, req.Lat, req.Lon); reason != "" {
		flagPayload, _ := json.Marshal(eventstore.ArrivalFlaggedPayload{
			TeamID:     team.ID,
			WaypointID: req.WaypointID,
			Reason:     reason,
			SpeedMS:    speed,
			DistanceM:  dist,
			AccuracyM:  req.AccuracyM,
		})
		logger.Warn(r.Context(), "arrival refused: implausible movement since the last fix", map[string]interface{}{
			"game_id":     gameID,
			"team_id":     team.ID,
			"waypoint_id": req.WaypointID,
			"reason":      reason,
			"speed_ms":    speed,
		})
		s.recordArrivalFlag(r.Context(), gameID, flagPayload)
		writeError(r.Context(), w, http.StatusUnprocessableEntity, fmt.Sprintf(
			"GPS verification failed: %s (%.0f m/s). Stay where you are for a few seconds and try again.",
			reason, speed))
		return
	}

	// Outside a coin rush, the first team to cross the finish line wins and ends the race.
	coinRush := game.Mode == rules.ModeCoinRush
	if wpIsFinish && !coinRush {
		endPayload, _ := json.Marshal(eventstore.GameEndedPayload{WinnerTeamID: team.ID})
		events = append(events, eventstore.Event{Type: "GameEnded", Payload: string(endPayload)})
	}

	handler := func(ctx context.Context, tx pgx.Tx, cr commands.CommandRequest) (*commands.CommandResult, error) {
		txEvents := events

		switch {
		case !wpIsFinish:
			// Nothing to settle.

		case !coinRush:
			// Mark the game as ended and record the winning team.
			if _, err := tx.Exec(ctx, `UPDATE games SET status = 'ended', winner_team_id = $1 WHERE id = $2`, team.ID, gameID); err != nil {
				return nil, fmt.Errorf("closing the race: %w", err)
			}

		default:
			settled, err := s.settleCoinRushFinish(ctx, tx, gameID, team.ID, game.Ruleset)
			if err != nil {
				return nil, err
			}
			txEvents = append(txEvents, settled...)
		}

		return &commands.CommandResult{
			ResponseCode: http.StatusOK,
			ResponseBody: arrivalResponse{Status: "arrived", WaypointID: req.WaypointID},
			Events:       txEvents,
		}, nil
	}

	// Derive an idempotency key from (game, team, waypoint) when the client omits one, so replay arrives hit the cache.
	idempotencyKey := req.IdempotencyKey
	if idempotencyKey == "" {
		idempotencyKey = "arrive:" + gameID + ":" + team.ID + ":" + req.WaypointID
	}

	// Retry concurrent arrival processing using the updated event sequence.
	err = s.processArrivalWithRetry(r.Context(), gameID, idempotencyKey, arrivePayload, handler)
	if err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to record arrival: "+err.Error())
		return
	}

	writeJSON(r.Context(), w, http.StatusOK, arrivalResponse{Status: "arrived", WaypointID: req.WaypointID})
}

// requireChallengeAttempt verifies that a team has recorded a challenge attempt before submitting evidence.
func (s *Server) requireChallengeAttempt(ctx context.Context, gameID, teamID, waypointID string) error {
	var exists bool
	err := s.DB.Pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM events
			WHERE game_id = $1
			  AND event_type = 'ChallengeAttemptStarted'
			  AND payload->>'team_id' = $2
			  AND COALESCE(NULLIF(payload->>'waypoint_id', ''), payload->>'road_id') = $3
		)
	`, gameID, teamID, waypointID).Scan(&exists)
	if err != nil {
		return errors.New("failed to verify challenge attempt")
	}
	if !exists {
		return errors.New("start the challenge before submitting evidence for it")
	}
	return nil
}

// recordArrivalFlag writes an ArrivalFlagged event for a refused arrival.
func (s *Server) recordArrivalFlag(ctx context.Context, gameID string, payload []byte) {
	expectedSeq, err := s.nextSequence(ctx, gameID)
	if err != nil {
		logger.Warn(ctx, "could not record a refused arrival", map[string]interface{}{"game_id": gameID, "error": err.Error()})
		return
	}
	_, err = s.CmdProcessor.Process(ctx, commands.CommandRequest{
		GameID:      gameID,
		CommandType: "ArrivalFlagged",
		ExpectedSeq: expectedSeq,
		Payload:     payload,
	}, func(ctx context.Context, tx pgx.Tx, cr commands.CommandRequest) (*commands.CommandResult, error) {
		return &commands.CommandResult{
			ResponseCode: http.StatusOK,
			ResponseBody: statusResponse{Status: "flagged"},
			Events: []eventstore.Event{
				{Type: "ArrivalFlagged", Payload: string(cr.Payload)},
			},
		}, nil
	})
	if err != nil {
		logger.Warn(ctx, "could not record a refused arrival", map[string]interface{}{"game_id": gameID, "error": err.Error()})
	}
}

// detectArrivalAnomaly checks if arrival movement speed exceeds plausible velocity bounds relative to the last reported position.
func (s *Server) detectArrivalAnomaly(ctx context.Context, gameID, teamID, currentWaypointID, startWaypointID string, lat, lon float64) (string, float64) {
	var prevLat, prevLon float64
	var reportedAt time.Time
	err := s.DB.Pool.QueryRow(ctx, `
		SELECT lat, lon, reported_at FROM team_positions WHERE game_id = $1 AND team_id = $2
	`, gameID, teamID).Scan(&prevLat, &prevLon, &reportedAt)
	if err != nil {
		// A missing fix gives no velocity baseline, so it can never be trusted for movement beyond the start.
		if errors.Is(err, pgx.ErrNoRows) && currentWaypointID != "" && currentWaypointID == startWaypointID {
			return "", 0
		}
		return "no recent position fix; no baseline to verify movement speed", 0
	}

	travelled := geo.DistanceM(prevLat, prevLon, lat, lon)
	elapsed := s.nowUTC().Sub(reportedAt.UTC())
	if implausible, speed := rules.ImplausibleSpeed(travelled, elapsed); implausible {
		return "implausible velocity since last position report", speed
	}
	return "", 0
}

// validPositionFix reports whether lat/lon/accuracy form a plausible GPS fix.
func validPositionFix(lat, lon, accuracyM float64) bool {
	if math.IsNaN(lat) || math.IsNaN(lon) || math.IsInf(lat, 0) || math.IsInf(lon, 0) {
		return false
	}
	if lat < -90 || lat > 90 || lon < -180 || lon > 180 {
		return false
	}
	return accuracyM >= 0 && accuracyM <= rules.MaxPlausibleAccuracyM
}

// positionSitsOnUnreachedWaypoint reports whether a fix falls within the arrival
// radius of a board waypoint the team has not yet reached.
func (s *Server) positionSitsOnUnreachedWaypoint(ctx context.Context, gameID, boardID string, boardVersion int, teamID string, lat, lon float64) bool {
	reached := map[string]bool{}
	rows, err := s.DB.Pool.Query(ctx, `
		SELECT DISTINCT payload->>'waypoint_id' FROM events
		WHERE game_id = $1 AND event_type = 'WaypointReached' AND payload->>'team_id' = $2
	`, gameID, teamID)
	if err != nil {
		return false
	}
	for rows.Next() {
		var id string
		if rows.Scan(&id) == nil {
			reached[id] = true
		}
	}
	rows.Close()

	type wp struct {
		id      string
		lat     float64
		lon     float64
		radiusM float64
		start   bool
	}
	var wps []wp
	wayRows, err := s.DB.Pool.Query(ctx, `
		SELECT id, ST_Y(location::geometry), ST_X(location::geometry), arrival_radius_m, is_start
		FROM board_waypoints WHERE board_id = $1 AND board_version = $2
	`, boardID, boardVersion)
	if err != nil {
		return false
	}
	for wayRows.Next() {
		var w wp
		if wayRows.Scan(&w.id, &w.lat, &w.lon, &w.radiusM, &w.start) == nil {
			wps = append(wps, w)
		}
	}
	wayRows.Close()

	for _, w := range wps {
		if w.start || reached[w.id] {
			continue
		}
		if geo.DistanceM(lat, lon, w.lat, w.lon) <= rules.ClampArrivalRadiusM(w.radiusM) {
			return true
		}
	}
	return false
}

// handlePosition records a team's latest GPS fix into team_positions state.
func (s *Server) handlePosition(w http.ResponseWriter, r *http.Request) {
	gameID := chi.URLParam(r, "game_id")

	var req PositionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(r.Context(), w, http.StatusBadRequest, "invalid request body")
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

	// Reject malformed or implausible coordinates so they cannot seed the velocity gate.
	if !validPositionFix(req.Lat, req.Lon, req.AccuracyM) {
		writeError(r.Context(), w, http.StatusBadRequest, "lat/lon must be finite and within geographic bounds, accuracy_m within [0, MaxPlausibleAccuracyM]")
		return
	}

	// Prevent a team from planting a fix on a waypoint it has not reached, which
	// would zero the arrival-velocity gate for that waypoint.
	if s.positionSitsOnUnreachedWaypoint(r.Context(), gameID, game.BoardID, game.BoardVersion, team.ID, req.Lat, req.Lon) {
		writeError(r.Context(), w, http.StatusBadRequest, "position cannot be at a waypoint the team has not reached")
		return
	}

	// Rate limit position updates to prevent excessive projection rebuilds.
	if s.positionLimiter != nil && !s.positionLimiter.allow(gameID+":"+team.ID) {
		w.Header().Set("Retry-After", "5")
		writeError(r.Context(), w, http.StatusTooManyRequests, "position reported too frequently")
		return
	}

	_, err := s.DB.Pool.Exec(r.Context(), `
		INSERT INTO team_positions (game_id, team_id, lat, lon, accuracy_m, reported_at)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (game_id, team_id)
		DO UPDATE SET lat = EXCLUDED.lat, lon = EXCLUDED.lon, accuracy_m = EXCLUDED.accuracy_m, reported_at = EXCLUDED.reported_at
	`, gameID, team.ID, req.Lat, req.Lon, req.AccuracyM, s.nowUTC())
	if err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to record position: "+err.Error())
		return
	}

	s.broadcastProjection(r.Context(), gameID)

	writeJSON(r.Context(), w, http.StatusOK, statusResponse{Status: "recorded"})
}
