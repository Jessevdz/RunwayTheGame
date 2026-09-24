package projections

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/Jessevdz/RunwayTheGame/internal/eventstore"
	"github.com/Jessevdz/RunwayTheGame/internal/rules"
)

// LoadBoard fetches a complete board representation from the database with deterministic ordering.
func LoadBoard(ctx context.Context, conn eventstore.DBConnection, boardID string, version int) (rules.Board, error) {
	var b rules.Board
	b.ID = boardID
	b.Version = version

	var name string
	err := conn.QueryRow(ctx, "SELECT name FROM boards WHERE id = $1 AND version = $2", boardID, version).Scan(&name)
	if err != nil {
		return b, fmt.Errorf("failed to fetch board metadata: %w", err)
	}
	b.Name = name
	b.PowerupCosts = make(map[string]int)

	wpRows, err := conn.Query(ctx, `
		SELECT id, name, ST_Y(location::geometry), ST_X(location::geometry), arrival_radius_m, is_start, is_finish, challenge_id
		FROM board_waypoints
		WHERE board_id = $1 AND board_version = $2
		ORDER BY id
	`, boardID, version)
	if err != nil {
		return b, fmt.Errorf("failed to load waypoints: %w", err)
	}
	defer wpRows.Close()

	for wpRows.Next() {
		var wp rules.Waypoint
		var challengeIDNull *string
		err = wpRows.Scan(&wp.ID, &wp.Name, &wp.Lat, &wp.Lon, &wp.ArrivalRadiusM, &wp.IsStart, &wp.IsFinish, &challengeIDNull)
		if err != nil {
			return b, fmt.Errorf("failed to scan waypoint: %w", err)
		}
		if challengeIDNull != nil {
			wp.ChallengeID = *challengeIDNull
		}
		b.Waypoints = append(b.Waypoints, wp)
	}
	if err := wpRows.Err(); err != nil {
		return b, fmt.Errorf("failed to iterate waypoints: %w", err)
	}

	roadRows, err := conn.Query(ctx, `
		SELECT id, waypoint_id_a, waypoint_id_b, length_m, challenge_id
		FROM board_roads
		WHERE board_id = $1 AND board_version = $2
		ORDER BY id
	`, boardID, version)
	if err != nil {
		return b, fmt.Errorf("failed to load roads: %w", err)
	}
	defer roadRows.Close()

	for roadRows.Next() {
		var road rules.Road
		var challengeIDNull *string
		err = roadRows.Scan(&road.ID, &road.WaypointIDA, &road.WaypointIDB, &road.LengthM, &challengeIDNull)
		if err != nil {
			return b, fmt.Errorf("failed to scan road: %w", err)
		}
		if challengeIDNull != nil {
			road.ChallengeID = *challengeIDNull
		}
		b.Roads = append(b.Roads, road)
	}
	if err := roadRows.Err(); err != nil {
		return b, fmt.Errorf("failed to iterate roads: %w", err)
	}

	rbRows, err := conn.Query(ctx, `
		SELECT id, text
		FROM board_roadblock_cards
		WHERE board_id = $1 AND board_version = $2
		ORDER BY id
	`, boardID, version)
	if err != nil {
		return b, fmt.Errorf("failed to load roadblock cards: %w", err)
	}
	defer rbRows.Close()
	for rbRows.Next() {
		var card rules.Card
		if err := rbRows.Scan(&card.ID, &card.Text); err != nil {
			return b, fmt.Errorf("failed to scan roadblock card: %w", err)
		}
		b.RoadblockDeck = append(b.RoadblockDeck, card)
	}
	if err := rbRows.Err(); err != nil {
		return b, fmt.Errorf("failed to iterate roadblock cards: %w", err)
	}

	curseRows, err := conn.Query(ctx, `
		SELECT id, text
		FROM board_curse_cards
		WHERE board_id = $1 AND board_version = $2
		ORDER BY id
	`, boardID, version)
	if err != nil {
		return b, fmt.Errorf("failed to load curse cards: %w", err)
	}
	defer curseRows.Close()
	for curseRows.Next() {
		var card rules.Card
		if err := curseRows.Scan(&card.ID, &card.Text); err != nil {
			return b, fmt.Errorf("failed to scan curse card: %w", err)
		}
		b.CurseDeck = append(b.CurseDeck, card)
	}
	if err := curseRows.Err(); err != nil {
		return b, fmt.Errorf("failed to iterate curse cards: %w", err)
	}

	costRows, err := conn.Query(ctx, `
		SELECT powerup, cost
		FROM board_powerup_costs
		WHERE board_id = $1 AND board_version = $2
		ORDER BY powerup
	`, boardID, version)
	if err != nil {
		return b, fmt.Errorf("failed to load power-up costs: %w", err)
	}
	defer costRows.Close()
	for costRows.Next() {
		var powerup string
		var cost int
		if err := costRows.Scan(&powerup, &cost); err != nil {
			return b, fmt.Errorf("failed to scan power-up cost: %w", err)
		}
		b.PowerupCosts[powerup] = cost
	}
	if err := costRows.Err(); err != nil {
		return b, fmt.Errorf("failed to iterate power-up costs: %w", err)
	}

	puRows, err := conn.Query(ctx, `
		SELECT id, icon, name, description, cost, duration_s, effect
		FROM board_powerups
		WHERE board_id = $1 AND board_version = $2
		ORDER BY sort_order, id
	`, boardID, version)
	if err != nil {
		return b, fmt.Errorf("failed to load power-ups: %w", err)
	}
	defer puRows.Close()
	for puRows.Next() {
		var pu rules.Powerup
		if err := puRows.Scan(&pu.ID, &pu.Icon, &pu.Name, &pu.Description, &pu.Cost, &pu.DurationS, &pu.Effect); err != nil {
			return b, fmt.Errorf("failed to scan power-up: %w", err)
		}
		b.Powerups = append(b.Powerups, pu)
	}
	if err := puRows.Err(); err != nil {
		return b, fmt.Errorf("failed to iterate power-ups: %w", err)
	}

	chRows, err := conn.Query(ctx, `
		SELECT id, COALESCE(waypoint_id::text, ''), prompt, rubric, coin_reward, veto_penalty_seconds
		FROM challenges
		WHERE board_id = $1 AND board_version = $2
		ORDER BY id
	`, boardID, version)
	if err != nil {
		return b, fmt.Errorf("failed to load challenges: %w", err)
	}
	defer chRows.Close()
	for chRows.Next() {
		var ch rules.Challenge
		var rubricBytes []byte
		if err := chRows.Scan(&ch.ID, &ch.WaypointID, &ch.Prompt, &rubricBytes, &ch.CoinReward, &ch.VetoPenaltySeconds); err != nil {
			return b, fmt.Errorf("failed to scan challenge: %w", err)
		}
		if err := json.Unmarshal(rubricBytes, &ch.Rubric); err != nil {
			return b, fmt.Errorf("failed to decode rubric for challenge %s: %w", ch.ID, err)
		}
		b.Challenges = append(b.Challenges, ch)
	}
	if err := chRows.Err(); err != nil {
		return b, fmt.Errorf("failed to iterate challenges: %w", err)
	}

	if b.Waypoints == nil {
		b.Waypoints = []rules.Waypoint{}
	}
	if b.Roads == nil {
		b.Roads = []rules.Road{}
	}
	if b.RoadblockDeck == nil {
		b.RoadblockDeck = []rules.Card{}
	}
	if b.CurseDeck == nil {
		b.CurseDeck = []rules.Card{}
	}
	if b.Challenges == nil {
		b.Challenges = []rules.Challenge{}
	}

	if len(b.Powerups) == 0 && len(b.PowerupCosts) > 0 {
		for _, pu := range rules.DefaultPowerups() {
			if cost, ok := b.PowerupCosts[pu.ID]; ok {
				pu.Cost = cost
			}
			b.Powerups = append(b.Powerups, pu)
		}
	}
	if b.Powerups == nil {
		b.Powerups = []rules.Powerup{}
	}
	for _, pu := range b.Powerups {
		if _, ok := b.PowerupCosts[pu.ID]; !ok {
			b.PowerupCosts[pu.ID] = pu.Cost
		}
	}

	return b, nil
}
