package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v4"
	"github.com/jackc/pgx/v4/pgxpool"

	"github.com/Jessevdz/RunwayTheGame/internal/logger"
	"github.com/Jessevdz/RunwayTheGame/internal/projections"
	"github.com/Jessevdz/RunwayTheGame/internal/rules"
)

// idListLimit is the maximum number of board IDs allowed in a single request filter.
const idListLimit = 100

// BoardSummary is one card in the gallery listing.
type BoardSummary struct {
	ID            string        `json:"id"`
	Name          string        `json:"name"`
	UpdatedAt     time.Time     `json:"updated_at"`
	IsListed      bool          `json:"is_listed"`
	WaypointCount int           `json:"waypoint_count"`
	Preview       *BoardPreview `json:"preview,omitempty"`
}

// handleListBoards returns summary cards for listed public boards or specific IDs specified by query parameter.
func (s *Server) handleListBoards(w http.ResponseWriter, r *http.Request) {
	isAdmin := s.isAdminAuthorized(r)
	showAll := isAdmin && (r.URL.Query().Get("all") == "true" || r.URL.Query().Get("include_unlisted") == "true")

	var ids []string
	if raw := r.URL.Query().Get("ids"); raw != "" {
		for _, part := range strings.Split(raw, ",") {
			// Require strictly formatted UUIDs so malformed IDs are ignored rather than hashed.
			if parsed, err := uuid.Parse(strings.TrimSpace(part)); err == nil {
				ids = append(ids, parsed.String())
			}
			if len(ids) >= idListLimit {
				break
			}
		}
		// Return an empty list if all provided IDs were invalid.
		if len(ids) == 0 {
			writeJSON(r.Context(), w, http.StatusOK, []BoardSummary{})
			return
		}
	}

	query := `
		SELECT b.id, b.name, b.updated_at, b.is_listed,
		       (SELECT COUNT(*) FROM board_waypoints w WHERE w.board_id = b.id AND w.board_version = b.version) as waypoint_count
		FROM boards b
		WHERE b.version = 1`
	args := []interface{}{}
	if len(ids) > 0 {
		query += ` AND b.id = ANY($1)`
		args = append(args, ids)
	} else if !showAll {
		query += ` AND b.is_listed = TRUE`
	}
	query += ` ORDER BY b.updated_at DESC LIMIT 100`

	rows, err := s.DB.Pool.Query(r.Context(), query, args...)
	if err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to list boards: "+err.Error())
		return
	}
	defer rows.Close()

	summaries := make([]BoardSummary, 0)
	for rows.Next() {
		var summary BoardSummary
		if err := rows.Scan(&summary.ID, &summary.Name, &summary.UpdatedAt, &summary.IsListed, &summary.WaypointCount); err == nil {
			summaries = append(summaries, summary)
		}
	}

	previewIDs := make([]string, 0, len(summaries))
	for _, summary := range summaries {
		previewIDs = append(previewIDs, summary.ID)
	}

	previews, err := loadBoardPreviews(r.Context(), s.DB.Pool, previewIDs)
	if err != nil {
		// Log preview loading failures without failing the summary listing.
		logger.Warn(r.Context(), "failed to load board previews", map[string]interface{}{"error": err.Error()})
	} else {
		for i := range summaries {
			if preview, ok := previews[summaries[i].ID]; ok {
				summaries[i].Preview = preview
			}
		}
	}

	writeJSON(r.Context(), w, http.StatusOK, summaries)
}

// BoardPreviewPoint represents waypoint coordinates and flags required for thumbnail rendering.
type BoardPreviewPoint struct {
	Lat      float64 `json:"lat"`
	Lon      float64 `json:"lon"`
	IsStart  bool    `json:"is_start"`
	IsFinish bool    `json:"is_finish"`
}

// BoardPreview carries route geometry for card thumbnails using index-based road references.
type BoardPreview struct {
	Waypoints []BoardPreviewPoint `json:"waypoints"`
	Roads     [][2]int            `json:"roads"`
}

// previewWaypointLimit caps the number of waypoints included in a board preview.
const previewWaypointLimit = 80

// loadBoardPreviews fetches route geometry for many boards in two queries,
// keyed by board ID. Boards with no waypoints are absent from the result.
func loadBoardPreviews(ctx context.Context, pool *pgxpool.Pool, boardIDs []string) (map[string]*BoardPreview, error) {
	previews := make(map[string]*BoardPreview)
	if len(boardIDs) == 0 {
		return previews, nil
	}

	// Index of each waypoint within its own board's slice, for road lookup.
	indexByWaypoint := make(map[string]int)

	wpRows, err := pool.Query(ctx, `
		SELECT board_id, id, ST_Y(location::geometry), ST_X(location::geometry), is_start, is_finish
		FROM board_waypoints
		WHERE board_id = ANY($1) AND board_version = 1
		ORDER BY board_id, is_start DESC, is_finish, id
	`, boardIDs)
	if err != nil {
		return nil, fmt.Errorf("failed to load preview waypoints: %w", err)
	}
	defer wpRows.Close()

	for wpRows.Next() {
		var boardID, waypointID string
		var point BoardPreviewPoint
		if err := wpRows.Scan(&boardID, &waypointID, &point.Lat, &point.Lon, &point.IsStart, &point.IsFinish); err != nil {
			continue
		}
		preview, ok := previews[boardID]
		if !ok {
			preview = &BoardPreview{Waypoints: []BoardPreviewPoint{}, Roads: [][2]int{}}
			previews[boardID] = preview
		}
		if len(preview.Waypoints) >= previewWaypointLimit {
			continue
		}
		indexByWaypoint[waypointID] = len(preview.Waypoints)
		preview.Waypoints = append(preview.Waypoints, point)
	}
	if err := wpRows.Err(); err != nil {
		return nil, fmt.Errorf("failed to read preview waypoints: %w", err)
	}

	roadRows, err := pool.Query(ctx, `
		SELECT board_id, waypoint_id_a, waypoint_id_b
		FROM board_roads
		WHERE board_id = ANY($1) AND board_version = 1
	`, boardIDs)
	if err != nil {
		return nil, fmt.Errorf("failed to load preview roads: %w", err)
	}
	defer roadRows.Close()

	for roadRows.Next() {
		var boardID, waypointA, waypointB string
		if err := roadRows.Scan(&boardID, &waypointA, &waypointB); err != nil {
			continue
		}
		preview, ok := previews[boardID]
		if !ok {
			continue
		}
		// Either endpoint may have fallen outside previewWaypointLimit.
		indexA, okA := indexByWaypoint[waypointA]
		indexB, okB := indexByWaypoint[waypointB]
		if !okA || !okB {
			continue
		}
		preview.Roads = append(preview.Roads, [2]int{indexA, indexB})
	}
	if err := roadRows.Err(); err != nil {
		return nil, fmt.Errorf("failed to read preview roads: %w", err)
	}

	return previews, nil
}

// boardForkResponse answers a fork with the copy's ID and its own edit token.
type boardForkResponse struct {
	ID        string `json:"id"`
	EditToken string `json:"edit_token"`
	Name      string `json:"name"`
}

// handleForkBoard creates a deep copy of a board with a new ID and edit capability token.
func (s *Server) handleForkBoard(w http.ResponseWriter, r *http.Request) {
	srcID := chi.URLParam(r, "id")
	srcBoard, err := projections.LoadBoard(r.Context(), s.DB.Pool, srcID, 1)
	if err != nil {
		writeError(r.Context(), w, http.StatusNotFound, "source board not found")
		return
	}

	newID := uuid.New().String()
	newEditToken := uuid.New().String()
	newName := srcBoard.Name + " (Fork)"

	tx, err := s.DB.Pool.Begin(r.Context())
	if err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to start transaction")
		return
	}
	defer tx.Rollback(r.Context())

	// Forked boards default to unlisted.
	_, err = tx.Exec(r.Context(), `
		INSERT INTO boards (id, version, name, edit_token_hash, is_listed)
		VALUES ($1, 1, $2, $3, FALSE)
	`, newID, newName, hashToken(newEditToken))
	if err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to create forked board: "+err.Error())
		return
	}

	wpMap := make(map[string]string)
	for _, wp := range srcBoard.Waypoints {
		newWpID := uuid.New().String()
		wpMap[wp.ID] = newWpID
		var newChallengeID *string

		// Omit finish line challenges during copy.
		if wp.ChallengeID != "" && !wp.IsFinish {
			challengeID, err := copyWaypointChallenge(r.Context(), tx, srcBoard, wp, newID, newWpID)
			if err != nil {
				writeError(r.Context(), w, http.StatusInternalServerError, "failed to copy challenge: "+err.Error())
				return
			}
			newChallengeID = challengeID
		}

		_, err = tx.Exec(r.Context(), `
			INSERT INTO board_waypoints (id, board_id, board_version, name, location, arrival_radius_m, is_start, is_finish, challenge_id)
			VALUES ($1, $2, 1, $3, ST_GeomFromText($4, 4326), $5, $6, $7, $8)
		`, newWpID, newID, wp.Name, fmtWKTPoint(wp.Lon, wp.Lat), wp.ArrivalRadiusM, wp.IsStart, wp.IsFinish, newChallengeID)
		if err != nil {
			writeError(r.Context(), w, http.StatusInternalServerError, "failed to copy waypoint: "+err.Error())
			return
		}
	}

	for _, road := range srcBoard.Roads {
		newRoadID := uuid.New().String()
		newA, okA := wpMap[road.WaypointIDA]
		newB, okB := wpMap[road.WaypointIDB]
		if !okA || !okB {
			continue
		}

		_, err = tx.Exec(r.Context(), `
			INSERT INTO board_roads (id, board_id, board_version, waypoint_id_a, waypoint_id_b, length_m)
			VALUES ($1, $2, 1, $3, $4, $5)
		`, newRoadID, newID, newA, newB, road.LengthM)
		if err != nil {
			writeError(r.Context(), w, http.StatusInternalServerError, "failed to copy road: "+err.Error())
			return
		}
	}

	// The copies get fresh card IDs; only the text carries over.
	for _, card := range srcBoard.RoadblockDeck {
		_, err = tx.Exec(r.Context(), "INSERT INTO board_roadblock_cards (id, board_id, board_version, text) VALUES ($1, $2, 1, $3)", uuid.New().String(), newID, card.Text)
		if err != nil {
			writeError(r.Context(), w, http.StatusInternalServerError, "failed to copy roadblock card: "+err.Error())
			return
		}
	}

	for _, card := range srcBoard.CurseDeck {
		_, err = tx.Exec(r.Context(), "INSERT INTO board_curse_cards (id, board_id, board_version, text) VALUES ($1, $2, 1, $3)", uuid.New().String(), newID, card.Text)
		if err != nil {
			writeError(r.Context(), w, http.StatusInternalServerError, "failed to copy curse card: "+err.Error())
			return
		}
	}

	for i, pu := range srcBoard.Powerups {
		_, err = tx.Exec(r.Context(), `
			INSERT INTO board_powerups (board_id, board_version, id, icon, name, description, cost, duration_s, effect, sort_order)
			VALUES ($1, 1, $2, $3, $4, $5, $6, $7, $8, $9)
		`, newID, pu.ID, pu.Icon, pu.Name, pu.Description, pu.Cost, pu.DurationS, pu.Effect, i)
		if err != nil {
			writeError(r.Context(), w, http.StatusInternalServerError, "failed to copy powerup: "+err.Error())
			return
		}
	}

	for pu, cost := range srcBoard.PowerupCosts {
		_, err = tx.Exec(r.Context(), "INSERT INTO board_powerup_costs (board_id, board_version, powerup, cost) VALUES ($1, 1, $2, $3)", newID, pu, cost)
		if err != nil {
			writeError(r.Context(), w, http.StatusInternalServerError, "failed to copy powerup cost: "+err.Error())
			return
		}
	}

	if err := tx.Commit(r.Context()); err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to commit fork: "+err.Error())
		return
	}

	writeJSON(r.Context(), w, http.StatusCreated, boardForkResponse{
		ID:        newID,
		EditToken: newEditToken,
		Name:      newName,
	})
}

// copyWaypointChallenge copies the challenge gating one waypoint into the forked
// board and returns its new ID, or nil when the source waypoint has none.
func copyWaypointChallenge(ctx context.Context, tx pgx.Tx, srcBoard rules.Board, wp rules.Waypoint, newBoardID, newWaypointID string) (*string, error) {
	for _, ch := range srcBoard.Challenges {
		if ch.ID != wp.ChallengeID && ch.WaypointID != wp.ID {
			continue
		}
		chID := uuid.New().String()
		rubricJSON, err := json.Marshal(ch.Rubric)
		if err != nil {
			return nil, err
		}
		_, err = tx.Exec(ctx, `
			INSERT INTO challenges (id, board_id, board_version, waypoint_id, prompt, rubric, coin_reward, veto_penalty_seconds)
			VALUES ($1, $2, 1, $3, $4, $5, $6, $7)
		`, chID, newBoardID, newWaypointID, ch.Prompt, rubricJSON, ch.CoinReward, ch.VetoPenaltySeconds)
		if err != nil {
			return nil, err
		}
		return &chID, nil
	}
	return nil, nil
}
