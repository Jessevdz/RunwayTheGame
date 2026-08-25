package projections

import (
	"slices"

	"github.com/Jessevdz/RunwayTheGame/internal/eventstore"
)

// foldCoinsChanged updates a team's coin balance.
func foldCoinsChanged(p *GameStateProjection, _ eventstore.Event, payload eventstore.CoinsChangedPayload) {
	p.Coins[payload.TeamID] = payload.BalanceAfter
	if payload.Source == "gm" {
		p.logf("[GM] Adjusted coins for team %s: %+d — %s", p.teamLabel(payload.TeamID), payload.Delta, payload.Note)
	} else if payload.Reason == "powerup_purchase" {
		// Naming the spend would tell rivals which power-up was bought, and its cost narrows it further.
		p.logfOwn(payload.TeamID, "Team %s coins changed by %d (balance: %d, reason: %s)", p.teamLabel(payload.TeamID), payload.Delta, payload.BalanceAfter, phrase(payload.Reason))
	} else {
		p.logf("Team %s coins changed by %d (balance: %d, reason: %s)", p.teamLabel(payload.TeamID), payload.Delta, payload.BalanceAfter, phrase(payload.Reason))
	}
}

// foldPowerupPurchased adds a purchased powerup to a team's inventory.
func foldPowerupPurchased(p *GameStateProjection, _ eventstore.Event, payload eventstore.PowerupPurchasedPayload) {
	p.Inventory[payload.TeamID] = append(p.Inventory[payload.TeamID], payload.Powerup)
	// A purchase stays secret until the power-up is used; only the buyer and the host see this.
	p.logfOwn(payload.TeamID, "Team %s purchased powerup: %s", p.teamLabel(payload.TeamID), p.powerupLabel(payload.Powerup))
}

// foldPowerupUsed removes a used powerup from a team's inventory.
func foldPowerupUsed(p *GameStateProjection, _ eventstore.Event, payload eventstore.PowerupUsedPayload) {
	inv := p.Inventory[payload.TeamID]
	if idx := slices.Index(inv, payload.Powerup); idx != -1 {
		p.Inventory[payload.TeamID] = append(inv[:idx], inv[idx+1:]...)
	}
	p.logf("Team %s used powerup: %s", p.teamLabel(payload.TeamID), p.powerupLabel(payload.Powerup))
}

// foldCardDrawn records a drawn card in the race log.
func foldCardDrawn(p *GameStateProjection, _ eventstore.Event, payload eventstore.CardDrawnPayload) {
	p.logf("Team %s drew card: %s (deck: %s)", p.teamLabel(payload.TeamID), payload.Text, phrase(payload.Deck))
}
