package api_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"

	"github.com/Jessevdz/RunwayTheGame/internal/api"
	"github.com/Jessevdz/RunwayTheGame/internal/db"
)

// overviewResponse mirrors the aggregate shape the admin console reads.
type overviewResponse struct {
	Days    int    `json:"days"`
	Since   string `json:"since"`
	Enabled bool   `json:"enabled"`
	Totals  struct {
		Events     int `json:"events"`
		Sessions   int `json:"sessions"`
		ActiveDays int `json:"active_days"`
	} `json:"totals"`
	Daily []struct {
		Day      string `json:"day"`
		Events   int    `json:"events"`
		Sessions int    `json:"sessions"`
	} `json:"daily"`
	Events []struct {
		Name     string `json:"name"`
		Events   int    `json:"events"`
		Sessions int    `json:"sessions"`
	} `json:"events"`
	Breakdowns []struct {
		Name   string `json:"name"`
		Prop   string `json:"prop"`
		Values []struct {
			Value string `json:"value"`
			Count int    `json:"count"`
		} `json:"values"`
	} `json:"breakdowns"`
}

// newAnalyticsAdminServer returns a server recording analytics with an admin key
// set. The package truncates once per run, so these aggregate assertions empty
// the table themselves rather than counting rows an earlier test wrote.
func newAnalyticsAdminServer(t *testing.T) (*api.Server, *db.DB, context.Context) {
	t.Helper()
	server, database, ctx := newAnalyticsServer(t)
	server.SetRoadmapAdminKey(testAdminKey)
	if _, err := database.Pool.Exec(ctx, "TRUNCATE TABLE analytics_events"); err != nil {
		t.Fatalf("could not clear analytics_events: %v", err)
	}
	return server, database, ctx
}

// fetchOverview calls the admin overview endpoint with the admin key header.
func fetchOverview(t *testing.T, ctx context.Context, server *api.Server, query string) (*httptest.ResponseRecorder, overviewResponse) {
	t.Helper()
	req := httptest.NewRequest("GET", "/api/admin/analytics"+query, nil)
	req.Header.Set("X-Admin-Key", testAdminKey)
	w := httptest.NewRecorder()
	server.Router.ServeHTTP(w, req.WithContext(ctx))

	var body overviewResponse
	if w.Code == http.StatusOK {
		if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
			t.Fatalf("could not read the overview %q: %v", w.Body.String(), err)
		}
	}
	return w, body
}

// TestAnalyticsOverviewNeedsAnAdminCredential verifies the read path is not public.
func TestAnalyticsOverviewNeedsAnAdminCredential(t *testing.T) {
	server, _, ctx := newAnalyticsAdminServer(t)

	req := httptest.NewRequest("GET", "/api/admin/analytics", nil)
	w := httptest.NewRecorder()
	server.Router.ServeHTTP(w, req.WithContext(ctx))

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("an anonymous overview request returned %d, want %d", w.Code, http.StatusUnauthorized)
	}
}

// TestAnalyticsOverviewCountsEventsAndSessions verifies the headline aggregates.
func TestAnalyticsOverviewCountsEventsAndSessions(t *testing.T) {
	server, _, ctx := newAnalyticsAdminServer(t)

	first, second := uuid.NewString(), uuid.NewString()
	postAnalytics(t, ctx, server, `{"session_id":"`+first+`","events":[
		{"name":"app.surface_opened","props":{"surface":"landing","viewport":"mobile"}},
		{"name":"app.surface_opened","props":{"surface":"gallery","viewport":"mobile"}}
	]}`)
	postAnalytics(t, ctx, server, `{"session_id":"`+second+`","events":[
		{"name":"app.surface_opened","props":{"surface":"landing","viewport":"desktop"}},
		{"name":"editor.waypoint_added"}
	]}`)

	w, body := fetchOverview(t, ctx, server, "")
	if w.Code != http.StatusOK {
		t.Fatalf("the overview returned %d: %s", w.Code, w.Body.String())
	}

	if body.Totals.Events != 4 {
		t.Errorf("the window counted %d events, want 4", body.Totals.Events)
	}
	if body.Totals.Sessions != 2 {
		t.Errorf("the window counted %d sessions, want 2", body.Totals.Sessions)
	}
	if !body.Enabled {
		t.Error("the overview reports recording as off while it is on")
	}

	counts := map[string]int{}
	for _, event := range body.Events {
		counts[event.Name] = event.Events
	}
	if counts["app.surface_opened"] != 3 {
		t.Errorf("app.surface_opened counted %d, want 3", counts["app.surface_opened"])
	}
	if counts["editor.waypoint_added"] != 1 {
		t.Errorf("editor.waypoint_added counted %d, want 1", counts["editor.waypoint_added"])
	}
}

// TestAnalyticsOverviewFoldsDeclaredProperties verifies property values are folded by count.
func TestAnalyticsOverviewFoldsDeclaredProperties(t *testing.T) {
	server, _, ctx := newAnalyticsAdminServer(t)

	session := uuid.NewString()
	postAnalytics(t, ctx, server, `{"session_id":"`+session+`","events":[
		{"name":"app.surface_opened","props":{"surface":"landing"}},
		{"name":"app.surface_opened","props":{"surface":"landing"}},
		{"name":"app.surface_opened","props":{"surface":"gallery"}}
	]}`)

	_, body := fetchOverview(t, ctx, server, "")

	var surfaces map[string]int
	for _, breakdown := range body.Breakdowns {
		if breakdown.Name != "app.surface_opened" || breakdown.Prop != "surface" {
			continue
		}
		surfaces = map[string]int{}
		for _, value := range breakdown.Values {
			surfaces[value.Value] = value.Count
		}
		// The busiest value is reported first, which is what the bars rely on.
		if breakdown.Values[0].Value != "landing" {
			t.Errorf("the breakdown leads with %q, want the busiest value first", breakdown.Values[0].Value)
		}
	}

	if surfaces == nil {
		t.Fatal("the overview returned no surface breakdown")
	}
	if surfaces["landing"] != 2 || surfaces["gallery"] != 1 {
		t.Errorf("surfaces folded to %v, want landing 2 and gallery 1", surfaces)
	}
}

// TestAnalyticsOverviewWindowIsClamped verifies the day window never exceeds retention.
func TestAnalyticsOverviewWindowIsClamped(t *testing.T) {
	server, _, ctx := newAnalyticsAdminServer(t)

	for _, tc := range []struct {
		query string
		want  int
	}{
		{"", 30},
		{"?days=7", 7},
		{"?days=0", 30},
		{"?days=nonsense", 30},
		{"?days=100000", api.AnalyticsRetentionDays},
	} {
		_, body := fetchOverview(t, ctx, server, tc.query)
		if body.Days != tc.want {
			t.Errorf("a window of %q resolved to %d days, want %d", tc.query, body.Days, tc.want)
		}
		if len(body.Daily) != tc.want {
			t.Errorf("a window of %q returned %d daily rows, want %d", tc.query, len(body.Daily), tc.want)
		}
	}
}

// TestAnalyticsRetentionSweepDropsOldEvents verifies events past the window are deleted.
func TestAnalyticsRetentionSweepDropsOldEvents(t *testing.T) {
	server, database, ctx := newAnalyticsAdminServer(t)

	fresh, stale := uuid.NewString(), uuid.NewString()
	postAnalytics(t, ctx, server, `{"session_id":"`+fresh+`","events":[{"name":"editor.waypoint_added"}]}`)
	postAnalytics(t, ctx, server, `{"session_id":"`+stale+`","events":[{"name":"editor.waypoint_added"}]}`)

	// Age one row past the retention window without touching the other.
	if _, err := database.Pool.Exec(ctx, `
		UPDATE analytics_events
		   SET occurred_on = occurred_on - $1::integer - 1,
		       occurred_at = occurred_at - make_interval(days => $1 + 1)
		 WHERE session_id = $2
	`, api.AnalyticsRetentionDays, stale); err != nil {
		t.Fatalf("could not age the stale event: %v", err)
	}

	server.SweepRetention(ctx)

	if n := countAnalyticsRows(t, ctx, database, stale); n != 0 {
		t.Errorf("the sweep left %d expired analytics rows, want 0", n)
	}
	if n := countAnalyticsRows(t, ctx, database, fresh); n != 1 {
		t.Errorf("the sweep deleted a row inside the window: %d remain, want 1", n)
	}
}
