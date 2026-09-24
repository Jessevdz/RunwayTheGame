package projections

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/Jessevdz/RunwayTheGame/internal/eventstore"
	"github.com/Jessevdz/RunwayTheGame/internal/logger"
	"github.com/Jessevdz/RunwayTheGame/internal/rules"
)

// foldCtx holds contextual resources passed to fold handlers.
type foldCtx struct {
	ctx  context.Context
	conn eventstore.DBConnection
}

// foldFunc applies a single event to a GameStateProjection.
type foldFunc func(fc foldCtx, p *GameStateProjection, e eventstore.Event) error

// folds maps event type names to their corresponding fold handler functions.
var folds = map[string]foldFunc{
	"GameCreated": strict(foldGameCreated),
	"GameStarted": foldGameStarted,
	"GameEnded":   foldGameEnded,

	"TeamJoined":    strict(foldTeamJoined),
	"TeamUpdated":   strict(foldTeamUpdated),
	"TeamDisbanded": strict(foldTeamDisbanded),

	"ChallengeAttemptStarted": lenient(foldChallengeAttemptStarted),
	"SubmissionCreated":       lenient(foldSubmissionCreated),
	"VerdictReturned":         lenient(foldVerdictReturned),
	"ChallengeCompleted":      lenient(foldChallengeCompleted),
	"ChallengeRevoked":        lenient(foldChallengeRevoked),
	"ChallengeVetoed":         lenient(foldChallengeVetoed),
	"ChallengeSkipped":        lenient(foldChallengeSkipped),
	"ChallengeConflictNoted":  lenient(foldChallengeConflictNoted),

	"WaypointReached": lenient(foldWaypointReached),
	"TeamFinished":    lenient(foldTeamFinished),
	"ArrivalFlagged":  lenient(foldArrivalFlagged),

	"CoinsChanged":     lenient(foldCoinsChanged),
	"PowerupPurchased": lenient(foldPowerupPurchased),
	"PowerupUsed":      lenient(foldPowerupUsed),
	"CardDrawn":        lenient(foldCardDrawn),

	"RoadblockPlaced":       lenient(foldRoadblockPlaced),
	"RoadblockCleared":      lenient(foldRoadblockCleared),
	"RoadblockClearRevoked": lenient(foldRoadblockClearRevoked),
	"CurseApplied":          lenient(foldCurseApplied),
	"CurseCleared":          lenient(foldCurseCleared),
	"TeamFrozen":            lenient(foldTeamFrozen),
	"TrackerToggled":        lenient(foldTrackerToggled),
	"EffectCleared":         lenient(foldEffectCleared),

	"DisputeRaised":   lenient(foldDisputeRaised),
	"DisputeResolved": lenient(foldDisputeResolved),
}

func legacyChallengeSkipPayload(board rules.Board, previous, event eventstore.Event) (eventstore.ChallengeSkippedPayload, bool) {
	if previous.Type != "PowerupUsed" || event.Type != "ChallengeVetoed" {
		return eventstore.ChallengeSkippedPayload{}, false
	}
	var used eventstore.PowerupUsedPayload
	if err := json.Unmarshal([]byte(previous.Payload), &used); err != nil {
		return eventstore.ChallengeSkippedPayload{}, false
	}
	effect := used.Powerup
	for _, powerup := range board.Powerups {
		if powerup.ID == used.Powerup {
			effect = rules.EffectivePowerupEffect(powerup)
			break
		}
	}
	if effect != "challenge_skip" {
		return eventstore.ChallengeSkippedPayload{}, false
	}
	var veto eventstore.ChallengeVetoedPayload
	if err := json.Unmarshal([]byte(event.Payload), &veto); err != nil {
		return eventstore.ChallengeSkippedPayload{}, false
	}
	return eventstore.ChallengeSkippedPayload{
		TeamID:      veto.TeamID,
		WaypointID:  veto.WaypointID,
		RoadID:      veto.RoadID,
		ChallengeID: veto.ChallengeID,
	}, true
}

// RebuildProjection builds the state projection up to sequence number upToSeq.
func RebuildProjection(ctx context.Context, conn eventstore.DBConnection, gameID string, upToSeq int) (*GameStateProjection, error) {
	stream, err := eventstore.GetEventStream(ctx, conn, gameID, upToSeq)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch event stream for projection: %w", err)
	}

	p := emptyProjection(gameID)
	fc := foldCtx{ctx: ctx, conn: conn}

	for i, event := range stream {
		p.LastSequence = event.Sequence
		if i > 0 {
			if skipped, ok := legacyChallengeSkipPayload(p.Board, stream[i-1], event); ok {
				foldChallengeSkipped(p, event, skipped)
				continue
			}
		}
		fold, ok := folds[event.Type]
		if !ok {
			// Log an error if an unhandled event type is encountered during projection rebuild.
			logger.Error(ctx, "projection: no fold for event type, read model may diverge from the log", map[string]interface{}{
				"game_id":    gameID,
				"sequence":   event.Sequence,
				"event_type": event.Type,
			})
			continue
		}
		if err := fold(fc, p, event); err != nil {
			return nil, err
		}
	}
	if p.Board.ID == "" {
		return nil, fmt.Errorf("failed to initialize projection for game %s: event stream has no GameCreated board", gameID)
	}

	if err := hydratePositions(ctx, conn, gameID, p); err != nil {
		return nil, fmt.Errorf("failed to hydrate positions: %w", err)
	}

	if err := hydrateRuleset(ctx, conn, gameID, p); err != nil {
		return nil, fmt.Errorf("failed to hydrate game ruleset: %w", err)
	}

	// Calculate the coin rush deadline before computing standings.
	applyCoinRushDeadline(p)

	computeStandings(p)

	return p, nil
}

// strict adapts a fold handler that aborts projection rebuild if payload unmarshaling fails.
func strict[P any](apply func(fc foldCtx, p *GameStateProjection, e eventstore.Event, payload P) error) foldFunc {
	return func(fc foldCtx, p *GameStateProjection, e eventstore.Event) error {
		var payload P
		if err := json.Unmarshal([]byte(e.Payload), &payload); err != nil {
			return fmt.Errorf("failed to unmarshal %s payload: %w", e.Type, err)
		}
		return apply(fc, p, e, payload)
	}
}

// lenient adapts a fold handler that logs an error and skips processing if payload unmarshaling fails.
func lenient[P any](apply func(p *GameStateProjection, e eventstore.Event, payload P)) foldFunc {
	return func(fc foldCtx, p *GameStateProjection, e eventstore.Event) error {
		var payload P
		if !decodePayload(fc.ctx, e, &payload) {
			return nil
		}
		apply(p, e, payload)
		return nil
	}
}

// decodePayload unmarshals an event's payload and reports whether it succeeded.
func decodePayload(ctx context.Context, event eventstore.Event, out interface{}) bool {
	if err := json.Unmarshal([]byte(event.Payload), out); err != nil {
		logger.Error(ctx, "projection: dropping an event whose payload does not match its type", map[string]interface{}{
			"game_id":    event.GameID,
			"sequence":   event.Sequence,
			"event_type": event.Type,
			"error":      err.Error(),
		})
		return false
	}
	return true
}
