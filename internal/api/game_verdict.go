package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v4"

	"github.com/Jessevdz/RunwayTheGame/internal/commands"
	"github.com/Jessevdz/RunwayTheGame/internal/eventstore"
	"github.com/Jessevdz/RunwayTheGame/internal/rules"
)

// VerdictRequest defines the payload for submitting a submission verdict.
type VerdictRequest struct {
	SubmissionID string  `json:"submission_id"`
	Verdict      string  `json:"verdict"` // "pass" | "fail"
	Confidence   float64 `json:"confidence"`
	Rationale    string  `json:"rationale"`
}

// verdictResponse reports the result of a submission grading verdict.
type verdictResponse struct {
	Verdict         string `json:"verdict"`
	Status          string `json:"status"`
	Outcome         string `json:"outcome,omitempty"`
	ConflictMessage string `json:"conflict_message,omitempty"`
}

// verdictAck is the cached body a replayed verdict command returns.
type verdictAck struct {
	Verdict string `json:"verdict"`
}

// trustRationale defines the default rationale text recorded for trust-verification submissions.
const trustRationale = "Accepted on trust: this game grades no photos. Your evidence is stored for the group to look at."

// maxVerdictRationaleRunes defines the maximum character count for verdict rationale strings.
const maxVerdictRationaleRunes = 2000

// gradedSubmission contains target submission attributes when applying a grading verdict.
type gradedSubmission struct {
	ID               string
	TeamID           string
	RoadID           string
	ChallengeID      string
	Kind             string // "challenge" | "roadblock"
	ServerReceivedAt *time.Time
}

// verdictResult represents the outcome and potential conflict messages when applying a verdict.
type verdictResult struct {
	Outcome     string
	ConflictMsg string
}

// applyVerdict applies a submission verdict and updates game progress and coin balances within a transaction.
func (s *Server) applyVerdict(
	ctx context.Context,
	tx pgx.Tx,
	game *gameRecord,
	sub gradedSubmission,
	verdict string,
	confidence float64,
	rationale string,
	source string,
) ([]eventstore.Event, verdictResult, error) {
	var res verdictResult

	verdictPayload, _ := json.Marshal(eventstore.VerdictReturnedPayload{
		SubmissionID: sub.ID,
		Verdict:      verdict,
		Confidence:   confidence,
		Rationale:    rationale,
		MetricValue:  0.0,
		Source:       source,
	})
	events := []eventstore.Event{
		{Type: "VerdictReturned", Payload: string(verdictPayload)},
	}

	if verdict != "pass" {
		if _, err := tx.Exec(ctx, `UPDATE challenge_submissions SET status = 'fail' WHERE id = $1`, sub.ID); err != nil {
			return nil, res, fmt.Errorf("marking submission failed: %w", err)
		}
		res.Outcome = "failed"
		return events, res, nil
	}

	if _, err := tx.Exec(ctx, `UPDATE challenge_submissions SET status = 'pass' WHERE id = $1`, sub.ID); err != nil {
		return nil, res, fmt.Errorf("marking submission passed: %w", err)
	}

	if sub.Kind == "roadblock" {
		clearedBytes, _ := json.Marshal(eventstore.RoadblockClearedPayload{
			RoadID:       sub.RoadID,
			TeamID:       sub.TeamID,
			SubmissionID: sub.ID,
		})
		events = append(events, eventstore.Event{Type: "RoadblockCleared", Payload: string(clearedBytes)})
		res.Outcome = "roadblock_cleared"
		return events, res, nil
	}

	winner, msg, err := s.resolveRoadConflict(ctx, tx, game.ID, sub.RoadID, sub.TeamID, sub.ServerReceivedAt)
	if err != nil {
		return nil, res, err
	}

	var challengeReward int
	err = tx.QueryRow(ctx, `
		SELECT coin_reward FROM challenges
		WHERE (id::text = $1 OR waypoint_id::text = $1) AND board_id = $2 AND board_version = $3
		LIMIT 1
	`, sub.ChallengeID, game.BoardID, game.BoardVersion).Scan(&challengeReward)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, res, fmt.Errorf("reading challenge reward: %w", err)
	}
	if errors.Is(err, pgx.ErrNoRows) {
		lookupKey := sub.ChallengeID
		if lookupKey == "" {
			lookupKey = sub.RoadID
		}
		// Fall back to looking up challenge by road when not attached directly to a waypoint.
		err = tx.QueryRow(ctx, `
			SELECT c.coin_reward
			FROM challenges c
			JOIN board_roads s ON s.challenge_id = c.id
			WHERE (c.id::text = $1 OR c.waypoint_id::text = $1 OR s.id::text = $1) AND c.board_id = $2 AND c.board_version = $3
			LIMIT 1
		`, lookupKey, game.BoardID, game.BoardVersion).Scan(&challengeReward)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return nil, res, fmt.Errorf("reading challenge reward by road: %w", err)
		}
	}

	var priorPasses int
	if err := tx.QueryRow(ctx, `
		SELECT COUNT(*) FROM challenge_submissions
		WHERE game_id = $1 AND road_id = $2 AND team_id = $3
		  AND status = 'pass' AND kind = 'challenge' AND id <> $4
	`, game.ID, sub.RoadID, sub.TeamID, sub.ID).Scan(&priorPasses); err != nil {
		return nil, res, fmt.Errorf("counting prior passes: %w", err)
	}
	repeat := priorPasses > 0

	firstCompleter := winner == sub.TeamID && !repeat
	coinReward := 0
	if !repeat {
		_, coinReward = rules.ChallengeOutcome(game.Ruleset, true, challengeReward, firstCompleter)
	}

	if repeat {
		res.Outcome = "already_completed"
	} else if firstCompleter {
		if _, err := tx.Exec(ctx, `
			INSERT INTO road_progress (game_id, road_id, completed_by, completed_at)
			VALUES ($1, $2, $3, NOW())
			ON CONFLICT (game_id, road_id) DO UPDATE SET completed_by = EXCLUDED.completed_by
		`, game.ID, sub.RoadID, sub.TeamID); err != nil {
			return nil, res, fmt.Errorf("recording road progress: %w", err)
		}
		res.Outcome = "completed"
	} else {
		res.ConflictMsg = msg
		conflictBytes, _ := json.Marshal(eventstore.ChallengeConflictNotedPayload{
			RoadID:  sub.RoadID,
			TeamID:  sub.TeamID,
			Message: msg,
		})
		events = append(events, eventstore.Event{Type: "ChallengeConflictNoted", Payload: string(conflictBytes)})
		res.Outcome = "conflict_lost"
	}

	completeBytes, _ := json.Marshal(eventstore.ChallengeCompletedPayload{
		RoadID:         sub.RoadID,
		ChallengeID:    sub.ChallengeID,
		TeamID:         sub.TeamID,
		CoinReward:     coinReward,
		FirstCompleter: firstCompleter,
	})
	events = append(events, eventstore.Event{Type: "ChallengeCompleted", Payload: string(completeBytes)})

	if coinReward > 0 {
		var newBalance int
		if err := tx.QueryRow(ctx, `
			INSERT INTO team_coins (game_id, team_id, balance)
			VALUES ($1, $2, $3)
			ON CONFLICT (game_id, team_id)
			DO UPDATE SET balance = team_coins.balance + EXCLUDED.balance
			RETURNING balance
		`, game.ID, sub.TeamID, coinReward).Scan(&newBalance); err != nil {
			return nil, res, fmt.Errorf("crediting challenge reward: %w", err)
		}

		coinsBytes, _ := json.Marshal(eventstore.CoinsChangedPayload{
			TeamID:       sub.TeamID,
			Delta:        coinReward,
			BalanceAfter: newBalance,
			Reason:       "challenge_complete",
		})
		events = append(events, eventstore.Event{Type: "CoinsChanged", Payload: string(coinsBytes)})
	}

	return events, res, nil
}

// loadGradedSubmission loads a submission record scoped to the target game.
func (s *Server) loadGradedSubmission(ctx context.Context, gameID, submissionID string) (gradedSubmission, string, error) {
	var sub gradedSubmission
	var status string
	sub.ID = submissionID
	err := s.DB.Pool.QueryRow(ctx, `
		SELECT team_id, road_id, challenge_id, COALESCE(kind, 'challenge'), status, server_received_at
		FROM challenge_submissions WHERE id = $1 AND game_id = $2
	`, submissionID, gameID).Scan(&sub.TeamID, &sub.RoadID, &sub.ChallengeID, &sub.Kind, &status, &sub.ServerReceivedAt)
	return sub, status, err
}

// handleVerdict processes HTTP requests to record manual or automated submission grading verdicts.
func (s *Server) handleVerdict(w http.ResponseWriter, r *http.Request) {
	gameID := chi.URLParam(r, "game_id")

	var req VerdictRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(r.Context(), w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.SubmissionID == "" || (req.Verdict != "pass" && req.Verdict != "fail") {
		writeError(r.Context(), w, http.StatusBadRequest, "submission_id and verdict are required")
		return
	}

	game, err := s.loadGame(r.Context(), gameID)
	if err != nil {
		writeError(r.Context(), w, http.StatusNotFound, "game not found")
		return
	}

	author := verdictAuthorFrom(r.Context())

	if author == verdictAuthorWorker && game.Ruleset.Verification != rules.VerificationLLM {
		writeError(r.Context(), w, http.StatusConflict, "this game is not graded by the verification worker")
		return
	}
	if author == verdictAuthorHost && game.Ruleset.Verification != rules.VerificationHost {
		writeError(r.Context(), w, http.StatusConflict, "this game is not graded by its host")
		return
	}

	sub, status, err := s.loadGradedSubmission(r.Context(), gameID, req.SubmissionID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(r.Context(), w, http.StatusNotFound, "submission not found")
			return
		}
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to load submission: "+err.Error())
		return
	}
	if author == verdictAuthorHost && status != "pending" {
		writeError(r.Context(), w, http.StatusConflict, "this submission has already been graded")
		return
	}

	source := rules.VerificationLLM
	if author == verdictAuthorHost {
		source = rules.VerificationHost
	}
	rationale := strings.TrimSpace(req.Rationale)
	if len([]rune(rationale)) > maxVerdictRationaleRunes {
		rationale = string([]rune(rationale)[:maxVerdictRationaleRunes])
	}

	verdictPayload, _ := json.Marshal(eventstore.VerdictReturnedPayload{
		SubmissionID: req.SubmissionID,
		Verdict:      req.Verdict,
		Confidence:   req.Confidence,
		Rationale:    rationale,
		Source:       source,
	})

	expectedSeq, err := s.nextSequence(r.Context(), gameID)
	if err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to resolve sequence")
		return
	}
	cmdReq := commands.CommandRequest{
		GameID:         gameID,
		CommandType:    "VerdictReturned",
		ExpectedSeq:    expectedSeq,
		IdempotencyKey: "verdict-" + req.SubmissionID,
		Payload:        verdictPayload,
	}

	var applied verdictResult

	_, err = s.CmdProcessor.Process(r.Context(), cmdReq, func(ctx context.Context, tx pgx.Tx, cr commands.CommandRequest) (*commands.CommandResult, error) {
		events, res, err := s.applyVerdict(ctx, tx, game, sub, req.Verdict, req.Confidence, rationale, source)
		if err != nil {
			return nil, err
		}
		applied = res
		return &commands.CommandResult{
			ResponseCode: http.StatusOK,
			ResponseBody: verdictAck{Verdict: req.Verdict},
			Events:       events,
		}, nil
	})
	if err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to apply verdict: "+err.Error())
		return
	}

	writeJSON(r.Context(), w, http.StatusOK, verdictResponse{
		Verdict:         req.Verdict,
		Status:          "applied",
		Outcome:         applied.Outcome,
		ConflictMessage: applied.ConflictMsg,
	})
}

// resolveRoadConflict determines first-completer ownership for concurrent road submissions.
func (s *Server) resolveRoadConflict(ctx context.Context, tx pgx.Tx, gameID, roadID, requestingTeamID string, requestingReceivedAt *time.Time) (string, string, error) {
	var existingTeamID string
	var existingTeamName string
	var existingReceivedAt time.Time
	// Filter for challenge submissions to ignore concurrent roadblock clearances.
	err := tx.QueryRow(ctx, `
		SELECT s.team_id, COALESCE(t.name, ''), s.server_received_at
		FROM challenge_submissions s
		LEFT JOIN game_teams t ON t.id = s.team_id
		WHERE s.game_id = $1 AND s.road_id = $2 AND s.status = 'pass' AND s.kind = 'challenge'
		ORDER BY s.server_received_at ASC
		LIMIT 1
	`, gameID, roadID).Scan(&existingTeamID, &existingTeamName, &existingReceivedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return requestingTeamID, "", nil
		}
		return "", "", err
	}

	if existingTeamID == requestingTeamID {
		return requestingTeamID, "", nil
	}

	if requestingReceivedAt == nil {
		return existingTeamID, "road was already completed by another team", nil
	}

	if requestingReceivedAt.Before(existingReceivedAt) {
		if _, err := tx.Exec(ctx, `
			UPDATE challenge_submissions SET status = 'fail'
			WHERE game_id = $1 AND road_id = $2 AND team_id = $3 AND status = 'pass' AND kind = 'challenge'
		`, gameID, roadID, existingTeamID); err != nil {
			return "", "", err
		}
		return requestingTeamID, "", nil
	}

	delta := requestingReceivedAt.Sub(existingReceivedAt)
	if existingTeamName == "" {
		existingTeamName = "another team"
	}
	msg := "road already completed by team " + existingTeamName + " (by " + delta.Round(time.Second).String() + ")"
	return existingTeamID, msg, nil
}
