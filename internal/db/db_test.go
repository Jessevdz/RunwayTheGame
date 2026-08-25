// Package db's test lives in db_test rather than db so it can use
// internal/testsupport: that package imports internal/db, and an in-package
// test importing it back would be an import cycle. Everything this test touches
// is exported, so the move costs nothing and keeps one definition of "which
// database do tests connect to" for the whole repo.
package db_test

import (
	"testing"

	"github.com/Jessevdz/RunwayTheGame/internal/logger"
	"github.com/Jessevdz/RunwayTheGame/internal/testsupport"
)

func TestDBMigrateAndConnectivity(t *testing.T) {
	// testsupport.DB connects, retries while Postgres warms up, and runs the
	// migration — which is the bulk of what this test is asserting.
	database, ctx := testsupport.DB(t, "db")
	if database == nil {
		return
	}
	logger.Info(ctx, "Database migration executed successfully", nil)

	// Verify we can query the database
	var result int
	if err := database.Pool.QueryRow(ctx, "SELECT 1").Scan(&result); err != nil {
		t.Fatalf("failed to execute simple query SELECT 1: %v", err)
	}
	if result != 1 {
		t.Fatalf("expected 1, got %d", result)
	}
	logger.Info(ctx, "Completed TestDBMigrateAndConnectivity successfully", nil)
}
