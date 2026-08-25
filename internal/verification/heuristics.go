package verification

import (
	"context"
	"fmt"
	"math"

	"github.com/Jessevdz/RunwayTheGame/internal/logger"
	"github.com/Jessevdz/RunwayTheGame/internal/rules"
)

// maxExifDriftMinutes is the maximum allowed difference (in minutes) between photo EXIF timestamp and submission time.
const maxExifDriftMinutes = 15.0

// VerifyHeuristics checks cheap constraints like GPS accuracy and implausible velocity.
// Returns (passed, rejectionRationale)
func VerifyHeuristics(ctx context.Context, payload VerificationJobPayload) (bool, string) {
	// 1. Accuracy check: Validate non-NaN accuracy and enforce 50-meter threshold.
	if math.IsNaN(payload.GPS.AccuracyM) || math.IsInf(payload.GPS.AccuracyM, 0) || payload.GPS.AccuracyM < 0 {
		return false, "Reported GPS accuracy is not a valid measurement"
	}
	if payload.GPS.AccuracyM > 50.0 {
		return false, "Reported GPS accuracy exceeds threshold of 50.0 m"
	}
	if !validCoordinate(payload.GPS.Lat, payload.GPS.Lon) {
		return false, "Reported position is not a valid coordinate"
	}

	// 2. Velocity check: validate distance and velocity against previous reported fix.
	if prev := payload.PreviousGPS; prev != nil {
		if !validCoordinate(prev.Lat, prev.Lon) {
			return false, "Previous position is not a valid coordinate"
		}
		duration := payload.GPS.Timestamp.Sub(prev.Timestamp).Seconds()
		switch {
		case duration < 0:
			return false, "Capture time precedes the previous position report"
		case duration >= rules.MinSpeedSampleSeconds:
			// Evaluate speed over gaps exceeding MinSpeedSampleSeconds.
			dist := haversine(prev.Lat, prev.Lon, payload.GPS.Lat, payload.GPS.Lon)
			if speed := dist / duration; speed > rules.MaxPlausibleSpeedMS {
				return false, fmt.Sprintf("Implausible velocity between GPS fixes (%.0f m/s)", speed)
			}
		default:
			dist := haversine(prev.Lat, prev.Lon, payload.GPS.Lat, payload.GPS.Lon)
			if maxJump := rules.MaxPlausibleSpeedMS * rules.MinSpeedSampleSeconds; dist > maxJump {
				return false, fmt.Sprintf("Position jumped %.0f m in under %.0f s", dist, rules.MinSpeedSampleSeconds)
			}
		}
	}

	// 3. Recency check: Reject a photo with no trustworthy capture timestamp or
	// whose capture timestamp deviates beyond maxExifDriftMinutes.
	if payload.Exif == nil || payload.Exif.Timestamp == nil {
		return false, "Photo has no capture timestamp (EXIF); a freshly captured photo must carry one"
	}
	diff := payload.GPS.Timestamp.Sub(*payload.Exif.Timestamp)
	if diff < 0 {
		diff = -diff
	}
	if diff.Minutes() > maxExifDriftMinutes {
		logger.Warn(ctx, "EXIF timestamp deviates significantly from submission time", map[string]interface{}{"diff_minutes": diff.Minutes()})
		return false, fmt.Sprintf("Photo timestamp is %.0f minutes from the submission (limit %.0f)", diff.Minutes(), maxExifDriftMinutes)
	}

	return true, ""
}

// validCoordinate reports whether lat and lon are valid finite coordinates within global bounds.
func validCoordinate(lat, lon float64) bool {
	if math.IsNaN(lat) || math.IsNaN(lon) || math.IsInf(lat, 0) || math.IsInf(lon, 0) {
		return false
	}
	return lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180
}

func haversine(lat1, lon1, lat2, lon2 float64) float64 {
	const R = 6371000.0 // Earth radius in meters
	dLat := (lat2 - lat1) * math.Pi / 180.0
	dLon := (lon2 - lon1) * math.Pi / 180.0
	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(lat1*math.Pi/180.0)*math.Cos(lat2*math.Pi/180.0)*
			math.Sin(dLon/2)*math.Sin(dLon/2)
	c := 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
	return R * c
}
