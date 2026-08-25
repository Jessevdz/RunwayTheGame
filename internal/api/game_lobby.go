package api

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v4"

	"github.com/Jessevdz/RunwayTheGame/internal/logger"
	"github.com/Jessevdz/RunwayTheGame/internal/projections"
	"github.com/Jessevdz/RunwayTheGame/internal/rules"
)

// gameView is the public and subscriber view of a game lobby and live state.
type gameView struct {
	GameID       string             `json:"game_id"`
	BoardID      string             `json:"board_id"`
	BoardVersion int                `json:"board_version"`
	BoardName    string             `json:"board_name"`
	Status       string             `json:"status"`
	Mode         string             `json:"mode"`
	RaceCode     string             `json:"race_code"`
	StartsAt     time.Time          `json:"starts_at"`
	EndsAt       time.Time          `json:"ends_at"`
	Teams        []lobbyRosterEntry `json:"teams"`
	Winner       string             `json:"winner"`

	*gameLiveState
}

// gameLiveState is the part of the projection only a subscriber may see.
type gameLiveState struct {
	Standings  []projections.StandingRow        `json:"standings"`
	RoadStates map[string]rules.RoadState       `json:"road_states"`
	Progress   map[string]rules.TeamProgress    `json:"progress"`
	PublicLog  []string                         `json:"public_log"`
	Roadblocks map[string]projections.Roadblock `json:"roadblocks"`
	Effects    map[string][]rules.TeamEffect    `json:"effects"`
	Inventory  map[string][]string              `json:"inventory"`
	Coins      map[string]int                   `json:"coins"`
}

// raceCodeLookupResponse carries public game information resolved from a race code.
type raceCodeLookupResponse struct {
	GameID    string `json:"game_id"`
	RaceCode  string `json:"race_code"`
	Status    string `json:"status"`
	Mode      string `json:"mode"`
	BoardName string `json:"board_name"`
	TeamCount int    `json:"team_count"`
}

// teamListEntry represents team details in the host roster, including the join code.
type teamListEntry struct {
	TeamID    string `json:"team_id"`
	TeamName  string `json:"team_name"`
	SlotIndex int    `json:"slot_index"`
	JoinCode  string `json:"join_code"`
}

// teamListResponse wraps the roster so the body stays an object.
type teamListResponse struct {
	Teams []teamListEntry `json:"teams"`
}

// handleGetGame returns public game metadata and state projections for authorized subscribers.
func (s *Server) handleGetGame(w http.ResponseWriter, r *http.Request) {
	gameID := chi.URLParam(r, "game_id")

	var boardID string
	var boardVersion int
	var status string
	var rulesetBytes []byte
	var startsAt, endsAt time.Time
	// Query game metadata and board details.
	var raceCode, boardName *string
	err := s.DB.Pool.QueryRow(r.Context(), `
		SELECT g.board_id, g.board_version, g.status, g.ruleset, g.starts_at, g.ends_at, g.race_code, b.name
		FROM games g
		LEFT JOIN boards b ON b.id = g.board_id AND b.version = g.board_version
		WHERE g.id = $1
	`, gameID).Scan(&boardID, &boardVersion, &status, &rulesetBytes, &startsAt, &endsAt, &raceCode, &boardName)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(r.Context(), w, http.StatusNotFound, "game not found")
			return
		}
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to fetch game: "+err.Error())
		return
	}

	proj, err := projections.RebuildProjection(r.Context(), s.DB.Pool, gameID, 0)
	if err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to rebuild projection: "+err.Error())
		return
	}

	// Retrieve team roster for lobby display.
	teams, err := s.lobbyRoster(r.Context(), gameID)
	if err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to list teams: "+err.Error())
		return
	}

	// Build public game metadata response.
	body := gameView{
		GameID:       gameID,
		BoardID:      boardID,
		BoardVersion: boardVersion,
		BoardName:    derefOr(boardName, ""),
		Status:       status,
		Mode:         proj.Mode,
		RaceCode:     derefOr(raceCode, ""),
		StartsAt:     startsAt,
		EndsAt:       endsAt,
		Teams:        teams,
		Winner:       proj.Winner,
	}

	// Attach state projection for authorized game subscribers, scoped to what they may see.
	if token := bearerToken(r); token != "" {
		if viewer, err := s.authorizeSubscriber(r.Context(), gameID, token); err == nil {
			view := proj.RedactFor(viewer.TeamID, viewer.isHost())
			body.gameLiveState = &gameLiveState{
				Standings:  view.StandingsList,
				RoadStates: view.RoadStates,
				Progress:   view.Progress,
				PublicLog:  view.PublicLog,
				Roadblocks: view.Roadblocks,
				Effects:    view.Effects,
				Inventory:  view.Inventory,
				Coins:      view.Coins,
			}
		}
	}

	writeJSON(r.Context(), w, http.StatusOK, body)
}

// lobbyRosterEntry represents team metadata displayed in the game lobby.
type lobbyRosterEntry struct {
	TeamID    string             `json:"team_id"`
	TeamName  string             `json:"team_name"`
	SlotIndex int                `json:"slot_index"`
	Players   []lobbyPlayerEntry `json:"players"`
}

// lobbyPlayerEntry represents player information in the lobby roster.
type lobbyPlayerEntry struct {
	PlayerID    string `json:"player_id"`
	DisplayName string `json:"display_name"`
}

// lobbyRoster retrieves team and player roster metadata for a game lobby.
func (s *Server) lobbyRoster(ctx context.Context, gameID string) ([]lobbyRosterEntry, error) {
	rows, err := s.DB.Pool.Query(ctx, `
		SELECT id::text, name, slot_index
		FROM game_teams WHERE game_id = $1 ORDER BY slot_index
	`, gameID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	teams := []lobbyRosterEntry{}
	byID := map[string]int{}
	for rows.Next() {
		var entry lobbyRosterEntry
		if err := rows.Scan(&entry.TeamID, &entry.TeamName, &entry.SlotIndex); err != nil {
			return nil, err
		}
		// Initialize as an empty slice to ensure valid JSON array encoding for clients.
		entry.Players = []lobbyPlayerEntry{}
		byID[entry.TeamID] = len(teams)
		teams = append(teams, entry)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// Query players separately to populate teams while filtering entries missing player identity attributes.
	playerRows, err := s.DB.Pool.Query(ctx, `
		SELECT team_id::text, player_id::text, display_name
		FROM team_tokens
		WHERE game_id = $1 AND player_id IS NOT NULL AND display_name IS NOT NULL
		ORDER BY created_at
	`, gameID)
	if err != nil {
		return nil, err
	}
	defer playerRows.Close()

	for playerRows.Next() {
		var teamID string
		var player lobbyPlayerEntry
		if err := playerRows.Scan(&teamID, &player.PlayerID, &player.DisplayName); err != nil {
			return nil, err
		}
		if idx, ok := byID[teamID]; ok {
			teams[idx].Players = append(teams[idx].Players, player)
		}
	}
	return teams, playerRows.Err()
}

// handleGetGameByCode resolves a race code to its corresponding game metadata.
func (s *Server) handleGetGameByCode(w http.ResponseWriter, r *http.Request) {
	code := normalizeJoinCode(chi.URLParam(r, "code"))

	// Validate race code format.
	if len(code) != joinCodeLength || !isJoinCodeShaped(code) {
		writeError(r.Context(), w, http.StatusNotFound, "no race with that code")
		return
	}

	if s.codeLookupLimiter != nil && !s.codeLookupLimiter.allow(clientIP(r)) {
		w.Header().Set("Retry-After", "10")
		writeError(r.Context(), w, http.StatusTooManyRequests, "too many code lookups")
		return
	}

	var gameID, status, mode string
	var boardName *string
	err := s.DB.Pool.QueryRow(r.Context(), `
		SELECT g.id::text, g.status, g.mode, b.name
		FROM games g
		LEFT JOIN boards b ON b.id = g.board_id AND b.version = g.board_version
		WHERE g.race_code = $1
	`, code).Scan(&gameID, &status, &mode, &boardName)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			logger.Warn(r.Context(), "race code lookup miss", map[string]interface{}{"client_ip": clientIP(r)})
			writeError(r.Context(), w, http.StatusNotFound, "no race with that code")
			return
		}
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to look up race code: "+err.Error())
		return
	}

	// Refuse lookup for solo run race codes.
	if rules.IsSoloMode(mode) {
		logger.Warn(r.Context(), "race code lookup resolved to a solo run", map[string]interface{}{"client_ip": clientIP(r)})
		writeError(r.Context(), w, http.StatusNotFound, "no race with that code")
		return
	}

	// Refuse lookup for ended games.
	if status == "ended" {
		writeError(r.Context(), w, http.StatusGone, "that race has already finished")
		return
	}

	var teamCount int
	if err := s.DB.Pool.QueryRow(r.Context(), `SELECT COUNT(*) FROM game_teams WHERE game_id = $1`, gameID).Scan(&teamCount); err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to count teams: "+err.Error())
		return
	}

	writeJSON(r.Context(), w, http.StatusOK, raceCodeLookupResponse{
		GameID:    gameID,
		RaceCode:  code,
		Status:    status,
		Mode:      mode,
		BoardName: derefOr(boardName, ""),
		TeamCount: teamCount,
	})
}

// handleListTeams returns the team roster including team join codes for host administration.
func (s *Server) handleListTeams(w http.ResponseWriter, r *http.Request) {
	gameID := chi.URLParam(r, "game_id")

	rows, err := s.DB.Pool.Query(r.Context(), `
		SELECT id, name, slot_index, COALESCE(join_code, '')
		FROM game_teams WHERE game_id = $1 ORDER BY slot_index
	`, gameID)
	if err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to list teams: "+err.Error())
		return
	}
	defer rows.Close()

	teams := []teamListEntry{}
	for rows.Next() {
		var entry teamListEntry
		if err := rows.Scan(&entry.TeamID, &entry.TeamName, &entry.SlotIndex, &entry.JoinCode); err != nil {
			writeError(r.Context(), w, http.StatusInternalServerError, "failed to read team row: "+err.Error())
			return
		}
		teams = append(teams, entry)
	}
	if err := rows.Err(); err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to list teams: "+err.Error())
		return
	}

	writeJSON(r.Context(), w, http.StatusOK, teamListResponse{Teams: teams})
}
