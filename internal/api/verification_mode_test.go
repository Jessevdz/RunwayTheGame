package api_test

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/Jessevdz/RunwayTheGame/internal/rules"
)

// The two ways to run a race without an AI referee.
//
// Both are one branch at one seam — what the submission handler does with the
// photo — so these tests are mostly about the things that seam is easy to get
// wrong: a job queued anyway, a verdict route that accepts the wrong author, and
// the dispute path quietly reintroducing the model a game opted out of.

// countVerificationJobs is the assertion that matters most in both modes. A
// queued job means the photo is on its way to a third-party model, which is
// exactly what choosing either of these modes said not to do.
func countVerificationJobs(t *testing.T, r *race, submissionID string) int {
	t.Helper()
	var n int
	err := r.database.Pool.QueryRow(r.ctx, `
		SELECT COUNT(*) FROM jobs
		WHERE job_type = 'verification' AND payload->>'submission_id' = $1
	`, submissionID).Scan(&n)
	if err != nil {
		t.Fatalf("failed to count verification jobs: %v", err)
	}
	return n
}

// openChallenge walks a team to a waypoint and opens its challenge, which is
// everything that has to happen before a photo can be submitted.
func openChallenge(t *testing.T, r *race, tm team, waypointID string) (lat, lon float64) {
	t.Helper()
	r.advance(tm, waypointID)
	lat, lon = r.board.coordsOf(waypointID)
	r.mustPost(http.StatusOK, "/challenge/start", map[string]interface{}{
		"waypoint_id": waypointID, "lat": lat, "lon": lon, "accuracy_m": 8.0,
		"idempotency_key": uuid.New().String(),
	}, tm.Token)
	return lat, lon
}

func submitEvidence(t *testing.T, r *race, tm team, waypointID, challengeID string, lat, lon float64) map[string]interface{} {
	t.Helper()
	return r.mustPost(http.StatusCreated, "/submission", map[string]interface{}{
		"waypoint_id": waypointID, "challenge_id": challengeID,
		"lat": lat, "lon": lon, "accuracy_m": 8.0,
		"blob_ref": r.evidenceRef(tm), "idempotency_key": uuid.New().String(),
	}, tm.Token)
}

// TestTrustModeSettlesTheSubmissionInline covers the honour system end to end:
// the pass is written in the same transaction as the submission, nothing is
// queued for the worker, and the waypoint opens and pays out exactly as a graded
// pass would.
func TestTrustModeSettlesTheSubmissionInline(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	defer database.Close()

	r := newRace(t, ctx, database, map[string]interface{}{"verification": rules.VerificationTrust})
	red := r.join("Red", 0)
	r.start()

	lat, lon := openChallenge(t, r, red, r.board.Mid1)
	sub := submitEvidence(t, r, red, r.board.Mid1, r.board.Mid1Challenge, lat, lon)
	submissionID := sub["submission_id"].(string)

	// The response itself carries the verdict — the player is not sent to a
	// spinner to wait for something that has already happened.
	if sub["status"] != "pass" {
		t.Errorf("expected a trust-mode submission to come back already passed, got %v", sub["status"])
	}

	if n := countVerificationJobs(t, r, submissionID); n != 0 {
		t.Errorf("trust mode queued %d verification job(s): the photo must never reach the model", n)
	}

	proj := r.projection()
	info, ok := proj.Submissions[submissionID]
	if !ok {
		t.Fatalf("submission %s is missing from the projection", submissionID)
	}
	if info.Status != "pass" {
		t.Errorf("expected the projection to show a pass, got %q", info.Status)
	}
	// Provenance is folded from the event, so the log can still answer "what
	// graded this" long after the game's setting is gone.
	if info.Source != rules.VerificationTrust {
		t.Errorf("expected the verdict to record source %q, got %q", rules.VerificationTrust, info.Source)
	}
	// The whole point of routing through the same verdict logic: a trust pass
	// settles progress and coins like any other.
	if !proj.WaypointStates[r.board.Mid1].ClearedBy[red.ID] {
		t.Error("expected the waypoint to be cleared for the team that submitted")
	}
	if proj.Coins[red.ID] <= 0 {
		t.Errorf("expected a trust-mode pass to pay the challenge reward, got %d coins", proj.Coins[red.ID])
	}
}

// TestTrustModeRefusesDisputes: nothing is ever rejected, so there is no verdict
// to appeal. Saying so is better than recording a dispute a host cannot act on.
func TestTrustModeRefusesDisputes(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	defer database.Close()

	r := newRace(t, ctx, database, map[string]interface{}{"verification": rules.VerificationTrust})
	red := r.join("Red", 0)
	r.start()

	lat, lon := openChallenge(t, r, red, r.board.Mid1)
	sub := submitEvidence(t, r, red, r.board.Mid1, r.board.Mid1Challenge, lat, lon)

	w, _ := r.post("/dispute", map[string]interface{}{
		"verdict_id": sub["submission_id"], "objection": "I want a second look",
	}, red.Token)
	if w.Code != http.StatusForbidden {
		t.Errorf("dispute in trust mode: expected 403, got %d — %s", w.Code, w.Body.String())
	}
}

// TestHostModeHoldsSubmissionsForAPerson is the core of option 1: a submission
// queues no job, settles nothing, and waits.
func TestHostModeHoldsSubmissionsForAPerson(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	defer database.Close()

	r := newRace(t, ctx, database, map[string]interface{}{"verification": rules.VerificationHost})
	red := r.join("Red", 0)
	r.start()

	lat, lon := openChallenge(t, r, red, r.board.Mid1)
	sub := submitEvidence(t, r, red, r.board.Mid1, r.board.Mid1Challenge, lat, lon)
	submissionID := sub["submission_id"].(string)

	if sub["status"] != "pending_review" {
		t.Errorf("expected a host-graded submission to report pending_review, got %v", sub["status"])
	}
	if n := countVerificationJobs(t, r, submissionID); n != 0 {
		t.Errorf("host mode queued %d verification job(s): the photo must never reach the model", n)
	}

	proj := r.projection()
	if got := proj.Submissions[submissionID].Status; got != "pending" {
		t.Errorf("expected the submission to still be pending, got %q", got)
	}
	if proj.WaypointStates[r.board.Mid1].ClearedBy[red.ID] {
		t.Error("an ungraded submission must not clear the waypoint")
	}
	if proj.Coins[red.ID] != 0 {
		t.Errorf("an ungraded submission must not pay out, got %d coins", proj.Coins[red.ID])
	}

	// The review queue is what the host actually works from, and it has to carry
	// the criteria the photo was taken against — a host grading from memory would
	// judge each team by a slightly different standard.
	w, queue := serve(t, ctx, r.server, jsonRequest("GET", r.url("/review"), nil, r.HostToken))
	if w.Code != http.StatusOK {
		t.Fatalf("review queue: got %d — %s", w.Code, w.Body.String())
	}
	if queue["verification"] != rules.VerificationHost {
		t.Errorf("expected the queue to report the game's grading mode, got %v", queue["verification"])
	}
	pending, _ := queue["pending"].([]interface{})
	if len(pending) != 1 {
		t.Fatalf("expected exactly one queued submission, got %d", len(pending))
	}
	item := pending[0].(map[string]interface{})
	if item["submission_id"] != submissionID {
		t.Errorf("queue holds submission %v, want %s", item["submission_id"], submissionID)
	}
	if item["team_name"] != "Red" {
		t.Errorf("expected the queue to name the team, got %v", item["team_name"])
	}
	if item["prompt"] == "" || item["prompt"] == nil {
		t.Error("expected the queue to carry the challenge prompt")
	}

	// The queue carries evidence for every team, so it must stay behind the host
	// capability — a player must not be able to read it.
	if w, _ := serve(t, ctx, r.server, jsonRequest("GET", r.url("/review"), nil, red.Token)); w.Code != http.StatusForbidden {
		t.Errorf("review queue with a team token: expected 403, got %d — %s", w.Code, w.Body.String())
	}
}

// TestHostModeGradingSettlesTheRace proves a hand verdict goes through exactly
// the same write path a model's does — progress, coins and all.
func TestHostModeGradingSettlesTheRace(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	defer database.Close()

	r := newRace(t, ctx, database, map[string]interface{}{"verification": rules.VerificationHost})
	red := r.join("Red", 0)
	r.start()

	lat, lon := openChallenge(t, r, red, r.board.Mid1)
	sub := submitEvidence(t, r, red, r.board.Mid1, r.board.Mid1Challenge, lat, lon)
	submissionID := sub["submission_id"].(string)

	// The worker holds a real capability but has no business here: this game's
	// players were told no model would see their photos.
	w, _ := r.post("/verdict", map[string]interface{}{
		"submission_id": submissionID, "verdict": "pass", "confidence": 0.9, "rationale": "looks right",
	}, testWorkerToken)
	if w.Code != http.StatusConflict {
		t.Errorf("worker verdict on a host-graded game: expected 409, got %d — %s", w.Code, w.Body.String())
	}

	// And a player still cannot grade their own evidence.
	if w, _ := r.post("/verdict", map[string]interface{}{
		"submission_id": submissionID, "verdict": "pass",
	}, red.Token); w.Code != http.StatusForbidden {
		t.Errorf("team verdict: expected 403, got %d — %s", w.Code, w.Body.String())
	}

	r.mustPost(http.StatusOK, "/verdict", map[string]interface{}{
		"submission_id": submissionID, "verdict": "pass", "confidence": 1,
		"rationale": "Yep, that's the mural.",
	}, r.HostToken)

	proj := r.projection()
	info := proj.Submissions[submissionID]
	if info.Status != "pass" {
		t.Errorf("expected the submission to pass, got %q", info.Status)
	}
	if info.Source != rules.VerificationHost {
		t.Errorf("expected the verdict to record source %q, got %q", rules.VerificationHost, info.Source)
	}
	if info.Rationale != "Yep, that's the mural." {
		t.Errorf("expected the host's note to reach the team verbatim, got %q", info.Rationale)
	}
	if !proj.WaypointStates[r.board.Mid1].ClearedBy[red.ID] {
		t.Error("expected a host pass to clear the waypoint")
	}
	if proj.Coins[red.ID] <= 0 {
		t.Errorf("expected a host pass to pay the challenge reward, got %d coins", proj.Coins[red.ID])
	}

	// A second tap on a stale queue must not re-grade or re-pay. The queue the
	// host is looking at may be seconds behind, and two hosts may be on two
	// phones.
	if w, _ := r.post("/verdict", map[string]interface{}{
		"submission_id": submissionID, "verdict": "fail", "rationale": "changed my mind",
	}, r.HostToken); w.Code != http.StatusConflict {
		t.Errorf("re-grading a settled submission: expected 409, got %d — %s", w.Code, w.Body.String())
	}
	if after := r.projection(); after.Coins[red.ID] != proj.Coins[red.ID] {
		t.Errorf("a refused re-grade changed the balance: %d -> %d", proj.Coins[red.ID], after.Coins[red.ID])
	}
}

// TestHostModeDisputeDoesNotReachTheModel is the leak this feature would most
// plausibly have shipped with: the dispute route re-grades an appeal by queueing
// a verification job, so in host mode any team could have turned a race that
// promised no AI into one by objecting to a verdict.
func TestHostModeDisputeDoesNotReachTheModel(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	defer database.Close()

	r := newRace(t, ctx, database, map[string]interface{}{"verification": rules.VerificationHost})
	red := r.join("Red", 0)
	r.start()

	lat, lon := openChallenge(t, r, red, r.board.Mid1)
	sub := submitEvidence(t, r, red, r.board.Mid1, r.board.Mid1Challenge, lat, lon)
	submissionID := sub["submission_id"].(string)

	r.mustPost(http.StatusOK, "/verdict", map[string]interface{}{
		"submission_id": submissionID, "verdict": "fail", "confidence": 1, "rationale": "the mural is not in frame",
	}, r.HostToken)

	r.mustPost(http.StatusCreated, "/dispute", map[string]interface{}{
		"verdict_id": submissionID, "objection": "It is in the top left corner.",
	}, red.Token)

	if n := countVerificationJobs(t, r, submissionID); n != 0 {
		t.Errorf("a dispute in host mode queued %d verification job(s): appealing must not send the photo to a model", n)
	}

	// It still reaches the host's dispute queue, which is where a person can act
	// on it — the appeal is not silently dropped.
	if _, ok := r.projection().Disputes[submissionID]; !ok {
		t.Error("expected the dispute to be recorded for the host to resolve")
	}
}

// TestUnknownGradingModeIsRefusedAtCreation: every other ruleset field is a
// number that normalization can quietly repair. This one is a consent decision,
// so a typo has to be a 400 before a game exists rather than a surprise at a
// waypoint.
func TestUnknownGradingModeIsRefusedAtCreation(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	defer database.Close()

	server := newTestServer(database)

	boardID := uuid.New().String()
	if _, err := database.Pool.Exec(ctx,
		"INSERT INTO boards (id, version, name, published_at) VALUES ($1, 1, 'Grading Test Board', NOW())", boardID); err != nil {
		t.Fatalf("failed to seed a board: %v", err)
	}

	create := func(mode string, verification string) *httptest.ResponseRecorder {
		body := map[string]interface{}{
			"board_id": boardID, "board_version": 1,
			"starts_at": time.Now().Add(-time.Hour), "ends_at": time.Now().Add(time.Hour),
			"ruleset": map[string]interface{}{"verification": verification},
		}
		if mode != "" {
			body["mode"] = mode
		}
		w, _ := serve(t, ctx, server, jsonRequest("POST", "/api/games", body, ""))
		return w
	}

	for _, bad := range []string{"manual", "gm", "none", "LLM"} {
		if w := create("", bad); w.Code != http.StatusBadRequest {
			t.Errorf("verification %q: expected 400, got %d — %s", bad, w.Code, w.Body.String())
		}
	}
	for _, good := range []string{rules.VerificationLLM, rules.VerificationHost, rules.VerificationTrust} {
		if w := create("", good); w.Code != http.StatusCreated {
			t.Errorf("verification %q: expected 201, got %d — %s", good, w.Code, w.Body.String())
		}
	}
}

// TestSoloRunCannotBeGradedByItsHost: the runner holds their own host token, so
// this is not a capability problem — it is that the race shell never gives a
// lone runner the host tools, and a queue nobody reads is a run that cannot
// finish.
func TestSoloRunCannotBeGradedByItsHost(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	defer database.Close()

	server := newTestServer(database)
	boardID := uuid.New().String()
	mustExec := func(query string, args ...interface{}) {
		t.Helper()
		if _, err := database.Pool.Exec(ctx, query, args...); err != nil {
			t.Fatalf("setup query failed: %v (%s)", err, query)
		}
	}
	mustExec("INSERT INTO boards (id, version, name, published_at) VALUES ($1, 1, 'Solo Grading Board', NOW())", boardID)
	mustExec(`
		INSERT INTO board_waypoints (id, board_id, board_version, name, location, is_start, is_finish, arrival_radius_m) VALUES
		($2, $1, 1, 'Start', ST_SetSRID(ST_MakePoint(0.0, 0.0), 4326), true, false, 25),
		($3, $1, 1, 'Finish', ST_SetSRID(ST_MakePoint(0.0, 0.01), 4326), false, true, 25)
	`, boardID, uuid.New().String(), uuid.New().String())

	solo := func(verification string) *httptest.ResponseRecorder {
		w, _ := serve(t, ctx, server, jsonRequest("POST", "/api/games/solo", map[string]interface{}{
			"board_id": boardID, "board_version": 1,
			"mode": rules.ModeSoloTimeTrial, "runner_name": "Jordan",
			"ruleset":         map[string]interface{}{"verification": verification},
			"idempotency_key": uuid.New().String(),
		}, ""))
		return w
	}

	if w := solo(rules.VerificationHost); w.Code != http.StatusBadRequest {
		t.Errorf("solo run graded by the host: expected 400, got %d — %s", w.Code, w.Body.String())
	}
	for _, good := range []string{rules.VerificationLLM, rules.VerificationTrust} {
		if w := solo(good); w.Code != http.StatusCreated {
			t.Errorf("solo run with %q grading: expected 201, got %d — %s", good, w.Code, w.Body.String())
		}
	}
}

func TestCasualSoloRunRefusesReferee(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	defer database.Close()

	server := newTestServer(database)
	boardID := uuid.New().String()
	mustExec := func(query string, args ...interface{}) {
		t.Helper()
		if _, err := database.Pool.Exec(ctx, query, args...); err != nil {
			t.Fatalf("setup query failed: %v (%s)", err, query)
		}
	}
	mustExec("INSERT INTO boards (id, version, name, published_at) VALUES ($1, 1, 'Casual Solo Board', NOW())", boardID)

	soloCasual := func(verification string) *httptest.ResponseRecorder {
		body := map[string]interface{}{
			"board_id": boardID, "board_version": 1,
			"mode": rules.ModeSoloCasual, "runner_name": "Jordan",
			"idempotency_key": uuid.New().String(),
		}
		if verification != "" {
			body["ruleset"] = map[string]interface{}{"verification": verification}
		}
		w, _ := serve(t, ctx, server, jsonRequest("POST", "/api/games/solo", body, ""))
		return w
	}

	for _, bad := range []string{rules.VerificationLLM, rules.VerificationHost} {
		if w := soloCasual(bad); w.Code != http.StatusBadRequest {
			t.Errorf("casual solo run with %q referee: expected 400, got %d — %s", bad, w.Code, w.Body.String())
		}
	}

	// Omitting verification or specifying trust should create the game with trust verification.
	if w := soloCasual(""); w.Code != http.StatusCreated {
		t.Errorf("casual solo run default: expected 201, got %d — %s", w.Code, w.Body.String())
	}
	if w := soloCasual(rules.VerificationTrust); w.Code != http.StatusCreated {
		t.Errorf("casual solo run trust: expected 201, got %d — %s", w.Code, w.Body.String())
	}
}
