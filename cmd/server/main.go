// Command server runs the Runway game server HTTP API, command write path, and
// realtime websocket gateway. It is the only process that mutates game state directly.
package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/Jessevdz/RunwayTheGame/internal/api"
	"github.com/Jessevdz/RunwayTheGame/internal/blobstore"
	"github.com/Jessevdz/RunwayTheGame/internal/config"
	"github.com/Jessevdz/RunwayTheGame/internal/db"
	"github.com/Jessevdz/RunwayTheGame/internal/scheduler"
)

func main() {
	ctx := context.Background()

	dbCfg := db.Config{
		Host:     config.EnvOr("RUNWAY_DB_HOST", "localhost"),
		Port:     config.EnvIntOr("RUNWAY_DB_PORT", 5433),
		User:     config.EnvOr("RUNWAY_DB_USER", "postgres"),
		Password: config.EnvOr("RUNWAY_DB_PASSWORD", "password"),
		Database: config.EnvOr("RUNWAY_DB_NAME", "runway"),
		SSLMode:  config.EnvOr("RUNWAY_DB_SSLMODE", "disable"),
	}

	database, err := db.NewPool(ctx, dbCfg)
	if err != nil {
		log.Fatalf("failed to connect to database: %v", err)
	}
	defer database.Close()

	if err := database.Migrate(ctx); err != nil {
		log.Fatalf("failed to run schema migration: %v", err)
	}

	server := api.NewServer(database)

	// Configure worker token for POST /verdict authentication.
	workerToken := os.Getenv("RUNWAY_WORKER_TOKEN")
	if workerToken != "" {
		server.SetWorkerToken(workerToken)
	} else {
		log.Println("RUNWAY_WORKER_TOKEN not set — POST /verdict is disabled (503) until configured")
	}

	// Configure AI referee availability.
	if aiRefereeAvailable(workerToken) {
		server.SetAIRefereeAvailable(true)
	} else {
		log.Println("no AI backend configured — the AI referee is not offered (set RUNWAY_AI_REFEREE=1, or an LLM API key, once a worker is running)")
	}

	// Generate a random key when unset to disable admin routes.
	// Clients exchange this key once for an admin session cookie.
	adminKey := os.Getenv("RUNWAY_ROADMAP_ADMIN_KEY")
	if adminKey == "" {
		adminKey = randomKey()
		log.Println("RUNWAY_ROADMAP_ADMIN_KEY not set — roadmap admin routes are closed (a random key was generated; set the env var to use them)")
	}
	server.SetRoadmapAdminKey(adminKey)

	// Set SameSite policy for the admin cookie, using "none" for split-site HTTPS deployments.
	if sameSite := os.Getenv("RUNWAY_ADMIN_COOKIE_SAMESITE"); sameSite != "" {
		if err := server.SetAdminCookieSameSite(sameSite); err != nil {
			log.Fatalf("invalid RUNWAY_ADMIN_COOKIE_SAMESITE: %v", err)
		}
		log.Printf("admin session cookie SameSite: %s", sameSite)
	}

	// Usage analytics is disabled by default unless explicitly enabled.
	if analyticsEnabled() {
		server.SetAnalyticsEnabled(true)
		log.Println("RUNWAY_ANALYTICS=1 — recording anonymous design usage and per-race statistics (see PRIVACY.md)")
	}

	// Trusted reverse proxy CIDRs or IP addresses for X-Forwarded-For handling.
	// When unset, defaults to loopback and private IP ranges.
	if proxies := os.Getenv("RUNWAY_TRUSTED_PROXIES"); proxies != "" {
		server.SetTrustedProxies(strings.Split(proxies, ","))
		log.Printf("trusted proxy ranges: %s", proxies)
	}

	// Allowed browser origins for API and WebSocket requests. When unset,
	// defaults to loopback and private network origins.
	if origins := os.Getenv("RUNWAY_ALLOWED_ORIGINS"); origins != "" {
		var allowed []string
		for _, o := range strings.Split(origins, ",") {
			if trimmed := strings.TrimSpace(o); trimmed != "" {
				allowed = append(allowed, trimmed)
			}
		}
		server.SetAllowedOrigins(allowed)
		log.Printf("CORS/websocket origin allowlist: %v", allowed)
	} else {
		log.Println("RUNWAY_ALLOWED_ORIGINS not set — only loopback and private-LAN origins are accepted")
	}

	sched := scheduler.NewScheduler(server.BroadcastGameState)
	// Configure deadline sweep handler for expired coin rushes.
	sched.SetDeadlineSweep(server.EndLapsedCoinRush)
	schedCtx, cancelSched := context.WithCancel(ctx)
	defer cancelSched()
	tickInterval := time.Duration(config.EnvIntOr("RUNWAY_TICK_INTERVAL_SECONDS", 10)) * time.Second
	go sched.RunLoop(schedCtx, database, tickInterval)

	// Periodic data retention sweep interval.
	retentionInterval := time.Duration(config.EnvIntOr("RUNWAY_RETENTION_INTERVAL_MINUTES", 60)) * time.Minute

	if endpoint := os.Getenv("S3_ENDPOINT"); endpoint != "" {
		server.SetBlobStore(blobstore.NewS3Presigner(blobstore.S3Config{
			Endpoint:       endpoint,
			PublicEndpoint: os.Getenv("S3_PUBLIC_ENDPOINT"),
			Region:         config.EnvOr("S3_REGION", "us-east-1"),
			Bucket:         config.EnvOr("S3_BUCKET", "runway-evidence"),
			AccessKey:      os.Getenv("S3_ACCESS_KEY"),
			SecretKey:      os.Getenv("S3_SECRET_KEY"),
			UseSSL:         config.EnvOr("S3_USE_SSL", "false") == "true",
			PathStyle:      config.EnvOr("S3_PATH_STYLE", "true") == "true",
		}))
	} else {
		log.Println("S3_ENDPOINT not set — presigned uploads are disabled (503) until configured")
	}

	go func() {
		// Run an immediate sweep on startup to process overdue deadlines.
		server.SweepRetention(schedCtx)
		ticker := time.NewTicker(retentionInterval)
		defer ticker.Stop()
		for {
			select {
			case <-schedCtx.Done():
				return
			case <-ticker.C:
				server.SweepRetention(schedCtx)
			}
		}
	}()
	log.Printf("retention sweep every %s — races are deleted %d days after they end", retentionInterval, api.RetentionDays)

	addr := ":" + config.EnvOr("PORT", "8080")
	httpServer := &http.Server{
		Addr:         addr,
		Handler:      server.Router,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 30 * time.Second, // longer to accommodate websocket upgrades
	}

	stopCtx, stop := signal.NotifyContext(ctx, os.Interrupt, syscall.SIGTERM)
	defer stop()

	serveErr := make(chan error, 1)
	go func() {
		log.Printf("runway server listening on %s", addr)
		serveErr <- httpServer.ListenAndServe()
	}()

	select {
	case err := <-serveErr:
		if err != nil && err != http.ErrServerClosed {
			log.Fatalf("server exited: %v", err)
		}
	case <-stopCtx.Done():
		log.Println("shutting down: stopping scheduler and draining in-flight requests")
		cancelSched()
		shutdownCtx, cancelShutdown := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancelShutdown()
		if err := httpServer.Shutdown(shutdownCtx); err != nil {
			log.Printf("server shutdown error: %v", err)
		}
	}
}

// aiRefereeAvailable reports whether this deployment can offer LLM grading.
// Requires a valid workerToken and RUNWAY_AI_REFEREE configuration.
func aiRefereeAvailable(workerToken string) bool {
	if workerToken == "" {
		return false
	}
	// Treat non-empty values as enabled unless explicitly set to a negative value.
	if v := strings.TrimSpace(os.Getenv("RUNWAY_AI_REFEREE")); v != "" {
		switch strings.ToLower(v) {
		case "0", "false", "no", "off":
			return false
		default:
			return true
		}
	}
	// Check for supported LLM provider API keys in order of precedence.
	for _, key := range []string{"SCALEWAY_API_KEY", "SCW_SECRET_KEY", "GEMINI_API_KEY"} {
		if os.Getenv(key) != "" {
			return true
		}
	}
	return false
}

// analyticsEnabled reports whether usage analytics recording is explicitly enabled.
func analyticsEnabled() bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv("RUNWAY_ANALYTICS"))) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}

// randomKey generates a cryptographically secure random key.
func randomKey() string {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		log.Fatalf("failed to generate a random key: %v", err)
	}
	return hex.EncodeToString(buf)
}
