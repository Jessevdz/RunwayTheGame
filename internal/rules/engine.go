package rules

import (
	"math"
	"time"
)

// RoadGate represents the gating criteria and status for a road.
type RoadGate struct {
	// HasGatingChallenge reports whether this road requires completing a challenge.
	HasGatingChallenge bool
	// CompletedByAnyone reports whether any team has completed the gating challenge.
	CompletedByAnyone bool
	// BypassedByTeam reports whether the target team bypassed the challenge via veto or skip.
	BypassedByTeam bool
	// Roadblocked reports whether an active roadblock blocks the target team.
	Roadblocked bool
}

// Traversal status constants indicate reasons for allowing or denying road traversal.
const (
	TraversalAllowed        = ""
	TraversalRoadblocked    = "roadblock"
	TraversalChallengeUnmet = "gating_challenge"
)

// TraversalVerdict is the result of evaluating a RoadGate.
type TraversalVerdict struct {
	Allowed bool
	Reason  string // one of the Traversal* constants; empty when allowed
	Message string // player-facing explanation; empty when allowed
}

// CanTraverse evaluates whether a team may traverse a road based on its RoadGate status.
func CanTraverse(gate RoadGate) TraversalVerdict {
	if gate.Roadblocked {
		return TraversalVerdict{
			Reason:  TraversalRoadblocked,
			Message: "a roadblock stands on this road — clear it before you can pass",
		}
	}
	if !gate.HasGatingChallenge || gate.BypassedByTeam || gate.CompletedByAnyone {
		return TraversalVerdict{Allowed: true}
	}
	return TraversalVerdict{
		Reason:  TraversalChallengeUnmet,
		Message: "this road's challenge has not been completed or bypassed",
	}
}

// RoadGateFor derives a RoadGate from projected road state for a specific team.
func RoadGateFor(road RoadState, teamID string, hasGatingChallenge bool) RoadGate {
	return RoadGate{
		HasGatingChallenge: hasGatingChallenge,
		CompletedByAnyone:  road.CompletedBy != "",
		BypassedByTeam:     road.Bypassed[teamID],
	}
}

// IsWaypointOpen reports whether a waypoint is open for a team to depart.
func IsWaypointOpen(waypointState WaypointState, teamID string) bool {
	for _, cleared := range waypointState.ClearedBy {
		if cleared {
			return true
		}
	}
	return waypointState.Bypassed[teamID]
}

// IsWaypointCleared reports whether a team has completed or bypassed a waypoint.
func IsWaypointCleared(waypointState WaypointState, teamID string) bool {
	if waypointState.ClearedBy != nil && waypointState.ClearedBy[teamID] {
		return true
	}
	if waypointState.Bypassed != nil && waypointState.Bypassed[teamID] {
		return true
	}
	return false
}

// ChallengeOutcome evaluates challenge results and calculates coin rewards under a ruleset.
func ChallengeOutcome(rs Ruleset, passed bool, coinReward int, firstCompleter bool) (string, int) {
	if !passed {
		return "fail", 0
	}
	if !firstCompleter && rs.RewardOnlyFirstCompleter {
		return "pass", 0
	}
	return "pass", rs.ClampCoinReward(coinReward)
}

// ApplyVeto returns the bypass state and penalty duration.
func ApplyVeto(vetoPenaltySeconds int, now time.Time) (bool, time.Time) {
	return true, now.Add(time.Duration(vetoPenaltySeconds) * time.Second)
}

// ShortestRemaining returns the remaining roads on the shortest path to the finish.
func ShortestRemaining(board Board, currentWaypointID string) ([]string, float64) {
	// 1. Locate the finish waypoint.
	var finishID string
	for _, wp := range board.Waypoints {
		if wp.IsFinish {
			finishID = wp.ID
			break
		}
	}
	if finishID == "" {
		return nil, 0.0
	}

	// 2. Build adjacency graph.
	type neighbor struct {
		toWaypointID string
		roadID       string
		weight       float64
	}
	adj := make(map[string][]neighbor)

	// Map to look up waypoint coordinates for fallback haversine distance
	wpCoords := make(map[string]struct{ lat, lon float64 })
	for _, wp := range board.Waypoints {
		wpCoords[wp.ID] = struct{ lat, lon float64 }{wp.Lat, wp.Lon}
	}

	for _, road := range board.Roads {
		w := road.LengthM
		if w <= 0 {
			// fallback to haversine distance
			coordA, okA := wpCoords[road.WaypointIDA]
			coordB, okB := wpCoords[road.WaypointIDB]
			if okA && okB {
				w = haversine(coordA.lat, coordA.lon, coordB.lat, coordB.lon)
			}
		}
		if w <= 0 {
			w = 1.0 // fallback weight
		}

		adj[road.WaypointIDA] = append(adj[road.WaypointIDA], neighbor{
			toWaypointID: road.WaypointIDB,
			roadID:       road.ID,
			weight:       w,
		})
		adj[road.WaypointIDB] = append(adj[road.WaypointIDB], neighbor{
			toWaypointID: road.WaypointIDA,
			roadID:       road.ID,
			weight:       w,
		})
	}

	// Dijkstra
	dist := make(map[string]float64)
	prevWaypoint := make(map[string]string)
	prevRoad := make(map[string]string)

	for _, wp := range board.Waypoints {
		dist[wp.ID] = 1e18 // infinity
	}

	visited := make(map[string]bool)

	if currentWaypointID == finishID {
		// When current position is the finish waypoint (e.g. at start of circuit), seed adjacent neighbors to find the loop path
		for _, road := range adj[currentWaypointID] {
			if road.toWaypointID != currentWaypointID {
				if road.weight < dist[road.toWaypointID] {
					dist[road.toWaypointID] = road.weight
					prevWaypoint[road.toWaypointID] = currentWaypointID
					prevRoad[road.toWaypointID] = road.roadID
				}
			}
		}
		visited[currentWaypointID] = true
	} else {
		dist[currentWaypointID] = 0.0
	}

	for i := 0; i < len(board.Waypoints); i++ {
		var u string
		minD := 1e18
		for _, wp := range board.Waypoints {
			if !visited[wp.ID] && dist[wp.ID] < minD {
				minD = dist[wp.ID]
				u = wp.ID
			}
		}

		if u == "" {
			break
		}
		visited[u] = true

		if u == finishID && currentWaypointID != finishID {
			break
		}

		for _, road := range adj[u] {
			if visited[road.toWaypointID] && (road.toWaypointID != finishID || u == currentWaypointID) {
				continue
			}
			newDist := dist[u] + road.weight
			if newDist < dist[road.toWaypointID] {
				dist[road.toWaypointID] = newDist
				prevWaypoint[road.toWaypointID] = u
				prevRoad[road.toWaypointID] = road.roadID
			}
		}
	}

	if dist[finishID] >= 1e17 {
		// unreachable
		return nil, 1e18
	}

	// Reconstruct path of road IDs
	var path []string
	curr := finishID
	for {
		pWaypoint, ok := prevWaypoint[curr]
		if !ok {
			break
		}
		path = append([]string{prevRoad[curr]}, path...)
		curr = pWaypoint
		if curr == currentWaypointID {
			break
		}
	}

	return path, dist[finishID]
}

func haversine(lat1, lon1, lat2, lon2 float64) float64 {
	const R = 6371000 // meters
	rad := math.Pi / 180.0
	dLat := (lat2 - lat1) * rad
	dLon := (lon2 - lon1) * rad
	a := math.Sin(dLat/2)*math.Sin(dLat/2) + math.Cos(lat1*rad)*math.Cos(lat2*rad)*math.Sin(dLon/2)*math.Sin(dLon/2)
	c := 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
	return R * c
}

// PowerupCost returns the cost of a power-up.
func PowerupCost(costs map[string]int, powerup string) int {
	if costs == nil {
		return 0
	}
	return costs[powerup]
}

// CanAfford returns true if the balance is sufficient for the cost.
func CanAfford(balance, cost int) bool {
	return balance >= cost
}

// IsFrozen returns true if the freeze effect is active.
func IsFrozen(effects []TeamEffect, now time.Time) bool {
	for _, e := range effects {
		if e.Kind == "freeze" && now.Before(e.Until) {
			return true
		}
	}
	return false
}

// IsVetoLocked reports whether a team is currently under a veto penalty cooldown.
func IsVetoLocked(effects []TeamEffect, now time.Time) bool {
	for _, e := range effects {
		if e.Kind == "veto_penalty" && now.Before(e.Until) {
			return true
		}
	}
	return false
}

// IsTrackerOff returns true if the tracker off effect is active.
func IsTrackerOff(effects []TeamEffect, now time.Time) bool {
	for _, e := range effects {
		if e.Kind == "tracker_off" && now.Before(e.Until) {
			return true
		}
	}
	return false
}

// HasActiveCurse returns true if the team has any active curses.
func HasActiveCurse(effects []TeamEffect, now time.Time) bool {
	for _, e := range effects {
		if e.Kind == "curse" && now.Before(e.Until) {
			return true
		}
	}
	return false
}

// HasReachedFinish returns true if the team has reached the finish waypoint.
func HasReachedFinish(board Board, currentWaypointID string) bool {
	for _, wp := range board.Waypoints {
		if wp.ID == currentWaypointID && wp.IsFinish {
			return true
		}
	}
	return false
}

// Game mode constants define supported game execution modes.
const (
	// ModeTeam is multi-team competitive race mode.
	ModeTeam = "team"
	// ModeSoloTimeTrial is single-player timed race mode.
	ModeSoloTimeTrial = "solo_time_trial"
	// ModeSoloCasual is single-player unranked casual mode.
	ModeSoloCasual = "solo_casual"
	// ModeCoinRush is multi-team coin accumulation race mode.
	ModeCoinRush = "coin_rush"
)

// IsValidMode reports whether a string represents a supported game mode.
func IsValidMode(mode string) bool {
	switch mode {
	case ModeTeam, ModeSoloTimeTrial, ModeSoloCasual, ModeCoinRush:
		return true
	}
	return false
}

// IsSoloMode reports whether a mode is raced alone.
func IsSoloMode(mode string) bool {
	return mode == ModeSoloTimeTrial || mode == ModeSoloCasual
}

// Photo verification constants define evidence grading strategies.
const (
	// VerificationLLM uses automated multimodal model verification.
	VerificationLLM = "llm"
	// VerificationHost requires manual host review.
	VerificationHost = "host"
	// VerificationTrust accepts submissions passing GPS heuristics.
	VerificationTrust = "trust"
)

// IsValidVerification reports whether a string represents a supported verification mode.
func IsValidVerification(v string) bool {
	switch v {
	case VerificationLLM, VerificationHost, VerificationTrust:
		return true
	}
	return false
}

// VerificationNeedsHost reports whether a verification mode requires manual host grading.
func VerificationNeedsHost(v string) bool {
	return v == VerificationHost
}

// VerificationAllowedInMode reports whether a grading mode can be used by a game mode.
func VerificationAllowedInMode(verification, mode string) bool {
	if !IsValidVerification(verification) {
		return false
	}
	if VerificationNeedsHost(verification) && IsSoloMode(mode) {
		return false
	}
	if mode == ModeSoloCasual && verification != VerificationTrust {
		return false
	}
	return true
}

// VetoCost defines the cooldown and time penalty associated with a challenge veto.
type VetoCost struct {
	// CooldownSeconds is the duration of the veto penalty cooldown.
	CooldownSeconds int
	// TimePenaltySeconds is the penalty added to a time-trial run's clock.
	TimePenaltySeconds int
}

// VetoCostFor calculates the veto cost structure for a given game mode.
func (rs Ruleset) VetoCostFor(mode string, challengeVetoSeconds int) VetoCost {
	switch mode {
	case ModeSoloTimeTrial:
		return VetoCost{TimePenaltySeconds: rs.VetoTimePenaltySeconds}
	case ModeSoloCasual:
		return VetoCost{}
	default:
		return VetoCost{CooldownSeconds: rs.ClampVetoPenaltySeconds(challengeVetoSeconds)}
	}
}

// RunElapsed calculates the total elapsed duration of a run including penalty additions.
func RunElapsed(startedAt, finishedAt time.Time, penaltySeconds int) time.Duration {
	elapsed := finishedAt.Sub(startedAt)
	if elapsed < 0 {
		elapsed = 0
	}
	if penaltySeconds > 0 {
		elapsed += time.Duration(penaltySeconds) * time.Second
	}
	return elapsed
}

// SoloAllowsEffect reports whether a powerup effect is active in solo game modes.
func SoloAllowsEffect(effect string) bool {
	switch effect {
	case "challenge_skip", "generic":
		return true
	}
	return false
}

// CoinRushScore represents a team's coin balance and finish rank in coin rush mode.
type CoinRushScore struct {
	TeamID string
	Coins  int
	// FinishRank is the 1-based placement rank (0 if un-finished).
	FinishRank int
}

// CoinRushLess compares two coin rush scores, ordering higher coin balances and earlier finishes first.
func CoinRushLess(a, b CoinRushScore) bool {
	if a.Coins != b.Coins {
		return a.Coins > b.Coins
	}
	ar, br := a.FinishRank, b.FinishRank
	if ar == 0 {
		ar = math.MaxInt
	}
	if br == 0 {
		br = math.MaxInt
	}
	if ar != br {
		return ar < br
	}
	return a.TeamID < b.TeamID
}

// CoinRushWinner returns the winning team ID from a set of coin rush scores.
func CoinRushWinner(scores []CoinRushScore) string {
	winner := CoinRushScore{}
	found := false
	for _, s := range scores {
		if !found || CoinRushLess(s, winner) {
			winner = s
			found = true
		}
	}
	if !found {
		return ""
	}
	return winner.TeamID
}

// DefaultRuleset returns default configuration values for a new ruleset.
func DefaultRuleset() Ruleset {
	return Ruleset{
		CoinRewardMin:         5,
		CoinRewardMax:         40,
		VetoPenaltyMinSeconds: 900,
		VetoPenaltyMaxSeconds: 14400,
		PowerupCosts: map[string]int{
			"nerf":           10,
			"tracker_off":    25,
			"challenge_skip": 100,
		},
		RewardOnlyFirstCompleter:  true,
		FreezeDurationSeconds:     1800,
		TrackerOffDurationSeconds: 2700,
		CurseDurationSeconds:      86400,
		VetoTimePenaltySeconds:    900,
		CoinRushFinishBonuses:     []int{150, 100, 60, 30},
		CoinRushLateFinishBonus:   15,
		CoinRushCountdownSeconds:  1800,
		Verification:              VerificationLLM,
	}
}

// NormalizeRuleset populates unset fields in a ruleset with default values.
func NormalizeRuleset(rs Ruleset) Ruleset {
	def := DefaultRuleset()

	if rs.CoinRewardMin <= 0 {
		rs.CoinRewardMin = def.CoinRewardMin
	}
	if rs.CoinRewardMax <= 0 {
		rs.CoinRewardMax = def.CoinRewardMax
	}
	if rs.CoinRewardMax < rs.CoinRewardMin {
		rs.CoinRewardMin, rs.CoinRewardMax = rs.CoinRewardMax, rs.CoinRewardMin
	}

	if rs.VetoPenaltyMinSeconds <= 0 {
		rs.VetoPenaltyMinSeconds = def.VetoPenaltyMinSeconds
	}
	if rs.VetoPenaltyMaxSeconds <= 0 {
		rs.VetoPenaltyMaxSeconds = def.VetoPenaltyMaxSeconds
	}
	if rs.VetoPenaltyMaxSeconds < rs.VetoPenaltyMinSeconds {
		rs.VetoPenaltyMinSeconds, rs.VetoPenaltyMaxSeconds = rs.VetoPenaltyMaxSeconds, rs.VetoPenaltyMinSeconds
	}

	if rs.FreezeDurationSeconds <= 0 {
		rs.FreezeDurationSeconds = def.FreezeDurationSeconds
	}
	if rs.TrackerOffDurationSeconds <= 0 {
		rs.TrackerOffDurationSeconds = def.TrackerOffDurationSeconds
	}
	if rs.CurseDurationSeconds <= 0 {
		rs.CurseDurationSeconds = def.CurseDurationSeconds
	}
	if rs.VetoTimePenaltySeconds < 0 {
		rs.VetoTimePenaltySeconds = def.VetoTimePenaltySeconds
	}

	if len(rs.CoinRushFinishBonuses) == 0 {
		rs.CoinRushFinishBonuses = def.CoinRushFinishBonuses
	}
	for i, bonus := range rs.CoinRushFinishBonuses {
		if bonus < 0 {
			rs.CoinRushFinishBonuses[i] = 0
		}
	}
	if rs.CoinRushLateFinishBonus < 0 {
		rs.CoinRushLateFinishBonus = 0
	}
	if rs.CoinRushCountdownSeconds <= 0 {
		rs.CoinRushCountdownSeconds = def.CoinRushCountdownSeconds
	}

	switch {
	case rs.Verification == "":
		rs.Verification = def.Verification
	case !IsValidVerification(rs.Verification):
		rs.Verification = VerificationHost
	}

	merged := make(map[string]int, len(def.PowerupCosts)+len(rs.PowerupCosts))
	for id, cost := range def.PowerupCosts {
		merged[id] = cost
	}
	for id, cost := range rs.PowerupCosts {
		if cost >= 0 {
			merged[id] = cost
		}
	}
	rs.PowerupCosts = merged

	return rs
}

// PowerupCost returns a power-up's price under this ruleset.
func (rs Ruleset) PowerupCost(powerup string) (int, bool) {
	cost, ok := rs.PowerupCosts[powerup]
	return cost, ok
}

// ClampCoinReward clamps a coin reward amount to configured ruleset boundaries.
func (rs Ruleset) ClampCoinReward(reward int) int {
	if reward <= 0 {
		return 0
	}
	if reward < rs.CoinRewardMin {
		return rs.CoinRewardMin
	}
	if reward > rs.CoinRewardMax {
		return rs.CoinRewardMax
	}
	return reward
}

// ClampVetoPenaltySeconds clamps a veto penalty duration in seconds to ruleset limits.
func (rs Ruleset) ClampVetoPenaltySeconds(seconds int) int {
	if seconds < rs.VetoPenaltyMinSeconds {
		return rs.VetoPenaltyMinSeconds
	}
	if seconds > rs.VetoPenaltyMaxSeconds {
		return rs.VetoPenaltyMaxSeconds
	}
	return seconds
}

// FreezeDuration is how long a nerf holds a team in place.
func (rs Ruleset) FreezeDuration() time.Duration {
	return time.Duration(rs.FreezeDurationSeconds) * time.Second
}

// TrackerOffDuration is how long a team stays off the map.
func (rs Ruleset) TrackerOffDuration() time.Duration {
	return time.Duration(rs.TrackerOffDurationSeconds) * time.Second
}

// CoinRushFinishBonus returns the placement bonus coins for a given rank.
func (rs Ruleset) CoinRushFinishBonus(rank int) int {
	if rank <= 0 {
		return 0
	}
	if rank <= len(rs.CoinRushFinishBonuses) {
		return rs.CoinRushFinishBonuses[rank-1]
	}
	return rs.CoinRushLateFinishBonus
}

// CoinRushCountdown is how long the field has left once the first team is home.
func (rs Ruleset) CoinRushCountdown() time.Duration {
	return time.Duration(rs.CoinRushCountdownSeconds) * time.Second
}

// CurseDuration returns the duration of a curse effect.
func (rs Ruleset) CurseDuration() time.Duration {
	return time.Duration(rs.CurseDurationSeconds) * time.Second
}

// DefaultPowerups returns the default catalog of built-in powerups.
func DefaultPowerups() []Powerup {
	return []Powerup{
		{ID: "nerf", Icon: "", Name: "Nerf Dart", Description: "Freeze the opponent team, halting their progress.", Cost: 10, DurationS: 1800, Effect: "nerf"},
		{ID: "tracker_off", Icon: "", Name: "Tracker Off", Description: "Hide your map position dot from opponents.", Cost: 25, DurationS: 2700, Effect: "tracker_off"},
		{ID: "challenge_skip", Icon: "", Name: "Challenge Skip", Description: "Bypass your current blocking challenge immediately without penalty.", Cost: 100, DurationS: 0, Effect: "challenge_skip"},
	}
}
