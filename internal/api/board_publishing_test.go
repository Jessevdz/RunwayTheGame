package api_test

import (
	"context"
	"net/http"
	"testing"

	"github.com/google/uuid"

	"github.com/Jessevdz/RunwayTheGame/internal/api"
)

// listingContains reports whether the board listing at path includes boardID.
func listingContains(t *testing.T, ctx context.Context, server *api.Server, path, boardID string) bool {
	t.Helper()
	w, summaries := serveSlice(t, ctx, server, jsonRequest("GET", path, nil, ""))
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 from gallery listing, got %d. Body: %s", w.Code, w.Body.String())
	}
	for _, s := range summaries {
		if s["id"] == boardID {
			return true
		}
	}
	return false
}

// TestSaveDoesNotPublishAndCreatorCanWithdraw tests that board creation and
// saving default to private, publishing is explicit, and creators can withdraw published boards.
func TestSaveDoesNotPublishAndCreatorCanWithdraw(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	server := newTestServer(database)

	// 1. Create a map.
	w, createResp := serve(t, ctx, server, jsonRequest("POST", "/api/boards", map[string]string{"name": "Private Route"}, ""))
	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created, got %d. Body: %s", w.Code, w.Body.String())
	}
	boardID, _ := createResp["id"].(string)
	editToken, _ := createResp["edit_token"].(string)
	if boardID == "" || editToken == "" {
		t.Fatalf("expected id and edit_token, got %v", createResp)
	}
	t.Cleanup(func() {
		if _, err := database.Pool.Exec(ctx, "DELETE FROM boards WHERE id = $1::uuid", boardID); err != nil {
			t.Logf("failed to delete test board %s: %v", boardID, err)
		}
	})

	if listed, ok := createResp["is_listed"].(bool); !ok || listed {
		t.Fatalf("a new map must start private, got is_listed=%v", createResp["is_listed"])
	}

	gallery := func() bool {
		return listingContains(t, ctx, server, "/api/boards/", boardID)
	}
	if gallery() {
		t.Fatal("a newly created map must not appear in the public gallery")
	}

	// 2. Saving it — repeatedly — must not publish it.
	save := map[string]interface{}{
		"name": "Private Route",
		"waypoints": []map[string]interface{}{
			{"id": uuid.New().String(), "name": "Start", "lat": 51.48, "lon": 0.0, "arrival_radius_m": 25, "is_start": true, "is_finish": false},
		},
	}
	for i := 0; i < 2; i++ {
		w, _ = serve(t, ctx, server, jsonRequest("PUT", "/api/boards/"+boardID, save, editToken))
		if w.Code != http.StatusOK {
			t.Fatalf("expected 200 OK on save, got %d. Body: %s", w.Code, w.Body.String())
		}
	}
	if gallery() {
		t.Fatal("saving a map must not list it in the public gallery")
	}

	// 3. A stranger cannot publish someone else's map.
	w, _ = serve(t, ctx, server, jsonRequest("PUT", "/api/boards/"+boardID+"/visibility", map[string]bool{"is_listed": true}, uuid.New().String()))
	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for a wrong edit token, got %d. Body: %s", w.Code, w.Body.String())
	}
	if gallery() {
		t.Fatal("a refused publish must not have listed the map")
	}

	// 4. The creating device publishes it.
	w, _ = serve(t, ctx, server, jsonRequest("PUT", "/api/boards/"+boardID+"/visibility", map[string]bool{"is_listed": true}, editToken))
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on publish, got %d. Body: %s", w.Code, w.Body.String())
	}
	if !gallery() {
		t.Fatal("a published map must appear in the public gallery")
	}

	// 5. Editing a published map leaves it published — a save is not a retraction.
	save["name"] = "Private Route, revised"
	w, _ = serve(t, ctx, server, jsonRequest("PUT", "/api/boards/"+boardID, save, editToken))
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on save after publish, got %d. Body: %s", w.Code, w.Body.String())
	}
	if !gallery() {
		t.Fatal("saving an edit must not pull a published map out of the gallery")
	}

	// 6. The same device takes it back down.
	w, _ = serve(t, ctx, server, jsonRequest("PUT", "/api/boards/"+boardID+"/visibility", map[string]bool{"is_listed": false}, editToken))
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on withdraw, got %d. Body: %s", w.Code, w.Body.String())
	}
	if gallery() {
		t.Fatal("a withdrawn map must be gone from the public gallery")
	}

	// 7. It is still the designer's map: fetchable, and reported as private.
	w, getResp := serve(t, ctx, server, jsonRequest("GET", "/api/boards/"+boardID, nil, ""))
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK fetching a private map, got %d. Body: %s", w.Code, w.Body.String())
	}
	if listed, _ := getResp["is_listed"].(bool); listed {
		t.Fatal("a withdrawn map must report is_listed=false")
	}

	// 8. And it is still offerable to a launcher by explicit id, which is how
	//    the device races a map it never published.
	if !listingContains(t, ctx, server, "/api/boards/?ids="+boardID, boardID) {
		t.Fatal("an explicit ids= lookup must return this device's own unlisted map")
	}
}

// TestForkOfPublishedMapStartsPrivate tests that a forked board starts as private
// even if the source board is published.
func TestForkOfPublishedMapStartsPrivate(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	server := newTestServer(database)

	w, createResp := serve(t, ctx, server, jsonRequest("POST", "/api/boards", map[string]string{"name": "Source Route"}, ""))
	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created, got %d. Body: %s", w.Code, w.Body.String())
	}
	srcID, _ := createResp["id"].(string)
	srcToken, _ := createResp["edit_token"].(string)
	t.Cleanup(func() {
		_, _ = database.Pool.Exec(ctx, "DELETE FROM boards WHERE id = $1::uuid", srcID)
	})

	w, _ = serve(t, ctx, server, jsonRequest("PUT", "/api/boards/"+srcID+"/visibility", map[string]bool{"is_listed": true}, srcToken))
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK publishing the source, got %d. Body: %s", w.Code, w.Body.String())
	}

	w, forkResp := serve(t, ctx, server, jsonRequest("POST", "/api/boards/"+srcID+"/fork", nil, ""))
	if w.Code != http.StatusOK && w.Code != http.StatusCreated {
		t.Fatalf("expected fork to succeed, got %d. Body: %s", w.Code, w.Body.String())
	}
	forkID, _ := forkResp["id"].(string)
	if forkID == "" {
		t.Fatalf("expected a fork id, got %v", forkResp)
	}
	t.Cleanup(func() {
		_, _ = database.Pool.Exec(ctx, "DELETE FROM boards WHERE id = $1::uuid", forkID)
	})

	var isListed bool
	if err := database.Pool.QueryRow(ctx, "SELECT is_listed FROM boards WHERE id = $1::uuid AND version = 1", forkID).Scan(&isListed); err != nil {
		t.Fatalf("failed to read fork listing state: %v", err)
	}
	if isListed {
		t.Fatal("a fork of a published map must start private")
	}
}
