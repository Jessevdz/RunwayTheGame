// Package projections provides read-model state projections derived from game event streams.
package projections

import (
	"encoding/json"
	"time"

	"github.com/Jessevdz/RunwayTheGame/internal/rules"
)

type DisputeInfo struct {
	VerdictID string `json:"verdict_id"`
	ByTeamID  string `json:"by_team_id"`
	Objection string `json:"objection"`
	Status    string `json:"status"` // "pending", "upheld", "overturned"
	Source    string `json:"source"` // "model", "gm"
}

type TeamInfo struct {
	Name      string `json:"name"`
	SlotIndex int    `json:"slot_index"`
}

type Position struct {
	Lat        float64   `json:"lat"`
	Lon        float64   `json:"lon"`
	AccuracyM  float64   `json:"accuracy_m"`
	ReportedAt time.Time `json:"reported_at"`
}

type Roadblock struct {
	RoadID        string `json:"road_id"`
	PlacedBy      string `json:"placed_by"`
	CardID        string `json:"card_id,omitempty"`
	ChallengeText string `json:"challenge_text"`
	// ClearedBy tracks teams that have cleared this roadblock.
	ClearedBy map[string]bool `json:"cleared_by,omitempty"`
}

// BlocksTeam reports whether this roadblock stands between a team and the road.
func (rb Roadblock) BlocksTeam(teamID string) bool {
	if rb.RoadID == "" || rb.PlacedBy == teamID {
		return false
	}
	for _, cleared := range rb.ClearedBy {
		if cleared {
			return false
		}
	}
	return true
}

type SubmissionInfo struct {
	SubmissionID string  `json:"submission_id"`
	TeamID       string  `json:"team_id"`
	WaypointID   string  `json:"waypoint_id,omitempty"`
	RoadID       string  `json:"road_id,omitempty"`
	ChallengeID  string  `json:"challenge_id"`
	BlobRef      string  `json:"blob_ref"`
	Status       string  `json:"status"` // "pending", "pass", "fail"
	Confidence   float64 `json:"confidence"`
	Rationale    string  `json:"rationale"`
	// Source specifies the grader identity for the submission.
	Source    string    `json:"source,omitempty"`
	CreatedAt time.Time `json:"created_at"`
}

type StandingRow struct {
	TeamID           string  `json:"team_id"`
	TeamName         string  `json:"team_name"`
	WaypointsReached int     `json:"waypoints_reached"`
	DistanceToFinish float64 `json:"distance_to_finish"`
	Coins            int     `json:"coins"`
	// Finished indicates whether the team reached the finish.
	Finished bool `json:"finished"`
	// FinishRank is the team's placement rank in a coin rush.
	FinishRank int `json:"finish_rank,omitempty"`
	// FinishBonus is the placement bonus coins awarded in a coin rush.
	FinishBonus int `json:"finish_bonus,omitempty"`
}

// RunClock tracks time elapsed and veto penalties for a solo run based on event log timestamps.
type RunClock struct {
	// StartedAt is the timestamp when the run started.
	StartedAt time.Time `json:"started_at,omitempty"`
	// FinishedAt is the timestamp when the run completed.
	FinishedAt time.Time `json:"finished_at,omitempty"`
	// TimePenaltySeconds is the total time penalty accrued from vetoes.
	TimePenaltySeconds int `json:"time_penalty_seconds"`
	// VetoCount is the number of vetoed challenges.
	VetoCount int `json:"veto_count"`
}

// MarshalJSON customizes JSON encoding to omit zero-value timestamps.
func (rc RunClock) MarshalJSON() ([]byte, error) {
	out := struct {
		StartedAt          *time.Time `json:"started_at,omitempty"`
		FinishedAt         *time.Time `json:"finished_at,omitempty"`
		TimePenaltySeconds int        `json:"time_penalty_seconds"`
		VetoCount          int        `json:"veto_count"`
	}{
		TimePenaltySeconds: rc.TimePenaltySeconds,
		VetoCount:          rc.VetoCount,
	}
	if !rc.StartedAt.IsZero() {
		started := rc.StartedAt
		out.StartedAt = &started
	}
	if !rc.FinishedAt.IsZero() {
		finished := rc.FinishedAt
		out.FinishedAt = &finished
	}
	return json.Marshal(out)
}

// Elapsed returns the duration elapsed between run start and finish (or current time).
func (rc RunClock) Elapsed(now time.Time) time.Duration {
	if rc.StartedAt.IsZero() {
		return 0
	}
	end := rc.FinishedAt
	if end.IsZero() {
		end = now
	}
	return rules.RunElapsed(rc.StartedAt, end, rc.TimePenaltySeconds)
}

// CoinRushFinisher represents a team's finish placement and reward in a coin rush game.
type CoinRushFinisher struct {
	TeamID     string `json:"team_id"`
	Rank       int    `json:"rank"`
	BonusCoins int    `json:"bonus_coins"`
	// FinishedAt is the timestamp when the team finished.
	FinishedAt time.Time `json:"finished_at"`
}

// CoinRushState tracks the finish countdown and finishing order in a coin rush game.
type CoinRushState struct {
	// FirstFinishAt is the timestamp when the first team crossed the finish line.
	FirstFinishAt time.Time `json:"first_finish_at,omitempty"`
	// Deadline is the timestamp when the coin rush countdown expires.
	Deadline time.Time `json:"deadline,omitempty"`
	// Finishers lists teams in their finish order.
	Finishers []CoinRushFinisher `json:"finishers"`
}

// MarshalJSON customizes JSON encoding to omit zero-value timestamps.
func (c CoinRushState) MarshalJSON() ([]byte, error) {
	out := struct {
		FirstFinishAt *time.Time         `json:"first_finish_at,omitempty"`
		Deadline      *time.Time         `json:"deadline,omitempty"`
		Finishers     []CoinRushFinisher `json:"finishers"`
	}{
		Finishers: c.Finishers,
	}
	if out.Finishers == nil {
		out.Finishers = []CoinRushFinisher{}
	}
	if !c.FirstFinishAt.IsZero() {
		first := c.FirstFinishAt
		out.FirstFinishAt = &first
	}
	if !c.Deadline.IsZero() {
		deadline := c.Deadline
		out.Deadline = &deadline
	}
	return json.Marshal(out)
}

// Expired reports whether the coin rush countdown deadline has elapsed.
func (c CoinRushState) Expired(now time.Time) bool {
	return !c.Deadline.IsZero() && !now.Before(c.Deadline)
}

// GameStateProjection represents the current read-model state of a game.
type GameStateProjection struct {
	GameID string `json:"game_id"`
	// Mode specifies the game mode (e.g. team, solo time trial, solo casual, coin rush).
	Mode string `json:"mode"`
	// Status specifies the lifecycle status (draft, live, or ended).
	Status string `json:"status"`
	// Ruleset contains the game configuration parameters.
	Ruleset rules.Ruleset `json:"ruleset"`
	// Clock tracks solo run timing.
	Clock RunClock `json:"clock"`
	// CoinRush contains coin rush countdown state, if applicable.
	CoinRush       *CoinRushState                 `json:"coin_rush,omitempty"`
	Board          rules.Board                    `json:"board"`
	Teams          map[string]TeamInfo            `json:"teams"` // team_id -> name/slot
	// Log is the full race log; RedactFor turns it into a viewer-scoped PublicLog.
	Log []LogEntry `json:"-"`
	// PublicLog is filled only by RedactFor, so an unredacted projection carries no log.
	PublicLog      []string                       `json:"public_log"`
	LastSequence   int                            `json:"last_sequence"`
	Disputes       map[string]DisputeInfo         `json:"disputes"`
	Winner         string                         `json:"winner"`
	Positions      map[string]Position            `json:"positions"`
	WaypointStates map[string]rules.WaypointState `json:"waypoint_states"`
	RoadStates     map[string]rules.RoadState     `json:"road_states"`
	Progress       map[string]rules.TeamProgress  `json:"progress"`
	Coins          map[string]int                 `json:"coins"`
	Inventory      map[string][]string            `json:"inventory"` // team_id -> list of powerup names
	Effects        map[string][]rules.TeamEffect  `json:"effects"`
	Roadblocks     map[string]Roadblock           `json:"roadblocks"`
	Submissions    map[string]SubmissionInfo      `json:"submissions"`
	StandingsList  []StandingRow                  `json:"standings_list"`
}

// emptyProjection creates an initialized GameStateProjection with pre-allocated maps and default values.
func emptyProjection(gameID string) *GameStateProjection {
	return &GameStateProjection{
		GameID:         gameID,
		Mode:           rules.ModeTeam,
		Status:         "draft",
		Teams:          make(map[string]TeamInfo),
		Disputes:       make(map[string]DisputeInfo),
		Positions:      make(map[string]Position),
		WaypointStates: make(map[string]rules.WaypointState),
		RoadStates:     make(map[string]rules.RoadState),
		Progress:       make(map[string]rules.TeamProgress),
		Coins:          make(map[string]int),
		Inventory:      make(map[string][]string),
		Effects:        make(map[string][]rules.TeamEffect),
		Roadblocks:     make(map[string]Roadblock),
		Submissions:    make(map[string]SubmissionInfo),
	}
}

// startWaypointID returns the ID of the start waypoint, or an empty string if none is defined.
func (p *GameStateProjection) startWaypointID() string {
	for _, wp := range p.Board.Waypoints {
		if wp.IsStart {
			return wp.ID
		}
	}
	return ""
}

// boardHasChallengeAt reports whether the specified waypoint has an associated challenge.
func (p *GameStateProjection) boardHasChallengeAt(waypointID string) bool {
	for _, chal := range p.Board.Challenges {
		if chal.WaypointID == waypointID {
			return true
		}
	}
	return false
}
