package api

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v4"

	"github.com/Jessevdz/RunwayTheGame/internal/projections"
	"github.com/Jessevdz/RunwayTheGame/internal/rules"
)

var errCoinRushExpired = errors.New("coin rush deadline has elapsed")

func writeGameMutationGuardError(ctx context.Context, w http.ResponseWriter, err error) bool {
	if errors.Is(err, errGameNotLive) || errors.Is(err, errCoinRushExpired) {
		writeError(ctx, w, http.StatusConflict, "game is no longer accepting changes")
		return true
	}
	return false
}

// guardLiveGameMutation serializes state-changing commands against game end and
// rejects writes after a Coin Rush deadline, even before its sweep ends the row.
func guardLiveGameMutation(ctx context.Context, tx pgx.Tx, gameID string, proj *projections.GameStateProjection) error {
	var status, mode string
	if err := tx.QueryRow(ctx, `SELECT status, mode FROM games WHERE id = $1 FOR UPDATE`, gameID).Scan(&status, &mode); err != nil {
		return err
	}
	if status != "live" {
		return errGameNotLive
	}
	if mode == rules.ModeCoinRush && proj != nil && proj.CoinRush != nil && proj.CoinRush.Expired(time.Now().UTC()) {
		return errCoinRushExpired
	}
	return nil
}
