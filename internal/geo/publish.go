package geo

import (
	"context"
	"fmt"
	"time"

	"github.com/Jessevdz/RunwayTheGame/internal/db"
	"github.com/Jessevdz/RunwayTheGame/internal/rules"
)

// PublishBoard runs the full validation pipeline, computes geodesic lengths, and marks the board version validated.
func PublishBoard(ctx context.Context, database *db.DB, boardID string, version int) (rules.Board, error) {
	tx, err := database.Pool.Begin(ctx)
	if err != nil {
		return rules.Board{}, fmt.Errorf("failed to start transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	var name string
	// Re-publishing is how an edited draft gets re-validated and its road lengths
	// recomputed, so an existing published_at is not an error.
	err = tx.QueryRow(ctx, `
		SELECT name FROM boards WHERE id = $1 AND version = $2
	`, boardID, version).Scan(&name)
	if err != nil {
		return rules.Board{}, fmt.Errorf("failed to fetch draft board: %w", err)
	}

	b := rules.Board{
		ID:           boardID,
		Version:      version,
		Name:         name,
		PowerupCosts: make(map[string]int),
	}

	wpRows, err := tx.Query(ctx, `
		SELECT id, name, ST_Y(location::geometry), ST_X(location::geometry), arrival_radius_m, is_start, is_finish, challenge_id
		FROM board_waypoints
		WHERE board_id = $1 AND board_version = $2
	`, boardID, version)
	if err != nil {
		return rules.Board{}, fmt.Errorf("failed to load waypoints: %w", err)
	}
	defer wpRows.Close()
	for wpRows.Next() {
		var wp rules.Waypoint
		var challengeIDNull *string
		if err := wpRows.Scan(&wp.ID, &wp.Name, &wp.Lat, &wp.Lon, &wp.ArrivalRadiusM, &wp.IsStart, &wp.IsFinish, &challengeIDNull); err != nil {
			return rules.Board{}, fmt.Errorf("failed to scan waypoint: %w", err)
		}
		if challengeIDNull != nil {
			wp.ChallengeID = *challengeIDNull
		}
		b.Waypoints = append(b.Waypoints, wp)
	}

	roadRows, err := tx.Query(ctx, `
		SELECT id, waypoint_id_a, waypoint_id_b
		FROM board_roads
		WHERE board_id = $1 AND board_version = $2
	`, boardID, version)
	if err != nil {
		return rules.Board{}, fmt.Errorf("failed to load roads: %w", err)
	}
	defer roadRows.Close()
	for roadRows.Next() {
		var road rules.Road
		if err := roadRows.Scan(&road.ID, &road.WaypointIDA, &road.WaypointIDB); err != nil {
			return rules.Board{}, fmt.Errorf("failed to scan road: %w", err)
		}
		b.Roads = append(b.Roads, road)
	}

	costRows, err := tx.Query(ctx, `
		SELECT powerup, cost
		FROM board_powerup_costs
		WHERE board_id = $1 AND board_version = $2
	`, boardID, version)
	if err == nil {
		defer costRows.Close()
		for costRows.Next() {
			var powerup string
			var cost int
			if err := costRows.Scan(&powerup, &cost); err == nil {
				b.PowerupCosts[powerup] = cost
			}
		}
	}

	errors, _, err := ValidateBoard(ctx, database, b)
	if err != nil {
		return rules.Board{}, fmt.Errorf("failed to validate board: %w", err)
	}
	if len(errors) > 0 {
		return rules.Board{}, fmt.Errorf("board validation failed with errors: %v", errors)
	}

	wpMap := make(map[string]rules.Waypoint)
	for _, wp := range b.Waypoints {
		wpMap[wp.ID] = wp
	}

	for i, road := range b.Roads {
		wpA, okA := wpMap[road.WaypointIDA]
		wpB, okB := wpMap[road.WaypointIDB]
		if !okA || !okB {
			return rules.Board{}, fmt.Errorf("road %s references missing waypoint(s)", road.ID)
		}

		wkt := fmt.Sprintf("LINESTRING(%f %f, %f %f)", wpA.Lon, wpA.Lat, wpB.Lon, wpB.Lat)
		var length float64
		err = tx.QueryRow(ctx, "SELECT ST_Length(ST_GeographyFromText($1))", wkt).Scan(&length)
		if err != nil {
			return rules.Board{}, fmt.Errorf("failed to compute geodesic length for road %s: %w", road.ID, err)
		}

		b.Roads[i].LengthM = length

		_, err = tx.Exec(ctx, `
			UPDATE board_roads
			SET length_m = $1
			WHERE id = $2 AND board_id = $3 AND board_version = $4
		`, length, road.ID, boardID, version)
		if err != nil {
			return rules.Board{}, fmt.Errorf("failed to update length for road %s: %w", road.ID, err)
		}
	}

	pubTime := time.Now().UTC()
	_, err = tx.Exec(ctx, `
		UPDATE boards
		SET published_at = $1, updated_at = NOW()
		WHERE id = $2 AND version = $3
	`, pubTime, boardID, version)
	if err != nil {
		return rules.Board{}, fmt.Errorf("failed to update board publish status: %w", err)
	}

	err = tx.Commit(ctx)
	if err != nil {
		return rules.Board{}, fmt.Errorf("failed to commit publish: %w", err)
	}

	return b, nil
}
