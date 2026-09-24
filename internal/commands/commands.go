// Package commands provides command routing, transaction execution, idempotency checking, and event outbox processing.
package commands

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgconn"
	"github.com/jackc/pgx/v4"

	"github.com/Jessevdz/RunwayTheGame/internal/db"
	"github.com/Jessevdz/RunwayTheGame/internal/eventstore"
	"github.com/Jessevdz/RunwayTheGame/internal/logger"
)

// CommandRequest represents the incoming command envelope.
type CommandRequest struct {
	IdempotencyKey string
	PrincipalID    string
	// IdempotencyPayload contains the stable caller payload when Payload includes
	// server-generated values such as a submission or game ID.
	IdempotencyPayload []byte
	GameID             string
	CommandType        string
	ExpectedSeq        int
	Payload            []byte
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
	// CachedResponseBody omits short-lived capabilities while the live response
	// can still return them to the caller that created them.
	CachedResponseBody interface{}
	Events             []eventstore.Event
	Jobs               []JobOutboxEntry
}

var ErrIdempotencyConflict = errors.New("idempotency key was already used with a different payload")

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
// Serialization failures and unique violations from transactional handlers are
// retried with a fresh transaction. A sequence mismatch remains a caller-visible
// conflict so the caller can rebuild decisions from a fresh projection.
func (cp *CommandProcessor) Process(ctx context.Context, req CommandRequest, handler CommandHandler) (CommandResponse, error) {
	for attempt := 0; attempt < 3; attempt++ {
		response, err := cp.processOnce(ctx, req, handler)
		if err == nil {
			return response, nil
		}
		if !isRetryableDatabaseConflict(err) || attempt == 2 {
			return CommandResponse{}, err
		}
		logger.Warn(ctx, "Retrying command after a database concurrency conflict", map[string]interface{}{
			"attempt": attempt + 1, "command_type": req.CommandType,
		})
	}
	return CommandResponse{}, eventstore.ErrConcurrencyConflict
}

func isRetryableDatabaseConflict(err error) bool {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		return false
	}
	return pgErr.Code == "23505" || pgErr.Code == "40001"
}

func (cp *CommandProcessor) processOnce(ctx context.Context, req CommandRequest, handler CommandHandler) (CommandResponse, error) {
	principalID := req.PrincipalID
	if principalID == "" {
		principalID = "system"
	}
	payloadToHash := req.IdempotencyPayload
	if payloadToHash == nil {
		payloadToHash = req.Payload
	}
	payloadHash := sha256.Sum256(payloadToHash)
	payloadHashText := hex.EncodeToString(payloadHash[:])
	lookupCached := func(queryer interface {
		QueryRow(context.Context, string, ...interface{}) pgx.Row
	}) (CommandResponse, bool, error) {
		var cachedBody []byte
		var cachedHash string
		err := queryer.QueryRow(ctx, `
			SELECT response_body, payload_hash FROM idempotent_commands
			WHERE game_id = $1 AND principal_id = $2 AND command_type = $3 AND key = $4
		`, req.GameID, principalID, req.CommandType, req.IdempotencyKey).Scan(&cachedBody, &cachedHash)
		if errors.Is(err, pgx.ErrNoRows) {
			return CommandResponse{}, false, nil
		}
		if err != nil {
			return CommandResponse{}, false, err
		}
		if cachedHash != payloadHashText {
			return CommandResponse{}, false, ErrIdempotencyConflict
		}
		var cachedResponse CommandResponse
		if err := json.Unmarshal(cachedBody, &cachedResponse); err != nil {
			return CommandResponse{}, false, fmt.Errorf("failed to unmarshal cached response: %w", err)
		}
		return cachedResponse, true, nil
	}
	if req.IdempotencyKey != "" {
		cached, ok, err := lookupCached(cp.db.Pool)
		if err != nil {
			return CommandResponse{}, eventstore.WrapConflict(fmt.Errorf("failed to check idempotency key: %w", err))
		}
		if ok {
			logger.Info(ctx, "Idempotent command replayed from cache", map[string]interface{}{"key": req.IdempotencyKey, "command_type": req.CommandType})
			return cached, nil
		}
	}

	var tx pgx.Tx
	if req.IdempotencyKey != "" {
		// Use a session lock before opening the serializable transaction. A
		// transaction-scoped lock would take its snapshot before waiting and
		// could miss the first request's committed cache row after the wait.
		conn, err := cp.db.Pool.Acquire(ctx)
		if err != nil {
			return CommandResponse{}, eventstore.WrapConflict(fmt.Errorf("failed to acquire idempotency connection: %w", err))
		}
		lockKeyBytes, _ := json.Marshal([]string{req.GameID, principalID, req.CommandType, req.IdempotencyKey})
		lockKey := string(lockKeyBytes)
		if _, err := conn.Exec(ctx, `SELECT pg_advisory_lock(hashtextextended($1, 0))`, lockKey); err != nil {
			conn.Release()
			return CommandResponse{}, fmt.Errorf("failed to lock idempotency key: %w", err)
		}
		tx, err = conn.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
		if err != nil {
			_, _ = conn.Exec(context.Background(), `SELECT pg_advisory_unlock(hashtextextended($1, 0))`, lockKey)
			conn.Release()
			return CommandResponse{}, eventstore.WrapConflict(fmt.Errorf("failed to begin transaction: %w", err))
		}
		defer func() {
			_ = tx.Rollback(ctx)
			_, _ = conn.Exec(context.Background(), `SELECT pg_advisory_unlock(hashtextextended($1, 0))`, lockKey)
			conn.Release()
		}()
	} else {
		var err error
		tx, err = cp.db.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
		if err != nil {
			return CommandResponse{}, eventstore.WrapConflict(fmt.Errorf("failed to begin transaction: %w", err))
		}
		defer tx.Rollback(ctx)
	}
	if req.IdempotencyKey != "" {
		cached, ok, err := lookupCached(tx)
		if err != nil {
			return CommandResponse{}, eventstore.WrapConflict(fmt.Errorf("failed to check idempotency key: %w", err))
		}
		if ok {
			if err := tx.Commit(ctx); err != nil {
				return CommandResponse{}, fmt.Errorf("failed to commit idempotent replay: %w", err)
			}
			return cached, nil
		}
	}

	res, err := handler(ctx, tx, req)
	if err != nil {
		err = eventstore.WrapConflict(err)
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
			INSERT INTO jobs (id, game_id, job_type, payload, trace_id)
			VALUES ($1, $2, $3, $4, $5)
		`, jobID, req.GameID, job.Type, jobPayloadBytes, traceID)
		if err != nil {
			return CommandResponse{}, eventstore.WrapConflict(fmt.Errorf("failed to insert job outbox entry: %w", err))
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

	cacheResponse := cmdResponse
	if res.CachedResponseBody != nil {
		cacheResponse.ResponseBody, err = json.Marshal(res.CachedResponseBody)
		if err != nil {
			return CommandResponse{}, fmt.Errorf("failed to marshal cached response body: %w", err)
		}
	}
	responseBytes, err := json.Marshal(cacheResponse)
	if err != nil {
		return CommandResponse{}, fmt.Errorf("failed to marshal command response: %w", err)
	}

	if req.IdempotencyKey != "" {
		_, err = tx.Exec(ctx, `
			INSERT INTO idempotent_commands (key, game_id, principal_id, command_type, payload_hash, response_body)
			VALUES ($1, $2, $3, $4, $5, $6)
		`, req.IdempotencyKey, req.GameID, principalID, req.CommandType, payloadHashText, responseBytes)
		if err != nil {
			return CommandResponse{}, eventstore.WrapConflict(fmt.Errorf("failed to insert idempotent command: %w", err))
		}
	}

	// Commit transaction and map serialization conflicts to concurrency errors.
	err = tx.Commit(ctx)
	if err != nil {
		return CommandResponse{}, eventstore.WrapConflict(fmt.Errorf("failed to commit transaction: %w", err))
	}

	if len(res.Events) > 0 && cp.OnCommit != nil {
		cp.OnCommit(ctx, req.GameID)
	}

	return cmdResponse, nil
}
