package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v4"

	"github.com/Jessevdz/RunwayTheGame/internal/logger"
)

// BugReportRetentionDays is how long a report survives after it is filed.
//
// Longer than a race (30 days) because a bug outlives the race that exposed it,
// and shorter than forever because the context blob names routes a tester was
// on. A report whose race is already gone is still worth reading; one from three
// months ago is not worth keeping.
const BugReportRetentionDays = 90

// Severities a reporter may pick, and the statuses an admin may move a report to.
const (
	severityBlocker  = "BLOCKER"
	severityNormal   = "NORMAL"
	severityCosmetic = "COSMETIC"
)

// bugReportMaxErrors is how many captured JavaScript errors a report may carry.
const bugReportMaxErrors = 10

// bugReportMaxErrorLen is the longest single captured error string kept.
const bugReportMaxErrorLen = 400

// BugReportContext is the closed set of diagnostic fields a client may attach.
//
// It is a struct rather than a free JSONB passthrough on purpose: the server
// unmarshals into this shape and re-marshals before storing, so a field this
// type does not name cannot reach the database however the client spells it.
type BugReportContext struct {
	// Route is the path the tester was on, ids and all, because a bug in a race
	// is not reproducible without knowing which race.
	Route string `json:"route"`
	// Viewport is a coarse bucket: mobile, tablet, or desktop.
	Viewport string `json:"viewport"`
	// Screen is the viewport size as WxH, which is how layout bugs get read.
	Screen string `json:"screen"`
	// UserAgent identifies the browser and OS build, the two things an outdoor
	// bug report is useless without.
	UserAgent string `json:"user_agent"`
	// AppVersion is the frontend build stamp.
	AppVersion string `json:"app_version"`
	// Online is whether the browser thought it had a network at capture time.
	Online bool `json:"online"`
	// Errors are the most recent captured JavaScript errors and failed requests.
	Errors []string `json:"errors"`
	// OccurredAt is the client clock, kept alongside the server's created_at
	// because a wrong device clock is itself a lead when GPS gates misbehave.
	OccurredAt string `json:"occurred_at"`
}

type BugReportResponse struct {
	ID        string           `json:"id"`
	Summary   string           `json:"summary"`
	Details   string           `json:"details"`
	Severity  string           `json:"severity"`
	Status    string           `json:"status"`
	Context   BugReportContext `json:"context"`
	CreatedAt time.Time        `json:"created_at"`
}

type CreateBugReportRequest struct {
	Summary  string            `json:"summary"`
	Details  string            `json:"details"`
	Severity string            `json:"severity"`
	Context  *BugReportContext `json:"context"`
}

type UpdateBugReportRequest struct {
	Status *string `json:"status"`
}

// CreateBugReportResponse is what a reporter gets back: an acknowledgement and
// nothing else. The full row, context included, is admin-only.
type CreateBugReportResponse struct {
	ID       string `json:"id"`
	Received bool   `json:"received"`
}

// DeleteBugReportResponse confirms deletion of a bug report.
type DeleteBugReportResponse struct {
	ID      string `json:"id"`
	Deleted bool   `json:"deleted"`
}

func (s *Server) setupBugReportRoutes(r chi.Router) {
	r.Post("/", s.handleCreateBugReport)
	r.Get("/", s.handleListBugReports)
	r.Put("/{id}", s.handleUpdateBugReport)
	r.Delete("/{id}", s.handleDeleteBugReport)
}

// normalizeSeverity maps a client-supplied severity onto the closed set.
func normalizeSeverity(raw string) (string, bool) {
	switch strings.ToUpper(strings.TrimSpace(raw)) {
	case "", severityNormal:
		return severityNormal, true
	case severityBlocker:
		return severityBlocker, true
	case severityCosmetic:
		return severityCosmetic, true
	default:
		return "", false
	}
}

// normalizeBugStatus maps an admin-supplied status onto the closed set.
func normalizeBugStatus(raw string) (string, bool) {
	switch strings.ToUpper(strings.TrimSpace(raw)) {
	case "NEW", "TRIAGED", "FIXED", "WONTFIX":
		return strings.ToUpper(strings.TrimSpace(raw)), true
	default:
		return "", false
	}
}

// clampString trims a string and cuts it to max runes.
func clampString(value string, max int) string {
	value = strings.TrimSpace(value)
	runes := []rune(value)
	if len(runes) > max {
		return string(runes[:max])
	}
	return value
}

// sanitizeBugContext clamps every field to a bounded length so a report cannot
// be used to store bulk data, and drops anything not on the struct.
func sanitizeBugContext(in *BugReportContext) BugReportContext {
	if in == nil {
		return BugReportContext{Errors: []string{}}
	}
	out := BugReportContext{
		Route:      clampString(in.Route, 300),
		Viewport:   clampString(in.Viewport, 20),
		Screen:     clampString(in.Screen, 20),
		UserAgent:  clampString(in.UserAgent, 400),
		AppVersion: clampString(in.AppVersion, 60),
		Online:     in.Online,
		OccurredAt: clampString(in.OccurredAt, 40),
		Errors:     []string{},
	}
	for _, e := range in.Errors {
		if len(out.Errors) >= bugReportMaxErrors {
			break
		}
		if trimmed := clampString(e, bugReportMaxErrorLen); trimmed != "" {
			out.Errors = append(out.Errors, trimmed)
		}
	}
	return out
}

func (s *Server) handleCreateBugReport(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	if s.bugReportLimiter != nil && !s.bugReportLimiter.allow(clientIP(r)) {
		w.Header().Set("Retry-After", "120")
		writeError(ctx, w, http.StatusTooManyRequests, "rate limit exceeded: please wait before filing another report")
		return
	}

	var req CreateBugReportRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(ctx, w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	summary := clampString(req.Summary, 200)
	details := clampString(req.Details, 4000)
	if len([]rune(summary)) < 3 {
		writeError(ctx, w, http.StatusBadRequest, "summary must be at least 3 characters")
		return
	}

	severity, ok := normalizeSeverity(req.Severity)
	if !ok {
		writeError(ctx, w, http.StatusBadRequest, "invalid severity: must be BLOCKER, NORMAL, or COSMETIC")
		return
	}

	if s.DB == nil || s.DB.Pool == nil {
		writeError(ctx, w, http.StatusServiceUnavailable, "database unavailable")
		return
	}

	contextBlob, err := json.Marshal(sanitizeBugContext(req.Context))
	if err != nil {
		writeError(ctx, w, http.StatusInternalServerError, "failed to encode report context")
		return
	}

	// The reporter id is optional and is only ever the client's own random
	// handle, reused from the roadmap voter id so a follow-up can find them.
	var reporterID *string
	if id, err := s.extractVoterID(r); err == nil {
		reporterID = &id
	}

	reportID := uuid.New().String()
	now := time.Now().UTC()

	_, err = s.DB.Pool.Exec(ctx, `
		INSERT INTO bug_reports (id, summary, details, severity, status, context, reporter_id, created_at, updated_at)
		VALUES ($1, $2, $3, $4, 'NEW', $5, $6, $7, $7)`,
		reportID, summary, details, severity, contextBlob, reporterID, now)
	if err != nil {
		logger.Error(ctx, "failed to insert bug report", map[string]interface{}{"error": err.Error()})
		writeError(ctx, w, http.StatusInternalServerError, "failed to file bug report: "+err.Error())
		return
	}

	logger.Info(ctx, "bug report filed", map[string]interface{}{
		"id":       reportID,
		"severity": severity,
	})

	writeJSON(ctx, w, http.StatusCreated, CreateBugReportResponse{ID: reportID, Received: true})
}

func (s *Server) handleListBugReports(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	if !s.isAdminAuthorized(r) {
		writeError(ctx, w, http.StatusUnauthorized, "unauthorized: invalid or missing admin key")
		return
	}

	if s.DB == nil || s.DB.Pool == nil {
		writeError(ctx, w, http.StatusServiceUnavailable, "database unavailable")
		return
	}

	rows, err := s.DB.Pool.Query(ctx, `
		SELECT id, summary, details, severity, status, context, created_at
		FROM bug_reports
		ORDER BY created_at DESC
		LIMIT 200`)
	if err != nil {
		logger.Error(ctx, "failed to query bug reports", map[string]interface{}{"error": err.Error()})
		writeError(ctx, w, http.StatusInternalServerError, "failed to load bug reports: "+err.Error())
		return
	}
	defer rows.Close()

	reports := make([]BugReportResponse, 0)
	for rows.Next() {
		var report BugReportResponse
		var raw []byte
		if err := rows.Scan(&report.ID, &report.Summary, &report.Details, &report.Severity, &report.Status, &raw, &report.CreatedAt); err != nil {
			logger.Error(ctx, "failed to scan bug report", map[string]interface{}{"error": err.Error()})
			writeError(ctx, w, http.StatusInternalServerError, "failed to parse bug reports: "+err.Error())
			return
		}
		// A context that will not parse is not worth losing the report over.
		if err := json.Unmarshal(raw, &report.Context); err != nil {
			report.Context = BugReportContext{}
		}
		if report.Context.Errors == nil {
			report.Context.Errors = []string{}
		}
		reports = append(reports, report)
	}

	writeJSON(ctx, w, http.StatusOK, reports)
}

func (s *Server) handleUpdateBugReport(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	if !s.isAdminAuthorized(r) {
		writeError(ctx, w, http.StatusUnauthorized, "unauthorized: invalid or missing admin key")
		return
	}

	reportID := chi.URLParam(r, "id")
	if reportID == "" {
		writeError(ctx, w, http.StatusBadRequest, "report id required")
		return
	}

	var req UpdateBugReportRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(ctx, w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}
	if req.Status == nil {
		writeError(ctx, w, http.StatusBadRequest, "status required")
		return
	}
	status, ok := normalizeBugStatus(*req.Status)
	if !ok {
		writeError(ctx, w, http.StatusBadRequest, "invalid status: must be NEW, TRIAGED, FIXED, or WONTFIX")
		return
	}

	if s.DB == nil || s.DB.Pool == nil {
		writeError(ctx, w, http.StatusServiceUnavailable, "database unavailable")
		return
	}

	var report BugReportResponse
	var raw []byte
	err := s.DB.Pool.QueryRow(ctx, `
		UPDATE bug_reports SET status = $1, updated_at = NOW()
		WHERE id = $2
		RETURNING id, summary, details, severity, status, context, created_at`,
		status, reportID).Scan(&report.ID, &report.Summary, &report.Details, &report.Severity, &report.Status, &raw, &report.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(ctx, w, http.StatusNotFound, "bug report not found")
		return
	} else if err != nil {
		logger.Error(ctx, "failed to update bug report", map[string]interface{}{"error": err.Error()})
		writeError(ctx, w, http.StatusInternalServerError, "failed to update bug report: "+err.Error())
		return
	}
	if err := json.Unmarshal(raw, &report.Context); err != nil {
		report.Context = BugReportContext{}
	}
	if report.Context.Errors == nil {
		report.Context.Errors = []string{}
	}

	writeJSON(ctx, w, http.StatusOK, report)
}

func (s *Server) handleDeleteBugReport(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	if !s.isAdminAuthorized(r) {
		writeError(ctx, w, http.StatusUnauthorized, "unauthorized: invalid or missing admin key")
		return
	}

	reportID := chi.URLParam(r, "id")
	if reportID == "" {
		writeError(ctx, w, http.StatusBadRequest, "report id required")
		return
	}

	if s.DB == nil || s.DB.Pool == nil {
		writeError(ctx, w, http.StatusServiceUnavailable, "database unavailable")
		return
	}

	res, err := s.DB.Pool.Exec(ctx, "DELETE FROM bug_reports WHERE id = $1", reportID)
	if err != nil {
		logger.Error(ctx, "failed to delete bug report", map[string]interface{}{"error": err.Error()})
		writeError(ctx, w, http.StatusInternalServerError, "failed to delete bug report: "+err.Error())
		return
	}
	if res.RowsAffected() == 0 {
		writeError(ctx, w, http.StatusNotFound, "bug report not found")
		return
	}

	writeJSON(ctx, w, http.StatusOK, DeleteBugReportResponse{ID: reportID, Deleted: true})
}
