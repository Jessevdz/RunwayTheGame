// Package commands provides command routing, transaction execution, idempotency checking, and event outbox processing.
package commands

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v4"

	"github.com/Jessevdz/RunwayTheGame/internal/db"
	"github.com/Jessevdz/RunwayTheGame/internal/eventstore"
	"github.com/Jessevdz/RunwayTheGame/internal/logger"
)

// CommandRequest represents the incoming command envelope.
type CommandRequest struct {
	IdempotencyKey string
	GameID         string
	CommandType    string
	ExpectedSeq    int
	Payload        []byte
}

// CommandResponse represents the outgoing command response envelope.
type CommandResponse struct {
	ResponseCode int             `json:"response_code"`
	ResponseBody json.RawMessage `json:"response_body"`
}

// JobOutboxEntry represents a job to be enqueued in the same transaction.
type JobOutboxEntry struct {
	Type    string
	Payload interface{}
}

// CommandResult is the output from a command execution.
type CommandResult struct {
	ResponseCode int
	ResponseBody interface{}
	Events       []eventstore.Event
	Jobs         []JobOutboxEntry
}

// CommandHandler is a function that executes a command payload.
type CommandHandler func(ctx context.Context, tx pgx.Tx, req CommandRequest) (*CommandResult, error)

// CommandProcessor handles command routing, transactions, and idempotency.
type CommandProcessor struct {
	db *db.DB

	// OnCommit, if non-nil, is invoked after a command successfully commits new events for a game.
	OnCommit func(ctx context.Context, gameID string)
}

// NewCommandProcessor creates a new CommandProcessor.
func NewCommandProcessor(database *db.DB) *CommandProcessor {
	return &CommandProcessor{db: database}
}

// Process executes a command within a serializable transaction with idempotency caching and event logging.
func (cp *CommandProcessor) Process(ctx context.Context, req CommandRequest, handler CommandHandler) (CommandResponse, error) {
	if req.IdempotencyKey != "" {
		var cachedBody []byte
		err := cp.db.Pool.QueryRow(ctx, `
			SELECT response_body FROM idempotent_commands WHERE game_id = $1 AND key = $2
		`, req.GameID, req.IdempotencyKey).Scan(&cachedBody)
		if err == nil {
			logger.Info(ctx, "Idempotent command replayed from cache", map[string]interface{}{"key": req.IdempotencyKey})
			var cachedResponse CommandResponse
			err = json.Unmarshal(cachedBody, &cachedResponse)
			if err != nil {
				return CommandResponse{}, fmt.Errorf("failed to unmarshal cached response: %w", err)
			}
			return cachedResponse, nil
		}
		if err != pgx.ErrNoRows {
			return CommandResponse{}, fmt.Errorf("failed to check idempotency key: %w", err)
		}
	}

	tx, err := cp.db.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return CommandResponse{}, fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	res, err := handler(ctx, tx, req)
	if err != nil {
		logger.Error(ctx, "Command handler failed", map[string]interface{}{"error": err.Error(), "type": req.CommandType})
		return CommandResponse{}, err
	}

	if len(res.Events) > 0 {
		err = eventstore.AppendEvents(ctx, tx, req.GameID, req.ExpectedSeq, res.Events)
		if err != nil {
			logger.Warn(ctx, "Failed to append events, rolling back", map[string]interface{}{"error": err.Error()})
			return CommandResponse{}, err
		}
	}

	for _, job := range res.Jobs {
		jobPayloadBytes, err := json.Marshal(job.Payload)
		if err != nil {
			return CommandResponse{}, fmt.Errorf("failed to marshal job payload: %w", err)
		}

		jobID := uuid.New().String()
		traceID := logger.GetTraceID(ctx)

		_, err = tx.Exec(ctx, `
			INSERT INTO jobs (id, job_type, payload, trace_id)
			VALUES ($1, $2, $3, $4)
		`, jobID, job.Type, jobPayloadBytes, traceID)
		if err != nil {
			return CommandResponse{}, fmt.Errorf("failed to insert job outbox entry: %w", err)
		}
	}

	resBodyBytes, err := json.Marshal(res.ResponseBody)
	if err != nil {
		return CommandResponse{}, fmt.Errorf("failed to marshal response body: %w", err)
	}

	cmdResponse := CommandResponse{
		ResponseCode: res.ResponseCode,
		ResponseBody: resBodyBytes,
	}

	responseBytes, err := json.Marshal(cmdResponse)
	if err != nil {
		return CommandResponse{}, fmt.Errorf("failed to marshal command response: %w", err)
	}

	if req.IdempotencyKey != "" {
		_, err = tx.Exec(ctx, `
			INSERT INTO idempotent_commands (key, game_id, response_body)
			VALUES ($1, $2, $3)
		`, req.IdempotencyKey, req.GameID, responseBytes)
		if err != nil {
			return CommandResponse{}, fmt.Errorf("failed to insert idempotent command: %w", err)
		}
	}

	// Commit transaction and map serialization conflicts to concurrency errors.
	err = tx.Commit(ctx)
	if err != nil {
		if conflict := eventstore.WrapConflict(err); errors.Is(conflict, eventstore.ErrConcurrencyConflict) {
			return CommandResponse{}, conflict
		}
		return CommandResponse{}, fmt.Errorf("failed to commit transaction: %w", err)
	}

	if len(res.Events) > 0 && cp.OnCommit != nil {
		cp.OnCommit(ctx, req.GameID)
	}

	return cmdResponse, nil
}
