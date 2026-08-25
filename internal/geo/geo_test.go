package geo

import (
	"context"
	"testing"

	"github.com/Jessevdz/RunwayTheGame/internal/db"
	"github.com/Jessevdz/RunwayTheGame/internal/rules"
	"github.com/Jessevdz/RunwayTheGame/internal/testsupport"
)

func getTestDB(t *testing.T) (*db.DB, context.Context) {
	return testsupport.DB(t, "geo")
}

func TestDistanceM(t *testing.T) {
	// Distance between two close points
	dist := DistanceM(0.0, 0.0, 0.01, 0.01)
	if dist <= 0 {
		t.Errorf("expected positive distance, got %f", dist)
	}
}

func TestGeodesicLength(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	defer database.Close()

	length, err := GeodesicLength(ctx, database, 0.0, 0.0, 0.01, 0.01)
	if err != nil {
		t.Fatalf("failed to compute geodesic length: %v", err)
	}
	if length <= 0 {
		t.Errorf("expected positive length, got %f", length)
	}
}

func TestBoardValidation(t *testing.T) {
	// Case 1: Valid board
	board := rules.Board{
		ID:      "board_1",
		Version: 1,
		Name:    "Test Board",
		Waypoints: []rules.Waypoint{
			{ID: "w1", Name: "Start", Lat: 0.0, Lon: 0.0, IsStart: true, IsFinish: false},
			{ID: "w2", Name: "Finish", Lat: 0.01, Lon: 0.01, IsStart: false, IsFinish: true},
		},
		Roads: []rules.Road{
			{ID: "s1", WaypointIDA: "w1", WaypointIDB: "w2"},
		},
	}

	errors, _, err := ValidateBoard(t.Context(), nil, board)
	if err != nil {
		t.Fatalf("validation errored: %v", err)
	}
	if len(errors) > 0 {
		t.Errorf("expected no validation errors, got: %v", errors)
	}

	// Case 2: No start waypoint
	board.Waypoints[0].IsStart = false
	errors, _, _ = ValidateBoard(t.Context(), nil, board)
	if len(errors) == 0 {
		t.Error("expected validation error for missing start waypoint")
	}
	board.Waypoints[0].IsStart = true // restore

	// Case 3: Multiple finish waypoints
	board.Waypoints[0].IsFinish = true
	errors, _, _ = ValidateBoard(t.Context(), nil, board)
	if len(errors) == 0 {
		t.Error("expected validation error for multiple finish waypoints")
	}
	board.Waypoints[0].IsFinish = false // restore

	// Case 4: Unreachable finish waypoint
	board.Roads = []rules.Road{} // clear roads
	errors, _, _ = ValidateBoard(t.Context(), nil, board)
	hasUnreachable := false
	for _, e := range errors {
		if containsString(e, "unreachable") {
			hasUnreachable = true
		}
	}
	if !hasUnreachable {
		t.Error("expected unreachable finish validation error")
	}

	// Case 5: Isolated waypoint
	board.Roads = []rules.Road{
		{ID: "s1", WaypointIDA: "w1", WaypointIDB: "w2"},
	}
	board.Waypoints = append(board.Waypoints, rules.Waypoint{
		ID:       "w3",
		Name:     "Isolated",
		IsStart:  false,
		IsFinish: false,
	})
	errors, _, _ = ValidateBoard(t.Context(), nil, board)
	hasIsolated := false
	for _, e := range errors {
		if containsString(e, "isolated") {
			hasIsolated = true
		}
	}
	if !hasIsolated {
		t.Error("expected isolated waypoint validation error")
	}

	// Case 6: A single waypoint may not be both start and finish
	sameStartFinishBoard := rules.Board{
		ID:      "board_combined",
		Version: 1,
		Name:    "Combined Start/Finish Board",
		Waypoints: []rules.Waypoint{
			{ID: "w1", Name: "Start and Finish", Lat: 0.0, Lon: 0.0, IsStart: true, IsFinish: true},
			{ID: "w2", Name: "Mid Waypoint", Lat: 0.01, Lon: 0.01, IsStart: false, IsFinish: false},
		},
		Roads: []rules.Road{
			{ID: "s1", WaypointIDA: "w1", WaypointIDB: "w2"},
		},
	}
	errors, _, err = ValidateBoard(t.Context(), nil, sameStartFinishBoard)
	if err != nil {
		t.Fatalf("validation errored on combined board: %v", err)
	}
	hasCombinedRole := false
	for _, e := range errors {
		if containsString(e, "cannot be both the start and the finish") {
			hasCombinedRole = true
		}
	}
	if !hasCombinedRole {
		t.Errorf("expected error for waypoint acting as both start and finish, got: %v", errors)
	}

	// Case 7: Waypoint reachable via its own roads but disconnected from the start's component
	disconnectedBranchBoard := rules.Board{
		ID:      "board_disconnected_branch",
		Version: 1,
		Name:    "Disconnected Branch Board",
		Waypoints: []rules.Waypoint{
			{ID: "w1", Name: "Start", Lat: 0.0, Lon: 0.0, IsStart: true, IsFinish: false},
			{ID: "w2", Name: "Finish", Lat: 0.01, Lon: 0.01, IsStart: false, IsFinish: true},
			{ID: "w3", Name: "Side Branch A", Lat: 0.02, Lon: 0.02, IsStart: false, IsFinish: false},
			{ID: "w4", Name: "Side Branch B", Lat: 0.03, Lon: 0.03, IsStart: false, IsFinish: false},
		},
		Roads: []rules.Road{
			{ID: "s1", WaypointIDA: "w1", WaypointIDB: "w2"},
			{ID: "s2", WaypointIDA: "w3", WaypointIDB: "w4"}, // connected to each other, not to start
		},
	}
	errors, _, err = ValidateBoard(t.Context(), nil, disconnectedBranchBoard)
	if err != nil {
		t.Fatalf("validation errored on disconnected branch board: %v", err)
	}
	hasUnreachableBranch := false
	hasSpuriousIsolated := false
	for _, e := range errors {
		if containsString(e, "unreachable from the start waypoint") {
			hasUnreachableBranch = true
		}
		if containsString(e, "isolated") {
			hasSpuriousIsolated = true
		}
	}
	if !hasUnreachableBranch {
		t.Errorf("expected unreachable-from-start error for disconnected branch waypoints, got: %v", errors)
	}
	if hasSpuriousIsolated {
		t.Errorf("did not expect isolated-waypoint error for non-isolated (but disconnected) waypoints, got: %v", errors)
	}

	// Case 8: Finish waypoints cannot carry a challenge.
	finishChallengeBoard := rules.Board{
		ID:      "board_finish_challenge",
		Version: 1,
		Name:    "Finish With A Challenge",
		Waypoints: []rules.Waypoint{
			{ID: "w1", Name: "Start", Lat: 0.0, Lon: 0.0, IsStart: true},
			{ID: "w2", Name: "Finish", Lat: 0.01, Lon: 0.01, IsFinish: true, ChallengeID: "c1"},
		},
		Roads: []rules.Road{
			{ID: "s1", WaypointIDA: "w1", WaypointIDB: "w2"},
		},
	}
	errors, _, err = ValidateBoard(t.Context(), nil, finishChallengeBoard)
	if err != nil {
		t.Fatalf("validation errored on finish-challenge board: %v", err)
	}
	hasFinishChallenge := false
	for _, e := range errors {
		if containsString(e, "cannot carry a challenge") {
			hasFinishChallenge = true
		}
	}
	if !hasFinishChallenge {
		t.Errorf("expected an error for a finish waypoint carrying a challenge, got: %v", errors)
	}

	// The same board with the challenge on a non-finish waypoint is fine.
	finishChallengeBoard.Waypoints[1].ChallengeID = ""
	finishChallengeBoard.Waypoints[0].ChallengeID = "c1"
	errors, _, err = ValidateBoard(t.Context(), nil, finishChallengeBoard)
	if err != nil {
		t.Fatalf("validation errored on start-challenge board: %v", err)
	}
	for _, e := range errors {
		if containsString(e, "cannot carry a challenge") {
			t.Errorf("a challenge on a non-finish waypoint must validate cleanly, got: %v", errors)
		}
	}
}

func containsString(str, substr string) bool {
	return len(str) >= len(substr) && func() bool {
		for i := 0; i <= len(str)-len(substr); i++ {
			if str[i:i+len(substr)] == substr {
				return true
			}
		}
		return false
	}()
}
