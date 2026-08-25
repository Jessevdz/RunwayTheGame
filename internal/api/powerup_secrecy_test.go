package api_test

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/Jessevdz/RunwayTheGame/internal/db"
)

// Power-up purchases are secret from rival teams: what a team buys is hidden until
// it is used. Balances and power-up use stay public.

// buyRace starts a race where Red has been funded and has bought a nerf.
func buyRace(t *testing.T, ctx context.Context, database *db.DB) (*race, team, team) {
	t.Helper()
	r := newRace(t, ctx, database, nil)
	red := r.join("Red", 1)
	blue := r.join("Blue", 2)
	r.start()

	r.mustPost(http.StatusOK, "/override/coins", map[string]interface{}{
		"team_id": red.ID, "delta": 50, "note": "test funding",
	}, r.HostToken)
	r.mustPost(http.StatusOK, "/shop/buy", map[string]interface{}{"powerup": "nerf"}, red.Token)
	return r, red, blue
}

// gameLiveState fetches the game view as the holder of token.
func gameLiveState(t *testing.T, ctx context.Context, r *race, token string) (log []string, inventory map[string][]string, coins map[string]int) {
	t.Helper()
	w, resp := serve(t, ctx, r.server, jsonRequest("GET", "/api/games/"+r.GameID, nil, token))
	if w.Code != http.StatusOK {
		t.Fatalf("GET game: got %d — %s", w.Code, w.Body.String())
	}
	var body struct {
		PublicLog []string            `json:"public_log"`
		Inventory map[string][]string `json:"inventory"`
		Coins     map[string]int      `json:"coins"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("failed to decode the game view: %v (%v)", err, resp)
	}
	return body.PublicLog, body.Inventory, body.Coins
}

func TestRivalTeamCannotSeePowerupPurchase(t *testing.T) {
	database, ctx := getTestDB(t)
	r, red, blue := buyRace(t, ctx, database)

	log, inventory, coins := gameLiveState(t, ctx, r, blue.Token)
	joined := strings.Join(log, "\n")

	if strings.Contains(joined, "purchased powerup") {
		t.Errorf("a rival team can read the purchase line over HTTP:\n%s", joined)
	}
	if strings.Contains(joined, "powerup purchase") {
		t.Errorf("a rival team can read the purchase spend over HTTP:\n%s", joined)
	}
	if _, ok := inventory[red.ID]; ok {
		t.Errorf("a rival team can read Red's inventory over HTTP: %v", inventory)
	}
	// Balances stay public by design, so the standings still add up.
	if coins[red.ID] != 40 {
		t.Errorf("expected a rival to still read Red's balance of 40, got %d", coins[red.ID])
	}
}

func TestBuyerAndHostSeeThePurchaseOverHTTP(t *testing.T) {
	database, ctx := getTestDB(t)
	r, red, _ := buyRace(t, ctx, database)

	buyerLog, buyerInv, _ := gameLiveState(t, ctx, r, red.Token)
	if !strings.Contains(strings.Join(buyerLog, "\n"), "purchased powerup") {
		t.Errorf("the buyer lost its own purchase line:\n%s", strings.Join(buyerLog, "\n"))
	}
	if inv := buyerInv[red.ID]; len(inv) != 1 || inv[0] != "nerf" {
		t.Errorf("the buyer lost its own inventory, got %v", buyerInv)
	}

	hostLog, hostInv, _ := gameLiveState(t, ctx, r, r.HostToken)
	if !strings.Contains(strings.Join(hostLog, "\n"), "purchased powerup") {
		t.Errorf("the host lost the purchase line:\n%s", strings.Join(hostLog, "\n"))
	}
	if _, ok := hostInv[red.ID]; !ok {
		t.Errorf("the host lost a team's inventory, got %v", hostInv)
	}
}

// TestRivalSeesPowerupUse pins that only the purchase is secret, not the use.
func TestRivalSeesPowerupUse(t *testing.T) {
	database, ctx := getTestDB(t)
	r, red, blue := buyRace(t, ctx, database)

	r.mustPost(http.StatusOK, "/powerup/use", map[string]interface{}{
		"powerup": "nerf", "target_team_id": blue.ID, "idempotency_key": "nerf-1",
	}, red.Token)

	log, _, _ := gameLiveState(t, ctx, r, blue.Token)
	if !strings.Contains(strings.Join(log, "\n"), "used powerup") {
		t.Errorf("a rival team should still see the power-up being used:\n%s", strings.Join(log, "\n"))
	}
}

// TestRivalCannotSeePurchaseInRaceReport covers the report, which is reachable mid-race.
func TestRivalCannotSeePurchaseInRaceReport(t *testing.T) {
	database, ctx := getTestDB(t)
	r, _, blue := buyRace(t, ctx, database)

	w, _ := serve(t, ctx, r.server, jsonRequest("GET", "/api/games/"+r.GameID+"/report", nil, blue.Token))
	if w.Code != http.StatusOK {
		t.Fatalf("GET report: got %d — %s", w.Code, w.Body.String())
	}
	var report struct {
		Timeline []string `json:"timeline"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &report); err != nil {
		t.Fatalf("failed to decode the report: %v", err)
	}
	if joined := strings.Join(report.Timeline, "\n"); strings.Contains(joined, "purchased powerup") {
		t.Errorf("the race report leaks a rival's purchase mid-race:\n%s", joined)
	}
}
