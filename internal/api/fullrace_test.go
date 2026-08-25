package api_test

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/Jessevdz/RunwayTheGame/internal/api"
	"github.com/Jessevdz/RunwayTheGame/internal/blobstore"
	"github.com/Jessevdz/RunwayTheGame/internal/db"
	"github.com/Jessevdz/RunwayTheGame/internal/projections"
)

// raceBoard is a four-waypoint line:
//
//	Start ──segA── Mid1 ──segB── Mid2 ──segC── Finish
//
// Mid1 and Mid2 carry gating challenges; the start does not. That mirrors how
// the projection treats a race: every team that joins has the start waypoint
// pre-cleared automatically upon joining, so a challenge
// attached to the start would never gate anything and the board would be lying
// about its own difficulty.
//
// Coordinates sit near (0,0) on a line of latitude. One hundredth of a degree
// of longitude is ~1.1 km — far outside the 25 m arrival radius, so a team can
// only "be" at one waypoint at a time.
type raceBoard struct {
	BoardID                   string
	Start, Mid1, Mid2, Finish string
	Mid1Challenge             string
	Mid2Challenge             string
	SegStartMid1              string
	SegMid1Mid2               string
	SegMid2Finish             string
	RoadblockCardID           string
	CurseCardID               string
}

func (b raceBoard) coordsOf(waypointID string) (lat, lon float64) {
	switch waypointID {
	case b.Start:
		return 0.0, 0.00
	case b.Mid1:
		return 0.0, 0.01
	case b.Mid2:
		return 0.0, 0.02
	default:
		return 0.0, 0.03
	}
}

func setupRaceBoard(t *testing.T, ctx context.Context, database *db.DB) raceBoard {
	t.Helper()

	b := raceBoard{
		BoardID:         uuid.New().String(),
		Start:           uuid.New().String(),
		Mid1:            uuid.New().String(),
		Mid2:            uuid.New().String(),
		Finish:          uuid.New().String(),
		Mid1Challenge:   uuid.New().String(),
		Mid2Challenge:   uuid.New().String(),
		SegStartMid1:    uuid.New().String(),
		SegMid1Mid2:     uuid.New().String(),
		SegMid2Finish:   uuid.New().String(),
		RoadblockCardID: uuid.New().String(),
		CurseCardID:     uuid.New().String(),
	}

	mustExec := func(query string, args ...interface{}) {
		t.Helper()
		if _, err := database.Pool.Exec(ctx, query, args...); err != nil {
			t.Fatalf("board setup failed: %v (%s)", err, query)
		}
	}

	mustExec("INSERT INTO boards (id, version, name, published_at) VALUES ($1, 1, 'Full Race Board', NOW())", b.BoardID)
	mustExec(`
		INSERT INTO board_waypoints (id, board_id, board_version, name, location, is_start, is_finish, arrival_radius_m, challenge_id) VALUES
		($2, $1, 1, 'Start',  ST_SetSRID(ST_MakePoint(0.00, 0.0), 4326), true,  false, 25, NULL),
		($3, $1, 1, 'Mid 1',  ST_SetSRID(ST_MakePoint(0.01, 0.0), 4326), false, false, 25, $5),
		($4, $1, 1, 'Mid 2',  ST_SetSRID(ST_MakePoint(0.02, 0.0), 4326), false, false, 25, $6),
		($7, $1, 1, 'Finish', ST_SetSRID(ST_MakePoint(0.03, 0.0), 4326), false, true,  25, NULL)
	`, b.BoardID, b.Start, b.Mid1, b.Mid2, b.Mid1Challenge, b.Mid2Challenge, b.Finish)
	mustExec(`
		INSERT INTO board_roads (id, board_id, board_version, waypoint_id_a, waypoint_id_b, length_m) VALUES
		($1, $4, 1, $5, $6, 1000),
		($2, $4, 1, $6, $7, 1000),
		($3, $4, 1, $7, $8, 1000)
	`, b.SegStartMid1, b.SegMid1Mid2, b.SegMid2Finish, b.BoardID, b.Start, b.Mid1, b.Mid2, b.Finish)
	mustExec(`
		INSERT INTO challenges (id, board_id, board_version, waypoint_id, prompt, rubric, coin_reward, veto_penalty_seconds) VALUES
		($1, $3, 1, $4, 'Photograph the station clock', '{"must_show":["a clock face"]}', 20, 3600),
		($2, $3, 1, $5, 'Photograph the canal bridge',  '{"must_show":["a bridge"]}',     20, 3600)
	`, b.Mid1Challenge, b.Mid2Challenge, b.BoardID, b.Mid1, b.Mid2)
	mustExec(`INSERT INTO board_roadblock_cards (id, board_id, board_version, text) VALUES ($1, $2, 1, 'Carry your teammate 20 metres.')`, b.RoadblockCardID, b.BoardID)
	mustExec(`INSERT INTO board_curse_cards (id, board_id, board_version, text) VALUES ($1, $2, 1, 'Travel only by tram for one hour.')`, b.CurseCardID, b.BoardID)

	return b
}

// race drives one game through the HTTP API the way a client does.
type race struct {
	t        *testing.T
	ctx      context.Context
	server   *api.Server
	database *db.DB
	board    raceBoard

	GameID    string
	HostToken string

	// now is the simulated server clock; advance to model walking time.
	now time.Time
	// cur records each team's last reached waypoint so moves get a fix baseline.
	cur map[string]string
}

func (r *race) fixClock() {
	r.t.Helper()
	r.server.SetClock(func() time.Time { return r.now })
	r.server.DisablePositionLimiter()
}

func (r *race) walk(elapsed time.Duration) {
	r.now = r.now.Add(elapsed)
}

func (r *race) post(path string, body map[string]interface{}, token string) (*httptest.ResponseRecorder, map[string]interface{}) {
	r.t.Helper()
	return serve(r.t, r.ctx, r.server, jsonRequest("POST", r.url(path), body, token))
}

func (r *race) url(path string) string {
	return fmt.Sprintf("/api/games/%s%s", r.GameID, path)
}

// mustPost fails the test unless the call returns the expected status.
func (r *race) mustPost(want int, path string, body map[string]interface{}, token string) map[string]interface{} {
	r.t.Helper()
	w, resp := r.post(path, body, token)
	if w.Code != want {
		r.t.Fatalf("POST %s: got %d, want %d — %s", path, w.Code, want, w.Body.String())
	}
	return resp
}

func (r *race) projection() *projections.GameStateProjection {
	r.t.Helper()
	proj, err := projections.RebuildProjection(r.ctx, r.database.Pool, r.GameID, 0)
	if err != nil {
		r.t.Fatalf("failed to rebuild projection: %v", err)
	}
	return proj
}

// newRaceHarness initializes a test server and setup board without creating a game.
func newRaceHarness(t *testing.T, ctx context.Context, database *db.DB) *race {
	t.Helper()
	r := &race{
		t:        t,
		ctx:      ctx,
		server:   newTestServer(database),
		database: database,
		board:    setupRaceBoard(t, ctx, database),
		now:      time.Now().UTC(),
		cur:      map[string]string{},
	}
	r.fixClock()
	return r
}

// newRace creates a published board, a game, and starts it.
func newRace(t *testing.T, ctx context.Context, database *db.DB, ruleset map[string]interface{}) *race {
	t.Helper()

	r := newRaceHarness(t, ctx, database)

	create := map[string]interface{}{
		"board_id":      r.board.BoardID,
		"board_version": 1,
		"starts_at":     time.Now().Add(-time.Hour),
		"ends_at":       time.Now().Add(time.Hour),
	}
	if ruleset != nil {
		create["ruleset"] = ruleset
	}
	w, resp := serve(t, ctx, r.server, jsonRequest("POST", "/api/games", create, ""))
	if w.Code != http.StatusCreated {
		t.Fatalf("failed to create game: %s", w.Body.String())
	}
	r.GameID = resp["id"].(string)
	r.HostToken = resp["host_token"].(string)
	return r
}

// team is one team's capability token plus its id.
type team struct {
	ID    string
	Token string
	Name  string
}

func (r *race) join(name string, slot int) team {
	r.t.Helper()
	resp := r.mustPost(http.StatusCreated, "/join", map[string]interface{}{"team_name": name, "slot_index": slot}, "")
	tm := team{ID: resp["team_id"].(string), Token: resp["join_token"].(string), Name: name}
	if r.cur[tm.ID] == "" {
		r.cur[tm.ID] = r.board.Start
	}
	return tm
}

// evidenceRef generates a valid evidence blob reference for the team.
func (r *race) evidenceRef(tm team) string {
	r.t.Helper()
	key, err := blobstore.MintEvidenceKey(r.GameID, tm.ID)
	if err != nil {
		r.t.Fatalf("failed to mint an evidence key: %v", err)
	}
	return key
}

func (r *race) start() {
	r.t.Helper()
	r.mustPost(http.StatusOK, "/start", nil, r.HostToken)
}

// completeChallenge walks a team through the full evidence loop for the
// challenge attached to a waypoint it is standing on.
func (r *race) completeChallenge(tm team, waypointID, challengeID string, verdict string) string {
	r.t.Helper()
	lat, lon := r.board.coordsOf(waypointID)

	r.mustPost(http.StatusOK, "/challenge/start", map[string]interface{}{
		"waypoint_id": waypointID, "lat": lat, "lon": lon, "accuracy_m": 8.0,
		"idempotency_key": uuid.New().String(),
	}, tm.Token)

	// The fix travels with the evidence: the server checks it against the
	// waypoint before accepting the submission, same as /challenge/start.
	sub := r.mustPost(http.StatusCreated, "/submission", map[string]interface{}{
		"waypoint_id": waypointID, "challenge_id": challengeID,
		"lat": lat, "lon": lon, "accuracy_m": 8.0,
		"blob_ref": r.evidenceRef(tm), "idempotency_key": uuid.New().String(),
	}, tm.Token)
	submissionID := sub["submission_id"].(string)

	r.mustPost(http.StatusOK, "/verdict", map[string]interface{}{
		"submission_id": submissionID, "verdict": verdict, "confidence": 0.95, "rationale": "clearly shows the subject",
	}, testWorkerToken)

	return submissionID
}

// arrive moves a team to a waypoint, modeling a real walk: it reports a position
// fix at the team's current waypoint, advances the simulated clock, then arrives.
func (r *race) arrive(tm team, waypointID string) (*httptest.ResponseRecorder, map[string]interface{}) {
	r.t.Helper()
	if from := r.cur[tm.ID]; from != "" && from != waypointID {
		lat, lon := r.board.coordsOf(from)
		if w, _ := r.post("/position", map[string]interface{}{"lat": lat, "lon": lon, "accuracy_m": 8.0}, tm.Token); w.Code != http.StatusOK {
			r.t.Fatalf("%s failed to report position from %s: %d - %s", tm.Name, from, w.Code, w.Body.String())
		}
		r.walk(time.Minute)
	}
	lat, lon := r.board.coordsOf(waypointID)
	return r.post("/arrive", map[string]interface{}{
		"waypoint_id": waypointID, "lat": lat, "lon": lon, "accuracy_m": 8.0,
		"idempotency_key": uuid.New().String(),
	}, tm.Token)
}

// rawArrive issues /arrive with no prior fix, for tests that assert the
// arrival-velocity gate's refusal behaviour directly.
func (r *race) rawArrive(tm team, waypointID string) (*httptest.ResponseRecorder, map[string]interface{}) {
	r.t.Helper()
	lat, lon := r.board.coordsOf(waypointID)
	return r.post("/arrive", map[string]interface{}{
		"waypoint_id": waypointID, "lat": lat, "lon": lon, "accuracy_m": 8.0,
		"idempotency_key": uuid.New().String(),
	}, tm.Token)
}

// advance is arrive for the steps a test takes for granted rather than asserts.
func (r *race) advance(tm team, waypointID string) {
	r.t.Helper()
	if w, _ := r.arrive(tm, waypointID); w.Code != http.StatusOK {
		r.t.Fatalf("%s failed to advance to %s: %d - %s", tm.Name, waypointID, w.Code, w.Body.String())
	}
	r.cur[tm.ID] = waypointID
}

// TestFullRace exercises an end-to-end race lifecycle through HTTP API calls.
func TestFullRace(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	defer database.Close()

	r := newRace(t, ctx, database, nil)
	red := r.join("Red", 0)
	blue := r.join("Blue", 1)
	r.start()

	// Both teams begin at the start waypoint.
	proj := r.projection()
	for _, tm := range []team{red, blue} {
		if proj.Progress[tm.ID].CurrentWaypointID != r.board.Start {
			t.Fatalf("expected %s to start at the start waypoint, got %q", tm.Name, proj.Progress[tm.ID].CurrentWaypointID)
		}
	}

	// The start waypoint gates nothing, so the first leg is open road.
	r.advance(red, r.board.Mid1)
	if got := r.projection().Progress[red.ID].CurrentWaypointID; got != r.board.Mid1 {
		t.Fatalf("expected Red at Mid 1, got %q", got)
	}

	// A team cannot go back to an already cleared waypoint (e.g. Start).
	if w, _ := r.arrive(red, r.board.Start); w.Code != http.StatusForbidden {
		t.Fatalf("expected returning to cleared Start waypoint to be forbidden, got %d", w.Code)
	}

	// A team cannot leave a waypoint whose gating challenge it has not cleared.
	if w, _ := r.arrive(red, r.board.Mid2); w.Code != http.StatusForbidden {
		t.Fatalf("expected Mid 1's challenge to gate departure, got %d", w.Code)
	}

	// Red clears it and is paid for being first.
	r.completeChallenge(red, r.board.Mid1, r.board.Mid1Challenge, "pass")
	proj = r.projection()
	if got := proj.Coins[red.ID]; got != 20 {
		t.Fatalf("expected Red to earn 20 coins for the first completion, got %d", got)
	}

	// Blue completes the same challenge second. The waypoint opens for Blue, but
	// under the default ruleset only the first completer is paid.
	r.advance(blue, r.board.Mid1)
	r.completeChallenge(blue, r.board.Mid1, r.board.Mid1Challenge, "pass")
	proj = r.projection()
	if got := proj.Coins[blue.ID]; got != 0 {
		t.Fatalf("expected Blue to earn nothing for a second completion, got %d", got)
	}
	if !proj.WaypointStates[r.board.Mid1].ClearedBy[blue.ID] {
		t.Error("expected Mid 1 to be cleared for Blue even though it paid nothing")
	}

	// Red moves on and clears the second challenge too.
	r.advance(red, r.board.Mid2)
	if w, _ := r.arrive(red, r.board.Finish); w.Code != http.StatusForbidden {
		t.Fatalf("expected Mid 2's challenge to gate the finish, got %d", w.Code)
	}
	r.completeChallenge(red, r.board.Mid2, r.board.Mid2Challenge, "pass")
	proj = r.projection()
	if got := proj.Coins[red.ID]; got != 40 {
		t.Fatalf("expected Red to hold 40 coins after two first-completions, got %d", got)
	}

	// Buy and use a power-up: the nerf freezes Blue, and the effect is real.
	r.mustPost(http.StatusOK, "/shop/buy", map[string]interface{}{"powerup": "nerf"}, red.Token)
	proj = r.projection()
	if got := proj.Coins[red.ID]; got != 30 {
		t.Fatalf("expected the nerf to cost 10 coins, leaving 30; got %d", got)
	}
	if inv := proj.Inventory[red.ID]; len(inv) != 1 || inv[0] != "nerf" {
		t.Fatalf("expected a nerf in Red's inventory, got %v", inv)
	}

	r.mustPost(http.StatusOK, "/powerup/use", map[string]interface{}{
		"powerup": "nerf", "target_team_id": blue.ID, "idempotency_key": uuid.New().String(),
	}, red.Token)

	proj = r.projection()
	if len(proj.Inventory[blue.ID]) != 0 && len(proj.Inventory[red.ID]) != 0 {
		t.Errorf("expected the nerf to be consumed from Red's inventory, got %v", proj.Inventory[red.ID])
	}
	frozen := false
	for _, eff := range proj.Effects[blue.ID] {
		if eff.Kind == "freeze" && time.Now().UTC().Before(eff.Until) {
			frozen = true
		}
	}
	if !frozen {
		t.Fatalf("expected Blue to be frozen after the nerf, got effects %+v", proj.Effects[blue.ID])
	}

	// A frozen team cannot move.
	if w, _ := r.arrive(blue, r.board.Mid2); w.Code != http.StatusForbidden {
		t.Errorf("expected a frozen team to be refused movement, got %d", w.Code)
	}

	// Red crosses the line and the game ends with Red recorded as the winner.
	if w, _ := r.arrive(red, r.board.Finish); w.Code != http.StatusOK {
		t.Fatalf("expected Red to reach the finish")
	}

	proj = r.projection()
	if proj.Winner != red.ID {
		t.Fatalf("expected Red to be the winner in the projection, got %q", proj.Winner)
	}
	if !proj.Progress[red.ID].ReachedFinish {
		t.Error("expected Red's progress to record reaching the finish")
	}

	var status, winner string
	if err := database.Pool.QueryRow(ctx,
		`SELECT status, COALESCE(winner_team_id::text, '') FROM games WHERE id = $1`, r.GameID,
	).Scan(&status, &winner); err != nil {
		t.Fatalf("failed to read the finished game: %v", err)
	}
	if status != "ended" || winner != red.ID {
		t.Fatalf("expected the game row to read ended/%s, got %s/%s", red.ID, status, winner)
	}

	// The standings put the winner first with nothing left to travel.
	if len(proj.StandingsList) != 2 {
		t.Fatalf("expected two standings rows, got %d", len(proj.StandingsList))
	}
	if proj.StandingsList[0].TeamID != red.ID || proj.StandingsList[0].DistanceToFinish != 0 {
		t.Errorf("expected Red to lead the standings at zero distance, got %+v", proj.StandingsList[0])
	}
}

// TestArrivalCannotBeSpoofedByReportedAccuracy tests that arrival distance checks
// cannot be bypassed by reporting high accuracy uncertainty.
func TestArrivalCannotBeSpoofedByReportedAccuracy(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	defer database.Close()

	r := newRace(t, ctx, database, nil)
	red := r.join("Red", 0)
	r.start()

	// Antwerp is a long way from this board.
	const farLat, farLon = 51.2213, 4.4051

	for _, accuracy := range []float64{9999, 5000, 200, 100, 50, 0} {
		w, _ := r.post("/arrive", map[string]interface{}{
			"waypoint_id": r.board.Mid1, "lat": farLat, "lon": farLon, "accuracy_m": accuracy,
			"idempotency_key": uuid.New().String(),
		}, red.Token)
		if w.Code != http.StatusUnprocessableEntity {
			t.Errorf("accuracy_m=%v: expected 422, got %d — %s", accuracy, w.Code, w.Body.String())
		}
	}

	if got := r.projection().Progress[red.ID].CurrentWaypointID; got != r.board.Start {
		t.Fatalf("expected Red to still be at the start after every spoof attempt, got %q", got)
	}

	// The same gate must not obstruct an honest arrival.
	if w, _ := r.arrive(red, r.board.Mid1); w.Code != http.StatusOK {
		t.Fatalf("expected an honest arrival to be accepted, got %d — %s", w.Code, w.Body.String())
	}
}

// TestChallengeStartRejectsSpoofedAccuracy tests that starting a challenge from
// a distance is rejected.
func TestChallengeStartRejectsSpoofedAccuracy(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	defer database.Close()

	r := newRace(t, ctx, database, nil)
	red := r.join("Red", 0)
	r.start()

	r.advance(red, r.board.Mid1)

	w, _ := r.post("/challenge/start", map[string]interface{}{
		"waypoint_id": r.board.Mid1, "lat": 51.2213, "lon": 4.4051, "accuracy_m": 9999,
		"idempotency_key": uuid.New().String(),
	}, red.Token)
	if w.Code != http.StatusUnprocessableEntity {
		t.Errorf("expected 422 for a challenge started from 500 km away, got %d — %s", w.Code, w.Body.String())
	}
}

// TestRoadblockBlocksTraversalAndCanBeCleared tests that roadblocks obstruct
// traversal until cleared.
func TestRoadblockBlocksTraversalAndCanBeCleared(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	defer database.Close()

	// Cheap roadblocks so one challenge completion pays for one.
	r := newRace(t, ctx, database, map[string]interface{}{
		"powerup_costs": map[string]int{"roadblock": 5},
	})
	red := r.join("Red", 0)
	blue := r.join("Blue", 1)
	r.start()

	// Red gets ahead and earns the coins for a roadblock.
	r.advance(red, r.board.Mid1)
	r.completeChallenge(red, r.board.Mid1, r.board.Mid1Challenge, "pass")

	r.mustPost(http.StatusOK, "/shop/buy", map[string]interface{}{"powerup": "roadblock"}, red.Token)
	r.mustPost(http.StatusOK, "/powerup/use", map[string]interface{}{
		"powerup": "roadblock", "road_id": r.board.SegMid1Mid2, "idempotency_key": uuid.New().String(),
	}, red.Token)

	proj := r.projection()
	rb, ok := proj.Roadblocks[r.board.SegMid1Mid2]
	if !ok {
		t.Fatalf("expected a roadblock on the mid1-to-mid2 road, got %+v", proj.Roadblocks)
	}
	if rb.CardID != r.board.RoadblockCardID {
		t.Errorf("expected the roadblock to carry the drawn card's id %q, got %q", r.board.RoadblockCardID, rb.CardID)
	}

	// Red moves forward over its own roadblock: you do not block yourself.
	if w, _ := r.arrive(red, r.board.Mid2); w.Code != http.StatusOK {
		t.Fatalf("expected Red to pass its own roadblock, got %d — %s", w.Code, w.Body.String())
	}

	// Blue advances to Mid 1, clears Mid 1's challenge, and is stopped by Red's roadblock to Mid 2.
	r.advance(blue, r.board.Mid1)
	r.completeChallenge(blue, r.board.Mid1, r.board.Mid1Challenge, "pass")

	if w, _ := r.arrive(blue, r.board.Mid2); w.Code != http.StatusForbidden {
		t.Fatalf("expected the roadblock to stop Blue, got %d — %s", w.Code, w.Body.String())
	}

	// Blue works the card off. Clearing goes through the ordinary verification
	// pipeline, so it is the verdict that lifts the block, not the submission.
	// The fix has to put Blue at the end of the blocked road it is standing at.
	clearLat, clearLon := r.board.coordsOf(r.board.Mid1)
	clear := r.mustPost(http.StatusCreated, "/roadblock/clear", map[string]interface{}{
		"road_id": r.board.SegMid1Mid2, "blob_ref": r.evidenceRef(blue),
		"lat": clearLat, "lon": clearLon, "accuracy_m": 8.0,
		"idempotency_key": uuid.New().String(),
	}, blue.Token)
	clearanceID := clear["submission_id"].(string)

	if w, _ := r.arrive(blue, r.board.Mid2); w.Code != http.StatusForbidden {
		t.Error("expected a pending clearance to leave the roadblock standing")
	}

	r.mustPost(http.StatusOK, "/verdict", map[string]interface{}{
		"submission_id": clearanceID, "verdict": "pass", "confidence": 0.9, "rationale": "challenge plainly performed",
	}, testWorkerToken)

	proj = r.projection()
	if !proj.Roadblocks[r.board.SegMid1Mid2].ClearedBy[blue.ID] {
		t.Fatalf("expected the roadblock to be cleared for Blue, got %+v", proj.Roadblocks[r.board.SegMid1Mid2])
	}
	// Clearing a roadblock is a toll, not an achievement: it pays nothing and
	// does not record road progress.
	if got := proj.Coins[blue.ID]; got != 20 {
		t.Errorf("expected clearing a roadblock to pay nothing extra, Blue holds %d", got)
	}
	var progressRows int
	if err := database.Pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM road_progress WHERE game_id = $1 AND road_id = $2`,
		r.GameID, r.board.SegMid1Mid2,
	).Scan(&progressRows); err != nil {
		t.Fatalf("failed to count road_progress: %v", err)
	}
	if progressRows != 0 {
		t.Errorf("expected a roadblock clearance not to record road progress, found %d rows", progressRows)
	}

	if w, _ := r.arrive(blue, r.board.Mid2); w.Code != http.StatusOK {
		t.Fatalf("expected Blue to pass once the roadblock was cleared, got %d — %s", w.Code, w.Body.String())
	}
}

// TestRoadblockClearRejectsTeamsItDoesNotBlock tests that roadblock clearing
// requests are rejected for teams not blocked by the roadblock.
func TestRoadblockClearRejectsTeamsItDoesNotBlock(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	defer database.Close()

	r := newRace(t, ctx, database, map[string]interface{}{
		"powerup_costs": map[string]int{"roadblock": 5},
	})
	red := r.join("Red", 0)
	blue := r.join("Blue", 1)
	r.start()
	r.advance(red, r.board.Mid1)
	r.completeChallenge(red, r.board.Mid1, r.board.Mid1Challenge, "pass")

	// No roadblock there yet.
	if w, _ := r.post("/roadblock/clear", map[string]interface{}{
		"road_id": r.board.SegStartMid1, "blob_ref": r.evidenceRef(red), "lat": 0.0, "lon": 0.0, "accuracy_m": 8.0,
		"idempotency_key": uuid.New().String(),
	}, red.Token); w.Code != http.StatusNotFound {
		t.Errorf("expected 404 for a road with no roadblock, got %d", w.Code)
	}

	r.mustPost(http.StatusOK, "/shop/buy", map[string]interface{}{"powerup": "roadblock"}, red.Token)
	r.mustPost(http.StatusOK, "/powerup/use", map[string]interface{}{
		"powerup": "roadblock", "road_id": r.board.SegStartMid1, "idempotency_key": uuid.New().String(),
	}, red.Token)

	// The placer has nothing to clear.
	if w, _ := r.post("/roadblock/clear", map[string]interface{}{
		"road_id": r.board.SegStartMid1, "blob_ref": r.evidenceRef(red), "lat": 0.0, "lon": 0.0, "accuracy_m": 8.0,
		"idempotency_key": uuid.New().String(),
	}, red.Token); w.Code != http.StatusConflict {
		t.Errorf("expected 409 when the placer tries to clear its own roadblock, got %d", w.Code)
	}

	// A blocked team standing nowhere near the blocked road cannot work it off
	// remotely. Blue is at the start; the blocked-and-far case is the mid2
	// road, which carries no roadblock at all.
	if w, _ := r.post("/roadblock/clear", map[string]interface{}{
		"road_id": r.board.SegMid2Finish, "blob_ref": r.evidenceRef(blue), "lat": 0.0, "lon": 0.0, "accuracy_m": 8.0,
		"idempotency_key": uuid.New().String(),
	}, blue.Token); w.Code != http.StatusNotFound {
		t.Errorf("expected 404 for an unblocked road, got %d", w.Code)
	}

	// Red drops a second roadblock on a stretch Blue is nowhere near, and Blue
	// cannot clear it from where it stands. (The 20-coin challenge Red already
	// completed covers both 5-coin roadblocks.)
	r.mustPost(http.StatusOK, "/shop/buy", map[string]interface{}{"powerup": "roadblock"}, red.Token)
	r.mustPost(http.StatusOK, "/powerup/use", map[string]interface{}{
		"powerup": "roadblock", "road_id": r.board.SegMid2Finish, "idempotency_key": uuid.New().String(),
	}, red.Token)
	if w, _ := r.post("/roadblock/clear", map[string]interface{}{
		"road_id": r.board.SegMid2Finish, "blob_ref": r.evidenceRef(blue), "lat": 0.0, "lon": 0.0, "accuracy_m": 8.0,
		"idempotency_key": uuid.New().String(),
	}, blue.Token); w.Code != http.StatusForbidden {
		t.Errorf("expected 403 when clearing a roadblock the team is not standing at, got %d", w.Code)
	}
}

func hasWaypoint(waypoints []string, id string) bool {
	for _, n := range waypoints {
		if n == id {
			return true
		}
	}
	return false
}

// TestChallengePassedByOneTeamOpensTheWaypointForAll verifies clearing a challenge opens the waypoint for all subsequent teams.
func TestChallengePassedByOneTeamOpensTheWaypointForAll(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	defer database.Close()

	r := newRace(t, ctx, database, nil)
	red := r.join("Red", 0)
	blue := r.join("Blue", 1)
	r.start()

	r.advance(red, r.board.Mid1)
	r.completeChallenge(red, r.board.Mid1, r.board.Mid1Challenge, "pass")

	// Blue walks to the same waypoint and straight on, without raising a camera.
	r.advance(blue, r.board.Mid1)
	if w, _ := r.arrive(blue, r.board.Mid2); w.Code != http.StatusOK {
		t.Fatalf("expected Blue to walk on through a waypoint Red had cleared, got %d — %s", w.Code, w.Body.String())
	}

	proj := r.projection()
	if got := proj.Coins[blue.ID]; got != 0 {
		t.Errorf("expected Blue to earn nothing for a challenge it never did, it holds %d", got)
	}
	if got := proj.Coins[red.ID]; got != 20 {
		t.Errorf("expected Red to keep the first-completer reward, it holds %d", got)
	}
	// A waypoint the field has opened still counts as one this team reached.
	if !hasWaypoint(proj.Progress[blue.ID].ClearedWaypoints, r.board.Mid1) {
		t.Errorf("expected Mid 1 in Blue's progress, got %v", proj.Progress[blue.ID].ClearedWaypoints)
	}
}

// TestRoadblockClearedByOneTeamLiftsItForAll verifies clearing a roadblock removes the obstacle for following teams.
func TestRoadblockClearedByOneTeamLiftsItForAll(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	defer database.Close()

	r := newRace(t, ctx, database, map[string]interface{}{
		"powerup_costs": map[string]int{"roadblock": 5},
	})
	red := r.join("Red", 0)
	blue := r.join("Blue", 1)
	green := r.join("Green", 2)
	r.start()

	r.advance(red, r.board.Mid1)
	r.completeChallenge(red, r.board.Mid1, r.board.Mid1Challenge, "pass")
	r.mustPost(http.StatusOK, "/shop/buy", map[string]interface{}{"powerup": "roadblock"}, red.Token)
	r.mustPost(http.StatusOK, "/powerup/use", map[string]interface{}{
		"powerup": "roadblock", "road_id": r.board.SegMid1Mid2, "idempotency_key": uuid.New().String(),
	}, red.Token)

	// Both teams behind it are stopped by the card.
	r.advance(blue, r.board.Mid1)
	r.advance(green, r.board.Mid1)
	if w, _ := r.arrive(blue, r.board.Mid2); w.Code != http.StatusForbidden {
		t.Fatalf("expected the roadblock to stop Blue, got %d", w.Code)
	}
	if w, _ := r.arrive(green, r.board.Mid2); w.Code != http.StatusForbidden {
		t.Fatalf("expected the roadblock to stop Green, got %d", w.Code)
	}

	// Blue works it off, and the road opens for Green as well.
	clearLat, clearLon := r.board.coordsOf(r.board.Mid1)
	clear := r.mustPost(http.StatusCreated, "/roadblock/clear", map[string]interface{}{
		"road_id": r.board.SegMid1Mid2, "blob_ref": r.evidenceRef(blue),
		"lat": clearLat, "lon": clearLon, "accuracy_m": 8.0,
		"idempotency_key": uuid.New().String(),
	}, blue.Token)
	r.mustPost(http.StatusOK, "/verdict", map[string]interface{}{
		"submission_id": clear["submission_id"].(string), "verdict": "pass", "confidence": 0.9, "rationale": "challenge plainly performed",
	}, testWorkerToken)

	if w, _ := r.arrive(green, r.board.Mid2); w.Code != http.StatusOK {
		t.Fatalf("expected Green to pass a roadblock Blue had cleared, got %d — %s", w.Code, w.Body.String())
	}

	// And a team arriving afterwards is told there is nothing left to work off,
	// so no verification job is queued for work already done.
	if w, _ := r.post("/roadblock/clear", map[string]interface{}{
		"road_id": r.board.SegMid1Mid2, "blob_ref": r.evidenceRef(green),
		"lat": clearLat, "lon": clearLon, "accuracy_m": 8.0,
		"idempotency_key": uuid.New().String(),
	}, green.Token); w.Code != http.StatusConflict {
		t.Errorf("expected 409 when clearing a roadblock already lifted, got %d", w.Code)
	}
}

// TestCurseCanBeResolved tests that active curses can be resolved by the targeted team.
func TestCurseCanBeResolved(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	defer database.Close()

	r := newRace(t, ctx, database, map[string]interface{}{
		"powerup_costs": map[string]int{"curse": 5},
	})
	red := r.join("Red", 0)
	blue := r.join("Blue", 1)
	r.start()
	r.advance(red, r.board.Mid1)
	r.completeChallenge(red, r.board.Mid1, r.board.Mid1Challenge, "pass")

	r.mustPost(http.StatusOK, "/shop/buy", map[string]interface{}{"powerup": "curse"}, red.Token)
	r.mustPost(http.StatusOK, "/powerup/use", map[string]interface{}{
		"powerup": "curse", "target_team_id": blue.ID, "idempotency_key": uuid.New().String(),
	}, red.Token)

	proj := r.projection()
	var cardID string
	for _, eff := range proj.Effects[blue.ID] {
		if eff.Kind == "curse" {
			cardID = eff.Meta
		}
	}
	if cardID == "" {
		t.Fatalf("expected Blue to be carrying a curse, got %+v", proj.Effects[blue.ID])
	}

	// Only the cursed team can put the curse down, and only the right card.
	if w, _ := r.post("/curse/resolve", map[string]interface{}{"card_id": cardID}, red.Token); w.Code != http.StatusNotFound {
		t.Errorf("expected 404 when a team resolves a curse it is not carrying, got %d", w.Code)
	}
	if w, _ := r.post("/curse/resolve", map[string]interface{}{"card_id": uuid.New().String()}, blue.Token); w.Code != http.StatusNotFound {
		t.Errorf("expected 404 for an unknown card id, got %d", w.Code)
	}

	r.mustPost(http.StatusOK, "/curse/resolve", map[string]interface{}{
		"card_id": cardID, "idempotency_key": uuid.New().String(),
	}, blue.Token)

	proj = r.projection()
	for _, eff := range proj.Effects[blue.ID] {
		if eff.Kind == "curse" && eff.Meta == cardID {
			t.Fatalf("expected the curse to be gone from the projection, got %+v", proj.Effects[blue.ID])
		}
	}

	// The runtime mirror must not resurrect it.
	var remaining int
	if err := database.Pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM team_effects WHERE game_id = $1 AND team_id = $2 AND kind = 'curse'
	`, r.GameID, blue.ID).Scan(&remaining); err != nil {
		t.Fatalf("failed to count team_effects: %v", err)
	}
	if remaining != 0 {
		t.Errorf("expected the team_effects curse row to be deleted, %d remain", remaining)
	}
}

// TestGameRulesetIsHonoured tests that custom game ruleset parameters are applied.
func TestGameRulesetIsHonoured(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	defer database.Close()

	r := newRace(t, ctx, database, map[string]interface{}{
		"freeze_duration_seconds":      60,
		"tracker_off_duration_seconds": 90,
		"coin_reward_max":              7,
		"reward_only_first_completer":  false,
		"powerup_costs":                map[string]int{"nerf": 1, "tracker_off": 1},
	})
	red := r.join("Red", 0)
	blue := r.join("Blue", 1)
	r.start()

	// coin_reward_max caps the board's 20-coin challenge at 7, and
	// reward_only_first_completer=false pays the second team the same.
	r.advance(red, r.board.Mid1)
	r.advance(blue, r.board.Mid1)
	r.completeChallenge(red, r.board.Mid1, r.board.Mid1Challenge, "pass")
	r.completeChallenge(blue, r.board.Mid1, r.board.Mid1Challenge, "pass")

	proj := r.projection()
	if got := proj.Coins[red.ID]; got != 7 {
		t.Errorf("expected the ruleset's coin ceiling of 7, Red earned %d", got)
	}
	if got := proj.Coins[blue.ID]; got != 7 {
		t.Errorf("expected reward_only_first_completer=false to pay Blue too, Blue earned %d", got)
	}

	// The ruleset's power-up prices apply where the board sets none.
	r.mustPost(http.StatusOK, "/shop/buy", map[string]interface{}{"powerup": "nerf"}, red.Token)
	if got := r.projection().Coins[red.ID]; got != 6 {
		t.Errorf("expected the ruleset's nerf price of 1, Red now holds %d", got)
	}

	// The freeze lasts the ruleset's 60 seconds, not the default 30 minutes.
	before := time.Now().UTC()
	r.mustPost(http.StatusOK, "/powerup/use", map[string]interface{}{
		"powerup": "nerf", "target_team_id": blue.ID, "idempotency_key": uuid.New().String(),
	}, red.Token)

	proj = r.projection()
	var freezeUntil time.Time
	for _, eff := range proj.Effects[blue.ID] {
		if eff.Kind == "freeze" {
			freezeUntil = eff.Until
		}
	}
	if freezeUntil.IsZero() {
		t.Fatalf("expected a freeze effect on Blue, got %+v", proj.Effects[blue.ID])
	}
	if got := freezeUntil.Sub(before); got > 90*time.Second {
		t.Errorf("expected a ~60s freeze from the game's ruleset, got %v", got)
	}

	// Tracker-off honours its own configured duration too.
	r.mustPost(http.StatusOK, "/shop/buy", map[string]interface{}{"powerup": "tracker_off"}, red.Token)
	trackerBefore := time.Now().UTC()
	r.mustPost(http.StatusOK, "/powerup/use", map[string]interface{}{
		"powerup": "tracker_off", "idempotency_key": uuid.New().String(),
	}, red.Token)

	proj = r.projection()
	var trackerUntil time.Time
	for _, eff := range proj.Effects[red.ID] {
		if eff.Kind == "tracker_off" {
			trackerUntil = eff.Until
		}
	}
	if trackerUntil.IsZero() {
		t.Fatalf("expected a tracker_off effect on Red, got %+v", proj.Effects[red.ID])
	}
	if got := trackerUntil.Sub(trackerBefore); got > 120*time.Second {
		t.Errorf("expected a ~90s tracker_off from the game's ruleset, got %v", got)
	}
}

// TestRepeatedCompletionIsNotPaidTwice tests that repeating a challenge completion
// awards no additional coins.
func TestRepeatedCompletionIsNotPaidTwice(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	defer database.Close()

	r := newRace(t, ctx, database, nil)
	red := r.join("Red", 0)
	r.start()
	r.advance(red, r.board.Mid1)

	r.completeChallenge(red, r.board.Mid1, r.board.Mid1Challenge, "pass")
	if got := r.projection().Coins[red.ID]; got != 20 {
		t.Fatalf("expected 20 coins for the first completion, got %d", got)
	}

	for i := 0; i < 3; i++ {
		r.completeChallenge(red, r.board.Mid1, r.board.Mid1Challenge, "pass")
	}
	if got := r.projection().Coins[red.ID]; got != 20 {
		t.Errorf("expected repeat completions to pay nothing, Red holds %d", got)
	}
}

// TestVetoPenaltyIsClampedToTheRuleset tests that veto penalties are constrained
// by ruleset minimum and maximum boundaries.
func TestVetoPenaltyIsClampedToTheRuleset(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	defer database.Close()

	// The board's challenges ask for a 3600s penalty; this game caps it at 120.
	r := newRace(t, ctx, database, map[string]interface{}{
		"veto_penalty_min_seconds": 60,
		"veto_penalty_max_seconds": 120,
	})
	red := r.join("Red", 0)
	r.start()
	r.advance(red, r.board.Mid1)

	before := time.Now().UTC()
	resp := r.mustPost(http.StatusOK, "/veto", map[string]interface{}{
		"waypoint_id": r.board.Mid1, "idempotency_key": uuid.New().String(),
	}, red.Token)

	until, err := time.Parse(time.RFC3339, resp["penalty_until"].(string))
	if err != nil {
		t.Fatalf("failed to parse penalty_until: %v", err)
	}
	if got := until.Sub(before); got > 150*time.Second {
		t.Errorf("expected the board's 3600s penalty clamped to the ruleset's 120s ceiling, got %v", got)
	}

	// A veto is a bypass: Red may now leave the waypoint it refused.
	if w, _ := r.arrive(red, r.board.Mid2); w.Code != http.StatusOK {
		t.Errorf("expected a vetoed waypoint to stop gating departure, got %d — %s", w.Code, w.Body.String())
	}
}

// TestVetoCooldownLocksOutEveryChallenge tests that an active veto penalty
// prevents starting any new challenges during the cooldown.
func TestVetoCooldownLocksOutEveryChallenge(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	defer database.Close()

	// Long enough that nothing in this test outlives the cooldown.
	r := newRace(t, ctx, database, map[string]interface{}{
		"veto_penalty_min_seconds": 600,
		"veto_penalty_max_seconds": 600,
	})
	red := r.join("Red", 0)
	r.start()
	r.advance(red, r.board.Mid1)

	r.mustPost(http.StatusOK, "/veto", map[string]interface{}{
		"waypoint_id": r.board.Mid1, "idempotency_key": uuid.New().String(),
	}, red.Token)

	// The shape a client parses. A cooldown travels as a row in the team's effect
	// list — {kind, until, meta} — never as a `veto_penalty_until` field of its
	// own. The player console read it the second way for a while and so counted
	// down from `undefined`: no timer, no chip, nothing on screen.
	_, state := serve(t, ctx, r.server, jsonRequest("GET", "/api/games/"+r.GameID, nil, red.Token))
	effects, _ := state["effects"].(map[string]interface{})
	rows, _ := effects[red.ID].([]interface{})
	if len(rows) == 0 {
		t.Fatalf("expected the cooldown to reach clients as a list of effect rows, got %#v", state["effects"])
	}
	row, _ := rows[0].(map[string]interface{})
	if row["kind"] != "veto_penalty" || row["until"] == nil {
		t.Errorf("expected a veto_penalty row carrying an expiry, got %#v", rows[0])
	}
	// Still recorded, still not what the gate reads.
	if row["meta"] != r.board.Mid1 {
		t.Errorf("expected the row to record the waypoint the veto was spent on, got %#v", row["meta"])
	}

	// The road is open. A cooldown costs time, never progress.
	r.advance(red, r.board.Mid2)

	// Mid2's challenge is out of reach even though Red never refused *that* one.
	lat, lon := r.board.coordsOf(r.board.Mid2)
	if w, _ := r.post("/challenge/start", map[string]interface{}{
		"waypoint_id": r.board.Mid2, "lat": lat, "lon": lon, "accuracy_m": 8.0,
		"idempotency_key": uuid.New().String(),
	}, red.Token); w.Code != http.StatusForbidden {
		t.Fatalf("expected the cooldown to refuse a challenge on another waypoint, got %d — %s", w.Code, w.Body.String())
	}

	// Locked out is not stranded: Red can walk away from this one too and keep
	// going, paying a fresh cooldown for it.
	r.mustPost(http.StatusOK, "/veto", map[string]interface{}{
		"waypoint_id": r.board.Mid2, "idempotency_key": uuid.New().String(),
	}, red.Token)
	r.advance(red, r.board.Finish)
}

// TestArrivalIsRefusedWhenTheMovementIsImpossible tests that arrivals with physically
// impossible travel speeds are rejected.
func TestArrivalIsRefusedWhenTheMovementIsImpossible(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	defer database.Close()

	r := newRace(t, ctx, database, nil)
	red := r.join("Red", 0)
	r.start()

	// A fix from twenty seconds ago, about 55 km away: reaching Mid1 from there
	// would take some thousands of metres per second.
	if _, err := database.Pool.Exec(ctx, `
		INSERT INTO team_positions (game_id, team_id, lat, lon, accuracy_m, reported_at)
		VALUES ($1, $2, 0.0, 0.5, 8.0, NOW() - INTERVAL '20 seconds')
		ON CONFLICT (game_id, team_id) DO UPDATE
		  SET lat = EXCLUDED.lat, lon = EXCLUDED.lon, reported_at = EXCLUDED.reported_at
	`, r.GameID, red.ID); err != nil {
		t.Fatalf("failed to seed a stale far-away fix: %v", err)
	}

w, _ := r.rawArrive(red, r.board.Mid1)
	if w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected the teleport to be refused with 422, got %d - %s", w.Code, w.Body.String())
	}

	// The attempt is on the record even though the arrival did not happen.
	var flags int
	if err := database.Pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM events WHERE game_id = $1 AND event_type = 'ArrivalFlagged'
	`, r.GameID).Scan(&flags); err != nil {
		t.Fatalf("failed to count flags: %v", err)
	}
	if flags != 1 {
		t.Errorf("expected the refused arrival to be recorded once, got %d events", flags)
	}

	// And it heals: a player who is actually there reports a fresh fix and walks
	// in. Nothing about the refusal is sticky.
	if _, err := database.Pool.Exec(ctx, `
		UPDATE team_positions SET lat = 0.0, lon = 0.01, reported_at = NOW()
		 WHERE game_id = $1 AND team_id = $2
	`, r.GameID, red.ID); err != nil {
		t.Fatalf("failed to refresh the fix: %v", err)
	}
	if w, _ := r.arrive(red, r.board.Mid1); w.Code != http.StatusOK {
		t.Fatalf("a fresh fix at the waypoint should be let through, got %d — %s", w.Code, w.Body.String())
	}
}

func TestChallengeCompletionAwardsCoinsWithWaypointID(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	defer database.Close()

	r := newRace(t, ctx, database, nil)
	red := r.join("Red", 0)
	r.start()
	r.advance(red, r.board.Mid1)

	// Submit using waypointID as challengeID (matching frontend behaviour when client submits evidence)
	r.completeChallenge(red, r.board.Mid1, r.board.Mid1, "pass")
	if got := r.projection().Coins[red.ID]; got != 20 {
		t.Fatalf("expected 20 coins for completing challenge using waypointID, got %d", got)
	}
}
