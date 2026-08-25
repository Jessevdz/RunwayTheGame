package api

import (
	"context"
	"encoding/json"
	"io"
	"net/http"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v4"

	"github.com/Jessevdz/RunwayTheGame/internal/analytics"
	"github.com/Jessevdz/RunwayTheGame/internal/logger"
)

// analyticsBodyLimit is the maximum request payload size allowed for analytics events.
const analyticsBodyLimit = 16 << 10

// analyticsBatch represents the request payload for a batch of analytics events.
type analyticsBatch struct {
	SessionID string           `json:"session_id"`
	Events    []analyticsEvent `json:"events"`
}

type analyticsEvent struct {
	Name  string         `json:"name"`
	Props map[string]any `json:"props,omitempty"`
}

// SetAnalyticsEnabled configures whether usage metrics collection is active.
func (s *Server) SetAnalyticsEnabled(enabled bool) {
	s.AnalyticsEnabled = enabled
}

// handleIngestAnalytics records an unauthenticated batch of design-side usage events.
func (s *Server) handleIngestAnalytics(w http.ResponseWriter, r *http.Request) {
	// Return No Content silently when analytics is disabled to prevent endpoint probing.
	if !s.AnalyticsEnabled {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	if s.analyticsLimiter != nil && !s.analyticsLimiter.allow(clientIP(r)) {
		w.Header().Set("Retry-After", "60")
		writeError(r.Context(), w, http.StatusTooManyRequests, "too many requests")
		return
	}

	// Accept text/plain bodies without preflight checks for beacon compatibility.
	dec := json.NewDecoder(io.LimitReader(r.Body, analyticsBodyLimit))
	dec.DisallowUnknownFields()

	var batch analyticsBatch
	if err := dec.Decode(&batch); err != nil {
		writeError(r.Context(), w, http.StatusBadRequest, "invalid analytics batch")
		return
	}
	if len(batch.Events) == 0 || len(batch.Events) > analytics.MaxBatch {
		writeError(r.Context(), w, http.StatusBadRequest, "invalid analytics batch size")
		return
	}
	sessionID, err := uuid.Parse(batch.SessionID)
	if err != nil {
		writeError(r.Context(), w, http.StatusBadRequest, "invalid session id")
		return
	}

	rows := make([][]any, 0, len(batch.Events))
	dropped := 0
	for _, ev := range batch.Events {
		props, ok := analytics.Sanitize(ev.Name, ev.Props)
		if !ok {
			// Skip unknown event types while continuing to process valid events in the batch.
			dropped++
			continue
		}
		rows = append(rows, []any{ev.Name, sessionID, props})
	}

	if len(rows) > 0 {
		_, err := s.DB.Pool.CopyFrom(
			r.Context(),
			pgx.Identifier{"analytics_events"},
			[]string{"name", "session_id", "props"},
			pgx.CopyFromRows(rows),
		)
		if err != nil {
			// Log ingestion failures without surfacing errors to the client.
			logger.Error(r.Context(), "analytics: could not record a batch",
				map[string]interface{}{"events": len(rows), "error": err.Error()})
			w.WriteHeader(http.StatusAccepted)
			return
		}
	}

	// Return 202 Accepted with counts of accepted and dropped events.
	writeAnalyticsReceipt(r.Context(), w, len(rows), dropped)
}

// analyticsReceipt reports how many of a batch's events were kept.
type analyticsReceipt struct {
	Accepted int `json:"accepted"`
	Dropped  int `json:"dropped"`
}

func writeAnalyticsReceipt(ctx context.Context, w http.ResponseWriter, accepted, dropped int) {
	writeJSON(ctx, w, http.StatusAccepted, analyticsReceipt{Accepted: accepted, Dropped: dropped})
}
