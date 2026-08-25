package api_test

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/Jessevdz/RunwayTheGame/internal/api"
	"github.com/Jessevdz/RunwayTheGame/internal/db"
)

// raceableDesign is the smallest saveable design these tests need.
func raceableDesign(name, startID, finishID, roadID string) map[string]interface{} {
	return map[string]interface{}{
		"name": name,
		"waypoints": []map[string]interface{}{
			{"id": startID, "name": "Start", "lat": 0.0, "lon": 0.0, "arrival_radius_m": 25, "is_start": true, "is_finish": false},
			{"id": finishID, "name": "Finish", "lat": 0.0, "lon": 0.01, "arrival_radius_m": 25, "is_start": false, "is_finish": true},
		},
		"roads": []map[string]interface{}{
			{"id": roadID, "waypoint_id_a": startID, "waypoint_id_b": finishID, "length_m": 1000},
		},
	}
}

// seedRaceableBoard creates a board through the API and marks it validated, which
// is what the publish endpoint does once the design passes its geometry checks.
func seedRaceableBoard(t *testing.T, ctx context.Context, database *db.DB, server *api.Server, design map[string]interface{}) (boardID, editToken string) {
	t.Helper()

	w, createResp := serve(t, ctx, server, jsonRequest("POST", "/api/boards", map[string]string{"name": "Snapshot Route"}, ""))
	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created for a board, got %d. Body: %s", w.Code, w.Body.String())
	}
	boardID, _ = createResp["id"].(string)
	editToken, _ = createResp["edit_token"].(string)
	if boardID == "" || editToken == "" {
		t.Fatalf("expected id and edit_token, got %v", createResp)
	}
	t.Cleanup(func() {
		if _, err := database.Pool.Exec(ctx, "DELETE FROM boards WHERE id = $1::uuid", boardID); err != nil {
			t.Logf("failed to delete test board %s: %v", boardID, err)
		}
	})

	w, _ = serve(t, ctx, server, jsonRequest("PUT", "/api/boards/"+boardID, design, editToken))
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on save, got %d. Body: %s", w.Code, w.Body.String())
	}

	// The geometry pipeline is exercised in the geo package; what matters here is
	// the state it leaves behind.
	if _, err := database.Pool.Exec(ctx, "UPDATE boards SET published_at = NOW() WHERE id = $1::uuid AND version = 1", boardID); err != nil {
		t.Fatalf("failed to mark the board validated: %v", err)
	}
	return boardID, editToken
}

// hostRace creates a hosted race on a board and returns the board version it pinned.
func hostRace(t *testing.T, ctx context.Context, server *api.Server, boardID string) (gameID string, boardVersion int) {
	t.Helper()
	w, resp := serve(t, ctx, server, jsonRequest("POST", "/api/games", map[string]interface{}{
		"board_id":  boardID,
		"starts_at": time.Now().Add(-time.Hour),
		"ends_at":   time.Now().Add(time.Hour),
	}, ""))
	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created for a race, got %d. Body: %s", w.Code, w.Body.String())
	}
	gameID, _ = resp["id"].(string)
	version, _ := resp["board_version"].(float64)
	return gameID, int(version)
}

// TestRacedMapStaysEditable tests that hosting a race freezes a snapshot rather
// than the designer's draft, so the map can still be saved afterwards.
func TestRacedMapStaysEditable(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	server := newTestServer(database)

	startID, finishID, roadID := uuid.New().String(), uuid.New().String(), uuid.New().String()
	design := raceableDesign("Snapshot Route", startID, finishID, roadID)
	boardID, editToken := seedRaceableBoard(t, ctx, database, server, design)

	_, racedVersion := hostRace(t, ctx, server, boardID)
	if racedVersion == 1 {
		t.Fatal("a race must pin a snapshot version, not the draft the designer edits")
	}

	var isSnapshot bool
	if err := database.Pool.QueryRow(ctx,
		"SELECT is_snapshot FROM boards WHERE id = $1::uuid AND version = $2", boardID, racedVersion).Scan(&isSnapshot); err != nil {
		t.Fatalf("the raced board version is missing: %v", err)
	}
	if !isSnapshot {
		t.Fatal("the version a race pins must be marked as a snapshot")
	}

	// The reported bug: a map that had been raced refused every later save.
	design["name"] = "Snapshot Route, revised"
	w, _ := serve(t, ctx, server, jsonRequest("PUT", "/api/boards/"+boardID, design, editToken))
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK saving a map that has been raced, got %d. Body: %s", w.Code, w.Body.String())
	}
}

// TestRaceKeepsTheBoardItStartedOn tests that editing a map after a race leaves
// the version that race pinned untouched.
func TestRaceKeepsTheBoardItStartedOn(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	server := newTestServer(database)

	startID, finishID, roadID := uuid.New().String(), uuid.New().String(), uuid.New().String()
	design := raceableDesign("Snapshot Route", startID, finishID, roadID)
	boardID, editToken := seedRaceableBoard(t, ctx, database, server, design)

	_, racedVersion := hostRace(t, ctx, server, boardID)

	// Move the finish and rename the start on the draft.
	design["waypoints"].([]map[string]interface{})[0]["name"] = "New Start"
	design["waypoints"].([]map[string]interface{})[1]["lon"] = 0.05
	w, _ := serve(t, ctx, server, jsonRequest("PUT", "/api/boards/"+boardID, design, editToken))
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on save, got %d. Body: %s", w.Code, w.Body.String())
	}

	var name string
	var lon float64
	if err := database.Pool.QueryRow(ctx, `
		SELECT name, ST_X(location::geometry) FROM board_waypoints
		WHERE board_id = $1::uuid AND board_version = $2 AND id = $3::uuid
	`, boardID, racedVersion, startID).Scan(&name, &lon); err != nil {
		t.Fatalf("the raced board lost its start waypoint: %v", err)
	}
	if name != "Start" {
		t.Fatalf("editing the draft renamed a waypoint under a race: got %q", name)
	}

	if err := database.Pool.QueryRow(ctx, `
		SELECT ST_X(location::geometry) FROM board_waypoints
		WHERE board_id = $1::uuid AND board_version = $2 AND id = $3::uuid
	`, boardID, racedVersion, finishID).Scan(&lon); err != nil {
		t.Fatalf("the raced board lost its finish waypoint: %v", err)
	}
	if lon != 0.01 {
		t.Fatalf("editing the draft moved a waypoint under a race: finish is at lon %v", lon)
	}
}

// TestBoardVersionARaceIsPinnedToIsReadOnly tests that the frozen copy itself
// still refuses design writes.
func TestBoardVersionARaceIsPinnedToIsReadOnly(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	server := newTestServer(database)

	startID, finishID, roadID := uuid.New().String(), uuid.New().String(), uuid.New().String()
	design := raceableDesign("Snapshot Route", startID, finishID, roadID)
	boardID, editToken := seedRaceableBoard(t, ctx, database, server, design)

	// A game pinned straight to the draft is what every race looked like before
	// snapshots, and what the migration moves off the draft.
	if _, err := database.Pool.Exec(ctx, `
		INSERT INTO games (id, board_id, board_version, status, mode, ruleset, starts_at, ends_at)
		VALUES ($1::uuid, $2::uuid, 1, 'draft', 'team', '{}', NOW(), NOW() + INTERVAL '1 hour')
	`, uuid.New().String(), boardID); err != nil {
		t.Fatalf("failed to pin a game to the draft: %v", err)
	}

	w, _ := serve(t, ctx, server, jsonRequest("PUT", "/api/boards/"+boardID, design, editToken))
	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403 writing a board version a race is pinned to, got %d. Body: %s", w.Code, w.Body.String())
	}
}
