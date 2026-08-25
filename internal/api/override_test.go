package api_test

import (
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestOverrideCoinsHappyPath(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	defer database.Close()

	r := newRace(t, ctx, database, nil)
	red := r.join("Red", 0)
	r.start()

	resp := r.mustPost(http.StatusOK, "/override/coins", map[string]interface{}{
		"team_id": red.ID, "delta": 15, "note": "manual bonus",
	}, r.HostToken)
	if got := int(resp["new_balance"].(float64)); got != 15 {
		t.Fatalf("expected new_balance 15, got %v", resp["new_balance"])
	}
	if got := int(resp["applied_delta"].(float64)); got != 15 {
		t.Fatalf("expected applied_delta 15, got %v", resp["applied_delta"])
	}

	proj := r.projection()
	if proj.Coins[red.ID] != 15 {
		t.Fatalf("expected the projection to show 15 coins, got %d", proj.Coins[red.ID])
	}
	hostLog := proj.RedactFor("", true).PublicLog
	last := hostLog[len(hostLog)-1]
	if !strings.Contains(last, "[GM]") || !strings.Contains(last, "manual bonus") {
		t.Errorf("expected a GM-tagged public log entry with the note, got %q", last)
	}
}

// TestOverrideCoinsClampsAtZero covers the recommendation from the plan's open
// question: a negative adjustment clamps to zero rather than erroring, and the
// response reports the delta that was actually applied.
func TestOverrideCoinsClampsAtZero(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	defer database.Close()

	r := newRace(t, ctx, database, nil)
	red := r.join("Red", 0)
	r.start()

	r.mustPost(http.StatusOK, "/override/coins", map[string]interface{}{
		"team_id": red.ID, "delta": 10, "note": "seed balance",
	}, r.HostToken)

	resp := r.mustPost(http.StatusOK, "/override/coins", map[string]interface{}{
		"team_id": red.ID, "delta": -30, "note": "overcorrect",
	}, r.HostToken)
	if got := int(resp["new_balance"].(float64)); got != 0 {
		t.Fatalf("expected balance clamped to 0, got %v", resp["new_balance"])
	}
	if got := int(resp["applied_delta"].(float64)); got != -10 {
		t.Fatalf("expected applied_delta -10 (only enough to reach 0), got %v", resp["applied_delta"])
	}
	if proj := r.projection(); proj.Coins[red.ID] != 0 {
		t.Fatalf("expected the projection to show 0 coins, got %d", proj.Coins[red.ID])
	}
}

func TestOverrideCoinsValidation(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	defer database.Close()

	r := newRace(t, ctx, database, nil)
	red := r.join("Red", 0)
	r.start()

	if w, _ := r.post("/override/coins", map[string]interface{}{"delta": 5, "note": "x"}, r.HostToken); w.Code != http.StatusBadRequest {
		t.Errorf("missing team_id: expected 400, got %d", w.Code)
	}
	if w, _ := r.post("/override/coins", map[string]interface{}{"team_id": red.ID, "delta": 5}, r.HostToken); w.Code != http.StatusBadRequest {
		t.Errorf("missing note: expected 400, got %d", w.Code)
	}
	if w, _ := r.post("/override/coins", map[string]interface{}{"team_id": uuid.New().String(), "delta": 5, "note": "x"}, r.HostToken); w.Code != http.StatusNotFound {
		t.Errorf("nonexistent team: expected 404, got %d", w.Code)
	}
}

func TestOverrideClearChallengeHappyPath(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	defer database.Close()

	r := newRace(t, ctx, database, nil)
	red := r.join("Red", 0)
	r.start()
	r.advance(red, r.board.Mid1)

	// The gating challenge has not been cleared: the team is stuck.
	if w, _ := r.arrive(red, r.board.Mid2); w.Code != http.StatusForbidden {
		t.Fatalf("expected Mid 1's challenge to gate departure, got %d", w.Code)
	}

	resp := r.mustPost(http.StatusOK, "/override/clear-challenge", map[string]interface{}{
		"team_id": red.ID, "waypoint_id": r.board.Mid1, "note": "verdict never arrived",
	}, r.HostToken)
	if resp["status"] != "cleared" {
		t.Fatalf("expected status cleared, got %v", resp)
	}

	proj := r.projection()
	if !proj.WaypointStates[r.board.Mid1].ClearedBy[red.ID] {
		t.Fatalf("expected Mid 1 to be cleared for Red after the override")
	}
	if proj.Coins[red.ID] != 20 {
		t.Fatalf("expected the default coin reward (20) to be paid, got %d", proj.Coins[red.ID])
	}
	hostLog := proj.RedactFor("", true).PublicLog
	last := hostLog[len(hostLog)-1]
	if !strings.Contains(last, "[GM]") || !strings.Contains(last, "verdict never arrived") {
		t.Errorf("expected a GM-tagged public log entry with the note, got %q", last)
	}

	// The team is unblocked.
	if w, _ := r.arrive(red, r.board.Mid2); w.Code != http.StatusOK {
		t.Fatalf("expected Red to now advance past Mid 1, got %d", w.Code)
	}
}

func TestOverrideClearChallengeWithoutCoins(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	defer database.Close()

	r := newRace(t, ctx, database, nil)
	red := r.join("Red", 0)
	r.start()
	r.advance(red, r.board.Mid1)

	awardCoins := false
	r.mustPost(http.StatusOK, "/override/clear-challenge", map[string]interface{}{
		"team_id": red.ID, "waypoint_id": r.board.Mid1, "note": "no reward",
		"award_coins": awardCoins,
	}, r.HostToken)

	proj := r.projection()
	if !proj.WaypointStates[r.board.Mid1].ClearedBy[red.ID] {
		t.Fatalf("expected Mid 1 to be cleared for Red")
	}
	if proj.Coins[red.ID] != 0 {
		t.Fatalf("expected no coins awarded, got %d", proj.Coins[red.ID])
	}
}

func TestOverrideClearChallengeValidation(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	defer database.Close()

	r := newRace(t, ctx, database, nil)
	red := r.join("Red", 0)
	r.start()

	if w, _ := r.post("/override/clear-challenge", map[string]interface{}{"team_id": red.ID, "note": "x"}, r.HostToken); w.Code != http.StatusBadRequest {
		t.Errorf("missing waypoint_id: expected 400, got %d", w.Code)
	}
	if w, _ := r.post("/override/clear-challenge", map[string]interface{}{
		"team_id": red.ID, "waypoint_id": uuid.New().String(), "note": "x",
	}, r.HostToken); w.Code != http.StatusNotFound {
		t.Errorf("waypoint with no challenge: expected 404, got %d", w.Code)
	}
}

func TestOverrideClearEffectHappyPath(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	defer database.Close()

	r := newRace(t, ctx, database, nil)
	red := r.join("Red", 0)
	blue := r.join("Blue", 1)
	r.start()

	// Red earns and spends coins on a nerf that freezes Blue, mirroring the
	// full-race test's power-up flow.
	r.advance(red, r.board.Mid1)
	r.completeChallenge(red, r.board.Mid1, r.board.Mid1Challenge, "pass")
	r.mustPost(http.StatusOK, "/shop/buy", map[string]interface{}{"powerup": "nerf"}, red.Token)
	r.mustPost(http.StatusOK, "/powerup/use", map[string]interface{}{
		"powerup": "nerf", "target_team_id": blue.ID, "idempotency_key": uuid.New().String(),
	}, red.Token)

	if w, _ := r.arrive(blue, r.board.Mid1); w.Code != http.StatusForbidden {
		t.Fatalf("expected the frozen team to be refused movement, got %d", w.Code)
	}

	resp := r.mustPost(http.StatusOK, "/override/clear-effect", map[string]interface{}{
		"team_id": blue.ID, "effect_type": "freeze", "note": "accidental self-freeze",
	}, r.HostToken)
	if resp["status"] != "cleared" {
		t.Fatalf("expected status cleared, got %v", resp)
	}

	proj := r.projection()
	for _, eff := range proj.Effects[blue.ID] {
		if eff.Kind == "freeze" && time.Now().UTC().Before(eff.Until) {
			t.Fatalf("expected the freeze to be cleared, but it is still active")
		}
	}
	hostLog := proj.RedactFor("", true).PublicLog
	last := hostLog[len(hostLog)-1]
	if !strings.Contains(last, "[GM]") || !strings.Contains(last, "accidental self-freeze") {
		t.Errorf("expected a GM-tagged public log entry with the note, got %q", last)
	}

	if w, _ := r.arrive(blue, r.board.Mid1); w.Code != http.StatusOK {
		t.Fatalf("expected Blue to move freely after the freeze was cleared, got %d", w.Code)
	}
}

func TestOverrideClearEffectValidation(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	defer database.Close()

	r := newRace(t, ctx, database, nil)
	red := r.join("Red", 0)
	r.start()

	if w, _ := r.post("/override/clear-effect", map[string]interface{}{
		"team_id": red.ID, "effect_type": "invisibility", "note": "x",
	}, r.HostToken); w.Code != http.StatusBadRequest {
		t.Errorf("invalid effect_type: expected 400, got %d", w.Code)
	}
	if w, _ := r.post("/override/clear-effect", map[string]interface{}{
		"team_id": red.ID, "effect_type": "freeze", "note": "x",
	}, r.HostToken); w.Code != http.StatusNotFound {
		t.Errorf("no active effect of that type: expected 404, got %d", w.Code)
	}
}

// TestOverrideRoutesRequireHost covers all three override routes: no token is
// unauthorized, and a team's own capability token is not the host's.
func TestOverrideRoutesRequireHost(t *testing.T) {
	database, ctx := getTestDB(t)
	if database == nil {
		return
	}
	defer database.Close()

	r := newRace(t, ctx, database, nil)
	red := r.join("Red", 0)
	r.start()

	cases := []struct {
		name string
		path string
		body map[string]interface{}
	}{
		{"coins", "/override/coins", map[string]interface{}{"team_id": red.ID, "delta": 1, "note": "x"}},
		{"clear-challenge", "/override/clear-challenge", map[string]interface{}{"team_id": red.ID, "waypoint_id": r.board.Mid1, "note": "x"}},
		{"clear-effect", "/override/clear-effect", map[string]interface{}{"team_id": red.ID, "effect_type": "freeze", "note": "x"}},
	}
	for _, tc := range cases {
		if w, _ := r.post(tc.path, tc.body, ""); w.Code != http.StatusUnauthorized {
			t.Errorf("%s with no token: expected 401, got %d", tc.name, w.Code)
		}
		if w, _ := r.post(tc.path, tc.body, red.Token); w.Code != http.StatusForbidden {
			t.Errorf("%s with a team token: expected 403, got %d", tc.name, w.Code)
		}
	}
}
