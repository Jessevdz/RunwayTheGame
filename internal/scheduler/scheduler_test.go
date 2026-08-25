package scheduler_test

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/Jessevdz/RunwayTheGame/internal/db"
	"github.com/Jessevdz/RunwayTheGame/internal/scheduler"
	"github.com/Jessevdz/RunwayTheGame/internal/testsupport"
)

func getTestDB(t *testing.T) (*db.DB, context.Context) {
	return testsupport.DB(t, "scheduler")
}

func insertGame(t *testing.T, ctx context.Context, database *db.DB, status string) string {
	t.Helper()
	boardID := uuid.New().String()
	_, _ = database.Pool.Exec(ctx, "INSERT INTO boards (id, version, name) VALUES ($1, 1, 'Sched Test Board')", boardID)

	gameID := uuid.New().String()
	_, err := database.Pool.Exec(ctx, `
		INSERT INTO games (id, board_id, board_version, status, ruleset, starts_at, ends_at)
		VALUES ($1, $2, 1, $3, '{}'::jsonb, NOW(), NOW() + interval '1 hour')
	`, gameID, boardID, status)
	if err != nil {
		t.Fatalf("failed to insert %s game: %v", status, err)
	}
	// Cleanup runs after t.Context() has been cancelled, so these need a context
	// of their own or the rows would outlive the test.
	t.Cleanup(func() {
		_, _ = database.Pool.Exec(context.Background(), "DELETE FROM games WHERE id = $1", gameID)
		_, _ = database.Pool.Exec(context.Background(), "DELETE FROM boards WHERE id = $1", boardID)
	})
	return gameID
}

func TestLiveGameIDsFindsOnlyLiveGames(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	defer database.Close()

	liveID := insertGame(t, ctx, database, "live")
	draftID := insertGame(t, ctx, database, "draft")
	endedID := insertGame(t, ctx, database, "ended")

	sched := scheduler.NewScheduler(nil)
	ids, err := sched.LiveGameIDs(ctx, database)
	if err != nil {
		t.Fatalf("LiveGameIDs failed: %v", err)
	}

	seen := make(map[string]bool, len(ids))
	for _, id := range ids {
		seen[id] = true
	}
	if !seen[liveID] {
		t.Errorf("expected live game %s to be discovered, got %v", liveID, ids)
	}
	if seen[draftID] {
		t.Errorf("did not expect draft game %s to be discovered", draftID)
	}
	if seen[endedID] {
		t.Errorf("did not expect ended game %s to be discovered", endedID)
	}
}

// TestRunLoopBroadcastsEachLiveGame verifies that the scheduler re-broadcasts state for every live game on each ticker interval.
func TestRunLoopBroadcastsEachLiveGame(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	defer database.Close()

	gameID := insertGame(t, ctx, database, "live")

	var mu sync.Mutex
	seen := map[string]int{}
	broadcast := func(_ context.Context, gid string) {
		mu.Lock()
		seen[gid]++
		mu.Unlock()
	}

	sched := scheduler.NewScheduler(broadcast)

	loopCtx, cancel := context.WithTimeout(ctx, 500*time.Millisecond)
	defer cancel()
	sched.RunLoop(loopCtx, database, 100*time.Millisecond)

	mu.Lock()
	count := seen[gameID]
	mu.Unlock()
	if count == 0 {
		t.Fatalf("expected RunLoop to broadcast the live game at least once, got 0 calls")
	}
}

func TestRunLoopStopsOnContextCancel(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	defer database.Close()

	sched := scheduler.NewScheduler(func(context.Context, string) {})

	loopCtx, cancel := context.WithCancel(ctx)
	done := make(chan struct{})
	go func() {
		sched.RunLoop(loopCtx, database, 20*time.Millisecond)
		close(done)
	}()

	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("expected RunLoop to return promptly after context cancellation")
	}
}
