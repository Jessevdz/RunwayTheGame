package api_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"

	"github.com/Jessevdz/RunwayTheGame/internal/api"
)

const testAdminKey = "admin-secret-guid-session-tests"

// adminSignIn spends the admin key for a session, returning the cookie the
// browser would keep and the CSRF token the page would echo.
func adminSignIn(t *testing.T, server *api.Server, key, remoteAddr string) (*http.Cookie, string) {
	t.Helper()

	req := jsonRequest("POST", "/api/admin/session", map[string]string{"key": key}, "")
	if remoteAddr != "" {
		req.RemoteAddr = remoteAddr
	}
	w := httptest.NewRecorder()
	server.Router.ServeHTTP(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created for admin sign-in, got %d: %s", w.Code, w.Body.String())
	}

	var session struct {
		Valid     bool   `json:"valid"`
		CSRFToken string `json:"csrf_token"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &session); err != nil {
		t.Fatalf("failed to decode the sign-in response: %v", err)
	}
	if !session.Valid || session.CSRFToken == "" {
		t.Fatalf("expected a valid session carrying a CSRF token, got %+v", session)
	}

	for _, c := range w.Result().Cookies() {
		if c.Name == "runway_admin_session" {
			if !c.HttpOnly {
				t.Fatal("admin session cookie must be HttpOnly: script must not be able to read it")
			}
			if c.SameSite != http.SameSiteStrictMode {
				t.Fatalf("expected SameSite=Strict by default, got %v", c.SameSite)
			}
			return c, session.CSRFToken
		}
	}
	t.Fatal("sign-in returned no session cookie")
	return nil, ""
}

// TestAdminSession_KeyNeverNeedsToTravelInAURL walks the whole exchange: the
// key buys a session in a POST body, the session then authorizes a read, a
// write signed with its CSRF token, and nothing after sign-out.
func TestAdminSession_KeyNeverNeedsToTravelInAURL(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	server := newTestServer(database)
	server.SetRoadmapAdminKey(testAdminKey)

	cookie, csrf := adminSignIn(t, server, testAdminKey, "")

	// An item to curate, created by an ordinary anonymous visitor.
	w, created := serve(t, ctx, server, jsonRequest("POST", "/api/roadmap", map[string]interface{}{
		"title":       "Session Test Idea " + uuid.New().String()[:8],
		"description": "Created anonymously, curated with a session",
	}, ""))
	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created, got %d: %s", w.Code, w.Body.String())
	}
	itemID := created["id"].(string)

	// A read needs the cookie alone.
	verifyReq := jsonRequest("GET", "/api/admin/verify", nil, "")
	verifyReq.AddCookie(cookie)
	if w, _ = serve(t, ctx, server, verifyReq); w.Code != http.StatusOK {
		t.Fatalf("expected the session to verify, got %d: %s", w.Code, w.Body.String())
	}

	// A write needs the cookie and the CSRF token minted with it.
	updateReq := jsonRequest("PUT", "/api/roadmap/"+itemID, map[string]interface{}{"status": "PLANNED"}, "")
	updateReq.AddCookie(cookie)
	updateReq.Header.Set("X-Admin-CSRF", csrf)
	w, updated := serve(t, ctx, server, updateReq)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for a session-authorized update, got %d: %s", w.Code, w.Body.String())
	}
	if updated["status"] != "PLANNED" {
		t.Fatalf("expected status PLANNED, got %v", updated)
	}

	// Signing out ends it.
	signOutReq := jsonRequest("DELETE", "/api/admin/session", nil, "")
	signOutReq.AddCookie(cookie)
	if w, _ = serve(t, ctx, server, signOutReq); w.Code != http.StatusNoContent {
		t.Fatalf("expected 204 No Content for sign-out, got %d: %s", w.Code, w.Body.String())
	}

	afterReq := jsonRequest("GET", "/api/admin/verify", nil, "")
	afterReq.AddCookie(cookie)
	if w, _ = serve(t, ctx, server, afterReq); w.Code != http.StatusUnauthorized {
		t.Fatalf("expected the revoked session to be rejected, got %d", w.Code)
	}
}

// TestAdminSession_WriteWithoutCSRFTokenIsRejected covers the case the cookie
// exists for: another site can make the browser send it, but cannot read the
// token that has to come with it.
func TestAdminSession_WriteWithoutCSRFTokenIsRejected(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	server := newTestServer(database)
	server.SetRoadmapAdminKey(testAdminKey)

	cookie, csrf := adminSignIn(t, server, testAdminKey, "")

	w, created := serve(t, ctx, server, jsonRequest("POST", "/api/roadmap", map[string]interface{}{
		"title":       "CSRF Test Idea " + uuid.New().String()[:8],
		"description": "Should survive a forged cross-site write",
	}, ""))
	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created, got %d: %s", w.Code, w.Body.String())
	}
	itemID := created["id"].(string)

	// The cookie rides along, as it would on a cross-site request. Nothing else does.
	forged := jsonRequest("DELETE", "/api/roadmap/"+itemID, nil, "")
	forged.AddCookie(cookie)
	if w, _ = serve(t, ctx, server, forged); w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for a write with no CSRF token, got %d: %s", w.Code, w.Body.String())
	}

	// A wrong token is no better than none.
	wrongToken := jsonRequest("DELETE", "/api/roadmap/"+itemID, nil, "")
	wrongToken.AddCookie(cookie)
	wrongToken.Header.Set("X-Admin-CSRF", "not-the-token")
	if w, _ = serve(t, ctx, server, wrongToken); w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for a write with the wrong CSRF token, got %d: %s", w.Code, w.Body.String())
	}

	// The real one still works, so the rejections above were about the token.
	authorized := jsonRequest("DELETE", "/api/roadmap/"+itemID, nil, "")
	authorized.AddCookie(cookie)
	authorized.Header.Set("X-Admin-CSRF", csrf)
	if w, _ = serve(t, ctx, server, authorized); w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for the authorized delete, got %d: %s", w.Code, w.Body.String())
	}
}

// TestAdminSession_CSRFGateIsCheckedBeforeAnythingElse pins the gate itself,
// without a database: a write carrying only the cookie is refused as
// unauthorized, while the same write carrying the CSRF token gets past
// authorization and fails later, on the missing database. The distinction is
// the whole point — 401 means the credential was rejected, 503 means it was not.
func TestAdminSession_CSRFGateIsCheckedBeforeAnythingElse(t *testing.T) {
	server := newTestServer(nil)
	server.SetRoadmapAdminKey(testAdminKey)

	cookie, csrf := adminSignIn(t, server, testAdminKey, "")
	path := "/api/roadmap/" + uuid.New().String()

	cookieOnly := jsonRequest("PUT", path, map[string]interface{}{"status": "PLANNED"}, "")
	cookieOnly.AddCookie(cookie)
	w := httptest.NewRecorder()
	server.Router.ServeHTTP(w, cookieOnly)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for a cookie-only write, got %d: %s", w.Code, w.Body.String())
	}

	withToken := jsonRequest("PUT", path, map[string]interface{}{"status": "PLANNED"}, "")
	withToken.AddCookie(cookie)
	withToken.Header.Set("X-Admin-CSRF", csrf)
	w = httptest.NewRecorder()
	server.Router.ServeHTTP(w, withToken)
	if w.Code == http.StatusUnauthorized {
		t.Fatalf("expected the CSRF-signed write past authorization, got 401: %s", w.Body.String())
	}

	// A script holding the key needs no CSRF token: it has no cookie to be
	// tricked into sending, so there is nothing for the token to protect.
	withKey := jsonRequest("PUT", path, map[string]interface{}{"status": "PLANNED"}, "")
	withKey.Header.Set("X-Admin-Key", testAdminKey)
	w = httptest.NewRecorder()
	server.Router.ServeHTTP(w, withKey)
	if w.Code == http.StatusUnauthorized {
		t.Fatalf("expected the header key to still authorize a write, got 401: %s", w.Body.String())
	}
}

// TestAdminSession_WrongKeyIsThrottled checks that failed sign-ins are what
// exhausts the budget, and that a correct key is not punished for sharing an
// address with a guesser until the guesser has actually used the budget up.
func TestAdminSession_WrongKeyIsThrottled(t *testing.T) {
	server := newTestServer(nil) // no database needed: sign-in never reaches one
	server.SetRoadmapAdminKey(testAdminKey)

	const attacker = "203.0.113.9:5000"

	// The bucket holds five attempts.
	for i := 0; i < 5; i++ {
		req := jsonRequest("POST", "/api/admin/session", map[string]string{"key": "wrong-key"}, "")
		req.RemoteAddr = attacker
		w := httptest.NewRecorder()
		server.Router.ServeHTTP(w, req)
		if w.Code != http.StatusUnauthorized {
			t.Fatalf("attempt %d: expected 401 Unauthorized, got %d: %s", i+1, w.Code, w.Body.String())
		}
	}

	// The sixth guess is refused outright.
	req := jsonRequest("POST", "/api/admin/session", map[string]string{"key": "wrong-key"}, "")
	req.RemoteAddr = attacker
	w := httptest.NewRecorder()
	server.Router.ServeHTTP(w, req)
	if w.Code != http.StatusTooManyRequests {
		t.Fatalf("expected 429 once the sign-in budget is spent, got %d: %s", w.Code, w.Body.String())
	}

	// Exhausting one address does not lock out another.
	adminSignIn(t, server, testAdminKey, "198.51.100.4:5000")
}

// TestAdminSession_CorrectKeyIsNeverThrottled is the point of charging only
// failures: the throttle judges guesses, so the right key opens the door even
// from an address whose budget a guesser has already spent — and signing in
// clears that address, rather than leaving the admin one typo from a lockout.
func TestAdminSession_CorrectKeyIsNeverThrottled(t *testing.T) {
	server := newTestServer(nil)
	server.SetRoadmapAdminKey(testAdminKey)

	// A shared address: somebody guesses until the budget is gone.
	const shared = "203.0.113.77:5000"
	for i := 0; i < 8; i++ {
		req := jsonRequest("POST", "/api/admin/session", map[string]string{"key": "wrong-key"}, "")
		req.RemoteAddr = shared
		w := httptest.NewRecorder()
		server.Router.ServeHTTP(w, req)
		if w.Code != http.StatusUnauthorized && w.Code != http.StatusTooManyRequests {
			t.Fatalf("attempt %d: expected the guess to be rejected, got %d: %s", i+1, w.Code, w.Body.String())
		}
	}

	// The admin, on that same address, gets in on the first try.
	adminSignIn(t, server, testAdminKey, shared)

	// And the budget came back with them: a fresh typo is a 401, not a 429.
	req := jsonRequest("POST", "/api/admin/session", map[string]string{"key": "wrong-key"}, "")
	req.RemoteAddr = shared
	w := httptest.NewRecorder()
	server.Router.ServeHTTP(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected a signed-in address to have its budget back, got %d: %s", w.Code, w.Body.String())
	}
}

// TestAdminSession_CorrectKeyIsNotCharged confirms the limiter bills failures
// only: an admin signing in repeatedly must never throttle themselves.
func TestAdminSession_CorrectKeyIsNotCharged(t *testing.T) {
	server := newTestServer(nil)
	server.SetRoadmapAdminKey(testAdminKey)

	const admin = "198.51.100.20:6000"
	for i := 0; i < 8; i++ {
		adminSignIn(t, server, testAdminKey, admin)
	}
}
