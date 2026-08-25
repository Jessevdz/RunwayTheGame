package api_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"

	"github.com/Jessevdz/RunwayTheGame/internal/api"
	"github.com/Jessevdz/RunwayTheGame/internal/db"
	"github.com/Jessevdz/RunwayTheGame/internal/projections"
)

// A live GPS fix is the most sensitive thing this server holds: it says where a
// person physically is, right now. PRIVACY.md makes four promises about it that
// are cheap to break by accident, so each one is pinned here.
//
//	§1/§4  it reaches the other players in the race and nobody else
//	§4     a race code alone buys the lobby, and explicitly "no position"
//	§6     the feed is authenticated per race and per capability
//	§2.1   one fix per team, overwritten, never a trail
//	§3     positions die when the race ends, not at the 30-day sweep
//
// The distinction the code draws, and that these tests defend, is that the REST
// surface never carries a position at all — the socket is the only way out, and
// it is the one door with a capability check on it.

// twoTeamRace is a started race with two squads, each having reported a fix.
type twoTeamRace struct {
	gameID    string
	hostToken string
	redID     string
	redToken  string
	blueID    string
	blueToken string
}

// redLat and friends are deliberately implausible as a board location so that a
// substring search for them in a response body cannot match anything else.
const (
	redLat  = 51.523456
	redLon  = -0.123456
	blueLat = 48.876543
	blueLon = 2.345678
)

func seedTwoTeamRace(t *testing.T, ctx context.Context, database *db.DB, server *api.Server) twoTeamRace {
	t.Helper()
	fx := seedAuthFixture(t, ctx, database, server)

	_, blue := serve(t, ctx, server, jsonRequest("POST", fmt.Sprintf("/api/games/%s/join", fx.gameID),
		map[string]interface{}{"team_name": "Blue", "slot_index": 1}, ""))
	blueToken, _ := blue["join_token"].(string)
	blueID, _ := blue["team_id"].(string)
	if blueToken == "" || blueID == "" {
		t.Fatalf("failed to join a second squad: %v", blue)
	}

	if w, _ := serve(t, ctx, server, jsonRequest("POST", fmt.Sprintf("/api/games/%s/start", fx.gameID), nil, fx.hostToken)); w.Code != http.StatusOK {
		t.Fatalf("failed to start the race: %s", w.Body.String())
	}

	race := twoTeamRace{
		gameID: fx.gameID, hostToken: fx.hostToken,
		redID: fx.teamID, redToken: fx.teamToken,
		blueID: blueID, blueToken: blueToken,
	}

	for _, ping := range []struct {
		token    string
		lat, lon float64
	}{{race.redToken, redLat, redLon}, {race.blueToken, blueLat, blueLon}} {
		w, _ := serve(t, ctx, server, jsonRequest("POST", fmt.Sprintf("/api/games/%s/position", race.gameID),
			map[string]interface{}{"lat": ping.lat, "lon": ping.lon, "accuracy_m": 8.0}, ping.token))
		if w.Code != http.StatusOK {
			t.Fatalf("failed to record a position: %d %s", w.Code, w.Body.String())
		}
	}
	return race
}

// coordinatesIn reports which of the seeded coordinates appear anywhere in a
// response body. Searching the raw text rather than a decoded field means a
// position that reappears under a new name, or nested inside another object,
// is still caught.
func coordinatesIn(body string) []string {
	var found []string
	for name, value := range map[string]float64{
		"red lat": redLat, "red lon": redLon,
		"blue lat": blueLat, "blue lon": blueLon,
	} {
		if strings.Contains(body, fmt.Sprintf("%g", value)) {
			found = append(found, name)
		}
	}
	return found
}

// TestPositionsNeverLeaveTheRESTSurface is the structural half of the guarantee.
//
// GET /api/games/{id} has to answer a device that has only typed a race code, so
// it cannot require a capability — which is exactly why PRIVACY.md §4 promises a
// race-code holder "no position". The handler keeps that promise by building the
// subscriber view out of a named struct (gameLiveState) that has no position
// field, rather than by marshalling the projection and deleting things. This
// test fails the moment someone widens that struct, in any of the three
// capability states, which is the mistake worth catching early.
func TestPositionsNeverLeaveTheRESTSurface(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	defer database.Close()

	server := newTestServer(database)
	race := seedTwoTeamRace(t, ctx, database, server)

	// The fixes really are recorded, so "absent below" means withheld rather
	// than never written.
	proj, err := projections.RebuildProjection(ctx, database.Pool, race.gameID, 0)
	if err != nil {
		t.Fatalf("failed to rebuild the projection: %v", err)
	}
	if len(proj.Positions) != 2 {
		t.Fatalf("expected both squads to have a position on the projection, got %d", len(proj.Positions))
	}

	summary := fmt.Sprintf("/api/games/%s", race.gameID)
	report := fmt.Sprintf("/api/games/%s/report", race.gameID)

	cases := []struct {
		name  string
		path  string
		token string
	}{
		{"a stranger holding only the game id", summary, ""},
		{"a racing squad", summary, race.redToken},
		{"the host", summary, race.hostToken},
		{"a racing squad reading the report", report, race.redToken},
		{"the host reading the report", report, race.hostToken},
	}

	for _, tc := range cases {
		w, decoded := serve(t, ctx, server, jsonRequest("GET", tc.path, nil, tc.token))
		if w.Code != http.StatusOK {
			t.Fatalf("%s: expected 200, got %d (%s)", tc.name, w.Code, strings.TrimSpace(w.Body.String()))
		}
		if _, leaked := decoded["positions"]; leaked {
			t.Errorf("%s: the response carries a \"positions\" key", tc.name)
		}
		if found := coordinatesIn(w.Body.String()); len(found) > 0 {
			t.Errorf("%s: live coordinates reached a REST response (%s)", tc.name, strings.Join(found, ", "))
		}
	}

	// The race-code lookup is the unauthenticated door a player comes in
	// through, so it gets the same treatment.
	var raceCode string
	if err := database.Pool.QueryRow(ctx, `SELECT race_code FROM games WHERE id = $1`, race.gameID).Scan(&raceCode); err != nil {
		t.Fatalf("failed to read the race code: %v", err)
	}
	w, decoded := serve(t, ctx, server, jsonRequest("GET", "/api/games/by-code/"+raceCode, nil, ""))
	if w.Code != http.StatusOK {
		t.Fatalf("race code lookup: expected 200, got %d (%s)", w.Code, strings.TrimSpace(w.Body.String()))
	}
	if _, leaked := decoded["positions"]; leaked {
		t.Error("the race code lookup carries a \"positions\" key")
	}
	if found := coordinatesIn(w.Body.String()); len(found) > 0 {
		t.Errorf("the race code lookup leaked coordinates (%s)", strings.Join(found, ", "))
	}
}

// TestLivePositionFeedIsCapabilityGatedEndToEnd is the other half: the socket is
// the one surface that does carry GPS, so it is worth proving over a real
// connection rather than a recorder.
//
// TestWebSocketRequiresACapability already covers the handshake refusals, but a
// recorder cannot be hijacked, so it can never observe what an accepted socket
// actually sends. This one dials for real and reads the frame — which is the
// only way to show both that a stranger gets nothing and that the feed a player
// does get is the one the game needs.
func TestLivePositionFeedIsCapabilityGatedEndToEnd(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	defer database.Close()

	server := newTestServer(database)
	server.SetAllowedOrigins([]string{"*"})
	race := seedTwoTeamRace(t, ctx, database, server)

	httpServer := httptest.NewServer(server.Router)
	defer httpServer.Close()
	wsURL := "ws" + strings.TrimPrefix(httpServer.URL, "http") + fmt.Sprintf("/api/games/%s/ws", race.gameID)

	dial := func(token string) (*websocket.Conn, *http.Response, error) {
		dialer := *websocket.DefaultDialer
		dialer.HandshakeTimeout = 5 * time.Second
		if token != "" {
			dialer.Subprotocols = []string{"runway.v1", "runway.token." + token}
		} else {
			dialer.Subprotocols = []string{"runway.v1"}
		}
		return dialer.Dial(wsURL, nil)
	}

	// A stranger never reaches the feed, so there is nothing to filter.
	for _, tc := range []struct {
		name  string
		token string
	}{
		{"no capability at all", ""},
		{"a made-up capability", uuid.New().String()},
	} {
		conn, resp, err := dial(tc.token)
		if err == nil {
			conn.Close()
			t.Errorf("%s: the socket opened and it must not have", tc.name)
			continue
		}
		if resp == nil || resp.StatusCode != http.StatusUnauthorized {
			status := "no response"
			if resp != nil {
				status = resp.Status
			}
			t.Errorf("%s: expected the handshake to be refused with 401, got %s", tc.name, status)
		}
	}

	// A squad in the race gets the feed, and it carries the other squad's fix —
	// which is the game, and what §1 and §4 tell a player at join time.
	conn, _, err := dial(race.redToken)
	if err != nil {
		t.Fatalf("a racing squad was refused its own feed: %v", err)
	}
	defer conn.Close()

	conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	_, payload, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("failed to read the first frame: %v", err)
	}

	var snapshot projections.GameStateProjection
	if err := json.Unmarshal(payload, &snapshot); err != nil {
		t.Fatalf("the feed did not carry a projection: %v", err)
	}
	blue, ok := snapshot.Positions[race.blueID]
	if !ok {
		t.Fatalf("expected the feed to carry the other squad's position, got %+v", snapshot.Positions)
	}
	if blue.Lat != blueLat || blue.Lon != blueLon {
		t.Errorf("expected the other squad at (%v, %v), got (%v, %v)", blueLat, blueLon, blue.Lat, blue.Lon)
	}

	// The host's console is fed by the same socket and the same check.
	hostConn, _, err := dial(race.hostToken)
	if err != nil {
		t.Fatalf("the host was refused the feed: %v", err)
	}
	defer hostConn.Close()
}

// TestEndingTheRaceDeletesPositions pins PRIVACY.md §3: a live position is not
// covered by the 30-day sweep, it goes when the race does. Nothing about a
// finished race needs to know where anybody was standing, and the row is the
// only copy — the event log deliberately holds no trail — so deleting it is
// what makes "we do not build a location history" true rather than aspirational.
func TestEndingTheRaceDeletesPositions(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	defer database.Close()

	server := newTestServer(database)
	race := seedTwoTeamRace(t, ctx, database, server)

	countPositions := func() int {
		t.Helper()
		var n int
		if err := database.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM team_positions WHERE game_id = $1`, race.gameID).Scan(&n); err != nil {
			t.Fatalf("failed to count positions: %v", err)
		}
		return n
	}

	if n := countPositions(); n != 2 {
		t.Fatalf("expected 2 stored positions while the race is live, got %d", n)
	}

	// One row per team, overwritten in place — §2.1's "no trail". A second fix
	// from the same squad must not add a row.
	w, _ := serve(t, ctx, server, jsonRequest("POST", fmt.Sprintf("/api/games/%s/position", race.gameID),
		map[string]interface{}{"lat": 51.6, "lon": -0.2, "accuracy_m": 9.0}, race.redToken))
	if w.Code != http.StatusOK {
		t.Fatalf("failed to record a second fix: %d %s", w.Code, w.Body.String())
	}
	if n := countPositions(); n != 2 {
		t.Errorf("a second fix from the same squad added a row: expected 2, got %d", n)
	}

	if w, _ := serve(t, ctx, server, jsonRequest("POST", fmt.Sprintf("/api/games/%s/end", race.gameID), nil, race.hostToken)); w.Code != http.StatusOK {
		t.Fatalf("failed to end the race: %s", w.Body.String())
	}

	server.SweepRetention(ctx)

	if n := countPositions(); n != 0 {
		t.Errorf("expected every position to be deleted when the race ended, %d remain", n)
	}

	proj, err := projections.RebuildProjection(ctx, database.Pool, race.gameID, 0)
	if err != nil {
		t.Fatalf("failed to rebuild the projection: %v", err)
	}
	if len(proj.Positions) != 0 {
		t.Errorf("the projection still carries positions after the race ended: %+v", proj.Positions)
	}
}
