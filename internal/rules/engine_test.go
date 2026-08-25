package rules

import (
	"math"
	"testing"
	"time"
)

// TestCanTraverseTruthTable walks every combination of the four booleans a
// RoadGate carries. The predecessor of CanTraverse returned true for any
// road nobody had touched and false only when *another* team had bypassed it
// — a case that has nothing to do with the asking team — so the whole table is
// spelled out here rather than sampled.
func TestCanTraverseTruthTable(t *testing.T) {
	for _, tc := range []struct {
		gating     bool
		completed  bool
		bypassed   bool
		roadblock  bool
		wantAllow  bool
		wantReason string
	}{
		// No roadblock, no gating challenge: open road however the other flags fall.
		{false, false, false, false, true, TraversalAllowed},
		{false, false, true, false, true, TraversalAllowed},
		{false, true, false, false, true, TraversalAllowed},
		{false, true, true, false, true, TraversalAllowed},

		// No roadblock, gating challenge outstanding.
		{true, false, false, false, false, TraversalChallengeUnmet},
		{true, false, true, false, true, TraversalAllowed}, // this team vetoed or skipped it
		{true, true, false, false, true, TraversalAllowed}, // the field has unlocked it
		{true, true, true, false, true, TraversalAllowed},  // both

		// A roadblock outranks every other state.
		{false, false, false, true, false, TraversalRoadblocked},
		{false, false, true, true, false, TraversalRoadblocked},
		{false, true, false, true, false, TraversalRoadblocked},
		{false, true, true, true, false, TraversalRoadblocked},
		{true, false, false, true, false, TraversalRoadblocked},
		{true, false, true, true, false, TraversalRoadblocked},
		{true, true, false, true, false, TraversalRoadblocked},
		{true, true, true, true, false, TraversalRoadblocked},
	} {
		gate := RoadGate{
			HasGatingChallenge: tc.gating,
			CompletedByAnyone:  tc.completed,
			BypassedByTeam:     tc.bypassed,
			Roadblocked:        tc.roadblock,
		}
		got := CanTraverse(gate)
		if got.Allowed != tc.wantAllow || got.Reason != tc.wantReason {
			t.Errorf("CanTraverse(%+v) = {allowed:%t reason:%q}, want {allowed:%t reason:%q}",
				gate, got.Allowed, got.Reason, tc.wantAllow, tc.wantReason)
		}
		if got.Allowed && got.Message != "" {
			t.Errorf("CanTraverse(%+v) allowed but carried a message %q", gate, got.Message)
		}
		if !got.Allowed && got.Message == "" {
			t.Errorf("CanTraverse(%+v) refused without telling the player why", gate)
		}
	}
}

func TestRoadGateFor(t *testing.T) {
	road := RoadState{CompletedBy: "team1", Bypassed: map[string]bool{"team2": true}}

	gate := RoadGateFor(road, "team2", true)
	if !gate.HasGatingChallenge || !gate.CompletedByAnyone || !gate.BypassedByTeam {
		t.Errorf("expected all three challenge flags set for team2, got %+v", gate)
	}
	if gate.Roadblocked {
		t.Error("RoadGateFor must leave Roadblocked to the caller: roadblocks are not part of RoadState")
	}

	// A bypass belongs to the team that earned it and nobody else.
	if RoadGateFor(road, "team3", true).BypassedByTeam {
		t.Error("expected team2's bypass not to carry over to team3")
	}

	// A nil Bypassed map must not panic or read as bypassed.
	if RoadGateFor(RoadState{}, "team1", false).BypassedByTeam {
		t.Error("expected an untouched road not to read as bypassed")
	}
}

func TestIsWaypointCleared(t *testing.T) {
	for _, tc := range []struct {
		name  string
		state WaypointState
		want  bool
	}{
		{"untouched", WaypointState{}, false},
		{"cleared by evidence", WaypointState{ClearedBy: map[string]bool{"t1": true}}, true},
		{"bypassed by veto", WaypointState{Bypassed: map[string]bool{"t1": true}}, true},
		{"cleared by someone else", WaypointState{ClearedBy: map[string]bool{"t2": true}}, false},
		{"bypassed by someone else", WaypointState{Bypassed: map[string]bool{"t2": true}}, false},
	} {
		if got := IsWaypointCleared(tc.state, "t1"); got != tc.want {
			t.Errorf("%s: IsWaypointCleared = %t, want %t", tc.name, got, tc.want)
		}
	}
}

// The departure gate is not the per-team question: a challenge anyone has passed
// is not asked of the field twice, while a bypass stays personal to whoever
// spent it.
func TestIsWaypointOpen(t *testing.T) {
	for _, tc := range []struct {
		name  string
		state WaypointState
		want  bool
	}{
		{"untouched", WaypointState{}, false},
		{"cleared by evidence", WaypointState{ClearedBy: map[string]bool{"t1": true}}, true},
		{"cleared by someone else", WaypointState{ClearedBy: map[string]bool{"t2": true}}, true},
		{"cleared flag false", WaypointState{ClearedBy: map[string]bool{"t2": false}}, false},
		{"bypassed by veto", WaypointState{Bypassed: map[string]bool{"t1": true}}, true},
		{"bypassed by someone else", WaypointState{Bypassed: map[string]bool{"t2": true}}, false},
	} {
		if got := IsWaypointOpen(tc.state, "t1"); got != tc.want {
			t.Errorf("%s: IsWaypointOpen = %t, want %t", tc.name, got, tc.want)
		}
	}
}

func TestChallengeOutcome(t *testing.T) {
	rewardFirstOnly := DefaultRuleset()
	rewardEveryone := DefaultRuleset()
	rewardEveryone.RewardOnlyFirstCompleter = false

	for _, tc := range []struct {
		name       string
		rs         Ruleset
		passed     bool
		reward     int
		first      bool
		wantStatus string
		wantCoins  int
	}{
		{"fail pays nothing", rewardFirstOnly, false, 20, true, "fail", 0},
		{"first completer is paid", rewardFirstOnly, true, 20, true, "pass", 20},
		{"second completer is not, by default", rewardFirstOnly, true, 20, false, "pass", 0},
		{"second completer is paid when the ruleset says so", rewardEveryone, true, 20, false, "pass", 20},
		{"reward is raised to the floor", rewardFirstOnly, true, 1, true, "pass", 5},
		{"reward is capped at the ceiling", rewardFirstOnly, true, 999, true, "pass", 40},
		{"an unpaid challenge stays unpaid", rewardFirstOnly, true, 0, true, "pass", 0},
	} {
		status, coins := ChallengeOutcome(tc.rs, tc.passed, tc.reward, tc.first)
		if status != tc.wantStatus || coins != tc.wantCoins {
			t.Errorf("%s: got (%q, %d), want (%q, %d)", tc.name, status, coins, tc.wantStatus, tc.wantCoins)
		}
	}
}

func TestApplyVeto(t *testing.T) {
	now := time.Date(2026, 7, 27, 12, 0, 0, 0, time.UTC)
	bypassed, until := ApplyVeto(1800, now)
	if !bypassed {
		t.Error("expected a veto to bypass the challenge")
	}
	if want := now.Add(30 * time.Minute); !until.Equal(want) {
		t.Errorf("expected penalty until %v, got %v", want, until)
	}
}

func TestCanAfford(t *testing.T) {
	if !CanAfford(15, 10) {
		t.Error("expected 15 to afford 10")
	}
	if !CanAfford(10, 10) {
		t.Error("expected an exact balance to afford the cost")
	}
	if CanAfford(5, 10) {
		t.Error("expected 5 NOT to afford 10")
	}
}

func TestPowerupCostLookup(t *testing.T) {
	costs := map[string]int{"nerf": 10}
	if got := PowerupCost(costs, "nerf"); got != 10 {
		t.Errorf("expected 10, got %d", got)
	}
	if got := PowerupCost(costs, "unknown"); got != 0 {
		t.Errorf("expected 0 for an unpriced powerup, got %d", got)
	}
	if got := PowerupCost(nil, "nerf"); got != 0 {
		t.Errorf("expected 0 from a nil cost table, got %d", got)
	}
}

func TestTeamEffectPredicates(t *testing.T) {
	now := time.Date(2026, 7, 27, 12, 0, 0, 0, time.UTC)
	effects := []TeamEffect{
		{Kind: "freeze", Until: now.Add(10 * time.Minute)},
		{Kind: "tracker_off", Until: now.Add(20 * time.Minute)},
		{Kind: "curse", Until: now.Add(30 * time.Minute), Meta: "card-1"},
		{Kind: "veto_penalty", Until: now.Add(40 * time.Minute), Meta: "waypoint-1"},
	}

	for _, tc := range []struct {
		name string
		fn   func([]TeamEffect, time.Time) bool
		gone time.Duration
	}{
		{"freeze", IsFrozen, 10 * time.Minute},
		{"tracker_off", IsTrackerOff, 20 * time.Minute},
		{"curse", HasActiveCurse, 30 * time.Minute},
	} {
		if !tc.fn(effects, now) {
			t.Errorf("expected %s to be active at now", tc.name)
		}
		if tc.fn(effects, now.Add(tc.gone)) {
			t.Errorf("expected %s to have lapsed exactly at its Until", tc.name)
		}
		if tc.fn(nil, now) {
			t.Errorf("expected %s not to be active with no effects at all", tc.name)
		}
		if tc.fn([]TeamEffect{{Kind: "something_else", Until: now.Add(time.Hour)}}, now) {
			t.Errorf("expected %s not to be triggered by an unrelated effect", tc.name)
		}
	}
}

func TestHasReachedFinish(t *testing.T) {
	board := Board{
		Waypoints: []Waypoint{
			{ID: "w1", IsFinish: false},
			{ID: "w2", IsFinish: true},
		},
	}
	if !HasReachedFinish(board, "w2") {
		t.Error("expected w2 to be finish")
	}
	if HasReachedFinish(board, "w1") {
		t.Error("expected w1 NOT to be finish")
	}
	if HasReachedFinish(board, "nonexistent") {
		t.Error("expected an unknown waypoint NOT to be the finish")
	}
}

func TestShortestRemaining(t *testing.T) {
	board := Board{
		Waypoints: []Waypoint{
			{ID: "w1", Name: "Start", Lat: 0.0, Lon: 0.0, IsStart: true},
			{ID: "w2", Name: "Mid", Lat: 0.01, Lon: 0.01},
			{ID: "w3", Name: "Finish", Lat: 0.02, Lon: 0.02, IsFinish: true},
		},
		Roads: []Road{
			{ID: "s1", WaypointIDA: "w1", WaypointIDB: "w2", LengthM: 1000},
			{ID: "s2", WaypointIDA: "w2", WaypointIDB: "w3", LengthM: 1500},
		},
	}

	path, dist := ShortestRemaining(board, "w1")
	if len(path) != 2 || path[0] != "s1" || path[1] != "s2" {
		t.Errorf("expected path [s1, s2], got %v", path)
	}
	if dist != 2500 {
		t.Errorf("expected distance 2500, got %f", dist)
	}

	// On a circuit board the start *is* the finish, so a team standing on it has
	// the whole lap ahead of it rather than nothing. That is why ShortestRemaining
	// seeds from the neighbours instead of returning zero for currentWaypointID ==
	// finishID; computeStandings handles the genuinely-finished case by checking
	// TeamProgress.ReachedFinish before it ever asks.
	circuit := Board{
		Waypoints: []Waypoint{
			{ID: "c1", Lat: 0.00, Lon: 0.00, IsStart: true, IsFinish: true},
			{ID: "c2", Lat: 0.01, Lon: 0.00},
			{ID: "c3", Lat: 0.01, Lon: 0.01},
		},
		Roads: []Road{
			{ID: "e1", WaypointIDA: "c1", WaypointIDB: "c2", LengthM: 1000},
			{ID: "e2", WaypointIDA: "c2", WaypointIDB: "c3", LengthM: 1000},
			{ID: "e3", WaypointIDA: "c3", WaypointIDB: "c1", LengthM: 1000},
		},
	}
	if path, dist := ShortestRemaining(circuit, "c1"); len(path) == 0 || dist <= 0 {
		t.Errorf("expected a full lap remaining from the start of a circuit, got path %v distance %f", path, dist)
	}

	// A shortcut that costs less must win over the two-hop route.
	shortcut := board
	shortcut.Roads = append(append([]Road{}, board.Roads...),
		Road{ID: "s3", WaypointIDA: "w1", WaypointIDB: "w3", LengthM: 800})
	if path, dist := ShortestRemaining(shortcut, "w1"); len(path) != 1 || path[0] != "s3" || dist != 800 {
		t.Errorf("expected the shortcut [s3] at 800, got %v at %f", path, dist)
	}

	// Roads saved without a length fall back to the great-circle distance
	// between their endpoints rather than being treated as free.
	unlensed := board
	unlensed.Roads = []Road{
		{ID: "s1", WaypointIDA: "w1", WaypointIDB: "w2"},
		{ID: "s2", WaypointIDA: "w2", WaypointIDB: "w3"},
	}
	if _, dist := ShortestRemaining(unlensed, "w1"); dist <= 0 || dist > 10000 {
		t.Errorf("expected a haversine-derived distance in the low kilometres, got %f", dist)
	}

	// Unreachable finish.
	orphaned := board
	orphaned.Roads = nil
	if path, dist := ShortestRemaining(orphaned, "w1"); len(path) != 0 || dist < 1e17 {
		t.Errorf("expected empty path and infinite distance, got path %v distance %f", path, dist)
	}

	// A board with no finish at all is a board-design error, not a crash.
	noFinish := Board{Waypoints: []Waypoint{{ID: "w1", IsStart: true}}}
	if path, dist := ShortestRemaining(noFinish, "w1"); len(path) != 0 || dist != 0 {
		t.Errorf("expected no path and zero distance on a finishless board, got %v at %f", path, dist)
	}
}

func TestHaversine(t *testing.T) {
	if got := haversine(0, 0, 0, 0); got != 0 {
		t.Errorf("expected zero distance between identical points, got %f", got)
	}
	// One degree of latitude is ~111.2 km anywhere on the globe.
	got := haversine(51.0, 4.0, 52.0, 4.0)
	if math.Abs(got-111195) > 500 {
		t.Errorf("expected ~111195 m for one degree of latitude, got %f", got)
	}
	// Symmetry.
	if a, b := haversine(51.0, 4.0, 52.0, 5.0), haversine(52.0, 5.0, 51.0, 4.0); math.Abs(a-b) > 1e-6 {
		t.Errorf("expected haversine to be symmetric, got %f and %f", a, b)
	}
}

func TestDefaultRulesetAndPowerupsAgree(t *testing.T) {
	rs := DefaultRuleset()
	for _, pu := range DefaultPowerups() {
		cost, ok := rs.PowerupCost(pu.ID)
		if !ok {
			t.Errorf("powerup %q is in the catalog but has no price in the default ruleset", pu.ID)
			continue
		}
		if cost != pu.Cost {
			t.Errorf("powerup %q costs %d in the catalog but %d in the ruleset", pu.ID, pu.Cost, cost)
		}
		if pu.Effect == "" || pu.Name == "" {
			t.Errorf("powerup %q is missing a name or an engine effect", pu.ID)
		}
	}
	if len(rs.PowerupCosts) != len(DefaultPowerups()) {
		t.Errorf("ruleset prices %d powerups but the catalog has %d", len(rs.PowerupCosts), len(DefaultPowerups()))
	}
}

func TestNormalizeRuleset(t *testing.T) {
	def := DefaultRuleset()

	// The zero ruleset is what an old game's stored JSON unmarshals to.
	got := NormalizeRuleset(Ruleset{})
	if got.FreezeDurationSeconds != def.FreezeDurationSeconds ||
		got.TrackerOffDurationSeconds != def.TrackerOffDurationSeconds ||
		got.CurseDurationSeconds != def.CurseDurationSeconds ||
		got.CoinRewardMin != def.CoinRewardMin ||
		got.CoinRewardMax != def.CoinRewardMax ||
		got.VetoPenaltyMinSeconds != def.VetoPenaltyMinSeconds ||
		got.VetoPenaltyMaxSeconds != def.VetoPenaltyMaxSeconds {
		t.Errorf("expected an empty ruleset to normalize to the defaults, got %+v", got)
	}
	if len(got.PowerupCosts) != len(def.PowerupCosts) {
		t.Errorf("expected the default power-up prices, got %+v", got.PowerupCosts)
	}

	// Explicit values survive.
	custom := NormalizeRuleset(Ruleset{
		FreezeDurationSeconds: 60,
		CoinRewardMin:         1,
		CoinRewardMax:         2,
		PowerupCosts:          map[string]int{"nerf": 3},
	})
	if custom.FreezeDurationSeconds != 60 || custom.CoinRewardMin != 1 || custom.CoinRewardMax != 2 {
		t.Errorf("expected explicit values to survive normalization, got %+v", custom)
	}
	// Partial price tables merge over the defaults rather than replacing them,
	// so pricing one power-up does not make the rest unbuyable.
	if custom.PowerupCosts["nerf"] != 3 {
		t.Errorf("expected the custom nerf price, got %d", custom.PowerupCosts["nerf"])
	}
	if custom.PowerupCosts["curse"] != def.PowerupCosts["curse"] {
		t.Errorf("expected unpriced power-ups to keep their default cost, got %d", custom.PowerupCosts["curse"])
	}
	// A free power-up is a legitimate choice and must not be read as "unset".
	if free := NormalizeRuleset(Ruleset{PowerupCosts: map[string]int{"nerf": 0}}); free.PowerupCosts["nerf"] != 0 {
		t.Errorf("expected a zero price to be honoured, got %d", free.PowerupCosts["nerf"])
	}

	// Inverted bands are repaired rather than left to reject every value.
	swapped := NormalizeRuleset(Ruleset{
		CoinRewardMin: 40, CoinRewardMax: 5,
		VetoPenaltyMinSeconds: 900, VetoPenaltyMaxSeconds: 60,
	})
	if swapped.CoinRewardMin != 5 || swapped.CoinRewardMax != 40 {
		t.Errorf("expected the coin band to be reordered, got %d..%d", swapped.CoinRewardMin, swapped.CoinRewardMax)
	}
	if swapped.VetoPenaltyMinSeconds != 60 || swapped.VetoPenaltyMaxSeconds != 900 {
		t.Errorf("expected the veto band to be reordered, got %d..%d", swapped.VetoPenaltyMinSeconds, swapped.VetoPenaltyMaxSeconds)
	}

	// RewardOnlyFirstCompleter has no unset state, so false must survive.
	if NormalizeRuleset(Ruleset{RewardOnlyFirstCompleter: false}).RewardOnlyFirstCompleter {
		t.Error("expected RewardOnlyFirstCompleter=false to survive normalization")
	}
}

func TestRulesetClamps(t *testing.T) {
	rs := NormalizeRuleset(Ruleset{
		CoinRewardMin: 5, CoinRewardMax: 40,
		VetoPenaltyMinSeconds: 1800, VetoPenaltyMaxSeconds: 14400,
	})

	for _, tc := range []struct{ in, want int }{
		{-5, 0}, {0, 0}, {1, 5}, {5, 5}, {20, 20}, {40, 40}, {41, 40},
	} {
		if got := rs.ClampCoinReward(tc.in); got != tc.want {
			t.Errorf("ClampCoinReward(%d) = %d, want %d", tc.in, got, tc.want)
		}
	}

	// Unlike coins, a zero veto penalty is not a meaningful choice: a free veto
	// removes every reason to attempt a challenge.
	for _, tc := range []struct{ in, want int }{
		{0, 1800}, {1799, 1800}, {1800, 1800}, {3600, 3600}, {14400, 14400}, {99999, 14400},
	} {
		if got := rs.ClampVetoPenaltySeconds(tc.in); got != tc.want {
			t.Errorf("ClampVetoPenaltySeconds(%d) = %d, want %d", tc.in, got, tc.want)
		}
	}
}

func TestModeValidation(t *testing.T) {
	for _, mode := range []string{ModeTeam, ModeSoloTimeTrial, ModeSoloCasual} {
		if !IsValidMode(mode) {
			t.Errorf("expected %q to be a valid mode", mode)
		}
	}
	// An unrecognised mode is refused at creation rather than defaulted, so it
	// can never reach the rules that branch on it.
	for _, mode := range []string{"", "solo", "TEAM", "time_trial", "coop"} {
		if IsValidMode(mode) {
			t.Errorf("expected %q to be rejected as a mode", mode)
		}
	}

	if IsSoloMode(ModeTeam) {
		t.Error("a team race is not a solo mode")
	}
	if !IsSoloMode(ModeSoloTimeTrial) || !IsSoloMode(ModeSoloCasual) {
		t.Error("both solo modes must report as solo")
	}
}

func TestVetoCostFor(t *testing.T) {
	rs := NormalizeRuleset(Ruleset{
		VetoPenaltyMinSeconds:  1800,
		VetoPenaltyMaxSeconds:  14400,
		VetoTimePenaltySeconds: 900,
	})

	// A team race must be byte-identical to ClampVetoPenaltySeconds — this is the
	// behaviour that existed before modes did, and adding solo must not move it.
	for _, in := range []int{0, 1799, 1800, 3600, 14400, 99999} {
		got := rs.VetoCostFor(ModeTeam, in)
		want := VetoCost{CooldownSeconds: rs.ClampVetoPenaltySeconds(in)}
		if got != want {
			t.Errorf("VetoCostFor(team, %d) = %+v, want %+v", in, got, want)
		}
	}
	// An unrecognised mode falls through to team behaviour rather than handing
	// out a free veto.
	if got := rs.VetoCostFor("nonsense", 3600); got.CooldownSeconds != 3600 {
		t.Errorf("expected an unknown mode to price like a team race, got %+v", got)
	}

	// A time trial pays on the clock and never on a cooldown, whatever the board
	// asked for — the board's figure is a cooldown and there is nothing to cool.
	for _, in := range []int{0, 1800, 99999} {
		got := rs.VetoCostFor(ModeSoloTimeTrial, in)
		want := VetoCost{TimePenaltySeconds: 900}
		if got != want {
			t.Errorf("VetoCostFor(time trial, %d) = %+v, want %+v", in, got, want)
		}
	}

	// A casual walk pays nothing, which is the whole point of it.
	for _, in := range []int{0, 1800, 99999} {
		if got := rs.VetoCostFor(ModeSoloCasual, in); got != (VetoCost{}) {
			t.Errorf("VetoCostFor(casual, %d) = %+v, want a free veto", in, got)
		}
	}

	// A deliberate zero time penalty survives normalization, so a time trial with
	// free vetoes is expressible.
	free := NormalizeRuleset(Ruleset{VetoTimePenaltySeconds: 0})
	if got := free.VetoCostFor(ModeSoloTimeTrial, 3600); got != (VetoCost{}) {
		t.Errorf("expected a zero time penalty to be honoured, got %+v", got)
	}
	// A negative one is incoherent and falls back to the default.
	repaired := NormalizeRuleset(Ruleset{VetoTimePenaltySeconds: -1})
	if repaired.VetoTimePenaltySeconds != DefaultRuleset().VetoTimePenaltySeconds {
		t.Errorf("expected a negative time penalty to be repaired, got %d", repaired.VetoTimePenaltySeconds)
	}
}

func TestIsVetoLocked(t *testing.T) {
	now := time.Date(2026, 7, 30, 9, 0, 0, 0, time.UTC)

	// The waypoint the veto was spent on is recorded, but it is not what the gate
	// asks about: the lock is the team's, so any waypoint's cooldown closes every
	// challenge. A cooldown keyed to its own waypoint would be paid by nobody, since the
	// team has already walked past it and cannot come back.
	locked := []TeamEffect{{Kind: "veto_penalty", Until: now.Add(time.Minute), Meta: "waypoint-a"}}
	if !IsVetoLocked(locked, now) {
		t.Error("expected an active veto cooldown to lock the team out")
	}

	// Everything else a team can be carrying leaves challenges open.
	other := []TeamEffect{
		{Kind: "freeze", Until: now.Add(time.Hour)},
		{Kind: "tracker_off", Until: now.Add(time.Hour)},
		{Kind: "curse", Until: now.Add(time.Hour), Meta: "card-1"},
	}
	if IsVetoLocked(other, now) {
		t.Error("expected freezes, curses and a hidden tracker not to read as a veto cooldown")
	}

	// Effects expire by timestamp alone — nothing ever emits an expiry event —
	// so a lapsed row must not keep locking the team out.
	lapsed := []TeamEffect{{Kind: "veto_penalty", Until: now.Add(-time.Second), Meta: "waypoint-a"}}
	if IsVetoLocked(lapsed, now) {
		t.Error("expected a lapsed cooldown to stop locking")
	}

	// Vetoes accumulate rather than replace: a second one while the first still
	// runs must not be shadowed by the spent row sitting in front of it.
	stacked := append(lapsed, TeamEffect{Kind: "veto_penalty", Until: now.Add(time.Minute), Meta: "waypoint-b"})
	if !IsVetoLocked(stacked, now) {
		t.Error("expected a fresh cooldown behind a lapsed one to still lock")
	}

	if IsVetoLocked(nil, now) {
		t.Error("expected a team carrying nothing to be free to take on a challenge")
	}
}

func TestRunElapsed(t *testing.T) {
	start := time.Date(2026, 7, 30, 9, 0, 0, 0, time.UTC)

	if got := RunElapsed(start, start.Add(90*time.Minute), 0); got != 90*time.Minute {
		t.Errorf("expected a clean 90 minutes, got %v", got)
	}
	// Penalties are added to the wall clock, not substituted for it.
	if got := RunElapsed(start, start.Add(90*time.Minute), 900); got != 105*time.Minute {
		t.Errorf("expected 90m + 15m of penalties, got %v", got)
	}
	// A run that has not moved yet is zero, not negative.
	if got := RunElapsed(start, start, 0); got != 0 {
		t.Errorf("expected zero, got %v", got)
	}
	// Clock skew must not produce a negative time that would sort to the top of a
	// leaderboard. The penalties still stand.
	if got := RunElapsed(start, start.Add(-time.Hour), 900); got != 15*time.Minute {
		t.Errorf("expected skew to floor at the penalties, got %v", got)
	}
}

func TestSoloAllowsEffect(t *testing.T) {
	// Only effects that act on the runner's own progress are purchasable alone.
	for _, effect := range []string{"challenge_skip", "generic"} {
		if !SoloAllowsEffect(effect) {
			t.Errorf("expected %q to be usable in a solo run", effect)
		}
	}
	// These all need somebody to aim at, or somebody to hide from.
	for _, effect := range []string{"nerf", "roadblock", "curse", "tracker_off", ""} {
		if SoloAllowsEffect(effect) {
			t.Errorf("expected %q to be unusable in a solo run", effect)
		}
	}
}

func TestRulesetDurations(t *testing.T) {
	rs := Ruleset{FreezeDurationSeconds: 90, TrackerOffDurationSeconds: 120, CurseDurationSeconds: 150}
	if rs.FreezeDuration() != 90*time.Second {
		t.Errorf("got %v", rs.FreezeDuration())
	}
	if rs.TrackerOffDuration() != 120*time.Second {
		t.Errorf("got %v", rs.TrackerOffDuration())
	}
	if rs.CurseDuration() != 150*time.Second {
		t.Errorf("got %v", rs.CurseDuration())
	}
}
