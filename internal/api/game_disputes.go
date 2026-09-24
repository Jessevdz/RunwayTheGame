package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v4"

	"github.com/Jessevdz/RunwayTheGame/internal/commands"
	"github.com/Jessevdz/RunwayTheGame/internal/eventstore"
	"github.com/Jessevdz/RunwayTheGame/internal/projections"
	"github.com/Jessevdz/RunwayTheGame/internal/rules"
)

// DisputeRaiseRequest defines the payload for raising a verdict dispute.
type DisputeRaiseRequest struct {
	VerdictID string `json:"verdict_id"`
	Objection string `json:"objection"`
}

// DisputeResolveRequest defines the payload for resolving a verdict dispute.
type DisputeResolveRequest struct {
	VerdictID string `json:"verdict_id"`
	Outcome   string `json:"outcome"` // upheld | overturned
}

// maxObjectionChars defines the maximum allowed character count for dispute objection text.
const maxObjectionChars = 1000

var errDisputeNotPending = errors.New("dispute is no longer pending")
var errDisputeSubmissionChanged = errors.New("disputed submission status changed")

// handleDisputeRaise processes HTTP requests from teams disputing a rejected challenge verdict.
func (s *Server) handleDisputeRaise(w http.ResponseWriter, r *http.Request) {
	gameID := chi.URLParam(r, "game_id")

	var req DisputeRaiseRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(r.Context(), w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.VerdictID == "" || req.Objection == "" {
		writeError(r.Context(), w, http.StatusBadRequest, "verdict_id and objection are required")
		return
	}
	// Validate objection length to ensure concise prompt inputs during re-grading.
	if len([]rune(req.Objection)) > maxObjectionChars {
		writeError(r.Context(), w, http.StatusBadRequest, "objection is too long: keep it to a short explanation of what the photo shows")
		return
	}

	game, team, ok := s.requireTeam(w, r, gameID)
	if !ok {
		return
	}
	if game.Status != "live" {
		writeError(r.Context(), w, http.StatusForbidden, "game is not live")
		return
	}
	// Verify game verification mode allows disputes.
	if game.Ruleset.Verification == rules.VerificationTrust {
		writeError(r.Context(), w, http.StatusForbidden, "this game grades no photos, so there is no verdict to dispute")
		return
	}
	proj, err := projections.RebuildProjection(r.Context(), s.DB.Pool, gameID, 0)
	if err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to load game state")
		return
	}

	// Fetch the most recent verdict to verify dispute eligibility and extract confidence metrics.
	var eventCreatedAt time.Time
	var priorVerdict string
	var priorConfidence float64
	err = s.DB.Pool.QueryRow(r.Context(), `
		SELECT created_at,
		       COALESCE(payload->>'verdict', ''),
		       COALESCE((payload->>'confidence')::float8, 0)
		FROM events
		WHERE game_id = $1 AND event_type = 'VerdictReturned' AND payload->>'submission_id' = $2
		ORDER BY sequence DESC
		LIMIT 1
	`, gameID, req.VerdictID).Scan(&eventCreatedAt, &priorVerdict, &priorConfidence)
	if err != nil {
		writeError(r.Context(), w, http.StatusNotFound, "verdict not found: "+err.Error())
		return
	}

	if time.Now().UTC().Sub(eventCreatedAt) > 15*time.Minute {
		writeError(r.Context(), w, http.StatusForbidden, "dispute window has closed")
		return
	}

	// Ensure prior verdict was a failure.
	if priorVerdict != "fail" {
		writeError(r.Context(), w, http.StatusConflict, "this submission was not rejected, so there is nothing to dispute")
		return
	}

	// Ensure submission has not already been disputed.
	var alreadyDisputed bool
	if err := s.DB.Pool.QueryRow(r.Context(), `
		SELECT EXISTS(
			SELECT 1 FROM events
			WHERE game_id = $1 AND event_type = 'DisputeRaised' AND payload->>'verdict_id' = $2
		)
	`, gameID, req.VerdictID).Scan(&alreadyDisputed); err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to check for an earlier dispute: "+err.Error())
		return
	}
	if alreadyDisputed {
		writeError(r.Context(), w, http.StatusConflict, "this submission has already been disputed once — a host decides from here")
		return
	}

	// Verify submission belongs to requesting team and game.
	var roadID, challengeID, blobRef string
	var subLat, subLon, subAccuracyM *float64
	var subCapturedAt *time.Time
	err = s.DB.Pool.QueryRow(r.Context(), `
		SELECT road_id, challenge_id, blob_ref, lat, lon, accuracy_m, client_captured_at
		FROM challenge_submissions
		WHERE id = $1 AND game_id = $2 AND team_id = $3
	`, req.VerdictID, gameID, team.ID).Scan(&roadID, &challengeID, &blobRef, &subLat, &subLon, &subAccuracyM, &subCapturedAt)
	if err != nil {
		writeError(r.Context(), w, http.StatusNotFound, "associated submission not found")
		return
	}

	var prompt, rubricJSON string
	err = s.DB.Pool.QueryRow(r.Context(), `
		SELECT prompt, rubric::text FROM challenges
		WHERE id = $1 AND board_id = $2 AND board_version = $3
	`, challengeID, game.BoardID, game.BoardVersion).Scan(&prompt, &rubricJSON)
	if err != nil {
		writeError(r.Context(), w, http.StatusNotFound, "challenge not found")
		return
	}

	payloadBytes, _ := json.Marshal(eventstore.DisputeRaisedPayload{
		VerdictID: req.VerdictID,
		ByTeamID:  team.ID,
		Objection: req.Objection,
	})

	verifyPayload := map[string]interface{}{
		"submission_id": req.VerdictID,
		"game_id":       gameID,
		"team_id":       team.ID,
		"road_id":       roadID,
		"challenge_id":  challengeID,
		"blob_ref":      blobRef,
		"prompt":        prompt,
		"rubric":        json.RawMessage(rubricJSON),
		"second_pass":   req.Objection,
		// Pass previous verdict state to inform downstream re-grading analysis.
		"prior_verdict":    priorVerdict,
		"prior_confidence": priorConfidence,
		"regrade_key":      uuid.NewString(),
	}
	// Include the original submission GPS coordinates if present.
	if subLat != nil && subLon != nil {
		accuracy := 0.0
		if subAccuracyM != nil {
			accuracy = *subAccuracyM
		}
		verifyPayload["gps"] = map[string]interface{}{
			"lat":        *subLat,
			"lon":        *subLon,
			"accuracy_m": accuracy,
			"timestamp":  eventCreatedAt,
		}
	}
	// Carry the original capture timestamp so the recency gate can run on a re-grade.
	if subCapturedAt != nil {
		verifyPayload["exif"] = map[string]interface{}{
			"timestamp": subCapturedAt,
		}
	}

	expectedSeq := proj.LastSequence + 1

	cmdReq := commands.CommandRequest{
		GameID:      gameID,
		CommandType: "DisputeRaised",
		ExpectedSeq: expectedSeq,
		Payload:     payloadBytes,
	}

	_, err = s.CmdProcessor.Process(r.Context(), cmdReq, func(ctx context.Context, tx pgx.Tx, cr commands.CommandRequest) (*commands.CommandResult, error) {
		if err := guardLiveGameMutation(ctx, tx, gameID, proj); err != nil {
			return nil, err
		}
		result := &commands.CommandResult{
			ResponseCode: http.StatusCreated,
			ResponseBody: statusResponse{Status: "disputed"},
			Events: []eventstore.Event{
				{Type: "DisputeRaised", Payload: string(cr.Payload)},
			},
		}
		// Queue verification job for LLM verification mode.
		if game.Ruleset.Verification == rules.VerificationLLM {
			result.Jobs = []commands.JobOutboxEntry{
				{Type: "verification", Payload: verifyPayload},
			}
		}
		return result, nil
	})
	if err != nil {
		if writeGameMutationGuardError(r.Context(), w, err) {
			return
		}
		if writeConcurrencyConflict(r.Context(), w, err) {
			return
		}
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to raise dispute: "+err.Error())
		return
	}

	writeJSON(r.Context(), w, http.StatusCreated, statusResponse{Status: "disputed"})
}

// handleDisputeResolve processes HTTP requests from game masters resolving active disputes.
func (s *Server) handleDisputeResolve(w http.ResponseWriter, r *http.Request) {
	gameID := chi.URLParam(r, "game_id")

	var req DisputeResolveRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(r.Context(), w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.VerdictID == "" || (req.Outcome != "upheld" && req.Outcome != "overturned") {
		writeError(r.Context(), w, http.StatusBadRequest, "verdict_id and outcome ('upheld' or 'overturned') are required")
		return
	}

	game, err := s.loadGame(r.Context(), gameID)
	if err != nil {
		writeError(r.Context(), w, http.StatusNotFound, err.Error())
		return
	}

	proj, err := projections.RebuildProjection(r.Context(), s.DB.Pool, gameID, 0)
	if err != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to load game state")
		return
	}

	dispute, exists := proj.Disputes[req.VerdictID]
	if !exists || dispute.Status != "pending" {
		writeError(r.Context(), w, http.StatusNotFound, "no active dispute for this verdict")
		return
	}

	expectedSeq := proj.LastSequence + 1

	payloadBytes, _ := json.Marshal(eventstore.DisputeResolvedPayload{
		VerdictID: req.VerdictID,
		Outcome:   req.Outcome,
		Source:    "gm",
	})

	cmdReq := commands.CommandRequest{
		GameID:      gameID,
		CommandType: "DisputeResolved",
		ExpectedSeq: expectedSeq,
		Payload:     payloadBytes,
	}

	_, err = s.CmdProcessor.Process(r.Context(), cmdReq, func(ctx context.Context, tx pgx.Tx, cr commands.CommandRequest) (*commands.CommandResult, error) {
		if err := guardLiveGameMutation(ctx, tx, gameID, proj); err != nil {
			return nil, err
		}
		var pending bool
		if err := tx.QueryRow(ctx, `
			SELECT EXISTS (
				SELECT 1 FROM events raised
				WHERE raised.game_id = $1 AND raised.event_type = 'DisputeRaised'
				  AND raised.payload->>'verdict_id' = $2
				  AND NOT EXISTS (
					SELECT 1 FROM events resolved
					WHERE resolved.game_id = raised.game_id AND resolved.event_type = 'DisputeResolved'
					  AND resolved.payload->>'verdict_id' = $2
				  )
			)
		`, gameID, req.VerdictID).Scan(&pending); err != nil {
			return nil, fmt.Errorf("checking dispute status: %w", err)
		}
		if !pending {
			return nil, errDisputeNotPending
		}

		events := []eventstore.Event{}
		if req.Outcome == "upheld" {
			var originalStatus, roadID, waypointID, teamID, challengeID, kind string
			if err := tx.QueryRow(ctx, `
				SELECT status, road_id::text, COALESCE(waypoint_id::text, ''), team_id::text, challenge_id::text, kind
				FROM challenge_submissions
				WHERE id = $1 AND game_id = $2
				FOR UPDATE
			`, req.VerdictID, gameID).Scan(&originalStatus, &roadID, &waypointID, &teamID, &challengeID, &kind); err != nil {
				return nil, err
			}
			completionWaypointID, completionRoadID := challengeEventTarget(waypointID, roadID)

			switch originalStatus {
			case "fail":
				var challengeReward int
				if err := tx.QueryRow(ctx, `
					SELECT coin_reward FROM challenges
					WHERE id = $1 AND board_id = $2 AND board_version = $3
				`, challengeID, game.BoardID, game.BoardVersion).Scan(&challengeReward); err != nil {
					return nil, fmt.Errorf("reading disputed challenge reward: %w", err)
				}

				var priorPasses int
				if err := tx.QueryRow(ctx, `
					SELECT COUNT(*) FROM challenge_submissions
					WHERE game_id = $1 AND road_id = $2 AND team_id = $3 AND id <> $4
					  AND status = 'pass' AND kind = 'challenge'
				`, gameID, roadID, teamID, req.VerdictID).Scan(&priorPasses); err != nil {
					return nil, fmt.Errorf("checking prior challenge completions: %w", err)
				}
				var completedBy *string
				if err := tx.QueryRow(ctx, `SELECT completed_by::text FROM road_progress WHERE game_id = $1 AND road_id = $2`, gameID, roadID).Scan(&completedBy); err != nil && !errors.Is(err, pgx.ErrNoRows) {
					return nil, fmt.Errorf("checking current road owner: %w", err)
				}
				firstCompleter := priorPasses == 0 && (completedBy == nil || *completedBy == "")
				coinReward := 0
				if priorPasses == 0 {
					_, coinReward = rules.ChallengeOutcome(game.Ruleset, true, challengeReward, firstCompleter)
				}

				verdictBytes, _ := json.Marshal(eventstore.VerdictReturnedPayload{
					SubmissionID: req.VerdictID, Verdict: "pass", Confidence: 1,
					Rationale: "Host upheld the dispute.", Source: "gm",
				})
				completedBytes, _ := json.Marshal(eventstore.ChallengeCompletedPayload{
					WaypointID: completionWaypointID, RoadID: completionRoadID,
					ChallengeID: challengeID, TeamID: teamID,
					CoinReward: coinReward, FirstCompleter: firstCompleter, Source: "dispute",
				})
				events = append(events,
					eventstore.Event{Type: "VerdictReturned", Payload: string(verdictBytes)},
					eventstore.Event{Type: "ChallengeCompleted", Payload: string(completedBytes)},
				)
				tag, err := tx.Exec(ctx, `UPDATE challenge_submissions SET status = 'pass' WHERE id = $1 AND game_id = $2 AND status = 'fail'`, req.VerdictID, gameID)
				if err != nil {
					return nil, fmt.Errorf("overturning the submission to pass: %w", err)
				}
				if tag.RowsAffected() != 1 {
					return nil, errDisputeSubmissionChanged
				}
				if firstCompleter {
					if _, err := tx.Exec(ctx, `
						INSERT INTO road_progress (game_id, road_id, completed_by, completed_at)
						VALUES ($1, $2, $3, NOW())
						ON CONFLICT (game_id, road_id) DO NOTHING
					`, gameID, roadID, teamID); err != nil {
						return nil, fmt.Errorf("recording road progress: %w", err)
					}
				}
				if coinReward > 0 {
					var newBalance int
					if err := tx.QueryRow(ctx, `
						INSERT INTO team_coins (game_id, team_id, balance)
						VALUES ($1, $2, $3)
						ON CONFLICT (game_id, team_id)
						DO UPDATE SET balance = team_coins.balance + EXCLUDED.balance
						RETURNING balance
					`, gameID, teamID, coinReward).Scan(&newBalance); err != nil {
						return nil, fmt.Errorf("crediting the dispute award: %w", err)
					}
					coinsBytes, _ := json.Marshal(eventstore.CoinsChangedPayload{
						TeamID: teamID, Delta: coinReward, BalanceAfter: newBalance,
						Reason: "dispute_resolved", Source: "dispute",
					})
					events = append(events, eventstore.Event{Type: "CoinsChanged", Payload: string(coinsBytes)})
				}
			case "pass":
				if kind == "roadblock" {
					var otherPasses int
					if err := tx.QueryRow(ctx, `
						SELECT COUNT(*) FROM challenge_submissions
						WHERE game_id = $1 AND road_id = $2 AND team_id = $3 AND id <> $4
						  AND status = 'pass' AND kind = 'roadblock'
					`, gameID, roadID, teamID, req.VerdictID).Scan(&otherPasses); err != nil {
						return nil, fmt.Errorf("checking remaining roadblock clears: %w", err)
					}
					verdictBytes, _ := json.Marshal(eventstore.VerdictReturnedPayload{
						SubmissionID: req.VerdictID, Verdict: "fail", Confidence: 1,
						Rationale: "Host upheld the dispute.", Source: "gm",
					})
					revokedBytes, _ := json.Marshal(eventstore.RoadblockClearRevokedPayload{
						SubmissionID: req.VerdictID, TeamID: teamID, RoadID: roadID,
						RevokeClear: otherPasses == 0,
					})
					events = append(events,
						eventstore.Event{Type: "VerdictReturned", Payload: string(verdictBytes)},
						eventstore.Event{Type: "RoadblockClearRevoked", Payload: string(revokedBytes)},
					)
					tag, err := tx.Exec(ctx, `UPDATE challenge_submissions SET status = 'fail' WHERE id = $1 AND game_id = $2 AND status = 'pass'`, req.VerdictID, gameID)
					if err != nil {
						return nil, fmt.Errorf("overturning the roadblock submission: %w", err)
					}
					if tag.RowsAffected() != 1 {
						return nil, errDisputeSubmissionChanged
					}
					break
				}
				if kind != "challenge" {
					return nil, fmt.Errorf("unknown submission kind %q", kind)
				}
				var otherPasses int
				if err := tx.QueryRow(ctx, `
					SELECT COUNT(*) FROM challenge_submissions
					WHERE game_id = $1 AND road_id = $2 AND team_id = $3 AND id <> $4
					  AND status = 'pass' AND kind = 'challenge'
				`, gameID, roadID, teamID, req.VerdictID).Scan(&otherPasses); err != nil {
					return nil, fmt.Errorf("checking remaining challenge passes: %w", err)
				}
				var verdictSeq int
				if err := tx.QueryRow(ctx, `
					SELECT sequence FROM events
					WHERE game_id = $1 AND event_type = 'VerdictReturned'
					  AND payload->>'submission_id' = $2 AND payload->>'verdict' = 'pass'
				ORDER BY sequence DESC LIMIT 1
				`, gameID, req.VerdictID).Scan(&verdictSeq); err != nil {
					return nil, fmt.Errorf("finding the accepted verdict event: %w", err)
				}
				var revokedReward int
				if err := tx.QueryRow(ctx, `
					SELECT COALESCE((payload->>'coin_reward')::int, 0)
					FROM events
					WHERE game_id = $1 AND sequence > $2 AND event_type = 'ChallengeCompleted'
					  AND (payload->>'road_id' = $3 OR payload->>'waypoint_id' = $3)
					  AND payload->>'team_id' = $4
				ORDER BY sequence ASC LIMIT 1
				`, gameID, verdictSeq, roadID, teamID).Scan(&revokedReward); err != nil {
					return nil, fmt.Errorf("finding the challenge award to revoke: %w", err)
				}
				var restoreOwner string
				if err := tx.QueryRow(ctx, `
					SELECT completed_by::text FROM road_progress WHERE game_id = $1 AND road_id = $2
				`, gameID, roadID).Scan(&restoreOwner); err != nil && !errors.Is(err, pgx.ErrNoRows) {
					return nil, fmt.Errorf("reading current challenge owner: %w", err)
				}
				if restoreOwner == teamID {
					restoreOwner = ""
				}
				verdictBytes, _ := json.Marshal(eventstore.VerdictReturnedPayload{
					SubmissionID: req.VerdictID, Verdict: "fail", Confidence: 1,
					Rationale: "Host upheld the dispute.", Source: "gm",
				})
				revokedBytes, _ := json.Marshal(eventstore.ChallengeRevokedPayload{
					SubmissionID: req.VerdictID, TeamID: teamID,
					WaypointID: completionWaypointID, RoadID: completionRoadID,
					ChallengeID: challengeID, CoinReward: revokedReward,
					RestoreCompletedBy: restoreOwner, RevokeClear: otherPasses == 0,
				})
				events = append(events,
					eventstore.Event{Type: "VerdictReturned", Payload: string(verdictBytes)},
					eventstore.Event{Type: "ChallengeRevoked", Payload: string(revokedBytes)},
				)
				tag, err := tx.Exec(ctx, `UPDATE challenge_submissions SET status = 'fail' WHERE id = $1 AND game_id = $2 AND status = 'pass'`, req.VerdictID, gameID)
				if err != nil {
					return nil, fmt.Errorf("overturning the submission to fail: %w", err)
				}
				if tag.RowsAffected() != 1 {
					return nil, errDisputeSubmissionChanged
				}
				tag, err = tx.Exec(ctx, `DELETE FROM road_progress WHERE game_id = $1 AND road_id = $2 AND completed_by = $3`, gameID, roadID, teamID)
				if err != nil {
					return nil, fmt.Errorf("withdrawing road progress: %w", err)
				}
				if tag.RowsAffected() > 0 && restoreOwner != "" {
					var restoredAt time.Time
					if err := tx.QueryRow(ctx, `
					SELECT created_at FROM events
					WHERE game_id = $1 AND event_type = 'ChallengeCompleted'
					  AND (payload->>'road_id' = $2 OR payload->>'waypoint_id' = $2)
					  AND payload->>'team_id' = $3
					ORDER BY sequence ASC LIMIT 1
					`, gameID, roadID, restoreOwner).Scan(&restoredAt); err != nil {
						return nil, fmt.Errorf("finding restored road owner time: %w", err)
					}
					if _, err := tx.Exec(ctx, `
						INSERT INTO road_progress (game_id, road_id, completed_by, completed_at)
						VALUES ($1, $2, $3, $4)
						ON CONFLICT (game_id, road_id) DO UPDATE SET completed_by = EXCLUDED.completed_by, completed_at = EXCLUDED.completed_at
					`, gameID, roadID, restoreOwner, restoredAt); err != nil {
						return nil, fmt.Errorf("restoring road progress: %w", err)
					}
				}
				if revokedReward > 0 {
					var newBalance int
					if err := tx.QueryRow(ctx, `
						UPDATE team_coins SET balance = balance - $3
						WHERE game_id = $1 AND team_id = $2 RETURNING balance
					`, gameID, teamID, revokedReward).Scan(&newBalance); err != nil {
						return nil, fmt.Errorf("withdrawing the dispute award: %w", err)
					}
					coinsBytes, _ := json.Marshal(eventstore.CoinsChangedPayload{
						TeamID: teamID, Delta: -revokedReward, BalanceAfter: newBalance,
						Reason: "dispute_revoked", Source: "dispute",
					})
					events = append(events, eventstore.Event{Type: "CoinsChanged", Payload: string(coinsBytes)})
				}
			case "pending":
				return nil, fmt.Errorf("submission has no verdict to resolve")
			default:
				return nil, fmt.Errorf("submission has an unknown status %q", originalStatus)
			}
		}
		events = append(events, eventstore.Event{Type: "DisputeResolved", Payload: string(cr.Payload)})

		return &commands.CommandResult{
			ResponseCode: http.StatusOK,
			ResponseBody: statusResponse{Status: "resolved"},
			Events:       events,
		}, nil
	})
	if err != nil {
		if writeGameMutationGuardError(r.Context(), w, err) {
			return
		}
		if errors.Is(err, errDisputeNotPending) || errors.Is(err, errDisputeSubmissionChanged) {
			writeError(r.Context(), w, http.StatusConflict, "this dispute has already been resolved")
			return
		}
		if writeConcurrencyConflict(r.Context(), w, err) {
			return
		}
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to resolve dispute: "+err.Error())
		return
	}

	writeJSON(r.Context(), w, http.StatusOK, statusResponse{Status: "resolved"})
}
