// Package testsupport provides isolated per-package test database instances (runway_test_<pkg>)
// to ensure clean test state and prevent lock contention during parallel package execution.
package testsupport

import (
	"context"
	"fmt"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/Jessevdz/RunwayTheGame/internal/config"
	"github.com/Jessevdz/RunwayTheGame/internal/db"
	"github.com/Jessevdz/RunwayTheGame/internal/logger"
)

// resetOnce guards the one-time wipe per test binary. Each package is its own
// binary, so this is per-package by construction.
var resetOnce sync.Once

// baseConfig reads database connection settings from the environment.
func baseConfig() db.Config {
	return db.Config{
		Host:     config.EnvOr("RUNWAY_DB_HOST", "localhost"),
		Port:     config.EnvIntOr("RUNWAY_DB_PORT", 5433),
		User:     config.EnvOr("RUNWAY_DB_USER", "postgres"),
		Password: config.EnvOr("RUNWAY_DB_PASSWORD", "password"),
		SSLMode:  "disable",
	}
}

// unavailable handles database connection failures by skipping the test, or
// failing it when RUNWAY_REQUIRE_DB is set.
func unavailable(t *testing.T, format string, args ...any) {
	t.Helper()
	msg := fmt.Sprintf(format, args...)
	if os.Getenv("RUNWAY_REQUIRE_DB") != "" {
		t.Fatalf("RUNWAY_REQUIRE_DB is set, so this cannot be skipped: %s", msg)
		return
	}
	t.Skipf("skipping integration test: %s", msg)
}

// DatabaseName returns the isolated test database name for a given package.
func DatabaseName(pkg string) string {
	return fmt.Sprintf("%s_test_%s", config.EnvOr("RUNWAY_DB_NAME", "runway"), pkg)
}

// DB initializes, migrates, and returns an isolated test database connection
// for the package. It returns a nil DB and skips or fails the test if Postgres is unreachable.
func DB(t *testing.T, pkg string) (*db.DB, context.Context) {
	t.Helper()
	ctx := logger.WithTrace(context.Background(), pkg+"-test-trace")

	cfg := baseConfig()
	cfg.Database = DatabaseName(pkg)

	if err := ensureDatabase(ctx, cfg); err != nil {
		unavailable(t, "database not running: %v", err)
		return nil, nil
	}

	var database *db.DB
	var err error
	for i := 0; i < 3; i++ {
		database, err = db.NewPool(ctx, cfg)
		if err == nil {
			break
		}
		time.Sleep(time.Second)
	}
	if err != nil {
		unavailable(t, "database not running: %v", err)
		return nil, nil
	}

	if err := database.Migrate(ctx); err != nil {
		database.Close()
		unavailable(t, "failed to migrate test database: %v", err)
		return nil, nil
	}

	var resetErr error
	resetOnce.Do(func() { resetErr = truncateAll(ctx, database) })
	if resetErr != nil {
		database.Close()
		t.Fatalf("failed to reset test database %s: %v", cfg.Database, resetErr)
		return nil, nil
	}

	t.Cleanup(database.Close)
	return database, ctx
}

// ensureDatabase creates the per-package database if it does not already exist.
func ensureDatabase(ctx context.Context, cfg db.Config) error {
	adminCfg := cfg
	adminCfg.Database = "postgres"

	admin, err := db.NewPool(ctx, adminCfg)
	if err != nil {
		return err
	}
	defer admin.Close()

	var exists bool
	if err := admin.Pool.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1)", cfg.Database).Scan(&exists); err != nil {
		return fmt.Errorf("failed to look up test database: %w", err)
	}
	if exists {
		return nil
	}

	// CREATE DATABASE cannot be parameterised or run in a transaction. The name
	// is built from a literal prefix and a package identifier, never user input.
	if _, err := admin.Pool.Exec(ctx, fmt.Sprintf("CREATE DATABASE %q", cfg.Database)); err != nil {
		// Another package's binary may have won the race between the check
		// above and here; that is a success for our purposes.
		var nowExists bool
		if qErr := admin.Pool.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1)", cfg.Database).Scan(&nowExists); qErr == nil && nowExists {
			return nil
		}
		return fmt.Errorf("failed to create test database %s: %w", cfg.Database, err)
	}
	return nil
}

// truncateAll empties all database tables to ensure clean test execution.
func truncateAll(ctx context.Context, database *db.DB) error {
	rows, err := database.Pool.Query(ctx, `
		SELECT tablename FROM pg_tables
		WHERE schemaname = 'public' AND tablename <> 'spatial_ref_sys'
	`)
	if err != nil {
		return fmt.Errorf("failed to list tables: %w", err)
	}
	defer rows.Close()

	var tables []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return err
		}
		tables = append(tables, fmt.Sprintf("%q", name))
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if len(tables) == 0 {
		return nil
	}

	stmt := "TRUNCATE TABLE " + strings.Join(tables, ", ") + " CASCADE"
	if _, err := database.Pool.Exec(ctx, stmt); err != nil {
		return fmt.Errorf("failed to truncate: %w", err)
	}
	return nil
}
