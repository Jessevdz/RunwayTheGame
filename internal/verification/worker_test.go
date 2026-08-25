package verification_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/Jessevdz/RunwayTheGame/internal/api"
	"github.com/Jessevdz/RunwayTheGame/internal/db"
	"github.com/Jessevdz/RunwayTheGame/internal/eventstore"
	"github.com/Jessevdz/RunwayTheGame/internal/rules"
	"github.com/Jessevdz/RunwayTheGame/internal/testsupport"
	"github.com/Jessevdz/RunwayTheGame/internal/verification"
)

type mockBlobDownloader struct {
	MockData []byte
	MockErr  error
}

func (m *mockBlobDownloader) DownloadBlob(ctx context.Context, blobRef string) ([]byte, error) {
	if m.MockErr != nil {
		return nil, m.MockErr
	}
	return m.MockData, nil
}

type mockScalewayClient struct {
	MockResponse verification.ScalewayResponse
	MockErr      error
	CallCount    int
}

func (m *mockScalewayClient) VerifyImage(ctx context.Context, imgBytes []byte, prompt string, rubric rules.RubricDetail, secondPassObjection string) (verification.ScalewayResponse, error) {
	m.CallCount++
	if m.MockErr != nil {
		return verification.ScalewayResponse{}, m.MockErr
	}
	return m.MockResponse, nil
}

func getTestDB(t *testing.T) (*db.DB, context.Context) {
	return testsupport.DB(t, "verification")
}

func TestHeuristicsAccuracyAndVelocity(t *testing.T) {
	rubric := rules.RubricDetail{
		MustShow: []string{"statue"},
	}

	now := time.Now()

	// 1. High accuracy error (> 50m) should fail heuristics
	payloadBadAccuracy := verification.VerificationJobPayload{
		Prompt: "Observatory statue",
		Rubric: rubric,
		GPS: verification.GPSFix{
			Lat:       51.4800,
			Lon:       0.0000,
			AccuracyM: 60.0, // bad
			Timestamp: now,
		},
	}
	passed, rationale := verification.VerifyHeuristics(t.Context(), payloadBadAccuracy)
	if passed {
		t.Errorf("expected heuristics to fail on bad accuracy, but passed")
	}
	if rationale == "" {
		t.Errorf("expected rejection rationale on failed accuracy")
	}

	// 2. High velocity (> 50 m/s) should fail heuristics
	prevTime := now.Add(-30 * time.Second)
	payloadBadVelocity := verification.VerificationJobPayload{
		Prompt: "Observatory statue",
		Rubric: rubric,
		GPS: verification.GPSFix{
			Lat:       51.4800,
			Lon:       0.0000,
			AccuracyM: 10.0,
			Timestamp: now,
		},
		PreviousGPS: &verification.GPSFix{
			Lat:       51.5800, // ~11 km away, resulting in ~370 m/s velocity
			Lon:       0.0000,
			AccuracyM: 10.0,
			Timestamp: prevTime,
		},
	}
	passed, rationale = verification.VerifyHeuristics(t.Context(), payloadBadVelocity)
	if passed {
		t.Errorf("expected heuristics to fail on high velocity, but passed")
	}

	// 3. Normal GPS should pass heuristics
	payloadGood := verification.VerificationJobPayload{
		Prompt: "Observatory statue",
		Rubric: rubric,
		GPS: verification.GPSFix{
			Lat:       51.4800,
			Lon:       0.0000,
			AccuracyM: 10.0,
			Timestamp: now,
		},
		PreviousGPS: &verification.GPSFix{
			Lat:       51.4801, // ~11 meters away, ~0.36 m/s velocity
			Lon:       0.0000,
			AccuracyM: 10.0,
			Timestamp: prevTime,
		},
		Exif: &verification.ExifFix{Timestamp: &now},
	}
	passed, rationale = verification.VerifyHeuristics(t.Context(), payloadGood)
	if !passed {
		t.Errorf("expected good GPS to pass heuristics, failed: %s", rationale)
	}
}

// seedBoardAndChallenge inserts a minimal published board with start and finish waypoints.
func seedBoardAndChallenge(t *testing.T, ctx context.Context, database *db.DB, coinReward int) (string, string, string) {
	t.Helper()

	boardID := uuid.New().String()
	startID := uuid.New().String()
	finishID := uuid.New().String()
	roadID := uuid.New().String()
	challengeID := uuid.New().String()

	_, err := database.Pool.Exec(ctx, `
		INSERT INTO boards (id, version, name, published_at) VALUES ($1, 1, 'Worker Test Board', NOW())
	`, boardID)
	if err != nil {
		t.Fatalf("failed to seed board: %v", err)
	}

	_, err = database.Pool.Exec(ctx, `
		INSERT INTO board_waypoints (id, board_id, board_version, name, location, is_start, is_finish, arrival_radius_m, challenge_id) VALUES
		($1, $3, 1, 'Start', ST_SetSRID(ST_MakePoint(0.0, 0.0), 4326), true, false, 25, $4),
		($2, $3, 1, 'Finish', ST_SetSRID(ST_MakePoint(0.0, 0.01), 4326), false, true, 25, NULL)
	`, startID, finishID, boardID, challengeID)
	if err != nil {
		t.Fatalf("failed to seed waypoints: %v", err)
	}

	_, err = database.Pool.Exec(ctx, `
		INSERT INTO board_roads (id, board_id, board_version, waypoint_id_a, waypoint_id_b, length_m)
		VALUES ($1, $2, 1, $3, $4, 1000)
	`, roadID, boardID, startID, finishID)
	if err != nil {
		t.Fatalf("failed to seed road: %v", err)
	}

	_, err = database.Pool.Exec(ctx, `
		INSERT INTO challenges (id, board_id, board_version, waypoint_id, prompt, rubric, coin_reward, veto_penalty_seconds)
		VALUES ($1, $2, 1, $3, 'Observatory Statue', '{"must_show":["statue"]}', $4, 3600)
	`, challengeID, boardID, startID, coinReward)
	if err != nil {
		t.Fatalf("failed to seed challenge: %v", err)
	}

	return boardID, startID, challengeID
}

func TestWorkerVerificationLoop(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	defer database.Close()

	gameID := uuid.New().String()
	submissionID := uuid.New().String()
	jobID := uuid.New().String()
	teamID := uuid.New().String()

	boardID, roadID, challengeID := seedBoardAndChallenge(t, ctx, database, 20)

	// Clean up database records
	_, _ = database.Pool.Exec(ctx, "DELETE FROM challenge_submissions WHERE id = $1", submissionID)
	_, _ = database.Pool.Exec(ctx, "DELETE FROM events WHERE game_id = $1", gameID)
	_, _ = database.Pool.Exec(ctx, "DELETE FROM jobs WHERE id = $1", jobID)
	_, _ = database.Pool.Exec(ctx, "DELETE FROM games WHERE id = $1", gameID)
	// Clear pending verification jobs from other tests to ensure deterministic job pickup.
	_, _ = database.Pool.Exec(ctx, "DELETE FROM jobs WHERE job_type = 'verification' AND status = 'pending'")

	// The game row and the challenge submission are prerequisites the real
	// submission flow (POST /submission) would have already created; the
	// verdict endpoint looks the submission up by ID to know which team/road
	// it applies to.
	rulesetBytes, _ := json.Marshal(rules.DefaultRuleset())
	_, err := database.Pool.Exec(ctx, `
		INSERT INTO games (id, board_id, board_version, status, ruleset, starts_at, ends_at)
		VALUES ($1, $2, 1, 'live', $3, NOW(), NOW() + INTERVAL '2 hours')
	`, gameID, boardID, rulesetBytes)
	if err != nil {
		t.Fatalf("failed to insert game row: %v", err)
	}

	// Populate database event log with GameCreated to start sequence at 1
	evtPayload, _ := json.Marshal(eventstore.GameCreatedPayload{
		BoardID:  boardID,
		StartsAt: time.Now().UTC(),
		EndsAt:   time.Now().UTC().Add(1 * time.Hour),
	})
	events := []eventstore.Event{
		{GameID: gameID, Sequence: 1, Type: "GameCreated", Payload: string(evtPayload)},
	}
	err = eventstore.AppendEvents(ctx, database.Pool, gameID, 1, events)
	if err != nil {
		t.Fatalf("failed to insert initial game event: %v", err)
	}

	// Create verification job
	payload := verification.VerificationJobPayload{
		GameID:       gameID,
		SubmissionID: submissionID,
		WaypointID:   roadID,
		RoadID:       roadID,
		TeamID:       teamID,
		BlobRef:      "test-photo.jpg",
		Prompt:       "Observatory Statue",
		Rubric: rules.RubricDetail{
			MustShow: []string{"statue"},
		},
		GPS: verification.GPSFix{
			Lat:       51.4800,
			Lon:       0.0000,
			AccuracyM: 15.0,
			Timestamp: time.Now().UTC(),
		},
	}
	capturedAt := payload.GPS.Timestamp
	payload.Exif = &verification.ExifFix{Timestamp: &capturedAt}
	payloadBytes, _ := json.Marshal(payload)

	_, err = database.Pool.Exec(ctx, `
		INSERT INTO jobs (id, job_type, payload, status, attempts, max_attempts, run_at)
		VALUES ($1, 'verification', $2, 'pending', 0, 3, NOW())
	`, jobID, payloadBytes)
	if err != nil {
		t.Fatalf("failed to insert verification outbox job: %v", err)
	}

	_, err = database.Pool.Exec(ctx, `
		INSERT INTO challenge_submissions (id, game_id, team_id, road_id, challenge_id, blob_ref, idempotency_key)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
	`, submissionID, gameID, payload.TeamID, roadID, challengeID, payload.BlobRef, "idem-"+submissionID)
	if err != nil {
		t.Fatalf("failed to insert challenge submission: %v", err)
	}

	mockStore := &mockBlobDownloader{MockData: []byte("fake-jpeg-data")}
	mockLLM := &mockScalewayClient{
		MockResponse: verification.ScalewayResponse{
			Verdict:    "pass",
			Confidence: 0.95,
			Rationale:  "Looks like the observatory statue",
		},
	}

	// The worker submits verdicts through the REST API, running against an active server instance.
	apiServer := api.NewServer(database)
	// POST /verdict is closed unless the server and the worker share a secret.
	const workerToken = "test-worker-secret"
	apiServer.SetWorkerToken(workerToken)
	testServer := httptest.NewServer(apiServer.Router)
	defer testServer.Close()

	worker := verification.NewWorker(database, mockStore, mockLLM, testServer.URL, workerToken)

	// Run worker once
	processed, err := worker.ProcessNextJob(ctx)
	if err != nil {
		t.Fatalf("worker failed to process job: %v", err)
	}
	if !processed {
		t.Fatalf("expected worker to find and process the job")
	}

	// Verify job status in database is now completed
	var status string
	err = database.Pool.QueryRow(ctx, "SELECT status FROM jobs WHERE id = $1", jobID).Scan(&status)
	if err != nil {
		t.Fatalf("failed to fetch job status: %v", err)
	}
	if status != "completed" {
		t.Errorf("expected job status 'completed', got '%s'", status)
	}

	// Verify VerdictReturned, ChallengeCompleted, and CoinsChanged events were
	// appended to the stream — the same handler the API uses for a direct HTTP
	// verdict submission.
	stream, err := eventstore.GetEventStream(ctx, database.Pool, gameID, 0)
	if err != nil {
		t.Fatalf("failed to fetch event stream: %v", err)
	}

	if len(stream) != 4 {
		t.Fatalf("expected stream size 4 (GameCreated, VerdictReturned, ChallengeCompleted, CoinsChanged), got %d", len(stream))
	}

	verdictEvt := stream[1]
	if verdictEvt.Type != "VerdictReturned" {
		t.Errorf("expected event type 'VerdictReturned', got '%s'", verdictEvt.Type)
	}
	var vp eventstore.VerdictReturnedPayload
	_ = json.Unmarshal([]byte(verdictEvt.Payload), &vp)
	if vp.Verdict != "pass" {
		t.Errorf("expected verdict 'pass', got '%s'", vp.Verdict)
	}

	completedEvt := stream[2]
	if completedEvt.Type != "ChallengeCompleted" {
		t.Errorf("expected event type 'ChallengeCompleted', got '%s'", completedEvt.Type)
	}
	var cp eventstore.ChallengeCompletedPayload
	_ = json.Unmarshal([]byte(completedEvt.Payload), &cp)
	if cp.RoadID != roadID || cp.TeamID != teamID {
		t.Errorf("expected road %s completed by team %s, got road=%s team=%s", roadID, teamID, cp.RoadID, cp.TeamID)
	}
	if cp.CoinReward != 20 {
		t.Errorf("expected coin reward 20, got %d", cp.CoinReward)
	}

	coinsEvt := stream[3]
	if coinsEvt.Type != "CoinsChanged" {
		t.Errorf("expected event type 'CoinsChanged', got '%s'", coinsEvt.Type)
	}
}

func TestWorkerPollingFailureAndRetry(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	defer database.Close()

	gameID := uuid.New().String()
	submissionID := uuid.New().String()
	jobID := uuid.New().String()

	payload := verification.VerificationJobPayload{
		GameID:       gameID,
		SubmissionID: submissionID,
		RoadID:       uuid.New().String(),
		TeamID:       "red",
		BlobRef:      "test-photo.jpg",
		Prompt:       "Observatory Statue",
		GPS: verification.GPSFix{
			Lat:       51.4800,
			Lon:       0.0000,
			AccuracyM: 10.0,
			Timestamp: time.Now().UTC(),
		},
	}
	capturedAt := payload.GPS.Timestamp
	payload.Exif = &verification.ExifFix{Timestamp: &capturedAt}
	payloadBytes, _ := json.Marshal(payload)

	// Clear pending verification jobs from the queue to ensure deterministic job pickup.
	_, _ = database.Pool.Exec(ctx, "DELETE FROM jobs WHERE job_type = 'verification' AND status = 'pending'")

	_, err := database.Pool.Exec(ctx, `
		INSERT INTO jobs (id, job_type, payload, status, attempts, max_attempts, run_at)
		VALUES ($1, 'verification', $2, 'pending', 0, 3, NOW())
	`, jobID, payloadBytes)
	if err != nil {
		t.Fatalf("failed to insert job: %v", err)
	}

	mockStore := &mockBlobDownloader{MockData: []byte("fake-jpeg-data")}
	// Simulate LLM error
	mockLLM := &mockScalewayClient{
		MockErr: errors.New("Scaleway rate limit exceeded"),
	}
	// The LLM call fails before the worker ever reaches verdict submission, so no
	// API server is needed here — the base URL is never dialed.
	worker := verification.NewWorker(database, mockStore, mockLLM, "http://unused.invalid", "test-worker-secret")

	// Run worker once -> should retry
	processed, err := worker.ProcessNextJob(ctx)
	if err != nil {
		t.Fatalf("worker failed: %v", err)
	}
	if !processed {
		t.Fatalf("expected job to be processed")
	}

	var status string
	var attempts int
	err = database.Pool.QueryRow(ctx, "SELECT status, attempts FROM jobs WHERE id = $1", jobID).Scan(&status, &attempts)
	if err != nil {
		t.Fatalf("failed to fetch status: %v", err)
	}

	if status != "pending" {
		t.Errorf("expected status 'pending' (scheduled for retry), got '%s'", status)
	}
	if attempts != 1 {
		t.Errorf("expected attempts 1, got %d", attempts)
	}

	// Move run_at to past so it's polled again immediately, and exceed attempts
	_, _ = database.Pool.Exec(ctx, "UPDATE jobs SET run_at = NOW() - INTERVAL '1 minute', attempts = 2 WHERE id = $1", jobID)

	// Run worker again -> should reach max attempts and mark as failed
	processed, _ = worker.ProcessNextJob(ctx)

	err = database.Pool.QueryRow(ctx, "SELECT status, attempts FROM jobs WHERE id = $1", jobID).Scan(&status, &attempts)
	if err != nil {
		t.Fatalf("failed to fetch status: %v", err)
	}

	if status != "failed" {
		t.Errorf("expected status 'failed' after exceeding max attempts, got '%s'", status)
	}
}
