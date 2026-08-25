package analytics

import (
	"strings"
	"testing"
)

// TestRegistryLeavesNoPropertyUnconstrained verifies that all registered properties are bounded.
func TestRegistryLeavesNoPropertyUnconstrained(t *testing.T) {
	for name, spec := range Registry {
		if len(name) > MaxNameLen {
			t.Errorf("event %q is longer than analytics_events.name allows (%d)", name, MaxNameLen)
		}
		if strings.Count(name, ".") != 1 {
			t.Errorf("event %q must be exactly namespace.action", name)
		}
		if name != strings.ToLower(name) {
			t.Errorf("event %q must be lowercase", name)
		}
		if len(spec.Props) > MaxProps {
			t.Errorf("event %q declares %d properties, over the %d bound", name, len(spec.Props), MaxProps)
		}

		for prop, ps := range spec.Props {
			switch ps.Kind {
			case KindEnum:
				if len(ps.Values) == 0 {
					t.Errorf("event %q property %q is a KindEnum with no Values — "+
						"that is an unconstrained free string, which is prohibited", name, prop)
				}
				for _, v := range ps.Values {
					if v == OtherValue {
						t.Errorf("event %q property %q lists %q explicitly; it is the "+
							"reserved catch-all and must not be an allowed value",
							name, prop, OtherValue)
					}
				}
			case KindBool, KindBucket:
				if len(ps.Values) != 0 {
					t.Errorf("event %q property %q declares Values for a non-enum kind", name, prop)
				}
			default:
				t.Errorf("event %q property %q has an unknown PropKind %d", name, prop, ps.Kind)
			}
		}
	}
}

func TestSanitizeRejectsUnknownEventNames(t *testing.T) {
	for _, name := range []string{"", "nope", "editor.invented", "EDITOR.TOOL_SELECTED"} {
		if _, ok := Sanitize(name, nil); ok {
			t.Errorf("Sanitize accepted unknown event name %q", name)
		}
	}
	if _, ok := Sanitize("editor.waypoint_added", nil); !ok {
		t.Error("Sanitize rejected a registered event")
	}
}

func TestSanitizeDropsUndeclaredProperties(t *testing.T) {
	clean, ok := Sanitize("editor.tool_selected", map[string]any{
		"tool":       "road",
		"via":        "key",
		"board_name": "Sample city center route",
		"lat":        51.5074,
		"lng":        -0.1278,
		"token":      "9f3a-secret",
	})
	if !ok {
		t.Fatal("Sanitize rejected a registered event")
	}
	if len(clean) != 2 {
		t.Fatalf("expected exactly the two declared properties, got %v", clean)
	}
	if clean["tool"] != "road" || clean["via"] != "key" {
		t.Errorf("declared properties were not preserved: %v", clean)
	}
	for _, leaked := range []string{"board_name", "lat", "lng", "token"} {
		if _, present := clean[leaked]; present {
			t.Errorf("undeclared property %q survived sanitizing", leaked)
		}
	}
}

func TestSanitizeFoldsOutOfSetEnumsToOther(t *testing.T) {
	clean, _ := Sanitize("editor.tool_selected", map[string]any{
		"tool": "a challenge prompt somebody typed",
		"via":  "click",
	})
	if clean["tool"] != OtherValue {
		t.Errorf("out-of-set enum stored as %q, want %q", clean["tool"], OtherValue)
	}
	if clean["via"] != "click" {
		t.Errorf("a valid sibling property was disturbed: %v", clean)
	}
}

func TestSanitizeRefusesValuesOfTheWrongShape(t *testing.T) {
	clean, _ := Sanitize("editor.session_ended", map[string]any{
		"duration":  "5_15m",
		"saved":     "yes",   // not a bool
		"dirty":     true,    //
		"waypoints": "eight", // not a number
	})
	if clean["duration"] != "5_15m" {
		t.Errorf("valid enum was lost: %v", clean)
	}
	if clean["dirty"] != true {
		t.Errorf("valid bool was lost: %v", clean)
	}
	if _, present := clean["saved"]; present {
		t.Error("a non-bool survived a KindBool property")
	}
	if _, present := clean["waypoints"]; present {
		t.Error("a non-number survived a KindBucket property")
	}
}

func TestSanitizeBucketsNumbersAndNeverStoresThem(t *testing.T) {
	for _, tc := range []struct {
		in   float64
		want string
	}{{0, "0"}, {1, "1"}, {2, "2_3"}, {3, "2_3"}, {7, "4_7"}, {12, "8_15"}, {31, "16_31"}, {32, "32_plus"}, {40000, "32_plus"}} {
		clean, _ := Sanitize("board.saved", map[string]any{"waypoints": tc.in})
		if clean["waypoints"] != tc.want {
			t.Errorf("Sanitize(waypoints=%v) = %v, want %q", tc.in, clean["waypoints"], tc.want)
		}
	}
	clean, _ := Sanitize("board.saved", map[string]any{"waypoints": float64(-1)})
	if _, present := clean["waypoints"]; present {
		t.Error("a negative count was bucketed instead of dropped")
	}
}

func TestSanitizeSurvivesHostileInput(t *testing.T) {
	huge := strings.Repeat("a prompt somebody typed. ", 500)
	clean, ok := Sanitize("board.saved", map[string]any{
		"result":     map[string]any{"nested": "object"},
		"waypoints":  []any{1, 2, 3},
		"has_finish": nil,
		"roads":      huge,
		"prompt":     huge,
		"position":   []any{51.5074, -0.1278},
	})
	if !ok {
		t.Fatal("Sanitize rejected a registered event")
	}
	for key, value := range clean {
		s, isString := value.(string)
		if !isString {
			if _, isBool := value.(bool); !isBool {
				t.Errorf("property %q survived as %T, which is neither a bounded label nor a bool", key, value)
			}
			continue
		}
		if len(s) > 32 {
			t.Errorf("property %q survived as a %d-character string: %.40q", key, len(s), s)
		}
		if strings.Contains(s, "typed") {
			t.Errorf("property %q leaked input text: %.40q", key, s)
		}
	}
}

func TestSanitizeIgnoresAnAbsurdlyWideMap(t *testing.T) {
	props := make(map[string]any, MaxProps+10)
	for i := 0; i < MaxProps+10; i++ {
		props[string(rune('a'+i%26))+strings.Repeat("x", i)] = "value"
	}
	props["tool"] = "road"
	clean, ok := Sanitize("editor.tool_selected", props)
	if !ok {
		t.Fatal("an oversized props map should still count the event")
	}
	if len(clean) != 0 {
		t.Errorf("an oversized props map should contribute no properties, got %v", clean)
	}
}

func TestFoldablePropsIsStablyOrdered(t *testing.T) {
	got := FoldableProps("board.saved")
	if len(got) != 10 {
		t.Fatalf("expected board.saved's ten properties, got %v", got)
	}
	for i := 1; i < len(got); i++ {
		if got[i-1] >= got[i] {
			t.Fatalf("FoldableProps is not sorted: %v", got)
		}
	}
	if FoldableProps("nope") != nil {
		t.Error("FoldableProps should return nil for an unknown event")
	}
	if len(FoldableProps("editor.waypoint_added")) != 0 {
		t.Error("a propless event should fold on no properties")
	}
}

func TestBucketLabelsCoverEveryBucket(t *testing.T) {
	labels := BucketLabels()
	seen := make(map[string]bool, len(labels))
	for _, l := range labels {
		seen[l] = true
	}
	for n := 0; n < 200; n++ {
		if !seen[Bucket(n)] {
			t.Fatalf("Bucket(%d) = %q, which BucketLabels does not list", n, Bucket(n))
		}
	}
}
