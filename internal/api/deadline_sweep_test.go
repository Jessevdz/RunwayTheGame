package api_test

import (
	"testing"
)

// TestDeadlineSweepEndsCoinRushWithWinner tests that a coin rush past its deadline is ended with a uuid winner recorded.
func TestDeadlineSweepEndsCoinRushWithWinner(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	defer database.Close()

	r, teams := newCoinRush(t, ctx, database, nil, "Sprinter", "Detour")
	if _, err := database.Pool.Exec(ctx, `UPDATE games SET ends_at = NOW() - INTERVAL '1 minute' WHERE id = $1`, r.GameID); err != nil {
		t.Fatalf("failed to expire the race: %v", err)
	}

	r.server.SweepRetention(ctx)

	status, winner := gameRow(t, ctx, database, r.GameID)
	if status != "ended" {
		t.Fatalf("expected the sweep to end the race, got %q", status)
	}
	if winner == nil {
		t.Fatalf("expected a winner to be recorded for the coin rush")
	}
	if *winner != teams[0].ID && *winner != teams[1].ID {
		t.Errorf("expected the winner to be one of the squads, got %q", *winner)
	}
}
