package projections

import (
	"strings"
	"testing"
	"time"

	"github.com/Jessevdz/RunwayTheGame/internal/eventstore"
)

// purchaseProjection folds Red buying and then using a power-up.
func purchaseProjection(t *testing.T) *GameStateProjection {
	t.Helper()
	p := namedProjection()
	e := eventstore.Event{CreatedAt: time.Date(2026, 8, 18, 10, 0, 0, 0, time.UTC)}

	foldPowerupPurchased(p, e, eventstore.PowerupPurchasedPayload{TeamID: redID, Powerup: "tracker_off", Cost: 25})
	foldCoinsChanged(p, e, eventstore.CoinsChangedPayload{TeamID: redID, Delta: -25, BalanceAfter: 5, Reason: "powerup_purchase"})
	return p
}

func TestRivalCannotSeePowerupPurchase(t *testing.T) {
	p := purchaseProjection(t)
	rival := p.RedactFor(blueID, false)
	log := strings.Join(rival.PublicLog, "\n")

	if strings.Contains(log, "purchased powerup") {
		t.Errorf("a rival team can read the purchase line: %q", log)
	}
	if strings.Contains(log, "powerup purchase") {
		t.Errorf("a rival team can read the purchase spend: %q", log)
	}
	if _, ok := rival.Inventory[redID]; ok {
		t.Error("a rival team can read another team's inventory")
	}
}

func TestBuyerSeesOwnPurchase(t *testing.T) {
	p := purchaseProjection(t)
	buyer := p.RedactFor(redID, false)
	log := strings.Join(buyer.PublicLog, "\n")

	if !strings.Contains(log, "Team Red purchased powerup: Tracker Off") {
		t.Errorf("the buyer lost its own purchase line: %q", log)
	}
	if !strings.Contains(log, "reason: powerup purchase") {
		t.Errorf("the buyer lost its own spend line: %q", log)
	}
	if got := buyer.Inventory[redID]; len(got) != 1 || got[0] != "tracker_off" {
		t.Errorf("the buyer lost its own inventory, got %v", got)
	}
}

func TestHostSeesEveryPurchase(t *testing.T) {
	p := purchaseProjection(t)
	host := p.RedactFor("", true)
	log := strings.Join(host.PublicLog, "\n")

	if !strings.Contains(log, "Team Red purchased powerup: Tracker Off") {
		t.Errorf("the host lost the purchase line: %q", log)
	}
	if _, ok := host.Inventory[redID]; !ok {
		t.Error("the host lost a team's inventory")
	}
}

// TestPowerupUseStaysPublic pins the deliberate asymmetry: buying is secret, using is not.
func TestPowerupUseStaysPublic(t *testing.T) {
	p := purchaseProjection(t)
	e := eventstore.Event{CreatedAt: time.Date(2026, 8, 18, 10, 5, 0, 0, time.UTC)}
	foldPowerupUsed(p, e, eventstore.PowerupUsedPayload{TeamID: redID, Powerup: "tracker_off"})

	log := strings.Join(p.RedactFor(blueID, false).PublicLog, "\n")
	if !strings.Contains(log, "Team Red used powerup: Tracker Off") {
		t.Errorf("a rival team should still see power-ups being used: %q", log)
	}
}

// TestCoinBalancesStayPublic pins that hiding purchases did not hide standings coins.
func TestCoinBalancesStayPublic(t *testing.T) {
	p := purchaseProjection(t)
	rival := p.RedactFor(blueID, false)
	if rival.Coins[redID] != 5 {
		t.Errorf("expected a rival to still read the coin balance, got %d", rival.Coins[redID])
	}
}

// TestUnredactedProjectionCarriesNoLog keeps the raw projection fail-closed if it is ever marshalled directly.
func TestUnredactedProjectionCarriesNoLog(t *testing.T) {
	p := purchaseProjection(t)
	if len(p.PublicLog) != 0 {
		t.Errorf("the raw projection must expose no log until redacted, got %v", p.PublicLog)
	}
}

// TestNonPurchaseCoinChangesStayPublic keeps rewards visible to everyone.
func TestNonPurchaseCoinChangesStayPublic(t *testing.T) {
	p := namedProjection()
	e := eventstore.Event{CreatedAt: time.Date(2026, 8, 18, 10, 0, 0, 0, time.UTC)}
	foldCoinsChanged(p, e, eventstore.CoinsChangedPayload{TeamID: redID, Delta: 20, BalanceAfter: 20, Reason: "challenge_reward"})

	log := strings.Join(p.RedactFor(blueID, false).PublicLog, "\n")
	if !strings.Contains(log, "Team Red coins changed by 20") {
		t.Errorf("a rival should still see earned coins: %q", log)
	}
}
