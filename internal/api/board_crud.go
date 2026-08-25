package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v4"

	"github.com/Jessevdz/RunwayTheGame/internal/logger"
	"github.com/Jessevdz/RunwayTheGame/internal/projections"
	"github.com/Jessevdz/RunwayTheGame/internal/rules"
)

// boardCreatedResponse answers a draft creation. It is the one time the edit
// token is returned, so the client has to keep it.
type boardCreatedResponse struct {
	ID        string `json:"id"`
	Version   int    `json:"version"`
	Name      string `json:"name"`
	Status    string `json:"status"`
	IsListed  bool   `json:"is_listed"`
	EditToken string `json:"edit_token"`
}

// boardEnvelope carries a board plus the gallery and launcher metadata that is
// stored on the board row rather than in the design itself.
type boardEnvelope struct {
	Board                rules.Board `json:"board"`
	RecommendedTeamCount int         `json:"recommended_team_count"`
	IsListed             bool        `json:"is_listed"`
}

// BoardVisibilityRequest represents the payload for toggling board visibility in the gallery.
type BoardVisibilityRequest struct {
	IsListed bool `json:"is_listed"`
}

// boardVisibilityResponse echoes the listing state the board now has.
type boardVisibilityResponse struct {
	ID       string `json:"id"`
	IsListed bool   `json:"is_listed"`
}

// boardDeletedResponse confirms a board and its child rows are gone.
type boardDeletedResponse struct {
	ID      string `json:"id"`
	Deleted bool   `json:"deleted"`
}

// handleCreateBoard creates a new private draft board with an edit capability token.
func (s *Server) handleCreateBoard(w http.ResponseWriter, r *http.Request) {
	var req BoardCreateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil && err.Error() != "EOF" {
		writeError(r.Context(), w, http.StatusBadRequest, "invalid request body")
		return
	}

	boardID := uuid.New().String()
	editToken := uuid.New().String()
	version := 1

	if req.Name == "" {
		req.Name = "Untitled Map"
	}

	_, err := s.DB.Pool.Exec(r.Context(), `
		INSERT INTO boards (id, version, name, edit_token_hash, is_listed)
		VALUES ($1, $2, $3, $4, FALSE)
	`, boardID, version, req.Name, hashToken(editToken))
	if err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to create board draft: "+err.Error())
		return
	}

	writeJSON(r.Context(), w, http.StatusCreated, boardCreatedResponse{
		ID:        boardID,
		Version:   version,
		Name:      req.Name,
		Status:    "draft",
		IsListed:  false,
		EditToken: editToken,
	})
}

// handleGetBoardDefault fetches version 1 of a board by default.
func (s *Server) handleGetBoardDefault(w http.ResponseWriter, r *http.Request) {
	s.fetchAndWriteBoard(w, r, 1)
}

// handleGetBoard fetches a specific board version.
func (s *Server) handleGetBoard(w http.ResponseWriter, r *http.Request) {
	versionStr := chi.URLParam(r, "version")
	version, err := strconv.Atoi(versionStr)
	if err != nil {
		writeError(r.Context(), w, http.StatusBadRequest, "invalid version param")
		return
	}
	s.fetchAndWriteBoard(w, r, version)
}

func (s *Server) fetchAndWriteBoard(w http.ResponseWriter, r *http.Request, version int) {
	boardID := chi.URLParam(r, "id")

	board, err := projections.LoadBoard(r.Context(), s.DB.Pool, boardID, version)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(r.Context(), w, http.StatusNotFound, "board not found")
			return
		}
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to load board: "+err.Error())
		return
	}

	// Attach gallery listing metadata to response envelope.
	var isListed bool
	if err := s.DB.Pool.QueryRow(r.Context(), "SELECT is_listed FROM boards WHERE id = $1 AND version = $2", boardID, version).Scan(&isListed); err != nil {
		logger.Warn(r.Context(), "failed to read board listing state", map[string]interface{}{"board_id": boardID, "error": err.Error()})
	}

	recTeams := 2
	waypointsHeuristic := len(board.Waypoints) / 10
	if waypointsHeuristic > recTeams {
		recTeams = waypointsHeuristic
	}
	if recTeams < 2 {
		recTeams = 2
	}

	writeJSON(r.Context(), w, http.StatusOK, boardEnvelope{
		Board:                board,
		RecommendedTeamCount: recTeams,
		IsListed:             isListed,
	})
}

// handleUpdateBoard modifies waypoints, roads, challenges, decks, and rulesets atomically in a draft board.
func (s *Server) handleUpdateBoard(w http.ResponseWriter, r *http.Request) {
	boardID := chi.URLParam(r, "id")
	version := 1 // design flow works on version 1

	var req BoardUpdateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(r.Context(), w, http.StatusBadRequest, "invalid update payload")
		return
	}

	if err := s.authorizeBoardEdit(r.Context(), boardID, bearerToken(r)); err != nil {
		writeError(r.Context(), w, http.StatusForbidden, err.Error())
		return
	}

	// Publishing no longer freezes the design: a race pins a frozen snapshot of
	// its own, so only a version some game is actually pinned to is off limits.
	if err := s.requireEditableBoardVersion(r.Context(), boardID, version); err != nil {
		if errors.Is(err, errBoardVersionRaced) {
			writeError(r.Context(), w, http.StatusForbidden, err.Error())
			return
		}
		writeError(r.Context(), w, http.StatusInternalServerError, err.Error())
		return
	}

	tx, err := s.DB.Pool.Begin(r.Context())
	if err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to start transaction")
		return
	}
	defer tx.Rollback(r.Context())

	// Clear existing configuration
	if err := clearBoardVersion(r.Context(), tx, boardID, version); err != nil {
		logger.Error(r.Context(), "failed to clear board configuration", map[string]interface{}{"board_id": boardID, "error": err.Error()})
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to clear board configuration: "+err.Error())
		return
	}

	// Gallery listing is untouched by a save, but the publish validation is: the
	// design just changed, so the road lengths and checks it produced are stale.
	nameToUpdate := req.Name
	if nameToUpdate == "" {
		nameToUpdate = "Untitled Map"
	}
	_, err = tx.Exec(r.Context(), "UPDATE boards SET name = $1, updated_at = NOW(), published_at = NULL WHERE id = $2 AND version = $3", nameToUpdate, boardID, version)
	if err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to update board name")
		return
	}

	// Finish line waypoints carry no challenges or coin rewards.
	finishWaypointIDs := make(map[string]bool)
	validTargetIDs := make(map[string]bool)
	for _, wp := range req.Waypoints {
		id := ensureUUID(wp.ID)
		if id == "" {
			continue
		}
		if wp.IsFinish {
			if wp.ChallengeID != "" {
				writeError(r.Context(), w, http.StatusBadRequest, fmt.Sprintf(
					"waypoint %s (%s) is the finish; the finish line carries no challenge, so it cannot reference a challenge",
					wp.ID, wp.Name))
				return
			}
			finishWaypointIDs[id] = true
		} else {
			validTargetIDs[id] = true
		}
	}
	for _, road := range req.Roads {
		if id := ensureUUID(road.ID); id != "" {
			validTargetIDs[id] = true
		}
	}
	for _, ch := range req.Challenges {
		chTargetID := ensureUUID(ch.WaypointID)
		if finishWaypointIDs[chTargetID] {
			writeError(r.Context(), w, http.StatusBadRequest, "the finish line carries no challenge: remove the challenge attached to the finish waypoint")
			return
		}
		if chTargetID != "" && !validTargetIDs[chTargetID] {
			writeError(r.Context(), w, http.StatusBadRequest, fmt.Sprintf("challenge %s references non-existent waypoint or road %s", ch.ID, ch.WaypointID))
			return
		}
	}

	for _, wp := range req.Waypoints {
		wpID := ensureUUID(wp.ID)
		if wpID == "" {
			wpID = uuid.New().String()
		}
		// Validate arrival radius boundaries before storing unauthenticated input.
		if wp.ArrivalRadiusM != 0 &&
			(wp.ArrivalRadiusM < rules.MinArrivalRadiusM || wp.ArrivalRadiusM > rules.MaxArrivalRadiusM) {
			writeError(r.Context(), w, http.StatusBadRequest, fmt.Sprintf(
				"waypoint %s has an arrival radius of %.0f m; it must be between %.0f m and %.0f m",
				wp.Name, wp.ArrivalRadiusM, rules.MinArrivalRadiusM, rules.MaxArrivalRadiusM))
			return
		}
		// An omitted radius stores the default rather than a literal 0, which is
		// what the column's range constraint expects.
		arrivalRadiusM := rules.ClampArrivalRadiusM(wp.ArrivalRadiusM)
		var challengeIDNull *string
		if wp.ChallengeID != "" {
			cid := ensureUUID(wp.ChallengeID)
			if cid != "" {
				challengeIDNull = &cid
			}
		}
		_, err = tx.Exec(r.Context(), `
			INSERT INTO board_waypoints (id, board_id, board_version, name, location, arrival_radius_m, is_start, is_finish, challenge_id)
			VALUES ($1, $2, $3, $4, ST_GeomFromText($5, 4326), $6, $7, $8, $9)
		`, wpID, boardID, version, wp.Name, fmtWKTPoint(wp.Lon, wp.Lat), arrivalRadiusM, wp.IsStart, wp.IsFinish, challengeIDNull)
		if err != nil {
			logger.Error(r.Context(), "failed to insert waypoint", map[string]interface{}{"waypoint_id": wp.ID, "error": err.Error()})
			writeError(r.Context(), w, http.StatusInternalServerError, "failed to insert waypoint "+wp.ID+": "+err.Error())
			return
		}
	}

	for _, road := range req.Roads {
		wpA := ensureUUID(road.WaypointIDA)
		wpB := ensureUUID(road.WaypointIDB)
		if wpA == "" || wpB == "" {
			logger.Warn(r.Context(), "skipping road with missing waypoint endpoint", map[string]interface{}{"road_id": road.ID})
			continue
		}
		roadID := ensureUUID(road.ID)
		if roadID == "" {
			roadID = uuid.New().String()
		}
		_, err = tx.Exec(r.Context(), `
			INSERT INTO board_roads (id, board_id, board_version, waypoint_id_a, waypoint_id_b, length_m)
			VALUES ($1, $2, $3, $4, $5, $6)
		`, roadID, boardID, version, wpA, wpB, road.LengthM)
		if err != nil {
			logger.Error(r.Context(), "failed to insert road", map[string]interface{}{"road_id": road.ID, "error": err.Error()})
			writeError(r.Context(), w, http.StatusInternalServerError, "failed to insert road "+road.ID+": "+err.Error())
			return
		}
	}

	for _, ch := range req.Challenges {
		chID := ensureUUID(ch.ID)
		if chID == "" {
			chID = uuid.New().String()
		}
		waypointID := ensureUUID(ch.WaypointID)
		rubricJSON, err := json.Marshal(ch.Rubric)
		if err != nil {
			writeError(r.Context(), w, http.StatusBadRequest, "invalid rubric on challenge "+ch.ID+": "+err.Error())
			return
		}
		_, err = tx.Exec(r.Context(), `
			INSERT INTO challenges (id, board_id, board_version, waypoint_id, prompt, rubric, coin_reward, veto_penalty_seconds)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		`, chID, boardID, version, waypointID, ch.Prompt, rubricJSON, ch.CoinReward, ch.VetoPenaltySeconds)
		if err != nil {
			logger.Error(r.Context(), "failed to insert challenge", map[string]interface{}{"challenge_id": ch.ID, "error": err.Error()})
			writeError(r.Context(), w, http.StatusInternalServerError, "failed to insert challenge "+ch.ID+": "+err.Error())
			return
		}
	}

	if err := insertDeckCards(r.Context(), tx, "board_roadblock_cards", boardID, version, req.RoadblockCards); err != nil {
		logger.Error(r.Context(), "failed to insert roadblock card", map[string]interface{}{"error": err.Error()})
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to insert roadblock card: "+err.Error())
		return
	}

	if err := insertDeckCards(r.Context(), tx, "board_curse_cards", boardID, version, req.CurseCards); err != nil {
		logger.Error(r.Context(), "failed to insert curse card", map[string]interface{}{"error": err.Error()})
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to insert curse card: "+err.Error())
		return
	}

	// Fall back to default powerups and costs when powerups are omitted.
	powerups := req.Powerups
	if len(powerups) == 0 {
		costs := req.PowerupCosts
		if len(costs) == 0 {
			costs = rules.DefaultRuleset().PowerupCosts
		}
		for _, pu := range rules.DefaultPowerups() {
			if cost, ok := costs[pu.ID]; ok {
				pu.Cost = cost
			}
			powerups = append(powerups, pu)
		}
	}
	for i, pu := range powerups {
		if pu.ID == "" {
			pu.ID = uuid.New().String()
		}
		if pu.Effect == "" {
			pu.Effect = "generic"
		}
		_, err = tx.Exec(r.Context(), `
			INSERT INTO board_powerups (board_id, board_version, id, icon, name, description, cost, duration_s, effect, sort_order)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
			ON CONFLICT (board_id, board_version, id) DO NOTHING
		`, boardID, version, pu.ID, pu.Icon, pu.Name, pu.Description, pu.Cost, pu.DurationS, pu.Effect, i)
		if err != nil {
			writeError(r.Context(), w, http.StatusInternalServerError, "failed to insert powerup: "+err.Error())
			return
		}
		// Keep the derived cost view in sync for engine/publish readers.
		_, err = tx.Exec(r.Context(), `
			INSERT INTO board_powerup_costs (board_id, board_version, powerup, cost)
			VALUES ($1, $2, $3, $4)
			ON CONFLICT (board_id, board_version, powerup) DO UPDATE SET cost = EXCLUDED.cost
		`, boardID, version, pu.ID, pu.Cost)
		if err != nil {
			writeError(r.Context(), w, http.StatusInternalServerError, "failed to insert powerup cost: "+err.Error())
			return
		}
	}

	if err := tx.Commit(r.Context()); err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to commit update")
		return
	}

	writeJSON(r.Context(), w, http.StatusOK, statusResponse{Status: "updated"})
}

// handleSetBoardVisibility updates a board's gallery listing status using an admin key or board edit token.
func (s *Server) handleSetBoardVisibility(w http.ResponseWriter, r *http.Request) {
	boardID := chi.URLParam(r, "id")
	if boardID == "" {
		writeError(r.Context(), w, http.StatusBadRequest, "board id required")
		return
	}

	if !s.isAdminAuthorized(r) {
		if err := s.authorizeBoardEdit(r.Context(), boardID, bearerToken(r)); err != nil {
			writeError(r.Context(), w, http.StatusForbidden, err.Error())
			return
		}
	}

	var req BoardVisibilityRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(r.Context(), w, http.StatusBadRequest, "invalid request body")
		return
	}

	res, err := s.DB.Pool.Exec(r.Context(), "UPDATE boards SET is_listed = $1, updated_at = NOW() WHERE id = $2 AND version = 1", req.IsListed, boardID)
	if err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to update board visibility: "+err.Error())
		return
	}
	if res.RowsAffected() == 0 {
		writeError(r.Context(), w, http.StatusNotFound, "board not found")
		return
	}

	writeJSON(r.Context(), w, http.StatusOK, boardVisibilityResponse{ID: boardID, IsListed: req.IsListed})
}

// handleDeleteBoard removes a board and its child records. Requires admin key or edit token.
func (s *Server) handleDeleteBoard(w http.ResponseWriter, r *http.Request) {
	boardID := chi.URLParam(r, "id")
	if boardID == "" {
		writeError(r.Context(), w, http.StatusBadRequest, "board id required")
		return
	}

	isAdmin := s.isAdminAuthorized(r)
	if !isAdmin {
		if err := s.authorizeBoardEdit(r.Context(), boardID, bearerToken(r)); err != nil {
			writeError(r.Context(), w, http.StatusForbidden, err.Error())
			return
		}
	}

	tx, err := s.DB.Pool.Begin(r.Context())
	if err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to start transaction")
		return
	}
	defer tx.Rollback(r.Context())

	if err := clearBoardAllVersions(r.Context(), tx, boardID); err != nil {
		logger.Error(r.Context(), "failed to delete board children", map[string]interface{}{"board_id": boardID, "error": err.Error()})
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to delete board: "+err.Error())
		return
	}

	res, err := tx.Exec(r.Context(), "DELETE FROM boards WHERE id = $1", boardID)
	if err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to delete board: "+err.Error())
		return
	}

	if res.RowsAffected() == 0 {
		writeError(r.Context(), w, http.StatusNotFound, "board not found")
		return
	}

	if err := tx.Commit(r.Context()); err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to commit deletion")
		return
	}

	writeJSON(r.Context(), w, http.StatusOK, boardDeletedResponse{ID: boardID, Deleted: true})
}
