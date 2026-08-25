package projections

import (

	"github.com/Jessevdz/RunwayTheGame/internal/eventstore"
	"github.com/Jessevdz/RunwayTheGame/internal/rules"
)

// foldTeamJoined initializes team metadata, initial waypoint progress, coins, inventory, and effects.
func foldTeamJoined(_ foldCtx, p *GameStateProjection, _ eventstore.Event, payload eventstore.TeamJoinedPayload) error {
	p.Teams[payload.TeamID] = TeamInfo{Name: payload.Name, SlotIndex: payload.SlotIndex}

	startWP := p.startWaypointID()

	cleared := []string{}
	if startWP != "" && !p.boardHasChallengeAt(startWP) {
		cleared = append(cleared, startWP)
	}

	p.Progress[payload.TeamID] = rules.TeamProgress{
		CurrentWaypointID: startWP,
		TraversedRoads:    []string{},
		ClearedWaypoints:  cleared,
		ReachedFinish:     false,
	}
	p.Coins[payload.TeamID] = 0
	p.Inventory[payload.TeamID] = []string{}
	p.Effects[payload.TeamID] = []rules.TeamEffect{}
	p.logf("Team %s joined", payload.Name)
	return nil
}

// foldTeamUpdated renames or re-slots an existing squad.
func foldTeamUpdated(_ foldCtx, p *GameStateProjection, _ eventstore.Event, payload eventstore.TeamUpdatedPayload) error {
	// Update team metadata only if the team exists to prevent recreating disbanded teams.
	if _, ok := p.Teams[payload.TeamID]; ok {
		p.Teams[payload.TeamID] = TeamInfo{Name: payload.Name, SlotIndex: payload.SlotIndex}
	}
	return nil
}

// foldTeamDisbanded removes a squad and everything keyed by it.
func foldTeamDisbanded(_ foldCtx, p *GameStateProjection, _ eventstore.Event, payload eventstore.TeamDisbandedPayload) error {
	// Delete all state entries associated with the disbanded team.
	delete(p.Teams, payload.TeamID)
	delete(p.Progress, payload.TeamID)
	delete(p.Coins, payload.TeamID)
	delete(p.Inventory, payload.TeamID)
	delete(p.Effects, payload.TeamID)
	delete(p.Positions, payload.TeamID)
	return nil
}
