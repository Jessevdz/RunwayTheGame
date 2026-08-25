package api_test

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/Jessevdz/RunwayTheGame/internal/projections"
)

// TestNerfAndChallengeSkipPowerupsUseTheCatalogNames verifies powerup usage accepts standard catalog item names.
func TestNerfAndChallengeSkipPowerupsUseTheCatalogNames(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	defer database.Close()

	server := newTestServer(database)

	boardID := uuid.New().String()
	challengeID := uuid.New().String()

	mustExec := func(query string, args ...interface{}) {
		t.Helper()
		if _, err := database.Pool.Exec(ctx, query, args...); err != nil {
			t.Fatalf("setup query failed: %v (%s)", err, query)
		}
	}

	wStart := uuid.New().String()
	wFinish := uuid.New().String()
	seg1 := uuid.New().String()

	mustExec("INSERT INTO boards (id, version, name, published_at) VALUES ($1, 1, 'Powerup Test Board', NOW())", boardID)
	mustExec(`
		INSERT INTO board_waypoints (id, board_id, board_version, name, location, is_start, is_finish, arrival_radius_m, challenge_id) VALUES
		($2, $1, 1, 'Start Point', ST_SetSRID(ST_MakePoint(0.0, 0.0), 4326), true, false, 25, $3),
		($4, $1, 1, 'Finish Point', ST_SetSRID(ST_MakePoint(0.0, 0.01), 4326), false, true, 25, NULL)
	`, boardID, wStart, challengeID, wFinish)
	mustExec(`
		INSERT INTO board_roads (id, board_id, board_version, waypoint_id_a, waypoint_id_b, length_m)
		VALUES ($1, $2, 1, $3, $4, 1000)
	`, seg1, boardID, wStart, wFinish)
	mustExec(`
		INSERT INTO challenges (id, board_id, board_version, waypoint_id, prompt, rubric, coin_reward, veto_penalty_seconds)
		VALUES ($1, $2, 1, $3, 'Take a selfie at the finish line', '{"must_show":["face"]}', 20, 3600)
	`, challengeID, boardID, wStart)
	// Keep costs low and deterministic so the test doesn't depend on how many
	// coins a single challenge completion happens to award.
	mustExec(`
		INSERT INTO board_powerup_costs (board_id, board_version, powerup, cost) VALUES
		($1, 1, 'nerf', 5), ($1, 1, 'challenge_skip', 5)
	`, boardID)

	post := func(path string, body map[string]interface{}, token string) (*httptest.ResponseRecorder, map[string]interface{}) {
		t.Helper()
		return serve(t, ctx, server, jsonRequest("POST", path, body, token))
	}

	// Create + start game.
	_, gameResp := post("/api/games", map[string]interface{}{
		"board_id":      boardID,
		"board_version": 1,
		"starts_at":     time.Now().Add(-1 * time.Hour),
		"ends_at":       time.Now().Add(1 * time.Hour),
	}, "")
	gameID := gameResp["id"].(string)
	hostToken := gameResp["host_token"].(string)

	_, joinA := post(fmt.Sprintf("/api/games/%s/join", gameID), map[string]interface{}{"team_name": "Red", "slot_index": 0}, "")
	tokenA := joinA["join_token"].(string)
	teamA := joinA["team_id"].(string)

	_, joinB := post(fmt.Sprintf("/api/games/%s/join", gameID), map[string]interface{}{"team_name": "Blue", "slot_index": 1}, "")
	teamB := joinB["team_id"].(string)

	if w, _ := post(fmt.Sprintf("/api/games/%s/start", gameID), nil, hostToken); w.Code != http.StatusOK {
		t.Fatalf("failed to start game: %s", w.Body.String())
	}

	// Team A completes the challenge on wStart to earn coins to spend in the shop.
	if w, _ := post(fmt.Sprintf("/api/games/%s/challenge/start", gameID), map[string]interface{}{
		"waypoint_id": wStart, "lat": 0.0, "lon": 0.0, "accuracy_m": 10.0,
		"idempotency_key": uuid.New().String(),
	}, tokenA); w.Code != http.StatusOK {
		t.Fatalf("failed to start challenge: %s", w.Body.String())
	}
	_, subResp := post(fmt.Sprintf("/api/games/%s/submission", gameID), map[string]interface{}{
		"waypoint_id": wStart, "challenge_id": challengeID,
		"lat": 0.0, "lon": 0.0, "accuracy_m": 10.0,
		"blob_ref": mustEvidenceRef(t, gameID, teamA), "idempotency_key": uuid.New().String(),
	}, tokenA)
	subID := subResp["submission_id"].(string)
	if w, _ := post(fmt.Sprintf("/api/games/%s/verdict", gameID), map[string]interface{}{
		"submission_id": subID, "verdict": "pass", "confidence": 0.99, "rationale": "ok",
	}, testWorkerToken); w.Code != http.StatusOK {
		t.Fatalf("failed to post verdict: %s", w.Body.String())
	}

	// Buy and use "nerf" (not "freeze") on team B.
	if w, _ := post(fmt.Sprintf("/api/games/%s/shop/buy", gameID), map[string]interface{}{
		"powerup": "nerf",
	}, tokenA); w.Code != http.StatusOK {
		t.Fatalf("failed to buy nerf: %s", w.Body.String())
	}
	if w, resp := post(fmt.Sprintf("/api/games/%s/powerup/use", gameID), map[string]interface{}{
		"powerup": "nerf", "target_team_id": teamB,
		"idempotency_key": uuid.New().String(),
	}, tokenA); w.Code != http.StatusOK {
		t.Fatalf("failed to use nerf (catalog name mismatch?): %s %v", w.Body.String(), resp)
	}

	proj, err := projections.RebuildProjection(ctx, database.Pool, gameID, 0)
	if err != nil {
		t.Fatalf("failed to rebuild projection: %v", err)
	}
	foundFreeze := false
	for _, eff := range proj.Effects[teamB] {
		if eff.Kind == "freeze" {
			foundFreeze = true
		}
	}
	if !foundFreeze {
		t.Errorf("expected team B to have an active freeze effect after nerf, got %+v", proj.Effects[teamB])
	}

	// Buy and use "challenge_skip" (not "bypass") on waypoint wStart.
	if w, _ := post(fmt.Sprintf("/api/games/%s/shop/buy", gameID), map[string]interface{}{
		"powerup": "challenge_skip",
	}, tokenA); w.Code != http.StatusOK {
		t.Fatalf("failed to buy challenge_skip: %s", w.Body.String())
	}
	if w, resp := post(fmt.Sprintf("/api/games/%s/powerup/use", gameID), map[string]interface{}{
		"powerup": "challenge_skip", "waypoint_id": wStart, "road_id": wStart,
		"idempotency_key": uuid.New().String(),
	}, tokenA); w.Code != http.StatusOK {
		t.Fatalf("failed to use challenge_skip (catalog name mismatch?): %s %v", w.Body.String(), resp)
	}

	proj, err = projections.RebuildProjection(ctx, database.Pool, gameID, 0)
	if err != nil {
		t.Fatalf("failed to rebuild projection: %v", err)
	}
	if !proj.WaypointStates[wStart].Bypassed[teamA] {
		t.Errorf("expected waypoint wStart to be bypassed for team A after challenge_skip, got %+v", proj.WaypointStates[wStart])
	}

	var bypassReason string
	if err := database.Pool.QueryRow(ctx, `
		SELECT reason FROM team_road_bypass WHERE game_id = $1 AND team_id = $2 AND road_id = $3
	`, gameID, teamA, wStart).Scan(&bypassReason); err != nil || bypassReason != "skip" {
		t.Errorf("expected team_road_bypass row with reason 'skip', got err=%v, reason=%s", err, bypassReason)
	}
}

// TestPositionPingIsEphemeralAndRespectsTrackerOff verifies position pings update team positions and respect stealth effects.
func TestPositionPingIsEphemeralAndRespectsTrackerOff(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	defer database.Close()

	server := newTestServer(database)

	boardID := uuid.New().String()
	challengeID := uuid.New().String()

	mustExec := func(query string, args ...interface{}) {
		t.Helper()
		if _, err := database.Pool.Exec(ctx, query, args...); err != nil {
			t.Fatalf("setup query failed: %v (%s)", err, query)
		}
	}

	wStart := uuid.New().String()
	wFinish := uuid.New().String()
	seg1 := uuid.New().String()

	mustExec("INSERT INTO boards (id, version, name, published_at) VALUES ($1, 1, 'Position Test Board', NOW())", boardID)
	mustExec(`
		INSERT INTO board_waypoints (id, board_id, board_version, name, location, is_start, is_finish, arrival_radius_m, challenge_id) VALUES
		($2, $1, 1, 'Start Point', ST_SetSRID(ST_MakePoint(0.0, 0.0), 4326), true, false, 25, $3),
		($4, $1, 1, 'Finish Point', ST_SetSRID(ST_MakePoint(0.0, 0.01), 4326), false, true, 25, NULL)
	`, boardID, wStart, challengeID, wFinish)
	mustExec(`
		INSERT INTO board_roads (id, board_id, board_version, waypoint_id_a, waypoint_id_b, length_m)
		VALUES ($1, $2, 1, $3, $4, 1000)
	`, seg1, boardID, wStart, wFinish)
	mustExec(`
		INSERT INTO challenges (id, board_id, board_version, waypoint_id, prompt, rubric, coin_reward, veto_penalty_seconds)
		VALUES ($1, $2, 1, $3, 'n/a', '{}', 20, 3600)
	`, challengeID, boardID, wStart)
	mustExec(`
		INSERT INTO board_powerup_costs (board_id, board_version, powerup, cost) VALUES ($1, 1, 'tracker_off', 5)
	`, boardID)

	post := func(path string, body map[string]interface{}, token string) (*httptest.ResponseRecorder, map[string]interface{}) {
		t.Helper()
		return serve(t, ctx, server, jsonRequest("POST", path, body, token))
	}

	_, gameResp := post("/api/games", map[string]interface{}{
		"board_id": boardID, "board_version": 1,
		"starts_at": time.Now().Add(-1 * time.Hour), "ends_at": time.Now().Add(1 * time.Hour),
	}, "")
	gameID := gameResp["id"].(string)
	hostToken := gameResp["host_token"].(string)

	_, joinResp := post(fmt.Sprintf("/api/games/%s/join", gameID), map[string]interface{}{"team_name": "Red", "slot_index": 0}, "")
	token := joinResp["join_token"].(string)
	teamID := joinResp["team_id"].(string)

	if w, _ := post(fmt.Sprintf("/api/games/%s/start", gameID), nil, hostToken); w.Code != http.StatusOK {
		t.Fatalf("failed to start game: %s", w.Body.String())
	}

	if w, _ := post(fmt.Sprintf("/api/games/%s/position", gameID), map[string]interface{}{
		"lat": 51.5, "lon": -0.12, "accuracy_m": 8.0,
	}, token); w.Code != http.StatusOK {
		t.Fatalf("failed to record position: %s", w.Body.String())
	}

	proj, err := projections.RebuildProjection(ctx, database.Pool, gameID, 0)
	if err != nil {
		t.Fatalf("failed to rebuild projection: %v", err)
	}
	pos, ok := proj.Positions[teamID]
	if !ok {
		t.Fatalf("expected team position to be present after ping")
	}
	if pos.Lat != 51.5 || pos.Lon != -0.12 {
		t.Errorf("expected position (51.5, -0.12), got (%v, %v)", pos.Lat, pos.Lon)
	}

	// Now go dark: complete challenge to earn coins, buy and use tracker_off, then confirm position is hidden.
	if w, _ := post(fmt.Sprintf("/api/games/%s/challenge/start", gameID), map[string]interface{}{
		"waypoint_id": wStart, "lat": 0.0, "lon": 0.0, "accuracy_m": 10.0,
		"idempotency_key": uuid.New().String(),
	}, token); w.Code != http.StatusOK {
		t.Fatalf("failed to start challenge: %s", w.Body.String())
	}
	_, subResp2 := post(fmt.Sprintf("/api/games/%s/submission", gameID), map[string]interface{}{
		"waypoint_id": wStart, "challenge_id": challengeID,
		"lat": 0.0, "lon": 0.0, "accuracy_m": 10.0,
		"blob_ref": mustEvidenceRef(t, gameID, teamID), "idempotency_key": uuid.New().String(),
	}, token)
	subID2 := subResp2["submission_id"].(string)
	if w, _ := post(fmt.Sprintf("/api/games/%s/verdict", gameID), map[string]interface{}{
		"submission_id": subID2, "verdict": "pass", "confidence": 0.99, "rationale": "ok",
	}, testWorkerToken); w.Code != http.StatusOK {
		t.Fatalf("failed to post verdict: %s", w.Body.String())
	}

	if w, _ := post(fmt.Sprintf("/api/games/%s/shop/buy", gameID), map[string]interface{}{
		"powerup": "tracker_off",
	}, token); w.Code != http.StatusOK {
		t.Fatalf("failed to buy tracker_off: %s", w.Body.String())
	}
	if w, _ := post(fmt.Sprintf("/api/games/%s/powerup/use", gameID), map[string]interface{}{
		"powerup": "tracker_off", "idempotency_key": uuid.New().String(),
	}, token); w.Code != http.StatusOK {
		t.Fatalf("failed to use tracker_off: %s", w.Body.String())
	}

	proj, err = projections.RebuildProjection(ctx, database.Pool, gameID, 0)
	if err != nil {
		t.Fatalf("failed to rebuild projection: %v", err)
	}
	if _, ok := proj.Positions[teamID]; ok {
		t.Errorf("expected team position to be hidden while tracker is off, got %+v", proj.Positions[teamID])
	}
}
