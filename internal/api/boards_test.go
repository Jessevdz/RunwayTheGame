package api_test

import (
	"context"
	"net/http"
	"testing"

	"github.com/google/uuid"

	"github.com/Jessevdz/RunwayTheGame/internal/db"
	"github.com/Jessevdz/RunwayTheGame/internal/testsupport"
)

// getTestDB returns an isolated test database connection for api tests.
func getTestDB(t *testing.T) (*db.DB, context.Context) {
	return testsupport.DB(t, "api")
}

func TestBoardAuthoringAndCapabilityPipeline(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}

	server := newTestServer(database)

	// 1. Create a draft board
	w, createResp := serve(t, ctx, server, jsonRequest("POST", "/api/boards", map[string]string{"name": "RttEotW Route"}, ""))
	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created, got %d. Body: %s", w.Code, w.Body.String())
	}

	boardID, ok1 := createResp["id"].(string)
	editToken, ok2 := createResp["edit_token"].(string)
	if !ok1 || !ok2 || editToken == "" {
		t.Fatalf("expected board ID and edit_token in response, got: %v", createResp)
	}
	t.Cleanup(func() {
		if _, err := database.Pool.Exec(ctx, "DELETE FROM boards WHERE id = $1::uuid", boardID); err != nil {
			t.Logf("failed to delete test board %s: %v", boardID, err)
		}
	})

	// 2. Attempt update without edit_token (expect 403 Forbidden)
	unauthReq := map[string]interface{}{
		"name": "Unauthorized Update Attempt",
		"waypoints": []map[string]interface{}{
			{"id": "w1", "name": "Start Waypoint", "lat": 51.4800, "lon": 0.0000, "arrival_radius_m": 25, "is_start": true, "is_finish": false},
		},
	}
	w, _ = serve(t, ctx, server, jsonRequest("PUT", "/api/boards/"+boardID, unauthReq, ""))
	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden when missing edit_token, got %d. Body: %s", w.Code, w.Body.String())
	}

	// 3. Perform atomic full-map save with valid edit_token
	w1ID := uuid.New().String()
	w2ID := uuid.New().String()
	s1ID := uuid.New().String()
	c1ID := uuid.New().String()
	rb1ID := uuid.New().String()
	cu1ID := uuid.New().String()

	fullSaveReq := map[string]interface{}{
		"name": "RttEotW Route Living Draft",
		"waypoints": []map[string]interface{}{
			{"id": w1ID, "name": "Start Waypoint", "lat": 51.4800, "lon": 0.0000, "arrival_radius_m": 25, "is_start": true, "is_finish": false, "challenge_id": c1ID},
			{"id": w2ID, "name": "End Waypoint", "lat": 51.4810, "lon": 0.0000, "arrival_radius_m": 25, "is_start": false, "is_finish": true},
		},
		"roads": []map[string]interface{}{
			{"id": s1ID, "waypoint_id_a": w1ID, "waypoint_id_b": w2ID, "length_m": 120.0},
		},
		"challenges": []map[string]interface{}{
			{
				"id":                   c1ID,
				"waypoint_id":          w1ID,
				"prompt":               "Snap the landmark",
				"coin_reward":          30,
				"veto_penalty_seconds": 1800,
				"rubric": map[string]interface{}{
					"must_show": []string{"landmark"},
					"fails_if":  []string{"blurred"},
				},
			},
		},
		"roadblock_cards": []map[string]interface{}{
			{"id": rb1ID, "text": "Do 10 pushups"},
		},
		"curse_cards": []map[string]interface{}{
			{"id": cu1ID, "text": "Walk backwards for 1 min"},
		},
		"powerup_costs": map[string]int{
			"freeze": 100,
		},
	}
	// The edit token travels in Authorization, not the body.
	w, _ = serve(t, ctx, server, jsonRequest("PUT", "/api/boards/"+boardID, fullSaveReq, editToken))
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on full save, got %d. Body: %s", w.Code, w.Body.String())
	}

	// A wrong edit token must be refused just as firmly as a missing one.
	w, _ = serve(t, ctx, server, jsonRequest("PUT", "/api/boards/"+boardID, fullSaveReq, uuid.New().String()))
	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden with a wrong edit token, got %d. Body: %s", w.Code, w.Body.String())
	}

	// 4. Fetch board and verify challenge details and field exclusion
	w, getResp := serve(t, ctx, server, jsonRequest("GET", "/api/boards/"+boardID, nil, ""))
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on GET board, got %d. Body: %s", w.Code, w.Body.String())
	}

	boardObj := getResp["board"].(map[string]interface{})
	if _, present := boardObj["edit_token"]; present {
		t.Errorf("edit_token leaked in public GET /api/boards/{id} response")
	}

	challenges := boardObj["challenges"].([]interface{})
	if len(challenges) != 1 {
		t.Fatalf("expected 1 challenge loaded, got %d", len(challenges))
	}
	chObj := challenges[0].(map[string]interface{})
	if chObj["prompt"] != "Snap the landmark" || int(chObj["coin_reward"].(float64)) != 30 {
		t.Errorf("unexpected challenge details loaded: %v", chObj)
	}

	// 5. Compile the board so it can be raced. This is not the gallery: it
	//    validates geometry and freezes the board, and the race launchers call
	//    it on a map nobody ever chose to make public.
	//    Like every other board write it takes the edit token: publishing is
	//    irreversible, and the board id alone is only a read capability.
	w, _ = serve(t, ctx, server, jsonRequest("POST", "/api/boards/"+boardID+"/publish", nil, editToken))
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on publish endpoint, got %d. Body: %s", w.Code, w.Body.String())
	}

	// 6. The gallery lists what designers published to it, and nothing else.
	//    This assertion used to be "the listing is non-empty", which passed on
	//    whatever boards previous runs had left in the shared database rather
	//    than on anything this test did.
	galleryHas := func(id string) bool {
		t.Helper()
		return listingContains(t, ctx, server, "/api/boards", id)
	}

	if galleryHas(boardID) {
		t.Fatal("compiling a board for racing must not list it in the public gallery")
	}

	// Listing it is a separate, deliberate request carrying the edit token.
	w, _ = serve(t, ctx, server, jsonRequest("PUT", "/api/boards/"+boardID+"/visibility", map[string]bool{"is_listed": true}, editToken))
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK publishing to the gallery, got %d. Body: %s", w.Code, w.Body.String())
	}
	if !galleryHas(boardID) {
		t.Fatal("expected the published board in the gallery listing")
	}

	// 6. Test board fork endpoint (POST /api/boards/{id}/fork)
	w, forkResp := serve(t, ctx, server, jsonRequest("POST", "/api/boards/"+boardID+"/fork", nil, ""))
	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created on board fork, got %d. Body: %s", w.Code, w.Body.String())
	}

	forkedID, okFork1 := forkResp["id"].(string)
	forkedEditToken, okFork2 := forkResp["edit_token"].(string)
	if !okFork1 || !okFork2 || forkedID == boardID || forkedEditToken == editToken {
		t.Fatalf("invalid fork response identifiers: %v", forkResp)
	}
	t.Cleanup(func() {
		_, _ = database.Pool.Exec(ctx, "DELETE FROM boards WHERE id = $1::uuid", forkedID)
	})

	// Fetch forked board and verify cloned waypoints and challenges
	w, getForkResp := serve(t, ctx, server, jsonRequest("GET", "/api/boards/"+forkedID, nil, ""))
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on GET forked board, got %d. Body: %s", w.Code, w.Body.String())
	}

	forkedBoardObj := getForkResp["board"].(map[string]interface{})
	if len(forkedBoardObj["waypoints"].([]interface{})) != 2 {
		t.Errorf("expected 2 waypoints in forked board")
	}
	if len(forkedBoardObj["challenges"].([]interface{})) != 1 {
		t.Errorf("expected 1 challenge in forked board")
	}
}

// TestDefaultDeckSavesOnEveryBoard tests saving default card decks across
// multiple boards and verifying deck persistence on GET.
func TestDefaultDeckSavesOnEveryBoard(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}

	server := newTestServer(database)

	// The slugs the editor's default decks ship with.
	deckSave := map[string]interface{}{
		"name": "Default Deck Board",
		"roadblock_cards": []map[string]interface{}{
			{"id": "rb-ring", "text": "Destroy one ring: Find a ring and destroy it."},
			{"id": "rb-grape", "text": "Eat something grape flavored: Packaging must specify grape."},
		},
		"curse_cards": []map[string]interface{}{
			{"id": "curse-backward", "text": "Walk Backwards: Walk backwards for the next challenge."},
		},
	}

	createBoard := func() (string, string) {
		t.Helper()
		w, resp := serve(t, ctx, server, jsonRequest("POST", "/api/boards", map[string]string{"name": "Default Deck Board"}, ""))
		if w.Code != http.StatusCreated {
			t.Fatalf("expected 201 Created, got %d. Body: %s", w.Code, w.Body.String())
		}
		id, _ := resp["id"].(string)
		token, _ := resp["edit_token"].(string)
		if id == "" || token == "" {
			t.Fatalf("expected board id and edit_token, got: %v", resp)
		}
		t.Cleanup(func() {
			if _, err := database.Pool.Exec(ctx, "DELETE FROM boards WHERE id = $1::uuid", id); err != nil {
				t.Logf("failed to delete test board %s: %v", id, err)
			}
		})
		return id, token
	}

	firstID, firstToken := createBoard()
	secondID, secondToken := createBoard()

	for _, b := range []struct {
		label string
		id    string
		token string
	}{{"first", firstID, firstToken}, {"second", secondID, secondToken}} {
		w, _ := serve(t, ctx, server, jsonRequest("PUT", "/api/boards/"+b.id, deckSave, b.token))
		if w.Code != http.StatusOK {
			t.Fatalf("expected 200 OK saving default decks on the %s board, got %d. Body: %s", b.label, w.Code, w.Body.String())
		}

		// Saving twice must also work: the save deletes and re-inserts the same ids.
		w, _ = serve(t, ctx, server, jsonRequest("PUT", "/api/boards/"+b.id, deckSave, b.token))
		if w.Code != http.StatusOK {
			t.Fatalf("expected 200 OK re-saving default decks on the %s board, got %d. Body: %s", b.label, w.Code, w.Body.String())
		}

		w, resp := serve(t, ctx, server, jsonRequest("GET", "/api/boards/"+b.id, nil, ""))
		if w.Code != http.StatusOK {
			t.Fatalf("expected 200 OK on GET %s board, got %d. Body: %s", b.label, w.Code, w.Body.String())
		}
		board := resp["board"].(map[string]interface{})
		roadblocks, _ := board["roadblock_deck"].([]interface{})
		curses, _ := board["curse_deck"].([]interface{})
		if len(roadblocks) != 2 {
			t.Errorf("expected 2 roadblock cards back from the %s board, got %d (board keys: %v)", b.label, len(roadblocks), board)
		}
		if len(curses) != 1 {
			t.Errorf("expected 1 curse card back from the %s board, got %d", b.label, len(curses))
		}
	}

	// A payload that repeats an id must not fail the whole save.
	w, _ := serve(t, ctx, server, jsonRequest("PUT", "/api/boards/"+firstID, map[string]interface{}{
		"name": "Default Deck Board",
		"roadblock_cards": []map[string]interface{}{
			{"id": "rb-ring", "text": "Destroy one ring"},
			{"id": "rb-ring", "text": "Destroy one ring (duplicate id)"},
		},
	}, firstToken))
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK saving a deck with a repeated card id, got %d. Body: %s", w.Code, w.Body.String())
	}
}

func TestDuplicateElementIDsAcrossBoards(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}

	server := newTestServer(database)

	createBoard := func() (string, string) {
		t.Helper()
		w, resp := serve(t, ctx, server, jsonRequest("POST", "/api/boards", map[string]string{"name": "Imported Map"}, ""))
		if w.Code != http.StatusCreated {
			t.Fatalf("expected 201 Created, got %d. Body: %s", w.Code, w.Body.String())
		}
		id, _ := resp["id"].(string)
		token, _ := resp["edit_token"].(string)
		t.Cleanup(func() {
			_, _ = database.Pool.Exec(ctx, "DELETE FROM boards WHERE id = $1::uuid", id)
		})
		return id, token
	}

	board1ID, board1Token := createBoard()
	board2ID, board2Token := createBoard()

	sharedWaypointID := uuid.New().String()
	sharedRoadID := uuid.New().String()
	sharedChallengeID := uuid.New().String()
	waypoint2ID := uuid.New().String()

	savePayload := map[string]interface{}{
		"name": "Imported Map",
		"waypoints": []map[string]interface{}{
			{
				"id":               sharedWaypointID,
				"name":             "Start Point",
				"lon":              12.0,
				"lat":              55.0,
				"arrival_radius_m": 30.0,
				"is_start":         true,
			},
			{
				"id":               waypoint2ID,
				"name":             "End Point",
				"lon":              12.1,
				"lat":              55.1,
				"arrival_radius_m": 30.0,
				"is_finish":        true,
			},
		},
		"roads": []map[string]interface{}{
			{
				"id":            sharedRoadID,
				"waypoint_id_a": sharedWaypointID,
				"waypoint_id_b": waypoint2ID,
				"length_m":      1000.0,
			},
		},
		"challenges": []map[string]interface{}{
			{
				"id":                   sharedChallengeID,
				"waypoint_id":          sharedRoadID,
				"prompt":               "Take a selfie",
				"rubric":               map[string]interface{}{"must_show": []string{"face"}},
				"coin_reward":          20,
				"veto_penalty_seconds": 3600,
			},
		},
	}

	// Save board 1
	w, _ := serve(t, ctx, server, jsonRequest("PUT", "/api/boards/"+board1ID, savePayload, board1Token))
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK saving board 1, got %d. Body: %s", w.Code, w.Body.String())
	}

	// Save board 2 with identical waypoint, road, and challenge IDs (e.g. imported from local export)
	w, _ = serve(t, ctx, server, jsonRequest("PUT", "/api/boards/"+board2ID, savePayload, board2Token))
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK saving board 2 with duplicate IDs, got %d. Body: %s", w.Code, w.Body.String())
	}
}
