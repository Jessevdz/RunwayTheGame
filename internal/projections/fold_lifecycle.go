package projections

import (
	"fmt"

	"github.com/Jessevdz/RunwayTheGame/internal/eventstore"
)

// foldGameCreated initializes game board, status, and mode.
func foldGameCreated(fc foldCtx, p *GameStateProjection, _ eventstore.Event, payload eventstore.GameCreatedPayload) error {
	version := payload.BoardVersion
	if version < 1 {
		// GameCreated events written before board_version was added recover the
		// immutable version pinned on the game row at creation time.
		if err := fc.conn.QueryRow(fc.ctx, "SELECT board_version FROM games WHERE id = $1", p.GameID).Scan(&version); err != nil {
			return fmt.Errorf("failed to resolve legacy game board version: %w", err)
		}
	}
	board, err := LoadBoard(fc.ctx, fc.conn, payload.BoardID, version)
	if err != nil {
		return fmt.Errorf("failed to load pinned game board %s version %d: %w", payload.BoardID, version, err)
	}
	p.Board = board
	p.Status = "draft"
	if payload.Mode != "" {
		p.Mode = payload.Mode
	}
	p.logf("Game created with board %s", p.boardLabel())
	return nil
}

// foldGameStarted transitions game status to live and starts the run clock.
func foldGameStarted(_ foldCtx, p *GameStateProjection, e eventstore.Event) error {
	p.Status = "live"
	p.Clock.StartedAt = e.CreatedAt
	p.logf("Game started")
	return nil
}

// foldGameEnded transitions the game to ended status and records the finish time.
func foldGameEnded(fc foldCtx, p *GameStateProjection, e eventstore.Event) error {
	if p.Status == "ended" {
		return nil
	}
	var payload eventstore.GameEndedPayload
	if decodePayload(fc.ctx, e, &payload) {
		p.Winner = payload.WinnerTeamID
	}
	p.Status = "ended"
	p.Clock.FinishedAt = e.CreatedAt
	p.logf("Game ended")
	return nil
}
