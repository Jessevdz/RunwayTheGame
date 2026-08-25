package verification_test

import (
	"math"
	"testing"
	"time"

	"github.com/Jessevdz/RunwayTheGame/internal/rules"
	"github.com/Jessevdz/RunwayTheGame/internal/verification"
)

// teleport creates a payload representing an 11 km position jump at the given timestamp gap.
func teleport(gap time.Duration) verification.VerificationJobPayload {
	now := time.Now()
	return verification.VerificationJobPayload{
		Prompt: "Observatory statue",
		Rubric: rules.RubricDetail{MustShow: []string{"statue"}},
		GPS: verification.GPSFix{
			Lat: 51.4800, Lon: 0.0, AccuracyM: 10.0, Timestamp: now,
		},
		PreviousGPS: &verification.GPSFix{
			Lat: 51.5800, Lon: 0.0, AccuracyM: 10.0, Timestamp: now.Add(-gap),
		},
	}
}

// TestVelocityGateHasNoSkipBranches tests velocity validation across short, zero, and negative timestamp gaps.
func TestVelocityGateHasNoSkipBranches(t *testing.T) {
	for _, tc := range []struct {
		name string
		gap  time.Duration
	}{
		{"a gap just under the sampling floor", 9 * time.Second},
		{"a gap exactly at the sampling floor", 10 * time.Second},
		{"no gap at all", 0},
		{"a previous fix timestamped in the future", -time.Minute},
	} {
		payload := teleport(tc.gap)
		passed, rationale := verification.VerifyHeuristics(t.Context(), payload)
		if passed {
			t.Errorf("%s: an 11 km jump passed the velocity gate", tc.name)
		}
		if rationale == "" {
			t.Errorf("%s: expected a rejection rationale", tc.name)
		}
	}

	// A walk that covers a believable distance still passes.
	ok := teleport(time.Hour)
	ok.PreviousGPS.Lat = 51.4810 // ~110 m away
	cap := ok.GPS.Timestamp
	ok.Exif = &verification.ExifFix{Timestamp: &cap}
	if passed, rationale := verification.VerifyHeuristics(t.Context(), ok); !passed {
		t.Errorf("an ordinary walk was rejected: %s", rationale)
	}
}

// TestHeuristicsRejectUnusableNumbers tests that NaN, negative, and out-of-bounds inputs fail validation.
func TestHeuristicsRejectUnusableNumbers(t *testing.T) {
	base := func() verification.VerificationJobPayload {
		return verification.VerificationJobPayload{
			Prompt: "Observatory statue",
			Rubric: rules.RubricDetail{MustShow: []string{"statue"}},
			GPS:    verification.GPSFix{Lat: 51.48, Lon: 0.0, AccuracyM: 10.0, Timestamp: time.Now()},
		}
	}

	nanAccuracy := base()
	nanAccuracy.GPS.AccuracyM = math.NaN()
	if passed, _ := verification.VerifyHeuristics(t.Context(), nanAccuracy); passed {
		t.Error("a NaN accuracy passed the accuracy gate")
	}

	negAccuracy := base()
	negAccuracy.GPS.AccuracyM = -1
	if passed, _ := verification.VerifyHeuristics(t.Context(), negAccuracy); passed {
		t.Error("a negative accuracy passed the accuracy gate")
	}

	nanPosition := base()
	nanPosition.GPS.Lat = math.NaN()
	if passed, _ := verification.VerifyHeuristics(t.Context(), nanPosition); passed {
		t.Error("a NaN latitude passed the position check")
	}

	offEarth := base()
	offEarth.GPS.Lat = 3000
	if passed, _ := verification.VerifyHeuristics(t.Context(), offEarth); passed {
		t.Error("a latitude of 3000 passed the position check")
	}
}

// TestExifDriftIsRefusedNotJustLogged tests that photos with significant EXIF timestamp drift are rejected.
func TestExifDriftIsRefusedNotJustLogged(t *testing.T) {
	now := time.Now()
	old := now.Add(-3 * time.Hour)
	payload := verification.VerificationJobPayload{
		Prompt: "Observatory statue",
		Rubric: rules.RubricDetail{MustShow: []string{"statue"}},
		GPS:    verification.GPSFix{Lat: 51.48, Lon: 0.0, AccuracyM: 10.0, Timestamp: now},
		Exif:   &verification.ExifFix{Timestamp: &old},
	}
	if passed, _ := verification.VerifyHeuristics(t.Context(), payload); passed {
		t.Error("a photo timestamped three hours before submission was accepted")
	}

	// A phone clock a few minutes out is not a cheat.
	slight := now.Add(-2 * time.Minute)
	payload.Exif = &verification.ExifFix{Timestamp: &slight}
	if passed, rationale := verification.VerifyHeuristics(t.Context(), payload); !passed {
		t.Errorf("ordinary clock drift was rejected: %s", rationale)
	}
}
