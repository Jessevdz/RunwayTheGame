package rules

import (
	"fmt"
	"math"
	"time"
)

const (
	// MaxPlausibleAccuracyM is the maximum horizontal accuracy allowed for arrival confirmation.
	MaxPlausibleAccuracyM = 100.0

	// DefaultArrivalRadiusM is the fallback arrival radius when a waypoint has none configured.
	DefaultArrivalRadiusM = 25.0

	// MinArrivalRadiusM is the minimum allowed arrival radius for a waypoint.
	MinArrivalRadiusM = 5.0

	// MaxArrivalRadiusM is the maximum allowed arrival radius for a waypoint.
	MaxArrivalRadiusM = 500.0

	// MaxPlausibleSpeedMS is the maximum plausible speed in meters per second for movement checks.
	MaxPlausibleSpeedMS = 50.0

	// MinSpeedSampleSeconds is the minimum duration between fixes required for valid speed calculations.
	MinSpeedSampleSeconds = 10.0
)

// Arrival gate reasons.
const (
	ArrivalAllowed           = ""
	ArrivalReasonBadPosition = "invalid_position"
	ArrivalReasonBadAccuracy = "implausible_accuracy"
	ArrivalReasonOutOfRange  = "out_of_range"
)

// ArrivalCheck is the result of the GPS gate.
type ArrivalCheck struct {
	Allowed bool
	Reason  string // one of the ArrivalReason* constants; empty when allowed
	Message string // player-facing explanation; empty when allowed
}

// CheckArrival evaluates whether a reported GPS position and accuracy satisfy waypoint arrival conditions.
func CheckArrival(distanceM, radiusM, accuracyM float64) ArrivalCheck {
	if !isFinite(distanceM) || distanceM < 0 {
		return ArrivalCheck{
			Reason:  ArrivalReasonBadPosition,
			Message: "reported position is not a valid coordinate",
		}
	}
	if !isFinite(accuracyM) || accuracyM < 0 {
		return ArrivalCheck{
			Reason:  ArrivalReasonBadAccuracy,
			Message: "reported GPS accuracy is not a valid measurement",
		}
	}
	if accuracyM > MaxPlausibleAccuracyM {
		return ArrivalCheck{
			Reason: ArrivalReasonBadAccuracy,
			Message: fmt.Sprintf(
				"GPS accuracy of %.0f m is too poor to confirm arrival (limit %.0f m) — wait for a better fix",
				accuracyM, MaxPlausibleAccuracyM),
		}
	}

	radiusM = ClampArrivalRadiusM(radiusM)
	slack := math.Min(accuracyM, radiusM)
	if distanceM > radiusM+slack {
		return ArrivalCheck{
			Reason: ArrivalReasonOutOfRange,
			Message: fmt.Sprintf(
				"you are %.0f m from the waypoint; get within %.0f m",
				distanceM, radiusM),
		}
	}
	return ArrivalCheck{Allowed: true}
}

// ClampArrivalRadiusM forces a waypoint radius into the range the arrival gate
// is willing to honour. A missing, non-finite or non-positive radius falls back
// to the default; anything outside [Min, Max] is pulled to the nearest bound.
func ClampArrivalRadiusM(radiusM float64) float64 {
	if radiusM <= 0 || !isFinite(radiusM) {
		return DefaultArrivalRadiusM
	}
	if radiusM < MinArrivalRadiusM {
		return MinArrivalRadiusM
	}
	if radiusM > MaxArrivalRadiusM {
		return MaxArrivalRadiusM
	}
	return radiusM
}

// ImplausibleSpeed reports whether movement between two fixes exceeds maximum plausible speed thresholds.
func ImplausibleSpeed(distanceM float64, elapsed time.Duration) (bool, float64) {
	if !isFinite(distanceM) || distanceM < 0 {
		return false, 0
	}
	seconds := elapsed.Seconds()
	if seconds <= 0 {
		return false, 0
	}
	speed := distanceM / seconds
	return speed > MaxPlausibleSpeedMS, speed
}

func isFinite(f float64) bool {
	return !math.IsNaN(f) && !math.IsInf(f, 0)
}
