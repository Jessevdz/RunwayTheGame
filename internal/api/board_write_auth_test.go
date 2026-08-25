package api_test

import (
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/google/uuid"
)

// TestDeckWritesRequireTheEditToken covers the deck setters relying on
// checkDraftState, which only ever verified publish status: anyone holding a
// board id — which every device that loads the map does — could overwrite
// another designer's roadblock or curse deck.
func TestDeckWritesRequireTheEditToken(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	defer database.Close()

	server := newTestServer(database)

	w, createResp := serve(t, ctx, server, jsonRequest("POST", "/api/boards", map[string]string{"name": "Deck Board"}, ""))
	if w.Code != http.StatusCreated {
		t.Fatalf("failed to create board: %s", w.Body.String())
	}
	boardID := createResp["id"].(string)
	editToken := createResp["edit_token"].(string)
	t.Cleanup(func() {
		_, _ = database.Pool.Exec(ctx, "DELETE FROM boards WHERE id = $1::uuid", boardID)
	})

	cards := map[string]interface{}{
		"cards": []map[string]string{{"id": uuid.New().String(), "text": "Attacker card"}},
	}

	for _, deck := range []string{"roadblock", "curse"} {
		path := fmt.Sprintf("/api/boards/%s/decks/%s", boardID, deck)

		w, _ := serve(t, ctx, server, jsonRequest("POST", path, cards, ""))
		if w.Code != http.StatusForbidden {
			t.Errorf("POST %s with no token: expected 403, got %d (%s)", path, w.Code, strings.TrimSpace(w.Body.String()))
		}

		w, _ = serve(t, ctx, server, jsonRequest("POST", path, cards, uuid.New().String()))
		if w.Code != http.StatusForbidden {
			t.Errorf("POST %s with a wrong token: expected 403, got %d (%s)", path, w.Code, strings.TrimSpace(w.Body.String()))
		}

		// The owner's token still works.
		w, _ = serve(t, ctx, server, jsonRequest("POST", path, cards, editToken))
		if w.Code != http.StatusOK {
			t.Errorf("POST %s with the edit token: expected 200, got %d (%s)", path, w.Code, strings.TrimSpace(w.Body.String()))
		}
	}

	// The deck stays empty for the unauthorized attempts above: only the one
	// authorized write landed.
	var count int
	if err := database.Pool.QueryRow(ctx,
		"SELECT COUNT(*) FROM board_roadblock_cards WHERE board_id = $1::uuid", boardID).Scan(&count); err != nil {
		t.Fatalf("failed to count roadblock cards: %v", err)
	}
	if count != 1 {
		t.Errorf("expected exactly the one authorized card, got %d", count)
	}
}

// TestDeckWriteRejectsAnOversizedDeck keeps one request from expanding into an
// unbounded run of INSERTs.
func TestDeckWriteRejectsAnOversizedDeck(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	defer database.Close()

	server := newTestServer(database)
	w, createResp := serve(t, ctx, server, jsonRequest("POST", "/api/boards", map[string]string{"name": "Big Deck"}, ""))
	if w.Code != http.StatusCreated {
		t.Fatalf("failed to create board: %s", w.Body.String())
	}
	boardID := createResp["id"].(string)
	editToken := createResp["edit_token"].(string)
	t.Cleanup(func() {
		_, _ = database.Pool.Exec(ctx, "DELETE FROM boards WHERE id = $1::uuid", boardID)
	})

	cards := make([]map[string]string, 0, 500)
	for i := 0; i < 500; i++ {
		cards = append(cards, map[string]string{"id": uuid.New().String(), "text": "c"})
	}
	w, _ = serve(t, ctx, server, jsonRequest("POST",
		fmt.Sprintf("/api/boards/%s/decks/roadblock", boardID),
		map[string]interface{}{"cards": cards}, editToken))
	// Either the deck cap or the body-size cap rejects it; both are 400.
	if w.Code != http.StatusBadRequest && w.Code != http.StatusRequestEntityTooLarge {
		t.Errorf("expected an oversized deck to be rejected, got %d (%s)", w.Code, strings.TrimSpace(w.Body.String()))
	}
}

// TestPublishRequiresTheEditToken covers the one board write that never checked
// a capability. published_at has no reset route, so an unauthorized publish
// permanently freezes someone else's draft as the raceable version.
func TestPublishRequiresTheEditToken(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	defer database.Close()

	server := newTestServer(database)

	w, createResp := serve(t, ctx, server, jsonRequest("POST", "/api/boards", map[string]string{"name": "Victim Route"}, ""))
	if w.Code != http.StatusCreated {
		t.Fatalf("failed to create board: %s", w.Body.String())
	}
	boardID := createResp["id"].(string)
	t.Cleanup(func() {
		_, _ = database.Pool.Exec(ctx, "DELETE FROM boards WHERE id = $1::uuid", boardID)
	})

	path := fmt.Sprintf("/api/boards/%s/publish", boardID)

	w, _ = serve(t, ctx, server, jsonRequest("POST", path, nil, ""))
	if w.Code != http.StatusForbidden {
		t.Errorf("publish with no token: expected 403, got %d (%s)", w.Code, strings.TrimSpace(w.Body.String()))
	}

	w, _ = serve(t, ctx, server, jsonRequest("POST", path, nil, uuid.New().String()))
	if w.Code != http.StatusForbidden {
		t.Errorf("publish with a wrong token: expected 403, got %d (%s)", w.Code, strings.TrimSpace(w.Body.String()))
	}

	// The board must be untouched — the owner can still publish it later.
	var publishedAt *string
	if err := database.Pool.QueryRow(ctx,
		"SELECT published_at::text FROM boards WHERE id = $1::uuid AND version = 1", boardID).Scan(&publishedAt); err != nil {
		t.Fatalf("failed to read board: %v", err)
	}
	if publishedAt != nil {
		t.Fatalf("an unauthorized caller published the board (published_at=%s)", *publishedAt)
	}
}
