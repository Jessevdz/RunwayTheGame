package projections

import (

	"github.com/Jessevdz/RunwayTheGame/internal/eventstore"
)

// foldGameCreated initializes game board, status, and mode.
func foldGameCreated(fc foldCtx, p *GameStateProjection, _ eventstore.Event, payload eventstore.GameCreatedPayload) error {
	board, err := LoadBoard(fc.ctx, fc.conn, payload.BoardID, 1)
	if err != nil {
		p.Board.ID = payload.BoardID
	} else {
		p.Board = board
	}
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
	var payload eventstore.GameEndedPayload
	if decodePayload(fc.ctx, e, &payload) {
		p.Winner = payload.WinnerTeamID
	}
	p.Status = "ended"
	p.Clock.FinishedAt = e.CreatedAt
	p.logf("Game ended")
	return nil
}
