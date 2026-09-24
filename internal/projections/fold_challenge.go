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

// challengeTarget separates road challenge targets from legacy waypoint
// targets, which were recorded in RoadID before road challenges were supported.
func challengeTarget(p *GameStateProjection, waypointID, roadID string) (string, string) {
	if waypointID != "" && roadID != "" {
		return waypointID, roadID
	}
	id := waypointID
	if id == "" {
		id = roadID
	}
	if id == "" {
		return "", ""
	}
	isWaypoint, isRoad := false, false
	for _, waypoint := range p.Board.Waypoints {
		isWaypoint = isWaypoint || waypoint.ID == id
	}
	for _, road := range p.Board.Roads {
		isRoad = isRoad || road.ID == id
	}
	if isRoad && !isWaypoint {
		return "", id
	}
	return id, ""
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
		p.logfOwn(sub.TeamID, "Verdict on %s: %s", p.submissionLabel(payload.SubmissionID), payload.Verdict)
		return
	}
	// Old or incomplete streams may lack the SubmissionCreated event; keep a
	// rationale-free log entry rather than exposing grading notes publicly.
	p.logf("Verdict recorded for a submission: %s", payload.Verdict)
}

// foldChallengeCompleted updates waypoint and road state when a challenge is cleared.
func foldChallengeCompleted(p *GameStateProjection, _ eventstore.Event, payload eventstore.ChallengeCompletedPayload) {
	waypointID, roadID := challengeTarget(p, payload.WaypointID, payload.RoadID)
	if waypointID != "" {
		ns := p.WaypointStates[waypointID]
		if ns.ClearedBy == nil {
			ns.ClearedBy = make(map[string]bool)
		}
		ns.ClearedBy[payload.TeamID] = true
		p.WaypointStates[waypointID] = ns

		prog := p.Progress[payload.TeamID]
		if !slices.Contains(prog.ClearedWaypoints, waypointID) {
			prog.ClearedWaypoints = append(prog.ClearedWaypoints, waypointID)
		}
		p.Progress[payload.TeamID] = prog

		// A cleared waypoint also opens for teams already standing there. Keep
		// their credit local to progress: the completion owner remains the only
		// team recorded in ClearedBy and still owns any rewards.
		if roadID == "" {
			for teamID, otherProgress := range p.Progress {
				if teamID == payload.TeamID || otherProgress.CurrentWaypointID != waypointID {
					continue
				}
				if !slices.Contains(otherProgress.ClearedWaypoints, waypointID) {
					otherProgress.ClearedWaypoints = append(otherProgress.ClearedWaypoints, waypointID)
					p.Progress[teamID] = otherProgress
				}
			}
		}
	}

	if roadID != "" {
		ss := p.RoadStates[roadID]
		if ss.CompletedBy == "" {
			ss.CompletedBy = payload.TeamID
		}
		p.RoadStates[roadID] = ss
	}

	target := p.targetLabel(waypointID, roadID)
	if payload.Source == "gm" {
		p.logf("[GM] Cleared the challenge on %s for team %s — %s", target, p.teamLabel(payload.TeamID), payload.Note)
	} else if payload.FirstCompleter {
		p.logf("%s cleared by team %s (+%d coins, first to clear)", capitalize(target), p.teamLabel(payload.TeamID), payload.CoinReward)
	} else {
		p.logf("%s cleared by team %s (+%d coins)", capitalize(target), p.teamLabel(payload.TeamID), payload.CoinReward)
	}
}

// foldChallengeRevoked corrects a previously accepted challenge in the read model.
func foldChallengeRevoked(p *GameStateProjection, _ eventstore.Event, payload eventstore.ChallengeRevokedPayload) {
	if sub, ok := p.Submissions[payload.SubmissionID]; ok {
		sub.Status = "fail"
		p.Submissions[payload.SubmissionID] = sub
	}

	waypointID, roadID := challengeTarget(p, payload.WaypointID, payload.RoadID)
	if payload.RevokeClear {
		if waypointID != "" {
			ns := p.WaypointStates[waypointID]
			delete(ns.ClearedBy, payload.TeamID)
			p.WaypointStates[waypointID] = ns

			prog := p.Progress[payload.TeamID]
			prog.ClearedWaypoints = slices.DeleteFunc(prog.ClearedWaypoints, func(id string) bool { return id == waypointID })
			p.Progress[payload.TeamID] = prog
		}
	}

	if roadID != "" {
		state := p.RoadStates[roadID]
		if state.CompletedBy == payload.TeamID {
			state.CompletedBy = payload.RestoreCompletedBy
			p.RoadStates[roadID] = state
		}
	}
	p.logf("Challenge on %s revoked for team %s", p.targetLabel(waypointID, roadID), p.teamLabel(payload.TeamID))
}

// foldChallengeVetoed applies penalties and marks a challenge bypassed.
func foldChallengeVetoed(p *GameStateProjection, e eventstore.Event, payload eventstore.ChallengeVetoedPayload) {
	waypointID := payload.WaypointID
	if waypointID != "" && payload.RoadID == "" {
		ns := p.WaypointStates[waypointID]
		if ns.Bypassed == nil {
			ns.Bypassed = make(map[string]bool)
		}
		ns.Bypassed[payload.TeamID] = true
		p.WaypointStates[waypointID] = ns
	}

	if roadID := payload.RoadID; roadID != "" {
		ss := p.RoadStates[roadID]
		if ss.Bypassed == nil {
			ss.Bypassed = make(map[string]bool)
		}
		ss.Bypassed[payload.TeamID] = true
		p.RoadStates[roadID] = ss
	}

	if waypointID != "" && payload.RoadID == "" {
		prog := p.Progress[payload.TeamID]
		if !slices.Contains(prog.ClearedWaypoints, waypointID) {
			prog.ClearedWaypoints = append(prog.ClearedWaypoints, waypointID)
		}
		p.Progress[payload.TeamID] = prog
	}

	// Only record active veto penalty effects to prevent adding expired timers.
	meta := waypointID
	if payload.RoadID != "" {
		meta = payload.RoadID
	}
	if payload.PenaltyUntil.After(e.CreatedAt) {
		p.Effects[payload.TeamID] = append(p.Effects[payload.TeamID], rules.TeamEffect{
			Kind:  "veto_penalty",
			Until: payload.PenaltyUntil,
			Meta:  meta,
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

// foldChallengeSkipped marks a purchased challenge skip without recording a veto.
func foldChallengeSkipped(p *GameStateProjection, _ eventstore.Event, payload eventstore.ChallengeSkippedPayload) {
	waypointID, roadID := challengeTarget(p, payload.WaypointID, payload.RoadID)
	p.Clock.SkipCount++
	if waypointID != "" && roadID == "" {
		state := p.WaypointStates[waypointID]
		if state.Bypassed == nil {
			state.Bypassed = make(map[string]bool)
		}
		state.Bypassed[payload.TeamID] = true
		p.WaypointStates[waypointID] = state

		progress := p.Progress[payload.TeamID]
		if !slices.Contains(progress.ClearedWaypoints, waypointID) {
			progress.ClearedWaypoints = append(progress.ClearedWaypoints, waypointID)
		}
		p.Progress[payload.TeamID] = progress
	}
	if roadID != "" {
		state := p.RoadStates[roadID]
		if state.Bypassed == nil {
			state.Bypassed = make(map[string]bool)
		}
		state.Bypassed[payload.TeamID] = true
		p.RoadStates[roadID] = state
	}

	p.logf("Team %s skipped the challenge on %s", p.teamLabel(payload.TeamID), p.targetLabel(waypointID, roadID))
}

// foldChallengeConflictNoted logs a challenge conflict message.
func foldChallengeConflictNoted(p *GameStateProjection, _ eventstore.Event, payload eventstore.ChallengeConflictNotedPayload) {
	p.logf("Team %s: %s", p.teamLabel(payload.TeamID), payload.Message)
}
