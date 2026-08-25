package api

// Admin authority is one long-lived shared secret (RUNWAY_ROADMAP_ADMIN_KEY),
// which makes every place it travels a place it can leak: a proxy access log, a
// browser history, a pasted link. So it travels in exactly one request — the
// body of POST /api/admin/session — and is spent there for a short-lived
// session the browser holds as an HttpOnly cookie. The key is never a URL
// segment, never a query parameter, and never readable by the page's script.
//
// A cookie is attached by the browser whether or not the page meant to send it,
// so the session is only half a credential. Minting also returns a CSRF token,
// which the console holds and echoes in X-Admin-CSRF: another site can make the
// browser send the cookie, but it cannot read the token. Writes require both.
//
// Sessions live in memory for the process lifetime, like the voter secret in
// roadmap.go. A restart logs every admin out, which is what a deploy should do,
// and revoking a leaked session is a restart rather than a key rotation.

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/Jessevdz/RunwayTheGame/internal/logger"
)

// errInvalidSameSite rejects an unrecognized admin cookie SameSite policy.
var errInvalidSameSite = errors.New("admin cookie SameSite must be strict, lax, or none")

const (
	// adminSessionCookie names the cookie carrying the admin session token.
	adminSessionCookie = "runway_admin_session"
	// adminKeyHeader carries the raw admin key, for scripts that hold no session.
	adminKeyHeader = "X-Admin-Key"
	// adminCSRFHeader carries the token proving the admin console itself made
	// the call, rather than another site that merely triggered the cookie.
	adminCSRFHeader = "X-Admin-CSRF"
	// adminSessionCookiePath scopes the cookie to the API. Nothing outside
	// /api authenticates with it, so nothing outside /api needs to see it.
	adminSessionCookiePath = "/api"
	// adminSessionTTL is how long a session lives before the key must be spent again.
	adminSessionTTL = 8 * time.Hour
)

// adminSession is one signed-in admin browser.
type adminSession struct {
	csrfToken string
	expiresAt time.Time
}

// adminSessionStore holds live sessions keyed by the SHA-256 of the session
// token, so the store's contents are not themselves usable credentials.
type adminSessionStore struct {
	mu        sync.Mutex
	sessions  map[string]adminSession
	ttl       time.Duration
	lastSweep time.Time
}

func newAdminSessionStore(ttl time.Duration) *adminSessionStore {
	return &adminSessionStore{
		sessions:  make(map[string]adminSession),
		ttl:       ttl,
		lastSweep: time.Now(),
	}
}

// newSessionToken returns 256 bits of URL-safe randomness.
func newSessionToken() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

// mint creates a session, returning the token the browser stores in its cookie
// and the session itself, whose CSRF token the page keeps.
func (st *adminSessionStore) mint() (string, adminSession, error) {
	token, err := newSessionToken()
	if err != nil {
		return "", adminSession{}, err
	}
	csrf, err := newSessionToken()
	if err != nil {
		return "", adminSession{}, err
	}

	now := time.Now()
	session := adminSession{csrfToken: csrf, expiresAt: now.Add(st.ttl)}

	st.mu.Lock()
	defer st.mu.Unlock()
	st.sweepLocked(now)
	st.sessions[hashToken(token)] = session
	return token, session, nil
}

// lookup returns the live session a token names, if it names one at all.
func (st *adminSessionStore) lookup(token string) (adminSession, bool) {
	if token == "" {
		return adminSession{}, false
	}
	key := hashToken(token)

	st.mu.Lock()
	defer st.mu.Unlock()
	session, ok := st.sessions[key]
	if !ok {
		return adminSession{}, false
	}
	if time.Now().After(session.expiresAt) {
		delete(st.sessions, key)
		return adminSession{}, false
	}
	return session, true
}

// revoke ends a session immediately. Revoking one that does not exist is not an error.
func (st *adminSessionStore) revoke(token string) {
	if token == "" {
		return
	}
	st.mu.Lock()
	defer st.mu.Unlock()
	delete(st.sessions, hashToken(token))
}

// sweepLocked drops expired sessions, at most once per TTL. Expiry is enforced
// on every lookup regardless; this only keeps the map from growing.
func (st *adminSessionStore) sweepLocked(now time.Time) {
	if now.Sub(st.lastSweep) < st.ttl {
		return
	}
	for key, session := range st.sessions {
		if now.After(session.expiresAt) {
			delete(st.sessions, key)
		}
	}
	st.lastSweep = now
}

// safeMethod reports whether a method only reads, and so needs no CSRF token.
func safeMethod(method string) bool {
	switch method {
	case http.MethodGet, http.MethodHead, http.MethodOptions:
		return true
	}
	return false
}

// adminSessionToken is the session token the request presents, if any.
func adminSessionToken(r *http.Request) string {
	cookie, err := r.Cookie(adminSessionCookie)
	if err != nil {
		return ""
	}
	return cookie.Value
}

// sessionAuthorized reports whether the request's session cookie authorizes it.
// A write must also carry the CSRF token minted with that session.
func (s *Server) sessionAuthorized(r *http.Request) bool {
	if s.adminSessions == nil {
		return false
	}
	session, ok := s.adminSessions.lookup(adminSessionToken(r))
	if !ok {
		return false
	}
	if safeMethod(r.Method) {
		return true
	}
	presented := strings.TrimSpace(r.Header.Get(adminCSRFHeader))
	if presented == "" || !tokensEqual(presented, session.csrfToken) {
		logger.Warn(r.Context(), "admin session presented without a matching CSRF token", map[string]interface{}{
			"method": r.Method,
			"path":   r.URL.Path,
		})
		return false
	}
	return true
}

// adminCredentialPresented reports whether the request tried to authenticate at
// all. Presenting nothing is an anonymous request, not a failed attempt, and
// must not spend the sign-in budget of whoever shares that IP address.
func adminCredentialPresented(r *http.Request) bool {
	if strings.TrimSpace(r.Header.Get(adminKeyHeader)) != "" {
		return true
	}
	if strings.TrimSpace(r.URL.Query().Get("admin_key")) != "" {
		return true
	}
	return adminSessionToken(r) != ""
}

// SetAdminCookieSameSite configures the SameSite policy of the admin session
// cookie. The default, "strict", is right whenever the console and the API
// share a site, and is itself a CSRF defence. A deployment that serves the two
// from different sites needs "none", which browsers only honour over HTTPS.
func (s *Server) SetAdminCookieSameSite(mode string) error {
	switch strings.ToLower(strings.TrimSpace(mode)) {
	case "strict", "":
		s.adminCookieSameSite = http.SameSiteStrictMode
	case "lax":
		s.adminCookieSameSite = http.SameSiteLaxMode
	case "none":
		s.adminCookieSameSite = http.SameSiteNoneMode
	default:
		return errInvalidSameSite
	}
	return nil
}

// cookieSecure reports whether the session cookie may carry the Secure flag —
// that is, whether this request arrived over TLS. Setting it on a plain-HTTP
// local dev server would make the browser discard the cookie entirely.
func (s *Server) cookieSecure(r *http.Request) bool {
	if r.TLS != nil {
		return true
	}
	// SameSite=None is only honoured on a Secure cookie, so an operator asking
	// for it has told us this deployment is HTTPS.
	if s.adminCookieSameSite == http.SameSiteNoneMode {
		return true
	}
	// X-Forwarded-Proto is only meaningful from a proxy we trust to set it.
	if s.trustedProxies.contains(net.ParseIP(peerIP(r))) {
		return strings.EqualFold(strings.TrimSpace(r.Header.Get("X-Forwarded-Proto")), "https")
	}
	return false
}

// writeAdminCookie sets or clears the session cookie. A negative maxAge clears it.
func (s *Server) writeAdminCookie(w http.ResponseWriter, r *http.Request, token string, maxAge int) {
	http.SetCookie(w, &http.Cookie{
		Name:     adminSessionCookie,
		Value:    token,
		Path:     adminSessionCookiePath,
		MaxAge:   maxAge,
		HttpOnly: true,
		Secure:   s.cookieSecure(r),
		SameSite: s.adminCookieSameSite,
	})
}

// adminSessionRequest is the one place the admin key crosses the wire.
type adminSessionRequest struct {
	Key string `json:"key"`
}

// adminSessionResponse is what a new session tells the page. The session token
// is deliberately absent: it is in the HttpOnly cookie, where script cannot
// reach it, and so neither can an injected script.
type adminSessionResponse struct {
	Valid     bool      `json:"valid"`
	CSRFToken string    `json:"csrf_token"`
	ExpiresAt time.Time `json:"expires_at"`
}

// handleCreateAdminSession exchanges the admin key for a session.
func (s *Server) handleCreateAdminSession(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	if s.RoadmapAdminKey == "" {
		writeError(ctx, w, http.StatusServiceUnavailable, "admin access is not configured on this server")
		return
	}

	ip := clientIP(r)

	var req adminSessionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(ctx, w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	// The key is judged before the budget is consulted, so the throttle is only
	// ever a verdict on guesses. An admin behind an address somebody else has
	// been guessing from — a shared office NAT, a phone on carrier CGNAT, their
	// own earlier typo — signs in on the first correct try rather than waiting
	// out a lockout they did not earn. Guessing still costs: a wrong key spends
	// a token whether or not one remained, and once the budget is gone every
	// further wrong key is refused outright.
	key := strings.TrimSpace(req.Key)
	if key == "" || !tokensEqual(key, s.RoadmapAdminKey) {
		spent := !s.adminAuthLimiter.available(ip)
		s.adminAuthLimiter.penalize(ip)
		logger.Warn(ctx, "rejected admin sign-in attempt", map[string]interface{}{"ip": ip})
		if spent {
			w.Header().Set("Retry-After", "60")
			writeError(ctx, w, http.StatusTooManyRequests, "too many admin sign-in attempts: wait a minute and try again")
			return
		}
		writeError(ctx, w, http.StatusUnauthorized, "unauthorized: invalid admin key")
		return
	}
	s.adminAuthLimiter.reset(ip)

	token, session, err := s.adminSessions.mint()
	if err != nil {
		logger.Error(ctx, "failed to mint admin session", map[string]interface{}{"error": err.Error()})
		writeError(ctx, w, http.StatusInternalServerError, "failed to start admin session")
		return
	}

	s.writeAdminCookie(w, r, token, int(adminSessionTTL.Seconds()))
	writeJSON(ctx, w, http.StatusCreated, adminSessionResponse{
		Valid:     true,
		CSRFToken: session.csrfToken,
		ExpiresAt: session.expiresAt,
	})
}

// handleDeleteAdminSession signs the caller out. It needs no CSRF token: the
// worst a forged sign-out achieves is that the admin signs in again.
func (s *Server) handleDeleteAdminSession(w http.ResponseWriter, r *http.Request) {
	s.adminSessions.revoke(adminSessionToken(r))
	s.writeAdminCookie(w, r, "", -1)
	w.WriteHeader(http.StatusNoContent)
}
