package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/Jessevdz/RunwayTheGame/internal/commands"
	"github.com/Jessevdz/RunwayTheGame/internal/eventstore"
)

// writeConcurrencyConflict reports stale command snapshots as a retryable
// conflict so callers refresh state instead of committing a decision made
// against an older projection.
func writeConcurrencyConflict(ctx context.Context, w http.ResponseWriter, err error) bool {
	if errors.Is(err, commands.ErrIdempotencyConflict) {
		writeError(ctx, w, http.StatusConflict, "idempotency key was already used for a different request")
		return true
	}
	if !errors.Is(err, eventstore.ErrConcurrencyConflict) {
		return false
	}
	writeError(ctx, w, http.StatusConflict, "game state changed; refresh and retry")
	return true
}

func writeCommandResponse(ctx context.Context, w http.ResponseWriter, response commands.CommandResponse) {
	writeRawJSON(ctx, w, response.ResponseCode, response.ResponseBody)
}

func idempotencyPayload(value interface{}) []byte {
	payload, _ := json.Marshal(value)
	return payload
}
