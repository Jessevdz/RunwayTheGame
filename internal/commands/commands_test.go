package commands

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v4"

	"github.com/Jessevdz/RunwayTheGame/internal/db"
	"github.com/Jessevdz/RunwayTheGame/internal/eventstore"
	"github.com/Jessevdz/RunwayTheGame/internal/testsupport"
)

// getTestDB initializes a database connection for testing commands.
func getTestDB(t *testing.T) (*db.DB, context.Context) {
	return testsupport.DB(t, "commands")
}

func TestIdempotencyAndOutbox(t *testing.T) {
	database, ctx := getTestDB(t)
	defer database.Close()

	gameID := "00000000-0000-0000-0000-000000000003"
	idemKey := "key-idemp-1"

	// Clean up old events & idempotent commands & jobs
	_, _ = database.Pool.Exec(ctx, "DELETE FROM events WHERE game_id = $1", gameID)
	_, _ = database.Pool.Exec(ctx, "DELETE FROM idempotent_commands WHERE game_id = $1", gameID)
	_, _ = database.Pool.Exec(ctx, "DELETE FROM jobs WHERE trace_id = $1", "commands-test-trace")

	processor := NewCommandProcessor(database)

	handlerCalledCount := 0
	handler := func(ctx context.Context, tx pgx.Tx, req CommandRequest) (*CommandResult, error) {
		handlerCalledCount++
		event := eventstore.Event{
			GameID:  req.GameID,
			Type:    "TeamJoined",
			Payload: `{"team_id":"red"}`,
			TraceID: req.IdempotencyKey,
		}
		job := JobOutboxEntry{
			Type:    "verify_submission",
			Payload: map[string]string{"foo": "bar"},
		}
		return &CommandResult{
			ResponseCode: 200,
			ResponseBody: map[string]string{"status": "joined"},
			Events:       []eventstore.Event{event},
			Jobs:         []JobOutboxEntry{job},
		}, nil
	}

	req := CommandRequest{
		IdempotencyKey: idemKey,
		GameID:         gameID,
		CommandType:    "JoinTeam",
		ExpectedSeq:    1,
		Payload:        []byte(`{}`),
	}

	// Initial command processing execution
	resp, err := processor.Process(ctx, req, handler)
	if err != nil {
		t.Fatalf("failed to process first command: %v", err)
	}

	if resp.ResponseCode != 200 {
		t.Errorf("expected 200, got %d", resp.ResponseCode)
	}

	if handlerCalledCount != 1 {
		t.Errorf("expected handler called once, got %d", handlerCalledCount)
	}

	// Replay execution with the same key to verify cached response replay
	resp2, err := processor.Process(ctx, req, handler)
	if err != nil {
		t.Fatalf("failed to process second command: %v", err)
	}

	if resp2.ResponseCode != 200 {
		t.Errorf("expected 200, got %d", resp2.ResponseCode)
	}

	if handlerCalledCount != 1 {
		t.Errorf("expected handler called count to remain 1, got %d", handlerCalledCount)
	}

	// Verify events in database (should only have 1 event)
	var eventCount int
	err = database.Pool.QueryRow(ctx, "SELECT COUNT(*) FROM events WHERE game_id = $1", gameID).Scan(&eventCount)
	if err != nil {
		t.Fatalf("failed to count events: %v", err)
	}
	if eventCount != 1 {
		t.Errorf("expected exactly 1 event, got %d", eventCount)
	}

	// Verify outbox jobs in database (should only have 1 job)
	var jobCount int
	err = database.Pool.QueryRow(ctx, "SELECT COUNT(*) FROM jobs WHERE trace_id = $1", "commands-test-trace").Scan(&jobCount)
	if err != nil {
		t.Fatalf("failed to count jobs: %v", err)
	}
	if jobCount != 1 {
		t.Errorf("expected exactly 1 job in outbox, got %d", jobCount)
	}
}
