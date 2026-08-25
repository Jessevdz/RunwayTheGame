package api

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"math/big"
	"net"
	"net/http"
	"net/url"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v4"
)

// hashToken returns the hex SHA-256 digest of a capability token.
func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// tokensEqual compares two token digests in constant time.
func tokensEqual(a, b string) bool {
	return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}

// bearerToken extracts the capability token from the Authorization header.
func bearerToken(r *http.Request) string {
	header := r.Header.Get("Authorization")
	const prefix = "bearer "
	if len(header) > len(prefix) && strings.EqualFold(header[:len(prefix)], prefix) {
		return strings.TrimSpace(header[len(prefix):])
	}
	return ""
}

// joinCodeAlphabet defines the allowed set of characters for generated team join codes.
const joinCodeAlphabet = "23456789BCDFGHJKMNPQRSTVWXYZ"

const joinCodeLength = 6

// newJoinCode generates a random, human-transcribable team join code.
func newJoinCode() (string, error) {
	limit := big.NewInt(int64(len(joinCodeAlphabet)))
	out := make([]byte, joinCodeLength)
	for i := range out {
		n, err := rand.Int(rand.Reader, limit)
		if err != nil {
			return "", err
		}
		out[i] = joinCodeAlphabet[n.Int64()]
	}
	return string(out), nil
}

// normalizeJoinCode converts join codes to uppercase and removes formatting characters.
func normalizeJoinCode(code string) string {
	return strings.ToUpper(strings.NewReplacer(" ", "", "-", "", "_", "").Replace(strings.TrimSpace(code)))
}

// isJoinCodeShaped reports whether a normalized string contains only characters from joinCodeAlphabet.
func isJoinCodeShaped(code string) bool {
	for _, c := range code {
		if !strings.ContainsRune(joinCodeAlphabet, c) {
			return false
		}
	}
	return len(code) > 0
}

var errGameNotFound = errors.New("game not found")

type gameCapabilities struct {
	HostTokenHash string
}

func (s *Server) loadGameCapabilities(ctx context.Context, gameID string) (*gameCapabilities, error) {
	// A malformed id would otherwise reach Postgres as an invalid-uuid error and
	// surface as a 500 on what is really an unauthenticated probe.
	if _, err := uuid.Parse(gameID); err != nil {
		return nil, errGameNotFound
	}
	var hostHash *string
	err := s.DB.Pool.QueryRow(ctx, `
		SELECT host_token_hash FROM games WHERE id = $1
	`, gameID).Scan(&hostHash)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, errGameNotFound
		}
		return nil, err
	}
	caps := &gameCapabilities{}
	if hostHash != nil {
		caps.HostTokenHash = *hostHash
	}
	return caps, nil
}

// requireHost restricts access to host routes by checking the provided host capability token.
func (s *Server) requireHost(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gameID := chi.URLParam(r, "game_id")
		token := bearerToken(r)
		if token == "" {
			writeError(r.Context(), w, http.StatusUnauthorized, "host token required (Authorization: Bearer <host_token>)")
			return
		}

		caps, err := s.loadGameCapabilities(r.Context(), gameID)
		if err != nil {
			if errors.Is(err, errGameNotFound) {
				writeError(r.Context(), w, http.StatusNotFound, "game not found")
				return
			}
			writeError(r.Context(), w, http.StatusInternalServerError, "failed to verify host token: "+err.Error())
			return
		}
		if caps.HostTokenHash == "" || !tokensEqual(hashToken(token), caps.HostTokenHash) {
			writeError(r.Context(), w, http.StatusForbidden, "not the host of this game")
			return
		}

		next.ServeHTTP(w, r)
	})
}

// requireParticipant ensures the request carries a valid host or team join token.
func (s *Server) requireParticipant(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gameID := chi.URLParam(r, "game_id")
		token := bearerToken(r)
		if token == "" {
			writeError(r.Context(), w, http.StatusUnauthorized, "a host or team token is required (Authorization: Bearer <token>)")
			return
		}

		viewer, err := s.authorizeSubscriber(r.Context(), gameID, token)
		if err != nil {
			if errors.Is(err, errGameNotFound) {
				writeError(r.Context(), w, http.StatusNotFound, "game not found")
				return
			}
			writeError(r.Context(), w, http.StatusForbidden, "not a participant in this race")
			return
		}

		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), participantKey, viewer)))
	})
}

// participantKeyType defines the context key type for the authorized participant.
type participantKeyType struct{}

var participantKey participantKeyType

// participantFrom reports which capability the request came in on. An empty role
// means the request did not pass through requireParticipant.
func participantFrom(ctx context.Context) subscriber {
	viewer, _ := ctx.Value(participantKey).(subscriber)
	return viewer
}

// verdictAuthor indicates the entity authority under which a verdict was posted.
type verdictAuthor string

const (
	verdictAuthorWorker verdictAuthor = "worker"
	verdictAuthorHost   verdictAuthor = "host"
)

// verdictAuthorKeyType defines the context key type for verdict authors.
type verdictAuthorKeyType struct{}

var verdictAuthorKey verdictAuthorKeyType

// verdictAuthorFrom reports who the middleware established this verdict is from.
// An empty author means the request did not come through requireVerdictAuthor,
// which the handler treats as no authority at all.
func verdictAuthorFrom(ctx context.Context) verdictAuthor {
	author, _ := ctx.Value(verdictAuthorKey).(verdictAuthor)
	return author
}

// requireVerdictAuthor authenticates requests to post verdicts using either a worker or host capability token.
func (s *Server) requireVerdictAuthor(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := bearerToken(r)
		if token == "" {
			writeError(r.Context(), w, http.StatusUnauthorized, "worker or host token required (Authorization: Bearer <token>)")
			return
		}

		if s.WorkerToken != "" && tokensEqual(token, s.WorkerToken) {
			next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), verdictAuthorKey, verdictAuthorWorker)))
			return
		}

		gameID := chi.URLParam(r, "game_id")
		caps, err := s.loadGameCapabilities(r.Context(), gameID)
		if err != nil {
			if errors.Is(err, errGameNotFound) {
				writeError(r.Context(), w, http.StatusNotFound, "game not found")
				return
			}
			writeError(r.Context(), w, http.StatusInternalServerError, "failed to verify token: "+err.Error())
			return
		}
		if caps.HostTokenHash != "" && tokensEqual(hashToken(token), caps.HostTokenHash) {
			next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), verdictAuthorKey, verdictAuthorHost)))
			return
		}

		writeError(r.Context(), w, http.StatusForbidden, "not the worker or the host of this game")
	})
}

// subscriberRole represents the authorized role of a WebSocket subscriber.
type subscriberRole string

const (
	roleHost subscriberRole = "host"
	roleTeam subscriberRole = "team"
)

// subscriber identifies the capability a request or socket is acting under.
type subscriber struct {
	Role subscriberRole
	// TeamID is set only for roleTeam and scopes what the viewer may read.
	TeamID string
}

// isHost reports whether the subscriber holds the host capability.
func (s subscriber) isHost() bool { return s.Role == roleHost }

// authorizeSubscriber verifies whether a token grants host or team capabilities for a game.
func (s *Server) authorizeSubscriber(ctx context.Context, gameID, token string) (subscriber, error) {
	if token == "" {
		return subscriber{}, errors.New("token required")
	}
	caps, err := s.loadGameCapabilities(ctx, gameID)
	if err != nil {
		return subscriber{}, err
	}
	if caps.HostTokenHash != "" && tokensEqual(hashToken(token), caps.HostTokenHash) {
		return subscriber{Role: roleHost}, nil
	}

	var teamID string
	err = s.DB.Pool.QueryRow(ctx, `
		SELECT team_id FROM team_tokens WHERE game_id = $1 AND token_hash = $2
	`, gameID, hashToken(token)).Scan(&teamID)
	if err == nil {
		return subscriber{Role: roleTeam, TeamID: teamID}, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return subscriber{}, err
	}
	return subscriber{}, errors.New("token is not valid for this game")
}

// originAllowed validates whether a browser origin is permitted by configuration or development defaults.
func (s *Server) originAllowed(origin string) bool {
	if origin == "" {
		return true // not a browser request; CORS is not the control here
	}
	if len(s.AllowedOrigins) == 0 {
		return isDevelopmentOrigin(origin)
	}
	for _, allowed := range s.AllowedOrigins {
		if allowed == "*" {
			return true
		}
		if strings.EqualFold(allowed, origin) {
			return true
		}
	}
	return false
}

// originCredentialed reports whether an origin may send credentials — today,
// the admin session cookie. A "*" entry in the allowlist means "anyone may read
// public endpoints", which is not the same statement as "anyone may act as the
// signed-in admin", so credentials require an origin named explicitly.
func (s *Server) originCredentialed(origin string) bool {
	if origin == "" {
		return false
	}
	if len(s.AllowedOrigins) == 0 {
		return isDevelopmentOrigin(origin)
	}
	for _, allowed := range s.AllowedOrigins {
		if allowed != "*" && strings.EqualFold(allowed, origin) {
			return true
		}
	}
	return false
}

// isDevelopmentOrigin reports whether an origin URL matches local or private network development environments.
func isDevelopmentOrigin(origin string) bool {
	u, err := url.Parse(origin)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") {
		return false
	}
	host := u.Hostname()
	if host == "localhost" || host == "127.0.0.1" || host == "::1" || host == "0.0.0.0" || strings.HasSuffix(host, ".local") || strings.HasSuffix(host, ".test") {
		return true
	}
	ip := net.ParseIP(host)
	if ip == nil {
		return false
	}
	return ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsPrivate()
}

// corsMiddleware processes CORS preflight requests and applies origin access headers.
func (s *Server) corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		w.Header().Set("Vary", "Origin")

		if origin != "" && !s.originAllowed(origin) {
			if r.Method == http.MethodOptions {
				writeError(r.Context(), w, http.StatusForbidden, "origin not allowed")
				return
			}
			next.ServeHTTP(w, r)
			return
		}

		if origin != "" {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
			reqHeaders := r.Header.Get("Access-Control-Request-Headers")
			if reqHeaders != "" {
				w.Header().Set("Access-Control-Allow-Headers", reqHeaders)
			} else {
				w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Trace-ID, X-Voter-ID, X-Edit-Token, X-Admin-Key, X-Admin-CSRF")
			}
			if s.originCredentialed(origin) {
				w.Header().Set("Access-Control-Allow-Credentials", "true")
			}
			w.Header().Set("Access-Control-Max-Age", "600")
		}

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
