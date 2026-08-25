package api

import (
	"net/http/httptest"
	"testing"
	"time"
)

func newIPServer() *Server {
	return &Server{trustedProxies: defaultTrustedProxies()}
}

// privateProxyServer configures the private/LAN ranges as trusted proxies, the
// way an operator would for a real reverse proxy; the secure default trusts only
// loopback, so exercising the forwarded-header walk needs an explicit set.
func privateProxyServer() *Server {
	s := newIPServer()
	s.SetTrustedProxies([]string{"10.0.0.0/8", "172.16.0.0/12"})
	return s
}

// A caller reaching the server directly from a public address gets no say in
// its own rate-limit bucket, whatever headers it sends.
func TestResolveClientIPIgnoresHeadersFromUntrustedPeer(t *testing.T) {
	s := newIPServer()
	for _, h := range []string{"X-Forwarded-For", "X-Real-IP", "True-Client-IP"} {
		r := httptest.NewRequest("GET", "/api/games/code/ABC123", nil)
		r.RemoteAddr = "203.0.113.7:44321"
		r.Header.Set(h, "1.2.3.4")
		if got := s.resolveClientIP(r); got != "203.0.113.7" {
			t.Errorf("with %s: resolveClientIP = %q, want 203.0.113.7", h, got)
		}
	}
}

// Spoofed hops appended by the client sit to the LEFT of the address our proxy
// added, so resolution must walk from the right.
func TestResolveClientIPTakesRightmostUntrustedHop(t *testing.T) {
	s := privateProxyServer()
	r := httptest.NewRequest("GET", "/api/games/code/ABC123", nil)
	r.RemoteAddr = "172.18.0.5:9999" // docker-network nginx
	r.Header.Set("X-Forwarded-For", "1.2.3.4, 5.6.7.8, 198.51.100.9")
	if got := s.resolveClientIP(r); got != "198.51.100.9" {
		t.Errorf("resolveClientIP = %q, want 198.51.100.9", got)
	}
}

func TestResolveClientIPSkipsTrustedHops(t *testing.T) {
	s := privateProxyServer()
	r := httptest.NewRequest("GET", "/api/games/code/ABC123", nil)
	r.RemoteAddr = "10.0.0.2:9999"
	r.Header.Set("X-Forwarded-For", "198.51.100.9, 10.0.0.3")
	if got := s.resolveClientIP(r); got != "198.51.100.9" {
		t.Errorf("resolveClientIP = %q, want 198.51.100.9", got)
	}
}

func TestResolveClientIPFallsBackToXRealIP(t *testing.T) {
	s := privateProxyServer()
	r := httptest.NewRequest("GET", "/api/games/code/ABC123", nil)
	r.RemoteAddr = "10.0.0.2:9999"
	r.Header.Set("X-Real-IP", "198.51.100.9")
	if got := s.resolveClientIP(r); got != "198.51.100.9" {
		t.Errorf("resolveClientIP = %q, want 198.51.100.9", got)
	}
}

// The concrete bypass from the finding: a burst of code-lookup attempts, each
// with a fresh spoofed header, must still exhaust one bucket.
func TestSpoofedHeadersCannotRefillCodeLookupBudget(t *testing.T) {
	s := newIPServer()
	limiter := newRateLimiter(0.1, 10, 30*time.Minute)

	allowed := 0
	for i := 0; i < 50; i++ {
		r := httptest.NewRequest("GET", "/api/games/code/ABC123", nil)
		r.RemoteAddr = "203.0.113.7:44321"
		r.Header.Set("X-Forwarded-For", randomishIP(i))
		r.Header.Set("True-Client-IP", randomishIP(i+100))
		if limiter.allow(s.resolveClientIP(r)) {
			allowed++
		}
	}
	if allowed > 10 {
		t.Fatalf("%d of 50 spoofed requests allowed, want at most the burst of 10", allowed)
	}
}

func randomishIP(i int) string {
	return "1.2." + itoa(i/256) + "." + itoa(i%256)
}

func itoa(i int) string {
	if i == 0 {
		return "0"
	}
	var b []byte
	for i > 0 {
		b = append([]byte{byte('0' + i%10)}, b...)
		i /= 10
	}
	return string(b)
}
