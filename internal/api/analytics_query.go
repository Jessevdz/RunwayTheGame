package api

// The read half of the telemetry the ingest endpoint writes. Everything here is
// an aggregate: counts by day, by event and by allowlisted property value. No
// endpoint returns a row of analytics_events, because a single row is the only
// shape this data has that could ever be about somebody.

import (
	"context"
	"net/http"
	"strconv"
	"time"

	"github.com/Jessevdz/RunwayTheGame/internal/analytics"
	"github.com/Jessevdz/RunwayTheGame/internal/logger"
)

const (
	// analyticsDefaultDays is the window an overview covers when none is asked for.
	analyticsDefaultDays = 30
	// analyticsMaxDays matches the retention window, so a wider ask cannot
	// suggest that data exists beyond the point it is deleted.
	analyticsMaxDays = AnalyticsRetentionDays
	// analyticsMaxBreakdownRows caps the property fold, which is the only query
	// here whose row count is not bounded by the event vocabulary.
	analyticsMaxBreakdownRows = 2000
)

// analyticsTotals is the headline count for the whole window.
type analyticsTotals struct {
	Events   int `json:"events"`
	Sessions int `json:"sessions"`
	// ActiveDays is how many days in the window recorded anything at all.
	ActiveDays int `json:"active_days"`
}

// analyticsDay is one day of the series, present even when it recorded nothing.
type analyticsDay struct {
	Day      string `json:"day"`
	Events   int    `json:"events"`
	Sessions int    `json:"sessions"`
}

// analyticsEventCount is one registered event name and how often it happened.
type analyticsEventCount struct {
	Name     string `json:"name"`
	Events   int    `json:"events"`
	Sessions int    `json:"sessions"`
}

// analyticsValue is one value of one property, and its share of that property.
type analyticsValue struct {
	Value string `json:"value"`
	Count int    `json:"count"`
}

// analyticsBreakdown is one property of one event, folded by value.
type analyticsBreakdown struct {
	Name   string           `json:"name"`
	Prop   string           `json:"prop"`
	Values []analyticsValue `json:"values"`
}

// analyticsOverview is the whole answer to "who is here and what are they doing".
type analyticsOverview struct {
	Days       int                   `json:"days"`
	Since      string                `json:"since"`
	Enabled    bool                  `json:"enabled"`
	Totals     analyticsTotals       `json:"totals"`
	Daily      []analyticsDay        `json:"daily"`
	Events     []analyticsEventCount `json:"events"`
	Breakdowns []analyticsBreakdown  `json:"breakdowns"`
}

// analyticsWindow resolves the requested day count onto the allowed range.
func analyticsWindow(raw string) int {
	days, err := strconv.Atoi(raw)
	if err != nil || days < 1 {
		return analyticsDefaultDays
	}
	if days > analyticsMaxDays {
		return analyticsMaxDays
	}
	return days
}

// handleAnalyticsOverview returns aggregated usage for the requested window.
func (s *Server) handleAnalyticsOverview(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	if authorized, limited := s.isAdminAuthorized(r); !authorized {
		writeAdminAuthFailure(w, r, limited, "unauthorized: invalid or missing admin credential")
		return
	}
	if s.DB == nil || s.DB.Pool == nil {
		writeError(ctx, w, http.StatusServiceUnavailable, "database unavailable")
		return
	}

	days := analyticsWindow(r.URL.Query().Get("days"))
	// The window is a count of days ending today, so a 30-day window starts 29
	// days ago and includes today.
	since := time.Now().UTC().AddDate(0, 0, -(days - 1)).Truncate(24 * time.Hour)

	overview := analyticsOverview{
		Days:       days,
		Since:      since.Format("2006-01-02"),
		Enabled:    s.AnalyticsEnabled,
		Daily:      []analyticsDay{},
		Events:     []analyticsEventCount{},
		Breakdowns: []analyticsBreakdown{},
	}

	daily, err := s.analyticsDaily(ctx, since)
	if err != nil {
		logger.Error(ctx, "analytics: failed to read the daily series", map[string]interface{}{"error": err.Error()})
		writeError(ctx, w, http.StatusInternalServerError, "failed to load usage analytics")
		return
	}
	overview.Daily = daily
	for _, day := range daily {
		overview.Totals.Events += day.Events
		if day.Events > 0 {
			overview.Totals.ActiveDays++
		}
	}

	// Sessions span days, so the window total is its own query rather than a
	// sum of daily figures that would count a returning session twice.
	if err := s.DB.Pool.QueryRow(ctx, `
		SELECT COUNT(DISTINCT session_id) FROM analytics_events WHERE occurred_on >= $1
	`, since).Scan(&overview.Totals.Sessions); err != nil {
		logger.Error(ctx, "analytics: failed to count sessions", map[string]interface{}{"error": err.Error()})
		writeError(ctx, w, http.StatusInternalServerError, "failed to load usage analytics")
		return
	}

	events, err := s.analyticsEventCounts(ctx, since)
	if err != nil {
		logger.Error(ctx, "analytics: failed to count events", map[string]interface{}{"error": err.Error()})
		writeError(ctx, w, http.StatusInternalServerError, "failed to load usage analytics")
		return
	}
	overview.Events = events

	breakdowns, err := s.analyticsBreakdowns(ctx, since)
	if err != nil {
		logger.Error(ctx, "analytics: failed to fold event properties", map[string]interface{}{"error": err.Error()})
		writeError(ctx, w, http.StatusInternalServerError, "failed to load usage analytics")
		return
	}
	overview.Breakdowns = breakdowns

	writeJSON(ctx, w, http.StatusOK, overview)
}

// analyticsDaily returns one row per day in the window, zero-filled.
func (s *Server) analyticsDaily(ctx context.Context, since time.Time) ([]analyticsDay, error) {
	rows, err := s.DB.Pool.Query(ctx, `
		SELECT series.day::date,
		       COALESCE(agg.events, 0),
		       COALESCE(agg.sessions, 0)
		  FROM generate_series($1::date, (NOW() AT TIME ZONE 'utc')::date, INTERVAL '1 day') AS series(day)
		  LEFT JOIN (
		        SELECT occurred_on,
		               COUNT(*) AS events,
		               COUNT(DISTINCT session_id) AS sessions
		          FROM analytics_events
		         WHERE occurred_on >= $1
		         GROUP BY occurred_on
		  ) AS agg ON agg.occurred_on = series.day::date
		 ORDER BY series.day
	`, since)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	days := []analyticsDay{}
	for rows.Next() {
		var day time.Time
		var entry analyticsDay
		if err := rows.Scan(&day, &entry.Events, &entry.Sessions); err != nil {
			return nil, err
		}
		entry.Day = day.Format("2006-01-02")
		days = append(days, entry)
	}
	return days, rows.Err()
}

// analyticsEventCounts returns every event name seen in the window, busiest first.
func (s *Server) analyticsEventCounts(ctx context.Context, since time.Time) ([]analyticsEventCount, error) {
	rows, err := s.DB.Pool.Query(ctx, `
		SELECT name, COUNT(*), COUNT(DISTINCT session_id)
		  FROM analytics_events
		 WHERE occurred_on >= $1
		 GROUP BY name
		 ORDER BY COUNT(*) DESC, name
	`, since)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	counts := []analyticsEventCount{}
	for rows.Next() {
		var entry analyticsEventCount
		if err := rows.Scan(&entry.Name, &entry.Events, &entry.Sessions); err != nil {
			return nil, err
		}
		counts = append(counts, entry)
	}
	return counts, rows.Err()
}

// analyticsBreakdowns folds each event's allowlisted properties by value.
// Properties the registry no longer declares are dropped rather than shown:
// the vocabulary is what makes a stored value safe to display.
func (s *Server) analyticsBreakdowns(ctx context.Context, since time.Time) ([]analyticsBreakdown, error) {
	rows, err := s.DB.Pool.Query(ctx, `
		SELECT e.name, p.key, p.value, COUNT(*)
		  FROM analytics_events e, LATERAL jsonb_each_text(e.props) AS p(key, value)
		 WHERE e.occurred_on >= $1
		 GROUP BY e.name, p.key, p.value
		 ORDER BY e.name, p.key, COUNT(*) DESC, p.value
		 LIMIT $2
	`, since, analyticsMaxBreakdownRows)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	// Keyed by name and prop, with a slice alongside so the query's ordering survives.
	index := map[string]int{}
	breakdowns := []analyticsBreakdown{}

	for rows.Next() {
		var name, key, value string
		var count int
		if err := rows.Scan(&name, &key, &value, &count); err != nil {
			return nil, err
		}
		if !declaredProp(name, key) {
			continue
		}
		slot, seen := index[name+"\x00"+key]
		if !seen {
			slot = len(breakdowns)
			index[name+"\x00"+key] = slot
			breakdowns = append(breakdowns, analyticsBreakdown{Name: name, Prop: key, Values: []analyticsValue{}})
		}
		breakdowns[slot].Values = append(breakdowns[slot].Values, analyticsValue{Value: value, Count: count})
	}
	return breakdowns, rows.Err()
}

// declaredProp reports whether the registry still declares a property for an event.
func declaredProp(name, key string) bool {
	for _, declared := range analytics.FoldableProps(name) {
		if declared == key {
			return true
		}
	}
	return false
}
