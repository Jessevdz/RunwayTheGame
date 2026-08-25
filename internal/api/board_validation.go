package api

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/Jessevdz/RunwayTheGame/internal/geo"
	"github.com/Jessevdz/RunwayTheGame/internal/projections"
	"github.com/Jessevdz/RunwayTheGame/internal/rules"
)

// ValidationResponse represents validation errors and warnings for a board.
type ValidationResponse struct {
	Errors   []string `json:"errors"`
	Warnings []string `json:"warnings"`
}

// boardPublishResponse returns the board as published, geometry and all.
type boardPublishResponse struct {
	Status string      `json:"status"`
	Board  rules.Board `json:"board"`
}

// handlePublishBoard publishes a draft board, requiring admin authorization or an edit token.
func (s *Server) handlePublishBoard(w http.ResponseWriter, r *http.Request) {
	boardID := chi.URLParam(r, "id")
	version := 1

	if !s.isAdminAuthorized(r) {
		if err := s.authorizeBoardEdit(r.Context(), boardID, bearerToken(r)); err != nil {
			writeError(r.Context(), w, http.StatusForbidden, err.Error())
			return
		}
	}

	board, err := geo.PublishBoard(r.Context(), s.DB, boardID, version)
	if err != nil {
		writeError(r.Context(), w, http.StatusBadRequest, "publish failed: "+err.Error())
		return
	}

	writeJSON(r.Context(), w, http.StatusOK, boardPublishResponse{Status: "published", Board: board})
}

// handleValidateBoard validates a board draft.
func (s *Server) handleValidateBoard(w http.ResponseWriter, r *http.Request) {
	boardID := chi.URLParam(r, "id")
	version := 1

	board, err := projections.LoadBoard(r.Context(), s.DB.Pool, boardID, version)
	if err != nil {
		writeError(r.Context(), w, http.StatusBadRequest, "failed to load board for validation: "+err.Error())
		return
	}

	errs, warnings, err := geo.ValidateBoard(r.Context(), s.DB, board)
	if err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "validation check failed: "+err.Error())
		return
	}

	if errs == nil {
		errs = []string{}
	}
	if warnings == nil {
		warnings = []string{}
	}

	writeJSON(r.Context(), w, http.StatusOK, ValidationResponse{
		Errors:   errs,
		Warnings: warnings,
	})
}
