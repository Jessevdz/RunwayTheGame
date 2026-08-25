package api_test

import (
	"net/http"
	"testing"

	"github.com/Jessevdz/RunwayTheGame/internal/api"
)

// newConfiglessServer builds an api.Server without a database connection.
func newConfiglessServer() *api.Server {
	s := api.NewServer(nil)
	s.SetWorkerToken(testWorkerToken)
	return s
}

// modesOf pulls the advertised grading modes out of a config response.
func modesOf(t *testing.T, resp map[string]interface{}) []string {
	t.Helper()
	raw, ok := resp["verification_modes"].([]interface{})
	if !ok {
		t.Fatalf("expected verification_modes in the config response, got %v", resp)
	}
	modes := make([]string, 0, len(raw))
	for _, m := range raw {
		modes = append(modes, m.(string))
	}
	return modes
}

// TestConfigWithholdsTheAIRefereeByDefault verifies unconfigured servers do not advertise AI referee capabilities.
func TestConfigWithholdsTheAIRefereeByDefault(t *testing.T) {
	server := newConfiglessServer()

	w, resp := serve(t, t.Context(), server, jsonRequest("GET", "/api/config", nil, ""))
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 from the public config route, got %d: %s", w.Code, w.Body.String())
	}
	if resp["ai_referee"] != false {
		t.Errorf("expected ai_referee false with no AI backend configured, got %v", resp["ai_referee"])
	}
	modes := modesOf(t, resp)
	for _, m := range modes {
		if m == "llm" {
			t.Errorf("an unconfigured server advertised llm grading: %v", modes)
		}
	}
	// Order is the contract, not just the contents: the launchers render these
	// as a row and the honour system is the default, so it comes first.
	if len(modes) != 2 || modes[0] != "trust" || modes[1] != "host" {
		t.Errorf("expected [trust host], got %v", modes)
	}
}

// TestConfigOffersTheAIRefereeWhenConfigured verifies AI referee mode is advertised when explicitly enabled.
func TestConfigOffersTheAIRefereeWhenConfigured(t *testing.T) {
	server := newConfiglessServer()
	server.SetAIRefereeAvailable(true)

	_, resp := serve(t, t.Context(), server, jsonRequest("GET", "/api/config", nil, ""))
	if resp["ai_referee"] != true {
		t.Errorf("expected ai_referee true once configured, got %v", resp["ai_referee"])
	}
	modes := modesOf(t, resp)
	if len(modes) != 3 || modes[2] != "llm" {
		t.Errorf("expected llm advertised last, got %v", modes)
	}
}
