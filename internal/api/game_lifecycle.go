package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgconn"
	"github.com/jackc/pgx/v4"

	"github.com/Jessevdz/RunwayTheGame/internal/commands"
	"github.com/Jessevdz/RunwayTheGame/internal/eventstore"
	"github.com/Jessevdz/RunwayTheGame/internal/logger"
	"github.com/Jessevdz/RunwayTheGame/internal/rules"
)

type GameCreateRequest struct {
	BoardID      string    `json:"board_id"`
	BoardVersion int       `json:"board_version"`
	StartsAt     time.Time `json:"starts_at"`
	EndsAt       time.Time `json:"ends_at"`
	// Ruleset customizes timers, costs, and coin settings for the game.
	Ruleset *rules.Ruleset `json:"ruleset,omitempty"`
	// Mode specifies the game mode.
	Mode string `json:"mode,omitempty"`
}

// SoloRunCreateRequest payload for creating and starting a single-player run.
type SoloRunCreateRequest struct {
	BoardID      string `json:"board_id"`
	BoardVersion int    `json:"board_version"`
	// Mode specifies the solo mode.
	Mode string `json:"mode"`
	// RunnerName names the one-person team, and is the name a posted leaderboard
	// time is credited to.
	RunnerName string `json:"runner_name"`
	// EndsAt specifies optional end time metadata, defaulting to soloRunDuration from now.
	EndsAt time.Time `json:"ends_at,omitempty"`
	// Ruleset customises this run the same way it does a team game.
	Ruleset *rules.Ruleset `json:"ruleset,omitempty"`
	// Stable across a client's retries of the same request.
	IdempotencyKey string `json:"idempotency_key,omitempty"`
}

// gameCreatedResponse represents the payload returned when creating a game lobby.
type gameCreatedResponse struct {
	ID           string        `json:"id"`
	BoardID      string        `json:"board_id"`
	BoardVersion int           `json:"board_version"`
	Status       string        `json:"status"`
	Mode         string        `json:"mode"`
	RaceCode     string        `json:"race_code"`
	StartsAt     time.Time     `json:"starts_at"`
	EndsAt       time.Time     `json:"ends_at"`
	HostToken    string        `json:"host_token"`
	Ruleset      rules.Ruleset `json:"ruleset"`
}

// gameDraftAck is the cached body returned by replayed create-game commands.
type gameDraftAck struct {
	ID     string `json:"id"`
	Status string `json:"status"`
}

// soloRunResponse represents the payload returned when initializing a solo run.
type soloRunResponse struct {
	GameID       string        `json:"game_id"`
	TeamID       string        `json:"team_id"`
	TeamName     string        `json:"team_name"`
	HostToken    string        `json:"host_token"`
	JoinToken    string        `json:"join_token"`
	JoinCode     string        `json:"join_code"`
	Mode         string        `json:"mode"`
	RaceCode     string        `json:"race_code"`
	StartedAt    time.Time     `json:"started_at"`
	BoardID      string        `json:"board_id"`
	BoardVersion int           `json:"board_version"`
	Ruleset      rules.Ruleset `json:"ruleset"`
}

func (s *Server) handleCreateGame(w http.ResponseWriter, r *http.Request) {
	var req GameCreateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(r.Context(), w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.BoardID == "" {
		writeError(r.Context(), w, http.StatusBadRequest, "board_id is required")
		return
	}
	if req.BoardVersion == 0 {
		req.BoardVersion = 1
	}
	if req.StartsAt.IsZero() || req.EndsAt.IsZero() {
		writeError(r.Context(), w, http.StatusBadRequest, "starts_at and ends_at are required")
		return
	}
	// Default to team mode when unspecified.
	if req.Mode == "" {
		req.Mode = rules.ModeTeam
	}
	if !rules.IsValidMode(req.Mode) {
		writeError(r.Context(), w, http.StatusBadRequest, "unknown mode")
		return
	}

	// The race runs on a frozen copy of the design, never on the draft itself, so
	// the designer can keep editing without moving waypoints under a live race.
	raceVersion, err := s.freezeBoardForRace(r.Context(), req.BoardID, req.BoardVersion)
	if err != nil {
		writeBoardGateError(r.Context(), w, err)
		return
	}

	gameID := uuid.New().String()
	// Resolve and serialize ruleset for storage.
	ruleset, err := resolveRuleset(req.Ruleset, req.Mode)
	if err != nil {
		writeError(r.Context(), w, http.StatusBadRequest, err.Error())
		return
	}
	rulesetBytes, _ := json.Marshal(ruleset)

	// Generate host token for game creator.
	hostToken := uuid.New().String()

	raceCode, err := s.insertGameRow(r.Context(), newGameRow{
		GameID:        gameID,
		BoardID:       req.BoardID,
		BoardVersion:  raceVersion,
		Mode:          req.Mode,
		RulesetBytes:  rulesetBytes,
		HostTokenHash: hashToken(hostToken),
		StartsAt:      req.StartsAt,
		EndsAt:        req.EndsAt,
	})
	if err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to create game: "+err.Error())
		return
	}

	payloadBytes, _ := json.Marshal(eventstore.GameCreatedPayload{
		BoardID:  req.BoardID,
		StartsAt: req.StartsAt,
		EndsAt:   req.EndsAt,
		Mode:     req.Mode,
	})
	cmdReq := commands.CommandRequest{
		GameID:      gameID,
		CommandType: "GameCreated",
		ExpectedSeq: 1,
		Payload:     payloadBytes,
	}
	_, err = s.CmdProcessor.Process(r.Context(), cmdReq, func(ctx context.Context, tx pgx.Tx, cr commands.CommandRequest) (*commands.CommandResult, error) {
		return &commands.CommandResult{
			ResponseCode: http.StatusCreated,
			ResponseBody: gameDraftAck{ID: gameID, Status: "draft"},
			Events: []eventstore.Event{
				{Type: "GameCreated", Payload: string(cr.Payload)},
			},
		}, nil
	})
	if err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to append game created event: "+err.Error())
		return
	}

	writeJSON(r.Context(), w, http.StatusCreated, gameCreatedResponse{
		ID:           gameID,
		BoardID:      req.BoardID,
		BoardVersion: raceVersion,
		Status:       "draft",
		Mode:         req.Mode,
		RaceCode:     raceCode,
		StartsAt:     req.StartsAt,
		EndsAt:       req.EndsAt,
		HostToken:    hostToken,
		Ruleset:      ruleset,
	})
}

var (
	errBoardNotFound     = errors.New("board not found")
	errBoardNotPublished = errors.New("board must be published before creating a game")
)

// resolveRuleset merges requested ruleset configurations with defaults and validates verification modes.
func resolveRuleset(requested *rules.Ruleset, mode string) (rules.Ruleset, error) {
	if requested == nil {
		rs := rules.DefaultRuleset()
		if mode == rules.ModeSoloCasual {
			rs.Verification = rules.VerificationTrust
		}
		return rs, nil
	}
	if v := requested.Verification; v != "" {
		if !rules.IsValidVerification(v) {
			return rules.Ruleset{}, fmt.Errorf("unknown verification mode %q: expected llm, host, or trust", v)
		}
		if !rules.VerificationAllowedInMode(v, mode) {
			if mode == rules.ModeSoloCasual {
				return rules.Ruleset{}, fmt.Errorf("a casual solo run cannot have a referee")
			}
			// Solo runs cannot use host verification.
			return rules.Ruleset{}, fmt.Errorf("a solo run cannot be graded by its host: there is nobody watching a review queue")
		}
	}
	rs := rules.NormalizeRuleset(*requested)
	if mode == rules.ModeSoloCasual {
		rs.Verification = rules.VerificationTrust
	}
	return rs, nil
}

// requirePublishedBoard validates that the specified board is published.
func (s *Server) requirePublishedBoard(ctx context.Context, boardID string, version int) error {
	var publishedAt *time.Time
	err := s.DB.Pool.QueryRow(ctx, `
		SELECT published_at FROM boards WHERE id = $1 AND version = $2
	`, boardID, version).Scan(&publishedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return errBoardNotFound
		}
		return fmt.Errorf("failed to check board: %w", err)
	}
	if publishedAt == nil {
		return errBoardNotPublished
	}
	return nil
}

// writeBoardGateError writes the appropriate HTTP error response for board validation failures.
func writeBoardGateError(ctx context.Context, w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, errBoardNotFound):
		writeError(ctx, w, http.StatusNotFound, errBoardNotFound.Error())
	case errors.Is(err, errBoardNotPublished):
		writeError(ctx, w, http.StatusBadRequest, errBoardNotPublished.Error())
	default:
		writeError(ctx, w, http.StatusInternalServerError, err.Error())
	}
}

// newGameRow is everything the games row needs that is not derived here.
type newGameRow struct {
	GameID        string
	BoardID       string
	BoardVersion  int
	Mode          string
	RulesetBytes  []byte
	HostTokenHash string
	StartsAt      time.Time
	EndsAt        time.Time
}

// insertGameRow writes a draft game record into the database and returns its unique race code.
func (s *Server) insertGameRow(ctx context.Context, g newGameRow) (string, error) {
	var raceCode string
	var err error
	for attempt := 0; attempt < 5; attempt++ {
		raceCode, err = newJoinCode()
		if err != nil {
			return "", fmt.Errorf("failed to mint race code: %w", err)
		}
		_, err = s.DB.Pool.Exec(ctx, `
			INSERT INTO games (id, board_id, board_version, status, mode, ruleset, host_token_hash, race_code, starts_at, ends_at)
			VALUES ($1, $2, $3, 'draft', $4, $5, $6, $7, $8, $9)
		`, g.GameID, g.BoardID, g.BoardVersion, g.Mode, g.RulesetBytes, g.HostTokenHash, raceCode, g.StartsAt, g.EndsAt)
		// Retry on unique race code collision.
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == pgUniqueViolation {
			continue
		}
		break
	}
	if err != nil {
		return "", err
	}
	return raceCode, nil
}

// insertTeamRow registers a team in the database within a transaction.
func insertTeamRow(ctx context.Context, tx pgx.Tx, gameID string, t newTeamRow) error {
	if _, err := tx.Exec(ctx, `
		INSERT INTO game_teams (id, game_id, name, slot_index, join_code)
		VALUES ($1, $2, $3, $4, $5)
	`, t.TeamID, gameID, t.Name, t.SlotIndex, t.JoinCode); err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == pgUniqueViolation {
			return errSlotTaken
		}
		return fmt.Errorf("failed to register team: %w", err)
	}
	return insertTeamToken(ctx, tx, gameID, t.TeamID, t.JoinToken, t.PlayerID, t.DisplayName)
}

// insertTeamToken stores a hashed team capability token and associated player metadata.
func insertTeamToken(ctx context.Context, tx pgx.Tx, gameID, teamID, joinToken, playerID, displayName string) error {
	var name *string
	if displayName != "" {
		name = &displayName
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO team_tokens (token_hash, game_id, team_id, player_id, display_name)
		VALUES ($1, $2, $3, $4, $5)
	`, hashToken(joinToken), gameID, teamID, playerID, name); err != nil {
		return fmt.Errorf("failed to register team capability: %w", err)
	}
	return nil
}

// newTeamRow is a team's identity and the two capabilities minted with it.
type newTeamRow struct {
	TeamID    string
	Name      string
	SlotIndex int
	JoinToken string
	JoinCode  string
	// PlayerID and DisplayName store the joining player's device identity.
	PlayerID    string
	DisplayName string
}

// mintTeam generates a team's UUID, join token, join code, and player identity.
func mintTeam(name string, slotIndex int, displayName string) (newTeamRow, error) {
	joinCode, err := newJoinCode()
	if err != nil {
		return newTeamRow{}, fmt.Errorf("failed to mint a team join code: %w", err)
	}
	return newTeamRow{
		TeamID:      uuid.New().String(),
		Name:        name,
		SlotIndex:   slotIndex,
		JoinToken:   uuid.New().String(),
		JoinCode:    joinCode,
		PlayerID:    uuid.New().String(),
		DisplayName: sanitizeDisplayName(displayName, playerNameMaxRunes),
	}, nil
}

// handleCreateSoloRun creates and initializes a single-player run in a single request.
func (s *Server) handleCreateSoloRun(w http.ResponseWriter, r *http.Request) {
	var req SoloRunCreateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(r.Context(), w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.BoardID == "" {
		writeError(r.Context(), w, http.StatusBadRequest, "board_id is required")
		return
	}
	if req.BoardVersion == 0 {
		req.BoardVersion = 1
	}
	// Validate that mode is a valid solo mode.
	if !rules.IsSoloMode(req.Mode) {
		writeError(r.Context(), w, http.StatusBadRequest, "mode must be solo_time_trial or solo_casual")
		return
	}
	runnerName := sanitizeDisplayName(req.RunnerName, soloRunnerNameMaxRunes)
	if runnerName == "" {
		runnerName = "Runner"
	}

	// A solo run freezes its own copy of the design, exactly as a hosted race does.
	raceVersion, err := s.freezeBoardForRace(r.Context(), req.BoardID, req.BoardVersion)
	if err != nil {
		writeBoardGateError(r.Context(), w, err)
		return
	}

	now := time.Now().UTC()
	endsAt := req.EndsAt
	if endsAt.IsZero() {
		endsAt = now.Add(soloRunDuration)
	}

	ruleset, err := resolveRuleset(req.Ruleset, req.Mode)
	if err != nil {
		writeError(r.Context(), w, http.StatusBadRequest, err.Error())
		return
	}
	rulesetBytes, _ := json.Marshal(ruleset)

	gameID := uuid.New().String()
	// Generate host token for solo runner.
	hostToken := uuid.New().String()

	raceCode, err := s.insertGameRow(r.Context(), newGameRow{
		GameID:        gameID,
		BoardID:       req.BoardID,
		BoardVersion:  raceVersion,
		Mode:          req.Mode,
		RulesetBytes:  rulesetBytes,
		HostTokenHash: hashToken(hostToken),
		StartsAt:      now,
		EndsAt:        endsAt,
	})
	if err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to create solo run: "+err.Error())
		return
	}

	// Mint team and player identity for the solo runner.
	team, err := mintTeam(runnerName, 0, runnerName)
	if err != nil {
		s.discardDraftGame(r.Context(), gameID)
		writeError(r.Context(), w, http.StatusInternalServerError, err.Error())
		return
	}

	createdPayload, _ := json.Marshal(eventstore.GameCreatedPayload{
		BoardID:  req.BoardID,
		StartsAt: now,
		EndsAt:   endsAt,
		Mode:     req.Mode,
	})
	joinedPayload, _ := json.Marshal(eventstore.TeamJoinedPayload{
		TeamID:    team.TeamID,
		Name:      team.Name,
		SlotIndex: team.SlotIndex,
	})

	// Create initial game creation, join, and start events.
	events := []eventstore.Event{
		{Type: "GameCreated", Payload: string(createdPayload), CreatedAt: now},
		{Type: "TeamJoined", Payload: string(joinedPayload), CreatedAt: now},
		{Type: "GameStarted", Payload: "{}", CreatedAt: now},
	}

	responseBody := soloRunResponse{
		GameID:       gameID,
		TeamID:       team.TeamID,
		TeamName:     team.Name,
		HostToken:    hostToken,
		JoinToken:    team.JoinToken,
		JoinCode:     team.JoinCode,
		Mode:         req.Mode,
		RaceCode:     raceCode,
		StartedAt:    now,
		BoardID:      req.BoardID,
		BoardVersion: raceVersion,
		Ruleset:      ruleset,
	}

	// Process SoloRunStarted command at expected sequence 1.
	_, err = s.CmdProcessor.Process(r.Context(), commands.CommandRequest{
		GameID:         gameID,
		CommandType:    "SoloRunStarted",
		ExpectedSeq:    1,
		IdempotencyKey: req.IdempotencyKey,
		Payload:        createdPayload,
	}, func(ctx context.Context, tx pgx.Tx, cr commands.CommandRequest) (*commands.CommandResult, error) {
		if err := insertTeamRow(ctx, tx, gameID, team); err != nil {
			return nil, err
		}
		if _, err := tx.Exec(ctx, `UPDATE games SET status = 'live' WHERE id = $1`, gameID); err != nil {
			return nil, err
		}
		return &commands.CommandResult{
			ResponseCode: http.StatusCreated,
			ResponseBody: responseBody,
			Events:       events,
		}, nil
	})
	if err != nil {
		// Discard draft game on initialization failure.
		s.discardDraftGame(r.Context(), gameID)
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to start solo run: "+err.Error())
		return
	}

	writeJSON(r.Context(), w, http.StatusCreated, responseBody)
}

// discardDraftGame removes unstarted draft games upon creation failure.
func (s *Server) discardDraftGame(ctx context.Context, gameID string) {
	var boardID string
	var boardVersion int
	err := s.DB.Pool.QueryRow(ctx, `
		DELETE FROM games
		WHERE id = $1 AND status = 'draft'
		  AND NOT EXISTS (SELECT 1 FROM game_teams WHERE game_id = $1)
		RETURNING board_id::text, board_version
	`, gameID).Scan(&boardID, &boardVersion)
	if errors.Is(err, pgx.ErrNoRows) {
		return
	}
	if err != nil {
		logger.Warn(ctx, "failed to discard half-built game row", map[string]interface{}{
			"game_id": gameID,
			"error":   err.Error(),
		})
		return
	}

	// The board copy was frozen for this race alone, so it goes with it.
	if _, err := s.DB.Pool.Exec(ctx, `
		DELETE FROM boards b
		WHERE b.id = $1 AND b.version = $2 AND b.is_snapshot = TRUE
		  AND NOT EXISTS (SELECT 1 FROM games g WHERE g.board_id = b.id AND g.board_version = b.version)
	`, boardID, boardVersion); err != nil {
		logger.Warn(ctx, "failed to discard the frozen board copy of a half-built game", map[string]interface{}{
			"game_id": gameID,
			"error":   err.Error(),
		})
	}
}

func (s *Server) handleStartGame(w http.ResponseWriter, r *http.Request) {
	gameID := chi.URLParam(r, "game_id")

	var status string
	err := s.DB.Pool.QueryRow(r.Context(), `SELECT status FROM games WHERE id = $1`, gameID).Scan(&status)
	if err != nil {
		writeError(r.Context(), w, http.StatusNotFound, "game not found")
		return
	}
	if status != "draft" {
		writeError(r.Context(), w, http.StatusForbidden, "game is already started or ended")
		return
	}

	expectedSeq, err := s.nextSequence(r.Context(), gameID)
	if err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to resolve sequence")
		return
	}

	cmdReq := commands.CommandRequest{
		GameID:      gameID,
		CommandType: "GameStarted",
		ExpectedSeq: expectedSeq,
		Payload:     []byte(`{}`),
	}
	_, err = s.CmdProcessor.Process(r.Context(), cmdReq, func(ctx context.Context, tx pgx.Tx, cr commands.CommandRequest) (*commands.CommandResult, error) {
		_, dbErr := tx.Exec(ctx, `UPDATE games SET status = 'live' WHERE id = $1`, gameID)
		if dbErr != nil {
			return nil, dbErr
		}
		return &commands.CommandResult{
			ResponseCode: http.StatusOK,
			ResponseBody: statusResponse{Status: "live"},
			Events: []eventstore.Event{
				{Type: "GameStarted", Payload: "{}"},
			},
		}, nil
	})
	if err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to start game: "+err.Error())
		return
	}

	writeJSON(r.Context(), w, http.StatusOK, statusResponse{Status: "live"})
}

func (s *Server) handleEndGame(w http.ResponseWriter, r *http.Request) {
	gameID := chi.URLParam(r, "game_id")

	expectedSeq, err := s.nextSequence(r.Context(), gameID)
	if err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to resolve sequence")
		return
	}

	payload, _ := json.Marshal(eventstore.GameEndedPayload{WinnerTeamID: ""})

	cmdReq := commands.CommandRequest{
		GameID:      gameID,
		CommandType: "GameEnded",
		ExpectedSeq: expectedSeq,
		Payload:     payload,
	}
	_, err = s.CmdProcessor.Process(r.Context(), cmdReq, func(ctx context.Context, tx pgx.Tx, cr commands.CommandRequest) (*commands.CommandResult, error) {
		_, dbErr := tx.Exec(ctx, `UPDATE games SET status = 'ended' WHERE id = $1`, gameID)
		if dbErr != nil {
			return nil, dbErr
		}
		return &commands.CommandResult{
			ResponseCode: http.StatusOK,
			ResponseBody: statusResponse{Status: "ended"},
			Events: []eventstore.Event{
				{Type: "GameEnded", Payload: string(cr.Payload)},
			},
		}, nil
	})
	if err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to end game: "+err.Error())
		return
	}

	writeJSON(r.Context(), w, http.StatusOK, statusResponse{Status: "ended"})
}
