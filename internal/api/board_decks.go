package api

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/Jessevdz/RunwayTheGame/internal/logger"
	"github.com/Jessevdz/RunwayTheGame/internal/rules"
)

// DeckUploadRequest represents the payload for uploading deck cards.
type DeckUploadRequest struct {
	Cards []rules.Card `json:"cards"`
}

// maxDeckCards is the maximum number of cards allowed per deck upload.
const maxDeckCards = 200

// handleSetRoadblockDeck uploads roadblock cards to a draft board.
func (s *Server) handleSetRoadblockDeck(w http.ResponseWriter, r *http.Request) {
	s.replaceDeck(w, r, "board_roadblock_cards", "roadblock")
}

// handleSetCurseDeck uploads curse cards to a draft board.
func (s *Server) handleSetCurseDeck(w http.ResponseWriter, r *http.Request) {
	s.replaceDeck(w, r, "board_curse_cards", "curse")
}

// replaceDeck swaps one deck of a draft board for the uploaded cards in a single
// transaction, so a failed upload leaves the board with the deck it had.
func (s *Server) replaceDeck(w http.ResponseWriter, r *http.Request, table, deck string) {
	boardID := chi.URLParam(r, "id")
	version, err := s.checkDraftState(r, boardID, bearerToken(r))
	if err != nil {
		writeError(r.Context(), w, http.StatusForbidden, "invalid board state: "+err.Error())
		return
	}

	var req DeckUploadRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(r.Context(), w, http.StatusBadRequest, "invalid request body")
		return
	}
	if len(req.Cards) > maxDeckCards {
		writeError(r.Context(), w, http.StatusBadRequest, "too many cards in deck")
		return
	}

	tx, err := s.DB.Pool.Begin(r.Context())
	if err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to start transaction")
		return
	}
	defer tx.Rollback(r.Context())

	// table is one of the two literals the handlers above pass, never request input.
	if _, err := tx.Exec(r.Context(), "DELETE FROM "+table+" WHERE board_id = $1 AND board_version = $2", boardID, version); err != nil {
		logger.Error(r.Context(), "failed to clear deck", map[string]interface{}{"deck": deck, "error": err.Error()})
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to clear "+deck+" deck: "+err.Error())
		return
	}

	if err := insertDeckCards(r.Context(), tx, table, boardID, version, req.Cards); err != nil {
		logger.Error(r.Context(), "failed to insert deck card", map[string]interface{}{"deck": deck, "error": err.Error()})
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to insert "+deck+" card: "+err.Error())
		return
	}

	if err := touchBoardDraft(r.Context(), tx, boardID, version); err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to record the board change: "+err.Error())
		return
	}

	if err := tx.Commit(r.Context()); err != nil {
		logger.Error(r.Context(), "failed to commit deck", map[string]interface{}{"deck": deck, "error": err.Error()})
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to commit "+deck+" deck")
		return
	}

	writeJSON(r.Context(), w, http.StatusOK, statusResponse{Status: "deck updated"})
}
