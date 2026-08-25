package api_test

import (
	"fmt"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/Jessevdz/RunwayTheGame/internal/api"
	"github.com/Jessevdz/RunwayTheGame/internal/db"
	"github.com/Jessevdz/RunwayTheGame/internal/projections"

	"context"
)

// joinCodeAlphabet mirrors the server's, deliberately duplicated so a change to
// the real one has to be a conscious decision rather than a silently passing test.
const testJoinCodeAlphabet = "23456789BCDFGHJKMNPQRSTVWXYZ"

// newDraftRace creates a published board and a game, without starting it — the
// lobby state everything here cares about.
func newDraftRace(t *testing.T, ctx context.Context, database *db.DB) (*api.Server, map[string]interface{}) {
	t.Helper()
	server := newTestServer(database)
	board := setupRaceBoard(t, ctx, database)

	w, resp := serve(t, ctx, server, jsonRequest("POST", "/api/games", map[string]interface{}{
		"board_id":      board.BoardID,
		"board_version": 1,
		"starts_at":     time.Now().Add(-time.Hour),
		"ends_at":       time.Now().Add(time.Hour),
	}, ""))
	if w.Code != http.StatusCreated {
		t.Fatalf("failed to create game: %s", w.Body.String())
	}
	return server, resp
}

func TestCreateGameMintsARaceCode(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}

	_, resp := newDraftRace(t, ctx, database)

	code, ok := resp["race_code"].(string)
	if !ok || code == "" {
		t.Fatalf("expected a race_code in the create response, got: %v", resp)
	}
	if len(code) != 6 {
		t.Fatalf("expected a 6-character race code, got %q", code)
	}
	for _, c := range code {
		if !strings.ContainsRune(testJoinCodeAlphabet, c) {
			t.Fatalf("race code %q contains %q, which is outside the unambiguous alphabet", code, c)
		}
	}
}

func TestRaceCodeResolvesToTheGame(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}

	server, created := newDraftRace(t, ctx, database)
	gameID := created["id"].(string)
	code := created["race_code"].(string)

	w, resp := serve(t, ctx, server, jsonRequest("GET", "/api/games/by-code/"+code, nil, ""))
	if w.Code != http.StatusOK {
		t.Fatalf("by-code lookup: got %d, want 200 — %s", w.Code, w.Body.String())
	}
	if resp["game_id"] != gameID {
		t.Fatalf("by-code resolved to %v, want %s", resp["game_id"], gameID)
	}
	if resp["board_name"] != "Full Race Board" {
		t.Fatalf("expected the board name in the lookup, got %v", resp["board_name"])
	}
	if resp["status"] != "draft" {
		t.Fatalf("expected status draft, got %v", resp["status"])
	}

	// A race code buys a lobby, never a capability: there is no read-only role to
	// hand out, and the feed stays shut until a colour is taken.
	if tok, present := resp["spectator_token"]; present && tok != "" {
		t.Fatalf("by-code must not hand out a read capability, got %v", tok)
	}

	// The roster is deliberately withheld: it would let a code sweeper harvest
	// team names without ever opening a socket.
	if _, leaked := resp["teams"]; leaked {
		t.Fatal("by-code must not return the team roster")
	}
	if count, ok := resp["team_count"].(float64); !ok || count != 0 {
		t.Fatalf("expected team_count 0 on a fresh race, got %v", resp["team_count"])
	}
}

func TestRaceCodeLookupIsForgivingAboutFormatting(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}

	server, created := newDraftRace(t, ctx, database)
	gameID := created["id"].(string)
	code := created["race_code"].(string)

	// How a code arrives when someone types what they were told over the phone.
	messy := strings.ToLower(code[:3]) + "-" + strings.ToLower(code[3:])
	w, resp := serve(t, ctx, server, jsonRequest("GET", "/api/games/by-code/"+messy, nil, ""))
	if w.Code != http.StatusOK {
		t.Fatalf("lookup of %q: got %d, want 200 — %s", messy, w.Code, w.Body.String())
	}
	if resp["game_id"] != gameID {
		t.Fatalf("normalized lookup resolved to %v, want %s", resp["game_id"], gameID)
	}
}

func TestRaceCodeLookupRejectsUnknownAndEndedRaces(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}

	server, created := newDraftRace(t, ctx, database)
	gameID := created["id"].(string)
	hostToken := created["host_token"].(string)
	code := created["race_code"].(string)

	// A well-formed code nobody holds.
	if w, _ := serve(t, ctx, server, jsonRequest("GET", "/api/games/by-code/ZZZZZZ", nil, "")); w.Code != http.StatusNotFound {
		t.Fatalf("unknown code: got %d, want 404", w.Code)
	}
	// Junk that cannot be a code — rejected before it costs a query.
	if w, _ := serve(t, ctx, server, jsonRequest("GET", "/api/games/by-code/AEIOU1", nil, "")); w.Code != http.StatusNotFound {
		t.Fatalf("malformed code: got %d, want 404", w.Code)
	}

	serve(t, ctx, server, jsonRequest("POST", "/api/games/"+gameID+"/start", nil, hostToken))
	serve(t, ctx, server, jsonRequest("POST", "/api/games/"+gameID+"/end", nil, hostToken))

	w, resp := serve(t, ctx, server, jsonRequest("GET", "/api/games/by-code/"+code, nil, ""))
	if w.Code != http.StatusGone {
		t.Fatalf("ended race: got %d, want 410 — %s", w.Code, w.Body.String())
	}
	// A finished race cannot be joined, so the code must stop resolving at all.
	if id, present := resp["game_id"]; present && id != "" {
		t.Fatal("an ended race must not resolve its game id")
	}
}

// The by-code route is a static road sharing a prefix with /{game_id}. chi
// resolves static before wildcard, but a regression here would silently break
// every game fetch, so it is asserted rather than assumed.
func TestGameByIDStillResolvesAlongsideByCode(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}

	server, created := newDraftRace(t, ctx, database)
	gameID := created["id"].(string)

	w, resp := serve(t, ctx, server, jsonRequest("GET", "/api/games/"+gameID, nil, ""))
	if w.Code != http.StatusOK {
		t.Fatalf("GET /api/games/{id}: got %d, want 200 — %s", w.Code, w.Body.String())
	}
	if resp["game_id"] != gameID {
		t.Fatalf("game fetch returned %v, want %s", resp["game_id"], gameID)
	}
	if resp["race_code"] != created["race_code"] {
		t.Fatalf("game fetch race_code %v, want %v", resp["race_code"], created["race_code"])
	}
}

// The lobby roster used to arrive over the websocket, which needed the read-only
// capability that no longer exists. Someone who has typed a race code holds no
// capability at all until they take a colour, so the roster they pick from has to
// come from here — with the join codes left behind requireHost.
func TestGameFetchCarriesTheLobbyRoster(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}

	server, created := newDraftRace(t, ctx, database)
	gameID := created["id"].(string)

	w, resp := serve(t, ctx, server, jsonRequest("GET", "/api/games/"+gameID, nil, ""))
	if w.Code != http.StatusOK {
		t.Fatalf("GET /api/games/{id}: got %d, want 200 — %s", w.Code, w.Body.String())
	}
	teams, ok := resp["teams"].([]interface{})
	if !ok {
		t.Fatalf("expected a teams array on a fresh race, got %v", resp["teams"])
	}
	if len(teams) != 0 {
		t.Fatalf("expected an empty roster on a fresh race, got %v", teams)
	}

	serve(t, ctx, server, jsonRequest("POST", "/api/games/"+gameID+"/join",
		map[string]interface{}{"team_name": "Red", "slot_index": 0}, ""))

	_, resp = serve(t, ctx, server, jsonRequest("GET", "/api/games/"+gameID, nil, ""))
	teams, _ = resp["teams"].([]interface{})
	if len(teams) != 1 {
		t.Fatalf("expected the joined team in the roster, got %v", teams)
	}
	team := teams[0].(map[string]interface{})
	if team["team_name"] != "Red" {
		t.Fatalf("expected the team name in the roster, got %v", team["team_name"])
	}
	if slot, ok := team["slot_index"].(float64); !ok || slot != 0 {
		t.Fatalf("expected slot_index 0 so the lobby can grey out the colour, got %v", team["slot_index"])
	}
	// The join code is a capability: it lets a device claim this team. It stays on
	// the host-only /teams route.
	if code, present := team["join_code"]; present && code != "" {
		t.Fatalf("the public roster must not carry join codes, got %v", code)
	}
}

func TestRaceCodeLookupIsRateLimited(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}

	server, _ := newDraftRace(t, ctx, database)

	// The dedicated lookup limiter has a burst of 10, well under the global
	// per-IP limiter's 60, so it is the one that trips here.
	var got429 bool
	for i := 0; i < 20; i++ {
		w, _ := serve(t, ctx, server, jsonRequest("GET", "/api/games/by-code/ZZZZZZ", nil, ""))
		if w.Code == http.StatusTooManyRequests {
			got429 = true
			break
		}
	}
	if !got429 {
		t.Fatal("expected the race-code lookup limiter to trip within 20 attempts")
	}
}

// The lobby is a burst of simultaneous joins, and the team row used to be
// committed outside the command transaction — so a join that lost the sequence
// race left a team that authenticated fine but appeared in no projection, with
// its colour permanently burned.
func TestConcurrentJoinsLeaveNoOrphanTeamRows(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}

	server, created := newDraftRace(t, ctx, database)
	gameID := created["id"].(string)

	const teams = 6
	var wg sync.WaitGroup
	codes := make([]int, teams)
	for i := 0; i < teams; i++ {
		wg.Add(1)
		go func(slot int) {
			defer wg.Done()
			w, _ := serve(t, ctx, server, jsonRequest("POST", "/api/games/"+gameID+"/join", map[string]interface{}{
				"team_name":  "Team " + string(rune('A'+slot)),
				"slot_index": slot,
			}, ""))
			codes[slot] = w.Code
		}(i)
	}
	wg.Wait()

	for slot, code := range codes {
		if code != http.StatusCreated {
			t.Errorf("join on slot %d: got %d, want 201", slot, code)
		}
	}

	var rows int
	if err := database.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM game_teams WHERE game_id = $1`, gameID).Scan(&rows); err != nil {
		t.Fatalf("failed to count team rows: %v", err)
	}
	proj, err := projections.RebuildProjection(ctx, database.Pool, gameID, 0)
	if err != nil {
		t.Fatalf("failed to rebuild projection: %v", err)
	}
	if rows != len(proj.Teams) {
		t.Fatalf("%d team rows but %d teams in the projection — the difference is orphaned", rows, len(proj.Teams))
	}
}

func TestJoinIsIdempotentAcrossRetries(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}

	server, created := newDraftRace(t, ctx, database)
	gameID := created["id"].(string)

	body := map[string]interface{}{"team_name": "Retriers", "slot_index": 0, "idempotency_key": "join-retry-" + gameID}

	w1, first := serve(t, ctx, server, jsonRequest("POST", "/api/games/"+gameID+"/join", body, ""))
	if w1.Code != http.StatusCreated {
		t.Fatalf("first join: got %d — %s", w1.Code, w1.Body.String())
	}
	// A retry after a timeout must replay the team that exists, not mint a second
	// one — and certainly not 409 against the caller's own slot.
	w2, second := serve(t, ctx, server, jsonRequest("POST", "/api/games/"+gameID+"/join", body, ""))
	if w2.Code != http.StatusCreated {
		t.Fatalf("retried join: got %d, want 201 — %s", w2.Code, w2.Body.String())
	}
	if first["team_id"] != second["team_id"] || first["join_token"] != second["join_token"] {
		t.Fatalf("retry minted a different team: %v then %v", first, second)
	}

	var rows int
	_ = database.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM game_teams WHERE game_id = $1`, gameID).Scan(&rows)
	if rows != 1 {
		t.Fatalf("expected exactly one team row after a retried join, got %d", rows)
	}
}

// Claiming an existing team trades a six-character join code for that team's
// capability, which is full impersonation — and both ids the route needs are
// readable without a capability. So it takes the same tight budget the race-code
// lookup does, not just the generic 4/s per-IP throttle a brute-force can live
// with.
func TestJoiningAnExistingTeamIsRateLimited(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}

	server, created := newDraftRace(t, ctx, database)
	gameID := created["id"].(string)

	w, joined := serve(t, ctx, server, jsonRequest("POST", "/api/games/"+gameID+"/join", map[string]interface{}{
		"team_name": "Red", "slot_index": 0,
	}, ""))
	if w.Code != http.StatusCreated {
		t.Fatalf("failed to seed a team: %d — %s", w.Code, w.Body.String())
	}
	teamID := joined["team_id"].(string)

	path := fmt.Sprintf("/api/games/%s/teams/%s/join", gameID, teamID)
	var got429 bool
	for i := 0; i < 20; i++ {
		// Wrong but well-formed, so every attempt costs a token: a guess that
		// could not be a code is refused before the budget is touched.
		w, _ := serve(t, ctx, server, jsonRequest("POST", path, map[string]interface{}{"join_code": "BCDFGH"}, ""))
		if w.Code == http.StatusTooManyRequests {
			got429 = true
			break
		}
	}
	if !got429 {
		t.Fatal("expected the join-code brute-force budget to trip within 20 attempts")
	}
}
