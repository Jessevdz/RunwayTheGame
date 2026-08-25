package projections

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/Jessevdz/RunwayTheGame/internal/rules"
)

// TestCoinRushStateOmitsUnsetTimestamps verifies that zero-value time fields are omitted when marshaling CoinRushState.
func TestCoinRushStateOmitsUnsetTimestamps(t *testing.T) {
	t.Run("nobody home yet", func(t *testing.T) {
		encoded, err := json.Marshal(CoinRushState{})
		if err != nil {
			t.Fatalf("failed to marshal: %v", err)
		}
		var decoded map[string]interface{}
		if err := json.Unmarshal(encoded, &decoded); err != nil {
			t.Fatalf("failed to round-trip: %v", err)
		}
		if _, present := decoded["deadline"]; present {
			t.Errorf("expected deadline to be absent, got %s", encoded)
		}
		if _, present := decoded["first_finish_at"]; present {
			t.Errorf("expected first_finish_at to be absent, got %s", encoded)
		}
		// Verify finishers is an empty array.
		if decoded["finishers"] == nil {
			t.Errorf("expected finishers to be an empty array, got %s", encoded)
		}
		if strings.Contains(string(encoded), "0001-01-01") {
			t.Errorf("the zero time reached the wire: %s", encoded)
		}
	})

	t.Run("countdown running", func(t *testing.T) {
		first := time.Date(2026, 8, 1, 14, 0, 0, 0, time.UTC)
		encoded, err := json.Marshal(CoinRushState{
			FirstFinishAt: first,
			Deadline:      first.Add(30 * time.Minute),
			Finishers:     []CoinRushFinisher{{TeamID: "a", Rank: 1, BonusCoins: 150, FinishedAt: first}},
		})
		if err != nil {
			t.Fatalf("failed to marshal: %v", err)
		}
		var decoded map[string]interface{}
		_ = json.Unmarshal(encoded, &decoded)
		if decoded["deadline"] == nil || decoded["first_finish_at"] == nil {
			t.Errorf("expected both timestamps once somebody is home, got %s", encoded)
		}
	})

	t.Run("nil state is absent from the projection entirely", func(t *testing.T) {
		encoded, err := json.Marshal(GameStateProjection{Mode: rules.ModeTeam})
		if err != nil {
			t.Fatalf("failed to marshal: %v", err)
		}
		var decoded map[string]interface{}
		_ = json.Unmarshal(encoded, &decoded)
		// Verify coin_rush is omitted outside coin rush mode.
		if _, present := decoded["coin_rush"]; present {
			t.Errorf("expected coin_rush to be omitted outside a coin rush, got %s", encoded)
		}
	})
}

// TestCoinRushStateExpired verifies expiration logic for CoinRushState.
func TestCoinRushStateExpired(t *testing.T) {
	deadline := time.Date(2026, 8, 1, 14, 30, 0, 0, time.UTC)
	state := CoinRushState{Deadline: deadline}

	if state.Expired(deadline.Add(-time.Second)) {
		t.Error("expected a countdown with a second left not to have expired")
	}
	// Verify the deadline instant is considered expired.
	if !state.Expired(deadline) {
		t.Error("expected the deadline instant itself to count as expired")
	}
	if !state.Expired(deadline.Add(time.Hour)) {
		t.Error("expected a lapsed countdown to have expired")
	}
	if (CoinRushState{}).Expired(deadline) {
		t.Error("expected a state with no deadline never to be expired")
	}
}

// TestApplyCoinRushDeadlineUsesTheGamesOwnCountdown verifies that the coin rush deadline is set using the ruleset countdown.
func TestApplyCoinRushDeadlineUsesTheGamesOwnCountdown(t *testing.T) {
	first := time.Date(2026, 8, 1, 14, 0, 0, 0, time.UTC)

	p := &GameStateProjection{
		Mode:     rules.ModeCoinRush,
		Ruleset:  rules.NormalizeRuleset(rules.Ruleset{CoinRushCountdownSeconds: 600}),
		CoinRush: &CoinRushState{FirstFinishAt: first},
	}
	applyCoinRushDeadline(p)
	if want := first.Add(10 * time.Minute); !p.CoinRush.Deadline.Equal(want) {
		t.Errorf("expected the game's own countdown to set the deadline, got %v want %v", p.CoinRush.Deadline, want)
	}

	// Verify no deadline is set before any team finishes.
	none := &GameStateProjection{Mode: rules.ModeCoinRush, Ruleset: rules.DefaultRuleset()}
	applyCoinRushDeadline(none)
	if none.CoinRush != nil {
		t.Error("expected no countdown before anybody has finished")
	}
}

// TestComputeStandingsOrdersByModeIsTheWinCondition verifies standings sorting order across game modes.
func TestComputeStandingsOrdersByModeIsTheWinCondition(t *testing.T) {
	// Verify standings ordering differs between team race and coin rush modes.
	newProjection := func(mode string) *GameStateProjection {
		return &GameStateProjection{
			Mode:    mode,
			Ruleset: rules.DefaultRuleset(),
			Teams: map[string]TeamInfo{
				"sprinter": {Name: "Sprinter"},
				"detour":   {Name: "Detour"},
			},
			Coins: map[string]int{"sprinter": 200, "detour": 260},
			Progress: map[string]rules.TeamProgress{
				"sprinter": {ReachedFinish: true, CurrentWaypointID: "finish"},
				"detour":   {CurrentWaypointID: "finish"},
			},
			Board: rules.Board{
				Waypoints: []rules.Waypoint{{ID: "finish", IsFinish: true}},
			},
			CoinRush: &CoinRushState{
				FirstFinishAt: time.Now().UTC(),
				Finishers:     []CoinRushFinisher{{TeamID: "sprinter", Rank: 1, BonusCoins: 150}},
			},
		}
	}

	race := newProjection(rules.ModeTeam)
	computeStandings(race)
	if race.StandingsList[0].TeamID != "sprinter" {
		t.Errorf("expected a team race to rank by distance, got %q on top", race.StandingsList[0].TeamID)
	}

	rush := newProjection(rules.ModeCoinRush)
	computeStandings(rush)
	if rush.StandingsList[0].TeamID != "detour" {
		t.Errorf("expected a coin rush to rank by coins, got %q on top", rush.StandingsList[0].TeamID)
	}

	// Verify finish placement details are populated on standings rows.
	var sprinterRow StandingRow
	for _, row := range rush.StandingsList {
		if row.TeamID == "sprinter" {
			sprinterRow = row
		}
	}
	if !sprinterRow.Finished || sprinterRow.FinishRank != 1 || sprinterRow.FinishBonus != 150 {
		t.Errorf("expected the finish to be carried on the standings row, got %+v", sprinterRow)
	}
}

// TestComputeStandingsIsATotalOrder verifies deterministic sorting order when team metrics match.
func TestComputeStandingsIsATotalOrder(t *testing.T) {
	build := func() []StandingRow {
		p := &GameStateProjection{
			Mode:    rules.ModeCoinRush,
			Ruleset: rules.DefaultRuleset(),
			Teams: map[string]TeamInfo{
				"aaa": {Name: "A"}, "bbb": {Name: "B"}, "ccc": {Name: "C"}, "ddd": {Name: "D"},
			},
			Coins:    map[string]int{"aaa": 100, "bbb": 100, "ccc": 100, "ddd": 100},
			Progress: map[string]rules.TeamProgress{},
			Board:    rules.Board{Waypoints: []rules.Waypoint{{ID: "start", IsStart: true}, {ID: "finish", IsFinish: true}}},
		}
		computeStandings(p)
		return p.StandingsList
	}

	first := build()
	for i := 0; i < 25; i++ {
		again := build()
		for j := range first {
			if first[j].TeamID != again[j].TeamID {
				t.Fatalf("standings reshuffled between rebuilds: %v then %v", first[j].TeamID, again[j].TeamID)
			}
		}
	}
}
