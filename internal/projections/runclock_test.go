package projections

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

// TestRunClockOmitsUnsetTimestamps verifies that zero-value time fields are omitted when marshaling RunClock.
func TestRunClockOmitsUnsetTimestamps(t *testing.T) {
	t.Run("nothing started", func(t *testing.T) {
		encoded, err := json.Marshal(RunClock{})
		if err != nil {
			t.Fatalf("failed to marshal: %v", err)
		}
		var decoded map[string]interface{}
		if err := json.Unmarshal(encoded, &decoded); err != nil {
			t.Fatalf("failed to round-trip: %v", err)
		}
		if _, present := decoded["started_at"]; present {
			t.Errorf("expected started_at to be absent, got %s", encoded)
		}
		if _, present := decoded["finished_at"]; present {
			t.Errorf("expected finished_at to be absent, got %s", encoded)
		}
		// Verify counters are present and zero.
		if decoded["time_penalty_seconds"] != float64(0) || decoded["veto_count"] != float64(0) {
			t.Errorf("expected the counters to be present and zero, got %s", encoded)
		}
		if strings.Contains(string(encoded), "0001-01-01") {
			t.Errorf("the zero time reached the wire: %s", encoded)
		}
	})

	t.Run("running", func(t *testing.T) {
		started := time.Date(2026, 7, 30, 9, 0, 0, 0, time.UTC)
		encoded, err := json.Marshal(RunClock{StartedAt: started, TimePenaltySeconds: 900, VetoCount: 1})
		if err != nil {
			t.Fatalf("failed to marshal: %v", err)
		}
		var decoded map[string]interface{}
		_ = json.Unmarshal(encoded, &decoded)
		if decoded["started_at"] == nil {
			t.Errorf("expected started_at once the run is live, got %s", encoded)
		}
		// Verify finished_at is omitted for active runs.
		if _, present := decoded["finished_at"]; present {
			t.Errorf("expected finished_at to stay absent while the run is live, got %s", encoded)
		}
		if decoded["time_penalty_seconds"] != float64(900) {
			t.Errorf("expected the penalty total on the wire, got %s", encoded)
		}
	})

	t.Run("finished", func(t *testing.T) {
		started := time.Date(2026, 7, 30, 9, 0, 0, 0, time.UTC)
		encoded, err := json.Marshal(RunClock{StartedAt: started, FinishedAt: started.Add(time.Hour)})
		if err != nil {
			t.Fatalf("failed to marshal: %v", err)
		}
		var decoded map[string]interface{}
		_ = json.Unmarshal(encoded, &decoded)
		if decoded["started_at"] == nil || decoded["finished_at"] == nil {
			t.Errorf("expected both timestamps on a finished run, got %s", encoded)
		}
	})
}

// TestRunClockElapsed verifies elapsed time calculations for live and finished runs.
func TestRunClockElapsed(t *testing.T) {
	started := time.Date(2026, 7, 30, 9, 0, 0, 0, time.UTC)
	now := started.Add(30 * time.Minute)

	// Verify unstarted run returns zero duration.
	if got := (RunClock{}).Elapsed(now); got != 0 {
		t.Errorf("expected an unstarted run to read zero, got %v", got)
	}
	// Verify live run counts up to current time.
	if got := (RunClock{StartedAt: started}).Elapsed(now); got != 30*time.Minute {
		t.Errorf("expected a live run to count to now, got %v", got)
	}
	// Verify finished run elapsed time stops at finish timestamp.
	finished := RunClock{StartedAt: started, FinishedAt: started.Add(20 * time.Minute)}
	if got := finished.Elapsed(now); got != 20*time.Minute {
		t.Errorf("expected a finished run to stop at its finish, got %v", got)
	}
	if got := finished.Elapsed(now.Add(24 * time.Hour)); got != 20*time.Minute {
		t.Errorf("expected a finished run to stay stopped, got %v", got)
	}
	// Verify time penalties are added to elapsed time.
	penalised := RunClock{StartedAt: started, TimePenaltySeconds: 900}
	if got := penalised.Elapsed(now); got != 45*time.Minute {
		t.Errorf("expected 30m + 15m of penalties, got %v", got)
	}
}
