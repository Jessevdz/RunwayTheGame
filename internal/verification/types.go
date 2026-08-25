package verification

import (
	"time"

	"github.com/Jessevdz/RunwayTheGame/internal/rules"
)

// GPSFix represents a coordinates fix with accuracy.
type GPSFix struct {
	Lat       float64   `json:"lat"`
	Lon       float64   `json:"lon"`
	AccuracyM float64   `json:"accuracy_m"`
	Timestamp time.Time `json:"timestamp"`
}

// ExifFix represents the EXIF data extracted from a photo.
type ExifFix struct {
	Lat       *float64   `json:"lat,omitempty"`
	Lon       *float64   `json:"lon,omitempty"`
	Timestamp *time.Time `json:"timestamp,omitempty"`
}

// VerificationJobPayload is the JSON structure stored in the jobs outbox table.
type VerificationJobPayload struct {
	GameID       string             `json:"game_id"`
	SubmissionID string             `json:"submission_id"`
	WaypointID   string             `json:"waypoint_id,omitempty"`
	RoadID       string             `json:"road_id,omitempty"`
	TeamID       string             `json:"team_id"`
	BlobRef      string             `json:"blob_ref"`
	Prompt       string             `json:"prompt"`
	Rubric       rules.RubricDetail `json:"rubric"`
	GPS          GPSFix             `json:"gps"`
	PreviousGPS  *GPSFix            `json:"previous_gps,omitempty"`
	Exif         *ExifFix           `json:"exif,omitempty"`
	SecondPass   string             `json:"second_pass,omitempty"`
	// PriorVerdict and PriorConfidence store the previous evaluation result during a re-grade.
	PriorVerdict    string  `json:"prior_verdict,omitempty"`
	PriorConfidence float64 `json:"prior_confidence,omitempty"`
}

// ScalewayResponse is the parsed response from the Scaleway API.
type ScalewayResponse struct {
	Verdict     string   `json:"verdict"` // "pass" | "fail"
	Confidence  float64  `json:"confidence"`
	Rationale   string   `json:"rationale"`
	MetricValue *float64 `json:"metric_value,omitempty"`
}
