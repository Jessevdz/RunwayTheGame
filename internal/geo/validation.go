package geo

import (
	"context"
	"fmt"

	"github.com/Jessevdz/RunwayTheGame/internal/db"
	"github.com/Jessevdz/RunwayTheGame/internal/rules"
)

// finishCarriesChallenge returns the validation error message for a finish waypoint containing a challenge.
func finishCarriesChallenge(wp rules.Waypoint) string {
	return fmt.Sprintf("finish waypoint %s (%s) cannot carry a challenge; arriving there is the objective", wp.ID, wp.Name)
}

// ValidateBoard checks a published/draft board for topological errors and warnings.
func ValidateBoard(ctx context.Context, database *db.DB, board rules.Board) (errors []string, warnings []string, err error) {
	if errors == nil {
		errors = []string{}
	}
	if warnings == nil {
		warnings = []string{}
	}

	adj := make(map[string][]string)
	for _, road := range board.Roads {
		adj[road.WaypointIDA] = append(adj[road.WaypointIDA], road.WaypointIDB)
		adj[road.WaypointIDB] = append(adj[road.WaypointIDB], road.WaypointIDA)
	}

	var startID, finishID string
	startCount := 0
	finishCount := 0

	for _, wp := range board.Waypoints {
		if wp.IsStart {
			startCount++
			startID = wp.ID
		}
		if wp.IsFinish {
			finishCount++
			finishID = wp.ID
		}
		// Start and finish must be distinct waypoints.
		if wp.IsStart && wp.IsFinish {
			errors = append(errors, fmt.Sprintf("waypoint %s (%s) cannot be both the start and the finish; place a separate finish waypoint next to the start for a circular route", wp.ID, wp.Name))
		}
		// Finish waypoints cannot carry a challenge.
		if wp.IsFinish && wp.ChallengeID != "" {
			errors = append(errors, finishCarriesChallenge(wp))
		}
		// Verify arrival radius falls within configured boundaries.
		if wp.ArrivalRadiusM != 0 &&
			(wp.ArrivalRadiusM < rules.MinArrivalRadiusM || wp.ArrivalRadiusM > rules.MaxArrivalRadiusM) {
			errors = append(errors, fmt.Sprintf(
				"waypoint %s (%s) has an arrival radius of %.0f m; it must be between %.0f m and %.0f m",
				wp.ID, wp.Name, wp.ArrivalRadiusM, rules.MinArrivalRadiusM, rules.MaxArrivalRadiusM))
		}
	}

	if startCount != 1 {
		errors = append(errors, fmt.Sprintf("board must have exactly one start waypoint (found %d)", startCount))
	}
	if finishCount != 1 {
		errors = append(errors, fmt.Sprintf("board must have exactly one finish waypoint (found %d)", finishCount))
	}

	// Check reachability from start waypoint.
	if startID != "" {
		visited := make(map[string]bool)
		queue := []string{startID}
		visited[startID] = true

		for len(queue) > 0 {
			curr := queue[0]
			queue = queue[1:]

			for _, neighbor := range adj[curr] {
				if !visited[neighbor] {
					visited[neighbor] = true
					queue = append(queue, neighbor)
				}
			}
		}

		if finishID != "" && !visited[finishID] {
			errors = append(errors, fmt.Sprintf("finish waypoint %s is unreachable from start waypoint %s", finishID, startID))
		}

		// Check for disconnected waypoints.
		for _, wp := range board.Waypoints {
			if len(adj[wp.ID]) > 0 && !visited[wp.ID] {
				errors = append(errors, fmt.Sprintf("waypoint %s (%s) is unreachable from the start waypoint", wp.ID, wp.Name))
			}
		}
	}

	// Check for isolated waypoints with no connected roads.
	for _, wp := range board.Waypoints {
		if len(adj[wp.ID]) == 0 {
			errors = append(errors, fmt.Sprintf("waypoint %s (%s) is isolated (no connected roads)", wp.ID, wp.Name))
		}
	}

	if database != nil {
		waypointChallenges := make(map[string]bool)
		rows, err := database.Pool.Query(ctx, `
			SELECT waypoint_id, coin_reward, veto_penalty_seconds
			FROM challenges
			WHERE board_id = $1 AND board_version = $2
		`, board.ID, board.Version)
		if err != nil {
			return nil, nil, fmt.Errorf("failed to fetch challenges for validation: %w", err)
		}
		defer rows.Close()

		for rows.Next() {
			var waypointID string
			var coinReward, vetoPenaltySec int
			if err := rows.Scan(&waypointID, &coinReward, &vetoPenaltySec); err != nil {
				return nil, nil, fmt.Errorf("failed to scan challenge: %w", err)
			}
			waypointChallenges[waypointID] = true

			if coinReward < 5 || coinReward > 40 {
				errors = append(errors, fmt.Sprintf("challenge on waypoint %s has invalid coin reward %d (must be between 5 and 40)", waypointID, coinReward))
			}
			if vetoPenaltySec < 900 || vetoPenaltySec > 14400 {
				errors = append(errors, fmt.Sprintf("challenge on waypoint %s has invalid veto penalty %d seconds (must be between 15m and 4h)", waypointID, vetoPenaltySec))
			}
		}

		for _, wp := range board.Waypoints {
			if !wp.IsStart && !wp.IsFinish && !waypointChallenges[wp.ID] {
				warnings = append(warnings, fmt.Sprintf("waypoint %s (%s) has no gating challenge configured", wp.ID, wp.Name))
			}
			if wp.IsFinish && waypointChallenges[wp.ID] {
				errors = append(errors, finishCarriesChallenge(wp))
			}
		}

		// Validate decks if power-ups are configured in cost mapping
		hasRoadblockCost := false
		hasCurseCost := false
		for pu := range board.PowerupCosts {
			if pu == "roadblock" {
				hasRoadblockCost = true
			}
			if pu == "curse" {
				hasCurseCost = true
			}
		}

		if hasRoadblockCost {
			var rbCount int
			err = database.Pool.QueryRow(ctx, `
				SELECT COUNT(*) FROM board_roadblock_cards WHERE board_id = $1 AND board_version = $2
			`, board.ID, board.Version).Scan(&rbCount)
			if err != nil {
				return nil, nil, fmt.Errorf("failed to count roadblock cards: %w", err)
			}
			if rbCount == 0 {
				errors = append(errors, "roadblock power-up is enabled but roadblock deck is empty")
			}
		}

		if hasCurseCost {
			var curseCount int
			err = database.Pool.QueryRow(ctx, `
				SELECT COUNT(*) FROM board_curse_cards WHERE board_id = $1 AND board_version = $2
			`, board.ID, board.Version).Scan(&curseCount)
			if err != nil {
				return nil, nil, fmt.Errorf("failed to count curse cards: %w", err)
			}
			if curseCount == 0 {
				errors = append(errors, "curse power-up is enabled but curse deck is empty")
			}
		}
	}

	return errors, warnings, nil
}
