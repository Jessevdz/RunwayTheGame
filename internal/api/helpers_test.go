package api_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/Jessevdz/RunwayTheGame/internal/api"
	"github.com/Jessevdz/RunwayTheGame/internal/blobstore"
	"github.com/Jessevdz/RunwayTheGame/internal/db"
)

// testWorkerToken is the secret token used for authenticating test worker requests.
const testWorkerToken = "test-worker-secret"

// mustEvidenceRef mints a valid evidence blob reference for tests driving the API directly.
func mustEvidenceRef(t *testing.T, gameID, teamID string) string {
	t.Helper()
	key, err := blobstore.MintEvidenceKey(gameID, teamID)
	if err != nil {
		t.Fatalf("failed to mint an evidence key: %v", err)
	}
	return key
}

func newTestServer(database *db.DB) *api.Server {
	s := api.NewServer(database)
	s.SetWorkerToken(testWorkerToken)
	return s
}

// jsonRequest constructs an HTTP request with an optional bearer token header and JSON body.
func jsonRequest(method, path string, body interface{}, token string) *http.Request {
	var reader *bytes.Reader
	if body == nil {
		reader = bytes.NewReader(nil)
	} else {
		encoded, _ := json.Marshal(body)
		reader = bytes.NewReader(encoded)
	}
	req := httptest.NewRequest(method, path, reader)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	return req
}

// serve executes an HTTP request against the test server and decodes a JSON object response.
func serve(t *testing.T, ctx context.Context, server *api.Server, req *http.Request) (*httptest.ResponseRecorder, map[string]interface{}) {
	t.Helper()
	w := httptest.NewRecorder()
	server.Router.ServeHTTP(w, req.WithContext(ctx))
	var resp map[string]interface{}
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	return w, resp
}

// serveSlice executes an HTTP request against the test server and decodes a JSON array response.
func serveSlice(t *testing.T, ctx context.Context, server *api.Server, req *http.Request) (*httptest.ResponseRecorder, []map[string]interface{}) {
	t.Helper()
	w := httptest.NewRecorder()
	server.Router.ServeHTTP(w, req.WithContext(ctx))
	var resp []map[string]interface{}
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	return w, resp
}
