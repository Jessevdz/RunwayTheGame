// Package analytics defines the closed-vocabulary schema and sanitization logic
// for application telemetry and usage events.
package analytics

// PropKind specifies how a property value is constrained.
type PropKind int

const (
	// KindEnum accepts a string value matching an allowed set.
	KindEnum PropKind = iota
	// KindBool accepts a boolean value.
	KindBool
	// KindBucket accepts a non-negative numeric value and maps it to a range bucket.
	KindBucket
)

// OtherValue is the placeholder string for out-of-set enum values.
const OtherValue = "other"

// PropSpec defines constraints for a single event property.
type PropSpec struct {
	Kind   PropKind
	Values []string
}

// EventSpec defines allowed properties for a registered event type.
type EventSpec struct {
	Props map[string]PropSpec
}

const (
	// MaxBatch is the maximum number of events in a single payload.
	MaxBatch = 25
	// MaxProps is the maximum number of properties evaluated per event.
	MaxProps = 32
	// MaxNameLen is the maximum length of an event name.
	MaxNameLen = 48
)

// Known reports whether an event name is registered.
func Known(name string) bool {
	_, ok := Registry[name]
	return ok
}

// Sanitize returns sanitized event properties, or false if the event is unregistered.
func Sanitize(name string, props map[string]any) (map[string]any, bool) {
	spec, ok := Registry[name]
	if !ok {
		return nil, false
	}
	if len(props) == 0 || len(spec.Props) == 0 {
		return map[string]any{}, true
	}
	if len(props) > MaxProps {
		return map[string]any{}, true
	}

	clean := make(map[string]any, len(spec.Props))
	for key, ps := range spec.Props {
		raw, present := props[key]
		if !present {
			continue
		}
		if value, ok := sanitizeValue(ps, raw); ok {
			clean[key] = value
		}
	}
	return clean, true
}

func sanitizeValue(ps PropSpec, raw any) (any, bool) {
	switch ps.Kind {
	case KindEnum:
		s, isString := raw.(string)
		if !isString {
			return OtherValue, true
		}
		for _, allowed := range ps.Values {
			if s == allowed {
				return s, true
			}
		}
		return OtherValue, true

	case KindBool:
		b, isBool := raw.(bool)
		if !isBool {
			return nil, false
		}
		return b, true

	case KindBucket:
		n, isNumber := raw.(float64)
		if !isNumber || n < 0 {
			return nil, false
		}
		return Bucket(int(n)), true
	}
	return nil, false
}

// FoldableProps returns a sorted slice of property keys declared for an event.
func FoldableProps(name string) []string {
	spec, ok := Registry[name]
	if !ok {
		return nil
	}
	keys := make([]string, 0, len(spec.Props))
	for key := range spec.Props {
		keys = append(keys, key)
	}
	sortStrings(keys)
	return keys
}

func sortStrings(s []string) {
	for i := 1; i < len(s); i++ {
		for j := i; j > 0 && s[j] < s[j-1]; j-- {
			s[j], s[j-1] = s[j-1], s[j]
		}
	}
}
