package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/Jessevdz/RunwayTheGame/internal/commands"
	"github.com/Jessevdz/RunwayTheGame/internal/eventstore"
	"github.com/Jessevdz/RunwayTheGame/internal/logger"
	"github.com/Jessevdz/RunwayTheGame/internal/rules"

	"github.com/jackc/pgx/v4"
)

// coinRushScores reads each team's score directly from storage within the active transaction.
func coinRushScores(ctx context.Context, conn eventstore.DBConnection, gameID string) ([]rules.CoinRushScore, error) {
	rows, err := conn.Query(ctx, `
		SELECT t.id::text,
		       COALESCE(c.balance, 0),
		       COALESCE((
		         SELECT (e.payload->>'rank')::int FROM events e
		         WHERE e.game_id = t.game_id
		           AND e.event_type = 'TeamFinished'
		           AND e.payload->>'team_id' = t.id::text
		         LIMIT 1
		       ), 0)
		FROM game_teams t
		LEFT JOIN team_coins c ON c.game_id = t.game_id AND c.team_id = t.id
		WHERE t.game_id = $1
		ORDER BY t.id
	`, gameID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var scores []rules.CoinRushScore
	for rows.Next() {
		var s rules.CoinRushScore
		if err := rows.Scan(&s.TeamID, &s.Coins, &s.FinishRank); err != nil {
			return nil, err
		}
		scores = append(scores, s)
	}
	return scores, rows.Err()
}

// coinRushFinisherCount returns the number of finished teams within the active transaction.
// The count determines placement for new arrivals.
func coinRushFinisherCount(ctx context.Context, conn eventstore.DBConnection, gameID string) (int, error) {
	var n int
	err := conn.QueryRow(ctx, `
		SELECT COUNT(DISTINCT payload->>'team_id')
		FROM events
		WHERE game_id = $1 AND event_type = 'TeamFinished'
	`, gameID).Scan(&n)
	return n, err
}

// coinRushTeamCount returns the total number of teams in a game to determine when all teams have finished.
func coinRushTeamCount(ctx context.Context, conn eventstore.DBConnection, gameID string) (int, error) {
	var n int
	err := conn.QueryRow(ctx, `SELECT COUNT(*) FROM game_teams WHERE game_id = $1`, gameID).Scan(&n)
	return n, err
}

// coinRushLocksOut checks whether a team has crossed the finish line in a coin rush game and blocks further actions.
func coinRushLocksOut(mode string, prog rules.TeamProgress) (string, bool) {
	if mode != rules.ModeCoinRush || !prog.ReachedFinish {
		return "", false
	}
	return "you have crossed the finish line — your score is settled", true
}

// coinRushEndedResponse represents the response payload returned when a coin rush ends due to countdown expiration.
type coinRushEndedResponse struct {
	Status       string `json:"status"`
	WinnerTeamID string `json:"winner_team_id"`
}

// settleCoinRushFinish records a team's placement bonus within a command transaction and ends the game if all teams have finished.
// It returns event payloads to append alongside the arrival.
func (s *Server) settleCoinRushFinish(ctx context.Context, tx pgx.Tx, gameID, teamID string, ruleset rules.Ruleset) ([]eventstore.Event, error) {
	// Skip the placement bonus if this team already finished, checked inside the write transaction.
	var alreadyFinished bool
	if err := tx.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM events
			WHERE game_id = $1 AND event_type = 'TeamFinished' AND payload->>'team_id' = $2
		)
	`, gameID, teamID).Scan(&alreadyFinished); err != nil {
		return nil, err
	}
	if alreadyFinished {
		return nil, nil
	}

	prior, err := coinRushFinisherCount(ctx, tx, gameID)
	if err != nil {
		return nil, err
	}
	rank := prior + 1
	bonus := ruleset.CoinRushFinishBonus(rank)

	// Update balance incrementally to prevent overwriting concurrent coin balance changes.
	var balance int
	if err := tx.QueryRow(ctx, `
		INSERT INTO team_coins (game_id, team_id, balance)
		VALUES ($1, $2, $3)
		ON CONFLICT (game_id, team_id)
		DO UPDATE SET balance = team_coins.balance + EXCLUDED.balance
		RETURNING balance
	`, gameID, teamID, bonus).Scan(&balance); err != nil {
		return nil, err
	}

	finPayload, _ := json.Marshal(eventstore.TeamFinishedPayload{
		TeamID: teamID, Rank: rank, BonusCoins: bonus,
	})
	out := []eventstore.Event{{Type: "TeamFinished", Payload: string(finPayload)}}

	// Omit CoinsChanged events when the bonus is zero to avoid log noise.
	if bonus != 0 {
		coinsPayload, _ := json.Marshal(eventstore.CoinsChangedPayload{
			TeamID:       teamID,
			Delta:        bonus,
			BalanceAfter: balance,
			Reason:       "finish_bonus",
		})
		out = append(out, eventstore.Event{Type: "CoinsChanged", Payload: string(coinsPayload)})
	}

	// End the game when all teams have finished. Remaining teams are handled when the countdown lapses.
	teams, err := coinRushTeamCount(ctx, tx, gameID)
	if err != nil {
		return nil, err
	}
	if rank >= teams {
		scores, err := coinRushScores(ctx, tx, gameID)
		if err != nil {
			return nil, err
		}
		winner := rules.CoinRushWinner(scores)
		endPayload, _ := json.Marshal(eventstore.GameEndedPayload{WinnerTeamID: winner})
		out = append(out, eventstore.Event{Type: "GameEnded", Payload: string(endPayload)})
		if _, err := tx.Exec(ctx, `
			UPDATE games SET status = 'ended', winner_team_id = $1 WHERE id = $2
		`, nullableTeamID(winner), gameID); err != nil {
			return nil, err
		}
	}

	return out, nil
}

// coinRushArrivalRetries is the maximum number of times an arrival command is replayed after concurrency conflicts.
const coinRushArrivalRetries = 3

// processArrivalWithRetry submits an arrival command, re-reading sequence numbers and retrying upon concurrency conflicts.
// Non-concurrency errors return immediately without retrying.
func (s *Server) processArrivalWithRetry(
	ctx context.Context,
	gameID string,
	idempotencyKey string,
	payload []byte,
	handler commands.CommandHandler,
) error {
	var err error
	for attempt := 1; attempt <= coinRushArrivalRetries; attempt++ {
		var expectedSeq int
		expectedSeq, err = s.nextSequence(ctx, gameID)
		if err != nil {
			return err
		}

		_, err = s.CmdProcessor.Process(ctx, commands.CommandRequest{
			GameID:         gameID,
			CommandType:    "WaypointReached",
			ExpectedSeq:    expectedSeq,
			IdempotencyKey: idempotencyKey,
			Payload:        payload,
		}, handler)

		if !errors.Is(err, eventstore.ErrConcurrencyConflict) {
			return err
		}
		logger.Info(ctx, "arrival lost a write race, retrying against a fresh sequence", map[string]interface{}{
			"game_id": gameID,
			"attempt": attempt,
		})
	}
	return err
}

// errInsufficientCoins indicates a team lacks required coins to execute a purchase.
var errInsufficientCoins = errors.New("insufficient coins")

// errCoinRushNotLapsed indicates that a game's countdown deadline has not yet passed.
var errCoinRushNotLapsed = errors.New("coin rush countdown has not lapsed")

// EndLapsedCoinRush ends a coin rush game whose countdown duration has expired and determines the winning team.
func (s *Server) EndLapsedCoinRush(ctx context.Context, gameID string) error {
	game, err := s.loadGame(ctx, gameID)
	if err != nil {
		return err
	}
	if game.Status != "live" || game.Mode != rules.ModeCoinRush {
		return nil
	}

	expectedSeq, err := s.nextSequence(ctx, gameID)
	if err != nil {
		return err
	}

	countdown := game.Ruleset.CoinRushCountdown()

	_, err = s.CmdProcessor.Process(ctx, commands.CommandRequest{
		GameID:      gameID,
		CommandType: "GameEnded",
		ExpectedSeq: expectedSeq,
	}, func(ctx context.Context, tx pgx.Tx, cr commands.CommandRequest) (*commands.CommandResult, error) {
		// Re-check elapsed time inside the transaction to avoid ending an already finished game.
		var firstFinish *time.Time
		if err := tx.QueryRow(ctx, `
			SELECT MIN(created_at) FROM events
			WHERE game_id = $1 AND event_type = 'TeamFinished'
		`, gameID).Scan(&firstFinish); err != nil {
			return nil, err
		}
		if firstFinish == nil || time.Now().UTC().Before(firstFinish.Add(countdown)) {
			return nil, errCoinRushNotLapsed
		}

		scores, err := coinRushScores(ctx, tx, gameID)
		if err != nil {
			return nil, err
		}
		winner := rules.CoinRushWinner(scores)

		endPayload, _ := json.Marshal(eventstore.GameEndedPayload{WinnerTeamID: winner})
		if _, err := tx.Exec(ctx, `
			UPDATE games SET status = 'ended', winner_team_id = $1 WHERE id = $2 AND status = 'live'
		`, nullableTeamID(winner), gameID); err != nil {
			return nil, err
		}

		logger.Info(ctx, "coin rush countdown lapsed", map[string]interface{}{
			"game_id": gameID,
			"winner":  winner,
			"teams":   len(scores),
		})

		return &commands.CommandResult{
			ResponseCode: http.StatusOK,
			ResponseBody: coinRushEndedResponse{Status: "ended", WinnerTeamID: winner},
			Events: []eventstore.Event{
				{Type: "GameEnded", Payload: string(endPayload)},
			},
		}, nil
	})

	switch {
	case err == nil:
		return nil
	case errors.Is(err, errCoinRushNotLapsed):
		// Game deadline was extended or completed before commit; no action required.
		return nil
	case errors.Is(err, eventstore.ErrConcurrencyConflict):
		// Concurrent transaction completed first; defer status check to the next sweep tick.
		logger.Info(ctx, "coin rush sweep lost a write race, leaving it to the next tick", map[string]interface{}{
			"game_id": gameID,
		})
		return nil
	default:
		return err
	}
}

// nullableTeamID converts an empty team ID string to nil for database UUID column compatibility.
func nullableTeamID(teamID string) interface{} {
	if teamID == "" {
		return nil
	}
	return teamID
}
