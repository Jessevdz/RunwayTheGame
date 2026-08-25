package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"
	"unicode"

	"github.com/go-chi/chi/v5"

	"github.com/Jessevdz/RunwayTheGame/internal/rules"
)

const (
	// maxTeamSlots mirrors the six team colours the client palette can render.
	maxTeamSlots = 6
	// pgUniqueViolation is SQLSTATE 23505.
	pgUniqueViolation = "23505"
	// joinSequenceRetries is the maximum number of retry attempts when a join operation conflicts with a concurrent sequence update.
	joinSequenceRetries = 8
	// soloRunDuration is the default duration for a solo run when an end time is not explicitly specified.
	soloRunDuration = 24 * time.Hour
	// soloRunnerNameMaxRunes is the maximum character length for a solo runner name.
	soloRunnerNameMaxRunes = 64
	// playerNameMaxRunes is the maximum character length for a player display name.
	playerNameMaxRunes = 40
)

// errSlotTaken indicates that a team slot is already occupied.
var errSlotTaken = errors.New("team colour already taken")

// setupGameRoutes registers all HTTP endpoints for game management and play.
func (s *Server) setupGameRoutes(r chi.Router) {
	r.Post("/", s.handleCreateGame)
	// Static roads, registered before the {game_id} param route. chi's trie
	// prefers static over wildcard either way, but the ordering states the intent.
	r.Get("/by-code/{code}", s.handleGetGameByCode)
	r.Post("/solo", s.handleCreateSoloRun)
	r.Route("/{game_id}", func(r chi.Router) {
		r.Get("/", s.handleGetGame)
		r.Post("/join", s.handleJoinGame)
		r.Post("/teams/{team_id}/join", s.handleJoinExistingTeam)
		r.Get("/ws", s.handleWebSocket)

		// Team capability (Authorization: Bearer <join_token>).
		//
		// Team membership routes.
		r.Patch("/me", s.handleUpdateMembership)
		r.Patch("/teams/{team_id}", s.handleUpdateTeam)
		r.Delete("/teams/{team_id}", s.handleDisbandTeam)

		r.Post("/challenge/start", s.handleChallengeStart)
		r.Post("/presign", s.handlePresign)
		r.Post("/submission", s.handleSubmission)
		r.Post("/veto", s.handleVeto)
		r.Post("/arrive", s.handleArrive)
		r.Post("/shop/buy", s.handleShopBuy)
		r.Post("/powerup/use", s.handlePowerupUse)
		r.Post("/roadblock/clear", s.handleRoadblockClear)
		r.Post("/curse/resolve", s.handleCurseResolve)
		r.Post("/position", s.handlePosition)
		r.Post("/dispute", s.handleDisputeRaise)
		// Leaderboard submission endpoint.
		r.Post("/leaderboard", s.handlePostLeaderboardTime)
		// Evidence deletion endpoint.
		r.Delete("/evidence", s.handleDeleteTeamEvidence)

		// Participant report endpoint.
		r.Group(func(r chi.Router) {
			r.Use(s.requireParticipant)
			r.Get("/report", s.handleGetRaceReport)
		})

		// Host/GM capability (Authorization: Bearer <host_token>).
		r.Group(func(r chi.Router) {
			r.Use(s.requireHost)
			r.Get("/teams", s.handleListTeams)
			r.Post("/start", s.handleStartGame)
			r.Post("/end", s.handleEndGame)
			r.Post("/dispute/resolve", s.handleDisputeResolve)
			r.Post("/override/coins", s.handleOverrideCoins)
			r.Post("/override/clear-challenge", s.handleOverrideClearChallenge)
			r.Post("/override/clear-effect", s.handleOverrideClearEffect)
			// Host review queue endpoint.
			r.Get("/review", s.handleListPendingReview)
			// Game deletion endpoint.
			r.Delete("/", s.handleDeleteGame)
		})

		// Verdict submission endpoint.
		r.Group(func(r chi.Router) {
			r.Use(s.requireVerdictAuthor)
			r.Post("/verdict", s.handleVerdict)
		})
	})
}

type gameRecord struct {
	ID           string
	BoardID      string
	BoardVersion int
	Status       string
	// Mode specifies the game mode.
	Mode    string
	Ruleset rules.Ruleset
	// PurgingAt is non-nil if the game is being deleted.
	PurgingAt *time.Time
}

type teamRecord struct {
	ID string
}

func (s *Server) nextSequence(ctx context.Context, gameID string) (int, error) {
	var currentSeq int
	err := s.DB.Pool.QueryRow(ctx, `SELECT COALESCE(MAX(sequence), 0) FROM events WHERE game_id = $1`, gameID).Scan(&currentSeq)
	if err != nil {
		return 0, err
	}
	return currentSeq + 1, nil
}

// requireTeam resolves the game and team associated with the request's bearer token.
func (s *Server) requireTeam(w http.ResponseWriter, r *http.Request, gameID string) (*gameRecord, *teamRecord, bool) {
	token := bearerToken(r)
	if token == "" {
		writeError(r.Context(), w, http.StatusUnauthorized, "team token required (Authorization: Bearer <join_token>)")
		return nil, nil, false
	}
	game, team, err := s.resolveGameAndTeam(r.Context(), gameID, token)
	if err != nil {
		writeError(r.Context(), w, http.StatusForbidden, err.Error())
		return nil, nil, false
	}
	return game, team, true
}

// loadGame retrieves a game record and normalizes its ruleset.
func (s *Server) loadGame(ctx context.Context, gameID string) (*gameRecord, error) {
	var game gameRecord
	var rulesetBytes []byte
	err := s.DB.Pool.QueryRow(ctx, `
		SELECT id, board_id, board_version, status, mode, ruleset, purging_at FROM games WHERE id = $1
	`, gameID).Scan(&game.ID, &game.BoardID, &game.BoardVersion, &game.Status, &game.Mode, &rulesetBytes, &game.PurgingAt)
	if err != nil {
		return nil, errors.New("game not found or access denied")
	}

	// Default empty mode to team mode.
	if game.Mode == "" {
		game.Mode = rules.ModeTeam
	}

	if err := json.Unmarshal(rulesetBytes, &game.Ruleset); err != nil {
		return nil, fmt.Errorf("failed to parse game ruleset: %w", err)
	}
	game.Ruleset = rules.NormalizeRuleset(game.Ruleset)

	return &game, nil
}

func (s *Server) resolveGameAndTeam(ctx context.Context, gameID, joinToken string) (*gameRecord, *teamRecord, error) {
	game, err := s.loadGame(ctx, gameID)
	if err != nil {
		return nil, nil, err
	}

	var team teamRecord
	err = s.DB.Pool.QueryRow(ctx, `
		SELECT team_id FROM team_tokens WHERE game_id = $1 AND token_hash = $2
	`, gameID, hashToken(joinToken)).Scan(&team.ID)
	if err != nil {
		return nil, nil, errors.New("invalid join token for this game")
	}

	return game, &team, nil
}

// sanitizeDisplayName cleans input text by stripping control characters and limiting rune length.
func sanitizeDisplayName(name string, maxRunes int) string {
	cleaned := strings.Map(func(r rune) rune {
		if r == '\t' || r == '\n' || r == '\r' {
			return ' '
		}
		if unicode.IsControl(r) || unicode.Is(unicode.Cf, r) {
			return -1
		}
		return r
	}, name)
	cleaned = strings.Join(strings.Fields(cleaned), " ")
	if len([]rune(cleaned)) > maxRunes {
		cleaned = strings.TrimSpace(string([]rune(cleaned)[:maxRunes]))
	}
	return cleaned
}

// derefOr returns the dereferenced string pointer value or fallback when nil.
func derefOr(v *string, fallback string) string {
	if v == nil {
		return fallback
	}
	return *v
}
