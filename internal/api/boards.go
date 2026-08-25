package api

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v4"

	"github.com/Jessevdz/RunwayTheGame/internal/rules"
)

// BoardCreateRequest represents the payload for creating a board.
type BoardCreateRequest struct {
	Name string `json:"name"`
}

// BoardUpdateRequest represents the payload for updating a board.
type BoardUpdateRequest struct {
	Name           string            `json:"name"`
	Waypoints      []rules.Waypoint  `json:"waypoints"`
	Roads          []rules.Road      `json:"roads"`
	Challenges     []rules.Challenge `json:"challenges"`
	RoadblockCards []rules.Card      `json:"roadblock_cards"`
	CurseCards     []rules.Card      `json:"curse_cards"`
	PowerupCosts   map[string]int    `json:"powerup_costs"`
	Powerups       []rules.Powerup   `json:"powerups"`
}

// statusResponse is the bare acknowledgement a write returns when it has
// nothing to report but success.
type statusResponse struct {
	Status string `json:"status"`
}

// adminKeyResponse reports whether the request's admin credential is good.
type adminKeyResponse struct {
	Valid bool `json:"valid"`
}

// setupRoutes registers board CRUD and game play-loop routes.
func (s *Server) setupRoutes() {
	// Public endpoints accessible before race setup.
	s.Router.Get("/api/config", s.handleGetConfig)
	// The admin key is spent here, in a body, for a session (see adminsession.go).
	s.Router.Post("/api/admin/session", s.handleCreateAdminSession)
	s.Router.Delete("/api/admin/session", s.handleDeleteAdminSession)
	s.Router.Get("/api/admin/verify", s.handleVerifyAdminKey)
	// Unauthenticated analytics endpoint for the map editor.
	s.Router.Post("/api/analytics", s.handleIngestAnalytics)
	s.Router.Route("/api/boards", func(r chi.Router) {
		r.Get("/", s.handleListBoards)
		r.Post("/", s.handleCreateBoard)
		r.Route("/{id}", func(r chi.Router) {
			r.Get("/", s.handleGetBoardDefault)
			r.Get("/versions/{version}", s.handleGetBoard)
			r.Put("/", s.handleUpdateBoard)
			r.Put("/visibility", s.handleSetBoardVisibility)
			r.Delete("/", s.handleDeleteBoard)
			r.Post("/publish", s.handlePublishBoard)
			r.Post("/validate", s.handleValidateBoard)
			r.Post("/fork", s.handleForkBoard)
			// Public leaderboard endpoint.
			r.Get("/leaderboard", s.handleGetBoardLeaderboard)

			r.Post("/decks/roadblock", s.handleSetRoadblockDeck)
			r.Post("/decks/curse", s.handleSetCurseDeck)

			r.Post("/waypoints/{waypoint_id}/challenges", s.handleAddChallenge)
			r.Post("/roads/{road_id}/challenges", s.handleAddChallenge)
			r.Route("/challenges/{challenge_id}", func(r chi.Router) {
				r.Put("/", s.handleUpdateChallenge)
				r.Delete("/", s.handleDeleteChallenge)
			})
		})
	})

	s.Router.Route("/api/games", s.setupGameRoutes)
	s.Router.Route("/api/roadmap", s.setupRoadmapRoutes)
	s.Router.Route("/api/bug-reports", s.setupBugReportRoutes)
}

// handleVerifyAdminKey answers whether the credential the request carries is
// still good — the console asks it on load to find out if the session cookie
// this browser already holds has outlived a restart or its TTL.
func (s *Server) handleVerifyAdminKey(w http.ResponseWriter, r *http.Request) {
	if !s.isAdminAuthorized(r) {
		// A rejected credential is a guess; an empty request is not. Charging
		// only the former keeps this endpoint from being a free oracle without
		// letting a passer-by exhaust an admin's sign-in budget.
		if adminCredentialPresented(r) {
			s.adminAuthLimiter.penalize(clientIP(r))
		}
		writeError(r.Context(), w, http.StatusUnauthorized, "unauthorized: invalid or missing admin credential")
		return
	}
	writeJSON(r.Context(), w, http.StatusOK, adminKeyResponse{Valid: true})
}

// authorizeBoardEdit verifies the request's edit token against the stored hash of the board's edit capability.
func (s *Server) authorizeBoardEdit(ctx context.Context, boardID, tokenFromRequest string) error {
	var storedHash *string
	err := s.DB.Pool.QueryRow(ctx, "SELECT edit_token_hash FROM boards WHERE id = $1 AND version = 1", boardID).Scan(&storedHash)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return errors.New("board not found")
		}
		return err
	}
	if storedHash == nil || *storedHash == "" {
		return errors.New("unauthorized: this board has no edit token on record")
	}
	if tokenFromRequest == "" || !tokensEqual(hashToken(tokenFromRequest), *storedHash) {
		return errors.New("unauthorized: edit token mismatch or missing")
	}
	return nil
}

// boardChildTables are the tables a board owns. The order is the deletion order:
// rows that reference a waypoint or a road go before the waypoint or road itself.
var boardChildTables = []string{
	"challenges",
	"board_roadblock_cards",
	"board_curse_cards",
	"board_powerup_costs",
	"board_powerups",
	"board_roads",
	"board_waypoints",
}

// clearBoardVersion deletes every child row of one board version, which is how a
// full-map save starts before writing the incoming design.
func clearBoardVersion(ctx context.Context, tx pgx.Tx, boardID string, version int) error {
	return deleteBoardChildren(ctx, tx, "WHERE board_id = $1 AND board_version = $2", boardID, version)
}

// clearBoardAllVersions deletes every child row of a board across all versions.
func clearBoardAllVersions(ctx context.Context, tx pgx.Tx, boardID string) error {
	return deleteBoardChildren(ctx, tx, "WHERE board_id = $1", boardID)
}

func deleteBoardChildren(ctx context.Context, tx pgx.Tx, where string, args ...interface{}) error {
	for _, table := range boardChildTables {
		// The table name comes from boardChildTables, never from a request.
		if _, err := tx.Exec(ctx, fmt.Sprintf("DELETE FROM %s %s", table, where), args...); err != nil {
			return fmt.Errorf("failed to clear %s: %w", table, err)
		}
	}
	return nil
}

// insertDeckCards inserts card records into the specified deck table, generating unique IDs as needed.
func insertDeckCards(ctx context.Context, tx pgx.Tx, table, boardID string, version int, cards []rules.Card) error {
	seen := make(map[string]bool, len(cards))
	for _, card := range cards {
		cardID := ensureUUID(card.ID)
		if cardID == "" || seen[cardID] {
			cardID = uuid.New().String()
		}
		seen[cardID] = true
		sql := fmt.Sprintf(`INSERT INTO %s (id, board_id, board_version, text) VALUES ($1, $2, $3, $4)`, table)
		if _, err := tx.Exec(ctx, sql, cardID, boardID, version, card.Text); err != nil {
			return err
		}
	}
	return nil
}

func fmtWKTPoint(lon, lat float64) string {
	return "POINT(" + strconv.FormatFloat(lon, 'f', -1, 64) + " " + strconv.FormatFloat(lat, 'f', -1, 64) + ")"
}

func ensureUUID(id string) string {
	if id == "" {
		return ""
	}
	if _, err := uuid.Parse(id); err == nil {
		return id
	}
	return uuid.NewSHA1(uuid.NameSpaceDNS, []byte(id)).String()
}
