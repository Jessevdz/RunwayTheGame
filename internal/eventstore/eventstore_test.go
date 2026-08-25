package eventstore

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v4"

	"github.com/Jessevdz/RunwayTheGame/internal/db"
	"github.com/Jessevdz/RunwayTheGame/internal/testsupport"
)

func getTestDB(t *testing.T) (*db.DB, context.Context) {
	return testsupport.DB(t, "eventstore")
}

func TestEventStoreConcurrencyAndStream(t *testing.T) {
	database, ctx := getTestDB(t)
	defer database.Close()

	gameID := "00000000-0000-0000-0000-000000000001"

	// Clean up old events for this test game
	_, err := database.Pool.Exec(ctx, "DELETE FROM events WHERE game_id = $1", gameID)
	if err != nil {
		t.Fatalf("failed to clean up events: %v", err)
	}

	tx, err := database.Pool.Begin(ctx)
	if err != nil {
		t.Fatalf("failed to begin transaction: %v", err)
	}
	defer tx.Rollback(ctx)

	// Append event at sequence 1 (expectedSeq = 1, currentSeq must be 0)
	events := []Event{
		{
			GameID:    gameID,
			Type:      "GameCreated",
			Payload:   `{"board_id":"board-abc"}`,
			TraceID:   "trace-1",
			CreatedAt: time.Now().UTC(),
		},
	}

	err = AppendEvents(ctx, tx, gameID, 1, events)
	if err != nil {
		t.Fatalf("failed to append first event: %v", err)
	}

	// Try to append another event at expectedSeq = 1 (should fail with concurrency conflict)
	err = AppendEvents(ctx, tx, gameID, 1, []Event{
		{
			GameID:  gameID,
			Type:    "TeamJoined",
			Payload: `{"team_id":"team-red"}`,
			TraceID: "trace-2",
		},
	})
	if !errors.Is(err, ErrConcurrencyConflict) {
		t.Fatalf("expected concurrency conflict error, got: %v", err)
	}

	// Try to append at expectedSeq = 3 (gap in sequence, should fail with concurrency conflict)
	err = AppendEvents(ctx, tx, gameID, 3, []Event{
		{
			GameID:  gameID,
			Type:    "TeamJoined",
			Payload: `{"team_id":"team-red"}`,
			TraceID: "trace-3",
		},
	})
	if !errors.Is(err, ErrConcurrencyConflict) {
		t.Fatalf("expected concurrency conflict error, got: %v", err)
	}

	// Append at expectedSeq = 2 (correct sequence)
	err = AppendEvents(ctx, tx, gameID, 2, []Event{
		{
			GameID:  gameID,
			Type:    "TeamJoined",
			Payload: `{"team_id":"team-red"}`,
			TraceID: "trace-4",
		},
	})
	if err != nil {
		t.Fatalf("failed to append second event: %v", err)
	}

	err = tx.Commit(ctx)
	if err != nil {
		t.Fatalf("failed to commit: %v", err)
	}

	// Verify we can fetch the stream
	tx2, err := database.Pool.Begin(ctx)
	if err != nil {
		t.Fatalf("failed to begin read transaction: %v", err)
	}
	defer tx2.Rollback(ctx)

	stream, err := GetEventStream(ctx, tx2, gameID, 0)
	if err != nil {
		t.Fatalf("failed to fetch event stream: %v", err)
	}

	if len(stream) != 2 {
		t.Fatalf("expected stream length 2, got %d", len(stream))
	}

	if stream[0].Sequence != 1 || stream[0].Type != "GameCreated" {
		t.Errorf("incorrect event at sequence 1: %+v", stream[0])
	}
	if stream[1].Sequence != 2 || stream[1].Type != "TeamJoined" {
		t.Errorf("incorrect event at sequence 2: %+v", stream[1])
	}
}

// TestConcurrentAppendReportsConflict verifies that concurrent appends racing under
// Serializable isolation report ErrConcurrencyConflict when a sequence primary key collision occurs.
func TestConcurrentAppendReportsConflict(t *testing.T) {
	database, ctx := getTestDB(t)
	defer database.Close()

	gameID := "00000000-0000-0000-0000-000000000002"
	if _, err := database.Pool.Exec(ctx, "DELETE FROM events WHERE game_id = $1", gameID); err != nil {
		t.Fatalf("failed to clean up events: %v", err)
	}

	event := func(trace string) []Event {
		return []Event{{GameID: gameID, Type: "WaypointReached", Payload: `{"team_id":"team-red"}`, TraceID: trace}}
	}

	txA, err := database.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		t.Fatalf("failed to begin first transaction: %v", err)
	}
	defer txA.Rollback(ctx)

	txB, err := database.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		t.Fatalf("failed to begin second transaction: %v", err)
	}
	defer txB.Rollback(ctx)

	// Both aim at sequence 1 and both see MAX(sequence) = 0, so both get past the
	// pre-check. Only one of them can hold the row.
	if err := AppendEvents(ctx, txA, gameID, 1, event("trace-a")); err != nil {
		t.Fatalf("first append should have succeeded: %v", err)
	}
	if err := txA.Commit(ctx); err != nil {
		t.Fatalf("failed to commit the winner: %v", err)
	}

	err = AppendEvents(ctx, txB, gameID, 1, event("trace-b"))
	if err == nil {
		t.Fatal("the losing append should have failed")
	}
	if !errors.Is(err, ErrConcurrencyConflict) {
		t.Fatalf("the loser must report a concurrency conflict so the caller retries, got: %v", err)
	}
}
