package api

import (
	"net"
	"net/http"
	"sync"
	"time"
)

// rateLimiter maintains in-memory token buckets keyed by string.
type rateLimiter struct {
	mu      sync.Mutex
	buckets map[string]*bucket

	refill float64
	burst  float64
	ttl    time.Duration

	lastSweep time.Time
}

type bucket struct {
	tokens   float64
	lastSeen time.Time
}

func newRateLimiter(refillPerSecond, burst float64, ttl time.Duration) *rateLimiter {
	return &rateLimiter{
		buckets:   make(map[string]*bucket),
		refill:    refillPerSecond,
		burst:     burst,
		ttl:       ttl,
		lastSweep: time.Now(),
	}
}

// bucketLocked returns key's bucket, refilled to now. The caller holds l.mu.
func (l *rateLimiter) bucketLocked(key string, now time.Time) *bucket {
	if now.Sub(l.lastSweep) > l.ttl {
		for k, b := range l.buckets {
			if now.Sub(b.lastSeen) > l.ttl {
				delete(l.buckets, k)
			}
		}
		l.lastSweep = now
	}

	b, ok := l.buckets[key]
	if !ok {
		b = &bucket{tokens: l.burst, lastSeen: now}
		l.buckets[key] = b
		return b
	}

	b.tokens += now.Sub(b.lastSeen).Seconds() * l.refill
	if b.tokens > l.burst {
		b.tokens = l.burst
	}
	b.lastSeen = now
	return b
}

// allow consumes one token for key, reporting whether the call may proceed.
func (l *rateLimiter) allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()

	b := l.bucketLocked(key, time.Now())
	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}

// available reports whether key has budget left, without spending any. Paired
// with penalize it makes a limiter that only charges for failures — ask it
// after the credential has been judged, never before, or a correct credential
// pays for the guesses of whoever shares its address.
func (l *rateLimiter) available(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()

	return l.bucketLocked(key, time.Now()).tokens >= 1
}

// penalize spends one of key's tokens, whether or not any remained.
func (l *rateLimiter) penalize(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()

	b := l.bucketLocked(key, time.Now())
	if b.tokens < 1 {
		b.tokens = 0
		return
	}
	b.tokens--
}

// reset restores key's full budget. A credential that turned out to be correct
// proves the address is the holder's, not the guesser's, so the failures it had
// accumulated stop being held against it.
func (l *rateLimiter) reset(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()

	l.bucketLocked(key, time.Now()).tokens = l.burst
}

// clientIP returns the client IP address from the request context or transport peer address.
func clientIP(r *http.Request) string {
	if ip, ok := r.Context().Value(realIPKey).(string); ok && ip != "" {
		return ip
	}
	return peerIP(r)
}

// peerIP is the transport-level remote address, with any port stripped.
func peerIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// rateLimitMiddleware limits the overall API request rate per client IP address.
func (s *Server) rateLimitMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if s.ipLimiter != nil && !s.ipLimiter.allow(clientIP(r)) {
			w.Header().Set("Retry-After", "5")
			writeError(r.Context(), w, http.StatusTooManyRequests, "too many requests")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// maxBodyBytes is the maximum allowed size in bytes for JSON request bodies.
const maxBodyBytes = 64 << 10 // 64 KiB

func bodyLimitMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Body != nil && r.Method != http.MethodGet && r.Method != http.MethodHead {
			r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
		}
		next.ServeHTTP(w, r)
	})
}
