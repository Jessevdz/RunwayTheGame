package api

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/Jessevdz/RunwayTheGame/internal/blobstore"
	"github.com/Jessevdz/RunwayTheGame/internal/logger"
	"github.com/Jessevdz/RunwayTheGame/internal/rules"
)

// reviewPhotoTTL is the expiration duration for presigned review photo URLs.
const reviewPhotoTTL = 30 * time.Minute

// PendingReviewItem represents a submission awaiting host verification.
type PendingReviewItem struct {
	SubmissionID string `json:"submission_id"`
	TeamID       string `json:"team_id"`
	TeamName     string `json:"team_name"`
	// Kind indicates whether the submission is for a 'challenge' or 'roadblock'.
	Kind        string `json:"kind"`
	WaypointID  string `json:"waypoint_id,omitempty"`
	RoadID      string `json:"road_id,omitempty"`
	ChallengeID string `json:"challenge_id"`
	// Prompt and Rubric contain the challenge description and grading guidelines.
	Prompt string             `json:"prompt"`
	Rubric rules.RubricDetail `json:"rubric"`
	// PhotoURL is a temporary presigned URL for the evidence photo.
	PhotoURL string `json:"photo_url,omitempty"`
	BlobRef  string `json:"blob_ref"`
	// Client capture metadata and coordinates.
	Lat              *float64  `json:"lat,omitempty"`
	Lon              *float64  `json:"lon,omitempty"`
	AccuracyM        *float64  `json:"accuracy_m,omitempty"`
	ClientCapturedAt time.Time `json:"client_captured_at,omitempty"`
	SubmittedAt      time.Time `json:"submitted_at"`
}

// reviewQueueResponse represents the host's grading queue response.
type reviewQueueResponse struct {
	GameID       string              `json:"game_id"`
	Verification string              `json:"verification"`
	Pending      []PendingReviewItem `json:"pending"`
}

// handleListPendingReview returns pending submissions awaiting host verification.
func (s *Server) handleListPendingReview(w http.ResponseWriter, r *http.Request) {
	gameID := chi.URLParam(r, "game_id")

	game, err := s.loadGame(r.Context(), gameID)
	if err != nil {
		writeError(r.Context(), w, http.StatusNotFound, "game not found")
		return
	}

	// Query pending submissions scoped to game and pinned board version.
	rows, err := s.DB.Pool.Query(r.Context(), `
		SELECT s.id::text,
		       s.team_id::text,
		       COALESCE(t.name, ''),
		       COALESCE(s.kind, 'challenge'),
		       COALESCE(s.road_id::text, ''),
		       s.challenge_id::text,
		       s.blob_ref,
		       s.lat, s.lon, s.accuracy_m,
		       s.client_captured_at,
		       s.server_received_at,
		       COALESCE(c.prompt, ''),
		       COALESCE(c.rubric::text, '{}')
		FROM challenge_submissions s
		LEFT JOIN game_teams t ON t.id = s.team_id
		LEFT JOIN challenges c
		       ON c.id = s.challenge_id
		      AND c.board_id = $2
		      AND c.board_version = $3
		WHERE s.game_id = $1 AND s.status = 'pending'
		ORDER BY s.server_received_at ASC
	`, gameID, game.BoardID, game.BoardVersion)
	if err != nil {
		logger.Error(r.Context(), "failed to read the review queue", map[string]interface{}{"game_id": gameID, "error": err.Error()})
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to read the review queue")
		return
	}
	defer rows.Close()

	reqHost, reqScheme := forwardedHostAndScheme(r)

	items := []PendingReviewItem{}
	for rows.Next() {
		var item PendingReviewItem
		var clientCapturedAt *time.Time
		var rubricJSON string
		if err := rows.Scan(
			&item.SubmissionID, &item.TeamID, &item.TeamName, &item.Kind,
			&item.RoadID, &item.ChallengeID, &item.BlobRef,
			&item.Lat, &item.Lon, &item.AccuracyM,
			&clientCapturedAt, &item.SubmittedAt,
			&item.Prompt, &rubricJSON,
		); err != nil {
			logger.Error(r.Context(), "failed to read a queued submission", map[string]interface{}{"error": err.Error()})
			writeError(r.Context(), w, http.StatusInternalServerError, "failed to read a queued submission")
			return
		}
		if clientCapturedAt != nil {
			item.ClientCapturedAt = *clientCapturedAt
		}
		// Ignore unmarshal errors for malformed rubric JSON.
		_ = json.Unmarshal([]byte(rubricJSON), &item.Rubric)
		// For roadblock submissions, WaypointID maps to RoadID.
		item.WaypointID = item.RoadID

		item.PhotoURL = s.presignReviewPhoto(r.Context(), item.BlobRef, reqHost, reqScheme)
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		logger.Error(r.Context(), "failed to read the review queue", map[string]interface{}{"game_id": gameID, "error": err.Error()})
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to read the review queue")
		return
	}

	writeJSON(r.Context(), w, http.StatusOK, reviewQueueResponse{
		GameID:       gameID,
		Verification: game.Ruleset.Verification,
		Pending:      items,
	})
}

// presignReviewPhoto generates a short-lived presigned URL for an evidence photo.
func (s *Server) presignReviewPhoto(ctx context.Context, blobRef, reqHost, reqScheme string) string {
	if s.BlobStore == nil || blobRef == "" {
		return ""
	}
	// Validate blob reference format before presigning.
	if err := blobstore.ValidateKey(blobRef); err != nil {
		logger.Warn(ctx, "refusing to presign an invalid blob ref for review", map[string]interface{}{
			"error": err.Error(),
		})
		return ""
	}

	var url string
	var err error
	if withHost, ok := s.BlobStore.(interface {
		PresignDownloadWithHost(ctx context.Context, key string, ttl time.Duration, reqHost string, reqScheme string) (string, error)
	}); ok {
		url, err = withHost.PresignDownloadWithHost(ctx, blobRef, reviewPhotoTTL, reqHost, reqScheme)
	} else {
		url, err = s.BlobStore.PresignDownload(ctx, blobRef, reviewPhotoTTL)
	}
	if err != nil {
		logger.Warn(ctx, "failed to presign an evidence photo for review", map[string]interface{}{
			"error": err.Error(),
		})
		return ""
	}
	return url
}

// forwardedHostAndScheme determines the host and scheme from request headers.
func forwardedHostAndScheme(r *http.Request) (string, string) {
	host := r.Header.Get("X-Forwarded-Host")
	if host == "" {
		host = r.Host
	}
	scheme := r.Header.Get("X-Forwarded-Proto")
	if scheme == "" {
		if r.TLS != nil {
			scheme = "https"
		} else {
			scheme = "http"
		}
	}
	return host, scheme
}
