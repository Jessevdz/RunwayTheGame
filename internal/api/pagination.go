package api

import (
	"fmt"
	"net/http"
	"strconv"
)

const maxListOffset = 1_000_000

// parseListPagination reads bounded limit/offset parameters for list endpoints.
// An omitted limit preserves the endpoint's historical first-page size.
func parseListPagination(r *http.Request, defaultLimit, maxLimit int) (int, int64, error) {
	limit := defaultLimit
	if raw := r.URL.Query().Get("limit"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 {
			return 0, 0, fmt.Errorf("limit must be a positive integer")
		}
		if parsed > maxLimit {
			limit = maxLimit
		} else {
			limit = parsed
		}
	}

	offset := int64(0)
	if raw := r.URL.Query().Get("offset"); raw != "" {
		parsed, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || parsed < 0 || parsed > maxListOffset {
			return 0, 0, fmt.Errorf("offset must be an integer between 0 and %d", maxListOffset)
		}
		offset = parsed
	}
	return limit, offset, nil
}

// setNextOffset advertises the offset to use for another page without changing
// the existing array response shape.
func setNextOffset(w http.ResponseWriter, hasMore bool, offset int64, limit int) {
	if hasMore {
		w.Header().Set("X-Next-Offset", strconv.FormatInt(offset+int64(limit), 10))
	}
}
