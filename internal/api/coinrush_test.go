package api_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/Jessevdz/RunwayTheGame/internal/db"
	"github.com/Jessevdz/RunwayTheGame/internal/rules"
)

// Coin rush HTTP API integration tests.

// newCoinRush creates a published board and a live coin rush with the given
// teams, one per slot.
func newCoinRush(t *testing.T, ctx context.Context, database *db.DB, ruleset map[string]interface{}, names ...string) (*race, []team) {
	t.Helper()

	r := newRaceHarness(t, ctx, database)

	create := map[string]interface{}{
		"board_id":      r.board.BoardID,
		"board_version": 1,
		"mode":          rules.ModeCoinRush,
		"starts_at":     time.Now().Add(-time.Hour),
		"ends_at":       time.Now().Add(time.Hour),
	}
	if ruleset != nil {
		create["ruleset"] = ruleset
	}
	w, resp := serve(t, ctx, r.server, jsonRequest("POST", "/api/games", create, ""))
	if w.Code != http.StatusCreated {
		t.Fatalf("failed to create coin rush: %d — %s", w.Code, w.Body.String())
	}
	r.GameID = resp["id"].(string)
	r.HostToken = resp["host_token"].(string)

	teams := make([]team, 0, len(names))
	for i, name := range names {
		teams = append(teams, r.join(name, i+1))
	}
	r.start()
	return r, teams
}

// walkToFinish takes a team the whole way down the board, clearing both gating
// challenges, and returns the response to the finishing arrival itself.
func walkToFinish(r *race, tm team) *httptest.ResponseRecorder {
	r.t.Helper()
	r.advance(tm, r.board.Mid1)
	r.completeChallenge(tm, r.board.Mid1, r.board.Mid1Challenge, "pass")
	r.advance(tm, r.board.Mid2)
	r.completeChallenge(tm, r.board.Mid2, r.board.Mid2Challenge, "pass")
	w, _ := r.arrive(tm, r.board.Finish)
	return w
}

// gameRow queries status and winner for the given game ID.
func gameRow(t *testing.T, ctx context.Context, database *db.DB, gameID string) (status string, winner *string) {
	t.Helper()
	if err := database.Pool.QueryRow(ctx, `
		SELECT status, winner_team_id::text FROM games WHERE id = $1
	`, gameID).Scan(&status, &winner); err != nil {
		t.Fatalf("failed to read game row: %v", err)
	}
	return status, winner
}

func coinsOf(t *testing.T, ctx context.Context, database *db.DB, gameID, teamID string) int {
	t.Helper()
	var balance int
	if err := database.Pool.QueryRow(ctx, `
		SELECT COALESCE(balance, 0) FROM team_coins WHERE game_id = $1 AND team_id = $2
	`, gameID, teamID).Scan(&balance); err != nil {
		return 0
	}
	return balance
}

// TestCoinRushFirstFinisherDoesNotEndTheRace tests that the first finishing
// arrival in a coin rush keeps the race live for countdown.
func TestCoinRushFirstFinisherDoesNotEndTheRace(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	defer database.Close()

	r, teams := newCoinRush(t, ctx, database, nil, "Sprinter", "Detour", "Straggler")
	sprinter := teams[0]

	if w := walkToFinish(r, sprinter); w.Code != http.StatusOK {
		t.Fatalf("finishing arrival failed: %d — %s", w.Code, w.Body.String())
	}

	status, winner := gameRow(t, ctx, database, r.GameID)
	if status != "live" {
		t.Errorf("expected the race to still be live after the first finish, got %q", status)
	}
	if winner != nil {
		t.Errorf("expected no winner recorded yet, got %v", *winner)
	}

	proj := r.projection()
	if proj.Status != "live" {
		t.Errorf("expected the projection to still read live, got %q", proj.Status)
	}
	if proj.CoinRush == nil {
		t.Fatal("expected a coin rush state once somebody is home")
	}
	if len(proj.CoinRush.Finishers) != 1 || proj.CoinRush.Finishers[0].TeamID != sprinter.ID {
		t.Fatalf("expected exactly the sprinter on the finishers list, got %+v", proj.CoinRush.Finishers)
	}
	if got := proj.CoinRush.Finishers[0].Rank; got != 1 {
		t.Errorf("expected rank 1, got %d", got)
	}

	// The countdown starts at the crossing, from the event log's own timestamp.
	if proj.CoinRush.Deadline.IsZero() {
		t.Error("expected a deadline once the first team is home")
	}
	want := proj.CoinRush.FirstFinishAt.Add(proj.Ruleset.CoinRushCountdown())
	if !proj.CoinRush.Deadline.Equal(want) {
		t.Errorf("expected the deadline at first finish + countdown, got %v want %v", proj.CoinRush.Deadline, want)
	}
}

func TestCoinRushPaysThePlacementLadder(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	defer database.Close()

	// A two-rung ladder so a three-team field also exercises the late bonus.
	r, teams := newCoinRush(t, ctx, database, map[string]interface{}{
		"coin_rush_finish_bonuses":    []int{150, 100},
		"coin_rush_late_finish_bonus": 15,
	}, "First", "Second", "Third")

	for _, tm := range teams {
		walkToFinish(r, tm)
	}

	proj := r.projection()
	if len(proj.CoinRush.Finishers) != 3 {
		t.Fatalf("expected three finishers, got %d", len(proj.CoinRush.Finishers))
	}
	wantBonus := []int{150, 100, 15}
	for i, fin := range proj.CoinRush.Finishers {
		if fin.Rank != i+1 {
			t.Errorf("finisher %d: expected rank %d, got %d", i, i+1, fin.Rank)
		}
		if fin.BonusCoins != wantBonus[i] {
			t.Errorf("rank %d: expected a bonus of %d, got %d", fin.Rank, wantBonus[i], fin.BonusCoins)
		}
		if fin.TeamID != teams[i].ID {
			t.Errorf("rank %d: expected %s, got %s", fin.Rank, teams[i].Name, fin.TeamID)
		}
	}

	// The bonus is real money: it lands in team_coins and on the projection.
	for i, tm := range teams {
		if got := coinsOf(t, ctx, database, r.GameID, tm.ID); got < wantBonus[i] {
			t.Errorf("%s: expected at least the finish bonus in the balance, got %d", tm.Name, got)
		}
		if proj.Coins[tm.ID] < wantBonus[i] {
			t.Errorf("%s: expected the bonus folded into the projection, got %d", tm.Name, proj.Coins[tm.ID])
		}
	}
}

// TestCoinRushWinnerIsRichestNotFirst tests that coin rush victory is determined
// by coin balance rather than finish order.
func TestCoinRushWinnerIsRichestNotFirst(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	defer database.Close()

	// A flat ladder so the placement bonus cannot decide it — what is left is the
	// coins the teams earned on the route.
	r, teams := newCoinRush(t, ctx, database, map[string]interface{}{
		"coin_rush_finish_bonuses":    []int{10, 10},
		"coin_rush_late_finish_bonus": 10,
		"reward_only_first_completer": false,
	}, "Sprinter", "Detour")
	sprinter, detour := teams[0], teams[1]

	// The sprinter runs the board without stopping for anything optional; the
	// detour team clears both challenges and banks their rewards.
	r.advance(sprinter, r.board.Mid1)
	r.completeChallenge(sprinter, r.board.Mid1, r.board.Mid1Challenge, "fail")
	r.mustPost(http.StatusOK, "/veto", map[string]interface{}{
		"waypoint_id": r.board.Mid1, "idempotency_key": uuid.New().String(),
	}, sprinter.Token)
	r.advance(sprinter, r.board.Mid2)
	r.mustPost(http.StatusOK, "/veto", map[string]interface{}{
		"waypoint_id": r.board.Mid2, "idempotency_key": uuid.New().String(),
	}, sprinter.Token)
	if w, _ := r.arrive(sprinter, r.board.Finish); w.Code != http.StatusOK {
		t.Fatalf("sprinter failed to finish: %d — %s", w.Code, w.Body.String())
	}

	walkToFinish(r, detour)

	sprinterCoins := coinsOf(t, ctx, database, r.GameID, sprinter.ID)
	detourCoins := coinsOf(t, ctx, database, r.GameID, detour.ID)
	if detourCoins <= sprinterCoins {
		t.Fatalf("fixture is wrong: the detour team must end richer (%d vs %d)", detourCoins, sprinterCoins)
	}

	// The last team home ends it, and the winner is the richer team — which is
	// deliberately not the one that crossed first.
	status, winner := gameRow(t, ctx, database, r.GameID)
	if status != "ended" {
		t.Errorf("expected the last finisher to end the race, got %q", status)
	}
	if winner == nil || *winner != detour.ID {
		t.Errorf("expected the richest team to win, got %v (sprinter=%s detour=%s)", winner, sprinter.ID, detour.ID)
	}

	proj := r.projection()
	if proj.Winner != detour.ID {
		t.Errorf("expected the projection to agree, got %q", proj.Winner)
	}
	// The standings must agree with the announcement, or the table is showing a
	// different result from the banner above it.
	if proj.StandingsList[0].TeamID != detour.ID {
		t.Errorf("expected the winner on top of the standings, got %q", proj.StandingsList[0].TeamID)
	}
}

// TestCoinRushConcurrentFinishesAssignDistinctRanks tests that concurrent finishes
// assign distinct sequential ranks.
func TestCoinRushConcurrentFinishesAssignDistinctRanks(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	defer database.Close()

	r, teams := newCoinRush(t, ctx, database, nil, "A", "B", "C")

	// Walk two teams to the last waypoint before the finish, then release them
	// together.
	for _, tm := range teams[:2] {
		r.advance(tm, r.board.Mid1)
		r.completeChallenge(tm, r.board.Mid1, r.board.Mid1Challenge, "pass")
		r.advance(tm, r.board.Mid2)
		r.completeChallenge(tm, r.board.Mid2, r.board.Mid2Challenge, "pass")
	}

	var wg sync.WaitGroup
	codes := make([]int, 2)
	start := make(chan struct{})
	for i, tm := range teams[:2] {
		wg.Add(1)
		go func(i int, tm team) {
			defer wg.Done()
			<-start
			w, _ := r.arrive(tm, r.board.Finish)
			codes[i] = w.Code
		}(i, tm)
	}
	close(start)
	wg.Wait()

	for i, code := range codes {
		if code != http.StatusOK {
			t.Errorf("arrival %d: expected the retry to carry it through, got %d", i, code)
		}
	}

	// Whatever the interleaving, the log holds one TeamFinished per team and no
	// duplicated placing.
	proj := r.projection()
	if len(proj.CoinRush.Finishers) != 2 {
		t.Fatalf("expected exactly two finishers, got %+v", proj.CoinRush.Finishers)
	}
	seenRank := map[int]bool{}
	seenTeam := map[string]bool{}
	for _, fin := range proj.CoinRush.Finishers {
		if seenRank[fin.Rank] {
			t.Errorf("rank %d was handed out twice", fin.Rank)
		}
		if seenTeam[fin.TeamID] {
			t.Errorf("team %s finished twice", fin.TeamID)
		}
		seenRank[fin.Rank] = true
		seenTeam[fin.TeamID] = true
	}
	if !seenRank[1] || !seenRank[2] {
		t.Errorf("expected ranks 1 and 2, got %v", seenRank)
	}

	// A third team is still walking, so the race has not ended.
	if status, _ := gameRow(t, ctx, database, r.GameID); status != "live" {
		t.Errorf("expected the race to still be live with a team out there, got %q", status)
	}
}

// TestCoinRushFinishedTeamIsLockedOut tests that finished teams are prevented
// from performing further game actions.
func TestCoinRushFinishedTeamIsLockedOut(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	defer database.Close()

	r, teams := newCoinRush(t, ctx, database, nil, "Home", "Walking")
	home, walking := teams[0], teams[1]

	walkToFinish(r, home)
	// Both teams get coins, so a 403 can never be mistaken for a 402 — and so the
	// control case below is testing the lockout rather than an empty wallet.
	for _, tm := range teams {
		r.mustPost(http.StatusOK, "/override/coins", map[string]interface{}{
			"team_id": tm.ID, "delta": 500, "note": "test float",
		}, r.HostToken)
	}
	// The finished team also holds an item, so the /powerup/use 403 is the
	// lockout talking and not the inventory check in front of it.
	r.mustPost(http.StatusOK, "/shop/buy", map[string]interface{}{"powerup": "nerf"}, walking.Token)

	lat, lon := r.board.coordsOf(r.board.Mid1)
	blocked := []struct {
		name string
		path string
		body map[string]interface{}
	}{
		{"shop", "/shop/buy", map[string]interface{}{"powerup": "nerf"}},
		{"powerup", "/powerup/use", map[string]interface{}{
			"powerup": "nerf", "target_team_id": walking.ID,
			"idempotency_key": uuid.New().String(),
		}},
		{"arrive", "/arrive", map[string]interface{}{
			"waypoint_id": r.board.Mid1, "lat": lat, "lon": lon, "accuracy_m": 8.0,
			"idempotency_key": uuid.New().String(),
		}},
		{"challenge", "/challenge/start", map[string]interface{}{
			"waypoint_id": r.board.Mid1, "lat": lat, "lon": lon, "accuracy_m": 8.0,
			"idempotency_key": uuid.New().String(),
		}},
		{"veto", "/veto", map[string]interface{}{
			"waypoint_id": r.board.Mid1, "idempotency_key": uuid.New().String(),
		}},
	}
	for _, c := range blocked {
		w, _ := r.post(c.path, c.body, home.Token)
		if w.Code != http.StatusForbidden {
			t.Errorf("%s: expected 403 for a finished team, got %d — %s", c.name, w.Code, w.Body.String())
		}
	}

	// The same calls from a team still on the road are unaffected — the lockout
	// is about who is acting, not about the race being nearly over.
	r.mustPost(http.StatusOK, "/shop/buy", map[string]interface{}{"powerup": "nerf"}, walking.Token)
}

// TestCoinRushDeadlineSweepEndsTheRace tests that lapsed coin rush deadlines
// trigger race completion.
func TestCoinRushDeadlineSweepEndsTheRace(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	defer database.Close()

	r, teams := newCoinRush(t, ctx, database, map[string]interface{}{
		"coin_rush_finish_bonuses":    []int{10},
		"reward_only_first_completer": false,
	}, "Home", "Rich")
	home, rich := teams[0], teams[1]

	walkToFinish(r, home)
	// The straggler is richer but never crosses — exactly the team the countdown
	// exists to stop waiting for.
	r.mustPost(http.StatusOK, "/override/coins", map[string]interface{}{
		"team_id": rich.ID, "delta": 900, "note": "test float",
	}, r.HostToken)

	// Backdate the crossing so the countdown has lapsed. The deadline is read
	// from the event's own created_at, so this is the honest way to age it.
	if _, err := database.Pool.Exec(ctx, `
		UPDATE events SET created_at = NOW() - interval '2 hours'
		WHERE game_id = $1 AND event_type = 'TeamFinished'
	`, r.GameID); err != nil {
		t.Fatalf("failed to backdate the finish: %v", err)
	}

	if err := r.server.EndLapsedCoinRush(ctx, r.GameID); err != nil {
		t.Fatalf("sweep failed: %v", err)
	}

	status, winner := gameRow(t, ctx, database, r.GameID)
	if status != "ended" {
		t.Errorf("expected the sweep to end the race, got %q", status)
	}
	if winner == nil || *winner != rich.ID {
		t.Errorf("expected the richest team to win on the countdown, got %v want %s", winner, rich.ID)
	}

	// Two server instances running the same sweep, or a second tick before the
	// status caught up: the repeat must write nothing and fail nothing.
	before := r.projection().LastSequence
	if err := r.server.EndLapsedCoinRush(ctx, r.GameID); err != nil {
		t.Fatalf("expected a repeat sweep to be a clean no-op, got %v", err)
	}
	if after := r.projection().LastSequence; after != before {
		t.Errorf("expected a repeat sweep to append nothing, sequence moved %d -> %d", before, after)
	}
	if _, w := gameRow(t, ctx, database, r.GameID); w == nil || *w != rich.ID {
		t.Error("expected the repeat sweep to leave the winner alone")
	}
}

func TestCoinRushModePlumbing(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	defer database.Close()

	r, teams := newCoinRush(t, ctx, database, nil, "A", "B")

	// GET /games/{id} carries the mode, because the lobby polls it and holds no
	// capability to open the realtime feed with.
	w, resp := serve(t, ctx, r.server, jsonRequest("GET", "/api/games/"+r.GameID, nil, ""))
	if w.Code != http.StatusOK {
		t.Fatalf("failed to read the game: %d", w.Code)
	}
	if resp["mode"] != rules.ModeCoinRush {
		t.Errorf("expected the mode on GET /games/{id}, got %v", resp["mode"])
	}

	// Unlike a solo run, a coin rush is joinable — so its race code resolves.
	var code string
	_ = database.Pool.QueryRow(ctx, `SELECT race_code FROM games WHERE id = $1`, r.GameID).Scan(&code)
	if code != "" {
		w, resp := serve(t, ctx, r.server, jsonRequest("GET", "/api/games/by-code/"+code, nil, ""))
		if w.Code != http.StatusOK {
			t.Errorf("expected a coin rush race code to resolve, got %d", w.Code)
		}
		if resp["mode"] != rules.ModeCoinRush {
			t.Errorf("expected the mode on the code lookup, got %v", resp["mode"])
		}
	}

	// The solo endpoint refuses it: those two modes are the ones /games/solo
	// accepts, and a coin rush needs a field.
	w, _ = serve(t, ctx, r.server, jsonRequest("POST", "/api/games/solo", map[string]interface{}{
		"board_id": r.board.BoardID, "board_version": 1,
		"mode": rules.ModeCoinRush, "runner_name": "Nope",
	}, ""))
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected /games/solo to refuse a coin rush, got %d", w.Code)
	}

	// And the leaderboard stays a time-trial affair — a coin rush records coins,
	// not a time.
	walkToFinish(r, teams[0])
	walkToFinish(r, teams[1])
	w, _ = r.post("/leaderboard", nil, teams[0].Token)
	if w.Code != http.StatusForbidden {
		t.Errorf("expected the leaderboard to refuse a coin rush, got %d", w.Code)
	}
}

// TestCoinRushOldRulesetRowGetsTheDefaultLadder tests fallback to default
// placement bonuses when ruleset data is empty.
func TestCoinRushOldRulesetRowGetsTheDefaultLadder(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	defer database.Close()

	r, teams := newCoinRush(t, ctx, database, nil, "Solo-ish")
	if _, err := database.Pool.Exec(ctx, `UPDATE games SET ruleset = '{}'::jsonb WHERE id = $1`, r.GameID); err != nil {
		t.Fatalf("failed to blank the ruleset: %v", err)
	}

	walkToFinish(r, teams[0])

	proj := r.projection()
	def := rules.DefaultRuleset()
	if len(proj.CoinRush.Finishers) != 1 || proj.CoinRush.Finishers[0].BonusCoins != def.CoinRushFinishBonuses[0] {
		t.Errorf("expected the default top rung on a blank ruleset, got %+v", proj.CoinRush.Finishers)
	}
}
