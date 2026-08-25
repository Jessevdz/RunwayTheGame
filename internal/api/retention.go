package api

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v4"

	"github.com/Jessevdz/RunwayTheGame/internal/blobstore"
	"github.com/Jessevdz/RunwayTheGame/internal/logger"
)

// RetentionDays is the maximum retention duration in days for race data.
const RetentionDays = 30

// RetentionWindow is RetentionDays as a duration.
const RetentionWindow = RetentionDays * 24 * time.Hour

// stalePositionAge is the maximum duration a live position record may persist without updates.
const stalePositionAge = 24 * time.Hour

// orphanSnapshotAge is how long a frozen board copy may sit without the race it was frozen for.
const orphanSnapshotAge = 24 * time.Hour

// purgeBatchSize is the maximum number of expired games purged in a single sweep pass.
const purgeBatchSize = 50

// purgeAttempts is the maximum number of retry passes when sweeping photos during a game purge.
const purgeAttempts = 3

// errBlobsRemain indicates one or more evidence photos failed to be deleted from object storage.
var errBlobsRemain = errors.New("some photos could not be deleted from object storage")

// deletionResponse reports the result of a game or team evidence deletion request.
type deletionResponse struct {
	GameID        string `json:"game_id,omitempty"`
	TeamID        string `json:"team_id,omitempty"`
	Deleted       bool   `json:"deleted"`
	PhotosDeleted int    `json:"photos_deleted"`
	Error         string `json:"error,omitempty"`
}

// handleDeleteGame immediately purges all stored race data and associated evidence photos.
func (s *Server) handleDeleteGame(w http.ResponseWriter, r *http.Request) {
	gameID := chi.URLParam(r, "game_id")

	photos, err := s.purgeGame(r.Context(), gameID)
	if err != nil {
		if errors.Is(err, errBlobsRemain) {
			// Return Bad Gateway when database operation succeeds but object storage deletion fails.
			writeJSON(r.Context(), w, http.StatusBadGateway, deletionResponse{
				Deleted:       false,
				PhotosDeleted: photos,
				Error:         "the race was not deleted: object storage refused to delete some photos. Nothing has been removed from the database, so this can be retried.",
			})
			return
		}
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to delete this race: "+err.Error())
		return
	}

	logger.Info(r.Context(), "race deleted on request", map[string]interface{}{
		"game_id":        gameID,
		"photos_deleted": photos,
	})

	writeJSON(r.Context(), w, http.StatusOK, deletionResponse{
		GameID:        gameID,
		Deleted:       true,
		PhotosDeleted: photos,
	})
}

// handleDeleteTeamEvidence deletes a specific team's evidence photos and position history.
func (s *Server) handleDeleteTeamEvidence(w http.ResponseWriter, r *http.Request) {
	gameID := chi.URLParam(r, "game_id")

	_, team, ok := s.requireTeam(w, r, gameID)
	if !ok {
		return
	}

	photos, err := s.purgeTeamPhotos(r.Context(), gameID, team.ID)
	if err != nil && !errors.Is(err, errBlobsRemain) {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to delete your photos: "+err.Error())
		return
	}

	if _, posErr := s.DB.Pool.Exec(r.Context(), `
		DELETE FROM team_positions WHERE game_id = $1 AND team_id = $2
	`, gameID, team.ID); posErr != nil {
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to delete your position: "+posErr.Error())
		return
	}

	logger.Info(r.Context(), "team evidence deleted on request", map[string]interface{}{
		"game_id":        gameID,
		"photos_deleted": photos,
	})

	body := deletionResponse{
		GameID:        gameID,
		TeamID:        team.ID,
		Deleted:       err == nil,
		PhotosDeleted: photos,
	}
	if err != nil {
		body.Error = "some photos could not be deleted from object storage and will be retried by the 30-day sweep"
	}
	writeJSON(r.Context(), w, http.StatusOK, body)
}

// SweepRetention executes a single pass of all data retention cleanup tasks.
func (s *Server) SweepRetention(ctx context.Context) {
	if err := s.sweepStalePositions(ctx); err != nil {
		logger.Error(ctx, "retention: failed to sweep stale positions", map[string]interface{}{"error": err.Error()})
	}
	if err := s.sweepExpiredGames(ctx); err != nil {
		logger.Error(ctx, "retention: failed to purge expired races", map[string]interface{}{"error": err.Error()})
	}
	if err := s.sweepStaleFingerprints(ctx); err != nil {
		logger.Error(ctx, "retention: failed to sweep roadmap fingerprints", map[string]interface{}{"error": err.Error()})
	}
	if err := s.sweepExpiredBugReports(ctx); err != nil {
		logger.Error(ctx, "retention: failed to sweep bug reports", map[string]interface{}{"error": err.Error()})
	}
	if err := s.sweepOrphanBoardSnapshots(ctx); err != nil {
		logger.Error(ctx, "retention: failed to sweep orphan board snapshots", map[string]interface{}{"error": err.Error()})
	}
}

// sweepOrphanBoardSnapshots deletes frozen board copies whose race never got created.
func (s *Server) sweepOrphanBoardSnapshots(ctx context.Context) error {
	tag, err := s.DB.Pool.Exec(ctx, `
		DELETE FROM boards b
		WHERE b.is_snapshot = TRUE
		  AND b.created_at < NOW() - $1::interval
		  AND NOT EXISTS (SELECT 1 FROM games g WHERE g.board_id = b.id AND g.board_version = b.version)
	`, orphanSnapshotAge.String())
	if err != nil {
		return err
	}
	if removed := tag.RowsAffected(); removed > 0 {
		logger.Info(ctx, "retention: deleted orphan board snapshots", map[string]interface{}{"rows": removed})
	}
	return nil
}

// sweepExpiredBugReports deletes reports past the bug report retention window.
func (s *Server) sweepExpiredBugReports(ctx context.Context) error {
	tag, err := s.DB.Pool.Exec(ctx, `
		DELETE FROM bug_reports WHERE created_at < NOW() - $1::interval
	`, (BugReportRetentionDays * 24 * time.Hour).String())
	if err != nil {
		return err
	}
	if removed := tag.RowsAffected(); removed > 0 {
		logger.Info(ctx, "retention: deleted expired bug reports", map[string]interface{}{"rows": removed})
	}
	return nil
}

// sweepStalePositions removes position history for completed races and positions older than stalePositionAge.
func (s *Server) sweepStalePositions(ctx context.Context) error {
	tag, err := s.DB.Pool.Exec(ctx, `
		DELETE FROM team_positions p
		USING games g
		WHERE g.id = p.game_id AND g.status = 'ended'
	`)
	if err != nil {
		return err
	}
	removed := tag.RowsAffected()

	tag, err = s.DB.Pool.Exec(ctx, `
		DELETE FROM team_positions WHERE reported_at < NOW() - $1::interval
	`, stalePositionAge.String())
	if err != nil {
		return err
	}
	removed += tag.RowsAffected()

	if removed > 0 {
		logger.Info(ctx, "retention: deleted stale positions", map[string]interface{}{"rows": removed})
	}
	return nil
}

// sweepExpiredGames purges all races that have exceeded the retention window.
func (s *Server) sweepExpiredGames(ctx context.Context) error {
	rows, err := s.DB.Pool.Query(ctx, `
		SELECT g.id::text
		FROM games g
		WHERE g.status = 'ended'
		  AND COALESCE(
		        (SELECT MAX(e.created_at) FROM events e
		          WHERE e.game_id = g.id AND e.event_type = 'GameEnded'),
		        g.created_at
		      ) < NOW() - $1::interval
		ORDER BY g.created_at ASC
		LIMIT $2
	`, RetentionWindow.String(), purgeBatchSize)
	if err != nil {
		return err
	}

	var expired []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		expired = append(expired, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}

	for _, gameID := range expired {
		photos, err := s.purgeGame(ctx, gameID)
		if err != nil {
			// Log error and continue sweeping remaining expired games.
			logger.Error(ctx, "retention: failed to purge an expired race", map[string]interface{}{
				"game_id": gameID,
				"error":   err.Error(),
			})
			continue
		}
		logger.Info(ctx, "retention: purged an expired race", map[string]interface{}{
			"game_id":        gameID,
			"photos_deleted": photos,
		})
	}
	return nil
}

// sweepStaleFingerprints clears expired voter fingerprints from roadmap votes and flags.
func (s *Server) sweepStaleFingerprints(ctx context.Context) error {
	for _, table := range []string{"roadmap_votes", "roadmap_flags"} {
		if _, err := s.DB.Pool.Exec(ctx, `
			UPDATE `+table+`
			   SET voter_fingerprint = NULL
			 WHERE voter_fingerprint IS NOT NULL
			   AND created_at < NOW() - $1::interval
		`, RetentionWindow.String()); err != nil {
			return err
		}
	}
	return nil
}

// purgeGame permanently deletes a race and its associated storage assets.
func (s *Server) purgeGame(ctx context.Context, gameID string) (int, error) {
	// Mark the game as purging to prevent new evidence submissions during cleanup.
	if err := s.markGamePurging(ctx, gameID); err != nil {
		return 0, err
	}

	photos := 0
	for attempt := 0; attempt < purgeAttempts; attempt++ {
		n, blobErr := s.purgeTeamPhotos(ctx, gameID, "")
		photos += n
		if blobErr != nil {
			// Retain database rows if object storage cleanup fails.
			return photos, blobErr
		}

		done, err := s.deleteGameRows(ctx, gameID)
		if err != nil {
			return photos, err
		}
		if done {
			return photos, nil
		}
		// Sweep remaining photos if a submission arrived during initial pass.
		logger.Info(ctx, "retention: a submission landed mid-purge, sweeping photos again", map[string]interface{}{
			"game_id": gameID,
			"attempt": attempt + 1,
		})
	}
	return photos, errBlobsRemain
}

// markGamePurging locks the game record and sets purging_at timestamp.
func (s *Server) markGamePurging(ctx context.Context, gameID string) error {
	tx, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := tx.Exec(ctx, `SELECT id FROM games WHERE id = $1 FOR UPDATE`, gameID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		UPDATE games SET purging_at = COALESCE(purging_at, NOW()) WHERE id = $1
	`, gameID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// deleteGameRows removes database rows for gameID if no active photo references remain.
func (s *Server) deleteGameRows(ctx context.Context, gameID string) (bool, error) {
	tx, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var blobsRemain bool
	if err := tx.QueryRow(ctx, `
		SELECT EXISTS(
			SELECT 1 FROM challenge_submissions
			WHERE game_id = $1 AND blob_ref <> ''
		)
	`, gameID).Scan(&blobsRemain); err != nil {
		return false, err
	}
	if blobsRemain {
		return false, nil
	}

	// Delete event store and command records prior to cascading game row deletion.
	if _, err := tx.Exec(ctx, `DELETE FROM events WHERE game_id = $1`, gameID); err != nil {
		return false, err
	}
	if _, err := tx.Exec(ctx, `DELETE FROM idempotent_commands WHERE game_id = $1`, gameID); err != nil {
		return false, err
	}
	// The board version this game raced was frozen for it alone, so it goes when
	// the last game holding it goes.
	var boardID string
	var boardVersion int
	if err := tx.QueryRow(ctx, `SELECT board_id::text, board_version FROM games WHERE id = $1`, gameID).Scan(&boardID, &boardVersion); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return true, nil
		}
		return false, err
	}

	if _, err := tx.Exec(ctx, `DELETE FROM games WHERE id = $1`, gameID); err != nil {
		return false, err
	}

	if _, err := tx.Exec(ctx, `
		DELETE FROM boards b
		WHERE b.id = $1 AND b.version = $2 AND b.is_snapshot = TRUE
		  AND NOT EXISTS (SELECT 1 FROM games g WHERE g.board_id = b.id AND g.board_version = b.version)
	`, boardID, boardVersion); err != nil {
		return false, err
	}

	if err := tx.Commit(ctx); err != nil {
		return false, err
	}
	return true, nil
}

// purgeTeamPhotos removes evidence photos from object storage and clears blob references.
func (s *Server) purgeTeamPhotos(ctx context.Context, gameID, teamID string) (int, error) {
	rows, err := s.DB.Pool.Query(ctx, `
		SELECT id::text, blob_ref
		FROM challenge_submissions
		WHERE game_id = $1
		  AND ($2 = '' OR team_id::text = $2)
		  AND blob_ref <> ''
	`, gameID, teamID)
	if err != nil {
		return 0, err
	}

	type target struct{ id, ref string }
	var targets []target
	for rows.Next() {
		var t target
		if err := rows.Scan(&t.id, &t.ref); err != nil {
			rows.Close()
			return 0, err
		}
		targets = append(targets, t)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}
	if len(targets) == 0 {
		return 0, nil
	}

	// Return error if object store is present but does not support deletion.
	deleter, canDelete := s.BlobStore.(blobstore.Deleter)
	if s.BlobStore != nil && !canDelete {
		return 0, errBlobsRemain
	}

	deleted := 0
	var failed int
	for _, t := range targets {
		if canDelete {
			// Delete object only if no other submissions reference this key.
			shared, err := s.blobRefSharedOutside(ctx, t.ref, t.id, gameID, teamID)
			if err != nil {
				return deleted, err
			}
			if shared {
				logger.Warn(ctx, "retention: evidence key is referenced by another submission, leaving the object", map[string]interface{}{
					"game_id":       gameID,
					"submission_id": t.id,
				})
			} else if err := deleter.DeleteObject(ctx, t.ref); err != nil {
				logger.Warn(ctx, "retention: failed to delete an evidence photo", map[string]interface{}{
					"game_id": gameID,
					"error":   err.Error(),
				})
				failed++
				continue
			}
		}
		// Update database row immediately after object deletion.
		if _, err := s.DB.Pool.Exec(ctx, `
			UPDATE challenge_submissions
			   SET blob_ref = '', blob_deleted_at = NOW()
			 WHERE id = $1
		`, t.id); err != nil {
			return deleted, err
		}
		deleted++
	}

	if failed > 0 {
		return deleted, errBlobsRemain
	}
	return deleted, nil
}

// blobRefSharedOutside checks whether an object key is referenced by submissions outside the active purge set.
func (s *Server) blobRefSharedOutside(ctx context.Context, ref, submissionID, gameID, teamID string) (bool, error) {
	var shared bool
	err := s.DB.Pool.QueryRow(ctx, `
		SELECT EXISTS(
			SELECT 1 FROM challenge_submissions
			WHERE blob_ref = $1
			  AND id::text <> $2
			  AND NOT (game_id = $3 AND ($4 = '' OR team_id::text = $4))
		)
	`, ref, submissionID, gameID, teamID).Scan(&shared)
	return shared, err
}
