package projections

import (
	"context"
	"encoding/json"
	"sort"
	"time"

	"github.com/Jessevdz/RunwayTheGame/internal/eventstore"
	"github.com/Jessevdz/RunwayTheGame/internal/rules"
)

// hydratePositions populates team GPS positions, omitting positions for teams with an active tracker-off effect.
func hydratePositions(ctx context.Context, conn eventstore.DBConnection, gameID string, p *GameStateProjection) error {
	rows, err := conn.Query(ctx, `
		SELECT team_id, lat, lon, accuracy_m, reported_at
		FROM team_positions
		WHERE game_id = $1
	`, gameID)
	if err != nil {
		return err
	}
	defer rows.Close()

	now := time.Now().UTC()
	for rows.Next() {
		var teamID string
		var pos Position
		if err := rows.Scan(&teamID, &pos.Lat, &pos.Lon, &pos.AccuracyM, &pos.ReportedAt); err != nil {
			return err
		}
		if rules.IsTrackerOff(p.Effects[teamID], now) {
			continue
		}
		p.Positions[teamID] = pos
	}
	return rows.Err()
}

// hydrateRuleset populates the game's stored ruleset onto the projection.
func hydrateRuleset(ctx context.Context, conn eventstore.DBConnection, gameID string, p *GameStateProjection) {
	var rulesetBytes []byte
	if err := conn.QueryRow(ctx, `SELECT ruleset FROM games WHERE id = $1`, gameID).Scan(&rulesetBytes); err != nil {
		p.Ruleset = rules.DefaultRuleset()
		return
	}
	var rs rules.Ruleset
	if err := json.Unmarshal(rulesetBytes, &rs); err != nil {
		p.Ruleset = rules.DefaultRuleset()
		return
	}
	p.Ruleset = rules.NormalizeRuleset(rs)
}

// applyCoinRushDeadline calculates the coin rush deadline based on the first finish timestamp and ruleset configuration.
func applyCoinRushDeadline(p *GameStateProjection) {
	if p.CoinRush == nil || p.CoinRush.FirstFinishAt.IsZero() {
		return
	}
	p.CoinRush.Deadline = p.CoinRush.FirstFinishAt.Add(p.Ruleset.CoinRushCountdown())
}

// computeStandings calculates distance, coins, and finish placement to sort the standings list.
func computeStandings(p *GameStateProjection) {
	p.StandingsList = []StandingRow{}

	finishers := map[string]CoinRushFinisher{}
	if p.CoinRush != nil {
		for _, fin := range p.CoinRush.Finishers {
			finishers[fin.TeamID] = fin
		}
	}

	for teamID, team := range p.Teams {
		prog := p.Progress[teamID]
		currWP := prog.CurrentWaypointID
		if currWP == "" {
			currWP = p.startWaypointID()
		}

		var distRemaining float64
		if prog.ReachedFinish {
			distRemaining = 0.0
		} else {
			_, distRemaining = rules.ShortestRemaining(p.Board, currWP)
		}
		coins := p.Coins[teamID]

		row := StandingRow{
			TeamID:           teamID,
			TeamName:         team.Name,
			WaypointsReached: len(prog.ClearedWaypoints),
			DistanceToFinish: distRemaining,
			Coins:            coins,
			Finished:         prog.ReachedFinish,
		}
		if fin, ok := finishers[teamID]; ok {
			row.FinishRank = fin.Rank
			row.FinishBonus = fin.BonusCoins
		}
		p.StandingsList = append(p.StandingsList, row)
	}

	coinRush := p.Mode == rules.ModeCoinRush

	sort.Slice(p.StandingsList, func(i, j int) bool {
		a, b := p.StandingsList[i], p.StandingsList[j]
		if coinRush {
			return rules.CoinRushLess(
				rules.CoinRushScore{TeamID: a.TeamID, Coins: a.Coins, FinishRank: a.FinishRank},
				rules.CoinRushScore{TeamID: b.TeamID, Coins: b.Coins, FinishRank: b.FinishRank},
			)
		}
		if a.DistanceToFinish != b.DistanceToFinish {
			return a.DistanceToFinish < b.DistanceToFinish
		}
		if a.Coins != b.Coins {
			return a.Coins > b.Coins
		}
		return a.TeamID < b.TeamID
	})
}
