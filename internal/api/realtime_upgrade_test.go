package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/gorilla/websocket"
)

// The websocket gateway can only work if every middleware in front of it hands
// the handler a ResponseWriter that still implements http.Hijacker. A wrapper
// that embeds the http.ResponseWriter interface drops Hijacker silently, and
// gorilla then fails the upgrade with a 500 — which takes down the host tools
// and every player console at once, since both get their game state exclusively
// from this socket.
func TestWebSocketUpgradeSurvivesMiddlewareChain(t *testing.T) {
	s := &Server{
		AllowedOrigins:  []string{"*"},
		ipLimiter:       newRateLimiter(100, 100, time.Minute),
		positionLimiter: newRateLimiter(100, 100, time.Minute),
	}
	s.upgrader = s.newUpgrader()

	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(TraceMiddleware)
	r.Use(RequestLoggerMiddleware)
	r.Use(middleware.Recoverer)
	r.Use(s.corsMiddleware)
	r.Use(s.rateLimitMiddleware)
	r.Use(bodyLimitMiddleware)

	upgraded := make(chan struct{}, 1)
	r.Get("/api/games/{game_id}/ws", func(w http.ResponseWriter, req *http.Request) {
		conn, err := s.upgrader.Upgrade(w, req, nil)
		if err != nil {
			t.Errorf("upgrade failed: %v", err)
			return
		}
		upgraded <- struct{}{}
		conn.Close()
	})

	srv := httptest.NewServer(r)
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/api/games/00000000-0000-0000-0000-000000000000/ws"
	conn, resp, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		status := "no response"
		if resp != nil {
			status = resp.Status
		}
		t.Fatalf("websocket dial failed (%s): %v", status, err)
	}
	defer conn.Close()

	<-upgraded
}

// The capability must never be readable from the URL. A browser cannot set
// Authorization on a handshake, so it offers the token as a subprotocol; the
// query string is not accepted at all any more, because a token there ends up in
// proxy logs and browser history.
func TestWebSocketTokenComesFromHeadersNotTheURL(t *testing.T) {
	subprotocol := httptest.NewRequest("GET", "/api/games/g/ws", nil)
	subprotocol.Header.Set("Sec-WebSocket-Protocol", "runway.v1, runway.token.the-capability")
	if got := websocketToken(subprotocol); got != "the-capability" {
		t.Errorf("subprotocol token: got %q, want %q", got, "the-capability")
	}

	header := httptest.NewRequest("GET", "/api/games/g/ws", nil)
	header.Header.Set("Authorization", "Bearer the-capability")
	if got := websocketToken(header); got != "the-capability" {
		t.Errorf("authorization token: got %q, want %q", got, "the-capability")
	}

	query := httptest.NewRequest("GET", "/api/games/g/ws?token=the-capability", nil)
	if got := websocketToken(query); got != "" {
		t.Errorf("a token in the query string must be ignored, got %q", got)
	}
}

func TestWebSocketUpgradeOriginPolicy(t *testing.T) {
	s := &Server{
		AllowedOrigins: []string{"https://configured.example.com"},
	}
	s.upgrader = s.newUpgrader()

	r := chi.NewRouter()
	r.Get("/ws", func(w http.ResponseWriter, req *http.Request) {
		conn, err := s.upgrader.Upgrade(w, req, nil)
		if err != nil {
			return
		}
		conn.Close()
	})

	srv := httptest.NewServer(r)
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws"

	// 1. Same-origin request (matching srv host) should succeed even if not in AllowedOrigins.
	dialer := websocket.Dialer{}
	header := http.Header{}
	header.Set("Origin", srv.URL)
	conn, resp, err := dialer.Dial(wsURL, header)
	if err != nil {
		t.Fatalf("same-origin websocket dial should succeed, got: %v (status %v)", err, resp)
	}
	conn.Close()

	// 2. Allowed cross-origin should succeed.
	header = http.Header{}
	header.Set("Origin", "https://configured.example.com")
	conn, resp, err = dialer.Dial(wsURL, header)
	if err != nil {
		t.Fatalf("configured allowed origin should succeed, got: %v (status %v)", err, resp)
	}
	conn.Close()

	// 3. Disallowed origin should fail with 403 Forbidden.
	header = http.Header{}
	header.Set("Origin", "https://unauthorized.example.com")
	conn, resp, err = dialer.Dial(wsURL, header)
	if err == nil {
		conn.Close()
		t.Fatalf("disallowed origin should have failed")
	}
	if resp == nil || resp.StatusCode != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden for disallowed origin, got %v", resp)
	}
}

