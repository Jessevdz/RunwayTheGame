// Command worker runs the verification worker pool that polls jobs, evaluates
// evidence, and submits verdicts to the API server. It is stateless with respect to game rules.
package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/Jessevdz/RunwayTheGame/internal/blobstore"
	"github.com/Jessevdz/RunwayTheGame/internal/config"
	"github.com/Jessevdz/RunwayTheGame/internal/db"
	"github.com/Jessevdz/RunwayTheGame/internal/verification"
)

// jobTimeout bounds a single ProcessNextJob call so hung jobs do not delay shutdown indefinitely.
const jobTimeout = 2 * time.Minute

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

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

	blobBaseURL := config.EnvOr("BLOB_DOWNLOAD_BASE_URL", "http://localhost:9000/runway-evidence")
	blobStore := blobstore.NewHTTPBlobStore(blobBaseURL)

	scalewayClient := verification.NewLiveScalewayClient()

	apiBaseURL := config.EnvOr("RUNWAY_API_BASE_URL", "http://localhost:8080")
	workerToken := os.Getenv("RUNWAY_WORKER_TOKEN")
	if workerToken == "" {
		log.Fatal("RUNWAY_WORKER_TOKEN is not set — the server rejects unauthenticated verdicts, so every job would fail")
	}
	w := verification.NewWorker(database, blobStore, scalewayClient, apiBaseURL, workerToken)

	pollInterval := time.Duration(config.EnvIntOr("WORKER_POLL_INTERVAL_MS", 500)) * time.Millisecond
	log.Printf("verification worker started (api=%s, poll=%s)", apiBaseURL, pollInterval)

	runLoop(ctx, w, pollInterval)
	log.Println("verification worker stopped")
}

// jobProcessor defines the subset of verification.Worker required by runLoop for testing without a database.
type jobProcessor interface {
	ProcessNextJob(ctx context.Context) (bool, error)
}

// runLoop continuously polls the outbox until ctx is canceled.
// Each job runs under a detached context with jobTimeout to ensure processing finishes cleanly.
func runLoop(ctx context.Context, w jobProcessor, pollInterval time.Duration) {
	for {
		if ctx.Err() != nil {
			return
		}

		jobCtx, cancelJob := context.WithTimeout(context.WithoutCancel(ctx), jobTimeout)
		processed, err := w.ProcessNextJob(jobCtx)
		cancelJob()

		if err != nil {
			log.Printf("worker error: %v", err)
		} else if processed {
			// Another job may already be waiting; poll again without pausing.
			continue
		}

		select {
		case <-ctx.Done():
			return
		case <-time.After(pollInterval):
		}
	}
}
