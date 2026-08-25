package projections

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/Jessevdz/RunwayTheGame/internal/db"
	"github.com/Jessevdz/RunwayTheGame/internal/eventstore"
	"github.com/Jessevdz/RunwayTheGame/internal/rules"
	"github.com/Jessevdz/RunwayTheGame/internal/testsupport"
)

func getTestDB(t *testing.T) (*db.DB, context.Context) {
	return testsupport.DB(t, "projections")
}

func TestRttEotWProjectionRebuild(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	defer database.Close()

	gameID := "00000000-0000-0000-0000-000000000201"
	boardID := "00000000-0000-0000-0000-000000000202"

	// 1. Clean up database
	_, _ = database.Pool.Exec(ctx, "DELETE FROM board_powerup_costs WHERE board_id = $1", boardID)
	_, _ = database.Pool.Exec(ctx, "DELETE FROM board_roadblock_cards WHERE board_id = $1", boardID)
	_, _ = database.Pool.Exec(ctx, "DELETE FROM board_curse_cards WHERE board_id = $1", boardID)
	_, _ = database.Pool.Exec(ctx, "DELETE FROM board_roads WHERE board_id = $1", boardID)
	_, _ = database.Pool.Exec(ctx, "DELETE FROM board_waypoints WHERE board_id = $1", boardID)
	_, _ = database.Pool.Exec(ctx, "DELETE FROM boards WHERE id = $1", boardID)
	_, _ = database.Pool.Exec(ctx, "DELETE FROM events WHERE game_id = $1", gameID)

	tx, err := database.Pool.Begin(ctx)
	if err != nil {
		t.Fatalf("failed to start setup transaction: %v", err)
	}
	defer tx.Rollback(ctx)

	wStart := "11111111-1111-1111-1111-111111111111"
	wMid := "22222222-2222-2222-2222-222222222222"
	wFinish := "33333333-3333-3333-3333-333333333333"
	s1 := "44444444-4444-4444-4444-444444444444"
	s2 := "55555555-5555-5555-5555-555555555555"

	// 2. Populate test board in database
	_, err = tx.Exec(ctx, "INSERT INTO boards (id, version, name) VALUES ($1, $2, $3)", boardID, 1, "RttEotW Test Board")
	if err != nil {
		t.Fatalf("failed to insert board: %v", err)
	}

	_, err = tx.Exec(ctx, `
		INSERT INTO board_waypoints (id, board_id, board_version, name, location, is_start, is_finish) VALUES
		($2, $1, 1, 'Start Point', ST_SetSRID(ST_MakePoint(0.0, 0.0), 4326), true, false),
		($3, $1, 1, 'Mid Point', ST_SetSRID(ST_MakePoint(0.0, 0.01), 4326), false, false),
		($4, $1, 1, 'Finish Point', ST_SetSRID(ST_MakePoint(0.0, 0.02), 4326), false, true)
	`, boardID, wStart, wMid, wFinish)
	if err != nil {
		t.Fatalf("failed to insert board waypoints: %v", err)
	}

	_, err = tx.Exec(ctx, `
		INSERT INTO board_roads (id, board_id, board_version, waypoint_id_a, waypoint_id_b, length_m) VALUES
		($2, $1, 1, $3, $4, 1000),
		($5, $1, 1, $4, $6, 1500)
	`, boardID, s1, wStart, wMid, s2, wFinish)
	if err != nil {
		t.Fatalf("failed to insert board roads: %v", err)
	}

	// 3. Append events
	p1, _ := json.Marshal(eventstore.GameCreatedPayload{BoardID: boardID})
	p2, _ := json.Marshal(eventstore.TeamJoinedPayload{TeamID: "red", Name: "Red Team", SlotIndex: 0})
	p3, _ := json.Marshal(eventstore.TeamJoinedPayload{TeamID: "blue", Name: "Blue Team", SlotIndex: 1})
	p4, _ := json.Marshal(eventstore.WaypointReachedPayload{TeamID: "red", WaypointID: wStart})
	p5, _ := json.Marshal(eventstore.WaypointReachedPayload{TeamID: "blue", WaypointID: wStart})
	p6, _ := json.Marshal(eventstore.CoinsChangedPayload{TeamID: "red", Delta: 20, BalanceAfter: 20, Reason: "start_award"})
	p7, _ := json.Marshal(eventstore.ChallengeCompletedPayload{WaypointID: wStart, RoadID: s1, ChallengeID: "c1", TeamID: "red", CoinReward: 10, FirstCompleter: true})
	p8, _ := json.Marshal(eventstore.WaypointReachedPayload{TeamID: "red", WaypointID: wMid})

	events := []eventstore.Event{
		{GameID: gameID, Sequence: 1, Type: "GameCreated", Payload: string(p1)},
		{GameID: gameID, Sequence: 2, Type: "TeamJoined", Payload: string(p2)},
		{GameID: gameID, Sequence: 3, Type: "TeamJoined", Payload: string(p3)},
		{GameID: gameID, Sequence: 4, Type: "WaypointReached", Payload: string(p4)},
		{GameID: gameID, Sequence: 5, Type: "WaypointReached", Payload: string(p5)},
		{GameID: gameID, Sequence: 6, Type: "CoinsChanged", Payload: string(p6)},
		{GameID: gameID, Sequence: 7, Type: "ChallengeCompleted", Payload: string(p7)},
		{GameID: gameID, Sequence: 8, Type: "WaypointReached", Payload: string(p8)},
	}

	err = eventstore.AppendEvents(ctx, tx, gameID, 1, events)
	if err != nil {
		t.Fatalf("failed to append events: %v", err)
	}

	err = tx.Commit(ctx)
	if err != nil {
		t.Fatalf("failed to commit setup transaction: %v", err)
	}

	// 4. Rebuild projection
	tx2, err := database.Pool.Begin(ctx)
	if err != nil {
		t.Fatalf("failed to begin read transaction: %v", err)
	}
	defer tx2.Rollback(ctx)

	p, err := RebuildProjection(ctx, tx2, gameID, 8)
	if err != nil {
		t.Fatalf("failed to rebuild projection: %v", err)
	}

	// Verify states
	if p.Teams["red"].Name != "Red Team" || p.Teams["blue"].Name != "Blue Team" {
		t.Errorf("incorrect team names: %+v", p.Teams)
	}

	if p.Progress["red"].CurrentWaypointID != wMid {
		t.Errorf("expected red current waypoint w_mid, got %s", p.Progress["red"].CurrentWaypointID)
	}

	if !p.WaypointStates[wStart].ClearedBy["red"] {
		t.Errorf("expected waypoint wStart cleared by red")
	}

	if p.RoadStates[s1].CompletedBy != "red" {
		t.Errorf("expected road s1 CompletedBy to be 'red', got '%s'", p.RoadStates[s1].CompletedBy)
	}

	gate := rules.RoadGateFor(p.RoadStates[s1], "blue", true)
	if !rules.CanTraverse(gate).Allowed {
		t.Errorf("expected road s1 to be open for blue team after challenge completion")
	}

	if p.Coins["red"] != 20 {
		t.Errorf("expected red to have 20 coins, got %d", p.Coins["red"])
	}

	// Verify standings: Red has remaining distance 1500 (from w_mid to w_finish), Blue has 2500 (from w_start to w_finish)
	if len(p.StandingsList) != 2 {
		t.Fatalf("expected 2 standings rows, got %d", len(p.StandingsList))
	}

	if p.StandingsList[0].TeamID != "red" {
		t.Errorf("expected red to lead standings, got %s", p.StandingsList[0].TeamID)
	}

	if p.StandingsList[0].DistanceToFinish != 1500 {
		t.Errorf("expected red remaining distance 1500, got %f", p.StandingsList[0].DistanceToFinish)
	}

	if p.StandingsList[1].DistanceToFinish != 2500 {
		t.Errorf("expected blue remaining distance 2500, got %f", p.StandingsList[1].DistanceToFinish)
	}
}
