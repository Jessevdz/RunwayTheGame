package api

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgconn"
	"github.com/jackc/pgx/v4"

	"github.com/Jessevdz/RunwayTheGame/internal/logger"
	"github.com/Jessevdz/RunwayTheGame/internal/rules"
)

// ChallengeRequest payload for creating/updating a challenge.
type ChallengeRequest struct {
	EditToken          string             `json:"edit_token"`
	Prompt             string             `json:"prompt"`
	Rubric             rules.RubricDetail `json:"rubric"`
	CoinReward         int                `json:"coin_reward"`
	VetoPenaltySeconds int                `json:"veto_penalty_seconds"`
}

// challengeCreatedResponse acknowledges a challenge attached to a draft board.
// ID and ChallengeID carry the same value; both field names are on the wire.
type challengeCreatedResponse struct {
	ID          string `json:"id"`
	BoardID     string `json:"board_id"`
	WaypointID  string `json:"waypoint_id"`
	ChallengeID string `json:"challenge_id"`
}

// checkDraftState authorizes a draft-board write and returns the target board version.
func (s *Server) checkDraftState(r *http.Request, boardID, token string) (int, error) {
	version := 1 // design flow works on version 1

	if err := s.authorizeBoardEdit(r.Context(), boardID, token); err != nil {
		return version, err
	}

	// A race pins a frozen snapshot rather than the draft, so publishing does not
	// close the design off — only a version a game already runs on does.
	if err := s.requireEditableBoardVersion(r.Context(), boardID, version); err != nil {
		return version, err
	}
	return version, nil
}

// handleAddChallenge adds a challenge to a draft board waypoint or road.
func (s *Server) handleAddChallenge(w http.ResponseWriter, r *http.Request) {
	boardID := chi.URLParam(r, "id")
	waypointID := chi.URLParam(r, "waypoint_id")
	if waypointID == "" {
		waypointID = chi.URLParam(r, "road_id")
	}

	var req ChallengeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(r.Context(), w, http.StatusBadRequest, "invalid request body")
		return
	}

	version, err := s.checkDraftState(r, boardID, req.EditToken)
	if err != nil {
		writeError(r.Context(), w, http.StatusForbidden, "forbidden: "+err.Error())
		return
	}

	challengeID := uuid.New().String()
	rubricBytes, err := json.Marshal(req.Rubric)
	if err != nil {
		writeError(r.Context(), w, http.StatusBadRequest, "invalid rubric: "+err.Error())
		return
	}

	tx, err := s.DB.Pool.Begin(r.Context())
	if err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to start transaction")
		return
	}
	defer tx.Rollback(r.Context())
	if err := lockEditableBoardVersion(r.Context(), tx, boardID, version); err != nil {
		if errors.Is(err, errBoardVersionRaced) {
			writeError(r.Context(), w, http.StatusForbidden, err.Error())
		} else {
			writeError(r.Context(), w, http.StatusInternalServerError, "failed to lock editable board: "+err.Error())
		}
		return
	}

	// Resolve and lock the exact target after acquiring the board row lock.
	// Waypoint challenges use challenges.waypoint_id; road challenges are linked
	// through board_roads.challenge_id and keep waypoint_id NULL.
	var waypointIsFinish bool
	var attachedChallengeID string
	err = tx.QueryRow(r.Context(), `
		SELECT is_finish, COALESCE(challenge_id::text, '') FROM board_waypoints
		WHERE id = $1 AND board_id = $2 AND board_version = $3
	`, waypointID, boardID, version).Scan(&waypointIsFinish, &attachedChallengeID)
	targetIsWaypoint := err == nil
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		logger.Error(r.Context(), "failed to read waypoint", map[string]interface{}{"waypoint_id": waypointID, "error": err.Error()})
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to read waypoint")
		return
	}
	if !targetIsWaypoint {
		err = tx.QueryRow(r.Context(), `
			SELECT COALESCE(challenge_id::text, '') FROM board_roads
			WHERE id = $1 AND board_id = $2 AND board_version = $3
		`, waypointID, boardID, version).Scan(&attachedChallengeID)
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(r.Context(), w, http.StatusNotFound, "no waypoint or road with that id on this board")
			return
		}
		if err != nil {
			logger.Error(r.Context(), "failed to read road", map[string]interface{}{"road_id": waypointID, "error": err.Error()})
			writeError(r.Context(), w, http.StatusInternalServerError, "failed to read road")
			return
		}
	}
	if waypointIsFinish {
		writeError(r.Context(), w, http.StatusBadRequest, "the finish line carries no challenge: arriving at the finish waypoint is the objective")
		return
	}
	if attachedChallengeID != "" {
		writeError(r.Context(), w, http.StatusConflict, "this waypoint or road already has a challenge")
		return
	}
	var alreadyHasChallenge bool
	if err := tx.QueryRow(r.Context(), `
		SELECT EXISTS (
			SELECT 1 FROM challenges
			WHERE board_id = $1 AND board_version = $2 AND waypoint_id = $3
		)
	`, boardID, version, waypointID).Scan(&alreadyHasChallenge); err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to check for an existing challenge")
		return
	}
	if alreadyHasChallenge {
		writeError(r.Context(), w, http.StatusConflict, "this waypoint or road already has a challenge")
		return
	}

	var challengeWaypointID *string
	if targetIsWaypoint {
		challengeWaypointID = &waypointID
	}

	_, err = tx.Exec(r.Context(), `
		INSERT INTO challenges (id, board_id, board_version, waypoint_id, prompt, rubric, coin_reward, veto_penalty_seconds)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
	`, challengeID, boardID, version, challengeWaypointID, req.Prompt, rubricBytes, req.CoinReward, req.VetoPenaltySeconds)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == pgUniqueViolation {
			writeError(r.Context(), w, http.StatusConflict, "this waypoint or road already has a challenge")
			return
		}
		logger.Error(r.Context(), "failed to insert challenge", map[string]interface{}{"board_id": boardID, "error": err.Error()})
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to insert challenge")
		return
	}

	if targetIsWaypoint {
		_, err = tx.Exec(r.Context(), `
			UPDATE board_waypoints SET challenge_id = $1
			WHERE id = $2 AND board_id = $3 AND board_version = $4
		`, challengeID, waypointID, boardID, version)
	} else {
		_, err = tx.Exec(r.Context(), `
			UPDATE board_roads
			SET challenge_id = $1
			WHERE id = $2 AND board_id = $3 AND board_version = $4
		`, challengeID, waypointID, boardID, version)
	}
	if err != nil {
		logger.Error(r.Context(), "failed to attach challenge to target", map[string]interface{}{"board_id": boardID, "error": err.Error()})
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to attach challenge to target")
		return
	}

	if err := touchBoardDraft(r.Context(), tx, boardID, version); err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to record the board change: "+err.Error())
		return
	}

	if err := tx.Commit(r.Context()); err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to commit challenge add")
		return
	}

	writeJSON(r.Context(), w, http.StatusCreated, challengeCreatedResponse{
		ID:          challengeID,
		BoardID:     boardID,
		WaypointID:  waypointID,
		ChallengeID: challengeID,
	})
}

// handleUpdateChallenge updates a challenge in a draft board.
func (s *Server) handleUpdateChallenge(w http.ResponseWriter, r *http.Request) {
	boardID := chi.URLParam(r, "id")
	challengeID := chi.URLParam(r, "challenge_id")

	var req ChallengeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(r.Context(), w, http.StatusBadRequest, "invalid request body")
		return
	}

	version, err := s.checkDraftState(r, boardID, req.EditToken)
	if err != nil {
		writeError(r.Context(), w, http.StatusForbidden, "forbidden: "+err.Error())
		return
	}

	rubricBytes, err := json.Marshal(req.Rubric)
	if err != nil {
		writeError(r.Context(), w, http.StatusBadRequest, "invalid rubric: "+err.Error())
		return
	}

	tx, err := s.DB.Pool.Begin(r.Context())
	if err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to start transaction")
		return
	}
	defer tx.Rollback(r.Context())
	if err := lockEditableBoardVersion(r.Context(), tx, boardID, version); err != nil {
		if errors.Is(err, errBoardVersionRaced) {
			writeError(r.Context(), w, http.StatusForbidden, err.Error())
		} else {
			writeError(r.Context(), w, http.StatusInternalServerError, "failed to lock editable board: "+err.Error())
		}
		return
	}

	res, err := tx.Exec(r.Context(), `
		UPDATE challenges
		SET prompt = $1, rubric = $2, coin_reward = $3, veto_penalty_seconds = $4
		WHERE id = $5 AND board_id = $6 AND board_version = $7
	`, req.Prompt, rubricBytes, req.CoinReward, req.VetoPenaltySeconds, challengeID, boardID, version)
	if err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to update challenge: "+err.Error())
		return
	}

	if res.RowsAffected() == 0 {
		writeError(r.Context(), w, http.StatusNotFound, "challenge not found")
		return
	}

	if err := touchBoardDraft(r.Context(), tx, boardID, version); err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to record the board change: "+err.Error())
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to commit challenge update: "+err.Error())
		return
	}

	writeJSON(r.Context(), w, http.StatusOK, statusResponse{Status: "updated"})
}

// handleDeleteChallenge deletes a challenge from a draft board.
func (s *Server) handleDeleteChallenge(w http.ResponseWriter, r *http.Request) {
	boardID := chi.URLParam(r, "id")
	challengeID := chi.URLParam(r, "challenge_id")

	tokenFromHeaderOrQuery := r.Header.Get("X-Edit-Token")
	if tokenFromHeaderOrQuery == "" {
		tokenFromHeaderOrQuery = r.URL.Query().Get("edit_token")
	}

	version, err := s.checkDraftState(r, boardID, tokenFromHeaderOrQuery)
	if err != nil {
		writeError(r.Context(), w, http.StatusForbidden, "forbidden: "+err.Error())
		return
	}

	tx, err := s.DB.Pool.Begin(r.Context())
	if err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to start transaction")
		return
	}
	defer tx.Rollback(r.Context())
	if err := lockEditableBoardVersion(r.Context(), tx, boardID, version); err != nil {
		if errors.Is(err, errBoardVersionRaced) {
			writeError(r.Context(), w, http.StatusForbidden, err.Error())
		} else {
			writeError(r.Context(), w, http.StatusInternalServerError, "failed to lock editable board: "+err.Error())
		}
		return
	}

	// Clear foreign references to the challenge from waypoints and roads before deletion.
	for _, table := range []string{"board_waypoints", "board_roads"} {
		if _, err := tx.Exec(r.Context(), `
			UPDATE `+table+`
			SET challenge_id = NULL
			WHERE challenge_id = $1 AND board_id = $2 AND board_version = $3
		`, challengeID, boardID, version); err != nil {
			writeError(r.Context(), w, http.StatusInternalServerError, "failed to detach challenge from "+table+": "+err.Error())
			return
		}
	}

	res, err := tx.Exec(r.Context(), `
		DELETE FROM challenges WHERE id = $1 AND board_id = $2 AND board_version = $3
	`, challengeID, boardID, version)
	if err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to delete challenge")
		return
	}

	if res.RowsAffected() == 0 {
		writeError(r.Context(), w, http.StatusNotFound, "challenge not found")
		return
	}

	if err := touchBoardDraft(r.Context(), tx, boardID, version); err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to record the board change: "+err.Error())
		return
	}

	if err := tx.Commit(r.Context()); err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to commit deletion")
		return
	}

	writeJSON(r.Context(), w, http.StatusOK, statusResponse{Status: "deleted"})
}
