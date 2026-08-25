package api_test

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/Jessevdz/RunwayTheGame/internal/api"
	"github.com/Jessevdz/RunwayTheGame/internal/db"
)

// authFixture is a published board plus a game with one team, which is the
// minimum needed to ask "can a stranger do this?" of every protected route.
type authFixture struct {
	gameID     string
	hostToken  string
	teamID     string
	teamToken  string
	joinCode   string
	waypointID string
}

func seedAuthFixture(t *testing.T, ctx context.Context, database *db.DB, server *api.Server) authFixture {
	t.Helper()

	boardID := uuid.New().String()
	wStart := uuid.New().String()
	wFinish := uuid.New().String()

	mustExec := func(query string, args ...interface{}) {
		t.Helper()
		if _, err := database.Pool.Exec(ctx, query, args...); err != nil {
			t.Fatalf("setup query failed: %v (%s)", err, query)
		}
	}
	mustExec("INSERT INTO boards (id, version, name, published_at) VALUES ($1, 1, 'Auth Test Board', NOW())", boardID)
	mustExec(`
		INSERT INTO board_waypoints (id, board_id, board_version, name, location, is_start, is_finish, arrival_radius_m) VALUES
		($2, $1, 1, 'Start', ST_SetSRID(ST_MakePoint(0.0, 0.0), 4326), true, false, 25),
		($3, $1, 1, 'Finish', ST_SetSRID(ST_MakePoint(0.0, 0.01), 4326), false, true, 25)
	`, boardID, wStart, wFinish)

	w, gameResp := serve(t, ctx, server, jsonRequest("POST", "/api/games", map[string]interface{}{
		"board_id": boardID, "board_version": 1,
		"starts_at": time.Now().Add(-time.Hour), "ends_at": time.Now().Add(time.Hour),
	}, ""))
	if w.Code != http.StatusCreated {
		t.Fatalf("failed to create game: %s", w.Body.String())
	}

	hostToken, ok := gameResp["host_token"].(string)
	if !ok || hostToken == "" {
		t.Fatalf("expected a host_token in the create response, got %v", gameResp)
	}
	// A race has no audience, so creating one mints no read-only capability.
	if tok, present := gameResp["spectator_token"]; present && tok != "" {
		t.Fatalf("create must not hand out a spectator token, got %v", tok)
	}
	gameID := gameResp["id"].(string)

	_, joinResp := serve(t, ctx, server, jsonRequest("POST", fmt.Sprintf("/api/games/%s/join", gameID),
		map[string]interface{}{"team_name": "Red", "slot_index": 0}, ""))

	joinCode, ok := joinResp["join_code"].(string)
	if !ok || joinCode == "" {
		t.Fatalf("expected a join_code in the join response, got %v", joinResp)
	}

	return authFixture{
		gameID:     gameID,
		hostToken:  hostToken,
		teamID:     joinResp["team_id"].(string),
		teamToken:  joinResp["join_token"].(string),
		joinCode:   joinCode,
		waypointID: wStart,
	}
}

// TestGMRoutesRequireTheHostToken verifies that host authorization is required for /start, /end, and /dispute/resolve endpoints.
func TestGMRoutesRequireTheHostToken(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	defer database.Close()

	server := newTestServer(database)
	fx := seedAuthFixture(t, ctx, database, server)

	gmRoutes := []string{"start", "end", "dispute/resolve"}
	for _, route := range gmRoutes {
		path := fmt.Sprintf("/api/games/%s/%s", fx.gameID, route)

		w, _ := serve(t, ctx, server, jsonRequest("POST", path, map[string]interface{}{}, ""))
		if w.Code != http.StatusUnauthorized {
			t.Errorf("POST %s with no token: expected 401, got %d (%s)", route, w.Code, strings.TrimSpace(w.Body.String()))
		}

		// A team token is a real capability — just not this one.
		w, _ = serve(t, ctx, server, jsonRequest("POST", path, map[string]interface{}{}, fx.teamToken))
		if w.Code != http.StatusForbidden {
			t.Errorf("POST %s with a team token: expected 403, got %d (%s)", route, w.Code, strings.TrimSpace(w.Body.String()))
		}
	}

	// The host token gets past authorization. /start is the one GM route with no
	// further preconditions, so it is the one that should return 200.
	w, _ := serve(t, ctx, server, jsonRequest("POST", fmt.Sprintf("/api/games/%s/start", fx.gameID), nil, fx.hostToken))
	if w.Code != http.StatusOK {
		t.Fatalf("host token should start the game, got %d (%s)", w.Code, w.Body.String())
	}

	// GET /teams exposes join codes, so it is a GM route too.
	w, teamsResp := serve(t, ctx, server, jsonRequest("GET", fmt.Sprintf("/api/games/%s/teams", fx.gameID), nil, ""))
	if w.Code != http.StatusUnauthorized {
		t.Errorf("GET /teams with no token: expected 401, got %d", w.Code)
	}
	w, teamsResp = serve(t, ctx, server, jsonRequest("GET", fmt.Sprintf("/api/games/%s/teams", fx.gameID), nil, fx.hostToken))
	if w.Code != http.StatusOK {
		t.Fatalf("host should be able to list teams, got %d (%s)", w.Code, w.Body.String())
	}
	teams, _ := teamsResp["teams"].([]interface{})
	if len(teams) != 1 {
		t.Fatalf("expected 1 team in the host roster, got %v", teamsResp)
	}
	if teams[0].(map[string]interface{})["join_code"] != fx.joinCode {
		t.Errorf("expected the host roster to carry the team's join code, got %v", teams[0])
	}
}

// TestVerdictRequiresAGradingCapability covers S3: anyone could post a passing
// verdict for any submission id and win the race.
//
// Two capabilities open this route now — the worker's shared secret and the
// game's own host token — but which one is accepted depends on how the game is
// graded. The fixture game is graded by the model, so the host is a legitimate
// verdict author with nothing to grade here, and that is a 409 rather than a
// 403: the distinction is real and the message has to be actionable.
func TestVerdictRequiresAGradingCapability(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	defer database.Close()

	server := newTestServer(database)
	fx := seedAuthFixture(t, ctx, database, server)
	path := fmt.Sprintf("/api/games/%s/verdict", fx.gameID)
	body := map[string]interface{}{"submission_id": uuid.New().String(), "verdict": "pass"}

	w, _ := serve(t, ctx, server, jsonRequest("POST", path, body, ""))
	if w.Code != http.StatusUnauthorized {
		t.Errorf("verdict with no token: expected 401, got %d (%s)", w.Code, strings.TrimSpace(w.Body.String()))
	}

	// The one that matters: a player must never be able to grade their own
	// evidence, in any mode.
	w, _ = serve(t, ctx, server, jsonRequest("POST", path, body, fx.teamToken))
	if w.Code != http.StatusForbidden {
		t.Errorf("verdict with a team token: expected 403, got %d (%s)", w.Code, strings.TrimSpace(w.Body.String()))
	}

	w, _ = serve(t, ctx, server, jsonRequest("POST", path, body, uuid.New().String()))
	if w.Code != http.StatusForbidden {
		t.Errorf("verdict with a stranger's token: expected 403, got %d (%s)", w.Code, strings.TrimSpace(w.Body.String()))
	}

	// A host holding a real capability, on a game the model grades. Refused, but
	// as a mode conflict rather than an authorization failure.
	w, _ = serve(t, ctx, server, jsonRequest("POST", path, body, fx.hostToken))
	if w.Code != http.StatusConflict {
		t.Errorf("host verdict on an llm-graded game: expected 409, got %d (%s)", w.Code, strings.TrimSpace(w.Body.String()))
	}

	// With the right token the request gets past authorization; the submission id
	// is made up, so the handler itself reports 404.
	w, _ = serve(t, ctx, server, jsonRequest("POST", path, body, testWorkerToken))
	if w.Code != http.StatusNotFound {
		t.Errorf("verdict with the worker token: expected 404 for an unknown submission, got %d (%s)", w.Code, strings.TrimSpace(w.Body.String()))
	}
}

// TestVerdictRejectsAnyTokenWhenNoWorkerSecretIsConfigured proves the worker
// half of the route fails closed rather than open when the deployment forgot the
// secret — an empty configured token must never match an empty or arbitrary
// presented one.
//
// It no longer disables the route outright. A deployment with no LLM key at all
// is exactly the one most likely to be running host-graded races, and taking the
// route away would take hand grading with it.
func TestVerdictRejectsAnyTokenWhenNoWorkerSecretIsConfigured(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	defer database.Close()

	server := api.NewServer(database) // deliberately no worker token
	fx := seedAuthFixture(t, ctx, database, server)
	path := fmt.Sprintf("/api/games/%s/verdict", fx.gameID)
	body := map[string]interface{}{"submission_id": uuid.New().String(), "verdict": "pass"}

	for _, token := range []string{"anything", "", " "} {
		w, _ := serve(t, ctx, server, jsonRequest("POST", path, body, token))
		if w.Code == http.StatusOK || w.Code == http.StatusNotFound {
			t.Errorf("token %q was accepted as the worker with no worker secret configured: got %d (%s)",
				token, w.Code, strings.TrimSpace(w.Body.String()))
		}
	}
}

// TestPlayRoutesRequireATeamToken covers the team capability moving out of the
// request body: a body with no Authorization header is not a credential.
func TestPlayRoutesRequireATeamToken(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	defer database.Close()

	server := newTestServer(database)
	fx := seedAuthFixture(t, ctx, database, server)

	// A token in the body, the way the old client sent it, must not authenticate.
	body := map[string]interface{}{
		"team_token": fx.teamToken,
		"lat":        51.5, "lon": -0.12, "accuracy_m": 8.0,
	}
	w, _ := serve(t, ctx, server, jsonRequest("POST", fmt.Sprintf("/api/games/%s/position", fx.gameID), body, ""))
	if w.Code != http.StatusUnauthorized {
		t.Errorf("position with the token in the body: expected 401, got %d (%s)", w.Code, strings.TrimSpace(w.Body.String()))
	}

	w, _ = serve(t, ctx, server, jsonRequest("POST", fmt.Sprintf("/api/games/%s/position", fx.gameID), body, uuid.New().String()))
	if w.Code != http.StatusForbidden {
		t.Errorf("position with an unknown token: expected 403, got %d (%s)", w.Code, strings.TrimSpace(w.Body.String()))
	}
}

// TestPositionPingIsThrottledPerTeam covers S10: /position wrote on every call
// and each write fans a projection rebuild out to every subscriber.
func TestPositionPingIsThrottledPerTeam(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	defer database.Close()

	server := newTestServer(database)
	fx := seedAuthFixture(t, ctx, database, server)

	if w, _ := serve(t, ctx, server, jsonRequest("POST", fmt.Sprintf("/api/games/%s/start", fx.gameID), nil, fx.hostToken)); w.Code != http.StatusOK {
		t.Fatalf("failed to start game: %s", w.Body.String())
	}

	path := fmt.Sprintf("/api/games/%s/position", fx.gameID)
	body := map[string]interface{}{"lat": 51.5, "lon": -0.12, "accuracy_m": 8.0}

	throttled := false
	for i := 0; i < 10; i++ {
		w, _ := serve(t, ctx, server, jsonRequest("POST", path, body, fx.teamToken))
		if w.Code == http.StatusTooManyRequests {
			throttled = true
			break
		}
		if w.Code != http.StatusOK {
			t.Fatalf("unexpected status %d on position ping %d: %s", w.Code, i, w.Body.String())
		}
	}
	if !throttled {
		t.Error("expected a burst of position pings from one team to be throttled")
	}
}

// TestJoiningAnExistingTeamVerifiesASuppliedJoinCode covers what is left of S2.
//
// The original bug was that this route handed out the *first device's* join
// token to anyone who asked, which made every team impersonable by a caller who
// knew a team id. That is still fixed and still asserted below: every device
// gets its own capability, minted here, and no stored token is ever echoed.
//
// What is no longer true is that a code is required to reach the route at all.
// The race code is the trust boundary now — whoever holds it is in the race and
// may take any squad in it — because the second code was a wall between a player
// and their friends' squad, guarding a door the first code had already opened.
// A code that *is* supplied is still verified, so an invite link written before
// that changed fails if its code has since been rotated rather than silently
// succeeding.
func TestJoiningAnExistingTeamVerifiesASuppliedJoinCode(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	defer database.Close()

	server := newTestServer(database)
	fx := seedAuthFixture(t, ctx, database, server)
	path := fmt.Sprintf("/api/games/%s/teams/%s/join", fx.gameID, fx.teamID)

	// No code: the ordinary flow. It succeeds, and what comes back is this
	// device's own freshly minted capability — never the one already in play.
	w, resp := serve(t, ctx, server, jsonRequest("POST", path, map[string]interface{}{}, ""))
	if w.Code != http.StatusOK {
		t.Errorf("join with no code: expected 200, got %d — %s", w.Code, w.Body.String())
	}
	if codeless, _ := resp["join_token"].(string); codeless == "" {
		t.Error("expected a capability from a codeless join")
	} else if codeless == fx.teamToken {
		t.Error("the joining device was handed the first device's token instead of its own")
	}

	w, resp = serve(t, ctx, server, jsonRequest("POST", path, map[string]interface{}{"join_code": "WRONG1"}, ""))
	if w.Code != http.StatusForbidden {
		t.Errorf("join with a wrong code: expected 403, got %d", w.Code)
	}
	if _, leaked := resp["join_token"]; leaked {
		t.Error("join token leaked to a caller with a wrong join code")
	}

	// The right code — including a lowercase, hyphenated rendering of it — works.
	messyCode := strings.ToLower(fx.joinCode[:3] + "-" + fx.joinCode[3:])
	w, resp = serve(t, ctx, server, jsonRequest("POST", path, map[string]interface{}{"join_code": messyCode}, ""))
	if w.Code != http.StatusOK {
		t.Fatalf("join with the right code: expected 200, got %d (%s)", w.Code, w.Body.String())
	}

	// The claiming device gets its OWN capability, not a copy of the first one:
	// only digests are stored, so there is no plaintext token to hand back.
	claimed, _ := resp["join_token"].(string)
	if claimed == "" {
		t.Fatal("expected a join token for the claiming device")
	}
	if claimed == fx.teamToken {
		t.Error("the claiming device was handed the first device's token instead of its own")
	}

	// Both capabilities speak for the same team, so the teammate already racing
	// is not logged out by somebody else joining.
	for name, token := range map[string]string{"the new device": claimed, "the first device": fx.teamToken} {
		w, _ := serve(t, ctx, server, jsonRequest("GET", fmt.Sprintf("/api/games/%s/report", fx.gameID), nil, token))
		if w.Code == http.StatusUnauthorized || w.Code == http.StatusForbidden {
			t.Errorf("%s: capability rejected after the claim (%d)", name, w.Code)
		}
	}
}

// TestWebSocketRequiresACapability covers S5: the feed carries every team's live
// GPS position and used to open for anyone holding a game id.
func TestWebSocketRequiresACapability(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	defer database.Close()

	server := newTestServer(database)
	fx := seedAuthFixture(t, ctx, database, server)

	// httptest.NewRecorder cannot be hijacked, so a successful upgrade is not
	// observable here — but a rejection happens before the upgrade and is.
	// The capability rides in the subprotocol header, which is the only thing a
	// browser can put on a handshake that is not a URL.
	wsRequest := func(token string) *http.Request {
		req := httptest.NewRequest("GET", fmt.Sprintf("/api/games/%s/ws", fx.gameID), nil)
		if token != "" {
			req.Header.Set("Sec-WebSocket-Protocol", "runway.v1, runway.token."+token)
		}
		return req
	}

	cases := []struct {
		name string
		req  *http.Request
		want int
	}{
		{"no token", wsRequest(""), http.StatusUnauthorized},
		{"unknown token", wsRequest(uuid.New().String()), http.StatusUnauthorized},
		// A capability in the query string is no capability at all: it would end
		// up in proxy logs and browser history, so it is not read.
		{"a real token in the query string", httptest.NewRequest("GET", fmt.Sprintf("/api/games/%s/ws?token=%s", fx.gameID, fx.teamToken), nil), http.StatusUnauthorized},
	}
	for _, tc := range cases {
		w, _ := serve(t, ctx, server, tc.req)
		if w.Code != tc.want {
			t.Errorf("websocket with %s: expected %d, got %d (%s)", tc.name, tc.want, w.Code, strings.TrimSpace(w.Body.String()))
		}
	}

	// Both real capabilities are accepted — the failure below is the recorder
	// refusing to be hijacked, not an authorization refusal.
	for _, token := range []string{fx.teamToken, fx.hostToken} {
		w, _ := serve(t, ctx, server, wsRequest(token))
		if w.Code == http.StatusUnauthorized || w.Code == http.StatusNotFound {
			t.Errorf("websocket with a valid capability was rejected: %d (%s)", w.Code, strings.TrimSpace(w.Body.String()))
		}
	}
}

// TestCORSDoesNotReflectArbitraryOrigins covers S8.
func TestCORSDoesNotReflectArbitraryOrigins(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	defer database.Close()

	server := newTestServer(database)
	server.SetAllowedOrigins([]string{"https://race.example.com"})

	req := httptest.NewRequest("GET", "/api/boards", nil)
	req.Header.Set("Origin", "https://evil.example.net")
	w, _ := serve(t, ctx, server, req)
	if got := w.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Errorf("expected no CORS header for a disallowed origin, got %q", got)
	}

	req = httptest.NewRequest("GET", "/api/boards", nil)
	req.Header.Set("Origin", "https://race.example.com")
	w, _ = serve(t, ctx, server, req)
	if got := w.Header().Get("Access-Control-Allow-Origin"); got != "https://race.example.com" {
		t.Errorf("expected the allowed origin to be echoed, got %q", got)
	}
	if headers := w.Header().Get("Access-Control-Allow-Headers"); !strings.Contains(headers, "X-Admin-Key") {
		t.Errorf("expected Access-Control-Allow-Headers to contain X-Admin-Key, got %q", headers)
	}
	// Every method the router actually registers has to be advertised. A missing
	// one fails in a way that looks nothing like a CORS problem from the client:
	// the preflight answers 204 and the browser then blocks the real request, so
	// the app reports "Failed to fetch" and the server logs nothing at all.
	allowed := w.Header().Get("Access-Control-Allow-Methods")
	for _, method := range []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"} {
		if !strings.Contains(allowed, method) {
			t.Errorf("Access-Control-Allow-Methods %q is missing %s, which the router serves", allowed, method)
		}
	}
}

// GET /api/games/{id} has to work for a device that has only typed a race code,
// so it carries no capability requirement — which is exactly why it must not
// carry every team's strategic state either. A game id is obtainable from the
// unauthenticated race-code lookup, so standings, coins, inventory, effects and
// progress are only for a caller that proves it is in the race.
func TestPublicGameSummaryWithholdsStrategicState(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	defer database.Close()

	server := newTestServer(database)
	fx := seedAuthFixture(t, ctx, database, server)

	private := []string{"standings", "road_states", "progress", "public_log", "roadblocks", "effects", "inventory", "coins"}
	public := []string{"game_id", "board_id", "status", "mode", "race_code", "teams"}

	path := fmt.Sprintf("/api/games/%s", fx.gameID)

	_, anon := serve(t, ctx, server, jsonRequest("GET", path, nil, ""))
	for _, field := range public {
		if _, ok := anon[field]; !ok {
			t.Errorf("the lobby needs %q and it is missing", field)
		}
	}
	for _, field := range private {
		if _, leaked := anon[field]; leaked {
			t.Errorf("%q was handed to a caller holding no capability", field)
		}
	}

	for name, token := range map[string]string{"a team": fx.teamToken, "the host": fx.hostToken} {
		_, authed := serve(t, ctx, server, jsonRequest("GET", path, nil, token))
		for _, field := range private {
			if _, ok := authed[field]; !ok {
				t.Errorf("%s should still see %q", name, field)
			}
		}
	}
}
