package api_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/Jessevdz/RunwayTheGame/internal/api"
	"github.com/Jessevdz/RunwayTheGame/internal/db"
)

// Test suite covering race report generation and immediate data deletion handlers.

// reportOf fetches and decodes the report under one capability.
func reportOf(t *testing.T, r *race, token string) (int, api.RaceReport) {
	t.Helper()
	w := serveRaw(t, r, jsonRequest("GET", r.url("/report"), nil, token))
	var report api.RaceReport
	if w.Code == http.StatusOK {
		if err := json.Unmarshal(w.Body.Bytes(), &report); err != nil {
			t.Fatalf("report is not decodable: %v — %s", err, w.Body.String())
		}
	}
	return w.Code, report
}

// serveRaw is serve without the map decoding — the report is a typed struct, and
// a []ReportEvidence does not survive a round trip through map[string]interface{}.
func serveRaw(t *testing.T, r *race, req *http.Request) *httptest.ResponseRecorder {
	t.Helper()
	w, _ := serve(t, r.ctx, r.server, req)
	return w
}

// racedTwice runs a two-team race to an ending, with one approved photo and one
// rejected one, and returns the teams. It is the shape every test below wants:
// evidence from more than one team, and more than one verdict to tell apart.
func racedTwice(t *testing.T, ctx context.Context, database *db.DB) (*race, team, team) {
	t.Helper()

	r := newRace(t, ctx, database, nil)
	red := r.join("Red", 0)
	blue := r.join("Blue", 1)
	r.start()

	// The first leg is open road; Mid 1's challenge is what gates the next one.
	r.advance(red, r.board.Mid1)
	r.completeChallenge(red, r.board.Mid1, r.board.Mid1Challenge, "pass")

	// Blue's photo is rejected, so the report has both verdicts in it.
	r.advance(blue, r.board.Mid1)
	r.completeChallenge(blue, r.board.Mid1, r.board.Mid1Challenge, "fail")

	r.mustPost(http.StatusOK, "/end", nil, r.HostToken)
	return r, red, blue
}

func TestRaceReportIsReadableByEveryoneWhoRaced(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	defer database.Close()

	r, red, _ := racedTwice(t, ctx, database)

	// The host sees the whole race.
	code, report := reportOf(t, r, r.HostToken)
	if code != http.StatusOK {
		t.Fatalf("host could not read the report: %d", code)
	}
	if len(report.Evidence) != 2 {
		t.Fatalf("expected both teams' photos in the report, got %d", len(report.Evidence))
	}
	if !report.Retention.CanDeleteAll || report.Retention.CanDeleteMine {
		t.Fatalf("the host should be offered the whole-race delete and not the team one: %+v", report.Retention)
	}

	// And so does a team — the point of the report is that a player can check
	// the evidence behind somebody else's waypoint, not only their own.
	code, asRed := reportOf(t, r, red.Token)
	if code != http.StatusOK {
		t.Fatalf("a team could not read the report: %d", code)
	}
	if len(asRed.Evidence) != 2 {
		t.Fatalf("a team must see every team's evidence, got %d", len(asRed.Evidence))
	}
	if asRed.Retention.CanDeleteAll || !asRed.Retention.CanDeleteMine {
		t.Fatalf("a team should be offered its own delete and not the whole race's: %+v", asRed.Retention)
	}

	var passes, fails int
	for _, e := range report.Evidence {
		switch e.Status {
		case "pass":
			passes++
		case "fail":
			fails++
		}
		if e.TeamName == "" {
			t.Fatalf("evidence with no team on it: %+v", e)
		}
		if e.Prompt == "" {
			t.Fatalf("evidence with no prompt is unarguable: %+v", e)
		}
		if e.WaypointName != "Mid 1" {
			t.Fatalf("expected the waypoint name on the evidence, got %q", e.WaypointName)
		}
	}
	if passes != 1 || fails != 1 {
		t.Fatalf("expected one approved and one rejected photo, got %d/%d", passes, fails)
	}

	if report.Stats.Submissions != 2 || report.Stats.Passed != 1 || report.Stats.Failed != 1 {
		t.Fatalf("statistics disagree with the evidence: %+v", report.Stats)
	}
	if report.Stats.WaypointsReached != 2 {
		t.Fatalf("expected both arrivals counted, got %d", report.Stats.WaypointsReached)
	}
	if report.Status != "ended" || report.EndedAt == nil || report.StartedAt == nil {
		t.Fatalf("an ended race should report both timestamps: %+v", report)
	}
	// The timeline is read by players, so it must name teams and places rather
	// than quoting the uuids the host console is happy with.
	var namedALine bool
	for _, line := range report.Timeline {
		if strings.Contains(line, "Red") && strings.Contains(line, "Mid 1") {
			namedALine = true
		}
		if strings.Contains(line, red.ID) {
			t.Fatalf("the timeline still carries raw ids: %q", line)
		}
	}
	if !namedALine {
		t.Fatalf("expected an arrival naming the team and the waypoint, got %q", report.Timeline)
	}

	if report.Retention.Days != api.RetentionDays {
		t.Fatalf("the report should quote the retention window, got %d", report.Retention.Days)
	}
	if want := report.EndedAt.Add(api.RetentionWindow); !report.Retention.ExpiresAt.Equal(want) {
		t.Fatalf("expiry should be measured from the ending: got %s, want %s", report.Retention.ExpiresAt, want)
	}
}

func TestRaceReportRefusesEveryoneElse(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	defer database.Close()

	r, _, _ := racedTwice(t, ctx, database)

	// A race's photographs and the coordinates they were taken at are the most
	// sensitive thing here. A game id is not a capability.
	if code, _ := reportOf(t, r, ""); code != http.StatusUnauthorized {
		t.Fatalf("an unauthenticated report read should be 401, got %d", code)
	}
	if code, _ := reportOf(t, r, uuid.New().String()); code != http.StatusForbidden {
		t.Fatalf("a stranger's token should be 403, got %d", code)
	}
}

func TestDeletingARaceRemovesEverything(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	defer database.Close()

	r, red, _ := racedTwice(t, ctx, database)

	// A team cannot delete the whole race — it holds other teams' evidence.
	if w, _ := serve(t, ctx, r.server, jsonRequest("DELETE", r.url(""), nil, red.Token)); w.Code != http.StatusForbidden {
		t.Fatalf("a team must not be able to delete the race: %d", w.Code)
	}

	w, resp := serve(t, ctx, r.server, jsonRequest("DELETE", r.url(""), nil, r.HostToken))
	if w.Code != http.StatusOK {
		t.Fatalf("the host could not delete the race: %d — %s", w.Code, w.Body.String())
	}
	if deleted, _ := resp["deleted"].(bool); !deleted {
		t.Fatalf("the delete did not report success: %v", resp)
	}

	assertGameGone(t, ctx, database, r.GameID)

	// And the report it was read from is gone with it, rather than 500ing on a
	// half-deleted race.
	if code, _ := reportOf(t, r, r.HostToken); code != http.StatusNotFound {
		t.Fatalf("a deleted race's report should be 404, got %d", code)
	}
}

func TestDeletingMyEvidenceLeavesTheRaceStanding(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	defer database.Close()

	r, red, _ := racedTwice(t, ctx, database)

	w, resp := serve(t, ctx, r.server, jsonRequest("DELETE", r.url("/evidence"), nil, red.Token))
	if w.Code != http.StatusOK {
		t.Fatalf("a team could not delete its own photos: %d — %s", w.Code, w.Body.String())
	}
	if count, _ := resp["photos_deleted"].(float64); count != 1 {
		t.Fatalf("expected one photo deleted, got %v", resp["photos_deleted"])
	}

	// The race survives, and so does everybody else's evidence: one player's
	// erasure must not rewrite a scoreboard other people played for.
	code, report := reportOf(t, r, r.HostToken)
	if code != http.StatusOK {
		t.Fatalf("the race should still be readable: %d", code)
	}
	if len(report.Evidence) != 2 {
		t.Fatalf("the submissions should survive their photographs, got %d rows", len(report.Evidence))
	}

	var mineGone, theirsKept bool
	for _, e := range report.Evidence {
		if e.TeamID == red.ID {
			if e.PhotoDeletedAt == nil || e.PhotoURL != "" {
				t.Fatalf("my photo should be marked gone: %+v", e)
			}
			// The verdict is the race's result, not my data, and it stays.
			if e.Status != "pass" {
				t.Fatalf("deleting a photo must not undo its verdict: %+v", e)
			}
			mineGone = true
		} else if e.PhotoDeletedAt == nil {
			theirsKept = true
		}
	}
	if !mineGone || !theirsKept {
		t.Fatalf("expected exactly my photo to be deleted (mine gone: %v, theirs kept: %v)", mineGone, theirsKept)
	}
	if report.Stats.PhotosDeleted != 1 {
		t.Fatalf("the statistics should say a photo was deleted, got %d", report.Stats.PhotosDeleted)
	}

	// Pressing it twice is not an error — it is somebody making sure.
	if w, _ := serve(t, ctx, r.server, jsonRequest("DELETE", r.url("/evidence"), nil, red.Token)); w.Code != http.StatusOK {
		t.Fatalf("a repeated deletion should be a no-op, got %d", w.Code)
	}
}

func TestRetentionSweepPurgesRacesPastTheCeiling(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	defer database.Close()

	old, _, _ := racedTwice(t, ctx, database)
	recent, _, _ := racedTwice(t, ctx, database)

	// Age one race past the ceiling by moving its ending, which is what the
	// sweep measures from. Its creation is moved too, so the test cannot pass by
	// accident on a race that also happens to look old.
	mustExec(t, ctx, database,
		`UPDATE events SET created_at = NOW() - ($2::int || ' days')::interval WHERE game_id = $1`,
		old.GameID, api.RetentionDays+1)
	mustExec(t, ctx, database,
		`UPDATE games SET created_at = NOW() - ($2::int || ' days')::interval WHERE id = $1`,
		old.GameID, api.RetentionDays+1)

	old.server.SweepRetention(ctx)

	assertGameGone(t, ctx, database, old.GameID)

	// The race that is still inside the window is untouched. A sweep that took
	// this one would be a data-loss bug, not a privacy feature.
	var stillThere int
	if err := database.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM games WHERE id = $1`, recent.GameID).Scan(&stillThere); err != nil {
		t.Fatalf("failed to check the recent race: %v", err)
	}
	if stillThere != 1 {
		t.Fatalf("the sweep deleted a race that was still inside the retention window")
	}
}

func TestRetentionSweepDropsPositionsOfEndedRaces(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	defer database.Close()

	r := newRace(t, ctx, database, nil)
	red := r.join("Red", 0)
	r.start()

	lat, lon := r.board.coordsOf(r.board.Start)
	r.mustPost(http.StatusOK, "/position", map[string]interface{}{
		"lat": lat, "lon": lon, "accuracy_m": 8.0,
	}, red.Token)

	if positionsFor(t, ctx, database, r.GameID) != 1 {
		t.Fatalf("expected the position report to have been stored")
	}

	// A live race keeps its positions — that feed is the game.
	r.server.SweepRetention(ctx)
	if positionsFor(t, ctx, database, r.GameID) != 1 {
		t.Fatalf("the sweep deleted a live race's positions")
	}

	// Ending it is what makes them expire, well before the 30-day ceiling.
	r.mustPost(http.StatusOK, "/end", nil, r.HostToken)
	r.server.SweepRetention(ctx)
	if got := positionsFor(t, ctx, database, r.GameID); got != 0 {
		t.Fatalf("an ended race should keep no positions, got %d", got)
	}
}

func mustExec(t *testing.T, ctx context.Context, database *db.DB, query string, args ...interface{}) {
	t.Helper()
	if _, err := database.Pool.Exec(ctx, query, args...); err != nil {
		t.Fatalf("setup query failed: %v (%s)", err, query)
	}
}

func positionsFor(t *testing.T, ctx context.Context, database *db.DB, gameID string) int {
	t.Helper()
	var n int
	if err := database.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM team_positions WHERE game_id = $1`, gameID).Scan(&n); err != nil {
		t.Fatalf("failed to count positions: %v", err)
	}
	return n
}

// assertGameGone checks the whole chain, not just the games row. The event store
// carries no foreign key to games, so a purge that forgot it would leave the
// entire log of a deleted race behind and this is the only place that notices.
func assertGameGone(t *testing.T, ctx context.Context, database *db.DB, gameID string) {
	t.Helper()
	for _, q := range []struct{ label, query string }{
		{"games", `SELECT COUNT(*) FROM games WHERE id = $1`},
		{"events", `SELECT COUNT(*) FROM events WHERE game_id = $1`},
		{"teams", `SELECT COUNT(*) FROM game_teams WHERE game_id = $1`},
		{"submissions", `SELECT COUNT(*) FROM challenge_submissions WHERE game_id = $1`},
		{"positions", `SELECT COUNT(*) FROM team_positions WHERE game_id = $1`},
		{"coins", `SELECT COUNT(*) FROM team_coins WHERE game_id = $1`},
		{"idempotency", `SELECT COUNT(*) FROM idempotent_commands WHERE game_id = $1`},
	} {
		var n int
		if err := database.Pool.QueryRow(ctx, q.query, gameID).Scan(&n); err != nil {
			t.Fatalf("failed to count %s: %v", q.label, err)
		}
		if n != 0 {
			t.Fatalf("%d %s row(s) survived the purge", n, q.label)
		}
	}
}
