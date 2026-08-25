package rules

import (
	"math/rand"
	"testing"
	"time"
)

func TestCoinRushModeIsATeamMode(t *testing.T) {
	if !IsValidMode(ModeCoinRush) {
		t.Error("expected coin_rush to be a mode the engine accepts")
	}
	// The distinction matters at every call site that asks "is anyone else out
	// there": a coin rush is a field of rivals, and every power-up aimed at one
	// has something to hit.
	if IsSoloMode(ModeCoinRush) {
		t.Error("expected coin_rush not to be a solo mode")
	}
	// A cooldown is what stops a team walking away from a coin-bearing waypoint and
	// coming straight back at it, which is exactly as true here as in a team race.
	rs := NormalizeRuleset(Ruleset{})
	cost := rs.VetoCostFor(ModeCoinRush, 3600)
	if cost.CooldownSeconds != 3600 {
		t.Errorf("expected a coin rush veto to charge the board's cooldown, got %d", cost.CooldownSeconds)
	}
	if cost.TimePenaltySeconds != 0 {
		t.Errorf("expected no clock penalty in a mode with no clock, got %d", cost.TimePenaltySeconds)
	}
}

func TestCoinRushFinishBonusLadder(t *testing.T) {
	rs := Ruleset{CoinRushFinishBonuses: []int{150, 100, 60, 30}, CoinRushLateFinishBonus: 15}

	for rank, want := range map[int]int{1: 150, 2: 100, 3: 60, 4: 30} {
		if got := rs.CoinRushFinishBonus(rank); got != want {
			t.Errorf("rank %d: expected %d, got %d", rank, want, got)
		}
	}
	// Past the end of the ladder every finish is worth the same. A board should
	// not have to know how many teams will turn up.
	for _, rank := range []int{5, 6, 40} {
		if got := rs.CoinRushFinishBonus(rank); got != 15 {
			t.Errorf("rank %d: expected the late-finish bonus, got %d", rank, got)
		}
	}
	// Rank zero is what a score carries for a team that never crossed. It must
	// not be handed first place's purse by an off-by-one somewhere upstream.
	for _, rank := range []int{0, -1} {
		if got := rs.CoinRushFinishBonus(rank); got != 0 {
			t.Errorf("rank %d: expected nothing, got %d", rank, got)
		}
	}

	// An empty ladder is coherent only after normalization has refused it; asked
	// directly, every placing falls through to the late bonus.
	empty := Ruleset{CoinRushLateFinishBonus: 7}
	if got := empty.CoinRushFinishBonus(1); got != 7 {
		t.Errorf("expected an empty ladder to pay the late bonus, got %d", got)
	}
}

func TestNormalizeRulesetFillsCoinRushFields(t *testing.T) {
	def := DefaultRuleset()

	// The case that actually happens: a games row written before these fields
	// existed unmarshals as all-zero. An empty ladder would make the finish line
	// worthless and a zero countdown would end the race the instant anybody
	// crossed — neither is something a host could have meant.
	old := NormalizeRuleset(Ruleset{})
	if len(old.CoinRushFinishBonuses) != len(def.CoinRushFinishBonuses) {
		t.Errorf("expected the default ladder, got %v", old.CoinRushFinishBonuses)
	}
	if old.CoinRushFinishBonuses[0] != def.CoinRushFinishBonuses[0] {
		t.Errorf("expected the default top rung, got %d", old.CoinRushFinishBonuses[0])
	}
	if old.CoinRushCountdownSeconds != def.CoinRushCountdownSeconds {
		t.Errorf("expected the default countdown, got %d", old.CoinRushCountdownSeconds)
	}

	// A host's own ladder survives verbatim, however short.
	custom := NormalizeRuleset(Ruleset{CoinRushFinishBonuses: []int{500}, CoinRushCountdownSeconds: 60})
	if len(custom.CoinRushFinishBonuses) != 1 || custom.CoinRushFinishBonuses[0] != 500 {
		t.Errorf("expected a custom ladder to survive, got %v", custom.CoinRushFinishBonuses)
	}
	if custom.CoinRushCountdownSeconds != 60 {
		t.Errorf("expected a custom countdown to survive, got %d", custom.CoinRushCountdownSeconds)
	}

	// Negatives are repaired rather than rejected: a rung that pays a team for
	// arriving would invert the whole mode.
	repaired := NormalizeRuleset(Ruleset{CoinRushFinishBonuses: []int{100, -5}, CoinRushLateFinishBonus: -1})
	if repaired.CoinRushFinishBonuses[1] != 0 {
		t.Errorf("expected a negative rung to clamp to zero, got %d", repaired.CoinRushFinishBonuses[1])
	}
	if repaired.CoinRushLateFinishBonus != 0 {
		t.Errorf("expected a negative late bonus to clamp to zero, got %d", repaired.CoinRushLateFinishBonus)
	}

	if got := NormalizeRuleset(Ruleset{CoinRushCountdownSeconds: 90}).CoinRushCountdown(); got != 90*time.Second {
		t.Errorf("expected the countdown as a duration, got %v", got)
	}
}

func TestCoinRushWinnerIsRichestNotFastest(t *testing.T) {
	// The mode, in one assertion: the team that got there first loses to the team
	// that took the detour and came back richer.
	scores := []CoinRushScore{
		{TeamID: "sprinter", Coins: 200, FinishRank: 1},
		{TeamID: "detour", Coins: 260, FinishRank: 3},
		{TeamID: "middle", Coins: 210, FinishRank: 2},
	}
	if got := CoinRushWinner(scores); got != "detour" {
		t.Errorf("expected the richest team to win, got %q", got)
	}

	// On equal coins, the team that got there first earned them under more
	// pressure.
	tied := []CoinRushScore{
		{TeamID: "late", Coins: 100, FinishRank: 3},
		{TeamID: "early", Coins: 100, FinishRank: 1},
	}
	if got := CoinRushWinner(tied); got != "early" {
		t.Errorf("expected the earlier finisher to break a coin tie, got %q", got)
	}

	// A rank of zero means "never crossed", which has to sort last rather than
	// ahead of first place — the trap in treating rank as a plain integer.
	dnf := []CoinRushScore{
		{TeamID: "walked-off", Coins: 100, FinishRank: 0},
		{TeamID: "finished", Coins: 100, FinishRank: 4},
	}
	if got := CoinRushWinner(dnf); got != "finished" {
		t.Errorf("expected a finisher to beat a non-finisher on equal coins, got %q", got)
	}

	// A game nobody joined records no winner rather than panicking — the same
	// empty winner a host-abandoned race writes.
	if got := CoinRushWinner(nil); got != "" {
		t.Errorf("expected an empty field to have no winner, got %q", got)
	}
}

// TestCoinRushLessIsATotalOrder is the property that keeps the standings table
// and the announced winner in step.
//
// Coins are small integers and by the end of a race the whole field is parked at
// the finish, so exact ties are routine. An ordering that left any pair
// unresolved would let two rebuilds of the same event log disagree about the top
// row while agreeing about the winner.
func TestCoinRushLessIsATotalOrder(t *testing.T) {
	scores := []CoinRushScore{
		{TeamID: "a", Coins: 100, FinishRank: 1},
		{TeamID: "b", Coins: 100, FinishRank: 1},
		{TeamID: "c", Coins: 100, FinishRank: 0},
		{TeamID: "d", Coins: 0, FinishRank: 0},
		{TeamID: "e", Coins: 250, FinishRank: 3},
	}

	for _, x := range scores {
		if CoinRushLess(x, x) {
			t.Errorf("%q sorts before itself", x.TeamID)
		}
		for _, y := range scores {
			if x.TeamID == y.TeamID {
				continue
			}
			// Antisymmetry: never both directions, and never neither.
			if CoinRushLess(x, y) == CoinRushLess(y, x) {
				t.Errorf("%q and %q are unordered or mutually less", x.TeamID, y.TeamID)
			}
		}
	}

	// Shuffling the input cannot change the answer.
	rng := rand.New(rand.NewSource(1))
	want := CoinRushWinner(scores)
	for i := 0; i < 50; i++ {
		shuffled := append([]CoinRushScore(nil), scores...)
		rng.Shuffle(len(shuffled), func(a, b int) { shuffled[a], shuffled[b] = shuffled[b], shuffled[a] })
		if got := CoinRushWinner(shuffled); got != want {
			t.Fatalf("winner changed with input order: %q then %q", want, got)
		}
	}
}
