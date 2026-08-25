package api_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/Jessevdz/RunwayTheGame/internal/testsupport"
)

// TestFailuresAnswerInJSON pins the one thing a client should be able to assume
// about a failed request: whatever went wrong, wherever it went wrong, the body
// is `{"error": "..."}` and the content type says so. The cases are spread
// across the middleware, the auth guards, and the handler files on purpose —
// these used to answer in plain text while the success paths answered in JSON.
func TestFailuresAnswerInJSON(t *testing.T) {
	database, ctx := testsupport.DB(t, "api")
	server := newTestServer(database)

	cases := []struct {
		name   string
		method string
		path   string
		body   interface{}
		token  string
		status int
	}{
		{"malformed body", http.MethodPost, "/api/games", nil, "", http.StatusBadRequest},
		{"missing host token", http.MethodPost, "/api/games/" + uuid.New().String() + "/start", struct{}{}, "", http.StatusUnauthorized},
		{"unknown race code", http.MethodGet, "/api/games/by-code/ZZZZZZ", nil, "", http.StatusNotFound},
		{"unknown board", http.MethodGet, "/api/boards/" + uuid.New().String(), nil, "", http.StatusNotFound},
		{"missing admin key", http.MethodGet, "/api/admin/verify", nil, "", http.StatusUnauthorized},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var req *http.Request
			if tc.name == "malformed body" {
				// A body that is not JSON at all, which no helper can express.
				req = httptest.NewRequest(tc.method, tc.path, bytes.NewReader([]byte("{not json")))
				req.Header.Set("Content-Type", "application/json")
			} else {
				req = jsonRequest(tc.method, tc.path, tc.body, tc.token)
			}

			w := httptest.NewRecorder()
			server.Router.ServeHTTP(w, req.WithContext(ctx))

			if w.Code != tc.status {
				t.Fatalf("expected %d, got %d: %s", tc.status, w.Code, w.Body.String())
			}
			if ct := w.Header().Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
				t.Errorf("content type was %q, not JSON", ct)
			}
			var body struct {
				Error string `json:"error"`
			}
			if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
				t.Fatalf("body %q did not decode as JSON: %v", w.Body.String(), err)
			}
			if body.Error == "" {
				t.Errorf("body %q carried no error message", w.Body.String())
			}
		})
	}
}
