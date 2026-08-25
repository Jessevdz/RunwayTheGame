package api

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgconn"
	"github.com/jackc/pgx/v4"
)

// execer is the Exec a pool and a transaction both offer.
type execer interface {
	Exec(ctx context.Context, sql string, args ...interface{}) (pgconn.CommandTag, error)
}

// boardChildCopies names every board-owned table with the columns a snapshot copies,
// so a column added to one of those tables has to be added here too.
var boardChildCopies = []struct {
	table   string
	columns string
}{
	{"board_waypoints", "id, name, location, arrival_radius_m, is_start, is_finish, challenge_id"},
	{"board_roads", "id, waypoint_id_a, waypoint_id_b, length_m, challenge_id"},
	{"challenges", "id, waypoint_id, prompt, rubric, coin_reward, veto_penalty_seconds"},
	{"board_roadblock_cards", "id, text"},
	{"board_curse_cards", "id, text"},
	{"board_powerup_costs", "powerup, cost"},
	{"board_powerups", "id, icon, name, description, cost, duration_s, effect, sort_order"},
}

// snapshotBoardVersion copies a board version into a fresh frozen one and returns that version.
func snapshotBoardVersion(ctx context.Context, tx pgx.Tx, boardID string, srcVersion int) (int, error) {
	// Two hosts opening a race on the same map at the same moment would otherwise
	// both pick the same next version number and one would lose on the primary key.
	var locked int
	if err := tx.QueryRow(ctx, `SELECT 1 FROM boards WHERE id = $1 AND version = $2 FOR UPDATE`, boardID, srcVersion).Scan(&locked); err != nil {
		return 0, fmt.Errorf("failed to lock the board being raced: %w", err)
	}

	var newVersion int
	// The snapshot carries no edit capability, stays out of the gallery, and
	// keeps the draft's updated_at so a report can tell when the design was last
	// touched before the race.
	err := tx.QueryRow(ctx, `
		INSERT INTO boards (id, version, name, edit_token_hash, is_listed, is_snapshot, published_at, base_map_style, bounds, created_at, updated_at)
		SELECT b.id, (SELECT MAX(version) + 1 FROM boards WHERE id = b.id), b.name, NULL, FALSE, TRUE, NOW(), b.base_map_style, b.bounds, NOW(), b.updated_at
		FROM boards b
		WHERE b.id = $1 AND b.version = $2
		RETURNING version
	`, boardID, srcVersion).Scan(&newVersion)
	if err != nil {
		return 0, fmt.Errorf("failed to snapshot board row: %w", err)
	}

	for _, child := range boardChildCopies {
		// Table and column names come from boardChildCopies, never from a request.
		sql := fmt.Sprintf(
			"INSERT INTO %[1]s (board_id, board_version, %[2]s) SELECT board_id, $3, %[2]s FROM %[1]s WHERE board_id = $1 AND board_version = $2",
			child.table, child.columns)
		if _, err := tx.Exec(ctx, sql, boardID, srcVersion, newVersion); err != nil {
			return 0, fmt.Errorf("failed to snapshot %s: %w", child.table, err)
		}
	}

	return newVersion, nil
}

// boardVersionRaced reports whether a game pins this exact board version.
func (s *Server) boardVersionRaced(ctx context.Context, boardID string, version int) (bool, error) {
	var raced bool
	err := s.DB.Pool.QueryRow(ctx, `
		SELECT EXISTS(SELECT 1 FROM games WHERE board_id = $1 AND board_version = $2)
	`, boardID, version).Scan(&raced)
	return raced, err
}

// errBoardVersionRaced rejects a write to a board version some race is already pinned to.
var errBoardVersionRaced = errors.New("cannot modify a board version a race is pinned to")

// requireEditableBoardVersion rejects a design write once a race depends on that exact version.
func (s *Server) requireEditableBoardVersion(ctx context.Context, boardID string, version int) error {
	raced, err := s.boardVersionRaced(ctx, boardID, version)
	if err != nil {
		return fmt.Errorf("failed to read board state: %w", err)
	}
	if raced {
		return errBoardVersionRaced
	}
	return nil
}

// freezeBoardForRace snapshots a validated draft and returns the version the new game pins.
func (s *Server) freezeBoardForRace(ctx context.Context, boardID string, draftVersion int) (int, error) {
	if err := s.requirePublishedBoard(ctx, boardID, draftVersion); err != nil {
		return 0, err
	}

	tx, err := s.DB.Pool.Begin(ctx)
	if err != nil {
		return 0, fmt.Errorf("failed to start transaction: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	raceVersion, err := snapshotBoardVersion(ctx, tx, boardID, draftVersion)
	if err != nil {
		return 0, err
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, fmt.Errorf("failed to commit board snapshot: %w", err)
	}
	return raceVersion, nil
}

// touchBoardDraft records a design change and drops the publish validation it invalidates.
func touchBoardDraft(ctx context.Context, ex execer, boardID string, version int) error {
	_, err := ex.Exec(ctx, `
		UPDATE boards SET updated_at = NOW(), published_at = NULL WHERE id = $1 AND version = $2
	`, boardID, version)
	return err
}
