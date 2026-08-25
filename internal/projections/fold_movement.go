package projections

import (
	"slices"

	"github.com/Jessevdz/RunwayTheGame/internal/eventstore"
)

// foldWaypointReached updates a team's current waypoint and cleared progress.
func foldWaypointReached(p *GameStateProjection, _ eventstore.Event, payload eventstore.WaypointReachedPayload) {
	prog := p.Progress[payload.TeamID]
	prog.CurrentWaypointID = payload.WaypointID
	if payload.IsFinish {
		prog.ReachedFinish = true
	}
	// Record waypoints with no challenge or already cleared by the field as cleared.
	openedByField := false
	for _, cleared := range p.WaypointStates[payload.WaypointID].ClearedBy {
		if cleared {
			openedByField = true
			break
		}
	}
	if (!p.boardHasChallengeAt(payload.WaypointID) || openedByField) && !slices.Contains(prog.ClearedWaypoints, payload.WaypointID) {
		prog.ClearedWaypoints = append(prog.ClearedWaypoints, payload.WaypointID)
	}
	p.Progress[payload.TeamID] = prog
	p.logf("Team %s reached waypoint %s", p.teamLabel(payload.TeamID), p.waypointLabel(payload.WaypointID))
}

// foldTeamFinished records a team's finish placement and initializes coin rush if first finisher.
func foldTeamFinished(p *GameStateProjection, e eventstore.Event, payload eventstore.TeamFinishedPayload) {
	if p.CoinRush == nil {
		p.CoinRush = &CoinRushState{FirstFinishAt: e.CreatedAt}
	}
	p.CoinRush.Finishers = append(p.CoinRush.Finishers, CoinRushFinisher{
		TeamID:     payload.TeamID,
		Rank:       payload.Rank,
		BonusCoins: payload.BonusCoins,
		FinishedAt: e.CreatedAt,
	})
	p.logf("Team %s finished in place %d (+%d coins)", p.teamLabel(payload.TeamID), payload.Rank, payload.BonusCoins)
}

// foldArrivalFlagged logs a suspicious arrival event for review.
func foldArrivalFlagged(p *GameStateProjection, _ eventstore.Event, payload eventstore.ArrivalFlaggedPayload) {
	p.logf("Arrival of team %s at waypoint %s flagged for review: %s", p.teamLabel(payload.TeamID), p.waypointLabel(payload.WaypointID), payload.Reason)
}
