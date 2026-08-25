package api

import (
	"context"
	"net"
	"net/http"
	"strings"
)

type ctxKey string

// realIPKey carries the resolved client address down to handlers.
const realIPKey ctxKey = "runway.real_ip"

// trustedProxies maintains IP networks authorized to supply forwarded client IP headers.
type trustedProxies struct {
	nets []*net.IPNet
}

// defaultTrustedProxies returns an empty trusted-proxy set, so forwarded headers
// are ignored unless the operator explicitly configures ingress CIDRs via RUNWAY_TRUSTED_PROXIES.
// Trusting loopback by default would let a co-resident process spoof the rate-limit key.
func defaultTrustedProxies() *trustedProxies {
	return parseTrustedProxies(nil)
}

// parseTrustedProxies builds the trust set from CIDR strings, ignoring entries
// that do not parse. A bare IP is accepted and treated as a single-host range.
func parseTrustedProxies(cidrs []string) *trustedProxies {
	tp := &trustedProxies{}
	for _, c := range cidrs {
		c = strings.TrimSpace(c)
		if c == "" {
			continue
		}
		if _, n, err := net.ParseCIDR(c); err == nil {
			tp.nets = append(tp.nets, n)
			continue
		}
		if ip := net.ParseIP(c); ip != nil {
			bits := 32
			if ip.To4() == nil {
				bits = 128
			}
			tp.nets = append(tp.nets, &net.IPNet{IP: ip, Mask: net.CIDRMask(bits, bits)})
		}
	}
	return tp
}

func (t *trustedProxies) contains(ip net.IP) bool {
	if t == nil || ip == nil {
		return false
	}
	for _, n := range t.nets {
		if n.Contains(ip) {
			return true
		}
	}
	return false
}

// SetTrustedProxies replaces the trusted-proxy set. An empty list disables
// forwarded-header handling entirely, so every request is keyed on its peer.
func (s *Server) SetTrustedProxies(cidrs []string) {
	s.trustedProxies = parseTrustedProxies(cidrs)
}

// realIPMiddleware resolves the client address and stores it in the request context.
func (s *Server) realIPMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx := context.WithValue(r.Context(), realIPKey, s.resolveClientIP(r))
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func (s *Server) resolveClientIP(r *http.Request) string {
	peer := peerIP(r)
	if !s.trustedProxies.contains(net.ParseIP(peer)) {
		return peer
	}

	// Walk X-Forwarded-For from right to left, returning the first untrusted IP address.
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		parts := strings.Split(xff, ",")
		for i := len(parts) - 1; i >= 0; i-- {
			candidate := strings.TrimSpace(parts[i])
			ip := net.ParseIP(candidate)
			if ip == nil {
				// Stop processing on malformed hop to prevent spoofing.
				break
			}
			if !s.trustedProxies.contains(ip) {
				return ip.String()
			}
		}
	}

	// Fall back to X-Real-IP if present and valid.
	if xri := strings.TrimSpace(r.Header.Get("X-Real-IP")); xri != "" {
		if ip := net.ParseIP(xri); ip != nil {
			return ip.String()
		}
	}
	return peer
}
