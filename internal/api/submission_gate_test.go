package api_test

import (
	"net/http"
	"testing"

	"github.com/google/uuid"
)

// TestSubmissionEnforcesTheSameGatesAsChallengeStart is the regression test for
// POST /submission accepting evidence for any waypoint on the board, from anywhere,
// with no attempt behind it — and then handing the verification worker a GPS
// payload of hardcoded zeroes so nothing downstream could catch it either.
func TestSubmissionEnforcesTheSameGatesAsChallengeStart(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	defer database.Close()

	r := newRace(t, ctx, database, nil)
	red := r.join("Red", 0)
	r.start()

	evidence := func(extra map[string]interface{}) map[string]interface{} {
		body := map[string]interface{}{
			"blob_ref":        r.evidenceRef(red),
			"idempotency_key": uuid.New().String(),
		}
		for k, v := range extra {
			body[k] = v
		}
		return body
	}

	mid1Lat, mid1Lon := r.board.coordsOf(r.board.Mid1)

	// A team standing at the start cannot submit for a waypoint further down the
	// board, however good its claimed fix is.
	if w, _ := r.post("/submission", evidence(map[string]interface{}{
		"waypoint_id": r.board.Mid1, "challenge_id": r.board.Mid1Challenge,
		"lat": mid1Lat, "lon": mid1Lon, "accuracy_m": 8.0,
	}), red.Token); w.Code != http.StatusForbidden {
		t.Errorf("submission for a waypoint the team has not reached: expected 403, got %d — %s", w.Code, w.Body.String())
	}

	// Move Red to Mid1 legitimately, but do not open the challenge.
	r.advance(red, r.board.Mid1)

	if w, _ := r.post("/submission", evidence(map[string]interface{}{
		"waypoint_id": r.board.Mid1, "challenge_id": r.board.Mid1Challenge,
		"lat": mid1Lat, "lon": mid1Lon, "accuracy_m": 8.0,
	}), red.Token); w.Code != http.StatusForbidden {
		t.Errorf("submission with no challenge attempt: expected 403, got %d — %s", w.Code, w.Body.String())
	}

	// Open the challenge. Now the only thing left to fail is the fix itself.
	r.mustPost(http.StatusOK, "/challenge/start", map[string]interface{}{
		"waypoint_id": r.board.Mid1, "lat": mid1Lat, "lon": mid1Lon, "accuracy_m": 8.0,
		"idempotency_key": uuid.New().String(),
	}, red.Token)

	// No fix at all is refused rather than silently treated as (0, 0).
	if w, _ := r.post("/submission", evidence(map[string]interface{}{
		"waypoint_id": r.board.Mid1, "challenge_id": r.board.Mid1Challenge,
	}), red.Token); w.Code != http.StatusBadRequest {
		t.Errorf("submission with no fix: expected 400, got %d — %s", w.Code, w.Body.String())
	}

	// A fix a kilometre away is refused by the same gate /arrive uses.
	farLat, farLon := r.board.coordsOf(r.board.Finish)
	if w, _ := r.post("/submission", evidence(map[string]interface{}{
		"waypoint_id": r.board.Mid1, "challenge_id": r.board.Mid1Challenge,
		"lat": farLat, "lon": farLon, "accuracy_m": 8.0,
	}), red.Token); w.Code != http.StatusUnprocessableEntity {
		t.Errorf("submission from far away: expected 422, got %d — %s", w.Code, w.Body.String())
	}

	// An inflated accuracy is not a way around it either.
	if w, _ := r.post("/submission", evidence(map[string]interface{}{
		"waypoint_id": r.board.Mid1, "challenge_id": r.board.Mid1Challenge,
		"lat": farLat, "lon": farLon, "accuracy_m": 9999.0,
	}), red.Token); w.Code != http.StatusUnprocessableEntity {
		t.Errorf("submission with an implausible accuracy: expected 422, got %d — %s", w.Code, w.Body.String())
	}

	// Standing at the waypoint, with the attempt open and a believable fix, works.
	r.mustPost(http.StatusCreated, "/submission", evidence(map[string]interface{}{
		"waypoint_id": r.board.Mid1, "challenge_id": r.board.Mid1Challenge,
		"lat": mid1Lat, "lon": mid1Lon, "accuracy_m": 8.0,
	}), red.Token)
}

// TestSubmissionForwardsRealGPSToTheWorker covers the verification job payload
// carrying lat/lon/accuracy_m of 0, which made the worker's GPS heuristics
// unable to tell a spoofed capture from a real one.
func TestSubmissionForwardsRealGPSToTheWorker(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	defer database.Close()

	r := newRace(t, ctx, database, nil)
	red := r.join("Red", 0)
	r.start()
	r.advance(red, r.board.Mid1)

	lat, lon := r.board.coordsOf(r.board.Mid1)
	r.mustPost(http.StatusOK, "/challenge/start", map[string]interface{}{
		"waypoint_id": r.board.Mid1, "lat": lat, "lon": lon, "accuracy_m": 8.0,
		"idempotency_key": uuid.New().String(),
	}, red.Token)

	sub := r.mustPost(http.StatusCreated, "/submission", map[string]interface{}{
		"waypoint_id": r.board.Mid1, "challenge_id": r.board.Mid1Challenge,
		"lat": lat, "lon": lon, "accuracy_m": 8.0,
		"blob_ref": r.evidenceRef(red), "idempotency_key": uuid.New().String(),
	}, red.Token)
	submissionID := sub["submission_id"].(string)

	var payloadLat, payloadLon, payloadAccuracy float64
	err := database.Pool.QueryRow(ctx, `
		SELECT (payload->'gps'->>'lat')::float8,
		       (payload->'gps'->>'lon')::float8,
		       (payload->'gps'->>'accuracy_m')::float8
		FROM jobs
		WHERE job_type = 'verification' AND payload->>'submission_id' = $1
	`, submissionID).Scan(&payloadLat, &payloadLon, &payloadAccuracy)
	if err != nil {
		t.Fatalf("failed to read the verification job payload: %v", err)
	}
	if payloadLat != lat || payloadLon != lon {
		t.Errorf("worker got gps (%v, %v), want the reported fix (%v, %v)", payloadLat, payloadLon, lat, lon)
	}
	if payloadAccuracy != 8.0 {
		t.Errorf("worker got accuracy_m %v, want the reported 8", payloadAccuracy)
	}
}
