package rules

import (
	"math"
	"testing"
	"time"
)

// TestCheckArrivalAccuracyCannotDisableDistance verifies that reported GPS accuracy cannot bypass distance checks.
func TestCheckArrivalAccuracyCannotDisableDistance(t *testing.T) {
	const radius = 25.0
	for _, accuracy := range []float64{0, 10, 49.9, 50, 99, MaxPlausibleAccuracyM} {
		got := CheckArrival(5000, radius, accuracy)
		if got.Allowed {
			t.Errorf("accuracy %.1f m let a team arrive from 5 km away", accuracy)
		}
	}
	// Beyond the ceiling the fix is refused on its own merits, not waved through.
	if got := CheckArrival(5000, radius, 9999); got.Allowed || got.Reason != ArrivalReasonBadAccuracy {
		t.Errorf("expected an implausible accuracy to be refused, got %+v", got)
	}
	if got := CheckArrival(1, radius, 9999); got.Allowed {
		t.Error("expected an implausible accuracy to be refused even when standing on the waypoint")
	}
}

// TestCheckArrivalClampsAnOversizedRadius verifies that oversized arrival radii are clamped to maximum limits.
func TestCheckArrivalClampsAnOversizedRadius(t *testing.T) {
	for _, radius := range []float64{MaxArrivalRadiusM + 1, 10000, 1e7, math.MaxFloat64} {
		if got := CheckArrival(10000, radius, 10); got.Allowed {
			t.Errorf("radius %.0f m let a team arrive from 10 km away", radius)
		}
	}
	// Inside the ceiling the radius is still honoured as written.
	if got := CheckArrival(400, MaxArrivalRadiusM, 0); !got.Allowed {
		t.Errorf("a legitimate wide waypoint should still admit a nearby fix, got %+v", got)
	}
}

func TestClampArrivalRadiusM(t *testing.T) {
	for _, tc := range []struct{ in, want float64 }{
		{0, DefaultArrivalRadiusM},
		{-1, DefaultArrivalRadiusM},
		{math.NaN(), DefaultArrivalRadiusM},
		{math.Inf(1), DefaultArrivalRadiusM},
		{1, MinArrivalRadiusM},
		{40, 40},
		{1e9, MaxArrivalRadiusM},
	} {
		if got := ClampArrivalRadiusM(tc.in); got != tc.want {
			t.Errorf("ClampArrivalRadiusM(%v) = %v, want %v", tc.in, got, tc.want)
		}
	}
}

func TestCheckArrival(t *testing.T) {
	const radius = 25.0
	for _, tc := range []struct {
		name       string
		dist       float64
		radius     float64
		accuracy   float64
		wantAllow  bool
		wantReason string
	}{
		{"standing on it with a perfect fix", 0, radius, 5, true, ArrivalAllowed},
		{"just inside the radius", 24, radius, 5, true, ArrivalAllowed},
		{"exactly on the radius", 25, radius, 0, true, ArrivalAllowed},
		{"just outside, no slack claimed", 26, radius, 0, false, ArrivalReasonOutOfRange},
		{"outside but inside the accuracy slack", 40, radius, 20, true, ArrivalAllowed},
		{"slack is capped at the radius", 51, radius, 100, false, ArrivalReasonOutOfRange},
		{"slack cap boundary", 50, radius, 100, true, ArrivalAllowed},
		{"accuracy beyond the ceiling", 0, radius, MaxPlausibleAccuracyM + 0.1, false, ArrivalReasonBadAccuracy},
		{"negative accuracy", 0, radius, -1, false, ArrivalReasonBadAccuracy},
		{"NaN accuracy", 0, radius, math.NaN(), false, ArrivalReasonBadAccuracy},
		{"infinite accuracy", 0, radius, math.Inf(1), false, ArrivalReasonBadAccuracy},
		{"negative distance", -1, radius, 5, false, ArrivalReasonBadPosition},
		{"NaN distance", math.NaN(), radius, 5, false, ArrivalReasonBadPosition},
		{"infinite distance", math.Inf(1), radius, 5, false, ArrivalReasonBadPosition},
		// A waypoint saved without a radius still gets a real gate.
		{"missing radius falls back to the default", DefaultArrivalRadiusM, 0, 0, true, ArrivalAllowed},
		{"missing radius still rejects a distant fix", 1000, 0, 0, false, ArrivalReasonOutOfRange},
		{"negative radius falls back to the default", 1000, -5, 0, false, ArrivalReasonOutOfRange},
	} {
		got := CheckArrival(tc.dist, tc.radius, tc.accuracy)
		if got.Allowed != tc.wantAllow || got.Reason != tc.wantReason {
			t.Errorf("%s: CheckArrival(%v, %v, %v) = {allowed:%t reason:%q}, want {allowed:%t reason:%q}",
				tc.name, tc.dist, tc.radius, tc.accuracy, got.Allowed, got.Reason, tc.wantAllow, tc.wantReason)
		}
		if !got.Allowed && got.Message == "" {
			t.Errorf("%s: refused without telling the player why", tc.name)
		}
	}
}

func TestImplausibleSpeed(t *testing.T) {
	for _, tc := range []struct {
		name    string
		dist    float64
		elapsed time.Duration
		want    bool
	}{
		{"walking pace", 100, time.Minute, false},
		{"a fast train", 20000, 10 * time.Minute, false},             // ~33 m/s
		{"teleporting across a city", 20000, 30 * time.Second, true}, // ~667 m/s
		{"exactly at the threshold", MaxPlausibleSpeedMS * 60, time.Minute, false},
		{"just past the threshold", MaxPlausibleSpeedMS*60 + 1, time.Minute, true},
		// A short-window hop is now measured over the total distance, so a
		// 10 km jump in one second is implausible.
		{"short-window teleport", 10000, time.Second, true},
		{"standing still", 0, time.Hour, false},
	} {
		got, speed := ImplausibleSpeed(tc.dist, tc.elapsed)
		if got != tc.want {
			t.Errorf("%s: ImplausibleSpeed(%v, %v) = %t (%.1f m/s), want %t", tc.name, tc.dist, tc.elapsed, got, speed, tc.want)
		}
		if got && speed <= MaxPlausibleSpeedMS {
			t.Errorf("%s: flagged as implausible but reported only %.1f m/s", tc.name, speed)
		}
	}
}
