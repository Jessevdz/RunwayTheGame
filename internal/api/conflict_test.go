package api

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/Jessevdz/RunwayTheGame/internal/db"
	"github.com/Jessevdz/RunwayTheGame/internal/testsupport"
)

func getConflictTestDB(t *testing.T) (*db.DB, context.Context) {
	return testsupport.DB(t, "api")
}

// conflictFixture is a live game and a road two teams can both claim.
type conflictFixture struct {
	gameID      string
	roadID      string
	challengeID string
}

func seedConflictGame(t *testing.T, ctx context.Context, database *db.DB) conflictFixture {
	t.Helper()
	fx := conflictFixture{
		gameID:      uuid.New().String(),
		roadID:      uuid.New().String(),
		challengeID: uuid.New().String(),
	}
	_, err := database.Pool.Exec(ctx, `
		INSERT INTO games (id, board_id, board_version, status, ruleset, starts_at, ends_at)
		VALUES ($1, $2, 1, 'live', '{}'::jsonb, NOW(), NOW() + interval '1 hour')
	`, fx.gameID, uuid.New().String())
	if err != nil {
		t.Fatalf("failed to insert game: %v", err)
	}
	return fx
}

func insertPass(t *testing.T, ctx context.Context, database *db.DB, fx conflictFixture, teamID string, receivedAt, capturedAt time.Time) string {
	t.Helper()
	id := uuid.New().String()
	_, err := database.Pool.Exec(ctx, `
		INSERT INTO challenge_submissions
		  (id, game_id, team_id, road_id, challenge_id, blob_ref, idempotency_key, status, client_captured_at, server_received_at)
		VALUES ($1, $2, $3, $4, $5, 'evidence/x', $6, 'pass', $7, $8)
	`, id, fx.gameID, teamID, fx.roadID, fx.challengeID, "idem-"+id, capturedAt, receivedAt)
	if err != nil {
		t.Fatalf("failed to insert submission: %v", err)
	}
	return id
}

// TestBackdatedClientTimestampCannotStealARoad is the regression test for the
// first-completer tiebreaker being decided by client_captured_at — a value the
// submitting device chooses. A team capturing second only had to claim an
// earlier timestamp to flip the leader's passed submission to 'fail' and take
// the reward.
func TestBackdatedClientTimestampCannotStealARoad(t *testing.T) {
	database, ctx := getConflictTestDB(t)
	if database == nil {
		return
	}
	defer database.Close()

	s := &Server{DB: database}
	fx := seedConflictGame(t, ctx, database)
	teamA := uuid.New().String()
	teamB := uuid.New().String()

	// Team A genuinely got there first: its evidence reached the server first.
	aReceived := time.Now().UTC().Add(-10 * time.Minute)
	sessionA := insertPass(t, ctx, database, fx, teamA, aReceived, aReceived)

	tx, err := database.Pool.Begin(ctx)
	if err != nil {
		t.Fatalf("failed to begin tx: %v", err)
	}
	defer tx.Rollback(ctx)

	// Team B submits later but backdates its claimed capture time to well before
	// team A's. Only the arrival time counts, so team A keeps the road.
	bReceived := time.Now().UTC()
	winner, msg, err := s.resolveRoadConflict(ctx, tx, fx.gameID, fx.roadID, teamB, &bReceived)
	if err != nil {
		t.Fatalf("resolveRoadConflict failed: %v", err)
	}
	if winner != teamA {
		t.Fatalf("a backdated timestamp stole the road: winner=%s, want team A (%s)", winner, teamA)
	}
	if msg == "" {
		t.Error("expected a conflict message naming the current owner and margin")
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("failed to commit tx: %v", err)
	}

	// Team A's pass must be untouched.
	var statusA string
	if err := database.Pool.QueryRow(ctx, `SELECT status FROM challenge_submissions WHERE id = $1`, sessionA).Scan(&statusA); err != nil {
		t.Fatalf("failed to fetch team A status: %v", err)
	}
	if statusA != "pass" {
		t.Errorf("team A's legitimate pass was demoted to %q", statusA)
	}
}

// TestEarlierArrivalDemotesALateRecordedWinner keeps the genuine case working:
// a submission that reached the server first but was graded second still wins.
func TestEarlierArrivalDemotesALateRecordedWinner(t *testing.T) {
	database, ctx := getConflictTestDB(t)
	if database == nil {
		return
	}
	defer database.Close()

	s := &Server{DB: database}
	fx := seedConflictGame(t, ctx, database)
	teamA := uuid.New().String()
	teamB := uuid.New().String()
	teamC := uuid.New().String()

	// Team A's verdict landed first, but its evidence arrived later than B's.
	aReceived := time.Now().UTC().Add(-5 * time.Minute)
	sessionA := insertPass(t, ctx, database, fx, teamA, aReceived, aReceived)

	tx, err := database.Pool.Begin(ctx)
	if err != nil {
		t.Fatalf("failed to begin tx: %v", err)
	}
	defer tx.Rollback(ctx)

	bReceived := time.Now().UTC().Add(-9 * time.Minute)
	winner, msg, err := s.resolveRoadConflict(ctx, tx, fx.gameID, fx.roadID, teamB, &bReceived)
	if err != nil {
		t.Fatalf("resolveRoadConflict failed: %v", err)
	}
	if winner != teamB {
		t.Fatalf("expected team B to win on the earlier arrival, got %s", winner)
	}
	if msg != "" {
		t.Errorf("expected no conflict message for the winner, got %q", msg)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("failed to commit tx: %v", err)
	}
	// Mimic what handleVerdict does on a win: record the new owner's pass.
	insertPass(t, ctx, database, fx, teamB, bReceived, bReceived)

	var statusA string
	if err := database.Pool.QueryRow(ctx, `SELECT status FROM challenge_submissions WHERE id = $1`, sessionA).Scan(&statusA); err != nil {
		t.Fatalf("failed to fetch team A status: %v", err)
	}
	if statusA != "fail" {
		t.Errorf("expected team A's superseded pass to be demoted to 'fail', got %q", statusA)
	}

	// A third team arriving after team B loses to it.
	tx2, err := database.Pool.Begin(ctx)
	if err != nil {
		t.Fatalf("failed to begin second tx: %v", err)
	}
	defer tx2.Rollback(ctx)

	cReceived := time.Now().UTC()
	winner2, msg2, err := s.resolveRoadConflict(ctx, tx2, fx.gameID, fx.roadID, teamC, &cReceived)
	if err != nil {
		t.Fatalf("second resolveRoadConflict failed: %v", err)
	}
	if winner2 != teamB {
		t.Fatalf("expected the current owner (team B) to hold the road, got %s", winner2)
	}
	if msg2 == "" {
		t.Error("expected a conflict message naming the current owner and margin")
	}
}

// TestSanitizeClientCapturedAt covers the recorded claim being discarded when it
// contradicts when the submission actually arrived.
func TestSanitizeClientCapturedAt(t *testing.T) {
	received := time.Date(2026, 7, 31, 12, 0, 0, 0, time.UTC)

	if got := sanitizeClientCapturedAt(time.Time{}, received); got != nil {
		t.Errorf("an omitted timestamp should stay nil, got %v", got)
	}
	if got := sanitizeClientCapturedAt(received.Add(time.Hour), received); got != nil {
		t.Errorf("a capture from the future should be discarded, got %v", got)
	}
	if got := sanitizeClientCapturedAt(received.Add(-72*time.Hour), received); got != nil {
		t.Errorf("a capture from days before arrival should be discarded, got %v", got)
	}
	// An ordinary offline sync is kept.
	plausible := received.Add(-2 * time.Hour)
	got := sanitizeClientCapturedAt(plausible, received)
	if got == nil || !got.Equal(plausible) {
		t.Errorf("a plausible offline capture should be recorded, got %v", got)
	}
	// Minor clock skew is tolerated rather than thrown away.
	skewed := received.Add(time.Minute)
	if got := sanitizeClientCapturedAt(skewed, received); got == nil {
		t.Error("a minute of clock skew should be tolerated")
	}
}
