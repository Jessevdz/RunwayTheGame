package api_test

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/Jessevdz/RunwayTheGame/internal/api"
	"github.com/Jessevdz/RunwayTheGame/internal/projections"
)

// seedSquad creates a squad in a draft race and returns its ids and capability.
func seedSquad(t *testing.T, ctx context.Context, server *api.Server, gameID, name string, slot int, player string) (teamID, token, joinCode, playerID string) {
	t.Helper()
	w, resp := serve(t, ctx, server, jsonRequest("POST", "/api/games/"+gameID+"/join", map[string]interface{}{
		"team_name": name, "slot_index": slot, "display_name": player,
	}, ""))
	if w.Code != http.StatusCreated {
		t.Fatalf("failed to seed squad %q: %d — %s", name, w.Code, w.Body.String())
	}
	code, _ := resp["join_code"].(string)
	pid, _ := resp["player_id"].(string)
	return resp["team_id"].(string), resp["join_token"].(string), code, pid
}

// rosterOf reads the public lobby roster: teams, and who is on each.
func rosterOf(t *testing.T, ctx context.Context, server *api.Server, gameID string) []map[string]interface{} {
	t.Helper()
	w, resp := serve(t, ctx, server, jsonRequest("GET", "/api/games/"+gameID, nil, ""))
	if w.Code != http.StatusOK {
		t.Fatalf("GET /api/games/{id}: got %d — %s", w.Code, w.Body.String())
	}
	raw, _ := resp["teams"].([]interface{})
	out := make([]map[string]interface{}, 0, len(raw))
	for _, entry := range raw {
		out = append(out, entry.(map[string]interface{}))
	}
	return out
}

func playerNames(team map[string]interface{}) []string {
	raw, _ := team["players"].([]interface{})
	names := make([]string, 0, len(raw))
	for _, p := range raw {
		names = append(names, p.(map[string]interface{})["display_name"].(string))
	}
	return names
}

// The wall this whole change exists to remove: a player who has typed the race
// code and can see their friend's squad had to produce a *second* six-character
// code to get onto it. The race code is the trust boundary now.
func TestJoiningASquadNeedsNoJoinCode(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}

	server, created := newDraftRace(t, ctx, database)
	gameID := created["id"].(string)
	teamID, _, _, _ := seedSquad(t, ctx, server, gameID, "Red Dragons", 0, "Jordan")

	w, resp := serve(t, ctx, server, jsonRequest("POST",
		fmt.Sprintf("/api/games/%s/teams/%s/join", gameID, teamID),
		map[string]interface{}{"display_name": "Sam"}, ""))
	if w.Code != http.StatusOK {
		t.Fatalf("codeless join: got %d, want 200 — %s", w.Code, w.Body.String())
	}
	token, _ := resp["join_token"].(string)
	if token == "" {
		t.Fatalf("expected a join token from a codeless join, got %v", resp)
	}
	if resp["player_id"] == "" || resp["player_id"] == nil {
		t.Fatalf("expected a player id from a codeless join, got %v", resp)
	}

	// The token it handed back is a real team capability, not a placeholder: the
	// strategic half of the game payload only comes out for one.
	_, authed := serve(t, ctx, server, jsonRequest("GET", "/api/games/"+gameID, nil, token))
	if _, ok := authed["standings"]; !ok {
		t.Fatalf("the token from a codeless join did not authorize; got keys %v", authed)
	}
}

// Dropping the requirement must not soften the check for a link that still
// carries one. An invite whose code has since been rotated has to fail, or
// "the code no longer matters" quietly becomes "the code was never checked".
func TestASuppliedJoinCodeIsStillVerified(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}

	server, created := newDraftRace(t, ctx, database)
	gameID := created["id"].(string)
	teamID, _, realCode, _ := seedSquad(t, ctx, server, gameID, "Red Dragons", 0, "Jordan")
	path := fmt.Sprintf("/api/games/%s/teams/%s/join", gameID, teamID)

	w, _ := serve(t, ctx, server, jsonRequest("POST", path, map[string]interface{}{"join_code": "BCDFGH"}, ""))
	if w.Code != http.StatusForbidden {
		t.Fatalf("wrong join code: got %d, want 403 — %s", w.Code, w.Body.String())
	}

	w, _ = serve(t, ctx, server, jsonRequest("POST", path, map[string]interface{}{"join_code": realCode}, ""))
	if w.Code != http.StatusOK {
		t.Fatalf("correct join code: got %d, want 200 — %s", w.Code, w.Body.String())
	}
}

// The question the lobby could not answer before: which of my friends is on
// which squad.
func TestLobbyRosterNamesThePeopleOnEachSquad(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}

	server, created := newDraftRace(t, ctx, database)
	gameID := created["id"].(string)
	redID, _, _, _ := seedSquad(t, ctx, server, gameID, "Red Dragons", 0, "Jordan")
	seedSquad(t, ctx, server, gameID, "Blue Herons", 1, "Alex")

	serve(t, ctx, server, jsonRequest("POST",
		fmt.Sprintf("/api/games/%s/teams/%s/join", gameID, redID),
		map[string]interface{}{"display_name": "Sam"}, ""))

	roster := rosterOf(t, ctx, server, gameID)
	if len(roster) != 2 {
		t.Fatalf("expected two squads, got %d", len(roster))
	}
	red, blue := roster[0], roster[1]
	if got := playerNames(red); len(got) != 2 || got[0] != "Jordan" || got[1] != "Sam" {
		t.Fatalf("Red Dragons roster = %v, want [Jordan Sam] in join order", got)
	}
	if got := playerNames(blue); len(got) != 1 || got[0] != "Alex" {
		t.Fatalf("Blue Herons roster = %v, want [Alex]", got)
	}
	// Still no capability in the public payload, names or not.
	if code, present := red["join_code"]; present && code != "" {
		t.Fatalf("the public roster must not carry join codes, got %v", code)
	}
}

// A race code resolves to a game and nothing else. It must not become a way to
// harvest the names of the people in a lobby without entering it.
func TestRaceCodeLookupCarriesNoPlayerNames(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}

	server, created := newDraftRace(t, ctx, database)
	gameID := created["id"].(string)
	code := created["race_code"].(string)
	seedSquad(t, ctx, server, gameID, "Red Dragons", 0, "Jordan")

	w, resp := serve(t, ctx, server, jsonRequest("GET", "/api/games/by-code/"+code, nil, ""))
	if w.Code != http.StatusOK {
		t.Fatalf("by-code lookup: got %d — %s", w.Code, w.Body.String())
	}
	if _, present := resp["teams"]; present {
		t.Fatalf("the by-code lookup must not carry the roster, got %v", resp["teams"])
	}
	if body := w.Body.String(); strings.Contains(body, "Jordan") {
		t.Fatalf("the by-code lookup leaked a player name: %s", body)
	}
}

func TestRenamingYourselfShowsUpInTheRoster(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}

	server, created := newDraftRace(t, ctx, database)
	gameID := created["id"].(string)
	_, token, _, _ := seedSquad(t, ctx, server, gameID, "Red Dragons", 0, "Jordan")

	w, resp := serve(t, ctx, server, jsonRequest("PATCH", "/api/games/"+gameID+"/me",
		map[string]interface{}{"display_name": "Jord"}, token))
	if w.Code != http.StatusOK {
		t.Fatalf("PATCH /me: got %d, want 200 — %s", w.Code, w.Body.String())
	}
	if resp["display_name"] != "Jord" {
		t.Fatalf("PATCH /me returned %v, want the new name", resp["display_name"])
	}

	roster := rosterOf(t, ctx, server, gameID)
	if got := playerNames(roster[0]); len(got) != 1 || got[0] != "Jord" {
		t.Fatalf("roster after rename = %v, want [Jord]", got)
	}
}

// Switching squads moves the capability rather than reissuing it, and takes the
// squad it empties with it — UNIQUE(game_id, slot_index) never gives a colour
// back, so a squad joined by mistake used to cost one for the whole race.
func TestSwitchingSquadsMovesTheTokenAndDisbandsWhatItEmpties(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}

	server, created := newDraftRace(t, ctx, database)
	gameID := created["id"].(string)
	redID, _, _, _ := seedSquad(t, ctx, server, gameID, "Red Dragons", 0, "Jordan")
	blueID, blueToken, _, _ := seedSquad(t, ctx, server, gameID, "Blue Herons", 1, "Sam")

	w, resp := serve(t, ctx, server, jsonRequest("PATCH", "/api/games/"+gameID+"/me",
		map[string]interface{}{"team_id": redID}, blueToken))
	if w.Code != http.StatusOK {
		t.Fatalf("switch squads: got %d, want 200 — %s", w.Code, w.Body.String())
	}
	if resp["team_id"] != redID || resp["team_name"] != "Red Dragons" {
		t.Fatalf("switch returned %v, want the target squad", resp)
	}

	// The same token still authorizes — it moved, it was not replaced.
	_, authed := serve(t, ctx, server, jsonRequest("GET", "/api/games/"+gameID, nil, blueToken))
	if _, ok := authed["standings"]; !ok {
		t.Fatalf("the token stopped working after a switch; got keys %v", authed)
	}

	roster := rosterOf(t, ctx, server, gameID)
	if len(roster) != 1 || roster[0]["team_id"] != redID {
		t.Fatalf("expected only Red Dragons left in the roster, got %v", roster)
	}
	if got := playerNames(roster[0]); len(got) != 2 {
		t.Fatalf("expected both players on Red Dragons, got %v", got)
	}

	// SQL agreeing is not enough: the projection is the read model, and a squad
	// that survives only there is a ghost in every standings table.
	proj, err := projections.RebuildProjection(ctx, database.Pool, gameID, 0)
	if err != nil {
		t.Fatalf("failed to rebuild projection: %v", err)
	}
	assertTeamGone(t, proj, blueID)
	if _, ok := proj.Teams[redID]; !ok {
		t.Fatalf("Red Dragons vanished from the projection: %v", proj.Teams)
	}
}

func assertTeamGone(t *testing.T, proj *projections.GameStateProjection, teamID string) {
	t.Helper()
	if _, ok := proj.Teams[teamID]; ok {
		t.Fatalf("disbanded team %s is still in proj.Teams", teamID)
	}
	if _, ok := proj.Progress[teamID]; ok {
		t.Fatalf("disbanded team %s is still in proj.Progress", teamID)
	}
	if _, ok := proj.Coins[teamID]; ok {
		t.Fatalf("disbanded team %s is still in proj.Coins", teamID)
	}
	if _, ok := proj.Inventory[teamID]; ok {
		t.Fatalf("disbanded team %s is still in proj.Inventory", teamID)
	}
	if _, ok := proj.Effects[teamID]; ok {
		t.Fatalf("disbanded team %s is still in proj.Effects", teamID)
	}
	for _, row := range proj.StandingsList {
		if row.TeamID == teamID {
			t.Fatalf("disbanded team %s is still in the standings", teamID)
		}
	}
}

func TestRenamingAndRecolouringASquad(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}

	server, created := newDraftRace(t, ctx, database)
	gameID := created["id"].(string)
	redID, redToken, _, _ := seedSquad(t, ctx, server, gameID, "Red Dragosn", 0, "Jordan")
	seedSquad(t, ctx, server, gameID, "Blue Herons", 1, "Sam")

	path := fmt.Sprintf("/api/games/%s/teams/%s", gameID, redID)
	w, _ := serve(t, ctx, server, jsonRequest("PATCH", path,
		map[string]interface{}{"name": "Red Dragons", "slot_index": 3}, redToken))
	if w.Code != http.StatusOK {
		t.Fatalf("rename+recolour: got %d, want 200 — %s", w.Code, w.Body.String())
	}

	// The projection folds team identity from events, so the edit has to reach it
	// or the read model asserts the typo forever.
	proj, err := projections.RebuildProjection(ctx, database.Pool, gameID, 0)
	if err != nil {
		t.Fatalf("failed to rebuild projection: %v", err)
	}
	info, ok := proj.Teams[redID]
	if !ok {
		t.Fatalf("the edited squad left the projection entirely: %v", proj.Teams)
	}
	if info.Name != "Red Dragons" || info.SlotIndex != 3 {
		t.Fatalf("projection has %+v, want the edited name and slot", info)
	}

	// A colour somebody else holds is an ordinary, recoverable conflict.
	w, _ = serve(t, ctx, server, jsonRequest("PATCH", path,
		map[string]interface{}{"slot_index": 1}, redToken))
	if w.Code != http.StatusConflict {
		t.Fatalf("recolour onto a taken slot: got %d, want 409 — %s", w.Code, w.Body.String())
	}
}

// A squad is its members' and the host's. Holding a token for a different squad
// in the same race is not authority over this one.
func TestEditingSomebodyElsesSquadIsRefused(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}

	server, created := newDraftRace(t, ctx, database)
	gameID := created["id"].(string)
	redID, _, _, _ := seedSquad(t, ctx, server, gameID, "Red Dragons", 0, "Jordan")
	_, blueToken, _, _ := seedSquad(t, ctx, server, gameID, "Blue Herons", 1, "Sam")

	path := fmt.Sprintf("/api/games/%s/teams/%s", gameID, redID)
	w, _ := serve(t, ctx, server, jsonRequest("PATCH", path, map[string]interface{}{"name": "Hijacked"}, blueToken))
	if w.Code != http.StatusForbidden {
		t.Fatalf("editing another squad: got %d, want 403 — %s", w.Code, w.Body.String())
	}
	w, _ = serve(t, ctx, server, jsonRequest("DELETE", path, nil, blueToken))
	if w.Code != http.StatusForbidden {
		t.Fatalf("disbanding another squad: got %d, want 403 — %s", w.Code, w.Body.String())
	}
}

func TestDisbandingASquadNobodyIsOn(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}

	server, created := newDraftRace(t, ctx, database)
	gameID := created["id"].(string)
	hostToken := created["host_token"].(string)
	strayID, _, _, _ := seedSquad(t, ctx, server, gameID, "Typo Squad", 0, "Jordan")

	path := fmt.Sprintf("/api/games/%s/teams/%s", gameID, strayID)

	// Somebody is still on it, so it stays — leaving is done by switching.
	w, _ := serve(t, ctx, server, jsonRequest("DELETE", path, nil, hostToken))
	if w.Code != http.StatusConflict {
		t.Fatalf("disbanding an occupied squad: got %d, want 409 — %s", w.Code, w.Body.String())
	}

	// Empty it the way the lobby does, then it can go.
	seedSquad(t, ctx, server, gameID, "Real Squad", 1, "Sam")
	if _, err := database.Pool.Exec(ctx, `DELETE FROM team_tokens WHERE game_id = $1 AND team_id = $2`, gameID, strayID); err != nil {
		t.Fatalf("failed to vacate the squad: %v", err)
	}

	w, _ = serve(t, ctx, server, jsonRequest("DELETE", path, nil, hostToken))
	if w.Code != http.StatusNoContent {
		t.Fatalf("disbanding an empty squad: got %d, want 204 — %s", w.Code, w.Body.String())
	}

	proj, err := projections.RebuildProjection(ctx, database.Pool, gameID, 0)
	if err != nil {
		t.Fatalf("failed to rebuild projection: %v", err)
	}
	assertTeamGone(t, proj, strayID)

	// The colour is back in the pool, which is the whole point.
	w, _ = serve(t, ctx, server, jsonRequest("POST", "/api/games/"+gameID+"/join", map[string]interface{}{
		"team_name": "Latecomers", "slot_index": 0, "display_name": "Alex",
	}, ""))
	if w.Code != http.StatusCreated {
		t.Fatalf("reusing the freed colour: got %d, want 201 — %s", w.Code, w.Body.String())
	}
}

// Once the race is running, a squad's identity is load-bearing: every waypoint
// and coin in the log is attributed to it. Renaming yourself stays harmless and
// stays allowed.
func TestSquadEditsCloseWhenTheRaceStarts(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}

	server, created := newDraftRace(t, ctx, database)
	gameID := created["id"].(string)
	hostToken := created["host_token"].(string)
	redID, redToken, _, _ := seedSquad(t, ctx, server, gameID, "Red Dragons", 0, "Jordan")
	blueID, _, _, _ := seedSquad(t, ctx, server, gameID, "Blue Herons", 1, "Sam")

	w, _ := serve(t, ctx, server, jsonRequest("POST", "/api/games/"+gameID+"/start", nil, hostToken))
	if w.Code != http.StatusOK && w.Code != http.StatusCreated {
		t.Fatalf("failed to start the race: %d — %s", w.Code, w.Body.String())
	}

	teamPath := fmt.Sprintf("/api/games/%s/teams/%s", gameID, redID)
	for _, tc := range []struct {
		what string
		req  *http.Request
	}{
		{"switch squads", jsonRequest("PATCH", "/api/games/"+gameID+"/me", map[string]interface{}{"team_id": blueID}, redToken)},
		{"rename squad", jsonRequest("PATCH", teamPath, map[string]interface{}{"name": "Renamed"}, redToken)},
		{"disband squad", jsonRequest("DELETE", teamPath, nil, redToken)},
	} {
		w, _ := serve(t, ctx, server, tc.req)
		if w.Code != http.StatusForbidden {
			t.Errorf("%s on a live race: got %d, want 403 — %s", tc.what, w.Code, w.Body.String())
		}
	}

	w, _ = serve(t, ctx, server, jsonRequest("PATCH", "/api/games/"+gameID+"/me",
		map[string]interface{}{"display_name": "Jord"}, redToken))
	if w.Code != http.StatusOK {
		t.Fatalf("renaming yourself mid-race: got %d, want 200 — %s", w.Code, w.Body.String())
	}
}

// Names go into a roster every device in the race reads. Control characters can
// reorder or hide the text around them, so they are dropped rather than escaped
// downstream, and an over-long name is cut at a character boundary.
func TestPlayerNamesAreSanitized(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}

	server, created := newDraftRace(t, ctx, database)
	gameID := created["id"].(string)
	seedSquad(t, ctx, server, gameID, "Red Dragons", 0, "  Jor‮dan\tvan   der  \n")

	got := playerNames(rosterOf(t, ctx, server, gameID)[0])
	if len(got) != 1 || got[0] != "Jordan van der" {
		t.Fatalf("sanitized name = %q, want %q", got, "Jordan van der")
	}
}
