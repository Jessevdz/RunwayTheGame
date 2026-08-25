package projections

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/Jessevdz/RunwayTheGame/internal/eventstore"
)

// TestProjectionRebuildIsDeterministic verifies that rebuilding a projection from an event log yields byte-identical JSON across multiple runs.
func TestProjectionRebuildIsDeterministic(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	defer database.Close()

	gameID := uuid.New().String()
	boardID := uuid.New().String()
	wStart := uuid.New().String()
	wMid := uuid.New().String()
	wFinish := uuid.New().String()
	seg1 := uuid.New().String()
	seg2 := uuid.New().String()
	red := uuid.New().String()
	blue := uuid.New().String()
	submissionID := uuid.New().String()
	cardID := uuid.New().String()

	mustExec := func(query string, args ...interface{}) {
		t.Helper()
		if _, err := database.Pool.Exec(ctx, query, args...); err != nil {
			t.Fatalf("setup failed: %v (%s)", err, query)
		}
	}

	mustExec("INSERT INTO boards (id, version, name, published_at) VALUES ($1, 1, 'Determinism Board', NOW())", boardID)
	mustExec(`
		INSERT INTO board_waypoints (id, board_id, board_version, name, location, is_start, is_finish, arrival_radius_m) VALUES
		($2, $1, 1, 'Start',  ST_SetSRID(ST_MakePoint(0.00, 0.0), 4326), true,  false, 25),
		($3, $1, 1, 'Mid',    ST_SetSRID(ST_MakePoint(0.01, 0.0), 4326), false, false, 25),
		($4, $1, 1, 'Finish', ST_SetSRID(ST_MakePoint(0.02, 0.0), 4326), false, true,  25)
	`, boardID, wStart, wMid, wFinish)
	mustExec(`
		INSERT INTO board_roads (id, board_id, board_version, waypoint_id_a, waypoint_id_b, length_m) VALUES
		($1, $3, 1, $4, $5, 1000),
		($2, $3, 1, $5, $6, 1500)
	`, seg1, seg2, boardID, wStart, wMid, wFinish)
	mustExec(`INSERT INTO board_roadblock_cards (id, board_id, board_version, text) VALUES ($1, $2, 1, 'Do ten push-ups.')`, cardID, boardID)
	mustExec(`INSERT INTO board_curse_cards (id, board_id, board_version, text) VALUES ($1, $2, 1, 'Walk backwards.')`, uuid.New().String(), boardID)
	mustExec(`INSERT INTO board_powerup_costs (board_id, board_version, powerup, cost) VALUES ($1, 1, 'roadblock', 15), ($1, 1, 'nerf', 10)`, boardID)
	// Insert parent game record for foreign key constraints.
	mustExec(`
		INSERT INTO games (id, board_id, board_version, status, ruleset, starts_at, ends_at)
		VALUES ($1, $2, 1, 'live', '{}', NOW() - INTERVAL '1 hour', NOW() + INTERVAL '1 hour')
	`, gameID, boardID)
	mustExec(`
		INSERT INTO team_positions (game_id, team_id, lat, lon, accuracy_m, reported_at)
		VALUES ($1, $2, 0.0, 0.005, 9.0, NOW()), ($1, $3, 0.0, 0.001, 12.0, NOW())
	`, gameID, red, blue)

	// Build event log exercising all projection state folds.
	until := time.Now().UTC().Add(time.Hour).Truncate(time.Second)
	marshal := func(v interface{}) string {
		b, err := json.Marshal(v)
		if err != nil {
			t.Fatalf("failed to marshal an event payload: %v", err)
		}
		return string(b)
	}

	log := []eventstore.Event{
		{Type: "GameCreated", Payload: marshal(eventstore.GameCreatedPayload{BoardID: boardID})},
		{Type: "TeamJoined", Payload: marshal(eventstore.TeamJoinedPayload{TeamID: red, Name: "Red", SlotIndex: 0})},
		{Type: "TeamJoined", Payload: marshal(eventstore.TeamJoinedPayload{TeamID: blue, Name: "Blue", SlotIndex: 1})},
		{Type: "GameStarted", Payload: "{}"},
		{Type: "WaypointReached", Payload: marshal(eventstore.WaypointReachedPayload{TeamID: red, WaypointID: wMid})},
		{Type: "ChallengeAttemptStarted", Payload: marshal(eventstore.ChallengeAttemptStartedPayload{TeamID: red, WaypointID: wMid, ChallengeID: "c1", Prompt: "Photograph the bridge"})},
		{Type: "SubmissionCreated", Payload: marshal(eventstore.SubmissionCreatedPayload{SubmissionID: submissionID, TeamID: red, WaypointID: wMid, RoadID: seg2, ChallengeID: "c1", BlobRef: "evidence/1"})},
		{Type: "VerdictReturned", Payload: marshal(eventstore.VerdictReturnedPayload{SubmissionID: submissionID, Verdict: "pass", Confidence: 0.91, Rationale: "bridge visible"})},
		{Type: "ChallengeCompleted", Payload: marshal(eventstore.ChallengeCompletedPayload{WaypointID: wMid, RoadID: seg2, ChallengeID: "c1", TeamID: red, CoinReward: 20, FirstCompleter: true})},
		{Type: "CoinsChanged", Payload: marshal(eventstore.CoinsChangedPayload{TeamID: red, Delta: 20, BalanceAfter: 20, Reason: "challenge_complete"})},
		{Type: "PowerupPurchased", Payload: marshal(eventstore.PowerupPurchasedPayload{TeamID: red, Powerup: "roadblock", Cost: 15})},
		{Type: "CoinsChanged", Payload: marshal(eventstore.CoinsChangedPayload{TeamID: red, Delta: -15, BalanceAfter: 5, Reason: "powerup_purchase"})},
		{Type: "PowerupUsed", Payload: marshal(eventstore.PowerupUsedPayload{TeamID: red, Powerup: "roadblock", RoadID: seg1})},
		{Type: "CardDrawn", Payload: marshal(eventstore.CardDrawnPayload{TeamID: red, CardID: cardID, Text: "Do ten push-ups.", Deck: "roadblock"})},
		{Type: "RoadblockPlaced", Payload: marshal(eventstore.RoadblockPlacedPayload{RoadID: seg1, PlacedBy: red, CardID: cardID, ChallengeText: "Do ten push-ups."})},
		{Type: "RoadblockCleared", Payload: marshal(eventstore.RoadblockClearedPayload{RoadID: seg1, TeamID: blue, SubmissionID: uuid.New().String()})},
		{Type: "TeamFrozen", Payload: marshal(eventstore.TeamFrozenPayload{TeamID: blue, Until: until, Source: red})},
		{Type: "CurseApplied", Payload: marshal(eventstore.CurseAppliedPayload{ByTeamID: red, TargetTeamID: blue, CardID: cardID, Text: "Walk backwards.", Until: until})},
		{Type: "CurseCleared", Payload: marshal(eventstore.CurseClearedPayload{TargetTeamID: blue, CardID: cardID, Reason: "resolved"})},
		{Type: "TrackerToggled", Payload: marshal(eventstore.TrackerToggledPayload{TeamID: red, Disabled: true, Until: until})},
		{Type: "ChallengeVetoed", Payload: marshal(eventstore.ChallengeVetoedPayload{TeamID: blue, WaypointID: wMid, RoadID: seg2, ChallengeID: "c1", PenaltyUntil: until})},
		{Type: "ArrivalFlagged", Payload: marshal(eventstore.ArrivalFlaggedPayload{TeamID: blue, WaypointID: wMid, Reason: "implausible velocity since last position report", SpeedMS: 412.5})},
		{Type: "DisputeRaised", Payload: marshal(eventstore.DisputeRaisedPayload{VerdictID: submissionID, ByTeamID: blue, Objection: "the bridge is not the one named"})},
		{Type: "DisputeResolved", Payload: marshal(eventstore.DisputeResolvedPayload{VerdictID: submissionID, Outcome: "upheld", Source: "gm"})},
		{Type: "ChallengeConflictNoted", Payload: marshal(eventstore.ChallengeConflictNotedPayload{RoadID: seg2, TeamID: blue, Message: "already completed"})},
		{Type: "WaypointReached", Payload: marshal(eventstore.WaypointReachedPayload{TeamID: red, WaypointID: wFinish, IsFinish: true})},
		{Type: "GameEnded", Payload: marshal(eventstore.GameEndedPayload{WinnerTeamID: red})},
	}
	for i := range log {
		log[i].GameID = gameID
		log[i].Sequence = i + 1
	}

	tx, err := database.Pool.Begin(ctx)
	if err != nil {
		t.Fatalf("failed to begin setup transaction: %v", err)
	}
	if err := eventstore.AppendEvents(ctx, tx, gameID, 1, log); err != nil {
		_ = tx.Rollback(ctx)
		t.Fatalf("failed to append events: %v", err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("failed to commit setup transaction: %v", err)
	}

	rebuild := func() []byte {
		t.Helper()
		p, err := RebuildProjection(ctx, database.Pool, gameID, 0)
		if err != nil {
			t.Fatalf("failed to rebuild projection: %v", err)
		}
		encoded, err := json.Marshal(p)
		if err != nil {
			t.Fatalf("failed to encode projection: %v", err)
		}
		return encoded
	}

	first := rebuild()
	for i := 2; i <= 5; i++ {
		if next := rebuild(); string(next) != string(first) {
			t.Fatalf("replay %d of the same event log produced different JSON\nfirst: %s\ngot:   %s", i, first, next)
		}
	}

	// Verify the rebuilt projection contains non-empty state.
	var p GameStateProjection
	if err := json.Unmarshal(first, &p); err != nil {
		t.Fatalf("failed to decode the projection back: %v", err)
	}
	if p.Winner != red || len(p.Teams) != 2 || p.LastSequence != len(log) {
		t.Fatalf("expected a fully folded projection, got winner=%q teams=%d seq=%d", p.Winner, len(p.Teams), p.LastSequence)
	}
	if len(p.Roadblocks) != 1 || !p.Roadblocks[seg1].ClearedBy[blue] {
		t.Errorf("expected the roadblock fold to record Blue's clearance, got %+v", p.Roadblocks)
	}
	if len(p.Submissions) != 1 || len(p.Disputes) != 1 {
		t.Errorf("expected one submission and one dispute, got %d and %d", len(p.Submissions), len(p.Disputes))
	}
}
