package projections

import (

	"github.com/Jessevdz/RunwayTheGame/internal/eventstore"
)

// foldDisputeRaised records an objection against a submission verdict.
func foldDisputeRaised(p *GameStateProjection, _ eventstore.Event, payload eventstore.DisputeRaisedPayload) {
	p.Disputes[payload.VerdictID] = DisputeInfo{
		VerdictID: payload.VerdictID,
		ByTeamID:  payload.ByTeamID,
		Objection: payload.Objection,
		Status:    "pending",
	}
	p.logf("Dispute raised by team %s on %s: %s", p.teamLabel(payload.ByTeamID), p.submissionLabel(payload.VerdictID), payload.Objection)
}

// foldDisputeResolved updates a dispute with its final outcome.
func foldDisputeResolved(p *GameStateProjection, _ eventstore.Event, payload eventstore.DisputeResolvedPayload) {
	if d, ok := p.Disputes[payload.VerdictID]; ok {
		d.Status = payload.Outcome
		d.Source = payload.Source
		p.Disputes[payload.VerdictID] = d
	}
	p.logf("Dispute on %s resolved: %s (source: %s)", p.submissionLabel(payload.VerdictID), payload.Outcome, phrase(payload.Source))
}
