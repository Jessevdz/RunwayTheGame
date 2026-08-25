package api

import (
	"net/http"

	"github.com/Jessevdz/RunwayTheGame/internal/rules"
)

// ServerConfig defines public configuration capabilities and available verification modes.
type ServerConfig struct {
	// AIReferee reports whether automated photo evaluation is enabled.
	AIReferee bool `json:"ai_referee"`
	// VerificationModes lists the available verification modes supported by the server.
	VerificationModes []string `json:"verification_modes"`
	// Analytics reports whether usage metrics collection is active.
	Analytics bool `json:"analytics"`
}

// SetAIRefereeAvailable configures whether automated photo evaluation is available.
func (s *Server) SetAIRefereeAvailable(available bool) {
	s.AIReferee = available
}

// handleGetConfig returns the public server configuration and capabilities.
func (s *Server) handleGetConfig(w http.ResponseWriter, r *http.Request) {
	modes := []string{rules.VerificationTrust, rules.VerificationHost}
	if s.AIReferee {
		modes = append(modes, rules.VerificationLLM)
	}
	writeJSON(r.Context(), w, http.StatusOK, ServerConfig{
		AIReferee:         s.AIReferee,
		VerificationModes: modes,
		Analytics:         s.AnalyticsEnabled,
	})
}
