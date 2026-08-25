package geo

import (
	"context"
	"fmt"
	"math"

	"github.com/Jessevdz/RunwayTheGame/internal/db"
)

// GeodesicLength computes the distance in meters between two lat/lon points using PostGIS ST_Length.
func GeodesicLength(ctx context.Context, database *db.DB, lat1, lon1, lat2, lon2 float64) (float64, error) {
	wkt := fmt.Sprintf("LINESTRING(%f %f, %f %f)", lon1, lat1, lon2, lat2)
	var length float64
	query := "SELECT ST_Length(ST_GeographyFromText($1))"
	err := database.Pool.QueryRow(ctx, query, wkt).Scan(&length)
	if err != nil {
		return 0, fmt.Errorf("failed to calculate geodesic length via PostGIS: %w", err)
	}
	return length, nil
}

// DistanceM computes the Haversine distance in meters between two lat/lon coordinates.
func DistanceM(lat1, lon1, lat2, lon2 float64) float64 {
	const R = 6371000 // Earth radius in meters
	rad := math.Pi / 180.0
	dLat := (lat2 - lat1) * rad
	dLon := (lon2 - lon1) * rad
	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(lat1*rad)*math.Cos(lat2*rad)*
			math.Sin(dLon/2)*math.Sin(dLon/2)
	c := 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
	return R * c
}
