package scheduler_test

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/Jessevdz/RunwayTheGame/internal/db"
	"github.com/Jessevdz/RunwayTheGame/internal/rules"
	"github.com/Jessevdz/RunwayTheGame/internal/scheduler"
)

// insertCoinRush seeds a coin rush with a given status and stored ruleset.
func insertCoinRush(t *testing.T, ctx context.Context, database *db.DB, status string, ruleset string) string {
	t.Helper()
	boardID := uuid.New().String()
	_, _ = database.Pool.Exec(ctx, "INSERT INTO boards (id, version, name) VALUES ($1, 1, 'Coin Rush Board')", boardID)

	gameID := uuid.New().String()
	_, err := database.Pool.Exec(ctx, `
		INSERT INTO games (id, board_id, board_version, status, mode, ruleset, starts_at, ends_at)
		VALUES ($1, $2, 1, $3, 'coin_rush', $4::jsonb, NOW(), NOW() + interval '6 hours')
	`, gameID, boardID, status, ruleset)
	if err != nil {
		t.Fatalf("failed to insert coin rush: %v", err)
	}
	// Cleanup runs after t.Context() has been cancelled, so these need a context
	// of their own or the rows would outlive the test.
	t.Cleanup(func() {
		_, _ = database.Pool.Exec(context.Background(), "DELETE FROM events WHERE game_id = $1", gameID)
		_, _ = database.Pool.Exec(context.Background(), "DELETE FROM games WHERE id = $1", gameID)
		_, _ = database.Pool.Exec(context.Background(), "DELETE FROM boards WHERE id = $1", boardID)
	})
	return gameID
}

// finishAt inserts a TeamFinished event for a game at a specified timestamp.
func finishAt(t *testing.T, ctx context.Context, database *db.DB, gameID string, at time.Time) {
	t.Helper()
	_, err := database.Pool.Exec(ctx, `
		INSERT INTO events (game_id, sequence, event_type, payload, created_at)
		VALUES ($1, 1, 'TeamFinished', $2::jsonb, $3)
	`, gameID, `{"team_id":"`+uuid.New().String()+`","rank":1,"bonus_coins":150}`, at)
	if err != nil {
		t.Fatalf("failed to insert TeamFinished: %v", err)
	}
}

func TestLapsedCoinRushGameIDs(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	defer database.Close()

	now := time.Now().UTC()
	sched := scheduler.NewScheduler(nil)

	// Lapsed: finished two hours ago under the default 30-minute countdown.
	lapsed := insertCoinRush(t, ctx, database, "live", `{}`)
	finishAt(t, ctx, database, lapsed, now.Add(-2*time.Hour))

	// Inside the window: finished a minute ago.
	fresh := insertCoinRush(t, ctx, database, "live", `{}`)
	finishAt(t, ctx, database, fresh, now.Add(-time.Minute))

	// Nobody home yet — there is no countdown to lapse.
	nobodyHome := insertCoinRush(t, ctx, database, "live", `{}`)

	// Already over. A second sweep of it would be wasted work at best.
	ended := insertCoinRush(t, ctx, database, "ended", `{}`)
	finishAt(t, ctx, database, ended, now.Add(-2*time.Hour))

	// A team race has no countdown at all, whatever its events say.
	teamRace := insertGame(t, ctx, database, "live")
	finishAt(t, ctx, database, teamRace, now.Add(-2*time.Hour))

	// A custom countdown is honoured: ten minutes, finished thirty ago.
	custom := insertCoinRush(t, ctx, database, "live", `{"coin_rush_countdown_seconds":600}`)
	finishAt(t, ctx, database, custom, now.Add(-30*time.Minute))

	// A custom countdown long enough that the same crossing has not lapsed.
	patient := insertCoinRush(t, ctx, database, "live", `{"coin_rush_countdown_seconds":86400}`)
	finishAt(t, ctx, database, patient, now.Add(-30*time.Minute))

	ids, err := sched.LapsedCoinRushGameIDs(ctx, database)
	if err != nil {
		t.Fatalf("LapsedCoinRushGameIDs failed: %v", err)
	}
	seen := map[string]bool{}
	for _, id := range ids {
		seen[id] = true
	}

	for _, want := range []struct {
		id   string
		name string
	}{{lapsed, "a lapsed coin rush"}, {custom, "a lapsed custom countdown"}} {
		if !seen[want.id] {
			t.Errorf("expected %s to be swept, got %v", want.name, ids)
		}
	}
	for _, skip := range []struct {
		id   string
		name string
	}{
		{fresh, "a countdown still running"},
		{nobodyHome, "a coin rush with nobody home"},
		{ended, "an already-ended coin rush"},
		{teamRace, "a team race"},
		{patient, "a long custom countdown"},
	} {
		if seen[skip.id] {
			t.Errorf("did not expect %s to be swept", skip.name)
		}
	}
}

// TestLapsedCoinRushSQLFallbackMatchesTheGoDefault verifies the SQL fallback countdown matches default ruleset settings.
func TestLapsedCoinRushSQLFallbackMatchesTheGoDefault(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	defer database.Close()

	countdown := rules.DefaultRuleset().CoinRushCountdownSeconds
	now := time.Now().UTC()
	sched := scheduler.NewScheduler(nil)

	// A blank ruleset finished just inside the Go default must not be swept,
	// and one just outside it must be. Together those pin the SQL constant to
	// the Go one from both sides.
	inside := insertCoinRush(t, ctx, database, "live", `{}`)
	finishAt(t, ctx, database, inside, now.Add(-time.Duration(countdown-60)*time.Second))

	outside := insertCoinRush(t, ctx, database, "live", `{}`)
	finishAt(t, ctx, database, outside, now.Add(-time.Duration(countdown+60)*time.Second))

	ids, err := sched.LapsedCoinRushGameIDs(ctx, database)
	if err != nil {
		t.Fatalf("LapsedCoinRushGameIDs failed: %v", err)
	}
	seen := map[string]bool{}
	for _, id := range ids {
		seen[id] = true
	}
	if seen[inside] {
		t.Errorf("the SQL fallback is shorter than rules.DefaultRuleset()'s %ds", countdown)
	}
	if !seen[outside] {
		t.Errorf("the SQL fallback is longer than rules.DefaultRuleset()'s %ds", countdown)
	}
}

// TestRunLoopSweepsLapsedCoinRushes verifies that lapsed coin rushes are swept during loop ticks.
func TestRunLoopSweepsLapsedCoinRushes(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	defer database.Close()

	now := time.Now().UTC()
	lapsed := insertCoinRush(t, ctx, database, "live", `{}`)
	finishAt(t, ctx, database, lapsed, now.Add(-2*time.Hour))
	fresh := insertCoinRush(t, ctx, database, "live", `{}`)
	finishAt(t, ctx, database, fresh, now.Add(-time.Minute))

	var mu sync.Mutex
	swept := map[string]int{}
	sched := scheduler.NewScheduler(func(context.Context, string) {})
	sched.SetDeadlineSweep(func(_ context.Context, gameID string) error {
		mu.Lock()
		swept[gameID]++
		mu.Unlock()
		return nil
	})

	loopCtx, cancel := context.WithTimeout(ctx, 350*time.Millisecond)
	defer cancel()
	sched.RunLoop(loopCtx, database, 100*time.Millisecond)

	mu.Lock()
	defer mu.Unlock()
	if swept[lapsed] == 0 {
		t.Error("expected the lapsed coin rush to be swept at least once")
	}
	if swept[fresh] != 0 {
		t.Errorf("did not expect a running countdown to be swept, got %d calls", swept[fresh])
	}
}

// TestRunLoopWithoutASweepDoesNothingExtra verifies that running without a sweep function operates safely.
func TestRunLoopWithoutASweepDoesNothingExtra(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	defer database.Close()

	lapsed := insertCoinRush(t, ctx, database, "live", `{}`)
	finishAt(t, ctx, database, lapsed, time.Now().UTC().Add(-2*time.Hour))

	sched := scheduler.NewScheduler(func(context.Context, string) {})
	loopCtx, cancel := context.WithTimeout(ctx, 250*time.Millisecond)
	defer cancel()
	// The assertion is that this returns rather than panicking on a nil sweep.
	sched.RunLoop(loopCtx, database, 100*time.Millisecond)
}
