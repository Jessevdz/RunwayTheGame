package blobstore

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestValidateKeyRejectsURLShapedRefs(t *testing.T) {
	// Refuse URL-shaped references to prevent SSRF vulnerabilities.
	bad := []string{
		"",
		"http://169.254.169.254/latest/meta-data/iam/security-credentials/",
		"https://attacker.example/redirect",
		"HTTP://minio:9000/",
		"file:///etc/passwd",
		"/etc/passwd",
		"\\\\host\\share",
		"evidence/../../secret",
		"evidence/photo.jpg?X-Amz-Signature=abc",
		"evidence/photo jpg",
		"evidence/photo\n.jpg",
		strings.Repeat("a", MaxBlobKeyLen+1),
	}
	for _, key := range bad {
		if err := ValidateKey(key); err == nil {
			t.Errorf("ValidateKey(%q) = nil, want error", key)
		}
	}
}

func TestValidateKeyAcceptsOrdinaryKeys(t *testing.T) {
	good := []string{
		"e",
		"evidence",
		"test-photo.jpg",
		"evidence/6f1b2c8e-0d1a-4c2b-9f3e-7a8b9c0d1e2f.jpg",
		"capture-node_1-abc.jpg",
	}
	for _, key := range good {
		if err := ValidateKey(key); err != nil {
			t.Errorf("ValidateKey(%q) = %v, want nil", key, err)
		}
	}
}

// TestDownloadBlobNeverFetchesRefAsURL verifies that URL-shaped references are rejected rather than fetched.
func TestDownloadBlobNeverFetchesRefAsURL(t *testing.T) {
	var ssrfHit bool
	internal := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ssrfHit = true
		_, _ = w.Write([]byte("secret"))
	}))
	defer internal.Close()

	store := NewHTTPBlobStore("http://localhost:9000/runway-evidence")
	_, err := store.DownloadBlob(t.Context(), internal.URL+"/latest/meta-data/")
	if err == nil {
		t.Fatal("DownloadBlob accepted a URL-shaped blob ref")
	}
	if ssrfHit {
		t.Fatal("DownloadBlob issued a request to the attacker-chosen host")
	}
}

func TestDownloadBlobJoinsKeyUnderBase(t *testing.T) {
	var gotPath string
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		_, _ = w.Write([]byte("jpegbytes"))
	}))
	defer origin.Close()

	store := NewHTTPBlobStore(origin.URL + "/runway-evidence")
	body, err := store.DownloadBlob(t.Context(), "evidence/photo.jpg")
	if err != nil {
		t.Fatalf("DownloadBlob: %v", err)
	}
	if string(body) != "jpegbytes" {
		t.Fatalf("body = %q", body)
	}
	if gotPath != "/runway-evidence/evidence/photo.jpg" {
		t.Fatalf("path = %q, want /runway-evidence/evidence/photo.jpg", gotPath)
	}
}

// TestDownloadBlobRefusesRedirects verifies HTTP redirects are refused during download.
func TestDownloadBlobRefusesRedirects(t *testing.T) {
	var followed bool
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		followed = true
	}))
	defer target.Close()

	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target.URL, http.StatusFound)
	}))
	defer origin.Close()

	store := NewHTTPBlobStore(origin.URL)
	if _, err := store.DownloadBlob(t.Context(), "photo.jpg"); err == nil {
		t.Fatal("DownloadBlob followed a redirect")
	}
	if followed {
		t.Fatal("redirect target was contacted")
	}
}
