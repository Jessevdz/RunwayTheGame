package jobs

import (
	"context"
	"time"

	"github.com/jackc/pgx/v4"
)

// Job represents a background processing task in the outbox queue.
type Job struct {
	ID           string     `json:"id"`
	Type         string     `json:"job_type"`
	Payload      []byte     `json:"payload"`
	Status       string     `json:"status"` // pending, running, completed, failed
	Attempts     int        `json:"attempts"`
	MaxAttempts  int        `json:"max_attempts"`
	RunAt        time.Time  `json:"run_at"`
	LockedAt     *time.Time `json:"locked_at,omitempty"`
	LockedBy     *string    `json:"locked_by,omitempty"`
	ErrorMessage *string    `json:"error_message,omitempty"`
	TraceID      string     `json:"trace_id"`
	CreatedAt    time.Time  `json:"created_at"`
}

// EnqueueJob inserts a job into the queue within a transaction.
func EnqueueJob(ctx context.Context, tx pgx.Tx, id string, jobType string, payload []byte, traceID string) error {
	_, err := tx.Exec(ctx, `
		INSERT INTO jobs (id, job_type, payload, trace_id)
		VALUES ($1, $2, $3, $4)
	`, id, jobType, payload, traceID)
	return err
}
