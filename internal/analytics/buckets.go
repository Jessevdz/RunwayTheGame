package analytics

var bucketBounds = []struct {
	max   int
	label string
}{
	{0, "0"},
	{1, "1"},
	{3, "2_3"},
	{7, "4_7"},
	{15, "8_15"},
	{31, "16_31"},
}

const bucketOverflow = "32_plus"

// Bucket maps a non-negative count to its range bucket label.
func Bucket(n int) string {
	for _, b := range bucketBounds {
		if n <= b.max {
			return b.label
		}
	}
	return bucketOverflow
}

// BucketLabels returns all possible bucket labels in ascending order.
func BucketLabels() []string {
	labels := make([]string, 0, len(bucketBounds)+1)
	for _, b := range bucketBounds {
		labels = append(labels, b.label)
	}
	return append(labels, bucketOverflow)
}
