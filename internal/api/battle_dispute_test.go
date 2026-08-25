package api_test

import (
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/Jessevdz/RunwayTheGame/internal/projections"
)

func TestPlayLoopFlow(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	defer database.Close()

	server := newTestServer(database)

	boardID := uuid.New().String()
	challengeID := uuid.New().String()

	wStart := uuid.New().String()
	wFinish := uuid.New().String()
	roadID := uuid.New().String()

	// 1. Seed board published
	_, err := database.Pool.Exec(ctx, "INSERT INTO boards (id, version, name, published_at) VALUES ($1, 1, 'RttEotW Board', NOW())", boardID)
	if err != nil {
		t.Fatalf("failed to seed board: %v", err)
	}

	_, err = database.Pool.Exec(ctx, `
		INSERT INTO board_waypoints (id, board_id, board_version, name, location, is_start, is_finish, arrival_radius_m, challenge_id) VALUES
		($2, $1, 1, 'Start Point', ST_SetSRID(ST_MakePoint(0.0, 0.0), 4326), true, false, 25, $3),
		($4, $1, 1, 'Finish Point', ST_SetSRID(ST_MakePoint(0.0, 0.01), 4326), false, true, 25, NULL)
	`, boardID, wStart, challengeID, wFinish)
	if err != nil {
		t.Fatalf("failed to seed waypoints: %v", err)
	}

	_, err = database.Pool.Exec(ctx, `
		INSERT INTO board_roads (id, board_id, board_version, waypoint_id_a, waypoint_id_b, length_m) VALUES
		($2, $1, 1, $3, $4, 1000)
	`, boardID, roadID, wStart, wFinish)
	if err != nil {
		t.Fatalf("failed to seed roads: %v", err)
	}

	_, err = database.Pool.Exec(ctx, `
		INSERT INTO challenges (id, board_id, board_version, waypoint_id, prompt, rubric, coin_reward, veto_penalty_seconds) VALUES
		($1, $2, 1, $3, 'Take a selfie at the start line', '{"must_show":["face"]}', 20, 3600)
	`, challengeID, boardID, wStart)
	if err != nil {
		t.Fatalf("failed to seed challenge: %v", err)
	}

	// 2. Create game
	gameCreateReq := map[string]interface{}{
		"board_id":      boardID,
		"board_version": 1,
		"starts_at":     time.Now().Add(-1 * time.Hour),
		"ends_at":       time.Now().Add(1 * time.Hour),
		"ruleset": map[string]interface{}{
			"powerup_costs": map[string]int{"roadblock": 15},
		},
	}
	w, gameResp := serve(t, ctx, server, jsonRequest("POST", "/api/games", gameCreateReq, ""))
	if w.Code != http.StatusCreated {
		t.Fatalf("failed to create game: %s", w.Body.String())
	}
	gameID := gameResp["id"].(string)
	hostToken := gameResp["host_token"].(string)

	// 3. Team A joins
	joinReq := map[string]interface{}{
		"team_name":  "Red Team",
		"slot_index": 0,
	}
	_, joinResp := serve(t, ctx, server, jsonRequest("POST", fmt.Sprintf("/api/games/%s/join", gameID), joinReq, ""))
	token := joinResp["join_token"].(string)
	teamID := joinResp["team_id"].(string)

	// 4. Start game — GM route, so it needs the host token
	w, _ = serve(t, ctx, server, jsonRequest("POST", fmt.Sprintf("/api/games/%s/start", gameID), nil, hostToken))
	if w.Code != http.StatusOK {
		t.Fatalf("failed to start game: %s", w.Body.String())
	}

	// 5. Start Challenge on waypoint wStart
	startChallengeReq := map[string]interface{}{
		"waypoint_id":     wStart,
		"lat":             0.0,
		"lon":             0.0,
		"accuracy_m":      10.0,
		"idempotency_key": uuid.New().String(),
	}
	w, _ = serve(t, ctx, server, jsonRequest("POST", fmt.Sprintf("/api/games/%s/challenge/start", gameID), startChallengeReq, token))
	if w.Code != http.StatusOK {
		t.Fatalf("failed to start challenge: %s", w.Body.String())
	}

	// 6. Submit evidence
	submitReq := map[string]interface{}{
		"waypoint_id":     wStart,
		"challenge_id":    challengeID,
		"lat":             0.0,
		"lon":             0.0,
		"accuracy_m":      10.0,
		"blob_ref":        mustEvidenceRef(t, gameID, teamID),
		"idempotency_key": uuid.New().String(),
	}
	_, subResp := serve(t, ctx, server, jsonRequest("POST", fmt.Sprintf("/api/games/%s/submission", gameID), submitReq, token))
	subID := subResp["submission_id"].(string)

	// 7. Grade pass
	verdictReq := map[string]interface{}{
		"submission_id": subID,
		"verdict":       "pass",
		"confidence":    0.99,
		"rationale":     "Passed finishing challenge",
	}
	w, _ = serve(t, ctx, server, jsonRequest("POST", fmt.Sprintf("/api/games/%s/verdict", gameID), verdictReq, testWorkerToken))
	if w.Code != http.StatusOK {
		t.Fatalf("failed to post verdict: %s", w.Body.String())
	}

	// 8. Buy powerup roadblock
	buyReq := map[string]interface{}{
		"powerup": "roadblock",
	}
	w, _ = serve(t, ctx, server, jsonRequest("POST", fmt.Sprintf("/api/games/%s/shop/buy", gameID), buyReq, token))
	if w.Code != http.StatusOK {
		t.Fatalf("failed to buy roadblock: %s", w.Body.String())
	}

	// Verify inventory in projection
	proj, _ := projections.RebuildProjection(ctx, database.Pool, gameID, 0)
	if len(proj.Inventory[teamID]) != 1 || proj.Inventory[teamID][0] != "roadblock" {
		t.Errorf("expected roadblock in inventory, got %v", proj.Inventory[teamID])
	}
	if proj.Coins[teamID] != 5 {
		t.Errorf("expected 5 coins left, got %d", proj.Coins[teamID])
	}

	// 9. Use roadblock on roadID
	useReq := map[string]interface{}{
		"powerup":         "roadblock",
		"road_id":         roadID,
		"idempotency_key": uuid.New().String(),
	}
	w, _ = serve(t, ctx, server, jsonRequest("POST", fmt.Sprintf("/api/games/%s/powerup/use", gameID), useReq, token))
	if w.Code != http.StatusOK {
		t.Fatalf("failed to use roadblock: %s", w.Body.String())
	}

	// Verify roadblock active
	proj, _ = projections.RebuildProjection(ctx, database.Pool, gameID, 0)
	if len(proj.Inventory[teamID]) != 0 {
		t.Errorf("expected empty inventory, got %v", proj.Inventory[teamID])
	}
	if _, ok := proj.Roadblocks[roadID]; !ok {
		t.Errorf("expected roadblock on road %s", roadID)
	}

	// 10. Arrive at Finish waypoint
	arriveReq := map[string]interface{}{
		"waypoint_id":     wFinish,
		"lat":             0.01,
		"lon":             0.00,
		"accuracy_m":      10.0,
		"idempotency_key": uuid.New().String(),
	}
	w, _ = serve(t, ctx, server, jsonRequest("POST", fmt.Sprintf("/api/games/%s/arrive", gameID), arriveReq, token))
	if w.Code != http.StatusOK {
		t.Fatalf("failed arrival: %s", w.Body.String())
	}

	// Verify that the game status is now ended and teamID is winner
	proj, _ = projections.RebuildProjection(ctx, database.Pool, gameID, 0)
	if proj.Winner != teamID {
		t.Errorf("expected winner to be %s, got %s", teamID, proj.Winner)
	}
}
