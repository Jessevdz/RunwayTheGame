// Package blobstore provides mechanisms for storing, downloading, and presigning object storage blobs.
package blobstore

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"syscall"
	"time"

	"github.com/google/uuid"
)

// MaxBlobKeyLen bounds the maximum allowed length of an object key in bytes.
const MaxBlobKeyLen = 512

// MaxBlobBytes caps the maximum number of bytes DownloadBlob will read from storage.
const MaxBlobBytes = 25 << 20 // 25 MiB

// ValidateKey checks that key is a relative object key containing no URL schemes, absolute paths, or path traversals.
func ValidateKey(key string) error {
	if key == "" {
		return fmt.Errorf("blobstore: blob key is empty")
	}
	if len(key) > MaxBlobKeyLen {
		return fmt.Errorf("blobstore: blob key exceeds %d bytes", MaxBlobKeyLen)
	}
	if strings.Contains(key, "://") {
		return fmt.Errorf("blobstore: blob key must be an object key, not a URL")
	}
	if strings.HasPrefix(key, "/") || strings.HasPrefix(key, "\\") {
		return fmt.Errorf("blobstore: blob key must be relative")
	}
	for _, seg := range strings.Split(key, "/") {
		if seg == "." || seg == ".." {
			return fmt.Errorf("blobstore: blob key must not contain path traversal")
		}
	}
	for _, r := range key {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9':
		case r == '-', r == '_', r == '.', r == '/':
		default:
			return fmt.Errorf("blobstore: blob key contains disallowed character %q", r)
		}
	}
	return nil
}

// EvidencePrefix returns the object key prefix for a given game and team.
func EvidencePrefix(gameID, teamID string) string {
	return "games/" + gameID + "/teams/" + teamID + "/"
}

// MintEvidenceKey returns a new validated, team-namespaced object key for evidence storage.
func MintEvidenceKey(gameID, teamID string) (string, error) {
	key := EvidencePrefix(gameID, teamID) + uuid.NewString() + ".jpg"
	if err := ValidateKey(key); err != nil {
		return "", err
	}
	return key, nil
}

// KeyBelongsToTeam reports whether key matches the evidence prefix for the given game and team.
func KeyBelongsToTeam(key, gameID, teamID string) bool {
	return strings.HasPrefix(key, EvidencePrefix(gameID, teamID))
}

// HTTPBlobStore retrieves blobs over HTTP from a single configured origin.
type HTTPBlobStore struct {
	BaseURL string

	client *http.Client
	// allowPrivate permits fetching from private or loopback IP addresses.
	allowPrivate bool
}

// NewHTTPBlobStore creates a new HTTPBlobStore reading objects under baseURL.
func NewHTTPBlobStore(baseURL string) *HTTPBlobStore {
	h := &HTTPBlobStore{BaseURL: strings.TrimRight(baseURL, "/")}
	h.allowPrivate = baseHostIsPrivate(h.BaseURL)
	h.client = &http.Client{
		Timeout: 30 * time.Second,
		// Refuse HTTP redirects to prevent SSRF vulnerabilities.
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			return fmt.Errorf("blobstore: refusing to follow redirect to %s", req.URL.Redacted())
		},
		Transport: &http.Transport{
			// Control validates the resolved dial address immediately before connecting to prevent DNS rebinding attacks.
			DialContext: (&net.Dialer{
				Timeout: 10 * time.Second,
				Control: func(_, address string, _ syscall.RawConn) error {
					return h.checkDialAddr(address)
				},
			}).DialContext,
			// Disable proxy resolution to enforce dial address validation.
			Proxy: nil,
		},
	}
	return h
}

// checkDialAddr validates that host in host:port is a public IP address.
func (h *HTTPBlobStore) checkDialAddr(address string) error {
	if h.allowPrivate {
		return nil
	}
	host, _, err := net.SplitHostPort(address)
	if err != nil {
		return fmt.Errorf("blobstore: cannot parse dial address %q: %w", address, err)
	}
	ip := net.ParseIP(host)
	if ip == nil {
		return fmt.Errorf("blobstore: dial address %q is not an IP", host)
	}
	if isDisallowedIP(ip) {
		return fmt.Errorf("blobstore: refusing to connect to non-public address %s", ip)
	}
	return nil
}

// DownloadBlob downloads object bytes for blobRef relative to BaseURL.
func (h *HTTPBlobStore) DownloadBlob(ctx context.Context, blobRef string) ([]byte, error) {
	if err := ValidateKey(blobRef); err != nil {
		return nil, err
	}
	if h.BaseURL == "" {
		return nil, fmt.Errorf("blobstore: base URL is not configured")
	}

	base, err := url.Parse(h.BaseURL)
	if err != nil {
		return nil, fmt.Errorf("blobstore: invalid base URL: %w", err)
	}
	if base.Scheme != "http" && base.Scheme != "https" {
		return nil, fmt.Errorf("blobstore: base URL must be http or https")
	}
	target := *base
	target.Path = strings.TrimRight(base.EscapedPath(), "/") + "/" + encodePath(blobRef)

	if err := h.checkHost(ctx, target.Hostname()); err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target.String(), nil)
	if err != nil {
		return nil, err
	}

	resp, err := h.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("http GET request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("server returned status %d", resp.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, MaxBlobBytes+1))
	if err != nil {
		return nil, err
	}
	if len(body) > MaxBlobBytes {
		return nil, fmt.Errorf("blobstore: object exceeds %d byte limit", MaxBlobBytes)
	}
	return body, nil
}

// checkHost resolves host and verifies none of its IP addresses are private or loopback unless permitted.
func (h *HTTPBlobStore) checkHost(ctx context.Context, host string) error {
	if h.allowPrivate {
		return nil
	}
	addrs, err := net.DefaultResolver.LookupIPAddr(ctx, host)
	if err != nil {
		return fmt.Errorf("blobstore: cannot resolve %s: %w", host, err)
	}
	for _, a := range addrs {
		if isDisallowedIP(a.IP) {
			return fmt.Errorf("blobstore: refusing to fetch from non-public address %s", a.IP)
		}
	}
	return nil
}

func isDisallowedIP(ip net.IP) bool {
	return ip.IsLoopback() ||
		ip.IsPrivate() ||
		ip.IsLinkLocalUnicast() ||
		ip.IsLinkLocalMulticast() ||
		ip.IsInterfaceLocalMulticast() ||
		ip.IsUnspecified()
}

func baseHostIsPrivate(baseURL string) bool {
	u, err := url.Parse(baseURL)
	if err != nil {
		return false
	}
	host := u.Hostname()
	if host == "" {
		return false
	}
	if ip := net.ParseIP(host); ip != nil {
		return isDisallowedIP(ip)
	}
	// Treat bare service names and localhost as private endpoints.
	return host == "localhost" || !strings.Contains(host, ".")
}
