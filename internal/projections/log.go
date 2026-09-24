package projections

import "fmt"

// LogEntry is one race-log line together with the audience allowed to read it.
type LogEntry struct {
	Text string
	// OwnerTeamID, when set, limits the line to that team and the host.
	OwnerTeamID string
}

// logf appends a race-log line every participant may read.
func (p *GameStateProjection) logf(format string, args ...any) {
	p.Log = append(p.Log, LogEntry{Text: fmt.Sprintf(format, args...)})
}

// logfOwn appends a race-log line only teamID and the host may read.
func (p *GameStateProjection) logfOwn(teamID, format string, args ...any) {
	p.Log = append(p.Log, LogEntry{Text: fmt.Sprintf(format, args...), OwnerTeamID: teamID})
}

// RedactFor returns a copy of the projection scoped to one viewer, filling in the
// PublicLog the raw projection deliberately leaves empty.
func (p *GameStateProjection) RedactFor(viewerTeamID string, isHost bool) *GameStateProjection {
	view := *p
	view.Log = nil

	view.PublicLog = make([]string, 0, len(p.Log))
	for _, entry := range p.Log {
		if entry.OwnerTeamID != "" && !isHost && entry.OwnerTeamID != viewerTeamID {
			continue
		}
		view.PublicLog = append(view.PublicLog, entry.Text)
	}

	// A team's holdings reveal what it bought, so only its own row survives.
	if !isHost {
		own := make(map[string][]string, 1)
		if items, ok := p.Inventory[viewerTeamID]; ok && viewerTeamID != "" {
			own[viewerTeamID] = items
		}
		view.Inventory = own
	}

	// A team's evidence and grading are private, so only its own submissions survive.
	if !isHost {
		own := make(map[string]SubmissionInfo, 1)
		for id, sub := range p.Submissions {
			if sub.TeamID == viewerTeamID && viewerTeamID != "" {
				own[id] = sub
			}
		}
		view.Submissions = own
	}

	// A team's precise coin balance and disputes are private to that team and
	// the host. Standings retain their ordering but omit rivals' balances.
	if !isHost {
		ownCoins := make(map[string]int, 1)
		if value, ok := p.Coins[viewerTeamID]; ok && viewerTeamID != "" {
			ownCoins[viewerTeamID] = value
		}
		view.Coins = ownCoins

		view.StandingsList = append([]StandingRow(nil), p.StandingsList...)
		for i := range view.StandingsList {
			if view.StandingsList[i].TeamID != viewerTeamID || viewerTeamID == "" {
				view.StandingsList[i].Coins = 0
				view.StandingsList[i].CoinsVisible = false
			}
		}

		ownDisputes := make(map[string]DisputeInfo, 1)
		for id, dispute := range p.Disputes {
			if dispute.ByTeamID == viewerTeamID && viewerTeamID != "" {
				ownDisputes[id] = dispute
			}
		}
		view.Disputes = ownDisputes
	}

	return &view
}
