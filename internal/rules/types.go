package rules

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strings"
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
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&aux); err != nil {
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

// MaxPowerupDurationSeconds bounds board-authored timers before they are used
// to construct runtime timestamps.
const MaxPowerupDurationSeconds = 365 * 24 * 60 * 60

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

	providedFields  map[string]struct{}
	decodedFromJSON bool
}

// UnmarshalJSON records which ruleset fields were supplied so normalization
// can distinguish an omitted value from an explicit false or zero.
func (rs *Ruleset) UnmarshalJSON(data []byte) error {
	type rulesetAlias Ruleset
	var decoded rulesetAlias
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return err
	}
	for field, value := range fields {
		if bytes.Equal(bytes.TrimSpace(value), []byte("null")) {
			return fmt.Errorf("ruleset field %q cannot be null", field)
		}
	}
	*rs = Ruleset(decoded)
	rs.providedFields = make(map[string]struct{}, len(fields))
	rs.decodedFromJSON = true
	for field := range fields {
		rs.providedFields[canonicalRulesetField(field)] = struct{}{}
	}
	return nil
}

func canonicalRulesetField(name string) string {
	loweredName := strings.ToLower(name)
	for _, tag := range []string{
		"coin_reward_min", "coin_reward_max", "veto_penalty_min_seconds", "veto_penalty_max_seconds",
		"powerup_costs", "reward_only_first_completer", "freeze_duration_seconds",
		"tracker_off_duration_seconds", "curse_duration_seconds", "veto_time_penalty_seconds",
		"coin_rush_finish_bonuses", "coin_rush_late_finish_bonus", "coin_rush_countdown_seconds", "verification",
	} {
		if loweredName == tag {
			return tag
		}
	}
	return loweredName
}

// HasNonVerificationSettings reports whether a JSON-decoded ruleset explicitly
// supplies any value other than the selectable verification mode.
func (rs Ruleset) HasNonVerificationSettings() bool {
	if rs.decodedFromJSON {
		for field := range rs.providedFields {
			if field != "verification" {
				return true
			}
		}
		return false
	}
	return rs.CoinRewardMin != 0 || rs.CoinRewardMax != 0 ||
		rs.VetoPenaltyMinSeconds != 0 || rs.VetoPenaltyMaxSeconds != 0 ||
		len(rs.PowerupCosts) > 0 || rs.RewardOnlyFirstCompleter ||
		rs.FreezeDurationSeconds != 0 || rs.TrackerOffDurationSeconds != 0 ||
		rs.CurseDurationSeconds != 0 || rs.VetoTimePenaltySeconds != 0 ||
		len(rs.CoinRushFinishBonuses) > 0 || rs.CoinRushLateFinishBonus != 0 ||
		rs.CoinRushCountdownSeconds != 0
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
