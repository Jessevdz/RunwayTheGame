package api_test

import (
	"net/http"
	"strconv"
	"testing"

	"github.com/google/uuid"
)

// Finish line waypoints carry no challenges or rewards upon arrival.

func TestFinishWaypointRejectsChallengeOnSave(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	server := newTestServer(database)

	w, createResp := serve(t, ctx, server, jsonRequest("POST", "/api/boards", map[string]string{"name": "Finish Rules"}, ""))
	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201 creating board, got %d. Body: %s", w.Code, w.Body.String())
	}
	boardID := createResp["id"].(string)
	editToken := createResp["edit_token"].(string)
	t.Cleanup(func() {
		_, _ = database.Pool.Exec(ctx, "DELETE FROM boards WHERE id = $1::uuid", boardID)
	})

	startID := uuid.New().String()
	finishID := uuid.New().String()
	challengeID := uuid.New().String()

	waypoints := func(finishChallengeID string) []map[string]interface{} {
		finish := map[string]interface{}{
			"id": finishID, "name": "Finish", "lat": 51.4810, "lon": 0.0,
			"arrival_radius_m": 25, "is_start": false, "is_finish": true,
		}
		if finishChallengeID != "" {
			finish["challenge_id"] = finishChallengeID
		}
		return []map[string]interface{}{
			{"id": startID, "name": "Start", "lat": 51.4800, "lon": 0.0, "arrival_radius_m": 25, "is_start": true, "is_finish": false},
			finish,
		}
	}
	finishChallenge := []map[string]interface{}{
		{
			"id": challengeID, "waypoint_id": finishID, "prompt": "Photograph the finish arch",
			"coin_reward": 30, "veto_penalty_seconds": 1800,
			"rubric": map[string]interface{}{"must_show": []string{"arch"}},
		},
	}
	roads := []map[string]interface{}{
		{"id": uuid.New().String(), "waypoint_id_a": startID, "waypoint_id_b": finishID, "length_m": 120.0},
	}

	// A challenge whose waypoint is the finish is refused outright.
	w, _ = serve(t, ctx, server, jsonRequest("PUT", "/api/boards/"+boardID, map[string]interface{}{
		"name": "Finish Rules", "waypoints": waypoints(""), "roads": roads, "challenges": finishChallenge,
	}, editToken))
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 saving a challenge attached to the finish, got %d. Body: %s", w.Code, w.Body.String())
	}

	// So is a finish waypoint that merely points at one.
	w, _ = serve(t, ctx, server, jsonRequest("PUT", "/api/boards/"+boardID, map[string]interface{}{
		"name": "Finish Rules", "waypoints": waypoints(challengeID), "roads": roads,
	}, editToken))
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 saving a finish waypoint referencing a challenge, got %d. Body: %s", w.Code, w.Body.String())
	}

	// The same board with the challenge on the start saves fine — the rule is about
	// the finish, not about challenges.
	w, _ = serve(t, ctx, server, jsonRequest("PUT", "/api/boards/"+boardID, map[string]interface{}{
		"name": "Finish Rules", "waypoints": waypoints(""), "roads": roads,
		"challenges": []map[string]interface{}{
			{
				"id": challengeID, "waypoint_id": startID, "prompt": "Photograph the start arch",
				"coin_reward": 30, "veto_penalty_seconds": 1800,
				"rubric": map[string]interface{}{"must_show": []string{"arch"}},
			},
		},
	}, editToken))
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 saving a challenge on a non-finish waypoint, got %d. Body: %s", w.Code, w.Body.String())
	}

	// The per-waypoint challenge route is the other way in, and refuses the finish too.
	w, _ = serve(t, ctx, server, jsonRequest("POST", "/api/boards/"+boardID+"/waypoints/"+finishID+"/challenges", map[string]interface{}{
		"edit_token": editToken, "prompt": "Photograph the finish arch",
		"coin_reward": 20, "veto_penalty_seconds": 900,
	}, editToken))
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 adding a challenge to the finish waypoint, got %d. Body: %s", w.Code, w.Body.String())
	}

	// ...and still accepts one on a waypoint that is not the finish.
	w, _ = serve(t, ctx, server, jsonRequest("POST", "/api/boards/"+boardID+"/waypoints/"+startID+"/challenges", map[string]interface{}{
		"edit_token": editToken, "prompt": "Photograph the start arch",
		"coin_reward": 20, "veto_penalty_seconds": 900,
	}, editToken))
	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201 adding a challenge to a normal waypoint, got %d. Body: %s", w.Code, w.Body.String())
	}
}

// TestForkDropsFinishChallenge tests that forking a board strips any legacy
// challenges attached to finish waypoints.
func TestForkDropsFinishChallenge(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	server := newTestServer(database)

	w, createResp := serve(t, ctx, server, jsonRequest("POST", "/api/boards", map[string]string{"name": "Legacy Finish Challenge"}, ""))
	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201 creating board, got %d. Body: %s", w.Code, w.Body.String())
	}
	boardID := createResp["id"].(string)
	t.Cleanup(func() {
		_, _ = database.Pool.Exec(ctx, "DELETE FROM boards WHERE id = $1::uuid", boardID)
	})

	startID := uuid.New().String()
	finishID := uuid.New().String()
	challengeID := uuid.New().String()

	if _, err := database.Pool.Exec(ctx, `
		INSERT INTO challenges (id, board_id, board_version, waypoint_id, prompt, rubric, coin_reward, veto_penalty_seconds)
		VALUES ($1::uuid, $2::uuid, 1, $3::uuid, 'Photograph the finish arch', '{}'::jsonb, 30, 1800)
	`, challengeID, boardID, finishID); err != nil {
		t.Fatalf("failed to plant legacy finish challenge: %v", err)
	}
	for _, wp := range []struct {
		id       string
		name     string
		lat      float64
		isStart  bool
		isFinish bool
		chID     interface{}
	}{
		{startID, "Start", 51.4800, true, false, nil},
		{finishID, "Finish", 51.4810, false, true, challengeID},
	} {
		if _, err := database.Pool.Exec(ctx, `
			INSERT INTO board_waypoints (id, board_id, board_version, name, location, arrival_radius_m, is_start, is_finish, challenge_id)
			VALUES ($1::uuid, $2::uuid, 1, $3, ST_GeomFromText($4, 4326), 25, $5, $6, $7::uuid)
		`, wp.id, boardID, wp.name, "POINT(0 "+strconv.FormatFloat(wp.lat, 'f', -1, 64)+")", wp.isStart, wp.isFinish, wp.chID); err != nil {
			t.Fatalf("failed to plant waypoint %s: %v", wp.name, err)
		}
	}

	w, forkResp := serve(t, ctx, server, jsonRequest("POST", "/api/boards/"+boardID+"/fork", nil, ""))
	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201 forking board, got %d. Body: %s", w.Code, w.Body.String())
	}
	forkedID := forkResp["id"].(string)
	t.Cleanup(func() {
		_, _ = database.Pool.Exec(ctx, "DELETE FROM boards WHERE id = $1::uuid", forkedID)
	})

	var forkedChallenges int
	if err := database.Pool.QueryRow(ctx,
		"SELECT COUNT(*) FROM challenges WHERE board_id = $1::uuid", forkedID).Scan(&forkedChallenges); err != nil {
		t.Fatalf("failed to count forked challenges: %v", err)
	}
	if forkedChallenges != 0 {
		t.Errorf("fork copied %d challenge(s); the finish line's challenge must not survive a fork", forkedChallenges)
	}

	var forkedFinishHasChallenge bool
	if err := database.Pool.QueryRow(ctx,
		"SELECT challenge_id IS NOT NULL FROM board_waypoints WHERE board_id = $1::uuid AND is_finish",
		forkedID).Scan(&forkedFinishHasChallenge); err != nil {
		t.Fatalf("failed to read forked finish waypoint: %v", err)
	}
	if forkedFinishHasChallenge {
		t.Error("forked finish waypoint still references a challenge")
	}
}
