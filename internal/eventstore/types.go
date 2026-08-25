package eventstore

import (
	"encoding/json"
	"fmt"
	"time"
)

// Event represents a serialized event envelope in the store.
type Event struct {
	GameID    string    `json:"game_id"`
	Sequence  int       `json:"sequence"`
	Type      string    `json:"event_type"`
	Payload   string    `json:"payload"` // JSON serialized payload string
	TraceID   string    `json:"trace_id"`
	CreatedAt time.Time `json:"created_at"`
}

// payloadPrototypes maps supported event types to functions returning their payload struct prototypes.
// Every accepted event type must be registered here to enforce schema validation on append.
var payloadPrototypes = map[string]func() interface{}{
	"GameCreated":             func() interface{} { return new(GameCreatedPayload) },
	"TeamJoined":              func() interface{} { return new(TeamJoinedPayload) },
	"GameStarted":             func() interface{} { return new(GameStartedPayload) },
	"ChallengeAttemptStarted": func() interface{} { return new(ChallengeAttemptStartedPayload) },
	"SubmissionCreated":       func() interface{} { return new(SubmissionCreatedPayload) },
	"VerdictReturned":         func() interface{} { return new(VerdictReturnedPayload) },
	"ChallengeCompleted":      func() interface{} { return new(ChallengeCompletedPayload) },
	"ChallengeVetoed":         func() interface{} { return new(ChallengeVetoedPayload) },
	"ChallengeConflictNoted":  func() interface{} { return new(ChallengeConflictNotedPayload) },
	"WaypointReached":         func() interface{} { return new(WaypointReachedPayload) },
	"TeamFinished":            func() interface{} { return new(TeamFinishedPayload) },
	"CoinsChanged":            func() interface{} { return new(CoinsChangedPayload) },
	"PowerupPurchased":        func() interface{} { return new(PowerupPurchasedPayload) },
	"PowerupUsed":             func() interface{} { return new(PowerupUsedPayload) },
	"CardDrawn":               func() interface{} { return new(CardDrawnPayload) },
	"RoadblockPlaced":         func() interface{} { return new(RoadblockPlacedPayload) },
	"RoadblockCleared":        func() interface{} { return new(RoadblockClearedPayload) },
	"ArrivalFlagged":          func() interface{} { return new(ArrivalFlaggedPayload) },
	"CurseApplied":            func() interface{} { return new(CurseAppliedPayload) },
	"CurseCleared":            func() interface{} { return new(CurseClearedPayload) },
	"TeamFrozen":              func() interface{} { return new(TeamFrozenPayload) },
	"TrackerToggled":          func() interface{} { return new(TrackerToggledPayload) },
	"EffectCleared":           func() interface{} { return new(EffectClearedPayload) },
	"DisputeRaised":           func() interface{} { return new(DisputeRaisedPayload) },
	"DisputeResolved":         func() interface{} { return new(DisputeResolvedPayload) },
	"GameEnded":               func() interface{} { return new(GameEndedPayload) },
	"TeamUpdated":             func() interface{} { return new(TeamUpdatedPayload) },
	"TeamDisbanded":           func() interface{} { return new(TeamDisbandedPayload) },
}

// KnownEventType reports whether an event type is registered in the event store.
func KnownEventType(eventType string) bool {
	_, ok := payloadPrototypes[eventType]
	return ok
}

// ValidateEvent checks that the event type is registered and its JSON payload matches the expected schema.
// Unknown JSON fields are ignored to preserve backward compatibility across build versions.
func ValidateEvent(e Event) error {
	if e.Type == "" {
		return fmt.Errorf("event has no type")
	}
	prototype, ok := payloadPrototypes[e.Type]
	if !ok {
		return fmt.Errorf("unknown event type %q", e.Type)
	}
	if e.Payload == "" {
		return fmt.Errorf("event %s has an empty payload", e.Type)
	}
	if err := json.Unmarshal([]byte(e.Payload), prototype()); err != nil {
		return fmt.Errorf("event %s payload does not match %sPayload: %w", e.Type, e.Type, err)
	}
	return nil
}

// GameCreatedPayload represents a game creation event.
type GameCreatedPayload struct {
	BoardID  string    `json:"board_id"`
	StartsAt time.Time `json:"starts_at"`
	EndsAt   time.Time `json:"ends_at"`
	// Mode identifies the game mode (e.g. team or solo) and determines replay rules.
	Mode string `json:"mode,omitempty"`
}

// TeamJoinedPayload represents a team joining a game.
type TeamJoinedPayload struct {
	TeamID    string `json:"team_id"`
	Name      string `json:"name"`
	SlotIndex int    `json:"slot_index"`
}

// GameStartedPayload represents a game start event.
type GameStartedPayload struct{}

// ChallengeAttemptStartedPayload represents the start of a challenge attempt.
type ChallengeAttemptStartedPayload struct {
	TeamID      string `json:"team_id"`
	WaypointID  string `json:"waypoint_id"`
	RoadID      string `json:"road_id,omitempty"`
	ChallengeID string `json:"challenge_id"`
	Prompt      string `json:"prompt"`
	Nonce       string `json:"nonce"`
}

// SubmissionCreatedPayload represents the creation of a submission.
type SubmissionCreatedPayload struct {
	SubmissionID   string `json:"submission_id"`
	TeamID         string `json:"team_id"`
	WaypointID     string `json:"waypoint_id"`
	RoadID         string `json:"road_id,omitempty"`
	ChallengeID    string `json:"challenge_id"`
	BlobRef        string `json:"blob_ref"`
	IdempotencyKey string `json:"idempotency_key"`
}

// VerdictReturnedPayload represents a verdict returned for a submission.
type VerdictReturnedPayload struct {
	SubmissionID string  `json:"submission_id"`
	Verdict      string  `json:"verdict"` // "pass" | "fail"
	Confidence   float64 `json:"confidence"`
	Rationale    string  `json:"rationale"`
	MetricValue  float64 `json:"metric_value,omitempty"`
	// Source specifies the grader identity (e.g. model, host, or trusted source).
	Source string `json:"source,omitempty"`
}

// ChallengeCompletedPayload represents the completion of a challenge.
type ChallengeCompletedPayload struct {
	WaypointID     string `json:"waypoint_id"`
	RoadID         string `json:"road_id,omitempty"`
	ChallengeID    string `json:"challenge_id"`
	TeamID         string `json:"team_id"`
	CoinReward     int    `json:"coin_reward"`
	FirstCompleter bool   `json:"first_completer"`
	Source         string `json:"source,omitempty"` // "gm" for host overrides, empty for gameplay
	Note           string `json:"note,omitempty"`   // host-supplied reason, shown in the public log
}

// ChallengeVetoedPayload represents a challenge veto event.
type ChallengeVetoedPayload struct {
	TeamID      string `json:"team_id"`
	WaypointID  string `json:"waypoint_id"`
	RoadID      string `json:"road_id,omitempty"`
	ChallengeID string `json:"challenge_id"`
	// PenaltyUntil is the timestamp until which the team is locked out from starting challenges.
	PenaltyUntil time.Time `json:"penalty_until"`
	// TimePenaltySeconds is the penalty added to time-trial runs, if applicable.
	TimePenaltySeconds int `json:"time_penalty_seconds,omitempty"`
}

// WaypointReachedPayload represents reaching a waypoint.
type WaypointReachedPayload struct {
	TeamID     string `json:"team_id"`
	WaypointID string `json:"waypoint_id"`
	IsFinish   bool   `json:"is_finish"`
}

// TeamFinishedPayload represents a team crossing the finish line in a coin rush game.
type TeamFinishedPayload struct {
	TeamID string `json:"team_id"`
	// Rank is the 1-based placing based on prior finishes in the event stream.
	Rank int `json:"rank"`
	// BonusCoins is the placement bonus awarded by the ruleset.
	BonusCoins int `json:"bonus_coins"`
}

// CoinsChangedPayload represents a change in a team's coin balance.
type CoinsChangedPayload struct {
	TeamID       string `json:"team_id"`
	Delta        int    `json:"delta"`
	Reason       string `json:"reason"`
	BalanceAfter int    `json:"balance_after"`
	Source       string `json:"source,omitempty"` // "gm" for host overrides, empty for gameplay
	Note         string `json:"note,omitempty"`   // host-supplied reason, shown in the public log
}

// PowerupPurchasedPayload represents a powerup purchase.
type PowerupPurchasedPayload struct {
	TeamID  string `json:"team_id"`
	Powerup string `json:"powerup"`
	Cost    int    `json:"cost"`
}

// PowerupUsedPayload represents a powerup usage.
type PowerupUsedPayload struct {
	TeamID       string    `json:"team_id"`
	Powerup      string    `json:"powerup"`
	TargetTeamID string    `json:"target_team_id,omitempty"`
	RoadID       string    `json:"road_id,omitempty"`
	EffectUntil  time.Time `json:"effect_until,omitempty"`
}

// CardDrawnPayload represents drawing a card.
type CardDrawnPayload struct {
	TeamID string `json:"team_id"`
	Deck   string `json:"deck"` // "roadblock" | "curse"
	CardID string `json:"card_id"`
	Text   string `json:"text"`
}

// RoadblockPlacedPayload represents placing a roadblock.
type RoadblockPlacedPayload struct {
	RoadID        string `json:"road_id"`
	PlacedBy      string `json:"placed_by"` // team_id
	CardID        string `json:"card_id"`
	ChallengeText string `json:"challenge_text"`
}

// RoadblockClearedPayload represents a team clearing a roadblock on a road.
type RoadblockClearedPayload struct {
	RoadID       string `json:"road_id"`
	TeamID       string `json:"team_id"`
	SubmissionID string `json:"submission_id,omitempty"`
}

// CurseAppliedPayload represents applying a curse to a team.
type CurseAppliedPayload struct {
	ByTeamID     string    `json:"by_team_id"`
	TargetTeamID string    `json:"target_team_id"`
	CardID       string    `json:"card_id"`
	Text         string    `json:"text"`
	Until        time.Time `json:"until,omitempty"`
}

// CurseClearedPayload represents clearing a curse from a team.
type CurseClearedPayload struct {
	TargetTeamID string `json:"target_team_id"`
	CardID       string `json:"card_id"`
	Reason       string `json:"reason"` // "resolved" | "expired"
}

// TeamFrozenPayload represents freezing a team.
type TeamFrozenPayload struct {
	TeamID string    `json:"team_id"`
	Until  time.Time `json:"until"`
	Source string    `json:"source"` // e.g. "nerf"
}

// TrackerToggledPayload represents toggling location tracking for a team.
type TrackerToggledPayload struct {
	TeamID   string    `json:"team_id"`
	Disabled bool      `json:"disabled"`
	Until    time.Time `json:"until,omitempty"`
}

// DisputeRaisedPayload represents raising a dispute on a verdict.
type DisputeRaisedPayload struct {
	VerdictID string `json:"verdict_id"`
	ByTeamID  string `json:"by_team_id"`
	Objection string `json:"objection"`
}

// DisputeResolvedPayload represents resolving a dispute.
type DisputeResolvedPayload struct {
	VerdictID string `json:"verdict_id"`
	Outcome   string `json:"outcome"` // "upheld" | "overturned"
	Source    string `json:"source"`  // "model" | "gm"
}

// GameEndedPayload represents ending a game.
type GameEndedPayload struct {
	WinnerTeamID   string             `json:"winner_team_id"`
	FinalStandings map[string]float64 `json:"final_standings,omitempty"`
}

// ChallengeConflictNotedPayload represents a challenge outcome conflict noted during processing.
type ChallengeConflictNotedPayload struct {
	RoadID  string `json:"road_id"`
	TeamID  string `json:"team_id"`
	Message string `json:"message"`
}

// ArrivalFlaggedPayload represents an arrival that flagged verification heuristics.
type ArrivalFlaggedPayload struct {
	TeamID     string  `json:"team_id"`
	WaypointID string  `json:"waypoint_id"`
	Reason     string  `json:"reason"`
	SpeedMS    float64 `json:"speed_ms,omitempty"`
	DistanceM  float64 `json:"distance_m,omitempty"`
	AccuracyM  float64 `json:"accuracy_m,omitempty"`
}

// EffectClearedPayload represents an administrative removal of an active effect from a team.
type EffectClearedPayload struct {
	TeamID     string `json:"team_id"`
	EffectType string `json:"effect_type"`
	Note       string `json:"note"`
}

// TeamUpdatedPayload represents a pre-race squad name or slot modification event.
type TeamUpdatedPayload struct {
	TeamID    string `json:"team_id"`
	Name      string `json:"name"`
	SlotIndex int    `json:"slot_index"`
}

// TeamDisbandedPayload represents a pre-race squad removal event.
type TeamDisbandedPayload struct {
	TeamID string `json:"team_id"`
}
