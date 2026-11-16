// Package servicenow is the backend's client of the ServiceNow Table API (spec/service-now-ticket): a small
// HTTP client with typed errors, the settings that switch the integration on, and the routing that derives
// a ticket's assignment from a finding's identity. The browser never sees credentials or the instance URL.
package servicenow

import (
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
)

// ErrNotFound is a missing record. ServiceNow answers an ACL denial the same way ("No Record found"), so
// the two cannot be told apart.
var ErrNotFound = errors.New("servicenow: record not found")

// ErrUnavailable is a timeout, a refused connection or a 5xx: retry later.
var ErrUnavailable = errors.New("servicenow: unavailable")

// ErrRateLimited is HTTP 429; RetryAfter is the Retry-After header (zero when absent).
type ErrRateLimited struct{ RetryAfter time.Duration }

func (e *ErrRateLimited) Error() string {
	if e.RetryAfter > 0 {
		return fmt.Sprintf("servicenow: rate limited, retry after %s", e.RetryAfter)
	}
	return "servicenow: rate limited"
}

// ErrRejected is a refusal by the instance: a Data Policy Exception, an ACL exception, bad credentials or
// any other 4xx. Retrying the same request does not help.
type ErrRejected struct {
	Message string
	Status  int
}

func (e *ErrRejected) Error() string { return "servicenow: rejected: " + e.Message }

// RetryDelay is how long the instance asked to wait; callers that pause between requests use it.
func (e *ErrRateLimited) RetryDelay() time.Duration { return e.RetryAfter }

type errorBody struct {
	Error struct {
		Message string `json:"message"`
	} `json:"error"`
}

// classify turns a non-2xx answer into a typed error. It never includes request headers or the URL, so
// credentials cannot leak into the text.
func classify(status int, header map[string][]string, body []byte) error {
	var eb errorBody
	_ = json.Unmarshal(body, &eb)
	msg := strings.TrimSpace(eb.Error.Message)
	switch {
	case strings.Contains(msg, "Data Policy Exception"):
		return &ErrRejected{Message: msg, Status: status}
	case strings.Contains(msg, "No Record found"), status == 404:
		return ErrNotFound
	case status == 429:
		secs, _ := strconv.Atoi(firstHeader(header, "Retry-After"))
		return &ErrRateLimited{RetryAfter: time.Duration(secs) * time.Second}
	case status >= 500:
		return fmt.Errorf("%w: status %d", ErrUnavailable, status)
	}
	if msg == "" {
		msg = "status " + strconv.Itoa(status)
	}
	return &ErrRejected{Message: msg, Status: status}
}

func firstHeader(h map[string][]string, name string) string {
	for k, v := range h {
		if strings.EqualFold(k, name) && len(v) > 0 {
			return v[0]
		}
	}
	return ""
}
