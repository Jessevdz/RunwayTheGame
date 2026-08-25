package api_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
)

// roadmapAutoHideFlagsForTest defines the auto-hide flag threshold for roadmap items.
const roadmapAutoHideFlagsForTest = 10

func TestRoadmap_CRUD_And_Voting(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	server := newTestServer(database)
	voterID := uuid.New().String()

	// 1. Create item
	createReq := jsonRequest("POST", "/api/roadmap", map[string]interface{}{
		"title":       "Custom Waypoint Audio Effects " + uuid.New().String()[:8],
		"description": "Allow hosts to upload custom audio cues when a road is unlocked.",
	}, "")
	w, createResp := serve(t, ctx, server, createReq)
	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created, got %d: %s", w.Code, w.Body.String())
	}
	itemID, ok := createResp["id"].(string)
	if !ok || itemID == "" {
		t.Fatalf("expected non-empty item id in response")
	}

	// 2. List items with voter ID
	listReq := jsonRequest("GET", "/api/roadmap", nil, "")
	listReq.Header.Set("X-Voter-ID", voterID)
	w, listResp := serveSlice(t, ctx, server, listReq)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d", w.Code)
	}
	if len(listResp) == 0 {
		t.Fatalf("expected at least 1 roadmap item")
	}

	// 3. Upvote item
	voteReq := jsonRequest("POST", "/api/roadmap/"+itemID+"/vote", nil, "")
	voteReq.Header.Set("X-Voter-ID", voterID)
	w, voteResp := serve(t, ctx, server, voteReq)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for vote, got %d: %s", w.Code, w.Body.String())
	}
	if voteResp["voted"] != true || voteResp["vote_count"].(float64) != 1 {
		t.Fatalf("expected voted=true, vote_count=1, got: %v", voteResp)
	}

	// 4. Double upvote item (idempotent)
	voteReq2 := jsonRequest("POST", "/api/roadmap/"+itemID+"/vote", nil, "")
	voteReq2.Header.Set("X-Voter-ID", voterID)
	w, voteResp2 := serve(t, ctx, server, voteReq2)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for double vote, got %d: %s", w.Code, w.Body.String())
	}
	if voteResp2["vote_count"].(float64) != 1 {
		t.Fatalf("expected vote_count to remain 1, got %v", voteResp2["vote_count"])
	}

	// 5. Unvote item
	unvoteReq := jsonRequest("DELETE", "/api/roadmap/"+itemID+"/vote", nil, "")
	unvoteReq.Header.Set("X-Voter-ID", voterID)
	w, unvoteResp := serve(t, ctx, server, unvoteReq)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for unvote, got %d: %s", w.Code, w.Body.String())
	}
	if unvoteResp["voted"] != false || unvoteResp["vote_count"].(float64) != 0 {
		t.Fatalf("expected voted=false, vote_count=0, got: %v", unvoteResp)
	}
}

func TestRoadmap_DuplicateTitle(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	server := newTestServer(database)

	title := "Unique Feature Idea " + uuid.New().String()[:8]

	// Create first
	req1 := jsonRequest("POST", "/api/roadmap", map[string]interface{}{
		"title":       title,
		"description": "First description",
	}, "")
	w1, _ := serve(t, ctx, server, req1)
	if w1.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created, got %d: %s", w1.Code, w1.Body.String())
	}

	// Create duplicate with different casing
	req2 := jsonRequest("POST", "/api/roadmap", map[string]interface{}{
		"title":       " " + title + " ",
		"description": "Second description",
	}, "")
	w2, _ := serve(t, ctx, server, req2)
	if w2.Code != http.StatusConflict {
		t.Fatalf("expected 409 Conflict for duplicate title, got %d: %s", w2.Code, w2.Body.String())
	}
}

func TestRoadmap_Validation(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	server := newTestServer(database)

	// Short title
	req1 := jsonRequest("POST", "/api/roadmap", map[string]interface{}{"title": "a"}, "")
	w1, _ := serve(t, ctx, server, req1)
	if w1.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request for short title, got %d", w1.Code)
	}

	// Invalid voter ID format
	req2 := jsonRequest("POST", "/api/roadmap/"+uuid.New().String()+"/vote", nil, "")
	req2.Header.Set("X-Voter-ID", "not-a-uuid")
	w2, _ := serve(t, ctx, server, req2)
	if w2.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request for invalid voter ID, got %d", w2.Code)
	}
}

func TestRoadmap_AutoHiding(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	server := newTestServer(database)

	// Create item
	createReq := jsonRequest("POST", "/api/roadmap", map[string]interface{}{
		"title":       "Auto-Hide Test Idea " + uuid.New().String()[:8],
		"description": "Testing auto hide feature",
	}, "")
	w, createResp := serve(t, ctx, server, createReq)
	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d", w.Code)
	}
	itemID := createResp["id"].(string)

	flag := func(remoteAddr string) int {
		t.Helper()
		flagReq := jsonRequest("POST", "/api/roadmap/"+itemID+"/flag", nil, "")
		flagReq.Header.Set("X-Voter-ID", uuid.New().String())
		flagReq.RemoteAddr = remoteAddr
		wFlag, _ := serve(t, ctx, server, flagReq)
		return wFlag.Code
	}
	itemIsHidden := func() bool {
		t.Helper()
		var hidden bool
		if err := database.Pool.QueryRow(ctx, "SELECT is_hidden FROM roadmap_items WHERE id = $1", itemID).Scan(&hidden); err != nil {
			t.Fatalf("failed to read item: %v", err)
		}
		return hidden
	}

	// Multiple flags from the same remote IP count as a single flagging party.
	for i := 0; i < 3; i++ {
		if code := flag("203.0.113.10:5000"); code != http.StatusOK {
			t.Fatalf("expected 200 OK on flag %d, got %d", i+1, code)
		}
	}
	if itemIsHidden() {
		t.Fatal("a single flagger with three self-chosen voter IDs hid the item")
	}
	var flagCount int
	if err := database.Pool.QueryRow(ctx, "SELECT flag_count FROM roadmap_items WHERE id = $1", itemID).Scan(&flagCount); err != nil {
		t.Fatalf("failed to read flag count: %v", err)
	}
	if flagCount != 1 {
		t.Errorf("three flags from one party counted as %d, want 1", flagCount)
	}

	// Genuinely distinct flaggers still reach the threshold.
	for i := 0; i < roadmapAutoHideFlagsForTest-1; i++ {
		if code := flag(fmt.Sprintf("198.51.100.%d:5000", i+1)); code != http.StatusOK {
			t.Fatalf("expected 200 OK on distinct flag %d, got %d", i+1, code)
		}
	}
	if !itemIsHidden() {
		t.Fatal("the item should be hidden once enough distinct parties flagged it")
	}

	// A hidden item is gone from the public surface.
	voteReq := jsonRequest("POST", "/api/roadmap/"+itemID+"/vote", nil, "")
	voteReq.Header.Set("X-Voter-ID", uuid.New().String())
	wVote, _ := serve(t, ctx, server, voteReq)
	if wVote.Code != http.StatusNotFound {
		t.Fatalf("expected 404 Not Found for voting on hidden item, got %d", wVote.Code)
	}
}

// TestRoadmapVoteCountResistsMintedVoterIDs verifies vote attempts from a single remote address do not inflate vote counts.
func TestRoadmapVoteCountResistsMintedVoterIDs(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	server := newTestServer(database)

	w, createResp := serve(t, ctx, server, jsonRequest("POST", "/api/roadmap", map[string]interface{}{
		"title":       "Vote Stuffing Test " + uuid.New().String()[:8],
		"description": "Testing vote inflation",
	}, ""))
	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d", w.Code)
	}
	itemID := createResp["id"].(string)

	for i := 0; i < 15; i++ {
		voteReq := jsonRequest("POST", "/api/roadmap/"+itemID+"/vote", nil, "")
		voteReq.Header.Set("X-Voter-ID", uuid.New().String())
		voteReq.RemoteAddr = "203.0.113.55:6000"
		if wVote, _ := serve(t, ctx, server, voteReq); wVote.Code != http.StatusOK {
			t.Fatalf("expected 200 on vote %d, got %d", i+1, wVote.Code)
		}
	}

	var voteCount int
	if err := database.Pool.QueryRow(ctx, "SELECT vote_count FROM roadmap_items WHERE id = $1", itemID).Scan(&voteCount); err != nil {
		t.Fatalf("failed to read vote count: %v", err)
	}
	if voteCount != 1 {
		t.Errorf("15 votes from one party counted as %d, want 1", voteCount)
	}
}

func TestRoadmap_RateLimiting(t *testing.T) {
	ctx := t.Context()
	server := newTestServer(nil) // DB-free test

	body, _ := json.Marshal(map[string]interface{}{
		"title":       "Rate Limit Test Idea",
		"description": "Desc",
	})

	for i := 0; i < 5; i++ {
		req := httptest.NewRequest("POST", "/api/roadmap", bytes.NewReader(body))
		req.RemoteAddr = "192.168.1.100:12345"
		w := httptest.NewRecorder()
		server.Router.ServeHTTP(w, req.WithContext(ctx))

		if i >= 2 && w.Code == http.StatusTooManyRequests {
			// Successfully triggered rate limit
			return
		}
	}
	t.Fatalf("expected rate limit 429 StatusTooManyRequests to trigger")
}

func TestRoadmap_AdminManagement(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	server := newTestServer(database)
	adminKey := "admin-secret-guid-9999"
	server.SetRoadmapAdminKey(adminKey)

	// 1. Create item (starts in PROPOSED lane)
	createReq := jsonRequest("POST", "/api/roadmap", map[string]interface{}{
		"title":       "Admin Test Idea " + uuid.New().String()[:8],
		"description": "Initial proposal description",
	}, "")
	w, createResp := serve(t, ctx, server, createReq)
	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created, got %d: %s", w.Code, w.Body.String())
	}
	itemID := createResp["id"].(string)

	// 2. Unauthorized update attempt
	unauthUpdateReq := jsonRequest("PUT", "/api/roadmap/"+itemID, map[string]interface{}{
		"status": "PLANNED",
	}, "")
	w, _ = serve(t, ctx, server, unauthUpdateReq)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 Unauthorized for missing admin key, got %d", w.Code)
	}

	// 3. Move feature from PROPOSED to PLANNED using admin key
	updateReq := jsonRequest("PUT", "/api/roadmap/"+itemID, map[string]interface{}{
		"title":       "Admin Test Idea Updated",
		"description": "Updated description",
		"status":      "PLANNED",
	}, "")
	updateReq.Header.Set("X-Admin-Key", adminKey)
	w, updateResp := serve(t, ctx, server, updateReq)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for admin update, got %d: %s", w.Code, w.Body.String())
	}
	if updateResp["status"] != "PLANNED" || updateResp["title"] != "Admin Test Idea Updated" {
		t.Fatalf("expected status PLANNED and updated title, got: %v", updateResp)
	}

	// 4. Move feature to IN_PROGRESS and then SHIPPED
	moveReq := jsonRequest("PUT", "/api/roadmap/"+itemID, map[string]interface{}{
		"status": "SHIPPED",
	}, "")
	moveReq.Header.Set("X-Admin-Key", adminKey)
	w, moveResp := serve(t, ctx, server, moveReq)
	if w.Code != http.StatusOK || moveResp["status"] != "SHIPPED" {
		t.Fatalf("expected 200 OK and status SHIPPED, got %d: %v", w.Code, moveResp)
	}

	// 5. Unauthorized delete attempt
	unauthDeleteReq := jsonRequest("DELETE", "/api/roadmap/"+itemID, nil, "")
	w, _ = serve(t, ctx, server, unauthDeleteReq)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 Unauthorized for delete without admin key, got %d", w.Code)
	}

	// 6. Delete feature with admin key
	deleteReq := jsonRequest("DELETE", "/api/roadmap/"+itemID, nil, "")
	deleteReq.Header.Set("X-Admin-Key", adminKey)
	w, deleteResp := serve(t, ctx, server, deleteReq)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for admin delete, got %d: %s", w.Code, w.Body.String())
	}
	if deleteResp["deleted"] != true {
		t.Fatalf("expected deleted=true in response, got %v", deleteResp)
	}
}

// TestRoadmap_UserAgentRotationCannotForgeDistinctParties verifies User-Agent rotation does not bypass flagging limits.
func TestRoadmap_UserAgentRotationCannotForgeDistinctParties(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	server := newTestServer(database)

	createReq := jsonRequest("POST", "/api/roadmap", map[string]interface{}{
		"title":       "UA Rotation " + uuid.New().String()[:8],
		"description": "One party, many user agents",
	}, "")
	createReq.RemoteAddr = "203.0.113.77:5000"
	w, created := serve(t, ctx, server, createReq)
	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}
	itemID := created["id"].(string)

	// One IP, a fresh voter id and a fresh User-Agent every time — which is
	// everything the caller controls.
	for i := 0; i < roadmapAutoHideFlagsForTest+2; i++ {
		req := jsonRequest("POST", "/api/roadmap/"+itemID+"/flag", nil, "")
		req.Header.Set("X-Voter-ID", uuid.New().String())
		req.Header.Set("User-Agent", fmt.Sprintf("Mozilla/5.0 (rotation %d)", i))
		req.RemoteAddr = "203.0.113.77:5000"
		w, _ := serve(t, ctx, server, req)
		if w.Code != http.StatusOK && w.Code != http.StatusTooManyRequests {
			t.Fatalf("flag %d: unexpected %d — %s", i, w.Code, w.Body.String())
		}
	}

	var flagCount int
	var isHidden bool
	if err := database.Pool.QueryRow(ctx,
		"SELECT flag_count, is_hidden FROM roadmap_items WHERE id = $1", itemID,
	).Scan(&flagCount, &isHidden); err != nil {
		t.Fatalf("failed to read the item back: %v", err)
	}
	if flagCount != 1 {
		t.Errorf("one party's rotated user agents counted as %d flaggers, want 1", flagCount)
	}
	if isHidden {
		t.Error("a single party hid a proposal on its own")
	}
}

// TestRoadmap_UnvoteCannotRemoveSomebodyElsesVote verifies unvoting requires matching voter identity.
func TestRoadmap_UnvoteCannotRemoveSomebodyElsesVote(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	server := newTestServer(database)

	createReq := jsonRequest("POST", "/api/roadmap", map[string]interface{}{
		"title":       "Unvote Ownership " + uuid.New().String()[:8],
		"description": "Whose vote is it",
	}, "")
	createReq.RemoteAddr = "198.51.100.10:5000"
	w, created := serve(t, ctx, server, createReq)
	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}
	itemID := created["id"].(string)

	victimVoterID := uuid.New().String()
	voteReq := jsonRequest("POST", "/api/roadmap/"+itemID+"/vote", nil, "")
	voteReq.Header.Set("X-Voter-ID", victimVoterID)
	voteReq.RemoteAddr = "198.51.100.10:5000"
	if w, _ := serve(t, ctx, server, voteReq); w.Code != http.StatusOK {
		t.Fatalf("failed to seed a vote: %d", w.Code)
	}

	// A different party claiming the victim's voter id.
	unvoteReq := jsonRequest("DELETE", "/api/roadmap/"+itemID+"/vote", nil, "")
	unvoteReq.Header.Set("X-Voter-ID", victimVoterID)
	unvoteReq.RemoteAddr = "198.51.100.200:5000"
	if w, _ := serve(t, ctx, server, unvoteReq); w.Code != http.StatusOK {
		t.Fatalf("unvote should answer 200 whether or not it removed anything, got %d", w.Code)
	}

	var voteCount int
	if err := database.Pool.QueryRow(ctx, "SELECT vote_count FROM roadmap_items WHERE id = $1", itemID).Scan(&voteCount); err != nil {
		t.Fatalf("failed to read vote count: %v", err)
	}
	if voteCount != 1 {
		t.Errorf("a stranger removed somebody else's vote: count is %d, want 1", voteCount)
	}

	// The voter's own device still withdraws its own vote.
	own := jsonRequest("DELETE", "/api/roadmap/"+itemID+"/vote", nil, "")
	own.Header.Set("X-Voter-ID", victimVoterID)
	own.RemoteAddr = "198.51.100.10:5000"
	if w, _ := serve(t, ctx, server, own); w.Code != http.StatusOK {
		t.Fatalf("the voter's own unvote failed: %d", w.Code)
	}
	if err := database.Pool.QueryRow(ctx, "SELECT vote_count FROM roadmap_items WHERE id = $1", itemID).Scan(&voteCount); err != nil {
		t.Fatalf("failed to read vote count: %v", err)
	}
	if voteCount != 0 {
		t.Errorf("the voter could not withdraw its own vote: count is %d, want 0", voteCount)
	}
}
