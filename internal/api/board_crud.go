package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
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
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&req); err != nil {
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			writeError(r.Context(), w, http.StatusRequestEntityTooLarge, boardUpdateBodyTooLargeError)
			return
		}
		writeError(r.Context(), w, http.StatusBadRequest, "invalid update payload")
		return
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			writeError(r.Context(), w, http.StatusRequestEntityTooLarge, boardUpdateBodyTooLargeError)
			return
		}
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
	if err := lockEditableBoardVersion(r.Context(), tx, boardID, version); err != nil {
		if errors.Is(err, errBoardVersionRaced) {
			writeError(r.Context(), w, http.StatusForbidden, err.Error())
			return
		}
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to lock editable board: "+err.Error())
		return
	}

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
	waypointIDs := make([]string, len(req.Waypoints))
	waypointsByID := make(map[string]rules.Waypoint, len(req.Waypoints))
	for i, wp := range req.Waypoints {
		id := ensureUUID(wp.ID)
		if id == "" {
			id = uuid.New().String()
		}
		if _, exists := waypointsByID[id]; exists {
			writeError(r.Context(), w, http.StatusBadRequest, fmt.Sprintf("duplicate waypoint id %s", wp.ID))
			return
		}
		waypointIDs[i] = id
		waypointsByID[id] = wp
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
	roadIDs := make([]string, len(req.Roads))
	roadsByID := make(map[string]rules.Road, len(req.Roads))
	for i, road := range req.Roads {
		id := ensureUUID(road.ID)
		if id == "" {
			id = uuid.New().String()
		}
		if _, exists := roadsByID[id]; exists {
			writeError(r.Context(), w, http.StatusBadRequest, fmt.Sprintf("duplicate road id %s", road.ID))
			return
		}
		if road.ChallengeID != "" {
			if _, exists := waypointsByID[id]; exists {
				writeError(r.Context(), w, http.StatusBadRequest, fmt.Sprintf("road and waypoint IDs must be distinct: %s", road.ID))
				return
			}
		}
		roadIDs[i] = id
		roadsByID[id] = road
		validTargetIDs[id] = true
	}
	challengeIDs := make([]string, len(req.Challenges))
	challengesByID := make(map[string]rules.Challenge, len(req.Challenges))
	for i, ch := range req.Challenges {
		id := ensureUUID(ch.ID)
		if id == "" {
			id = uuid.New().String()
		}
		if _, exists := challengesByID[id]; exists {
			writeError(r.Context(), w, http.StatusBadRequest, fmt.Sprintf("duplicate challenge id %s", ch.ID))
			return
		}
		challengeIDs[i] = id
		challengesByID[id] = ch
	}
	challengeOwner := make(map[string]string, len(req.Challenges))
	for i, wp := range req.Waypoints {
		if wp.ChallengeID == "" {
			continue
		}
		wpID := waypointIDs[i]
		challengeID := ensureUUID(wp.ChallengeID)
		ch, exists := challengesByID[challengeID]
		if !exists {
			writeError(r.Context(), w, http.StatusBadRequest, fmt.Sprintf("waypoint %s references missing challenge %s", wp.ID, wp.ChallengeID))
			return
		}
		if target := ensureUUID(ch.WaypointID); target != "" && target != wpID {
			writeError(r.Context(), w, http.StatusBadRequest, fmt.Sprintf("challenge %s targets a different waypoint", wp.ChallengeID))
			return
		}
		if previous, owned := challengeOwner[challengeID]; owned && previous != wpID {
			writeError(r.Context(), w, http.StatusBadRequest, fmt.Sprintf("challenge %s is attached to multiple targets", wp.ChallengeID))
			return
		}
		challengeOwner[challengeID] = wpID
	}
	for i, road := range req.Roads {
		if road.ChallengeID == "" {
			continue
		}
		challengeID := ensureUUID(road.ChallengeID)
		ch, exists := challengesByID[challengeID]
		if !exists {
			writeError(r.Context(), w, http.StatusBadRequest, fmt.Sprintf("road %s references missing challenge %s", road.ID, road.ChallengeID))
			return
		}
		if previous, owned := challengeOwner[challengeID]; owned && previous != roadIDs[i] {
			writeError(r.Context(), w, http.StatusBadRequest, fmt.Sprintf("challenge %s is attached to multiple targets", road.ChallengeID))
			return
		}
		if target := ensureUUID(ch.WaypointID); target != "" && target != roadIDs[i] {
			writeError(r.Context(), w, http.StatusBadRequest, fmt.Sprintf("challenge %s targets a different waypoint or road", road.ChallengeID))
			return
		}
		challengeOwner[challengeID] = roadIDs[i]
		if road.ChallengeID != "" {
			if road.WaypointIDA == "" || road.WaypointIDB == "" {
				writeError(r.Context(), w, http.StatusBadRequest, fmt.Sprintf("road %s has a challenge but is missing an endpoint", road.ID))
				return
			}
			if _, ok := waypointsByID[ensureUUID(road.WaypointIDA)]; !ok {
				writeError(r.Context(), w, http.StatusBadRequest, fmt.Sprintf("road %s references missing endpoint %s", road.ID, road.WaypointIDA))
				return
			}
			if _, ok := waypointsByID[ensureUUID(road.WaypointIDB)]; !ok {
				writeError(r.Context(), w, http.StatusBadRequest, fmt.Sprintf("road %s references missing endpoint %s", road.ID, road.WaypointIDB))
				return
			}
		}
	}
	challengeTargets := make(map[string]bool, len(req.Challenges))
	challengeWaypointIDs := make(map[string]string, len(req.Challenges))
	for i, ch := range req.Challenges {
		chID := challengeIDs[i]
		chTargetID := ensureUUID(ch.WaypointID)
		if finishWaypointIDs[chTargetID] {
			writeError(r.Context(), w, http.StatusBadRequest, "the finish line carries no challenge: remove the challenge attached to the finish waypoint")
			return
		}
		if chTargetID != "" && !validTargetIDs[chTargetID] {
			writeError(r.Context(), w, http.StatusBadRequest, fmt.Sprintf("challenge %s references non-existent waypoint or road %s", ch.ID, ch.WaypointID))
			return
		}
		if road, isRoad := roadsByID[chTargetID]; isRoad {
			if ensureUUID(road.ChallengeID) != chID {
				writeError(r.Context(), w, http.StatusBadRequest, fmt.Sprintf("challenge %s targets road %s but is not linked by that road", ch.ID, ch.WaypointID))
				return
			}
			chTargetID = "" // road challenges use NULL waypoint_id
		}
		if wp, isWaypoint := waypointsByID[chTargetID]; chTargetID != "" && isWaypoint && wp.ChallengeID != "" && ensureUUID(wp.ChallengeID) != chID {
			writeError(r.Context(), w, http.StatusBadRequest, fmt.Sprintf("challenge %s conflicts with the waypoint challenge reference", ch.ID))
			return
		}
		if ownerID, owned := challengeOwner[chID]; owned {
			if _, isWaypoint := waypointsByID[ownerID]; isWaypoint {
				if chTargetID != "" && chTargetID != ownerID {
					writeError(r.Context(), w, http.StatusBadRequest, fmt.Sprintf("challenge %s conflicts with its waypoint reference", ch.ID))
					return
				}
				chTargetID = ownerID
			} else {
				if chTargetID != "" {
					writeError(r.Context(), w, http.StatusBadRequest, fmt.Sprintf("challenge %s conflicts with its road reference", ch.ID))
					return
				}
			}
		}
		// NULL targets are retained for road challenges attached through their
		// board_roads.challenge_id reference. A concrete waypoint target may only
		// have one challenge in a board version.
		if chTargetID != "" && challengeTargets[chTargetID] {
			writeError(r.Context(), w, http.StatusBadRequest, fmt.Sprintf("multiple challenges target waypoint or road %s", chTargetID))
			return
		}
		if chTargetID != "" {
			challengeTargets[chTargetID] = true
		}
		challengeWaypointIDs[chID] = chTargetID
	}

	for i, wp := range req.Waypoints {
		wpID := waypointIDs[i]
		if math.IsNaN(wp.Lat) || math.IsInf(wp.Lat, 0) || math.IsNaN(wp.Lon) || math.IsInf(wp.Lon, 0) ||
			wp.Lat < -90 || wp.Lat > 90 || wp.Lon < -180 || wp.Lon > 180 {
			writeError(r.Context(), w, http.StatusBadRequest, fmt.Sprintf(
				"waypoint %s has invalid coordinates; latitude must be between -90 and 90 and longitude between -180 and 180",
				wp.Name))
			return
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

	for i, road := range req.Roads {
		wpA := ensureUUID(road.WaypointIDA)
		wpB := ensureUUID(road.WaypointIDB)
		if wpA == "" || wpB == "" {
			logger.Warn(r.Context(), "skipping road with missing waypoint endpoint", map[string]interface{}{"road_id": road.ID})
			continue
		}
		roadID := roadIDs[i]
		var challengeIDNull *string
		if road.ChallengeID != "" {
			cid := ensureUUID(road.ChallengeID)
			challengeIDNull = &cid
		}
		_, err = tx.Exec(r.Context(), `
			INSERT INTO board_roads (id, board_id, board_version, waypoint_id_a, waypoint_id_b, length_m, challenge_id)
			VALUES ($1, $2, $3, $4, $5, $6, $7)
		`, roadID, boardID, version, wpA, wpB, road.LengthM, challengeIDNull)
		if err != nil {
			logger.Error(r.Context(), "failed to insert road", map[string]interface{}{"road_id": road.ID, "error": err.Error()})
			writeError(r.Context(), w, http.StatusInternalServerError, "failed to insert road "+road.ID+": "+err.Error())
			return
		}
	}

	for i, ch := range req.Challenges {
		chID := challengeIDs[i]
		waypointID := challengeWaypointIDs[chID]
		var challengeWaypointID *string
		if waypointID != "" {
			challengeWaypointID = &waypointID
		}
		rubricJSON, err := json.Marshal(ch.Rubric)
		if err != nil {
			writeError(r.Context(), w, http.StatusBadRequest, "invalid rubric on challenge "+ch.ID+": "+err.Error())
			return
		}
		_, err = tx.Exec(r.Context(), `
			INSERT INTO challenges (id, board_id, board_version, waypoint_id, prompt, rubric, coin_reward, veto_penalty_seconds)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		`, chID, boardID, version, challengeWaypointID, ch.Prompt, rubricJSON, ch.CoinReward, ch.VetoPenaltySeconds)
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
		if pu.Cost < 0 {
			writeError(r.Context(), w, http.StatusBadRequest, fmt.Sprintf("power-up %s cost cannot be negative", pu.ID))
			return
		}
		if pu.DurationS < 0 || pu.DurationS > rules.MaxPowerupDurationSeconds {
			writeError(r.Context(), w, http.StatusBadRequest, fmt.Sprintf(
				"power-up %s duration_s must be between 0 and %d", pu.ID, rules.MaxPowerupDurationSeconds))
			return
		}
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

	if authorized, limited := s.isAdminAuthorized(r); !authorized {
		if err := s.authorizeBoardEdit(r.Context(), boardID, bearerToken(r)); err != nil {
			if limited {
				writeAdminAuthFailure(w, r, true, err.Error())
			} else {
				writeError(r.Context(), w, http.StatusForbidden, err.Error())
			}
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

	isAdmin, limited := s.isAdminAuthorized(r)
	if !isAdmin {
		if err := s.authorizeBoardEdit(r.Context(), boardID, bearerToken(r)); err != nil {
			if limited {
				writeAdminAuthFailure(w, r, true, err.Error())
			} else {
				writeError(r.Context(), w, http.StatusForbidden, err.Error())
			}
			return
		}
	}

	tx, err := s.DB.Pool.Begin(r.Context())
	if err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to start transaction")
		return
	}
	defer tx.Rollback(r.Context())

	// Lock every version before checking references so a race launch cannot pin a
	// version between the reference check and its deletion.
	rows, err := tx.Query(r.Context(), `
		SELECT version FROM boards WHERE id = $1 ORDER BY version FOR UPDATE
	`, boardID)
	if err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to lock board versions: "+err.Error())
		return
	}
	var versions []int
	for rows.Next() {
		var version int
		if err := rows.Scan(&version); err != nil {
			rows.Close()
			writeError(r.Context(), w, http.StatusInternalServerError, "failed to read board versions: "+err.Error())
			return
		}
		versions = append(versions, version)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to read board versions: "+err.Error())
		return
	}
	rows.Close()
	if len(versions) == 0 {
		writeError(r.Context(), w, http.StatusNotFound, "board not found")
		return
	}

	if err := clearUnreferencedBoardVersions(r.Context(), tx, boardID); err != nil {
		logger.Error(r.Context(), "failed to delete board children", map[string]interface{}{"board_id": boardID, "error": err.Error()})
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to delete board: "+err.Error())
		return
	}

	res, err := tx.Exec(r.Context(), `
		DELETE FROM boards b
		WHERE b.id = $1
		  AND b.is_snapshot = FALSE
		  AND NOT EXISTS (
			  SELECT 1 FROM games g
			  WHERE g.board_id = b.id AND g.board_version = b.version
		  )
	`, boardID)
	if err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to delete board: "+err.Error())
		return
	}

	if err := tx.Commit(r.Context()); err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to commit deletion")
		return
	}

	if res.RowsAffected() == 0 && len(versions) > 0 {
		writeError(r.Context(), w, http.StatusConflict, "board versions used by or awaiting races were preserved")
		return
	}

	writeJSON(r.Context(), w, http.StatusOK, boardDeletedResponse{ID: boardID, Deleted: true})
}
