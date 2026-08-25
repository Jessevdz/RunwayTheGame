package api

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v4"

	"github.com/Jessevdz/RunwayTheGame/internal/projections"
	"github.com/Jessevdz/RunwayTheGame/internal/rules"
)

// Leaderboard management and querying for solo run time trials.

const (
	// leaderboardDefaultLimit is the default number of entries returned when unspecified.
	leaderboardDefaultLimit = 25
	// leaderboardMaxLimit is the maximum number of entries returned for a leaderboard query.
	leaderboardMaxLimit = 100
)

// SoloLeaderboardPostRequest represents the request body for posting a solo time trial result.
// Time and runner name are derived from recorded game events.
type SoloLeaderboardPostRequest struct {
	// IdempotencyKey is an optional client-provided key for request idempotency.
	IdempotencyKey string `json:"idempotency_key,omitempty"`
}

// soloRunPostedResponse confirms a solo run time posted to a board's leaderboard.
type soloRunPostedResponse struct {
	BoardID string         `json:"board_id"`
	Run     LeaderboardRow `json:"run"`
}

// leaderboardResponse represents a board's published leaderboard entries.
type leaderboardResponse struct {
	BoardID        string           `json:"board_id"`
	CurrentVersion *int             `json:"current_version"`
	Entries        []LeaderboardRow `json:"entries"`
}

// LeaderboardRow represents a finished solo run entry on the leaderboard.
type LeaderboardRow struct {
	Rank         int    `json:"rank"`
	RunID        string `json:"run_id"`
	GameID       string `json:"game_id"`
	BoardVersion int    `json:"board_version"`
	RunnerName   string `json:"runner_name"`
	// ElapsedSeconds is the total recorded time in seconds, including veto penalties.
	ElapsedSeconds     int       `json:"elapsed_seconds"`
	VetoCount          int       `json:"veto_count"`
	VetoPenaltySeconds int       `json:"veto_penalty_seconds"`
	Coins              int       `json:"coins"`
	FinishedAt         time.Time `json:"finished_at"`
	// Verification is the grading mode used for the run's evidence.
	Verification string `json:"verification"`
}

// handlePostLeaderboardTime records a finished solo time trial run on the leaderboard.
// Posting is an explicit opt-in request after run completion.
func (s *Server) handlePostLeaderboardTime(w http.ResponseWriter, r *http.Request) {
	gameID := chi.URLParam(r, "game_id")

	// Request body is optional.
	var req SoloLeaderboardPostRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil && err.Error() != "EOF" {
		writeError(r.Context(), w, http.StatusBadRequest, "invalid request body")
		return
	}

	game, team, ok := s.requireTeam(w, r, gameID)
	if !ok {
		return
	}
	// Only finished solo time trial runs can be posted.
	if game.Mode != rules.ModeSoloTimeTrial {
		writeError(r.Context(), w, http.StatusForbidden, "only a solo time trial can be posted to a leaderboard")
		return
	}
	if game.Status != "ended" {
		writeError(r.Context(), w, http.StatusForbidden, "the run has not finished")
		return
	}

	proj, err := projections.RebuildProjection(r.Context(), s.DB.Pool, gameID, 0)
	if err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to load run")
		return
	}
	// Ensure the run was won by the requesting team.
	if proj.Winner == "" || proj.Winner != team.ID {
		writeError(r.Context(), w, http.StatusForbidden, "this run was not finished by your team")
		return
	}
	if proj.Clock.StartedAt.IsZero() || proj.Clock.FinishedAt.IsZero() {
		writeError(r.Context(), w, http.StatusConflict, "the run has no recorded start and finish")
		return
	}

	elapsed := proj.Clock.Elapsed(time.Now().UTC())
	elapsedSeconds := int(math.Round(elapsed.Seconds()))

	runnerName := proj.Teams[team.ID].Name
	if runnerName == "" {
		runnerName = "Runner"
	}

	row := LeaderboardRow{
		RunID:              uuid.New().String(),
		GameID:             gameID,
		BoardVersion:       game.BoardVersion,
		RunnerName:         runnerName,
		ElapsedSeconds:     elapsedSeconds,
		VetoCount:          proj.Clock.VetoCount,
		VetoPenaltySeconds: proj.Clock.TimePenaltySeconds,
		Coins:              proj.Coins[team.ID],
		FinishedAt:         proj.Clock.FinishedAt,
		Verification:       game.Ruleset.Verification,
	}

	// Insert run, ignoring duplicate postings for idempotency.
	_, err = s.DB.Pool.Exec(r.Context(), `
		INSERT INTO solo_runs (
			id, game_id, board_id, board_version, runner_name,
			elapsed_seconds, veto_count, veto_penalty_seconds, coins, finished_at, verification
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		ON CONFLICT (game_id) DO NOTHING
	`, row.RunID, gameID, game.BoardID, row.BoardVersion, row.RunnerName,
		row.ElapsedSeconds, row.VetoCount, row.VetoPenaltySeconds, row.Coins, row.FinishedAt, row.Verification)
	if err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to record time: "+err.Error())
		return
	}

	stored, err := s.readSoloRun(r.Context(), gameID)
	if err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to read back recorded time: "+err.Error())
		return
	}

	rank, err := s.rankOfSoloRun(r.Context(), game.BoardID, stored.ElapsedSeconds, stored.RunID)
	if err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to rank recorded time: "+err.Error())
		return
	}
	stored.Rank = rank

	writeJSON(r.Context(), w, http.StatusCreated, soloRunPostedResponse{
		BoardID: game.BoardID,
		Run:     stored,
	})
}

// readSoloRun fetches the recorded leaderboard row for a given game ID.
func (s *Server) readSoloRun(ctx context.Context, gameID string) (LeaderboardRow, error) {
	var row LeaderboardRow
	err := s.DB.Pool.QueryRow(ctx, `
		SELECT id::text, game_id::text, board_version, runner_name,
		       elapsed_seconds, veto_count, veto_penalty_seconds, coins, finished_at, verification
		FROM solo_runs WHERE game_id = $1
	`, gameID).Scan(&row.RunID, &row.GameID, &row.BoardVersion, &row.RunnerName,
		&row.ElapsedSeconds, &row.VetoCount, &row.VetoPenaltySeconds, &row.Coins, &row.FinishedAt, &row.Verification)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return row, errors.New("no recorded time for this run")
		}
		return row, err
	}
	return row, nil
}

// rankOfSoloRun calculates the 1-based leaderboard rank for a solo run, breaking ties deterministically by run ID.
func (s *Server) rankOfSoloRun(ctx context.Context, boardID string, elapsedSeconds int, runID string) (int, error) {
	var ahead int
	err := s.DB.Pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM solo_runs
		WHERE board_id = $1
		  AND (elapsed_seconds < $2 OR (elapsed_seconds = $2 AND id::text < $3))
	`, boardID, elapsedSeconds, runID).Scan(&ahead)
	if err != nil {
		return 0, err
	}
	return ahead + 1, nil
}

// handleGetBoardLeaderboard returns the fastest recorded runs on a board in ascending order of elapsed time.
func (s *Server) handleGetBoardLeaderboard(w http.ResponseWriter, r *http.Request) {
	boardID := chi.URLParam(r, "id")

	limit := leaderboardDefaultLimit
	if raw := r.URL.Query().Get("limit"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 {
			writeError(r.Context(), w, http.StatusBadRequest, "limit must be a positive integer")
			return
		}
		limit = parsed
	}
	if limit > leaderboardMaxLimit {
		limit = leaderboardMaxLimit
	}

	rows, err := s.DB.Pool.Query(r.Context(), `
		SELECT id::text, game_id::text, board_version, runner_name,
		       elapsed_seconds, veto_count, veto_penalty_seconds, coins, finished_at, verification
		FROM solo_runs
		WHERE board_id = $1
		ORDER BY elapsed_seconds ASC, id::text ASC
		LIMIT $2
	`, boardID, limit)
	if err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to read leaderboard: "+err.Error())
		return
	}
	defer rows.Close()

	entries := []LeaderboardRow{}
	for rows.Next() {
		var row LeaderboardRow
		if err := rows.Scan(&row.RunID, &row.GameID, &row.BoardVersion, &row.RunnerName,
			&row.ElapsedSeconds, &row.VetoCount, &row.VetoPenaltySeconds, &row.Coins, &row.FinishedAt,
			&row.Verification); err != nil {
			writeError(r.Context(), w, http.StatusInternalServerError, "failed to read leaderboard row: "+err.Error())
			return
		}
		row.Rank = len(entries) + 1
		entries = append(entries, row)
	}
	if err := rows.Err(); err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to read leaderboard: "+err.Error())
		return
	}

	// Query the latest published board version, which may be null if unpublished.
	var currentVersion *int
	if err := s.DB.Pool.QueryRow(r.Context(), `
		SELECT MAX(version) FROM boards WHERE id = $1 AND published_at IS NOT NULL
	`, boardID).Scan(&currentVersion); err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to read the published version: "+err.Error())
		return
	}

	writeJSON(r.Context(), w, http.StatusOK, leaderboardResponse{
		BoardID:        boardID,
		CurrentVersion: currentVersion,
		Entries:        entries,
	})
}
