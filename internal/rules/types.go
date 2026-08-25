package rules

import (
	"encoding/json"
	"time"
)

// Waypoint represents a waypoint on the board.
type Waypoint struct {
	ID             string  `json:"id"`
	Name           string  `json:"name"`
	Lat            float64 `json:"lat"`
	Lon            float64 `json:"lon"`
	ArrivalRadiusM float64 `json:"arrival_radius_m"`
	IsStart        bool    `json:"is_start"`
	IsFinish       bool    `json:"is_finish"`
	ChallengeID    string  `json:"challenge_id,omitempty"`
}

// Road represents a route connecting two waypoints.
type Road struct {
	ID          string  `json:"id"`
	WaypointIDA string  `json:"waypoint_id_a"`
	WaypointIDB string  `json:"waypoint_id_b"`
	LengthM     float64 `json:"length_m,omitempty"`
	// ChallengeID is the optional gating challenge on this road segment; empty indicates an open road.
	ChallengeID string `json:"challenge_id,omitempty"`
}

func (s *Road) UnmarshalJSON(data []byte) error {
	type Alias Road
	aux := &struct {
		WaypointA string `json:"waypoint_a"`
		WaypointB string `json:"waypoint_b"`
		*Alias
	}{
		Alias: (*Alias)(s),
	}
	if err := json.Unmarshal(data, &aux); err != nil {
		return err
	}
	if s.WaypointIDA == "" && aux.WaypointA != "" {
		s.WaypointIDA = aux.WaypointA
	}
	if s.WaypointIDB == "" && aux.WaypointB != "" {
		s.WaypointIDB = aux.WaypointB
	}
	return nil
}

// Card represents a roadblock or curse card.
type Card struct {
	ID   string `json:"id"`
	Text string `json:"text"`
}

// Powerup represents a powerup definition and its associated engine effect binding.
type Powerup struct {
	ID          string `json:"id"`
	Icon        string `json:"icon"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Cost        int    `json:"cost"`
	DurationS   int    `json:"duration_s"`
	Effect      string `json:"effect"`
}

// Ruleset defines game timing, powerup costs, and operational configurations.
type Ruleset struct {
	CoinRewardMin             int            `json:"coin_reward_min"`
	CoinRewardMax             int            `json:"coin_reward_max"`
	VetoPenaltyMinSeconds     int            `json:"veto_penalty_min_seconds"`
	VetoPenaltyMaxSeconds     int            `json:"veto_penalty_max_seconds"`
	PowerupCosts              map[string]int `json:"powerup_costs"`
	RewardOnlyFirstCompleter  bool           `json:"reward_only_first_completer"`
	FreezeDurationSeconds     int            `json:"freeze_duration_seconds"`
	TrackerOffDurationSeconds int            `json:"tracker_off_duration_seconds"`
	CurseDurationSeconds      int            `json:"curse_duration_seconds"`
	// VetoTimePenaltySeconds is the time penalty added to a solo time-trial run when a challenge is vetoed.
	VetoTimePenaltySeconds int `json:"veto_time_penalty_seconds"`

	// CoinRushFinishBonuses specifies placement bonus coins for coin rush finishers, ordered by rank.
	CoinRushFinishBonuses []int `json:"coin_rush_finish_bonuses"`
	// CoinRushLateFinishBonus is the placement bonus awarded after the finish bonus list is exhausted.
	CoinRushLateFinishBonus int `json:"coin_rush_late_finish_bonus"`
	// CoinRushCountdownSeconds is the countdown duration after the first team finishes in a coin rush.
	CoinRushCountdownSeconds int `json:"coin_rush_countdown_seconds"`
	// Verification specifies the photo evidence grading mode.
	Verification string `json:"verification"`
}

// Board represents a published, immutable map configuration.
type Board struct {
	ID            string         `json:"id"`
	Version       int            `json:"version"`
	Name          string         `json:"name"`
	Waypoints     []Waypoint     `json:"waypoints"`
	Roads         []Road         `json:"roads"`
	Challenges    []Challenge    `json:"challenges"`
	RoadblockDeck []Card         `json:"roadblock_deck"`
	CurseDeck     []Card         `json:"curse_deck"`
	PowerupCosts  map[string]int `json:"powerup_costs"`
	Powerups      []Powerup      `json:"powerups"`
}

// Challenge represents a waypoint challenge configuration.
type Challenge struct {
	ID                 string       `json:"id"`
	WaypointID         string       `json:"waypoint_id,omitempty"`
	Prompt             string       `json:"prompt"`
	Rubric             RubricDetail `json:"rubric"`
	CoinReward         int          `json:"coin_reward"`
	VetoPenaltySeconds int          `json:"veto_penalty_seconds"`
}

// RubricDetail defines the validation rules for a photo submission.
type RubricDetail struct {
	MustShow            []string `json:"must_show"`
	FailsIf             []string `json:"fails_if"`
	AcceptableAmbiguity string   `json:"acceptable_ambiguity"`
}

// WaypointState represents the runtime clearance state of a waypoint/waypoint.
type WaypointState struct {
	ClearedBy map[string]bool `json:"cleared_by"` // teamID -> true (via approved photo evidence)
	Bypassed  map[string]bool `json:"bypassed"`   // teamID -> true (via veto or skip)
}

// RoadState represents the runtime state of a road.
type RoadState struct {
	CompletedBy string          `json:"completed_by"` // teamID or empty
	Bypassed    map[string]bool `json:"bypassed"`     // teamID -> true (via veto or skip)
}

// TeamProgress represents a team's progress.
type TeamProgress struct {
	CurrentWaypointID string   `json:"current_waypoint_id"`
	TraversedRoads    []string `json:"traversed_roads"`
	ClearedWaypoints  []string `json:"cleared_waypoints"`
	ReachedFinish     bool     `json:"reached_finish"`
}

// TeamEffect represents an active effect.
type TeamEffect struct {
	Kind  string    `json:"kind"` // "freeze", "tracker_off", "veto_penalty", "curse"
	Until time.Time `json:"until"`
	Meta  string    `json:"meta,omitempty"` // curse card ID, etc.
}
