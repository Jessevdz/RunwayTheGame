package projections

import (
	"slices"

	"github.com/Jessevdz/RunwayTheGame/internal/eventstore"
	"github.com/Jessevdz/RunwayTheGame/internal/rules"
)

// targetWaypoint returns the waypoint ID specified in a challenge payload, falling back to its road ID.
func targetWaypoint(waypointID, roadID string) string {
	if waypointID == "" {
		return roadID
	}
	return waypointID
}

// targetRoad returns the road ID specified in a challenge payload, falling back to its waypoint ID.
func targetRoad(waypointID, roadID string) string {
	if roadID == "" {
		return waypointID
	}
	return roadID
}

// foldChallengeAttemptStarted records an attempt in the race log.
func foldChallengeAttemptStarted(p *GameStateProjection, _ eventstore.Event, payload eventstore.ChallengeAttemptStartedPayload) {
	p.logf("Team %s started a challenge on %s", p.teamLabel(payload.TeamID), p.targetLabel(payload.WaypointID, payload.RoadID))
}

// foldSubmissionCreated records a new submission with pending status.
func foldSubmissionCreated(p *GameStateProjection, e eventstore.Event, payload eventstore.SubmissionCreatedPayload) {
	p.Submissions[payload.SubmissionID] = SubmissionInfo{
		SubmissionID: payload.SubmissionID,
		TeamID:       payload.TeamID,
		WaypointID:   targetWaypoint(payload.WaypointID, payload.RoadID),
		RoadID:       payload.RoadID,
		ChallengeID:  payload.ChallengeID,
		BlobRef:      payload.BlobRef,
		Status:       "pending",
		CreatedAt:    e.CreatedAt,
	}
}

// foldVerdictReturned updates a submission with its grading verdict.
func foldVerdictReturned(p *GameStateProjection, _ eventstore.Event, payload eventstore.VerdictReturnedPayload) {
	if sub, ok := p.Submissions[payload.SubmissionID]; ok {
		sub.Status = payload.Verdict
		sub.Confidence = payload.Confidence
		sub.Rationale = payload.Rationale
		sub.Source = payload.Source
		p.Submissions[payload.SubmissionID] = sub
	}
	p.logf("Verdict on %s: %s (rationale: %s)", p.submissionLabel(payload.SubmissionID), payload.Verdict, payload.Rationale)
}

// foldChallengeCompleted updates waypoint and road state when a challenge is cleared.
func foldChallengeCompleted(p *GameStateProjection, _ eventstore.Event, payload eventstore.ChallengeCompletedPayload) {
	waypointID := targetWaypoint(payload.WaypointID, payload.RoadID)
	ns := p.WaypointStates[waypointID]
	if ns.ClearedBy == nil {
		ns.ClearedBy = make(map[string]bool)
	}
	ns.ClearedBy[payload.TeamID] = true
	p.WaypointStates[waypointID] = ns

	if roadID := targetRoad(payload.WaypointID, payload.RoadID); roadID != "" {
		ss := p.RoadStates[roadID]
		if ss.CompletedBy == "" {
			ss.CompletedBy = payload.TeamID
		}
		p.RoadStates[roadID] = ss
	}

	prog := p.Progress[payload.TeamID]
	if !slices.Contains(prog.ClearedWaypoints, waypointID) {
		prog.ClearedWaypoints = append(prog.ClearedWaypoints, waypointID)
	}
	p.Progress[payload.TeamID] = prog

	target := p.targetLabel(payload.WaypointID, payload.RoadID)
	if payload.Source == "gm" {
		p.logf("[GM] Cleared the challenge on %s for team %s — %s", target, p.teamLabel(payload.TeamID), payload.Note)
	} else if payload.FirstCompleter {
		p.logf("%s cleared by team %s (+%d coins, first to clear)", capitalize(target), p.teamLabel(payload.TeamID), payload.CoinReward)
	} else {
		p.logf("%s cleared by team %s (+%d coins)", capitalize(target), p.teamLabel(payload.TeamID), payload.CoinReward)
	}
}

// foldChallengeVetoed applies penalties and marks a challenge bypassed.
func foldChallengeVetoed(p *GameStateProjection, e eventstore.Event, payload eventstore.ChallengeVetoedPayload) {
	waypointID := targetWaypoint(payload.WaypointID, payload.RoadID)
	ns := p.WaypointStates[waypointID]
	if ns.Bypassed == nil {
		ns.Bypassed = make(map[string]bool)
	}
	ns.Bypassed[payload.TeamID] = true
	p.WaypointStates[waypointID] = ns

	if roadID := targetRoad(payload.WaypointID, payload.RoadID); roadID != "" {
		ss := p.RoadStates[roadID]
		if ss.Bypassed == nil {
			ss.Bypassed = make(map[string]bool)
		}
		ss.Bypassed[payload.TeamID] = true
		p.RoadStates[roadID] = ss
	}

	prog := p.Progress[payload.TeamID]
	if !slices.Contains(prog.ClearedWaypoints, waypointID) {
		prog.ClearedWaypoints = append(prog.ClearedWaypoints, waypointID)
	}
	p.Progress[payload.TeamID] = prog

	// Only record active veto penalty effects to prevent adding expired timers.
	if payload.PenaltyUntil.After(e.CreatedAt) {
		p.Effects[payload.TeamID] = append(p.Effects[payload.TeamID], rules.TeamEffect{
			Kind:  "veto_penalty",
			Until: payload.PenaltyUntil,
			Meta:  waypointID,
		})
	}

	p.Clock.VetoCount++
	p.Clock.TimePenaltySeconds += payload.TimePenaltySeconds

	team := p.teamLabel(payload.TeamID)
	target := p.targetLabel(payload.WaypointID, payload.RoadID)
	switch {
	case payload.TimePenaltySeconds > 0:
		p.logf("Team %s vetoed the challenge on %s (+%ds on the clock)", team, target, payload.TimePenaltySeconds)
	case payload.PenaltyUntil.After(e.CreatedAt):
		p.logf("Team %s vetoed the challenge on %s (locked out for %s)", team, target, humanDuration(payload.PenaltyUntil.Sub(e.CreatedAt)))
	default:
		p.logf("Team %s skipped the challenge on %s", team, target)
	}
}

// foldChallengeConflictNoted logs a challenge conflict message.
func foldChallengeConflictNoted(p *GameStateProjection, _ eventstore.Event, payload eventstore.ChallengeConflictNotedPayload) {
	p.logf("Team %s: %s", p.teamLabel(payload.TeamID), payload.Message)
}
