package projections

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/Jessevdz/RunwayTheGame/internal/eventstore"
)

// rebuildFrom appends an event stream for a test game and returns the rebuilt projection.
func rebuildFrom(t *testing.T, types []string, payloads []interface{}) *GameStateProjection {
	t.Helper()
	database, ctx := getTestDB(t)
	if database == nil {
		return nil
	}
	t.Cleanup(func() { database.Close() })

	gameID := uuid.New().String()
	created, ok := payloads[0].(eventstore.GameCreatedPayload)
	if !ok {
		t.Fatalf("first test event must be GameCreatedPayload")
	}
	version := created.BoardVersion
	if version < 1 {
		version = 1
	}
	if _, err := database.Pool.Exec(ctx, `
		INSERT INTO boards (id, version, name) VALUES ($1, $2, 'Projection status fixture')
		ON CONFLICT (id, version) DO NOTHING
	`, created.BoardID, version); err != nil {
		t.Fatalf("failed to insert fixture board: %v", err)
	}
	if _, err := database.Pool.Exec(ctx, `
		INSERT INTO games (id, board_id, board_version, ruleset, starts_at, ends_at)
		VALUES ($1, $2, $3, '{}', $4, $5)
	`, gameID, created.BoardID, version, time.Now().UTC(), time.Now().UTC().Add(time.Hour)); err != nil {
		t.Fatalf("failed to insert fixture game: %v", err)
	}
	t.Cleanup(func() {
		_, _ = database.Pool.Exec(ctx, "DELETE FROM events WHERE game_id = $1", gameID)
		_, _ = database.Pool.Exec(ctx, "DELETE FROM games WHERE id = $1", gameID)
		_, _ = database.Pool.Exec(ctx, "DELETE FROM boards WHERE id = $1 AND version = $2", created.BoardID, version)
	})

	events := make([]eventstore.Event, 0, len(types))
	for i, typ := range types {
		body, _ := json.Marshal(payloads[i])
		events = append(events, eventstore.Event{GameID: gameID, Sequence: i + 1, Type: typ, Payload: string(body)})
	}
	if err := eventstore.AppendEvents(ctx, database.Pool, gameID, 1, events); err != nil {
		t.Fatalf("failed to append events: %v", err)
	}

	p, err := RebuildProjection(ctx, database.Pool, gameID, 0)
	if err != nil {
		t.Fatalf("failed to rebuild projection: %v", err)
	}
	return p
}

func TestProjectionStatusFollowsTheLifecycle(t *testing.T) {
	boardID := uuid.New().String()

	draft := rebuildFrom(t,
		[]string{"GameCreated", "TeamJoined"},
		[]interface{}{
			eventstore.GameCreatedPayload{BoardID: boardID},
			eventstore.TeamJoinedPayload{TeamID: "red", Name: "Red Team", SlotIndex: 0},
		})
	if draft == nil {
		return
	}
	if draft.Status != "draft" {
		t.Errorf("a game that has not started should be draft, got %q", draft.Status)
	}

	live := rebuildFrom(t,
		[]string{"GameCreated", "TeamJoined", "GameStarted"},
		[]interface{}{
			eventstore.GameCreatedPayload{BoardID: boardID},
			eventstore.TeamJoinedPayload{TeamID: "red", Name: "Red Team", SlotIndex: 0},
			struct{}{},
		})
	if live.Status != "live" {
		t.Errorf("a started game should be live, got %q", live.Status)
	}

	ended := rebuildFrom(t,
		[]string{"GameCreated", "TeamJoined", "GameStarted", "GameEnded"},
		[]interface{}{
			eventstore.GameCreatedPayload{BoardID: boardID},
			eventstore.TeamJoinedPayload{TeamID: "red", Name: "Red Team", SlotIndex: 0},
			struct{}{},
			eventstore.GameEndedPayload{WinnerTeamID: "red"},
		})
	if ended.Status != "ended" {
		t.Errorf("a finished game should be ended, got %q", ended.Status)
	}
}

// TestTeamNameCannotForgeTheLifecycle verifies that team names matching lifecycle logs do not alter game status.
func TestTeamNameCannotForgeTheLifecycle(t *testing.T) {
	p := rebuildFrom(t,
		[]string{"GameCreated", "TeamJoined"},
		[]interface{}{
			eventstore.GameCreatedPayload{BoardID: uuid.New().String()},
			eventstore.TeamJoinedPayload{TeamID: "sneaky", Name: "Game started", SlotIndex: 0},
		})
	if p == nil {
		return
	}
	if p.Status != "draft" {
		t.Fatalf("a team named %q flipped the game to %q", "Game started", p.Status)
	}
}
