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
	"github.com/Jessevdz/RunwayTheGame/internal/projections"
	"github.com/Jessevdz/RunwayTheGame/internal/rules"
)

// VerdictRequest defines the payload for submitting a submission verdict.
type VerdictRequest struct {
	SubmissionID string   `json:"submission_id"`
	Verdict      string   `json:"verdict"` // "pass" | "fail"
	Confidence   float64  `json:"confidence"`
	Rationale    string   `json:"rationale"`
	MetricValue  *float64 `json:"metric_value,omitempty"`
	RegradeKey   string   `json:"regrade_key,omitempty"`
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
	WaypointID       string
	ChallengeID      string
	Kind             string // "challenge" | "roadblock"
	ServerReceivedAt *time.Time
}

// verdictResult represents the outcome and potential conflict messages when applying a verdict.
type verdictResult struct {
	Outcome     string
	ConflictMsg string
}

type displacedRoadPass struct {
	SubmissionID string
	TeamID       string
	ChallengeID  string
	WaypointID   string
	CoinReward   int
}

// challengeEventTarget keeps a challenge's active waypoint separate from its
// target road. Legacy waypoint events stored the waypoint ID in RoadID only.
func challengeEventTarget(waypointID, targetID string) (string, string) {
	if waypointID == "" {
		return targetID, ""
	}
	if waypointID == targetID {
		return waypointID, ""
	}
	return waypointID, targetID
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
	metricValue *float64,
) ([]eventstore.Event, verdictResult, error) {
	var res verdictResult

	verdictPayload, _ := json.Marshal(eventstore.VerdictReturnedPayload{
		SubmissionID: sub.ID,
		Verdict:      verdict,
		Confidence:   confidence,
		Rationale:    rationale,
		MetricValue:  metricValue,
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

	winner, msg, displaced, err := s.resolveRoadConflict(ctx, tx, game.ID, sub.RoadID, sub.TeamID, sub.ServerReceivedAt)
	if err != nil {
		return nil, res, err
	}
	for _, prior := range displaced {
		tag, err := tx.Exec(ctx, `
			UPDATE challenge_submissions SET status = 'fail'
			WHERE id = $1 AND game_id = $2 AND status = 'pass' AND kind = 'challenge'
		`, prior.SubmissionID, game.ID)
		if err != nil {
			return nil, res, fmt.Errorf("withdrawing displaced road submission: %w", err)
		}
		if tag.RowsAffected() != 1 {
			return nil, res, fmt.Errorf("displaced road submission %s changed during verdict", prior.SubmissionID)
		}

		verdictBytes, _ := json.Marshal(eventstore.VerdictReturnedPayload{
			SubmissionID: prior.SubmissionID,
			Verdict:      "fail",
			Confidence:   1,
			Rationale:    "A team with an earlier received passing submission completed this road first.",
			Source:       "system",
		})
		waypointID, roadID := challengeEventTarget(prior.WaypointID, sub.RoadID)
		revokedBytes, _ := json.Marshal(eventstore.ChallengeRevokedPayload{
			SubmissionID: prior.SubmissionID,
			TeamID:       prior.TeamID,
			WaypointID:   waypointID,
			RoadID:       roadID,
			ChallengeID:  prior.ChallengeID,
			CoinReward:   prior.CoinReward,
			RevokeClear:  true,
		})
		events = append(events,
			eventstore.Event{Type: "VerdictReturned", Payload: string(verdictBytes)},
			eventstore.Event{Type: "ChallengeRevoked", Payload: string(revokedBytes)},
		)
		if prior.CoinReward > 0 {
			var newBalance int
			if err := tx.QueryRow(ctx, `
				UPDATE team_coins SET balance = balance - $3
				WHERE game_id = $1 AND team_id = $2
				RETURNING balance
			`, game.ID, prior.TeamID, prior.CoinReward).Scan(&newBalance); err != nil {
				return nil, res, fmt.Errorf("withdrawing displaced road award: %w", err)
			}
			coinsBytes, _ := json.Marshal(eventstore.CoinsChangedPayload{
				TeamID:       prior.TeamID,
				Delta:        -prior.CoinReward,
				BalanceAfter: newBalance,
				Reason:       "road_first_completer_corrected",
				Source:       "system",
			})
			events = append(events, eventstore.Event{Type: "CoinsChanged", Payload: string(coinsBytes)})
		}
	}

	var challengeReward int
	err = pgx.ErrNoRows
	if sub.ChallengeID != "" {
		err = tx.QueryRow(ctx, `
		SELECT coin_reward FROM challenges
		WHERE id::text = $1 AND board_id = $2 AND board_version = $3
	`, sub.ChallengeID, game.BoardID, game.BoardVersion).Scan(&challengeReward)
	}
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, res, fmt.Errorf("reading challenge reward: %w", err)
	}
	if errors.Is(err, pgx.ErrNoRows) {
		isRoadTarget := sub.WaypointID != "" && sub.RoadID != "" && sub.WaypointID != sub.RoadID
		if isRoadTarget {
			err = tx.QueryRow(ctx, `
				SELECT c.coin_reward
				FROM challenges c
				JOIN board_roads road ON road.challenge_id = c.id
				WHERE road.id::text = $1 AND c.board_id = $2 AND c.board_version = $3
				  AND road.board_id = c.board_id AND road.board_version = c.board_version
			`, sub.RoadID, game.BoardID, game.BoardVersion).Scan(&challengeReward)
		} else {
			waypointID := sub.WaypointID
			if waypointID == "" {
				waypointID = sub.RoadID
			}
			if waypointID != "" {
				err = tx.QueryRow(ctx, `
					SELECT coin_reward FROM challenges
					WHERE waypoint_id::text = $1 AND board_id = $2 AND board_version = $3
				`, waypointID, game.BoardID, game.BoardVersion).Scan(&challengeReward)
			} else {
				err = pgx.ErrNoRows
			}
		}
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return nil, res, fmt.Errorf("reading challenge reward by target: %w", err)
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

	waypointID, roadID := challengeEventTarget(sub.WaypointID, sub.RoadID)
	completeBytes, _ := json.Marshal(eventstore.ChallengeCompletedPayload{
		WaypointID:     waypointID,
		RoadID:         roadID,
		ChallengeID:    sub.ChallengeID,
		TeamID:         sub.TeamID,
		CoinReward:     coinReward,
		FirstCompleter: firstCompleter,
		MetricValue:    metricValue,
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
		SELECT team_id, road_id, COALESCE(waypoint_id::text, ''), challenge_id, COALESCE(kind, 'challenge'), status, server_received_at
		FROM challenge_submissions WHERE id = $1 AND game_id = $2
	`, submissionID, gameID).Scan(&sub.TeamID, &sub.RoadID, &sub.WaypointID, &sub.ChallengeID, &sub.Kind, &status, &sub.ServerReceivedAt)
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
	proj, err := projections.RebuildProjection(r.Context(), s.DB.Pool, gameID, 0)
	if err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to load game state")
		return
	}

	author := verdictAuthorFrom(r.Context())

	if author == verdictAuthorWorker && game.Ruleset.Verification != rules.VerificationLLM {
		writeError(r.Context(), w, http.StatusConflict, "this game is not graded by the verification worker")
		return
	}
	if author == verdictAuthorHost && game.Ruleset.Verification != rules.VerificationHost && game.Ruleset.Verification != rules.VerificationLLM {
		writeError(r.Context(), w, http.StatusConflict, "this game does not allow host review")
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
	metricValue := req.MetricValue
	if author != verdictAuthorWorker {
		metricValue = nil
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
		MetricValue:  metricValue,
		Source:       source,
	})

	expectedSeq := proj.LastSequence + 1
	idempotencyKey := "verdict-" + req.SubmissionID
	if author == verdictAuthorWorker && req.RegradeKey != "" {
		idempotencyKey += "-regrade-" + req.RegradeKey
	}
	cmdReq := commands.CommandRequest{
		GameID:             gameID,
		CommandType:        "VerdictReturned",
		PrincipalID:        string(author),
		IdempotencyPayload: idempotencyPayload(req),
		ExpectedSeq:        expectedSeq,
		IdempotencyKey:     idempotencyKey,
		Payload:            verdictPayload,
	}

	response, err := s.CmdProcessor.Process(r.Context(), cmdReq, func(ctx context.Context, tx pgx.Tx, cr commands.CommandRequest) (*commands.CommandResult, error) {
		if err := guardLiveGameMutation(ctx, tx, gameID, proj); err != nil {
			return nil, err
		}
		events, res, err := s.applyVerdict(ctx, tx, game, sub, req.Verdict, req.Confidence, rationale, source, metricValue)
		if err != nil {
			return nil, err
		}
		return &commands.CommandResult{
			ResponseCode: http.StatusOK,
			ResponseBody: verdictResponse{
				Verdict: req.Verdict, Status: "applied", Outcome: res.Outcome,
				ConflictMessage: res.ConflictMsg,
			},
			Events: events,
		}, nil
	})
	if err != nil {
		if writeGameMutationGuardError(r.Context(), w, err) {
			return
		}
		if writeConcurrencyConflict(r.Context(), w, err) {
			return
		}
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to apply verdict: "+err.Error())
		return
	}

	writeCommandResponse(r.Context(), w, response)
}

// resolveRoadConflict determines first-completer ownership for concurrent road submissions.
func (s *Server) resolveRoadConflict(ctx context.Context, tx pgx.Tx, gameID, roadID, requestingTeamID string, requestingReceivedAt *time.Time) (string, string, []displacedRoadPass, error) {
	var existingTeamID string
	var existingTeamName string
	var existingReceivedAt time.Time
	var displaced []displacedRoadPass
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
			return requestingTeamID, "", nil, nil
		}
		return "", "", nil, err
	}

	if existingTeamID == requestingTeamID {
		return requestingTeamID, "", nil, nil
	}

	if requestingReceivedAt == nil {
		return existingTeamID, "road was already completed by another team", nil, nil
	}

	if requestingReceivedAt.Before(existingReceivedAt) {
		rows, err := tx.Query(ctx, `
			SELECT s.id::text, s.team_id::text, s.challenge_id::text, COALESCE(s.waypoint_id::text, '')
			FROM challenge_submissions s
			WHERE s.game_id = $1 AND s.road_id = $2 AND s.server_received_at > $3
			  AND s.team_id <> $4 AND s.status = 'pass' AND s.kind = 'challenge'
			ORDER BY s.server_received_at, s.id
		`, gameID, roadID, requestingReceivedAt, requestingTeamID)
		if err != nil {
			return "", "", nil, err
		}
		var candidates []displacedRoadPass
		for rows.Next() {
			var pass displacedRoadPass
			if err := rows.Scan(&pass.SubmissionID, &pass.TeamID, &pass.ChallengeID, &pass.WaypointID); err != nil {
				rows.Close()
				return "", "", nil, err
			}
			candidates = append(candidates, pass)
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return "", "", nil, err
		}
		rows.Close()
		for _, pass := range candidates {
			if err := tx.QueryRow(ctx, `
				SELECT COALESCE((
					SELECT (completion.payload->>'coin_reward')::integer
					FROM events verdict
					JOIN LATERAL (
						SELECT e.payload
						FROM events e
						WHERE e.game_id = verdict.game_id AND e.sequence > verdict.sequence
						  AND e.event_type = 'ChallengeCompleted'
						  AND (e.payload->>'road_id' = $2 OR e.payload->>'waypoint_id' = $2)
						  AND e.payload->>'team_id' = $3
						ORDER BY e.sequence LIMIT 1
					) completion ON TRUE
					WHERE verdict.game_id = $1 AND verdict.event_type = 'VerdictReturned'
					  AND verdict.payload->>'submission_id' = $4
					  AND verdict.payload->>'verdict' = 'pass'
					ORDER BY verdict.sequence DESC LIMIT 1
				), 0)
			`, gameID, roadID, pass.TeamID, pass.SubmissionID).Scan(&pass.CoinReward); err != nil {
				return "", "", nil, fmt.Errorf("reading displaced road award: %w", err)
			}
			displaced = append(displaced, pass)
		}
		return requestingTeamID, "", displaced, nil
	}

	delta := requestingReceivedAt.Sub(existingReceivedAt)
	if existingTeamName == "" {
		existingTeamName = "another team"
	}
	msg := "road already completed by team " + existingTeamName + " (by " + delta.Round(time.Second).String() + ")"
	return existingTeamID, msg, nil, nil
}
