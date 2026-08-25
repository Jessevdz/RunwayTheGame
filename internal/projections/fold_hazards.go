package projections

import (

	"github.com/Jessevdz/RunwayTheGame/internal/eventstore"
	"github.com/Jessevdz/RunwayTheGame/internal/rules"
)

// dropEffects filters out team effects matching the predicate.
func dropEffects(effects []rules.TeamEffect, drop func(rules.TeamEffect) bool) []rules.TeamEffect {
	kept := []rules.TeamEffect{}
	for _, eff := range effects {
		if drop(eff) {
			continue
		}
		kept = append(kept, eff)
	}
	return kept
}

// foldRoadblockPlaced places a roadblock on a road, replacing any prior roadblock.
func foldRoadblockPlaced(p *GameStateProjection, _ eventstore.Event, payload eventstore.RoadblockPlacedPayload) {
	p.Roadblocks[payload.RoadID] = Roadblock{
		RoadID:        payload.RoadID,
		PlacedBy:      payload.PlacedBy,
		CardID:        payload.CardID,
		ChallengeText: payload.ChallengeText,
		ClearedBy:     map[string]bool{},
	}
	p.logf("Roadblock placed on %s by team %s: %s", p.roadLabel(payload.RoadID), p.teamLabel(payload.PlacedBy), payload.ChallengeText)
}

// foldRoadblockCleared records a team clearing a roadblock.
func foldRoadblockCleared(p *GameStateProjection, _ eventstore.Event, payload eventstore.RoadblockClearedPayload) {
	if rb, ok := p.Roadblocks[payload.RoadID]; ok {
		if rb.ClearedBy == nil {
			rb.ClearedBy = map[string]bool{}
		}
		rb.ClearedBy[payload.TeamID] = true
		p.Roadblocks[payload.RoadID] = rb
	}
	p.logf("Team %s cleared the roadblock on %s", p.teamLabel(payload.TeamID), p.roadLabel(payload.RoadID))
}

// foldCurseApplied applies a curse effect to the target team.
func foldCurseApplied(p *GameStateProjection, _ eventstore.Event, payload eventstore.CurseAppliedPayload) {
	p.Effects[payload.TargetTeamID] = append(p.Effects[payload.TargetTeamID], rules.TeamEffect{
		Kind:  "curse",
		Until: payload.Until,
		Meta:  payload.CardID,
	})
	p.logf("Curse applied to team %s: %s", p.teamLabel(payload.TargetTeamID), payload.Text)
}

// foldCurseCleared removes a curse card effect from the target team.
func foldCurseCleared(p *GameStateProjection, _ eventstore.Event, payload eventstore.CurseClearedPayload) {
	p.Effects[payload.TargetTeamID] = dropEffects(p.Effects[payload.TargetTeamID], func(eff rules.TeamEffect) bool {
		return eff.Kind == "curse" && eff.Meta == payload.CardID
	})
	p.logf("Curse cleared for team %s (reason: %s)", p.teamLabel(payload.TargetTeamID), phrase(payload.Reason))
}

// foldTeamFrozen applies a freeze effect to a team.
func foldTeamFrozen(p *GameStateProjection, e eventstore.Event, payload eventstore.TeamFrozenPayload) {
	p.Effects[payload.TeamID] = append(p.Effects[payload.TeamID], rules.TeamEffect{
		Kind:  "freeze",
		Until: payload.Until,
		Meta:  payload.Source,
	})
	p.logf("Team %s frozen for %s (by team %s)", p.teamLabel(payload.TeamID), humanDuration(payload.Until.Sub(e.CreatedAt)), p.teamLabel(payload.Source))
}

// foldTrackerToggled updates the tracker status effect for a team.
func foldTrackerToggled(p *GameStateProjection, e eventstore.Event, payload eventstore.TrackerToggledPayload) {
	if payload.Disabled {
		p.Effects[payload.TeamID] = append(p.Effects[payload.TeamID], rules.TeamEffect{
			Kind:  "tracker_off",
			Until: payload.Until,
		})
		p.logf("Team %s disabled tracker for %s", p.teamLabel(payload.TeamID), humanDuration(payload.Until.Sub(e.CreatedAt)))
		return
	}
	p.Effects[payload.TeamID] = dropEffects(p.Effects[payload.TeamID], func(eff rules.TeamEffect) bool {
		return eff.Kind == "tracker_off"
	})
	p.logf("Team %s tracker re-enabled", p.teamLabel(payload.TeamID))
}

// foldEffectCleared removes all active effects of a specified type for a team.
func foldEffectCleared(p *GameStateProjection, _ eventstore.Event, payload eventstore.EffectClearedPayload) {
	p.Effects[payload.TeamID] = dropEffects(p.Effects[payload.TeamID], func(eff rules.TeamEffect) bool {
		return eff.Kind == payload.EffectType
	})
	p.logf("[GM] Cleared effect %s for team %s — %s", phrase(payload.EffectType), p.teamLabel(payload.TeamID), payload.Note)
}
