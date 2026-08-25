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

	return &view
}
