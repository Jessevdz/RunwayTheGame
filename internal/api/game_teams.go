package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgconn"
	"github.com/jackc/pgx/v4"

	"github.com/Jessevdz/RunwayTheGame/internal/commands"
	"github.com/Jessevdz/RunwayTheGame/internal/eventstore"
	"github.com/Jessevdz/RunwayTheGame/internal/logger"
)

// errSquadOccupied indicates that a squad cannot be disbanded while members remain.
var errSquadOccupied = errors.New("squad still has players")

// JoinGameRequest defines the payload for creating and joining a new team.
type JoinGameRequest struct {
	TeamName       string `json:"team_name"`
	SlotIndex      int    `json:"slot_index"`
	DisplayName    string `json:"display_name,omitempty"`
	IdempotencyKey string `json:"idempotency_key,omitempty"`
}

// JoinExistingTeamRequest defines the payload for adding a device to an existing team squad.
type JoinExistingTeamRequest struct {
	JoinCode    string `json:"join_code,omitempty"`
	DisplayName string `json:"display_name,omitempty"`
}

// UpdateMembershipRequest defines the payload for updating a player's display name or team assignment.
type UpdateMembershipRequest struct {
	DisplayName *string `json:"display_name,omitempty"`
	TeamID      *string `json:"team_id,omitempty"`
}

// UpdateTeamRequest defines the payload for updating team name or slot assignment before a race.
type UpdateTeamRequest struct {
	Name      *string `json:"name,omitempty"`
	SlotIndex *int    `json:"slot_index,omitempty"`
}

// teamJoinedResponse represents the response payload returned when joining or creating a team.
type teamJoinedResponse struct {
	TeamID      string `json:"team_id"`
	JoinToken   string `json:"join_token"`
	JoinCode    string `json:"join_code"`
	SlotIndex   int    `json:"slot_index"`
	TeamName    string `json:"team_name,omitempty"`
	PlayerID    string `json:"player_id"`
	DisplayName string `json:"display_name"`
}

// teamUpdatedResponse reports a squad's updated name and slot index after a lobby edit.
type teamUpdatedResponse struct {
	TeamID    string `json:"team_id"`
	TeamName  string `json:"team_name"`
	SlotIndex int    `json:"slot_index"`
}

// handleJoinGame processes HTTP requests to register a new team in a game lobby.
func (s *Server) handleJoinGame(w http.ResponseWriter, r *http.Request) {
	gameID := chi.URLParam(r, "game_id")

	var req JoinGameRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(r.Context(), w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.TeamName == "" {
		writeError(r.Context(), w, http.StatusBadRequest, "team_name is required")
		return
	}
	// Validate slot index bounds.
	if req.SlotIndex < 0 || req.SlotIndex >= maxTeamSlots {
		writeError(r.Context(), w, http.StatusBadRequest, "slot_index out of range")
		return
	}

	var gameStatus string
	err := s.DB.Pool.QueryRow(r.Context(), "SELECT status FROM games WHERE id = $1", gameID).Scan(&gameStatus)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(r.Context(), w, http.StatusNotFound, "game not found")
			return
		}
		logger.Error(r.Context(), "failed to fetch game status", map[string]interface{}{"game_id": gameID, "error": err.Error()})
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to fetch game status")
		return
	}
	if gameStatus == "ended" {
		writeError(r.Context(), w, http.StatusForbidden, "game has ended, cannot join")
		return
	}

	// Execute team registration and join event append within a transaction.
	var joinBody json.RawMessage
	for attempt := 0; ; attempt++ {
		team, codeErr := mintTeam(req.TeamName, req.SlotIndex, req.DisplayName)
		if codeErr != nil {
			writeError(r.Context(), w, http.StatusInternalServerError, codeErr.Error())
			return
		}

		payloadBytes, _ := json.Marshal(eventstore.TeamJoinedPayload{
			TeamID:    team.TeamID,
			Name:      team.Name,
			SlotIndex: team.SlotIndex,
		})
		expectedSeq, seqErr := s.nextSequence(r.Context(), gameID)
		if seqErr != nil {
			writeError(r.Context(), w, http.StatusInternalServerError, "failed to resolve sequence: "+seqErr.Error())
			return
		}
		cmdReq := commands.CommandRequest{
			GameID:         gameID,
			CommandType:    "TeamJoined",
			ExpectedSeq:    expectedSeq,
			IdempotencyKey: req.IdempotencyKey,
			Payload:        payloadBytes,
		}

		resp, procErr := s.CmdProcessor.Process(r.Context(), cmdReq, func(ctx context.Context, tx pgx.Tx, cr commands.CommandRequest) (*commands.CommandResult, error) {
			// Insert team record, allowing callers to handle slot collision conflicts.
			if err := insertTeamRow(ctx, tx, gameID, team); err != nil {
				return nil, err
			}
			return &commands.CommandResult{
				ResponseCode: http.StatusCreated,
				// Hand back existing team attributes on idempotent request replays.
				ResponseBody: teamJoinedResponse{
					TeamID:      team.TeamID,
					JoinToken:   team.JoinToken,
					JoinCode:    team.JoinCode,
					SlotIndex:   team.SlotIndex,
					PlayerID:    team.PlayerID,
					DisplayName: team.DisplayName,
				},
				Events: []eventstore.Event{
					{Type: "TeamJoined", Payload: string(cr.Payload)},
				},
			}, nil
		})

		if procErr == nil {
			joinBody = resp.ResponseBody
			break
		}
		if errors.Is(procErr, errSlotTaken) {
			writeError(r.Context(), w, http.StatusConflict, "that team colour is already taken")
			return
		}
		// Re-read event sequence numbers and retry upon concurrency conflicts or unique index races.
		var pgErr *pgconn.PgError
		lostSequenceRace := errors.Is(procErr, eventstore.ErrConcurrencyConflict) ||
			(errors.As(procErr, &pgErr) && pgErr.Code == pgUniqueViolation)
		if lostSequenceRace && attempt < joinSequenceRetries {
			// Stagger retries with exponential backoff to reduce lock contention.
			time.Sleep(time.Duration(attempt+1) * 15 * time.Millisecond)
			continue
		}
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to append event: "+procErr.Error())
		return
	}

	writeRawJSON(r.Context(), w, http.StatusCreated, joinBody)
}

// handleJoinExistingTeam registers an additional device to an existing team and issues a capability token.
func (s *Server) handleJoinExistingTeam(w http.ResponseWriter, r *http.Request) {
	gameID := chi.URLParam(r, "game_id")
	teamID := chi.URLParam(r, "team_id")

	var req JoinExistingTeamRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(r.Context(), w, http.StatusBadRequest, "invalid request body")
		return
	}
	suppliedCode := normalizeJoinCode(req.JoinCode)
	if suppliedCode != "" {
		if len(suppliedCode) != joinCodeLength || !isJoinCodeShaped(suppliedCode) {
			// Reject invalid join code formats prior to database queries.
			writeError(r.Context(), w, http.StatusForbidden, "wrong join code for this team")
			return
		}

		// Rate limit join attempts using the code lookup rate limiter.
		if s.codeLookupLimiter != nil && !s.codeLookupLimiter.allow(clientIP(r)) {
			w.Header().Set("Retry-After", "10")
			writeError(r.Context(), w, http.StatusTooManyRequests, "too many join attempts")
			return
		}
	}

	var gameStatus string
	err := s.DB.Pool.QueryRow(r.Context(), "SELECT status FROM games WHERE id = $1", gameID).Scan(&gameStatus)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(r.Context(), w, http.StatusNotFound, "game not found")
			return
		}
		logger.Error(r.Context(), "failed to fetch game status", map[string]interface{}{"game_id": gameID, "error": err.Error()})
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to fetch game status")
		return
	}
	if gameStatus == "ended" {
		writeError(r.Context(), w, http.StatusForbidden, "game has ended, cannot join")
		return
	}

	var name string
	var slotIndex int
	var storedCode *string
	err = s.DB.Pool.QueryRow(r.Context(), `
		SELECT name, slot_index, join_code FROM game_teams WHERE game_id = $1 AND id = $2
	`, gameID, teamID).Scan(&name, &slotIndex, &storedCode)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(r.Context(), w, http.StatusNotFound, "team not found")
			return
		}
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to fetch team: "+err.Error())
		return
	}
	// Verify supplied join code if provided.
	if suppliedCode != "" {
		if storedCode == nil || *storedCode == "" || !tokensEqual(normalizeJoinCode(*storedCode), suppliedCode) {
			writeError(r.Context(), w, http.StatusForbidden, "wrong join code for this team")
			return
		}
	}

	// Issue a new capability token and player identity for the device.
	joinToken := uuid.New().String()
	playerID := uuid.New().String()
	displayName := sanitizeDisplayName(req.DisplayName, playerNameMaxRunes)
	tx, err := s.DB.Pool.Begin(r.Context())
	if err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to issue a team token: "+err.Error())
		return
	}
	defer func() { _ = tx.Rollback(r.Context()) }()
	if err := insertTeamToken(r.Context(), tx, gameID, teamID, joinToken, playerID, displayName); err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to issue a team token: "+err.Error())
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to issue a team token: "+err.Error())
		return
	}

	writeJSON(r.Context(), w, http.StatusOK, teamJoinedResponse{
		TeamID:      teamID,
		JoinToken:   joinToken,
		JoinCode:    derefOr(storedCode, ""),
		SlotIndex:   slotIndex,
		TeamName:    name,
		PlayerID:    playerID,
		DisplayName: displayName,
	})
}

// membershipView represents a device's current player and team assignment state.
type membershipView struct {
	PlayerID    string `json:"player_id"`
	DisplayName string `json:"display_name"`
	TeamID      string `json:"team_id"`
	TeamName    string `json:"team_name"`
	SlotIndex   int    `json:"slot_index"`
}

// readMembership reads back the row behind a team token.
func (s *Server) readMembership(ctx context.Context, gameID, tokenHash string) (membershipView, error) {
	var view membershipView
	var playerID, displayName *string
	err := s.DB.Pool.QueryRow(ctx, `
		SELECT tt.team_id::text, tt.player_id::text, tt.display_name, gt.name, gt.slot_index
		FROM team_tokens tt
		JOIN game_teams gt ON gt.id = tt.team_id
		WHERE tt.game_id = $1 AND tt.token_hash = $2
	`, gameID, tokenHash).Scan(&view.TeamID, &playerID, &displayName, &view.TeamName, &view.SlotIndex)
	if err != nil {
		return membershipView{}, err
	}
	view.PlayerID = derefOr(playerID, "")
	view.DisplayName = derefOr(displayName, "")
	return view, nil
}

// countTeamPlayers reports how many devices are still on a team.
func (s *Server) countTeamPlayers(ctx context.Context, tx pgx.Tx, gameID, teamID string) (int, error) {
	var n int
	err := tx.QueryRow(ctx, `
		SELECT COUNT(*) FROM team_tokens WHERE game_id = $1 AND team_id = $2
	`, gameID, teamID).Scan(&n)
	return n, err
}

// deleteTeamTx removes a squad and its associated runtime table records within a transaction.
func deleteTeamTx(ctx context.Context, tx pgx.Tx, gameID, teamID string) error {
	for _, stmt := range []string{
		`DELETE FROM team_positions WHERE game_id = $1 AND team_id = $2`,
		`DELETE FROM team_coins WHERE game_id = $1 AND team_id = $2`,
		`DELETE FROM game_teams WHERE game_id = $1 AND id = $2`,
	} {
		if _, err := tx.Exec(ctx, stmt, gameID, teamID); err != nil {
			return fmt.Errorf("failed to disband team: %w", err)
		}
	}
	return nil
}

// authorizeSquadEdit verifies that the requester holds host privileges or membership on the specified team.
func (s *Server) authorizeSquadEdit(w http.ResponseWriter, r *http.Request, gameID, teamID string) (*gameRecord, bool) {
	token := bearerToken(r)
	if token == "" {
		writeError(r.Context(), w, http.StatusUnauthorized, "a team or host token is required (Authorization: Bearer <token>)")
		return nil, false
	}
	game, err := s.loadGame(r.Context(), gameID)
	if err != nil {
		writeError(r.Context(), w, http.StatusNotFound, "game not found")
		return nil, false
	}

	if caps, err := s.loadGameCapabilities(r.Context(), gameID); err == nil {
		if caps.HostTokenHash != "" && tokensEqual(hashToken(token), caps.HostTokenHash) {
			return game, true
		}
	}

	var n int
	if err := s.DB.Pool.QueryRow(r.Context(), `
		SELECT COUNT(*) FROM team_tokens
		WHERE game_id = $1 AND team_id = $2 AND token_hash = $3
	`, gameID, teamID, hashToken(token)).Scan(&n); err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to verify token: "+err.Error())
		return nil, false
	}
	if n == 0 {
		writeError(r.Context(), w, http.StatusForbidden, "not on this squad")
		return nil, false
	}
	return game, true
}

// handleUpdateMembership updates a device's player display name or team assignment.
// Team assignment changes are permitted only while the game is in draft state.
func (s *Server) handleUpdateMembership(w http.ResponseWriter, r *http.Request) {
	gameID := chi.URLParam(r, "game_id")
	game, team, ok := s.requireTeam(w, r, gameID)
	if !ok {
		return
	}
	tokenHash := hashToken(bearerToken(r))

	var req UpdateMembershipRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(r.Context(), w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.DisplayName == nil && req.TeamID == nil {
		writeError(r.Context(), w, http.StatusBadRequest, "nothing to update: send display_name, team_id, or both")
		return
	}

	var newName *string
	if req.DisplayName != nil {
		cleaned := sanitizeDisplayName(*req.DisplayName, playerNameMaxRunes)
		if cleaned == "" {
			writeError(r.Context(), w, http.StatusBadRequest, "display_name cannot be empty")
			return
		}
		newName = &cleaned
	}

	// Execute direct update when changing display name without team reassignment.
	if req.TeamID == nil || *req.TeamID == team.ID {
		if newName != nil {
			if _, err := s.DB.Pool.Exec(r.Context(), `
				UPDATE team_tokens SET display_name = $1 WHERE game_id = $2 AND token_hash = $3
			`, *newName, gameID, tokenHash); err != nil {
				writeError(r.Context(), w, http.StatusInternalServerError, "failed to update your name: "+err.Error())
				return
			}
		}
		s.writeMembership(w, r, gameID, tokenHash)
		return
	}

	if game.Status != "draft" {
		writeError(r.Context(), w, http.StatusForbidden, "the race has started, so squads can no longer be changed")
		return
	}

	targetID := *req.TeamID
	var targetName string
	var targetSlot int
	if err := s.DB.Pool.QueryRow(r.Context(), `
		SELECT name, slot_index FROM game_teams WHERE game_id = $1 AND id = $2
	`, gameID, targetID).Scan(&targetName, &targetSlot); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(r.Context(), w, http.StatusNotFound, "that squad is not in this race")
			return
		}
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to fetch squad: "+err.Error())
		return
	}

	oldTeamID := team.ID

	// Execute team membership update and clean up empty squads within transaction.
	for attempt := 0; ; attempt++ {
		expectedSeq, seqErr := s.nextSequence(r.Context(), gameID)
		if seqErr != nil {
			writeError(r.Context(), w, http.StatusInternalServerError, "failed to resolve sequence: "+seqErr.Error())
			return
		}

		_, procErr := s.CmdProcessor.Process(r.Context(), commands.CommandRequest{
			GameID:      gameID,
			CommandType: "MembershipChanged",
			ExpectedSeq: expectedSeq,
		}, func(ctx context.Context, tx pgx.Tx, _ commands.CommandRequest) (*commands.CommandResult, error) {
			if newName != nil {
				if _, err := tx.Exec(ctx, `
					UPDATE team_tokens SET team_id = $1, display_name = $2 WHERE game_id = $3 AND token_hash = $4
				`, targetID, *newName, gameID, tokenHash); err != nil {
					return nil, fmt.Errorf("failed to move you to that squad: %w", err)
				}
			} else if _, err := tx.Exec(ctx, `
				UPDATE team_tokens SET team_id = $1 WHERE game_id = $2 AND token_hash = $3
			`, targetID, gameID, tokenHash); err != nil {
				return nil, fmt.Errorf("failed to move you to that squad: %w", err)
			}

			remaining, err := s.countTeamPlayers(ctx, tx, gameID, oldTeamID)
			if err != nil {
				return nil, fmt.Errorf("failed to count the squad you left: %w", err)
			}

			result := &commands.CommandResult{ResponseCode: http.StatusOK}
			if remaining == 0 {
				if err := deleteTeamTx(ctx, tx, gameID, oldTeamID); err != nil {
					return nil, err
				}
				payload, _ := json.Marshal(eventstore.TeamDisbandedPayload{TeamID: oldTeamID})
				result.Events = []eventstore.Event{{Type: "TeamDisbanded", Payload: string(payload)}}
			}
			return result, nil
		})

		if procErr == nil {
			break
		}
		var pgErr *pgconn.PgError
		lostSequenceRace := errors.Is(procErr, eventstore.ErrConcurrencyConflict) ||
			(errors.As(procErr, &pgErr) && pgErr.Code == pgUniqueViolation)
		if lostSequenceRace && attempt < joinSequenceRetries {
			time.Sleep(time.Duration(attempt+1) * 15 * time.Millisecond)
			continue
		}
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to switch squads: "+procErr.Error())
		return
	}

	s.writeMembership(w, r, gameID, tokenHash)
}

// writeMembership fetches and writes the active device's membership details to the HTTP response.
func (s *Server) writeMembership(w http.ResponseWriter, r *http.Request, gameID, tokenHash string) {
	view, err := s.readMembership(r.Context(), gameID, tokenHash)
	if err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to read your membership: "+err.Error())
		return
	}
	writeJSON(r.Context(), w, http.StatusOK, view)
}

// handleUpdateTeam updates a team's name or slot assignment during draft state.
func (s *Server) handleUpdateTeam(w http.ResponseWriter, r *http.Request) {
	gameID := chi.URLParam(r, "game_id")
	teamID := chi.URLParam(r, "team_id")

	game, ok := s.authorizeSquadEdit(w, r, gameID, teamID)
	if !ok {
		return
	}
	if game.Status != "draft" {
		writeError(r.Context(), w, http.StatusForbidden, "the race has started, so squads can no longer be edited")
		return
	}

	var req UpdateTeamRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(r.Context(), w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Name == nil && req.SlotIndex == nil {
		writeError(r.Context(), w, http.StatusBadRequest, "nothing to update: send name, slot_index, or both")
		return
	}
	if req.SlotIndex != nil && (*req.SlotIndex < 0 || *req.SlotIndex >= maxTeamSlots) {
		writeError(r.Context(), w, http.StatusBadRequest, "slot_index out of range")
		return
	}

	var name string
	var slotIndex int
	if err := s.DB.Pool.QueryRow(r.Context(), `
		SELECT name, slot_index FROM game_teams WHERE game_id = $1 AND id = $2
	`, gameID, teamID).Scan(&name, &slotIndex); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(r.Context(), w, http.StatusNotFound, "that squad is not in this race")
			return
		}
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to fetch squad: "+err.Error())
		return
	}
	if req.Name != nil {
		trimmed := strings.TrimSpace(*req.Name)
		if trimmed == "" {
			writeError(r.Context(), w, http.StatusBadRequest, "name cannot be empty")
			return
		}
		name = trimmed
	}
	if req.SlotIndex != nil {
		slotIndex = *req.SlotIndex
	}

	payload, _ := json.Marshal(eventstore.TeamUpdatedPayload{
		TeamID:    teamID,
		Name:      name,
		SlotIndex: slotIndex,
	})

	for attempt := 0; ; attempt++ {
		expectedSeq, seqErr := s.nextSequence(r.Context(), gameID)
		if seqErr != nil {
			writeError(r.Context(), w, http.StatusInternalServerError, "failed to resolve sequence: "+seqErr.Error())
			return
		}

		_, procErr := s.CmdProcessor.Process(r.Context(), commands.CommandRequest{
			GameID:      gameID,
			CommandType: "TeamUpdated",
			ExpectedSeq: expectedSeq,
			Payload:     payload,
		}, func(ctx context.Context, tx pgx.Tx, cr commands.CommandRequest) (*commands.CommandResult, error) {
			if _, err := tx.Exec(ctx, `
				UPDATE game_teams SET name = $1, slot_index = $2 WHERE game_id = $3 AND id = $4
			`, name, slotIndex, gameID, teamID); err != nil {
				// Handle unique slot conflict errors as recoverable slot collisions.
				var pgErr *pgconn.PgError
				if errors.As(err, &pgErr) && pgErr.Code == pgUniqueViolation {
					return nil, errSlotTaken
				}
				return nil, fmt.Errorf("failed to update squad: %w", err)
			}
			return &commands.CommandResult{
				ResponseCode: http.StatusOK,
				ResponseBody: teamUpdatedResponse{
					TeamID:    teamID,
					TeamName:  name,
					SlotIndex: slotIndex,
				},
				Events: []eventstore.Event{{Type: "TeamUpdated", Payload: string(cr.Payload)}},
			}, nil
		})

		if procErr == nil {
			break
		}
		if errors.Is(procErr, errSlotTaken) {
			writeError(r.Context(), w, http.StatusConflict, "that team colour is already taken")
			return
		}
		var pgErr *pgconn.PgError
		lostSequenceRace := errors.Is(procErr, eventstore.ErrConcurrencyConflict) ||
			(errors.As(procErr, &pgErr) && pgErr.Code == pgUniqueViolation)
		if lostSequenceRace && attempt < joinSequenceRetries {
			time.Sleep(time.Duration(attempt+1) * 15 * time.Millisecond)
			continue
		}
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to update squad: "+procErr.Error())
		return
	}

	writeJSON(r.Context(), w, http.StatusOK, teamUpdatedResponse{
		TeamID:    teamID,
		TeamName:  name,
		SlotIndex: slotIndex,
	})
}

// handleDisbandTeam disbands an empty squad during draft state.
func (s *Server) handleDisbandTeam(w http.ResponseWriter, r *http.Request) {
	gameID := chi.URLParam(r, "game_id")
	teamID := chi.URLParam(r, "team_id")

	game, ok := s.authorizeSquadEdit(w, r, gameID, teamID)
	if !ok {
		return
	}
	if game.Status != "draft" {
		writeError(r.Context(), w, http.StatusForbidden, "the race has started, so squads can no longer be disbanded")
		return
	}

	payload, _ := json.Marshal(eventstore.TeamDisbandedPayload{TeamID: teamID})

	for attempt := 0; ; attempt++ {
		expectedSeq, seqErr := s.nextSequence(r.Context(), gameID)
		if seqErr != nil {
			writeError(r.Context(), w, http.StatusInternalServerError, "failed to resolve sequence: "+seqErr.Error())
			return
		}

		_, procErr := s.CmdProcessor.Process(r.Context(), commands.CommandRequest{
			GameID:      gameID,
			CommandType: "TeamDisbanded",
			ExpectedSeq: expectedSeq,
			Payload:     payload,
		}, func(ctx context.Context, tx pgx.Tx, cr commands.CommandRequest) (*commands.CommandResult, error) {
			// Check team membership within the transaction to prevent disbanding populated teams.
			remaining, err := s.countTeamPlayers(ctx, tx, gameID, teamID)
			if err != nil {
				return nil, fmt.Errorf("failed to count the squad: %w", err)
			}
			if remaining > 0 {
				return nil, errSquadOccupied
			}
			if err := deleteTeamTx(ctx, tx, gameID, teamID); err != nil {
				return nil, err
			}
			return &commands.CommandResult{
				ResponseCode: http.StatusNoContent,
				Events:       []eventstore.Event{{Type: "TeamDisbanded", Payload: string(cr.Payload)}},
			}, nil
		})

		if procErr == nil {
			break
		}
		if errors.Is(procErr, errSquadOccupied) {
			writeError(r.Context(), w, http.StatusConflict, "someone is still on that squad")
			return
		}
		var pgErr *pgconn.PgError
		lostSequenceRace := errors.Is(procErr, eventstore.ErrConcurrencyConflict) ||
			(errors.As(procErr, &pgErr) && pgErr.Code == pgUniqueViolation)
		if lostSequenceRace && attempt < joinSequenceRetries {
			time.Sleep(time.Duration(attempt+1) * 15 * time.Millisecond)
			continue
		}
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to disband squad: "+procErr.Error())
		return
	}

	w.WriteHeader(http.StatusNoContent)
}
