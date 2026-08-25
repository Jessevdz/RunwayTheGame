package api

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgconn"
	"github.com/jackc/pgx/v4"

	"github.com/Jessevdz/RunwayTheGame/internal/logger"
)

type RoadmapItemResponse struct {
	ID          string    `json:"id"`
	Title       string    `json:"title"`
	Description string    `json:"description"`
	Status      string    `json:"status"`
	VoteCount   int       `json:"vote_count"`
	Voted       bool      `json:"voted"`
	IsHidden    bool      `json:"is_hidden"`
	CreatedAt   time.Time `json:"created_at"`
}

type CreateRoadmapItemRequest struct {
	Title       string `json:"title"`
	Description string `json:"description"`
}

type UpdateRoadmapItemRequest struct {
	Title       *string `json:"title"`
	Description *string `json:"description"`
	Status      *string `json:"status"`
	IsHidden    *bool   `json:"is_hidden"`
}

type VoteRoadmapItemResponse struct {
	ID        string `json:"id"`
	VoteCount int    `json:"vote_count"`
	Voted     bool   `json:"voted"`
}

type FlagRoadmapItemResponse struct {
	ID      string `json:"id"`
	Flagged bool   `json:"flagged"`
}

// DeleteRoadmapItemResponse confirms deletion of a roadmap item.
type DeleteRoadmapItemResponse struct {
	ID      string `json:"id"`
	Deleted bool   `json:"deleted"`
}

// extractAdminKey returns the raw admin key a request carries. The query
// parameter is a compatibility path for links written before sessions existed:
// a key in a URL is logged by every proxy it passes, so nothing in this
// codebase puts one there any more.
func (s *Server) extractAdminKey(r *http.Request) string {
	key := strings.TrimSpace(r.Header.Get(adminKeyHeader))
	if key == "" {
		if key = strings.TrimSpace(r.URL.Query().Get("admin_key")); key != "" {
			logger.Warn(r.Context(), "admin key supplied in a query parameter, where proxies log it — use POST /api/admin/session", map[string]interface{}{
				"path": r.URL.Path,
			})
		}
	}
	return key
}

// isAdminAuthorized reports whether the request carries admin authority: either
// a live session (the console, whose cookie the browser holds and whose CSRF
// token the page echoes) or the raw key in a header (scripts holding no
// session). This is the one seam every admin-gated handler asks.
func (s *Server) isAdminAuthorized(r *http.Request) bool {
	if s.RoadmapAdminKey == "" {
		return false
	}
	if s.sessionAuthorized(r) {
		return true
	}
	adminKey := s.extractAdminKey(r)
	return adminKey != "" && tokensEqual(adminKey, s.RoadmapAdminKey)
}

func (s *Server) setupRoadmapRoutes(r chi.Router) {
	r.Get("/", s.handleListRoadmapItems)
	r.Post("/", s.handleCreateRoadmapItem)
	r.Put("/{id}", s.handleUpdateRoadmapItem)
	r.Delete("/{id}", s.handleDeleteRoadmapItem)
	r.Post("/{id}/vote", s.handleVoteRoadmapItem)
	r.Delete("/{id}/vote", s.handleUnvoteRoadmapItem)
	r.Post("/{id}/flag", s.handleFlagRoadmapItem)
}

// roadmapAutoHideFlags is the number of distinct flags required to hide a roadmap item.
const roadmapAutoHideFlags = 10

// extractVoterID extracts the client voter identifier from request headers or query parameters.
func (s *Server) extractVoterID(r *http.Request) (string, error) {
	voterID := strings.TrimSpace(r.Header.Get("X-Voter-ID"))
	if voterID == "" {
		voterID = strings.TrimSpace(r.URL.Query().Get("voter_id"))
	}
	if voterID == "" {
		return "", errors.New("missing voter ID")
	}
	parsed, err := uuid.Parse(voterID)
	if err != nil {
		return "", errors.New("invalid voter ID format")
	}
	return parsed.String(), nil
}

// newVoterSecret generates a random 256-bit secret key for voter fingerprinting.
func newVoterSecret() []byte {
	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		panic("api: failed to generate voter fingerprint secret: " + err.Error())
	}
	return secret
}

// voterFingerprint calculates an HMAC-SHA256 fingerprint for a client IP address.
func (s *Server) voterFingerprint(r *http.Request) string {
	mac := hmac.New(sha256.New, s.voterSecret)
	mac.Write([]byte(clientIP(r)))
	return hex.EncodeToString(mac.Sum(nil))
}

func (s *Server) handleListRoadmapItems(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	voterID, _ := s.extractVoterID(r)
	isAdmin := s.isAdminAuthorized(r)

	if s.DB == nil || s.DB.Pool == nil {
		writeError(r.Context(), w, http.StatusServiceUnavailable, "database unavailable")
		return
	}

	items := make([]RoadmapItemResponse, 0)
	var rows pgx.Rows
	var err error

	if voterID != "" {
		query := `
			SELECT i.id, i.title, i.description, i.status, i.vote_count, i.is_hidden, i.created_at,
			       (v.item_id IS NOT NULL) AS voted
			FROM roadmap_items i
			LEFT JOIN roadmap_votes v ON i.id = v.item_id AND v.voter_id = $1`
		if !isAdmin {
			query += ` WHERE i.is_hidden = FALSE`
		}
		query += ` ORDER BY i.vote_count DESC, i.created_at DESC LIMIT 100`
		rows, err = s.DB.Pool.Query(ctx, query, voterID)
	} else {
		query := `
			SELECT i.id, i.title, i.description, i.status, i.vote_count, i.is_hidden, i.created_at,
			       FALSE AS voted
			FROM roadmap_items i`
		if !isAdmin {
			query += ` WHERE i.is_hidden = FALSE`
		}
		query += ` ORDER BY i.vote_count DESC, i.created_at DESC LIMIT 100`
		rows, err = s.DB.Pool.Query(ctx, query)
	}

	if err != nil {
		logger.Error(ctx, "failed to query roadmap items", map[string]interface{}{"error": err.Error()})
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to load roadmap items")
		return
	}
	defer rows.Close()

	for rows.Next() {
		var item RoadmapItemResponse
		if err := rows.Scan(&item.ID, &item.Title, &item.Description, &item.Status, &item.VoteCount, &item.IsHidden, &item.CreatedAt, &item.Voted); err != nil {
			logger.Error(ctx, "failed to scan roadmap item", map[string]interface{}{"error": err.Error()})
			writeError(r.Context(), w, http.StatusInternalServerError, "failed to parse roadmap items")
			return
		}
		items = append(items, item)
	}

	writeJSON(ctx, w, http.StatusOK, items)
}

func (s *Server) handleCreateRoadmapItem(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	ip := clientIP(r)

	if s.roadmapSubmitLimiter != nil && !s.roadmapSubmitLimiter.allow(ip) {
		w.Header().Set("Retry-After", "600")
		writeError(r.Context(), w, http.StatusTooManyRequests, "rate limit exceeded: please wait before submitting another item")
		return
	}

	var req CreateRoadmapItemRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(r.Context(), w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	title := strings.TrimSpace(req.Title)
	description := strings.TrimSpace(req.Description)

	if len(title) < 3 || len(title) > 120 {
		writeError(r.Context(), w, http.StatusBadRequest, "title must be between 3 and 120 characters")
		return
	}
	if len(description) > 2000 {
		writeError(r.Context(), w, http.StatusBadRequest, "description must not exceed 2000 characters")
		return
	}

	if s.DB == nil || s.DB.Pool == nil {
		writeError(r.Context(), w, http.StatusServiceUnavailable, "database unavailable")
		return
	}

	itemID := uuid.New().String()
	now := time.Now().UTC()

	query := `
		INSERT INTO roadmap_items (id, title, description, status, vote_count, flag_count, is_hidden, created_at, updated_at)
		VALUES ($1, $2, $3, 'PROPOSED', 0, 0, FALSE, $4, $4)
		RETURNING id, title, description, status, vote_count, is_hidden, created_at`

	var item RoadmapItemResponse
	err := s.DB.Pool.QueryRow(ctx, query, itemID, title, description, now).Scan(&item.ID, &item.Title, &item.Description, &item.Status, &item.VoteCount, &item.IsHidden, &item.CreatedAt)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == pgUniqueViolation {
			writeError(r.Context(), w, http.StatusConflict, "a roadmap item with this title already exists")
			return
		}
		logger.Error(ctx, "failed to insert roadmap item", map[string]interface{}{"error": err.Error()})
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to create roadmap item")
		return
	}
	item.Voted = false

	logger.Info(ctx, "created roadmap item", map[string]interface{}{"id": item.ID, "title": item.Title})

	writeJSON(ctx, w, http.StatusCreated, item)
}

func (s *Server) handleUpdateRoadmapItem(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	if !s.isAdminAuthorized(r) {
		writeError(r.Context(), w, http.StatusUnauthorized, "unauthorized: invalid or missing admin key")
		return
	}

	itemID := chi.URLParam(r, "id")
	if itemID == "" {
		writeError(r.Context(), w, http.StatusBadRequest, "item id required")
		return
	}

	var req UpdateRoadmapItemRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(r.Context(), w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	if s.DB == nil || s.DB.Pool == nil {
		writeError(r.Context(), w, http.StatusServiceUnavailable, "database unavailable")
		return
	}

	var currentTitle, currentDesc, currentStatus string
	var currentHidden bool
	err := s.DB.Pool.QueryRow(ctx, "SELECT title, description, status, is_hidden FROM roadmap_items WHERE id = $1", itemID).Scan(&currentTitle, &currentDesc, &currentStatus, &currentHidden)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(r.Context(), w, http.StatusNotFound, "roadmap item not found")
		return
	} else if err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "database error")
		return
	}

	newTitle := currentTitle
	if req.Title != nil {
		newTitle = strings.TrimSpace(*req.Title)
		if len(newTitle) < 3 || len(newTitle) > 120 {
			writeError(r.Context(), w, http.StatusBadRequest, "title must be between 3 and 120 characters")
			return
		}
	}

	newDesc := currentDesc
	if req.Description != nil {
		newDesc = strings.TrimSpace(*req.Description)
		if len(newDesc) > 2000 {
			writeError(r.Context(), w, http.StatusBadRequest, "description must not exceed 2000 characters")
			return
		}
	}

	newStatus := currentStatus
	if req.Status != nil {
		st := strings.ToUpper(strings.TrimSpace(*req.Status))
		if st != "PROPOSED" && st != "PLANNED" && st != "IN_PROGRESS" && st != "SHIPPED" {
			writeError(r.Context(), w, http.StatusBadRequest, "invalid status: must be PROPOSED, PLANNED, IN_PROGRESS, or SHIPPED")
			return
		}
		newStatus = st
	}

	newHidden := currentHidden
	if req.IsHidden != nil {
		newHidden = *req.IsHidden
	}

	query := `
		UPDATE roadmap_items
		SET title = $1, description = $2, status = $3, is_hidden = $4, updated_at = NOW()
		WHERE id = $5
		RETURNING id, title, description, status, vote_count, is_hidden, created_at`

	var item RoadmapItemResponse
	err = s.DB.Pool.QueryRow(ctx, query, newTitle, newDesc, newStatus, newHidden, itemID).Scan(&item.ID, &item.Title, &item.Description, &item.Status, &item.VoteCount, &item.IsHidden, &item.CreatedAt)
	if err != nil {
		logger.Error(ctx, "failed to update roadmap item", map[string]interface{}{"error": err.Error()})
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to update roadmap item")
		return
	}

	writeJSON(ctx, w, http.StatusOK, item)
}

func (s *Server) handleDeleteRoadmapItem(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	if !s.isAdminAuthorized(r) {
		writeError(r.Context(), w, http.StatusUnauthorized, "unauthorized: invalid or missing admin key")
		return
	}

	itemID := chi.URLParam(r, "id")
	if itemID == "" {
		writeError(r.Context(), w, http.StatusBadRequest, "item id required")
		return
	}

	if s.DB == nil || s.DB.Pool == nil {
		writeError(r.Context(), w, http.StatusServiceUnavailable, "database unavailable")
		return
	}

	res, err := s.DB.Pool.Exec(ctx, "DELETE FROM roadmap_items WHERE id = $1", itemID)
	if err != nil {
		logger.Error(ctx, "failed to delete roadmap item", map[string]interface{}{"error": err.Error()})
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to delete roadmap item")
		return
	}

	if res.RowsAffected() == 0 {
		writeError(r.Context(), w, http.StatusNotFound, "roadmap item not found")
		return
	}

	writeJSON(ctx, w, http.StatusOK, DeleteRoadmapItemResponse{ID: itemID, Deleted: true})
}

func (s *Server) handleVoteRoadmapItem(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	ip := clientIP(r)

	if s.roadmapVoteLimiter != nil && !s.roadmapVoteLimiter.allow(ip) {
		w.Header().Set("Retry-After", "1")
		writeError(r.Context(), w, http.StatusTooManyRequests, "rate limit exceeded: voting too fast")
		return
	}

	voterID, err := s.extractVoterID(r)
	if err != nil {
		writeError(r.Context(), w, http.StatusBadRequest, "invalid or missing X-Voter-ID header")
		return
	}

	itemID := chi.URLParam(r, "id")

	var isHidden bool
	err = s.DB.Pool.QueryRow(ctx, "SELECT is_hidden FROM roadmap_items WHERE id = $1", itemID).Scan(&isHidden)
	if errors.Is(err, pgx.ErrNoRows) || isHidden {
		writeError(r.Context(), w, http.StatusNotFound, "roadmap item not found")
		return
	} else if err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "database error")
		return
	}

	tx, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to begin transaction: "+err.Error())
		return
	}
	defer tx.Rollback(ctx)

	// Insert vote, ignoring duplicate voter IDs or fingerprints.
	res, err := tx.Exec(ctx,
		"INSERT INTO roadmap_votes (item_id, voter_id, voter_fingerprint) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
		itemID, voterID, s.voterFingerprint(r))
	if err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to record vote: "+err.Error())
		return
	}

	if res.RowsAffected() > 0 {
		_, err = tx.Exec(ctx, "UPDATE roadmap_items SET vote_count = vote_count + 1, updated_at = NOW() WHERE id = $1", itemID)
		if err != nil {
			writeError(r.Context(), w, http.StatusInternalServerError, "failed to update vote count: "+err.Error())
			return
		}
	}

	if err := tx.Commit(ctx); err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to commit vote transaction: "+err.Error())
		return
	}

	var voteCount int
	if err := s.DB.Pool.QueryRow(ctx, "SELECT vote_count FROM roadmap_items WHERE id = $1", itemID).Scan(&voteCount); err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to read the vote count: "+err.Error())
		return
	}

	writeJSON(ctx, w, http.StatusOK, VoteRoadmapItemResponse{
		ID:        itemID,
		VoteCount: voteCount,
		Voted:     true,
	})
}

func (s *Server) handleUnvoteRoadmapItem(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	ip := clientIP(r)

	if s.roadmapVoteLimiter != nil && !s.roadmapVoteLimiter.allow(ip) {
		w.Header().Set("Retry-After", "1")
		writeError(r.Context(), w, http.StatusTooManyRequests, "rate limit exceeded: voting too fast")
		return
	}

	// Validate voter ID header format.
	voterID, err := s.extractVoterID(r)
	if err != nil {
		writeError(r.Context(), w, http.StatusBadRequest, "invalid or missing X-Voter-ID header")
		return
	}

	itemID := chi.URLParam(r, "id")

	var isHidden bool
	err = s.DB.Pool.QueryRow(ctx, "SELECT is_hidden FROM roadmap_items WHERE id = $1", itemID).Scan(&isHidden)
	if errors.Is(err, pgx.ErrNoRows) || isHidden {
		writeError(r.Context(), w, http.StatusNotFound, "roadmap item not found")
		return
	} else if err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "database error")
		return
	}

	tx, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to begin transaction: "+err.Error())
		return
	}
	defer tx.Rollback(ctx)

	// Remove the vote row matching the item ID, the caller's voter identity, and the caller's IP.
	res, err := tx.Exec(ctx,
		"DELETE FROM roadmap_votes WHERE item_id = $1 AND voter_id = $2 AND voter_fingerprint = $3",
		itemID, voterID, s.voterFingerprint(r))
	if err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to delete vote: "+err.Error())
		return
	}

	if res.RowsAffected() > 0 {
		_, err = tx.Exec(ctx, "UPDATE roadmap_items SET vote_count = GREATEST(0, vote_count - 1), updated_at = NOW() WHERE id = $1", itemID)
		if err != nil {
			writeError(r.Context(), w, http.StatusInternalServerError, "failed to update vote count: "+err.Error())
			return
		}
	}

	if err := tx.Commit(ctx); err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to commit unvote transaction: "+err.Error())
		return
	}

	var voteCount int
	if err := s.DB.Pool.QueryRow(ctx, "SELECT vote_count FROM roadmap_items WHERE id = $1", itemID).Scan(&voteCount); err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to read the vote count: "+err.Error())
		return
	}

	writeJSON(ctx, w, http.StatusOK, VoteRoadmapItemResponse{
		ID:        itemID,
		VoteCount: voteCount,
		Voted:     false,
	})
}

func (s *Server) handleFlagRoadmapItem(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	ip := clientIP(r)

	if s.roadmapFlagLimiter != nil && !s.roadmapFlagLimiter.allow(ip) {
		w.Header().Set("Retry-After", "60")
		writeError(r.Context(), w, http.StatusTooManyRequests, "rate limit exceeded: flagging too fast")
		return
	}

	voterID, err := s.extractVoterID(r)
	if err != nil {
		writeError(r.Context(), w, http.StatusBadRequest, "invalid or missing X-Voter-ID header")
		return
	}

	itemID := chi.URLParam(r, "id")

	var isHidden bool
	err = s.DB.Pool.QueryRow(ctx, "SELECT is_hidden FROM roadmap_items WHERE id = $1", itemID).Scan(&isHidden)
	if errors.Is(err, pgx.ErrNoRows) || isHidden {
		writeError(r.Context(), w, http.StatusNotFound, "roadmap item not found")
		return
	} else if err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "database error")
		return
	}

	tx, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to begin transaction: "+err.Error())
		return
	}
	defer tx.Rollback(ctx)

	res, err := tx.Exec(ctx,
		"INSERT INTO roadmap_flags (item_id, voter_id, voter_fingerprint) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
		itemID, voterID, s.voterFingerprint(r))
	if err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to record flag: "+err.Error())
		return
	}

	if res.RowsAffected() > 0 {
		// Increment flag count and hide item if auto-hide threshold is met.
		_, err = tx.Exec(ctx, `
			UPDATE roadmap_items
			SET flag_count = flag_count + 1,
			    is_hidden = is_hidden OR (flag_count + 1 >= $2),
			    updated_at = NOW()
			WHERE id = $1`, itemID, roadmapAutoHideFlags)
		if err != nil {
			writeError(r.Context(), w, http.StatusInternalServerError, "failed to update flag count: "+err.Error())
			return
		}
	}

	if err := tx.Commit(ctx); err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to commit flag transaction: "+err.Error())
		return
	}

	logger.Info(ctx, "roadmap item flagged", map[string]interface{}{"id": itemID, "voter_id": voterID})

	writeJSON(ctx, w, http.StatusOK, FlagRoadmapItemResponse{
		ID:      itemID,
		Flagged: true,
	})
}
