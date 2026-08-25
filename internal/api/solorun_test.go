package api_test

import (
	"context"
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/Jessevdz/RunwayTheGame/internal/db"
	"github.com/Jessevdz/RunwayTheGame/internal/rules"
)

// Solo runs end-to-end integration tests using the HTTP API.

// newSoloRun creates a published board and initializes a live solo run.
func newSoloRun(t *testing.T, ctx context.Context, database *db.DB, mode, runnerName string, ruleset map[string]interface{}) (*race, team) {
	t.Helper()

	r := newRaceHarness(t, ctx, database)

	create := map[string]interface{}{
		"board_id":      r.board.BoardID,
		"board_version": 1,
		"mode":          mode,
		"runner_name":   runnerName,
	}
	if ruleset != nil {
		create["ruleset"] = ruleset
	}

	w, resp := serve(t, ctx, r.server, jsonRequest("POST", "/api/games/solo", create, ""))
	if w.Code != http.StatusCreated {
		t.Fatalf("failed to create solo run: %d — %s", w.Code, w.Body.String())
	}

	r.GameID = resp["game_id"].(string)
	r.HostToken = resp["host_token"].(string)
	return r, team{
		ID:    resp["team_id"].(string),
		Token: resp["join_token"].(string),
		Name:  runnerName,
	}
}

// countVetoCooldowns returns the count of active veto penalty effects for the team.
func countVetoCooldowns(t *testing.T, ctx context.Context, database *db.DB, gameID, teamID string) int {
	t.Helper()
	var n int
	if err := database.Pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM team_effects
		WHERE game_id = $1 AND team_id = $2 AND kind = 'veto_penalty'
	`, gameID, teamID).Scan(&n); err != nil {
		t.Fatalf("failed to count veto cooldowns: %v", err)
	}
	return n
}

func TestSoloTimeTrialFullRun(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	defer database.Close()

	startedAbout := time.Now().UTC()
	r, runner := newSoloRun(t, ctx, database, rules.ModeSoloTimeTrial, "Jordan", nil)

	// 1. One call reached 'live', with the runner as its only team.
	proj := r.projection()
	if proj.Status != "live" {
		t.Fatalf("expected one call to reach live, got %q", proj.Status)
	}
	if proj.Mode != rules.ModeSoloTimeTrial {
		t.Fatalf("expected the mode on the projection, got %q", proj.Mode)
	}
	if len(proj.Teams) != 1 || proj.Teams[runner.ID].Name != "Jordan" {
		t.Fatalf("expected exactly one team named Jordan, got %+v", proj.Teams)
	}
	if proj.Clock.StartedAt.IsZero() {
		t.Fatal("expected the clock to be running")
	}
	if skew := proj.Clock.StartedAt.Sub(startedAbout); skew < -5*time.Second || skew > 30*time.Second {
		t.Errorf("expected the clock to start at creation, off by %v", skew)
	}

	// 2. The ordinary play loop is untouched: arrive, challenge, verdict, coins.
	r.advance(runner, r.board.Mid1)
	r.completeChallenge(runner, r.board.Mid1, r.board.Mid1Challenge, "pass")
	if got := r.projection().Coins[runner.ID]; got != 20 {
		t.Fatalf("expected the challenge to pay 20 coins, got %d", got)
	}

	// 3. A veto costs the clock, not a cooldown.
	r.advance(runner, r.board.Mid2)
	resp := r.mustPost(http.StatusOK, "/veto", map[string]interface{}{
		"waypoint_id": r.board.Mid2, "idempotency_key": uuid.New().String(),
	}, runner.Token)

	if got := resp["time_penalty_seconds"].(float64); int(got) != rules.DefaultRuleset().VetoTimePenaltySeconds {
		t.Errorf("expected the default time penalty on the response, got %v", got)
	}
	if got := resp["cooldown_seconds"].(float64); got != 0 {
		t.Errorf("expected no cooldown in a time trial, got %v", got)
	}
	if n := countVetoCooldowns(t, ctx, database, r.GameID, runner.ID); n != 0 {
		t.Errorf("expected no team_effects row for a solo veto, found %d", n)
	}

	proj = r.projection()
	if got := proj.Clock.TimePenaltySeconds; got != rules.DefaultRuleset().VetoTimePenaltySeconds {
		t.Errorf("expected the penalty folded onto the clock, got %d", got)
	}
	if proj.Clock.VetoCount != 1 {
		t.Errorf("expected one veto counted, got %d", proj.Clock.VetoCount)
	}
	// The whole point of a cooldown-free veto: the runner keeps walking.
	for _, eff := range proj.Effects[runner.ID] {
		if eff.Kind == "veto_penalty" {
			t.Errorf("expected no veto_penalty effect in the projection, got %+v", eff)
		}
	}

	// 4. Finish, then post the time.
	if w, _ := r.arrive(runner, r.board.Finish); w.Code != http.StatusOK {
		t.Fatalf("expected the vetoed waypoint to stop gating the finish")
	}
	proj = r.projection()
	if proj.Winner != runner.ID {
		t.Fatalf("expected the runner to be the winner, got %q", proj.Winner)
	}

	posted := r.mustPost(http.StatusCreated, "/leaderboard", nil, runner.Token)
	run := posted["run"].(map[string]interface{})

	elapsed := int(run["elapsed_seconds"].(float64))
	penalty := rules.DefaultRuleset().VetoTimePenaltySeconds
	// The wall clock of a test run is a second or two, so the recorded time is
	// the penalty plus that — never less than the penalty, and never wildly more.
	if elapsed < penalty || elapsed > penalty+120 {
		t.Errorf("expected elapsed ≈ wall clock + %ds penalty, got %d", penalty, elapsed)
	}
	if got := int(run["veto_penalty_seconds"].(float64)); got != penalty {
		t.Errorf("expected the penalty broken out on the row, got %d", got)
	}
	if got := int(run["veto_count"].(float64)); got != 1 {
		t.Errorf("expected one veto on the row, got %d", got)
	}
	if got := run["runner_name"].(string); got != "Jordan" {
		t.Errorf("expected the runner's name on the row, got %q", got)
	}
	if got := int(run["coins"].(float64)); got != 20 {
		t.Errorf("expected the coins earned on the row, got %d", got)
	}

	// The public read shows it.
	w, board := serve(t, ctx, r.server, jsonRequest("GET",
		fmt.Sprintf("/api/boards/%s/leaderboard?limit=25", r.board.BoardID), nil, ""))
	if w.Code != http.StatusOK {
		t.Fatalf("expected the public leaderboard to read, got %d — %s", w.Code, w.Body.String())
	}
	entries := board["entries"].([]interface{})
	if len(entries) != 1 {
		t.Fatalf("expected one entry on the board, got %d", len(entries))
	}
	first := entries[0].(map[string]interface{})
	if int(first["rank"].(float64)) != 1 || first["runner_name"].(string) != "Jordan" {
		t.Errorf("expected Jordan ranked first, got %+v", first)
	}
	if int(first["elapsed_seconds"].(float64)) != elapsed {
		t.Errorf("expected the read to agree with the write on the time, got %v vs %d", first["elapsed_seconds"], elapsed)
	}

	// 5. Posting twice is one row — UNIQUE(game_id), not a client-held key.
	r.mustPost(http.StatusCreated, "/leaderboard", nil, runner.Token)
	var rows int
	if err := database.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM solo_runs WHERE game_id = $1`, r.GameID).Scan(&rows); err != nil {
		t.Fatalf("failed to count solo_runs: %v", err)
	}
	if rows != 1 {
		t.Errorf("expected a double-tapped post to leave one row, found %d", rows)
	}
}

func TestSoloCasualVetoIsFree(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	defer database.Close()

	r, runner := newSoloRun(t, ctx, database, rules.ModeSoloCasual, "Wanderer", nil)
	r.advance(runner, r.board.Mid1)

	resp := r.mustPost(http.StatusOK, "/veto", map[string]interface{}{
		"waypoint_id": r.board.Mid1, "idempotency_key": uuid.New().String(),
	}, runner.Token)

	if got := resp["cooldown_seconds"].(float64); got != 0 {
		t.Errorf("expected no cooldown on a casual veto, got %v", got)
	}
	if got := resp["time_penalty_seconds"].(float64); got != 0 {
		t.Errorf("expected no time penalty on a casual veto, got %v", got)
	}
	if n := countVetoCooldowns(t, ctx, database, r.GameID, runner.ID); n != 0 {
		t.Errorf("expected no team_effects row, found %d", n)
	}

	proj := r.projection()
	if proj.Clock.TimePenaltySeconds != 0 {
		t.Errorf("expected nothing on the clock, got %d", proj.Clock.TimePenaltySeconds)
	}

	// Free does not mean inert: the waypoint is still bypassed, so the road opens.
	if w, _ := r.arrive(runner, r.board.Mid2); w.Code != http.StatusOK {
		t.Fatalf("expected a free veto to still bypass the waypoint, got %d — %s", w.Code, w.Body.String())
	}

	// And a casual run has no time to offer the leaderboard.
	r.mustPost(http.StatusOK, "/veto", map[string]interface{}{
		"waypoint_id": r.board.Mid2, "idempotency_key": uuid.New().String(),
	}, runner.Token)
	if w, _ := r.arrive(runner, r.board.Finish); w.Code != http.StatusOK {
		t.Fatalf("expected the runner to reach the finish")
	}
	if w, _ := r.post("/leaderboard", nil, runner.Token); w.Code != http.StatusForbidden {
		t.Errorf("expected a casual run to be refused a leaderboard row, got %d", w.Code)
	}
}

func TestSoloShopRejectsOpponentPowerups(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	defer database.Close()

	// A challenge pays 20; price the skip inside that so one completion buys one.
	r, runner := newSoloRun(t, ctx, database, rules.ModeSoloTimeTrial, "Jordan", map[string]interface{}{
		"powerup_costs": map[string]int{"nerf": 1, "tracker_off": 1, "challenge_skip": 5},
	})

	r.advance(runner, r.board.Mid1)
	r.completeChallenge(runner, r.board.Mid1, r.board.Mid1Challenge, "pass")

	// Nothing that acts on a rival can be bought — there is no rival to act on.
	for _, powerup := range []string{"nerf", "tracker_off"} {
		if w, _ := r.post("/shop/buy", map[string]interface{}{"powerup": powerup}, runner.Token); w.Code != http.StatusForbidden {
			t.Errorf("expected %s to be refused in a solo run, got %d", powerup, w.Code)
		}
	}

	// A challenge skip is the one thing a lone runner can spend on.
	r.mustPost(http.StatusOK, "/shop/buy", map[string]interface{}{"powerup": "challenge_skip"}, runner.Token)
	if got := r.projection().Coins[runner.ID]; got != 15 {
		t.Fatalf("expected the skip to cost 5 of 20 coins, %d remain", got)
	}

	// And activating it actually bypasses the waypoint — the regression guarding the
	// dead activation path, where the client sent no target and the skip was
	// consumed for nothing.
	r.advance(runner, r.board.Mid2)
	if w, _ := r.arrive(runner, r.board.Finish); w.Code != http.StatusForbidden {
		t.Fatalf("expected Mid 2's challenge to gate the finish before the skip")
	}

	r.mustPost(http.StatusOK, "/powerup/use", map[string]interface{}{
		"powerup": "challenge_skip", "road_id": r.board.Mid2, "idempotency_key": uuid.New().String(),
	}, runner.Token)

	proj := r.projection()
	if !proj.WaypointStates[r.board.Mid2].Bypassed[runner.ID] {
		t.Fatalf("expected the skip to bypass Mid 2, got %+v", proj.WaypointStates[r.board.Mid2])
	}
	if w, _ := r.arrive(runner, r.board.Finish); w.Code != http.StatusOK {
		t.Fatalf("expected the skip to open the road to the finish, got %d — %s", w.Code, w.Body.String())
	}
}

func TestSoloRunDoesNotResolveByRaceCode(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	defer database.Close()

	r := newRaceHarness(t, ctx, database)
	w, resp := serve(t, ctx, r.server, jsonRequest("POST", "/api/games/solo", map[string]interface{}{
		"board_id": r.board.BoardID, "board_version": 1,
		"mode": rules.ModeSoloCasual, "runner_name": "Wanderer",
	}, ""))
	if w.Code != http.StatusCreated {
		t.Fatalf("failed to create solo run: %s", w.Body.String())
	}
	code := resp["race_code"].(string)
	if code == "" {
		t.Fatal("expected a solo run to still be given a race code")
	}

	// There is nothing on the other side of it: the roster is full at one and the
	// only door in is the runner's own device. It answers what an unknown code
	// answers, rather than confirming the code was real.
	got, _ := serve(t, ctx, r.server, jsonRequest("GET", "/api/games/by-code/"+code, nil, ""))
	if got.Code != http.StatusNotFound {
		t.Errorf("expected a solo race code to 404, got %d — %s", got.Code, got.Body.String())
	}
}

func TestSoloLeaderboardRefusesUnfinishedAndTeamRuns(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	defer database.Close()

	// A run that has not finished has no time to post.
	r, runner := newSoloRun(t, ctx, database, rules.ModeSoloTimeTrial, "Jordan", nil)
	if w, _ := r.post("/leaderboard", nil, runner.Token); w.Code != http.StatusForbidden {
		t.Errorf("expected a live run to be refused, got %d", w.Code)
	}

	// A run abandoned with POST /end ends with no winner, and an abandoned walk
	// is not a time — which is why the handler checks the winner, not the status.
	r.mustPost(http.StatusOK, "/end", nil, r.HostToken)
	if w, _ := r.post("/leaderboard", nil, runner.Token); w.Code != http.StatusForbidden {
		t.Errorf("expected an abandoned run to be refused, got %d", w.Code)
	}

	// A team race has no single elapsed time to rank.
	tr := newRace(t, ctx, database, nil)
	red := tr.join("Red", 0)
	tr.start()
	tr.advance(red, tr.board.Mid1)
	tr.completeChallenge(red, tr.board.Mid1, tr.board.Mid1Challenge, "pass")
	tr.advance(red, tr.board.Mid2)
	tr.completeChallenge(red, tr.board.Mid2, tr.board.Mid2Challenge, "pass")
	if w, _ := tr.arrive(red, tr.board.Finish); w.Code != http.StatusOK {
		t.Fatalf("expected Red to finish the team race")
	}
	if w, _ := tr.post("/leaderboard", nil, red.Token); w.Code != http.StatusForbidden {
		t.Errorf("expected a team race to be refused a leaderboard row, got %d", w.Code)
	}
}

// TestSoloRunRejectsTeamMode tests that team game modes are rejected on the solo
// creation endpoint.
func TestSoloRunRejectsTeamMode(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	defer database.Close()

	server := newTestServer(database)
	board := setupRaceBoard(t, ctx, database)

	for _, mode := range []string{"", rules.ModeTeam, "solo_timetrial"} {
		w, _ := serve(t, ctx, server, jsonRequest("POST", "/api/games/solo", map[string]interface{}{
			"board_id": board.BoardID, "board_version": 1, "mode": mode, "runner_name": "Jordan",
		}, ""))
		if w.Code != http.StatusBadRequest {
			t.Errorf("mode %q: expected 400, got %d", mode, w.Code)
		}
	}
}

// TestCreateGameRejectsUnknownMode tests that invalid game modes are rejected on
// game creation.
func TestCreateGameRejectsUnknownMode(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	defer database.Close()

	server := newTestServer(database)
	board := setupRaceBoard(t, ctx, database)

	w, _ := serve(t, ctx, server, jsonRequest("POST", "/api/games", map[string]interface{}{
		"board_id": board.BoardID, "board_version": 1, "mode": "battle-royale",
		"starts_at": time.Now(), "ends_at": time.Now().Add(time.Hour),
	}, ""))
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected an unknown mode to be refused, got %d — %s", w.Code, w.Body.String())
	}

	// An omitted mode is still a team race, which is what every caller that
	// predates modes meant.
	w, resp := serve(t, ctx, server, jsonRequest("POST", "/api/games", map[string]interface{}{
		"board_id": board.BoardID, "board_version": 1,
		"starts_at": time.Now(), "ends_at": time.Now().Add(time.Hour),
	}, ""))
	if w.Code != http.StatusCreated {
		t.Fatalf("expected an omitted mode to create a team race, got %d — %s", w.Code, w.Body.String())
	}
	if got := resp["mode"].(string); got != rules.ModeTeam {
		t.Errorf("expected mode 'team', got %q", got)
	}
}
