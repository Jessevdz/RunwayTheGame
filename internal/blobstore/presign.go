package blobstore

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Presigner mints short-lived presigned URLs for direct object storage operations.
type Presigner interface {
	PresignUpload(ctx context.Context, key string, contentType string, ttl time.Duration) (string, error)
	// PresignDownload returns a temporary presigned URL for reading an object.
	PresignDownload(ctx context.Context, key string, ttl time.Duration) (string, error)
}

// Deleter removes an object from storage.
type Deleter interface {
	DeleteObject(ctx context.Context, key string) error
}

// S3Config configures an S3-compatible storage endpoint.
type S3Config struct {
	Endpoint       string // Host and optional port without scheme.
	PublicEndpoint string // Optional external host or URL for browser links.
	Region         string
	Bucket         string
	AccessKey      string
	SecretKey      string
	UseSSL         bool
	// PathStyle addresses objects as endpoint/bucket/key instead of bucket.endpoint/key.
	PathStyle bool
}

// S3Presigner mints presigned URLs using AWS SigV4 query signing.
type S3Presigner struct {
	cfg S3Config
}

// NewS3Presigner creates a presigner for the given S3-compatible endpoint.
func NewS3Presigner(cfg S3Config) *S3Presigner {
	if cfg.Region == "" {
		cfg.Region = "us-east-1"
	}
	return &S3Presigner{cfg: cfg}
}

// PresignUpload returns a presigned PUT URL valid for ttl.
func (p *S3Presigner) PresignUpload(ctx context.Context, key string, contentType string, ttl time.Duration) (string, error) {
	return p.PresignUploadWithHost(ctx, key, contentType, ttl, "", "")
}

// PresignUploadWithHost returns a presigned PUT URL valid for ttl; the host is always taken from the configured endpoint.
func (p *S3Presigner) PresignUploadWithHost(ctx context.Context, key string, contentType string, ttl time.Duration, reqHost string, reqScheme string) (string, error) {
	return p.presign(ctx, http.MethodPut, key, ttl, reqHost, reqScheme)
}

// PresignDownload returns a presigned GET URL valid for ttl.
func (p *S3Presigner) PresignDownload(ctx context.Context, key string, ttl time.Duration) (string, error) {
	return p.PresignDownloadWithHost(ctx, key, ttl, "", "")
}

// PresignDownloadWithHost returns a presigned GET URL valid for ttl; the host is only the configured endpoint.
func (p *S3Presigner) PresignDownloadWithHost(ctx context.Context, key string, ttl time.Duration, reqHost string, reqScheme string) (string, error) {
	return p.presign(ctx, http.MethodGet, key, ttl, reqHost, reqScheme)
}

// deleteTTL defines the validity duration for signed DELETE requests.
const deleteTTL = 5 * time.Minute

// deleteClient executes signed DELETE requests without following redirects.
var deleteClient = &http.Client{
	Timeout: 20 * time.Second,
	CheckRedirect: func(req *http.Request, via []*http.Request) error {
		return fmt.Errorf("blobstore: refusing to follow redirect to %s", req.URL.Redacted())
	},
}

// DeleteObject removes an object from the storage bucket.
func (p *S3Presigner) DeleteObject(ctx context.Context, key string) error {
	if err := ValidateKey(key); err != nil {
		return err
	}

	internal := *p
	internal.cfg.PublicEndpoint = ""
	signed, err := internal.presign(ctx, http.MethodDelete, key, deleteTTL, "", "")
	if err != nil {
		return err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, signed, nil)
	if err != nil {
		return err
	}
	resp, err := deleteClient.Do(req)
	if err != nil {
		return fmt.Errorf("blobstore: delete request failed: %w", err)
	}
	defer resp.Body.Close()

	switch resp.StatusCode {
	case http.StatusNoContent, http.StatusOK, http.StatusAccepted, http.StatusNotFound:
		return nil
	default:
		return fmt.Errorf("blobstore: delete returned status %d", resp.StatusCode)
	}
}

// presign generates a SigV4 presigned URL for the given HTTP method, key, and TTL.
func (p *S3Presigner) presign(ctx context.Context, method string, key string, ttl time.Duration, reqHost string, reqScheme string) (string, error) {
	if p.cfg.Bucket == "" {
		return "", fmt.Errorf("blobstore: bucket is not configured")
	}
	key = strings.TrimPrefix(key, "/")

	now := time.Now().UTC()
	amzDate := now.Format("20060102T150405Z")
	dateStamp := now.Format("20060102")
	credentialScope := fmt.Sprintf("%s/%s/s3/aws4_request", dateStamp, p.cfg.Region)

	scheme := "http"
	if p.cfg.UseSSL {
		scheme = "https"
	}

	host := p.cfg.Endpoint
	if p.cfg.PublicEndpoint != "" {
		pub := p.cfg.PublicEndpoint
		if strings.HasPrefix(pub, "http://") {
			scheme = "http"
			pub = strings.TrimPrefix(pub, "http://")
		} else if strings.HasPrefix(pub, "https://") {
			scheme = "https"
			pub = strings.TrimPrefix(pub, "https://")
		}
		host = strings.TrimSuffix(pub, "/")
	}

	canonicalURI := "/" + p.cfg.Bucket + "/" + key
	if !p.cfg.PathStyle {
		host = p.cfg.Bucket + "." + host
		canonicalURI = "/" + key
	}
	canonicalURI = encodePath(canonicalURI)

	query := url.Values{}
	query.Set("X-Amz-Algorithm", "AWS4-HMAC-SHA256")
	query.Set("X-Amz-Credential", p.cfg.AccessKey+"/"+credentialScope)
	query.Set("X-Amz-Date", amzDate)
	query.Set("X-Amz-Expires", fmt.Sprintf("%d", int(ttl.Seconds())))
	query.Set("X-Amz-SignedHeaders", "host")
	canonicalQuery := query.Encode()

	canonicalHeaders := "host:" + host + "\n"
	signedHeaders := "host"

	canonicalRequest := strings.Join([]string{
		method,
		canonicalURI,
		canonicalQuery,
		canonicalHeaders,
		signedHeaders,
		"UNSIGNED-PAYLOAD",
	}, "\n")

	stringToSign := strings.Join([]string{
		"AWS4-HMAC-SHA256",
		amzDate,
		credentialScope,
		hex.EncodeToString(hashSHA256([]byte(canonicalRequest))),
	}, "\n")

	signingKey := deriveSigningKey(p.cfg.SecretKey, dateStamp, p.cfg.Region, "s3")
	signature := hex.EncodeToString(hmacSHA256(signingKey, stringToSign))

	finalURL := fmt.Sprintf("%s://%s%s?%s&X-Amz-Signature=%s", scheme, host, canonicalURI, canonicalQuery, signature)
	return finalURL, nil
}

func deriveSigningKey(secret, dateStamp, region, service string) []byte {
	kDate := hmacSHA256([]byte("AWS4"+secret), dateStamp)
	kRegion := hmacSHA256(kDate, region)
	kService := hmacSHA256(kRegion, service)
	return hmacSHA256(kService, "aws4_request")
}

func hmacSHA256(key []byte, data string) []byte {
	h := hmac.New(sha256.New, key)
	h.Write([]byte(data))
	return h.Sum(nil)
}

func hashSHA256(data []byte) []byte {
	h := sha256.Sum256(data)
	return h[:]
}

// encodePath percent-encodes a URI path per SigV4 rules, preserving path separators.
func encodePath(path string) string {
	segments := strings.Split(path, "/")
	for i, seg := range segments {
		segments[i] = url.QueryEscape(seg)
		segments[i] = strings.ReplaceAll(segments[i], "+", "%20")
	}
	return strings.Join(segments, "/")
}

func isInternalHost(h string) bool {
	h = strings.ToLower(h)
	return strings.Contains(h, "minio") ||
		strings.Contains(h, "localhost") ||
		strings.Contains(h, "127.0.0.1") ||
		strings.Contains(h, "::1") ||
		strings.HasPrefix(h, "db") ||
		strings.HasPrefix(h, "server")
}
