package eventstore

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgconn"
	"github.com/jackc/pgx/v4"
)

var (
	ErrConcurrencyConflict = errors.New("optimistic concurrency conflict: sequence mismatch")
)

// DBConnection is an interface that matches methods on both pgx.Tx and pgxpool.Pool.
type DBConnection interface {
	Exec(ctx context.Context, sql string, arguments ...interface{}) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...interface{}) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...interface{}) pgx.Row
}

// AppendEvents appends multiple events to the event log in a transaction.
// It verifies the expected sequence to handle optimistic concurrency.
func AppendEvents(ctx context.Context, conn DBConnection, gameID string, expectedSeq int, events []Event) error {
	var currentSeq int
	err := conn.QueryRow(ctx, "SELECT COALESCE(MAX(sequence), 0) FROM events WHERE game_id = $1", gameID).Scan(&currentSeq)
	if err != nil {
		if isConcurrencyError(err) {
			// Under Serializable isolation, a concurrent write turns this read into
			// a serialization failure, which is returned as a concurrency conflict.
			return fmt.Errorf("%w: could not read the log: %v", ErrConcurrencyConflict, err)
		}
		return fmt.Errorf("failed to fetch current sequence: %w", err)
	}

	if currentSeq != expectedSeq-1 {
		return fmt.Errorf("%w: current sequence is %d, expected %d", ErrConcurrencyConflict, currentSeq, expectedSeq-1)
	}

	// Validate all events before inserting so invalid batches are rejected as a whole.
	for _, e := range events {
		if err := ValidateEvent(e); err != nil {
			return fmt.Errorf("refusing to append an invalid event: %w", err)
		}
	}

	for idx, e := range events {
		seq := expectedSeq + idx
		createdAt := e.CreatedAt
		if createdAt.IsZero() {
			createdAt = time.Now().UTC()
		}

		_, err = conn.Exec(ctx, `
			INSERT INTO events (game_id, sequence, event_type, payload, trace_id, created_at)
			VALUES ($1, $2, $3, $4, $5, $6)
		`, gameID, seq, e.Type, e.Payload, e.TraceID, createdAt)
		if err != nil {
			if isConcurrencyError(err) {
				// Concurrent appends passing the sequence pre-check will fail here on the
				// unique sequence constraint or serialization conflict.
				return fmt.Errorf("%w: sequence %d was taken concurrently: %v", ErrConcurrencyConflict, seq, err)
			}
			return fmt.Errorf("failed to insert event at sequence %d: %w", seq, err)
		}
	}

	return nil
}

// WrapConflict wraps Postgres concurrency and serialization errors as ErrConcurrencyConflict,
// returning all other errors unmodified.
func WrapConflict(err error) error {
	if err != nil && isConcurrencyError(err) {
		return fmt.Errorf("%w: %v", ErrConcurrencyConflict, err)
	}
	return err
}

// isConcurrencyError reports whether err is a Postgres unique violation (23505)
// or serialization failure (40001).
func isConcurrencyError(err error) bool {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		return false
	}
	switch pgErr.Code {
	case "23505", "40001":
		return true
	}
	return false
}

// GetEventStream retrieves events sequentially for a game, optionally capping up to upToSeq.
// If upToSeq <= 0, it retrieves all events.
func GetEventStream(ctx context.Context, conn DBConnection, gameID string, upToSeq int) ([]Event, error) {
	var rows pgx.Rows
	var err error

	if upToSeq > 0 {
		rows, err = conn.Query(ctx, `
			SELECT game_id, sequence, event_type, payload, trace_id, created_at
			FROM events
			WHERE game_id = $1 AND sequence <= $2
			ORDER BY sequence ASC
		`, gameID, upToSeq)
	} else {
		rows, err = conn.Query(ctx, `
			SELECT game_id, sequence, event_type, payload, trace_id, created_at
			FROM events
			WHERE game_id = $1
			ORDER BY sequence ASC
		`, gameID)
	}

	if err != nil {
		return nil, fmt.Errorf("failed to fetch event stream: %w", err)
	}
	defer rows.Close()

	var stream []Event
	for rows.Next() {
		var e Event
		err = rows.Scan(&e.GameID, &e.Sequence, &e.Type, &e.Payload, &e.TraceID, &e.CreatedAt)
		if err != nil {
			return nil, fmt.Errorf("failed to scan event: %w", err)
		}
		stream = append(stream, e)
	}

	return stream, nil
}
