package projections

import (
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/Jessevdz/RunwayTheGame/internal/eventstore"
	"github.com/Jessevdz/RunwayTheGame/internal/rules"
)

var uuidPattern = regexp.MustCompile(`(?i)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}`)

const (
	redID     = "11111111-1111-1111-1111-111111111111"
	blueID    = "22222222-2222-2222-2222-222222222222"
	parkID    = "33333333-3333-3333-3333-333333333333"
	pierID    = "44444444-4444-4444-4444-444444444444"
	roadID    = "55555555-5555-5555-5555-555555555555"
	submitID  = "66666666-6666-6666-6666-666666666666"
	cardID    = "77777777-7777-7777-7777-777777777777"
	challenge = "88888888-8888-8888-8888-888888888888"
)

// namedProjection creates a test projection populated with named entities.
func namedProjection() *GameStateProjection {
	p := emptyProjection("99999999-9999-9999-9999-999999999999")
	p.Board = rules.Board{
		ID:   "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
		Name: "Ghent Loop",
		Waypoints: []rules.Waypoint{
			{ID: parkID, Name: "Citadel Park"},
			{ID: pierID, Name: "Old Pier"},
		},
		Roads:    []rules.Road{{ID: roadID, WaypointIDA: parkID, WaypointIDB: pierID}},
		Powerups: []rules.Powerup{{ID: "tracker_off", Name: "Tracker Off"}},
	}
	p.Teams[redID] = TeamInfo{Name: "Red", SlotIndex: 0}
	p.Teams[blueID] = TeamInfo{Name: "Blue", SlotIndex: 1}
	return p
}

// foldRaceSample applies sample events of each type to the projection.
func foldRaceSample(p *GameStateProjection) {
	now := time.Date(2026, 8, 18, 10, 0, 0, 0, time.UTC)
	e := eventstore.Event{CreatedAt: now}

	foldWaypointReached(p, e, eventstore.WaypointReachedPayload{TeamID: redID, WaypointID: parkID})
	foldTeamFinished(p, e, eventstore.TeamFinishedPayload{TeamID: redID, Rank: 1, BonusCoins: 30})
	foldArrivalFlagged(p, e, eventstore.ArrivalFlaggedPayload{TeamID: blueID, WaypointID: pierID, Reason: "impossible speed"})

	foldChallengeAttemptStarted(p, e, eventstore.ChallengeAttemptStartedPayload{TeamID: redID, WaypointID: parkID, ChallengeID: challenge})
	foldChallengeAttemptStarted(p, e, eventstore.ChallengeAttemptStartedPayload{TeamID: blueID, RoadID: roadID, ChallengeID: challenge})
	foldSubmissionCreated(p, e, eventstore.SubmissionCreatedPayload{SubmissionID: submitID, TeamID: redID, RoadID: parkID, ChallengeID: challenge})
	foldVerdictReturned(p, e, eventstore.VerdictReturnedPayload{SubmissionID: submitID, Verdict: "pass", Rationale: "the sign is legible"})
	foldChallengeCompleted(p, e, eventstore.ChallengeCompletedPayload{TeamID: redID, RoadID: parkID, CoinReward: 20, FirstCompleter: true})
	foldChallengeCompleted(p, e, eventstore.ChallengeCompletedPayload{TeamID: blueID, RoadID: roadID, Source: "gm", Note: "verdict never arrived"})
	foldChallengeVetoed(p, e, eventstore.ChallengeVetoedPayload{TeamID: blueID, WaypointID: pierID, PenaltyUntil: now.Add(15 * time.Minute)})
	foldChallengeConflictNoted(p, e, eventstore.ChallengeConflictNotedPayload{TeamID: blueID, RoadID: roadID, Message: "road already completed by team Red"})

	foldCoinsChanged(p, e, eventstore.CoinsChangedPayload{TeamID: redID, Delta: -25, BalanceAfter: 5, Reason: "powerup_purchase"})
	foldCoinsChanged(p, e, eventstore.CoinsChangedPayload{TeamID: redID, Delta: 15, BalanceAfter: 20, Source: "gm", Note: "manual bonus"})
	foldPowerupPurchased(p, e, eventstore.PowerupPurchasedPayload{TeamID: redID, Powerup: "tracker_off"})
	foldPowerupUsed(p, e, eventstore.PowerupUsedPayload{TeamID: redID, Powerup: "tracker_off"})
	foldCardDrawn(p, e, eventstore.CardDrawnPayload{TeamID: blueID, Deck: "roadblock", CardID: cardID, Text: "Hop on one leg"})

	foldRoadblockPlaced(p, e, eventstore.RoadblockPlacedPayload{RoadID: roadID, PlacedBy: redID, CardID: cardID, ChallengeText: "Hop on one leg"})
	foldRoadblockCleared(p, e, eventstore.RoadblockClearedPayload{RoadID: roadID, TeamID: blueID})
	foldCurseApplied(p, e, eventstore.CurseAppliedPayload{ByTeamID: redID, TargetTeamID: blueID, CardID: cardID, Text: "Walk backwards"})
	foldCurseCleared(p, e, eventstore.CurseClearedPayload{TargetTeamID: blueID, CardID: cardID, Reason: "resolved"})
	foldTeamFrozen(p, e, eventstore.TeamFrozenPayload{TeamID: blueID, Until: now.Add(30 * time.Minute), Source: redID})
	foldTrackerToggled(p, e, eventstore.TrackerToggledPayload{TeamID: redID, Disabled: true, Until: now.Add(45 * time.Minute)})
	foldTrackerToggled(p, e, eventstore.TrackerToggledPayload{TeamID: redID})
	foldEffectCleared(p, e, eventstore.EffectClearedPayload{TeamID: blueID, EffectType: "tracker_off", Note: "accidental self-freeze"})

	foldDisputeRaised(p, e, eventstore.DisputeRaisedPayload{VerdictID: submitID, ByTeamID: blueID, Objection: "the photo is of the wrong sign"})
	foldDisputeResolved(p, e, eventstore.DisputeResolvedPayload{VerdictID: submitID, Outcome: "upheld", Source: "gm"})
}

func TestPublicLogCarriesNoIdentifiers(t *testing.T) {
	p := namedProjection()
	foldRaceSample(p)

	hostLog := p.RedactFor("", true).PublicLog
	if len(hostLog) == 0 {
		t.Fatal("expected the sample race to write a public log")
	}
	for _, line := range hostLog {
		if uuidPattern.MatchString(line) {
			t.Errorf("race log line exposes a raw identifier: %q", line)
		}
	}
}

func TestPublicLogNamesTeamsAndPlaces(t *testing.T) {
	p := namedProjection()
	foldRaceSample(p)
	log := strings.Join(p.RedactFor("", true).PublicLog, "\n")

	want := []string{
		"Team Red reached waypoint Citadel Park",
		"Team Blue started a challenge on the road between Citadel Park and Old Pier",
		"Verdict on Red's photo at Citadel Park: pass",
		"Waypoint Citadel Park cleared by team Red (+20 coins, first to clear)",
		"[GM] Cleared the challenge on the road between Citadel Park and Old Pier for team Blue",
		"Team Blue vetoed the challenge on waypoint Old Pier (locked out for 15m)",
		"Team Red purchased powerup: Tracker Off",
		"Team Blue drew card: Hop on one leg (deck: roadblock)",
		"Team Red coins changed by -25 (balance: 5, reason: powerup purchase)",
		"Roadblock placed on the road between Citadel Park and Old Pier by team Red",
		"Team Blue frozen for 30m (by team Red)",
		"Team Red disabled tracker for 45m",
		"Dispute raised by team Blue on Red's photo at Citadel Park",
		"Dispute on Red's photo at Citadel Park resolved: upheld",
	}
	for _, phrase := range want {
		if !strings.Contains(log, phrase) {
			t.Errorf("expected the race log to contain %q, got:\n%s", phrase, log)
		}
	}
}

// TestPublicLogKeepsSurfaceMarkers verifies log prefixes expected by UI filters.
func TestPublicLogKeepsSurfaceMarkers(t *testing.T) {
	p := namedProjection()
	foldRaceSample(p)
	log := strings.Join(p.RedactFor("", true).PublicLog, "\n")

	for _, marker := range []string{"[GM] ", "flagged for review", "Dispute raised", "cleared by team", "reached waypoint", "used powerup", "coins changed by"} {
		if !strings.Contains(log, marker) {
			t.Errorf("expected the race log to keep the %q marker the UI filters on", marker)
		}
	}
}

// TestPowerupLabelFallsBackToSpelledOutID covers fallback formatting when no catalog is pinned.
func TestPowerupLabelFallsBackToSpelledOutID(t *testing.T) {
	p := namedProjection()
	if got := p.powerupLabel("tracker_off"); got != "Tracker Off" {
		t.Errorf("expected the board catalog name, got %q", got)
	}
	p.Board.Powerups = nil
	if got := p.powerupLabel("challenge_skip"); got != "Challenge Skip" {
		t.Errorf("expected a spelled-out powerup name, got %q", got)
	}
}

func TestHumanDuration(t *testing.T) {
	cases := map[time.Duration]string{
		500 * time.Millisecond: "a moment",
		30 * time.Second:       "30s",
		15 * time.Minute:       "15m",
		time.Hour:              "1h",
		95 * time.Minute:       "1h 35m",
	}
	for input, want := range cases {
		if got := humanDuration(input); got != want {
			t.Errorf("humanDuration(%s) = %q, want %q", input, got, want)
		}
	}
}
