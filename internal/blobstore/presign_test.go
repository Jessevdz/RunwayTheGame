package blobstore_test

import (
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/Jessevdz/RunwayTheGame/internal/blobstore"
)

func TestPresignUploadDefaultEndpoint(t *testing.T) {
	presigner := blobstore.NewS3Presigner(blobstore.S3Config{
		Endpoint:  "minio:9000",
		Region:    "us-east-1",
		Bucket:    "runway-evidence",
		AccessKey: "testaccess",
		SecretKey: "testsecret",
		UseSSL:    false,
		PathStyle: true,
	})

	uploadURL, err := presigner.PresignUpload(t.Context(), "test-key.jpg", "image/jpeg", 15*time.Minute)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if !strings.HasPrefix(uploadURL, "http://minio:9000/runway-evidence/test-key.jpg") {
		t.Errorf("expected URL to start with http://minio:9000/runway-evidence/test-key.jpg, got %s", uploadURL)
	}

	u, err := url.Parse(uploadURL)
	if err != nil {
		t.Fatalf("failed to parse URL: %v", err)
	}
	if u.Query().Get("X-Amz-Signature") == "" {
		t.Errorf("missing signature in presigned URL")
	}
}

func TestPresignUploadPublicEndpoint(t *testing.T) {
	presigner := blobstore.NewS3Presigner(blobstore.S3Config{
		Endpoint:       "minio:9000",
		PublicEndpoint: "https://cdn.example.com",
		Region:         "us-east-1",
		Bucket:         "runway-evidence",
		AccessKey:      "testaccess",
		SecretKey:      "testsecret",
		UseSSL:         false,
		PathStyle:      true,
	})

	uploadURL, err := presigner.PresignUpload(t.Context(), "test-key.jpg", "image/jpeg", 15*time.Minute)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if !strings.HasPrefix(uploadURL, "https://cdn.example.com/runway-evidence/test-key.jpg") {
		t.Errorf("expected URL to start with https://cdn.example.com/runway-evidence/test-key.jpg, got %s", uploadURL)
	}
}

// A caller-supplied host is never trusted to select the presigned URL host; the
// configured endpoint (or public endpoint) wins instead.
func TestPresignUploadIgnoresCallerSuppliedHost(t *testing.T) {
	presigner := blobstore.NewS3Presigner(blobstore.S3Config{
		Endpoint:  "minio:9000",
		Region:    "us-east-1",
		Bucket:    "runway-evidence",
		AccessKey: "testaccess",
		SecretKey: "testsecret",
		UseSSL:    false,
		PathStyle: true,
	})

	uploadURL, err := presigner.PresignUploadWithHost(t.Context(), "test-key.jpg", "image/jpeg", 15*time.Minute, "attacker.example.com", "https")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if !strings.HasPrefix(uploadURL, "http://minio:9000/runway-evidence/test-key.jpg") {
		t.Errorf("expected URL to use the configured endpoint, got %s", uploadURL)
	}
}

// TestPresignDownloadSignsAGet verifies GET presigned URLs generate distinct signatures from PUT requests.
func TestPresignDownloadSignsAGet(t *testing.T) {
	presigner := blobstore.NewS3Presigner(blobstore.S3Config{
		Endpoint:  "minio:9000",
		Region:    "us-east-1",
		Bucket:    "runway-evidence",
		AccessKey: "testaccess",
		SecretKey: "testsecret",
		UseSSL:    false,
		PathStyle: true,
	})

	downloadURL, err := presigner.PresignDownload(t.Context(), "evidence/photo.jpg", 30*time.Minute)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.HasPrefix(downloadURL, "http://minio:9000/runway-evidence/evidence/photo.jpg") {
		t.Errorf("expected the object's own URL, got %s", downloadURL)
	}

	u, err := url.Parse(downloadURL)
	if err != nil {
		t.Fatalf("failed to parse URL: %v", err)
	}
	if u.Query().Get("X-Amz-Signature") == "" {
		t.Error("missing signature in presigned download URL")
	}
	if got := u.Query().Get("X-Amz-Expires"); got != "1800" {
		t.Errorf("expected the requested 30m TTL, got %s", got)
	}

	// Verify that upload (PUT) and download (GET) produce distinct signatures.
	uploadURL, err := presigner.PresignUpload(t.Context(), "evidence/photo.jpg", "image/jpeg", 30*time.Minute)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	up, _ := url.Parse(uploadURL)
	if up.Query().Get("X-Amz-Signature") == u.Query().Get("X-Amz-Signature") {
		t.Error("upload and download signatures are identical: the HTTP verb is not being signed")
	}
}
