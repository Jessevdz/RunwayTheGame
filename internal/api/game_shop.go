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
	"github.com/jackc/pgx/v4"

	"github.com/Jessevdz/RunwayTheGame/internal/commands"
	"github.com/Jessevdz/RunwayTheGame/internal/eventstore"
	"github.com/Jessevdz/RunwayTheGame/internal/projections"
	"github.com/Jessevdz/RunwayTheGame/internal/rules"
)

type ShopBuyRequest struct {
	Powerup        string `json:"powerup"`
	IdempotencyKey string `json:"idempotency_key"`
}

type PowerupUseRequest struct {
	Powerup        string `json:"powerup"`
	TargetTeamID   string `json:"target_team_id,omitempty"`
	RoadID         string `json:"road_id,omitempty"`
	IdempotencyKey string `json:"idempotency_key"`
}

type challengeSkipTarget struct {
	WaypointID  string
	RoadID      string
	ChallengeID string
	BypassID    string
}

func resolveChallengeSkipTarget(board rules.Board, currentWaypointID, requestedID string) (challengeSkipTarget, error) {
	if currentWaypointID == "" || requestedID == "" {
		return challengeSkipTarget{}, fmt.Errorf("you must be standing at a challenge to skip it")
	}
	for _, wp := range board.Waypoints {
		if wp.ID != requestedID && wp.ChallengeID != requestedID {
			continue
		}
		if wp.ID != currentWaypointID {
			return challengeSkipTarget{}, fmt.Errorf("you can only skip the challenge at your current waypoint")
		}
		challengeID := wp.ChallengeID
		if challengeID == "" {
			for _, ch := range board.Challenges {
				if ch.WaypointID == wp.ID {
					challengeID = ch.ID
					break
				}
			}
		}
		if challengeID == "" {
			return challengeSkipTarget{}, fmt.Errorf("your current waypoint has no challenge to skip")
		}
		return challengeSkipTarget{WaypointID: wp.ID, ChallengeID: challengeID, BypassID: wp.ID}, nil
	}
	for _, road := range board.Roads {
		if road.ID != requestedID && road.ChallengeID != requestedID {
			continue
		}
		if road.WaypointIDA != currentWaypointID && road.WaypointIDB != currentWaypointID {
			return challengeSkipTarget{}, fmt.Errorf("you can only skip a challenge on a road next to your current waypoint")
		}
		if road.ChallengeID == "" {
			return challengeSkipTarget{}, fmt.Errorf("that road has no challenge to skip")
		}
		return challengeSkipTarget{WaypointID: currentWaypointID, RoadID: road.ID, ChallengeID: road.ChallengeID, BypassID: road.ID}, nil
	}
	return challengeSkipTarget{}, fmt.Errorf("challenge target not found on the board")
}

// powerupResponse acknowledges a power-up bought or used, naming which one.
type powerupResponse struct {
	Status  string `json:"status"`
	Powerup string `json:"powerup"`
}

// powerupEffect maps power-up identifiers to their associated effect names.
func powerupEffect(board rules.Board, powerupID string) string {
	for _, pu := range board.Powerups {
		if pu.ID == powerupID {
			return rules.EffectivePowerupEffect(pu)
		}
	}
	return powerupID
}

// soloBlocksPowerup checks whether a power-up can be used in solo mode.
func soloBlocksPowerup(mode string, board rules.Board, powerupID string) (string, bool) {
	if !rules.IsSoloMode(mode) {
		return "", false
	}
	if rules.SoloAllowsEffect(powerupEffect(board, powerupID)) {
		return "", false
	}
	return "that power-up needs an opposing team, and a solo run has none", true
}

func (s *Server) handleShopBuy(w http.ResponseWriter, r *http.Request) {
	gameID := chi.URLParam(r, "game_id")

	var req ShopBuyRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(r.Context(), w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Powerup == "" || req.IdempotencyKey == "" {
		writeError(r.Context(), w, http.StatusBadRequest, "powerup and idempotency_key are required")
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

	proj, err := projections.RebuildProjection(r.Context(), s.DB.Pool, gameID, 0)
	if err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to load game state")
		return
	}
	effect := powerupEffect(proj.Board, req.Powerup)
	if !rules.IsSupportedPowerupEffect(effect) {
		writeError(r.Context(), w, http.StatusConflict, "configured power-up effect is not supported")
		return
	}

	if reason, blocked := soloBlocksPowerup(game.Mode, proj.Board, req.Powerup); blocked {
		writeError(r.Context(), w, http.StatusForbidden, reason)
		return
	}
	if reason, locked := coinRushLocksOut(game.Mode, proj.Progress[team.ID]); locked {
		writeError(r.Context(), w, http.StatusForbidden, reason)
		return
	}

	// Determine power-up purchase cost from board configuration or ruleset defaults.
	cost, exists := proj.Board.PowerupCosts[req.Powerup]
	if !exists {
		cost, exists = game.Ruleset.PowerupCost(req.Powerup)
		if !exists {
			writeError(r.Context(), w, http.StatusBadRequest, "unknown powerup")
			return
		}
	}
	if cost < 0 {
		writeError(r.Context(), w, http.StatusConflict, "configured power-up cost is invalid")
		return
	}
	for _, powerup := range proj.Board.Powerups {
		if powerup.ID == req.Powerup && (powerup.DurationS < 0 || powerup.DurationS > rules.MaxPowerupDurationSeconds) {
			writeError(r.Context(), w, http.StatusConflict, "configured power-up duration is invalid")
			return
		}
	}

	balance := proj.Coins[team.ID]
	if balance < cost {
		writeError(r.Context(), w, http.StatusPaymentRequired, "insufficient coins")
		return
	}

	payloadBytes, _ := json.Marshal(eventstore.PowerupPurchasedPayload{
		TeamID:  team.ID,
		Powerup: req.Powerup,
		Cost:    cost,
	})

	expectedSeq := proj.LastSequence + 1

	cmdReq := commands.CommandRequest{
		GameID:             gameID,
		CommandType:        "PowerupPurchased",
		PrincipalID:        team.ID,
		IdempotencyPayload: idempotencyPayload(req),
		ExpectedSeq:        expectedSeq,
		IdempotencyKey:     req.IdempotencyKey,
		Payload:            payloadBytes,
	}

	response, err := s.CmdProcessor.Process(r.Context(), cmdReq, func(ctx context.Context, tx pgx.Tx, cr commands.CommandRequest) (*commands.CommandResult, error) {
		if err := guardLiveGameMutation(ctx, tx, gameID, proj); err != nil {
			return nil, err
		}
		// Deduct coin balance within transaction and verify non-negative balance.
		var newBalance int
		dbErr := tx.QueryRow(ctx, `
			INSERT INTO team_coins (game_id, team_id, balance)
			VALUES ($1, $2, 0 - $3)
			ON CONFLICT (game_id, team_id)
			DO UPDATE SET balance = team_coins.balance - $3
			RETURNING balance
		`, gameID, team.ID, cost).Scan(&newBalance)
		if dbErr != nil {
			return nil, dbErr
		}
		// Verify coin balance is non-negative after deduction.
		if newBalance < 0 {
			return nil, errInsufficientCoins
		}

		coinsBytes, _ := json.Marshal(eventstore.CoinsChangedPayload{
			TeamID:       team.ID,
			Delta:        -cost,
			BalanceAfter: newBalance,
			Reason:       "powerup_purchase",
		})

		return &commands.CommandResult{
			ResponseCode: http.StatusOK,
			ResponseBody: powerupResponse{Status: "purchased", Powerup: req.Powerup},
			Events: []eventstore.Event{
				{Type: "PowerupPurchased", Payload: string(cr.Payload)},
				{Type: "CoinsChanged", Payload: string(coinsBytes)},
			},
		}, nil
	})
	if errors.Is(err, errInsufficientCoins) {
		// Return 402 if concurrent spending depleted coins.
		writeError(r.Context(), w, http.StatusPaymentRequired, "insufficient coins")
		return
	}
	if err != nil {
		if writeGameMutationGuardError(r.Context(), w, err) {
			return
		}
		if writeConcurrencyConflict(r.Context(), w, err) {
			return
		}
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to purchase powerup: "+err.Error())
		return
	}

	writeCommandResponse(r.Context(), w, response)
}

func (s *Server) handlePowerupUse(w http.ResponseWriter, r *http.Request) {
	gameID := chi.URLParam(r, "game_id")

	var req PowerupUseRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(r.Context(), w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Powerup == "" || req.IdempotencyKey == "" {
		writeError(r.Context(), w, http.StatusBadRequest, "powerup and idempotency_key are required")
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

	proj, err := projections.RebuildProjection(r.Context(), s.DB.Pool, gameID, 0)
	if err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to load game state")
		return
	}

	hasPowerup := false
	for _, pu := range proj.Inventory[team.ID] {
		if pu == req.Powerup {
			hasPowerup = true
			break
		}
	}
	if !hasPowerup {
		writeError(r.Context(), w, http.StatusForbidden, "powerup not in inventory")
		return
	}
	effect := powerupEffect(proj.Board, req.Powerup)
	if !rules.IsSupportedPowerupEffect(effect) {
		writeError(r.Context(), w, http.StatusConflict, "configured power-up effect is not supported")
		return
	}

	// Validate power-up usage restrictions for solo mode.
	if reason, blocked := soloBlocksPowerup(game.Mode, proj.Board, req.Powerup); blocked {
		writeError(r.Context(), w, http.StatusForbidden, reason)
		return
	}
	if reason, locked := coinRushLocksOut(game.Mode, proj.Progress[team.ID]); locked {
		writeError(r.Context(), w, http.StatusForbidden, reason)
		return
	}

	now := time.Now().UTC()
	events := []eventstore.Event{}
	skipBypassID := ""

	switch effect {
	case "nerf":
		if req.TargetTeamID == "" {
			writeError(r.Context(), w, http.StatusBadRequest, "target_team_id is required for nerf")
			return
		}
		if _, ok := proj.Teams[req.TargetTeamID]; !ok {
			writeError(r.Context(), w, http.StatusNotFound, "target team not found in game")
			return
		}
		if req.TargetTeamID == team.ID {
			writeError(r.Context(), w, http.StatusBadRequest, "you cannot target your own team")
			return
		}
		if proj.Progress[req.TargetTeamID].ReachedFinish {
			writeError(r.Context(), w, http.StatusConflict, "target team has already finished")
			return
		}
		until := now.Add(game.Ruleset.FreezeDuration())
		payload, _ := json.Marshal(eventstore.TeamFrozenPayload{
			TeamID: req.TargetTeamID,
			Until:  until,
			Source: team.ID,
		})
		events = append(events, eventstore.Event{Type: "TeamFrozen", Payload: string(payload)})

	case "tracker_off":
		until := now.Add(game.Ruleset.TrackerOffDuration())
		payload, _ := json.Marshal(eventstore.TrackerToggledPayload{
			TeamID:   team.ID,
			Disabled: true,
			Until:    until,
		})
		events = append(events, eventstore.Event{Type: "TrackerToggled", Payload: string(payload)})

	case "roadblock":
		if req.RoadID == "" {
			writeError(r.Context(), w, http.StatusBadRequest, "road_id is required for roadblock")
			return
		}
		roadFound := false
		for _, road := range proj.Board.Roads {
			if road.ID == req.RoadID {
				roadFound = true
				break
			}
		}
		if !roadFound {
			writeError(r.Context(), w, http.StatusNotFound, "road not found on board")
			return
		}
		if existing, ok := proj.Roadblocks[req.RoadID]; ok {
			cleared := false
			for _, didClear := range existing.ClearedBy {
				if didClear {
					cleared = true
					break
				}
			}
			if !cleared {
				writeError(r.Context(), w, http.StatusConflict, "road already has an uncleared roadblock")
				return
			}
		}

		var cardID, cardText string
		err = s.DB.Pool.QueryRow(r.Context(), `
			SELECT id::text, text FROM board_roadblock_cards
			WHERE board_id = $1 AND board_version = $2
			ORDER BY RANDOM() LIMIT 1
		`, game.BoardID, game.BoardVersion).Scan(&cardID, &cardText)
		if err != nil {
			cardID = uuid.New().String()
			cardText = "Perform 10 pushups."
		}

		drawPayload, _ := json.Marshal(eventstore.CardDrawnPayload{
			TeamID: team.ID,
			CardID: cardID,
			Text:   cardText,
			Deck:   "roadblock",
		})
		events = append(events, eventstore.Event{Type: "CardDrawn", Payload: string(drawPayload)})

		// The card ID travels with placement for evidence submission.
		payload, _ := json.Marshal(eventstore.RoadblockPlacedPayload{
			RoadID:        req.RoadID,
			PlacedBy:      team.ID,
			CardID:        cardID,
			ChallengeText: cardText,
		})
		events = append(events, eventstore.Event{Type: "RoadblockPlaced", Payload: string(payload)})

	case "curse":
		if req.TargetTeamID == "" {
			writeError(r.Context(), w, http.StatusBadRequest, "target_team_id is required for curse")
			return
		}
		if _, ok := proj.Teams[req.TargetTeamID]; !ok {
			writeError(r.Context(), w, http.StatusNotFound, "target team not found in game")
			return
		}
		if req.TargetTeamID == team.ID {
			writeError(r.Context(), w, http.StatusBadRequest, "you cannot target your own team")
			return
		}
		if proj.Progress[req.TargetTeamID].ReachedFinish {
			writeError(r.Context(), w, http.StatusConflict, "target team has already finished")
			return
		}

		var cardID, cardText string
		err = s.DB.Pool.QueryRow(r.Context(), `
			SELECT id::text, text FROM board_curse_cards
			WHERE board_id = $1 AND board_version = $2
			ORDER BY RANDOM() LIMIT 1
		`, game.BoardID, game.BoardVersion).Scan(&cardID, &cardText)
		if err != nil {
			cardID = uuid.New().String()
			cardText = "Subtract 10 coins on your next waypoint check-in."
		}

		drawPayload, _ := json.Marshal(eventstore.CardDrawnPayload{
			TeamID: team.ID,
			CardID: cardID,
			Text:   cardText,
			Deck:   "curse",
		})
		events = append(events, eventstore.Event{Type: "CardDrawn", Payload: string(drawPayload)})

		until := now.Add(game.Ruleset.CurseDuration())
		payload, _ := json.Marshal(eventstore.CurseAppliedPayload{
			ByTeamID:     team.ID,
			TargetTeamID: req.TargetTeamID,
			CardID:       cardID,
			Text:         cardText,
			Until:        until,
		})
		events = append(events, eventstore.Event{Type: "CurseApplied", Payload: string(payload)})

	case "challenge_skip":
		target, err := resolveChallengeSkipTarget(proj.Board, proj.Progress[team.ID].CurrentWaypointID, req.RoadID)
		if err != nil {
			writeError(r.Context(), w, http.StatusBadRequest, err.Error())
			return
		}
		skipBypassID = target.BypassID

		payload, _ := json.Marshal(eventstore.ChallengeSkippedPayload{
			TeamID:      team.ID,
			WaypointID:  target.WaypointID,
			RoadID:      target.RoadID,
			ChallengeID: target.ChallengeID,
		})
		events = append(events, eventstore.Event{Type: "ChallengeSkipped", Payload: string(payload)})

	default:
		writeError(r.Context(), w, http.StatusBadRequest, "unsupported powerup type")
		return
	}

	usePayload, _ := json.Marshal(eventstore.PowerupUsedPayload{
		TeamID:  team.ID,
		Powerup: req.Powerup,
	})
	events = append([]eventstore.Event{{Type: "PowerupUsed", Payload: string(usePayload)}}, events...)

	expectedSeq := proj.LastSequence + 1

	cmdReq := commands.CommandRequest{
		GameID:             gameID,
		CommandType:        "PowerupUsed",
		PrincipalID:        team.ID,
		IdempotencyPayload: idempotencyPayload(req),
		ExpectedSeq:        expectedSeq,
		IdempotencyKey:     req.IdempotencyKey,
		Payload:            usePayload,
	}

	response, err := s.CmdProcessor.Process(r.Context(), cmdReq, func(ctx context.Context, tx pgx.Tx, cr commands.CommandRequest) (*commands.CommandResult, error) {
		if err := guardLiveGameMutation(ctx, tx, gameID, proj); err != nil {
			return nil, err
		}
		// Persist effect state changes in database tables alongside events.
		const insertEffect = `
			INSERT INTO team_effects (id, game_id, team_id, kind, until, meta)
			VALUES ($1, $2, $3, $4, $5, to_jsonb($6::text))
		`
		for _, ev := range events {
			switch ev.Type {
			case "TeamFrozen":
				var p eventstore.TeamFrozenPayload
				if err := json.Unmarshal([]byte(ev.Payload), &p); err != nil {
					return nil, fmt.Errorf("decoding TeamFrozen: %w", err)
				}
				if _, err := tx.Exec(ctx, insertEffect,
					uuid.New().String(), gameID, p.TeamID, "freeze", p.Until, p.Source); err != nil {
					return nil, fmt.Errorf("recording the freeze: %w", err)
				}
			case "CurseApplied":
				var p eventstore.CurseAppliedPayload
				if err := json.Unmarshal([]byte(ev.Payload), &p); err != nil {
					return nil, fmt.Errorf("decoding CurseApplied: %w", err)
				}
				if _, err := tx.Exec(ctx, insertEffect,
					uuid.New().String(), gameID, p.TargetTeamID, "curse", p.Until, p.CardID); err != nil {
					return nil, fmt.Errorf("recording the curse: %w", err)
				}
			case "TrackerToggled":
				var p eventstore.TrackerToggledPayload
				if err := json.Unmarshal([]byte(ev.Payload), &p); err != nil {
					return nil, fmt.Errorf("decoding TrackerToggled: %w", err)
				}
				if _, err := tx.Exec(ctx, insertEffect,
					uuid.New().String(), gameID, p.TeamID, "tracker_off", p.Until, ""); err != nil {
					return nil, fmt.Errorf("recording the tracker blackout: %w", err)
				}
			case "RoadblockPlaced":
				var p eventstore.RoadblockPlacedPayload
				if err := json.Unmarshal([]byte(ev.Payload), &p); err != nil {
					return nil, fmt.Errorf("decoding RoadblockPlaced: %w", err)
				}
				if _, err := tx.Exec(ctx, `
					INSERT INTO placed_roadblocks (id, game_id, road_id, placed_by, card_id, challenge_text)
					VALUES ($1, $2, $3, $4, $5, $6)
				`, uuid.New().String(), gameID, p.RoadID, p.PlacedBy, uuid.New().String(), p.ChallengeText); err != nil {
					return nil, fmt.Errorf("placing the roadblock: %w", err)
				}
			case "ChallengeSkipped":
				if _, err := tx.Exec(ctx, `
					INSERT INTO team_road_bypass (game_id, team_id, road_id, reason)
					VALUES ($1, $2, $3, 'skip')
					ON CONFLICT (game_id, team_id, road_id) DO UPDATE SET reason = EXCLUDED.reason
				`, gameID, team.ID, skipBypassID); err != nil {
					return nil, fmt.Errorf("recording the skip: %w", err)
				}
			}
		}

		return &commands.CommandResult{
			ResponseCode: http.StatusOK,
			ResponseBody: powerupResponse{Status: "used", Powerup: req.Powerup},
			Events:       events,
		}, nil
	})
	if err != nil {
		if writeGameMutationGuardError(r.Context(), w, err) {
			return
		}
		if writeConcurrencyConflict(r.Context(), w, err) {
			return
		}
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to use powerup: "+err.Error())
		return
	}

	writeCommandResponse(r.Context(), w, response)
}
