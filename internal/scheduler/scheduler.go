package scheduler

import (
	"context"
	"time"

	"github.com/Jessevdz/RunwayTheGame/internal/db"
	"github.com/Jessevdz/RunwayTheGame/internal/logger"
)

// BroadcastFunc pushes the current projection snapshot for a game to connected clients.
// This forces a re-render so passive timer-based effects remain visually current.
type BroadcastFunc func(ctx context.Context, gameID string)

// SweepFunc ends a game whose countdown or deadline has lapsed.
type SweepFunc func(ctx context.Context, gameID string) error

// Scheduler manages periodic background tasks for live games.
// It regularly broadcasts game state updates and sweeps games whose countdowns have lapsed.
type Scheduler struct {
	broadcast BroadcastFunc
	sweep     SweepFunc
}

// NewScheduler creates a new Scheduler with the given broadcast function.
// Pass nil for broadcast to disable state broadcasting.
func NewScheduler(broadcast BroadcastFunc) *Scheduler {
	return &Scheduler{broadcast: broadcast}
}

// SetDeadlineSweep sets the callback used to end games with lapsed deadlines.
func (s *Scheduler) SetDeadlineSweep(sweep SweepFunc) {
	s.sweep = sweep
}

// RunLoop periodically ends lapsed games and broadcasts live game state updates.
// It blocks until the context is canceled.
func (s *Scheduler) RunLoop(ctx context.Context, database *db.DB, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			// Sweep first so ended games are excluded from the subsequent broadcast pass.
			s.tickDeadlines(ctx, database)
			s.tickLiveGames(ctx, database)
		}
	}
}

func (s *Scheduler) tickDeadlines(ctx context.Context, database *db.DB) {
	if s.sweep == nil {
		return
	}

	gameIDs, err := s.LapsedCoinRushGameIDs(ctx, database)
	if err != nil {
		logger.Error(ctx, "scheduler: failed to list lapsed coin rushes", map[string]interface{}{"error": err.Error()})
		return
	}
	for _, gameID := range gameIDs {
		if err := s.sweep(ctx, gameID); err != nil {
			logger.Error(ctx, "scheduler: failed to end lapsed coin rush", map[string]interface{}{
				"game_id": gameID,
				"error":   err.Error(),
			})
		}
	}
}

// LapsedCoinRushGameIDs returns the IDs of all live coin rush games whose countdown has expired.
// Expiry is calculated from the creation time of the first TeamFinished event.
func (s *Scheduler) LapsedCoinRushGameIDs(ctx context.Context, database *db.DB) ([]string, error) {
	rows, err := database.Pool.Query(ctx, `
		SELECT g.id
		FROM games g
		JOIN events e ON e.game_id = g.id AND e.event_type = 'TeamFinished'
		WHERE g.status = 'live' AND g.mode = 'coin_rush'
		GROUP BY g.id, g.ruleset
		HAVING MIN(e.created_at)
		     + make_interval(secs => COALESCE(NULLIF((g.ruleset->>'coin_rush_countdown_seconds')::int, 0), 1800))
		    <= NOW()
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

func (s *Scheduler) tickLiveGames(ctx context.Context, database *db.DB) {
	if s.broadcast == nil {
		return
	}

	gameIDs, err := s.LiveGameIDs(ctx, database)
	if err != nil {
		logger.Error(ctx, "scheduler: failed to list live games", map[string]interface{}{"error": err.Error()})
		return
	}
	for _, gameID := range gameIDs {
		s.broadcast(ctx, gameID)
	}
}

// LiveGameIDs returns the IDs of every game currently in the 'live' status.
func (s *Scheduler) LiveGameIDs(ctx context.Context, database *db.DB) ([]string, error) {
	rows, err := database.Pool.Query(ctx, `SELECT id FROM games WHERE status = 'live'`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}
