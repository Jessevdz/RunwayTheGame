package api_test

import (
	"net/http"
	"strings"
	"testing"

	"github.com/google/uuid"
)

// bugContext builds a valid diagnostic context payload for a report.
func bugContext() map[string]interface{} {
	return map[string]interface{}{
		"route":       "/race/abc-123",
		"viewport":    "mobile",
		"screen":      "390x844",
		"user_agent":  "Mozilla/5.0 (iPhone)",
		"app_version": "deadbee",
		"online":      true,
		"errors":      []string{"[10:02:11] error: boom (app.js:14)"},
		"occurred_at": "2026-08-20T10:02:12.000Z",
	}
}

func TestBugReport_FileAndTriage(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	server := newTestServer(database)
	server.SetRoadmapAdminKey(testAdminKey)
	reporter := uuid.New().String()

	// Filing needs no credential at all: a tester in the field has none.
	createReq := jsonRequest("POST", "/api/bug-reports", map[string]interface{}{
		"summary":  "Finish button does nothing",
		"details":  "Tapped twice, timer kept running.",
		"severity": "blocker",
		"context":  bugContext(),
	}, "")
	createReq.Header.Set("X-Voter-ID", reporter)
	w, createResp := serve(t, ctx, server, createReq)
	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created, got %d: %s", w.Code, w.Body.String())
	}
	reportID, _ := createResp["id"].(string)
	if reportID == "" {
		t.Fatalf("expected a report id, got %v", createResp)
	}
	// The reporter is told it landed and nothing else.
	if _, leaked := createResp["context"]; leaked {
		t.Fatalf("create response must not echo the stored context: %v", createResp)
	}

	// Reading reports back is admin-only.
	anonList := jsonRequest("GET", "/api/bug-reports", nil, "")
	if w, _ := serve(t, ctx, server, anonList); w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for an anonymous list, got %d", w.Code)
	}

	listReq := jsonRequest("GET", "/api/bug-reports", nil, "")
	listReq.Header.Set("X-Admin-Key", testAdminKey)
	w, list := serveSlice(t, ctx, server, listReq)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d: %s", w.Code, w.Body.String())
	}

	var found map[string]interface{}
	for _, item := range list {
		if item["id"] == reportID {
			found = item
			break
		}
	}
	if found == nil {
		t.Fatalf("filed report %s missing from the admin list", reportID)
	}
	// A lowercase severity is normalised, not rejected.
	if found["severity"] != "BLOCKER" {
		t.Fatalf("expected severity BLOCKER, got %v", found["severity"])
	}
	if found["status"] != "NEW" {
		t.Fatalf("expected a new report to be NEW, got %v", found["status"])
	}
	storedCtx, ok := found["context"].(map[string]interface{})
	if !ok {
		t.Fatalf("expected a context object, got %T", found["context"])
	}
	if storedCtx["route"] != "/race/abc-123" {
		t.Fatalf("expected the route to survive the round trip, got %v", storedCtx["route"])
	}

	// Triage moves it along.
	updateReq := jsonRequest("PUT", "/api/bug-reports/"+reportID, map[string]interface{}{"status": "triaged"}, "")
	updateReq.Header.Set("X-Admin-Key", testAdminKey)
	w, updated := serve(t, ctx, server, updateReq)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on update, got %d: %s", w.Code, w.Body.String())
	}
	if updated["status"] != "TRIAGED" {
		t.Fatalf("expected TRIAGED, got %v", updated["status"])
	}

	deleteReq := jsonRequest("DELETE", "/api/bug-reports/"+reportID, nil, "")
	deleteReq.Header.Set("X-Admin-Key", testAdminKey)
	if w, _ := serve(t, ctx, server, deleteReq); w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on delete, got %d: %s", w.Code, w.Body.String())
	}
}

func TestBugReport_RejectsBadInput(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	server := newTestServer(database)

	cases := []struct {
		name string
		body map[string]interface{}
	}{
		{"empty summary", map[string]interface{}{"summary": "  ", "context": bugContext()}},
		{"summary too short", map[string]interface{}{"summary": "ab", "context": bugContext()}},
		{"unknown severity", map[string]interface{}{"summary": "something broke", "severity": "CATASTROPHIC"}},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := jsonRequest("POST", "/api/bug-reports", tc.body, "")
			if w, _ := serve(t, ctx, server, req); w.Code != http.StatusBadRequest {
				t.Fatalf("expected 400 for %s, got %d: %s", tc.name, w.Code, w.Body.String())
			}
		})
	}
}

// TestBugReport_ContextIsClosed asserts that a client cannot smuggle fields the
// server never declared into the stored context, and that the fields it does
// declare are bounded.
func TestBugReport_ContextIsClosed(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	server := newTestServer(database)
	server.SetRoadmapAdminKey(testAdminKey)

	dirty := bugContext()
	dirty["lat"] = 51.5074
	dirty["lon"] = -0.1278
	dirty["photo_url"] = "https://example.invalid/evidence.jpg"
	dirty["user_agent"] = strings.Repeat("A", 5000)
	dirty["errors"] = []string{
		"one", "two", "three", "four", "five",
		"six", "seven", "eight", "nine", "ten",
		"eleven", "twelve",
	}

	createReq := jsonRequest("POST", "/api/bug-reports", map[string]interface{}{
		"summary": "context hardening probe",
		"context": dirty,
	}, "")
	w, createResp := serve(t, ctx, server, createReq)
	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created, got %d: %s", w.Code, w.Body.String())
	}
	reportID := createResp["id"].(string)

	listReq := jsonRequest("GET", "/api/bug-reports", nil, "")
	listReq.Header.Set("X-Admin-Key", testAdminKey)
	_, list := serveSlice(t, ctx, server, listReq)

	var stored map[string]interface{}
	for _, item := range list {
		if item["id"] == reportID {
			stored = item["context"].(map[string]interface{})
			break
		}
	}
	if stored == nil {
		t.Fatalf("report %s not found", reportID)
	}

	for _, banned := range []string{"lat", "lon", "photo_url"} {
		if _, present := stored[banned]; present {
			t.Fatalf("undeclared field %q reached the stored context: %v", banned, stored)
		}
	}
	if ua, _ := stored["user_agent"].(string); len(ua) > 400 {
		t.Fatalf("user_agent was not clamped: %d runes", len(ua))
	}
	if errs, _ := stored["errors"].([]interface{}); len(errs) > 10 {
		t.Fatalf("expected at most 10 captured errors, got %d", len(errs))
	}
}
