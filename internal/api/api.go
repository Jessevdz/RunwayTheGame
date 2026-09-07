// Package api provides HTTP routing, middleware, and handlers for the game API.
package api

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"

	"github.com/Jessevdz/RunwayTheGame/internal/blobstore"
	"github.com/Jessevdz/RunwayTheGame/internal/commands"
	"github.com/Jessevdz/RunwayTheGame/internal/db"
	"github.com/Jessevdz/RunwayTheGame/internal/logger"
)

// Server encapsulates the HTTP router and database connection pool.
type Server struct {
	DB           *db.DB
	Router       *chi.Mux
	CmdProcessor *commands.CommandProcessor
	// BlobStore mints presigned upload URLs for file attachments.
	BlobStore blobstore.Presigner
	Hub       *Hub
	// WorkerToken is the shared secret required for verification worker callbacks.
	WorkerToken string
	// RoadmapAdminKey is the secret key required for managing roadmap items.
	RoadmapAdminKey string
	// AIReferee reports whether automated photo evaluation is enabled.
	AIReferee bool
	// AllowedOrigins defines the browser origins permitted for CORS and WebSocket connections.
	AllowedOrigins []string
	// AnalyticsEnabled reports whether design usage metrics are recorded.
	AnalyticsEnabled bool

	// trustedProxies configures trusted proxy IP ranges for X-Forwarded-For evaluation.
	trustedProxies *trustedProxies

	// voterSecret signs roadmap voter fingerprints generated per process lifetime.
	voterSecret []byte

	// adminSessions holds the short-lived sessions the admin key is exchanged for.
	adminSessions *adminSessionStore
	// adminCookieSameSite is the SameSite policy of the admin session cookie.
	adminCookieSameSite http.SameSite

	ipLimiter            *rateLimiter
	adminAuthLimiter     *rateLimiter
	positionLimiter      *rateLimiter
	codeLookupLimiter    *rateLimiter
	roadmapSubmitLimiter *rateLimiter
	roadmapVoteLimiter   *rateLimiter
	roadmapFlagLimiter   *rateLimiter
	bugReportLimiter     *rateLimiter
	analyticsLimiter     *rateLimiter
	upgrader             websocket.Upgrader

	// now returns the current time; injectable for deterministic movement tests.
	now func() time.Time
}

// nowUTC returns the current UTC time via the server clock.
func (s *Server) nowUTC() time.Time {
	if s.now == nil {
		return time.Now().UTC()
	}
	return s.now().UTC()
}

// SetClock installs a deterministic clock for tests. Pass nil to reset to the real clock.
func (s *Server) SetClock(fn func() time.Time) {
	s.now = fn
}

// DisablePositionLimiter turns off position-update throttling for tests.
func (s *Server) DisablePositionLimiter() {
	s.positionLimiter = nil
}

// NewServer initializes a new Server.
func NewServer(database *db.DB) *Server {
	s := &Server{
		DB:                  database,
		Router:              chi.NewRouter(),
		CmdProcessor:        commands.NewCommandProcessor(database),
		Hub:                 newHub(),
		trustedProxies:      defaultTrustedProxies(),
		voterSecret:         newVoterSecret(),
		adminSessions:       newAdminSessionStore(adminSessionTTL),
		adminCookieSameSite: http.SameSiteStrictMode,
		ipLimiter:           newRateLimiter(4, 60, 10*time.Minute),
		// Five failed admin sign-ins, then one more per half hour. Only wrong
		// keys are charged, and only after the key has been judged, so a
		// correct key is never refused and a successful sign-in clears the
		// address outright.
		adminAuthLimiter:     newRateLimiter(1.0/1800.0, 5, 6*time.Hour),
		positionLimiter:      newRateLimiter(0.2, 2, 30*time.Minute),
		codeLookupLimiter:    newRateLimiter(0.1, 10, 30*time.Minute),
		roadmapSubmitLimiter: newRateLimiter(1.0/(10*60), 2, 30*time.Minute),
		roadmapVoteLimiter:   newRateLimiter(2.0, 20, 10*time.Minute),
		roadmapFlagLimiter:   newRateLimiter(1.0/60.0, 3, 30*time.Minute),
		// A playtester who finds five things in a row should be able to file
		// five reports; the point of the feature is that reporting is cheaper
		// than remembering. One more every two minutes after that.
		bugReportLimiter:     newRateLimiter(1.0/120.0, 5, 30*time.Minute),
		analyticsLimiter:     newRateLimiter(1.0, 20, 10*time.Minute),
	}
	s.upgrader = s.newUpgrader()
	s.CmdProcessor.OnCommit = s.broadcastProjection
	s.setupMiddlewares()
	s.setupRoutes()
	return s
}

// writeJSON writes a JSON status and body to the response, logging any encoding errors.
func writeJSON(ctx context.Context, w http.ResponseWriter, status int, body interface{}) {
	setJSONHeaders(w)
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(body); err != nil {
		logger.Warn(ctx, "failed to encode JSON response", map[string]interface{}{"error": err.Error()})
	}
}

// writeRawJSON writes pre-encoded JSON bytes directly to the response writer.
func writeRawJSON(ctx context.Context, w http.ResponseWriter, status int, body []byte) {
	setJSONHeaders(w)
	w.WriteHeader(status)
	if _, err := w.Write(body); err != nil {
		logger.Warn(ctx, "failed to write JSON response", map[string]interface{}{"error": err.Error()})
	}
}

// errorResponse represents the standard JSON error payload returned by failed API requests.
type errorResponse struct {
	Error string `json:"error"`
}

// writeError writes a failure as {"error": message} with the given status.
func writeError(ctx context.Context, w http.ResponseWriter, status int, message string) {
	writeJSON(ctx, w, status, errorResponse{Error: message})
}

// setJSONHeaders sets the response Content-Type header to JSON and enables nosniff protection.
func setJSONHeaders(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("X-Content-Type-Options", "nosniff")
}

// newUpgrader builds the WebSocket upgrader with origin validation.
func (s *Server) newUpgrader() websocket.Upgrader {
	return websocket.Upgrader{
		ReadBufferSize:  1024,
		WriteBufferSize: 1024,
		CheckOrigin: func(r *http.Request) bool {
			return isSameOrigin(r) || s.originAllowed(r.Header.Get("Origin"))
		},
		Subprotocols: []string{wsProtocol},
	}
}

// SetBlobStore configures the presigner for direct-upload URLs.
func (s *Server) SetBlobStore(bs blobstore.Presigner) {
	s.BlobStore = bs
}

// SetWorkerToken configures the shared secret required on POST /verdict.
func (s *Server) SetWorkerToken(token string) {
	s.WorkerToken = token
}

// SetRoadmapAdminKey configures the secret GUID required for roadmap administration.
func (s *Server) SetRoadmapAdminKey(key string) {
	s.RoadmapAdminKey = key
}

// SetAllowedOrigins configures the browser origin allowlist used by both CORS
// and the websocket upgrade.
func (s *Server) SetAllowedOrigins(origins []string) {
	s.AllowedOrigins = origins
}

func (s *Server) setupMiddlewares() {
	s.Router.Use(middleware.RequestID)
	s.Router.Use(s.realIPMiddleware)
	s.Router.Use(TraceMiddleware)
	s.Router.Use(RequestLoggerMiddleware)
	s.Router.Use(middleware.Recoverer)
	s.Router.Use(s.corsMiddleware)
	s.Router.Use(s.rateLimitMiddleware)
	s.Router.Use(bodyLimitMiddleware)
}

// TraceMiddleware extracts or generates a trace ID and sets it in context.
func TraceMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		traceID := r.Header.Get("X-Trace-ID")
		if traceID == "" {
			traceID = uuid.New().String()
		}
		ctx := logger.WithTrace(r.Context(), traceID)
		w.Header().Set("X-Trace-ID", traceID)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// RequestLoggerMiddleware logs incoming HTTP requests with latency, status, and trace context.
func RequestLoggerMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
		next.ServeHTTP(rec, r)
		duration := time.Since(start)

		status := rec.Status()
		if status == 0 {
			// Handler returned without writing (e.g. a hijacked websocket).
			status = http.StatusOK
		}

		fields := map[string]interface{}{
			"method":        r.Method,
			"path":          r.URL.Path,
			"status":        status,
			"duration_ms":   duration.Milliseconds(),
			"bytes_written": rec.BytesWritten(),
		}

		if status >= 500 {
			logger.Error(r.Context(), "http request error", fields)
		} else if status >= 400 {
			logger.Warn(r.Context(), "http client error", fields)
		} else {
			logger.Info(r.Context(), "http request completed", fields)
		}
	})
}
