package main

import "testing"

// TestAIRefereeAvailable verifies that the AI referee is enabled only when both
// a backend is configured and a worker token is present.
func TestAIRefereeAvailable(t *testing.T) {
	cases := []struct {
		name        string
		workerToken string
		env         map[string]string
		want        bool
	}{
		{"nothing configured", "tok", nil, false},
		{"compose flag set from a key", "tok", map[string]string{"RUNWAY_AI_REFEREE": "1"}, true},
		// Handle concatenated flags from multiple environment variable expansions.
		{"both keys present", "tok", map[string]string{"RUNWAY_AI_REFEREE": "11"}, true},
		{"flag says no", "tok", map[string]string{"RUNWAY_AI_REFEREE": "0", "SCALEWAY_API_KEY": "sk"}, false},
		{"flag says false over a key", "tok", map[string]string{"RUNWAY_AI_REFEREE": "false", "GEMINI_API_KEY": "sk"}, false},
		{"key in a local one-shell stack", "tok", map[string]string{"SCALEWAY_API_KEY": "sk"}, true},
		{"scaleway secret key", "tok", map[string]string{"SCW_SECRET_KEY": "sk"}, true},
		// Disable the referee when worker authentication is missing.
		{"key but no worker token", "", map[string]string{"SCALEWAY_API_KEY": "sk"}, false},
		{"flag but no worker token", "", map[string]string{"RUNWAY_AI_REFEREE": "1"}, false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			// Clear environment variables before each subtest to ensure test isolation.
			for _, key := range []string{"RUNWAY_AI_REFEREE", "SCALEWAY_API_KEY", "SCW_SECRET_KEY", "GEMINI_API_KEY"} {
				t.Setenv(key, "")
			}
			for key, value := range tc.env {
				t.Setenv(key, value)
			}
			if got := aiRefereeAvailable(tc.workerToken); got != tc.want {
				t.Errorf("aiRefereeAvailable(%q) with %v = %v, want %v", tc.workerToken, tc.env, got, tc.want)
			}
		})
	}
}
