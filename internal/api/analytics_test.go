package api_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sort"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/Jessevdz/RunwayTheGame/internal/api"
	"github.com/Jessevdz/RunwayTheGame/internal/db"
)

// postAnalytics sends a raw text/plain request body to simulate sendBeacon payloads.
func postAnalytics(t *testing.T, ctx context.Context, server *api.Server, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest("POST", "/api/analytics", strings.NewReader(body))
	req.Header.Set("Content-Type", "text/plain;charset=UTF-8")
	w := httptest.NewRecorder()
	server.Router.ServeHTTP(w, req.WithContext(ctx))
	return w
}

func analyticsReceipt(t *testing.T, w *httptest.ResponseRecorder) (accepted, dropped int) {
	t.Helper()
	var got map[string]int
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatalf("could not read the receipt %q: %v", w.Body.String(), err)
	}
	return got["accepted"], got["dropped"]
}

// countAnalyticsRows counts analytics_events rows for a specific session ID.
func countAnalyticsRows(t *testing.T, ctx context.Context, database *db.DB, session string) int {
	t.Helper()
	var n int
	if err := database.Pool.QueryRow(ctx,
		"SELECT COUNT(*) FROM analytics_events WHERE session_id = $1", session).Scan(&n); err != nil {
		t.Fatalf("could not count analytics_events: %v", err)
	}
	return n
}

func newAnalyticsServer(t *testing.T) (*api.Server, *db.DB, context.Context) {
	t.Helper()
	database, ctx := getTestDB(t)
	server := newTestServer(database)
	server.SetAnalyticsEnabled(true)
	return server, database, ctx
}

// TestAnalyticsIsOffUntilTheOperatorAsksForIt verifies analytics remains disabled by default.
func TestAnalyticsIsOffUntilTheOperatorAsksForIt(t *testing.T) {
	database, ctx := getTestDB(t)
	server := newTestServer(database) // SetAnalyticsEnabled deliberately not called

	session := uuid.New().String()
	body := `{"session_id":"` + session + `","events":[{"name":"editor.waypoint_added"}]}`
	w := postAnalytics(t, ctx, server, body)

	if w.Code != http.StatusNoContent {
		t.Fatalf("expected 204 from a deployment with analytics off, got %d: %s", w.Code, w.Body.String())
	}
	if n := countAnalyticsRows(t, ctx, database, session); n != 0 {
		t.Errorf("a deployment with analytics off wrote %d rows", n)
	}
	// The refusal must be indistinguishable from success, so this route cannot
	// be used to probe how an instance is configured.
	if w.Body.Len() != 0 {
		t.Errorf("a disabled deployment explained itself: %q", w.Body.String())
	}
}

func TestAnalyticsAcceptsABatchAndReportsWhatItStored(t *testing.T) {
	server, database, ctx := newAnalyticsServer(t)

	session := uuid.New().String()
	body := `{"session_id":"` + session + `","events":[
		{"name":"app.surface_opened","props":{"surface":"design","viewport":"desktop"}},
		{"name":"editor.waypoint_added"},
		{"name":"editor.tool_selected","props":{"tool":"road","via":"key"}}
	]}`

	w := postAnalytics(t, ctx, server, body)
	if w.Code != http.StatusAccepted {
		t.Fatalf("expected 202, got %d: %s", w.Code, w.Body.String())
	}
	accepted, dropped := analyticsReceipt(t, w)
	if accepted != 3 || dropped != 0 {
		t.Fatalf("expected 3 accepted and 0 dropped, got %d and %d", accepted, dropped)
	}
	if n := countAnalyticsRows(t, ctx, database, session); n != 3 {
		t.Fatalf("expected 3 rows, got %d", n)
	}

	// The server assigns the day and the timestamp; a client clock is a skew bug
	// and a fingerprinting vector, so neither is read off the wire.
	var name, props string
	var sameDay bool
	err := database.Pool.QueryRow(ctx, `
		SELECT name, props::text, occurred_on = (NOW() AT TIME ZONE 'utc')::date
		  FROM analytics_events
		 WHERE session_id = $1 AND name = 'editor.tool_selected'`, session).Scan(&name, &props, &sameDay)
	if err != nil {
		t.Fatalf("could not read the stored row: %v", err)
	}
	if !sameDay {
		t.Error("occurred_on was not the server's UTC day")
	}
	if !strings.Contains(props, `"tool": "road"`) && !strings.Contains(props, `"tool":"road"`) {
		t.Errorf("declared properties were not stored: %s", props)
	}
}

// TestAnalyticsDropsUnknownEventsWithoutFailingTheBatch verifies unknown events are dropped without rejecting the batch.
func TestAnalyticsDropsUnknownEventsWithoutFailingTheBatch(t *testing.T) {
	server, database, ctx := newAnalyticsServer(t)

	session := uuid.New().String()
	body := `{"session_id":"` + session + `","events":[
		{"name":"editor.waypoint_added"},
		{"name":"editor.invented_next_release","props":{"anything":"at all"}},
		{"name":"board.forked"}
	]}`

	w := postAnalytics(t, ctx, server, body)
	if w.Code != http.StatusAccepted {
		t.Fatalf("expected 202 despite an unknown event, got %d: %s", w.Code, w.Body.String())
	}
	accepted, dropped := analyticsReceipt(t, w)
	if accepted != 2 || dropped != 1 {
		t.Errorf("expected 2 accepted and 1 dropped, got %d and %d", accepted, dropped)
	}
	if n := countAnalyticsRows(t, ctx, database, session); n != 2 {
		t.Errorf("expected the unknown event not to be stored, got %d rows", n)
	}
}

// TestAnalyticsStoresNothingUndeclared verifies the HTTP handler filters out undeclared event properties.
func TestAnalyticsStoresNothingUndeclared(t *testing.T) {
	server, database, ctx := newAnalyticsServer(t)

	session := uuid.New().String()
	body := `{"session_id":"` + session + `","events":[{
		"name":"editor.tool_selected",
		"props":{
			"tool":"waypoint",
			"via":"click",
			"board_name":"the route through the park",
			"prompt":"photograph the statue in the square",
			"lat":51.5074,
			"lng":-0.1278,
			"edit_token":"6f3a-not-a-secret-any-more"
		}
	}]}`

	if w := postAnalytics(t, ctx, server, body); w.Code != http.StatusAccepted {
		t.Fatalf("expected 202, got %d: %s", w.Code, w.Body.String())
	}

	var props string
	if err := database.Pool.QueryRow(ctx,
		"SELECT props::text FROM analytics_events WHERE session_id = $1", session).Scan(&props); err != nil {
		t.Fatalf("could not read the stored row: %v", err)
	}
	for _, leaked := range []string{"park", "statue", "51.5", "-0.12", "6f3a", "board_name", "prompt", "lat", "lng", "edit_token"} {
		if strings.Contains(props, leaked) {
			t.Errorf("undeclared content %q reached the database: %s", leaked, props)
		}
	}
	if !strings.Contains(props, "waypoint") || !strings.Contains(props, "click") {
		t.Errorf("declared properties were lost: %s", props)
	}
}

func TestAnalyticsRejectsMalformedBatches(t *testing.T) {
	server, database, ctx := newAnalyticsServer(t)
	session := uuid.New().String()

	// 400 is reserved for what is unambiguously a client bug.
	cases := map[string]string{
		"not json":            `{"session_id":`,
		"no session id":       `{"events":[{"name":"board.forked"}]}`,
		"session id not uuid": `{"session_id":"nope","events":[{"name":"board.forked"}]}`,
		"empty batch":         `{"session_id":"` + session + `","events":[]}`,
		"oversized batch":     `{"session_id":"` + session + `","events":[` + strings.Repeat(`{"name":"board.forked"},`, 25) + `{"name":"board.forked"}]}`,
		// A field beside the events is how somebody would try to smuggle a value
		// past the property allowlist. The envelope is closed.
		"unknown envelope field": `{"session_id":"` + session + `","user_agent":"Mozilla/5.0","events":[{"name":"board.forked"}]}`,
	}

	for label, body := range cases {
		t.Run(label, func(t *testing.T) {
			if w := postAnalytics(t, ctx, server, body); w.Code != http.StatusBadRequest {
				t.Errorf("expected 400, got %d: %s", w.Code, w.Body.String())
			}
		})
	}
	if n := countAnalyticsRows(t, ctx, database, session); n != 0 {
		t.Errorf("a malformed batch wrote %d rows", n)
	}
}

func TestAnalyticsRateLimitsOneCaller(t *testing.T) {
	server, _, ctx := newAnalyticsServer(t)
	body := `{"session_id":"` + uuid.New().String() + `","events":[{"name":"board.forked"}]}`

	// Burst is 20; the global limiter above it allows 60. Somewhere inside 40
	// requests from one address the analytics bucket must run dry.
	limited := false
	for i := 0; i < 40; i++ {
		if postAnalytics(t, ctx, server, body).Code == http.StatusTooManyRequests {
			limited = true
			break
		}
	}
	if !limited {
		t.Error("an unauthenticated caller was never rate-limited")
	}
}

// TestAnalyticsEventsHasNoIdentifyingColumns verifies analytics_events contains no PII columns.
func TestAnalyticsEventsHasNoIdentifyingColumns(t *testing.T) {
	database, ctx := getTestDB(t)

	rows, err := database.Pool.Query(ctx, `
		SELECT column_name FROM information_schema.columns
		 WHERE table_name = 'analytics_events'`)
	if err != nil {
		t.Fatalf("could not read the column list: %v", err)
	}
	defer rows.Close()

	var got []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			t.Fatalf("could not scan a column name: %v", err)
		}
		got = append(got, name)
	}
	sort.Strings(got)

	want := []string{"name", "occurred_at", "occurred_on", "props", "session_id"}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Errorf("analytics_events columns are %v, want exactly %v.\n"+
			"If this is a deliberate addition, it is a privacy decision and not a "+
			"schema change: update PRIVACY.md and the Art. 30 record in "+
			"docs/privacy-operations.md §1 in the same commit.", got, want)
	}
}
