package projections

import (
	"fmt"
	"strings"
	"time"
	"unicode"
)

// teamLabel returns the display name of a team for race logging.
func (p *GameStateProjection) teamLabel(teamID string) string {
	if info, ok := p.Teams[teamID]; ok && info.Name != "" {
		return info.Name
	}
	return "an unknown team"
}

// waypointLabel returns the board name of a waypoint.
func (p *GameStateProjection) waypointLabel(waypointID string) string {
	for _, wp := range p.Board.Waypoints {
		if wp.ID == waypointID {
			if wp.Name != "" {
				return wp.Name
			}
			break
		}
	}
	return "an unnamed waypoint"
}

// roadLabel describes a road by the two waypoints it connects.
func (p *GameStateProjection) roadLabel(roadID string) string {
	for _, road := range p.Board.Roads {
		if road.ID == roadID {
			return fmt.Sprintf("the road between %s and %s", p.waypointLabel(road.WaypointIDA), p.waypointLabel(road.WaypointIDB))
		}
	}
	return "an unnamed road"
}

// placeParts resolves whether an identifier refers to a waypoint or road.
func (p *GameStateProjection) placeParts(waypointID, roadID string) (kind, name string) {
	for _, id := range []string{waypointID, roadID} {
		if id == "" {
			continue
		}
		for _, wp := range p.Board.Waypoints {
			if wp.ID == id {
				return "waypoint", p.waypointLabel(id)
			}
		}
		for _, road := range p.Board.Roads {
			if road.ID == id {
				return "road", p.roadLabel(id)
			}
		}
	}
	return "", ""
}

// targetLabel returns a description of the waypoint or road a challenge is on.
func (p *GameStateProjection) targetLabel(waypointID, roadID string) string {
	switch kind, name := p.placeParts(waypointID, roadID); kind {
	case "waypoint":
		return "waypoint " + name
	case "road":
		return name
	}
	return "an unknown place"
}

// submissionLabel describes a submission by team name and location.
func (p *GameStateProjection) submissionLabel(submissionID string) string {
	sub, ok := p.Submissions[submissionID]
	if !ok {
		return "an unknown photo"
	}
	team := p.teamLabel(sub.TeamID)
	switch kind, name := p.placeParts(sub.WaypointID, sub.RoadID); kind {
	case "waypoint":
		return fmt.Sprintf("%s's photo at %s", team, name)
	case "road":
		return fmt.Sprintf("%s's photo on %s", team, name)
	}
	return fmt.Sprintf("%s's photo", team)
}

// powerupLabel returns the catalog or formatted name of a powerup.
func (p *GameStateProjection) powerupLabel(powerupID string) string {
	for _, pu := range p.Board.Powerups {
		if pu.ID == powerupID && pu.Name != "" {
			return pu.Name
		}
	}
	words := strings.Fields(phrase(powerupID))
	for i, word := range words {
		words[i] = capitalize(word)
	}
	return strings.Join(words, " ")
}

// boardLabel returns the name of the active game board.
func (p *GameStateProjection) boardLabel() string {
	if p.Board.Name != "" {
		return p.Board.Name
	}
	return "an unnamed board"
}

// phrase converts a snake_case identifier into space-separated words.
func phrase(slug string) string {
	if slug == "" {
		return "unknown"
	}
	return strings.ReplaceAll(slug, "_", " ")
}

// capitalize capitalizes the first character of s.
func capitalize(s string) string {
	if s == "" {
		return s
	}
	runes := []rune(s)
	runes[0] = unicode.ToUpper(runes[0])
	return string(runes)
}

// humanDuration formats a duration into a concise human-readable string.
func humanDuration(d time.Duration) string {
	if d < time.Second {
		return "a moment"
	}
	if d < time.Minute {
		return fmt.Sprintf("%ds", int(d.Round(time.Second).Seconds()))
	}
	d = d.Round(time.Minute)
	hours := int(d.Hours())
	minutes := int(d.Minutes()) % 60
	if hours == 0 {
		return fmt.Sprintf("%dm", minutes)
	}
	if minutes == 0 {
		return fmt.Sprintf("%dh", hours)
	}
	return fmt.Sprintf("%dh %dm", hours, minutes)
}
