package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v4"

	"github.com/Jessevdz/RunwayTheGame/internal/commands"
	"github.com/Jessevdz/RunwayTheGame/internal/eventstore"
	"github.com/Jessevdz/RunwayTheGame/internal/projections"
)

// OverrideCoinsRequest adjusts a team's coin balance by a signed delta.
type OverrideCoinsRequest struct {
	TeamID string `json:"team_id"`
	Delta  int    `json:"delta"`
	Note   string `json:"note"`
}

// OverrideClearChallengeRequest payload for manually completing a challenge for a team.
type OverrideClearChallengeRequest struct {
	TeamID     string `json:"team_id"`
	WaypointID string `json:"waypoint_id"`
	Note       string `json:"note"`
	AwardCoins *bool  `json:"award_coins,omitempty"` // defaults to true when omitted
}

// OverrideClearEffectRequest payload for removing an active effect from a team.
type OverrideClearEffectRequest struct {
	TeamID     string `json:"team_id"`
	EffectType string `json:"effect_type"` // "freeze" | "curse" | "veto_penalty" | "tracker_off"
	Note       string `json:"note"`
}

// coinOverrideResponse reports a team's coin balance after an override is applied.
type coinOverrideResponse struct {
	NewBalance   int `json:"new_balance"`
	AppliedDelta int `json:"applied_delta"`
}

// handleOverrideCoins adjusts a team's coin balance by a signed delta via host intervention.
func (s *Server) handleOverrideCoins(w http.ResponseWriter, r *http.Request) {
	gameID := chi.URLParam(r, "game_id")

	var req OverrideCoinsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(r.Context(), w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.TeamID == "" || req.Note == "" {
		writeError(r.Context(), w, http.StatusBadRequest, "team_id and note are required")
		return
	}

	proj, err := projections.RebuildProjection(r.Context(), s.DB.Pool, gameID, 0)
	if err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to load game state")
		return
	}
	if _, ok := proj.Teams[req.TeamID]; !ok {
		writeError(r.Context(), w, http.StatusNotFound, "team not found in game")
		return
	}

	expectedSeq, err := s.nextSequence(r.Context(), gameID)
	if err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to resolve sequence")
		return
	}

	cmdReq := commands.CommandRequest{
		GameID:      gameID,
		CommandType: "CoinsChanged",
		ExpectedSeq: expectedSeq,
		// The payload is constructed during transaction processing from the resolved balance.
		Payload: []byte(`{}`),
	}

	// Written by the transaction, read after it commits.
	var appliedDelta, newBalance int

	_, err = s.CmdProcessor.Process(r.Context(), cmdReq, func(ctx context.Context, tx pgx.Tx, cr commands.CommandRequest) (*commands.CommandResult, error) {
		// Read current balance with row lock to avoid race conditions.
		var prior int
		switch err := tx.QueryRow(ctx, `
			SELECT balance FROM team_coins WHERE game_id = $1 AND team_id = $2 FOR UPDATE
		`, gameID, req.TeamID).Scan(&prior); {
		case errors.Is(err, pgx.ErrNoRows):
			prior = 0
		case err != nil:
			return nil, err
		}

		// Update balance while ensuring the resulting value is non-negative.
		if err := tx.QueryRow(ctx, `
			INSERT INTO team_coins (game_id, team_id, balance)
			VALUES ($1, $2, GREATEST($3, 0))
			ON CONFLICT (game_id, team_id)
			DO UPDATE SET balance = GREATEST(team_coins.balance + $3, 0)
			RETURNING balance
		`, gameID, req.TeamID, req.Delta).Scan(&newBalance); err != nil {
			return nil, err
		}

		// Calculate applied delta from prior balance.
		appliedDelta = newBalance - prior

		payloadBytes, err := json.Marshal(eventstore.CoinsChangedPayload{
			TeamID:       req.TeamID,
			Delta:        appliedDelta,
			BalanceAfter: newBalance,
			Reason:       "gm_override",
			Source:       "gm",
			Note:         req.Note,
		})
		if err != nil {
			return nil, err
		}

		return &commands.CommandResult{
			ResponseCode: http.StatusOK,
			ResponseBody: coinOverrideResponse{NewBalance: newBalance, AppliedDelta: appliedDelta},
			Events: []eventstore.Event{
				{Type: "CoinsChanged", Payload: string(payloadBytes)},
			},
		}, nil
	})
	if err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to adjust coins: "+err.Error())
		return
	}

	writeJSON(r.Context(), w, http.StatusOK, coinOverrideResponse{NewBalance: newBalance, AppliedDelta: appliedDelta})
}

// handleOverrideClearChallenge force-completes a challenge for a team via host override.
func (s *Server) handleOverrideClearChallenge(w http.ResponseWriter, r *http.Request) {
	gameID := chi.URLParam(r, "game_id")

	var req OverrideClearChallengeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(r.Context(), w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.TeamID == "" || req.WaypointID == "" || req.Note == "" {
		writeError(r.Context(), w, http.StatusBadRequest, "team_id, waypoint_id and note are required")
		return
	}
	awardCoins := true
	if req.AwardCoins != nil {
		awardCoins = *req.AwardCoins
	}

	game, err := s.loadGame(r.Context(), gameID)
	if err != nil {
		writeError(r.Context(), w, http.StatusNotFound, "game not found")
		return
	}

	proj, err := projections.RebuildProjection(r.Context(), s.DB.Pool, gameID, 0)
	if err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to load game state")
		return
	}
	if _, ok := proj.Teams[req.TeamID]; !ok {
		writeError(r.Context(), w, http.StatusNotFound, "team not found in game")
		return
	}

	var challengeID string
	var coinReward int
	err = s.DB.Pool.QueryRow(r.Context(), `
		SELECT id::text, coin_reward FROM challenges
		WHERE board_id = $1 AND board_version = $2 AND waypoint_id = $3
	`, game.BoardID, game.BoardVersion, req.WaypointID).Scan(&challengeID, &coinReward)
	if err != nil {
		err = s.DB.Pool.QueryRow(r.Context(), `
			SELECT c.id::text, c.coin_reward
			FROM challenges c
			JOIN board_roads s ON s.challenge_id = c.id
			WHERE s.board_id = $1 AND s.board_version = $2 AND s.id = $3
		`, game.BoardID, game.BoardVersion, req.WaypointID).Scan(&challengeID, &coinReward)
		if err != nil {
			writeError(r.Context(), w, http.StatusNotFound, "challenge definition not found for waypoint")
			return
		}
	}
	if !awardCoins {
		coinReward = 0
	}

	completedPayload, _ := json.Marshal(eventstore.ChallengeCompletedPayload{
		WaypointID:     req.WaypointID,
		ChallengeID:    challengeID,
		TeamID:         req.TeamID,
		CoinReward:     coinReward,
		FirstCompleter: true,
		Source:         "gm",
		Note:           req.Note,
	})

	expectedSeq, err := s.nextSequence(r.Context(), gameID)
	if err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to resolve sequence")
		return
	}

	cmdReq := commands.CommandRequest{
		GameID:      gameID,
		CommandType: "ChallengeCompleted",
		ExpectedSeq: expectedSeq,
		Payload:     completedPayload,
	}
	_, err = s.CmdProcessor.Process(r.Context(), cmdReq, func(ctx context.Context, tx pgx.Tx, cr commands.CommandRequest) (*commands.CommandResult, error) {
		events := []eventstore.Event{{Type: "ChallengeCompleted", Payload: string(cr.Payload)}}

		_, dbErr := tx.Exec(ctx, `
			INSERT INTO road_progress (game_id, road_id, completed_by, completed_at)
			VALUES ($1, $2, $3, NOW())
			ON CONFLICT (game_id, road_id) DO UPDATE SET completed_by = EXCLUDED.completed_by
		`, gameID, req.WaypointID, req.TeamID)
		if dbErr != nil {
			return nil, dbErr
		}

		if coinReward > 0 {
			var newBalance int
			dbErr = tx.QueryRow(ctx, `
				INSERT INTO team_coins (game_id, team_id, balance)
				VALUES ($1, $2, $3)
				ON CONFLICT (game_id, team_id)
				DO UPDATE SET balance = team_coins.balance + EXCLUDED.balance
				RETURNING balance
			`, gameID, req.TeamID, coinReward).Scan(&newBalance)
			if dbErr != nil {
				return nil, dbErr
			}
			coinsBytes, _ := json.Marshal(eventstore.CoinsChangedPayload{
				TeamID:       req.TeamID,
				Delta:        coinReward,
				BalanceAfter: newBalance,
				Reason:       "gm_override",
				Source:       "gm",
				Note:         req.Note,
			})
			events = append(events, eventstore.Event{Type: "CoinsChanged", Payload: string(coinsBytes)})
		}

		return &commands.CommandResult{
			ResponseCode: http.StatusOK,
			ResponseBody: statusResponse{Status: "cleared"},
			Events:       events,
		}, nil
	})
	if err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to clear challenge: "+err.Error())
		return
	}

	writeJSON(r.Context(), w, http.StatusOK, statusResponse{Status: "cleared"})
}

// handleOverrideClearEffect removes an active effect from a team before standard expiration.
func (s *Server) handleOverrideClearEffect(w http.ResponseWriter, r *http.Request) {
	gameID := chi.URLParam(r, "game_id")

	var req OverrideClearEffectRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(r.Context(), w, http.StatusBadRequest, "invalid request body")
		return
	}
	validEffectTypes := map[string]bool{"freeze": true, "curse": true, "veto_penalty": true, "tracker_off": true}
	if req.TeamID == "" || req.Note == "" || !validEffectTypes[req.EffectType] {
		writeError(r.Context(), w, http.StatusBadRequest, "team_id, note, and a valid effect_type ('freeze', 'curse', 'veto_penalty', 'tracker_off') are required")
		return
	}

	proj, err := projections.RebuildProjection(r.Context(), s.DB.Pool, gameID, 0)
	if err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to load game state")
		return
	}
	if _, ok := proj.Teams[req.TeamID]; !ok {
		writeError(r.Context(), w, http.StatusNotFound, "team not found in game")
		return
	}

	now := time.Now().UTC()
	hasEffect := false
	for _, eff := range proj.Effects[req.TeamID] {
		if eff.Kind == req.EffectType && now.Before(eff.Until) {
			hasEffect = true
			break
		}
	}
	if !hasEffect {
		writeError(r.Context(), w, http.StatusNotFound, "team has no active effect of that type")
		return
	}

	payloadBytes, _ := json.Marshal(eventstore.EffectClearedPayload{
		TeamID:     req.TeamID,
		EffectType: req.EffectType,
		Note:       req.Note,
	})

	expectedSeq, err := s.nextSequence(r.Context(), gameID)
	if err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to resolve sequence")
		return
	}

	cmdReq := commands.CommandRequest{
		GameID:      gameID,
		CommandType: "EffectCleared",
		ExpectedSeq: expectedSeq,
		Payload:     payloadBytes,
	}
	_, err = s.CmdProcessor.Process(r.Context(), cmdReq, func(ctx context.Context, tx pgx.Tx, cr commands.CommandRequest) (*commands.CommandResult, error) {
		_, dbErr := tx.Exec(ctx, `
			DELETE FROM team_effects WHERE game_id = $1 AND team_id = $2 AND kind = $3
		`, gameID, req.TeamID, req.EffectType)
		if dbErr != nil {
			return nil, dbErr
		}
		return &commands.CommandResult{
			ResponseCode: http.StatusOK,
			ResponseBody: statusResponse{Status: "cleared"},
			Events: []eventstore.Event{
				{Type: "EffectCleared", Payload: string(cr.Payload)},
			},
		}, nil
	})
	if err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to clear effect: "+err.Error())
		return
	}

	writeJSON(r.Context(), w, http.StatusOK, statusResponse{Status: "cleared"})
}
