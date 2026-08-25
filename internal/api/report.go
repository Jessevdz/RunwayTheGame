package api

import (
	"context"
	"encoding/json"
	"net/http"
	"sort"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/Jessevdz/RunwayTheGame/internal/eventstore"
	"github.com/Jessevdz/RunwayTheGame/internal/logger"
	"github.com/Jessevdz/RunwayTheGame/internal/projections"
	"github.com/Jessevdz/RunwayTheGame/internal/rules"
)

// ReportEvidence represents submission evidence and associated metadata.
type ReportEvidence struct {
	SubmissionID string `json:"submission_id"`
	TeamID       string `json:"team_id"`
	TeamName     string `json:"team_name"`
	// Kind is "challenge" or "roadblock".
	Kind string `json:"kind"`
	// WaypointID and WaypointName specify the target location, if applicable.
	WaypointID   string `json:"waypoint_id,omitempty"`
	WaypointName string `json:"waypoint_name,omitempty"`
	RoadID       string `json:"road_id,omitempty"`
	ChallengeID  string `json:"challenge_id,omitempty"`
	// Prompt is the challenge description presented to the player.
	Prompt string `json:"prompt,omitempty"`
	Status string `json:"status"`
	// Source indicates the grading mechanism ("llm", "host", or "trust").
	Source     string  `json:"source,omitempty"`
	Confidence float64 `json:"confidence,omitempty"`
	Rationale  string  `json:"rationale,omitempty"`
	// Disputed indicates whether the verdict was challenged.
	Disputed      bool   `json:"disputed"`
	DisputeStatus string `json:"dispute_status,omitempty"`
	// PhotoURL is a temporary presigned URL for the evidence photo.
	PhotoURL       string     `json:"photo_url,omitempty"`
	PhotoDeletedAt *time.Time `json:"photo_deleted_at,omitempty"`
	// Client capture metadata and coordinates.
	Lat              *float64   `json:"lat,omitempty"`
	Lon              *float64   `json:"lon,omitempty"`
	AccuracyM        *float64   `json:"accuracy_m,omitempty"`
	ClientCapturedAt *time.Time `json:"client_captured_at,omitempty"`
	SubmittedAt      time.Time  `json:"submitted_at"`
}

// ReportStats holds aggregated metrics for post-race reporting.
type ReportStats struct {
	Submissions        int `json:"submissions"`
	Passed             int `json:"passed"`
	Failed             int `json:"failed"`
	Pending            int `json:"pending"`
	Vetoes             int `json:"vetoes"`
	WaypointsReached   int `json:"waypoints_reached"`
	Disputes           int `json:"disputes"`
	DisputesUpheld     int `json:"disputes_upheld"`
	DisputesOverturned int `json:"disputes_overturned"`
	// GMOverrides counts manual game master interventions.
	GMOverrides int `json:"gm_overrides"`
	// CoinsEarned counts coins earned excluding placement bonuses.
	CoinsEarned      int `json:"coins_earned"`
	CoinsSpent       int `json:"coins_spent"`
	FinishBonuses    int `json:"finish_bonuses"`
	PowerupsBought   int `json:"powerups_bought"`
	PowerupsUsed     int `json:"powerups_used"`
	RoadblocksPlaced int `json:"roadblocks_placed"`
	CursesPlayed     int `json:"curses_played"`
	// FlaggedArrivals counts arrival events flagged for position discrepancies.
	FlaggedArrivals int `json:"flagged_arrivals"`
	PhotosStored    int `json:"photos_stored"`
	PhotosDeleted   int `json:"photos_deleted"`
	// DurationSeconds is the total wall-clock duration of the race in seconds.
	DurationSeconds int `json:"duration_seconds"`
}

// ReportRetention specifies data retention policy details and deletion permissions.
type ReportRetention struct {
	Days      int       `json:"days"`
	ExpiresAt time.Time `json:"expires_at"`
	// CanDeleteAll indicates whether the caller can delete the entire race.
	CanDeleteAll bool `json:"can_delete_all"`
	// CanDeleteMine indicates whether the caller can delete its own team's evidence.
	CanDeleteMine bool `json:"can_delete_mine"`
}

// RaceReport represents a comprehensive summary of a completed or active race.
type RaceReport struct {
	GameID   string `json:"game_id"`
	RaceCode string `json:"race_code,omitempty"`
	Mode     string `json:"mode"`
	Status   string `json:"status"`
	// Verification is the evidence verification mode used during the race.
	Verification string `json:"verification"`
	BoardID      string `json:"board_id"`
	BoardVersion int    `json:"board_version"`
	BoardName    string `json:"board_name"`

	CreatedAt time.Time  `json:"created_at"`
	StartedAt *time.Time `json:"started_at,omitempty"`
	EndedAt   *time.Time `json:"ended_at,omitempty"`

	Retention ReportRetention `json:"retention"`

	WinnerTeamID string                          `json:"winner_team_id,omitempty"`
	WinnerName   string                          `json:"winner_name,omitempty"`
	Teams        map[string]projections.TeamInfo `json:"teams"`
	Standings    []projections.StandingRow       `json:"standings"`
	Clock        projections.RunClock            `json:"clock"`
	Stats        ReportStats                     `json:"stats"`
	Evidence     []ReportEvidence                `json:"evidence"`
	Timeline     []string                        `json:"timeline"`
}

// handleGetRaceReport returns a comprehensive report for the specified race.
func (s *Server) handleGetRaceReport(w http.ResponseWriter, r *http.Request) {
	gameID := chi.URLParam(r, "game_id")
	viewer := participantFrom(r.Context())

	proj, err := projections.RebuildProjection(r.Context(), s.DB.Pool, gameID, 0)
	if err != nil {
		logger.Error(r.Context(), "failed to rebuild the race", map[string]interface{}{"game_id": gameID, "error": err.Error()})
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to rebuild the race")
		return
	}
	// The report is reachable mid-race, so its timeline obeys the same scoping as the live feed.
	view := proj.RedactFor(viewer.TeamID, viewer.isHost())

	var createdAt time.Time
	var raceCode *string
	if err := s.DB.Pool.QueryRow(r.Context(), `
		SELECT created_at, race_code FROM games WHERE id = $1
	`, gameID).Scan(&createdAt, &raceCode); err != nil {
		writeError(r.Context(), w, http.StatusNotFound, "game not found")
		return
	}

	report := RaceReport{
		GameID:       gameID,
		Mode:         proj.Mode,
		Status:       proj.Status,
		Verification: proj.Ruleset.Verification,
		BoardID:      proj.Board.ID,
		BoardVersion: proj.Board.Version,
		BoardName:    proj.Board.Name,
		CreatedAt:    createdAt,
		Teams:        proj.Teams,
		Standings:    proj.StandingsList,
		Clock:        proj.Clock,
		Timeline:     view.PublicLog,
		WinnerTeamID: proj.Winner,
	}
	if raceCode != nil {
		report.RaceCode = *raceCode
	}
	if winner, ok := proj.Teams[proj.Winner]; ok {
		report.WinnerName = winner.Name
	}
	if report.Timeline == nil {
		report.Timeline = []string{}
	}

	stats, startedAt, endedAt, err := s.reportStats(r.Context(), gameID, proj)
	if err != nil {
		logger.Error(r.Context(), "failed to count the race", map[string]interface{}{"game_id": gameID, "error": err.Error()})
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to count the race")
		return
	}
	if !startedAt.IsZero() {
		report.StartedAt = &startedAt
	}
	if !endedAt.IsZero() {
		report.EndedAt = &endedAt
	}

	evidence, photoCounts, err := s.reportEvidence(r, gameID, proj, viewer.TeamID)
	if err != nil {
		logger.Error(r.Context(), "failed to read the race's evidence", map[string]interface{}{"game_id": gameID, "error": err.Error()})
		writeError(r.Context(), w, http.StatusInternalServerError, "failed to read the race's evidence")
		return
	}
	stats.PhotosStored = photoCounts.stored
	stats.PhotosDeleted = photoCounts.deleted
	report.Evidence = evidence
	report.Stats = stats

	// Calculate retention expiration based on end time or creation time.
	expiryBasis := createdAt
	if !endedAt.IsZero() {
		expiryBasis = endedAt
	}
	report.Retention = ReportRetention{
		Days:          RetentionDays,
		ExpiresAt:     expiryBasis.Add(RetentionWindow),
		CanDeleteAll:  viewer.isHost(),
		CanDeleteMine: viewer.Role == roleTeam,
	}

	writeJSON(r.Context(), w, http.StatusOK, report)
}

type photoCounts struct {
	stored  int
	deleted int
}

// reportEvidence retrieves submission evidence details and photo metadata for a race.
// scopeTeam limits sensitive grading metadata and presigned URLs to a single team; empty means the caller may see all.
func (s *Server) reportEvidence(r *http.Request, gameID string, proj *projections.GameStateProjection, scopeTeam string) ([]ReportEvidence, photoCounts, error) {
	var counts photoCounts

	rows, err := s.DB.Pool.Query(r.Context(), `
		SELECT s.id::text,
		       s.team_id::text,
		       COALESCE(t.name, ''),
		       COALESCE(s.kind, 'challenge'),
		       COALESCE(s.road_id::text, ''),
		       COALESCE(s.challenge_id::text, ''),
		       s.blob_ref,
		       s.blob_deleted_at,
		       s.client_captured_at,
		       s.server_received_at,
		       s.status
		FROM challenge_submissions s
		LEFT JOIN game_teams t ON t.id = s.team_id
		WHERE s.game_id = $1
		ORDER BY s.server_received_at ASC
	`, gameID)
	if err != nil {
		return nil, counts, err
	}
	defer rows.Close()

	// Map prompts and waypoints from the game's pinned board definition.
	promptByChallenge := make(map[string]string, len(proj.Board.Challenges))
	waypointByChallenge := make(map[string]rules.Waypoint, len(proj.Board.Challenges))
	for _, c := range proj.Board.Challenges {
		promptByChallenge[c.ID] = c.Prompt
	}
	for _, wp := range proj.Board.Waypoints {
		if wp.ChallengeID != "" {
			waypointByChallenge[wp.ChallengeID] = wp
		}
	}

	// Map disputes by submission ID.
	disputeBySubmission := make(map[string]projections.DisputeInfo, len(proj.Disputes))
	for _, d := range proj.Disputes {
		disputeBySubmission[d.VerdictID] = d
	}

	reqHost, reqScheme := forwardedHostAndScheme(r)

	items := []ReportEvidence{}
	for rows.Next() {
		var item ReportEvidence
		var blobRef string
		var deletedAt, capturedAt *time.Time
		if err := rows.Scan(
			&item.SubmissionID, &item.TeamID, &item.TeamName, &item.Kind,
			&item.RoadID, &item.ChallengeID, &blobRef, &deletedAt,
			&capturedAt, &item.SubmittedAt, &item.Status,
		); err != nil {
			return nil, counts, err
		}
		item.ClientCapturedAt = capturedAt
		item.PhotoDeletedAt = deletedAt

		// Fall back to projection team name if missing from database row.
		if item.TeamName == "" {
			if info, ok := proj.Teams[item.TeamID]; ok {
				item.TeamName = info.Name
			}
		}

		if sub, ok := proj.Submissions[item.SubmissionID]; ok {
			item.Status = sub.Status
			if scopeTeam == "" || item.TeamID == scopeTeam {
				item.Source = sub.Source
				item.Confidence = sub.Confidence
				item.Rationale = sub.Rationale
			}
		}
		if d, ok := disputeBySubmission[item.SubmissionID]; ok {
			item.Disputed = true
			item.DisputeStatus = d.Status
		}

		item.Prompt = promptByChallenge[item.ChallengeID]
		if wp, ok := waypointByChallenge[item.ChallengeID]; ok {
			item.WaypointID = wp.ID
			item.WaypointName = wp.Name
		}
		// Roadblock prompts are populated from roadblock challenge text.
		if item.Prompt == "" && item.RoadID != "" {
			if rb, ok := proj.Roadblocks[item.RoadID]; ok {
				item.Prompt = rb.ChallengeText
			}
		}

		if deletedAt != nil || blobRef == "" {
			counts.deleted++
		} else {
			counts.stored++
			if scopeTeam == "" || item.TeamID == scopeTeam {
				item.PhotoURL = s.presignReviewPhoto(r.Context(), blobRef, reqHost, reqScheme)
			}
		}

		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, counts, err
	}

	// Sort evidence by submission time, newest first.
	sort.SliceStable(items, func(i, j int) bool {
		return items[i].SubmittedAt.After(items[j].SubmittedAt)
	})
	return items, counts, nil
}

// reportStats calculates aggregated metrics and start/end timestamps from race events.
func (s *Server) reportStats(ctx context.Context, gameID string, proj *projections.GameStateProjection) (ReportStats, time.Time, time.Time, error) {
	var stats ReportStats
	var startedAt, endedAt time.Time

	for _, sub := range proj.Submissions {
		stats.Submissions++
		switch sub.Status {
		case "pass":
			stats.Passed++
		case "fail":
			stats.Failed++
		default:
			stats.Pending++
		}
	}
	for _, d := range proj.Disputes {
		stats.Disputes++
		switch d.Status {
		case "upheld":
			stats.DisputesUpheld++
		case "overturned":
			stats.DisputesOverturned++
		}
	}

	rows, err := s.DB.Pool.Query(ctx, `
		SELECT event_type, payload, created_at
		FROM events WHERE game_id = $1 ORDER BY sequence ASC
	`, gameID)
	if err != nil {
		return stats, startedAt, endedAt, err
	}
	defer rows.Close()

	for rows.Next() {
		var eventType string
		var payload []byte
		var createdAt time.Time
		if err := rows.Scan(&eventType, &payload, &createdAt); err != nil {
			return stats, startedAt, endedAt, err
		}

		switch eventType {
		case "GameStarted":
			startedAt = createdAt
		case "GameEnded":
			endedAt = createdAt
		case "WaypointReached":
			stats.WaypointsReached++
		case "ChallengeVetoed":
			stats.Vetoes++
		case "PowerupPurchased":
			stats.PowerupsBought++
		case "PowerupUsed":
			stats.PowerupsUsed++
		case "RoadblockPlaced":
			stats.RoadblocksPlaced++
		case "CurseApplied":
			stats.CursesPlayed++
		case "ArrivalFlagged":
			stats.FlaggedArrivals++
		case "EffectCleared":
			stats.GMOverrides++
		case "ChallengeCompleted":
			var p eventstore.ChallengeCompletedPayload
			if err := json.Unmarshal(payload, &p); err == nil && p.Source == "gm" {
				stats.GMOverrides++
			}
		case "CoinsChanged":
			var p eventstore.CoinsChangedPayload
			if err := json.Unmarshal(payload, &p); err != nil {
				continue
			}
			switch {
			case p.Reason == "finish_bonus":
				stats.FinishBonuses += p.Delta
			case p.Delta > 0:
				stats.CoinsEarned += p.Delta
			case p.Delta < 0:
				stats.CoinsSpent += -p.Delta
			}
			// Count manual GM override coin adjustments.
			if p.Reason == "gm_override" {
				stats.GMOverrides++
			}
		}
	}
	if err := rows.Err(); err != nil {
		return stats, startedAt, endedAt, err
	}

	if !startedAt.IsZero() {
		finish := endedAt
		if finish.IsZero() {
			finish = time.Now().UTC()
		}
		if d := int(finish.Sub(startedAt).Seconds()); d > 0 {
			stats.DurationSeconds = d
		}
	}

	return stats, startedAt, endedAt, nil
}
