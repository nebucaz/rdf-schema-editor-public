package servicenow

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// Auth modes of SERVICENOW_AUTH (research Q8, the choice is open).
const (
	AuthBasic = "basic"
	AuthOAuth = "oauth"
)

// What a finding that is gone does to its ticket (SERVICENOW_ON_FINDING_GONE).
const (
	OnFindingGoneComment = "comment"
	OnFindingGoneResolve = "resolve"
)

// defaultCloseCode is the stored `close_code` of a resolved ticket unless the instance needs another.
const defaultCloseCode = "Resolved – Permanent Fix Applied"

const (
	defaultSyncInterval = 15 * time.Minute
	minSyncInterval     = time.Minute
)

// defaultBulkCap and maxBulkCap bound one bulk creation run (research: never flood the ITSM queue).
const (
	defaultBulkCap = 25
	maxBulkCap     = 500
)

var tablePattern = regexp.MustCompile(`^[a-z][a-z0-9_]{0,79}$`)

// validStatuses are the local issue statuses a ServiceNow state may map to.
var validStatuses = map[string]bool{"open": true, "in-progress": true, "resolved": true, "wontfix": true}

// defaultStateMap is research Q7; the instance's real values are confirmed in STORY-405.
func defaultStateMap() map[string]string {
	return map[string]string{"1": "open", "2": "in-progress", "3": "in-progress", "6": "resolved", "7": "resolved", "8": "wontfix"}
}

// FileSettings are the structured settings of the JSON file named by SERVICENOW_CONFIG_FILE (Q16).
type FileSettings struct {
	// StateMap maps a ServiceNow `state` value to a local issue status.
	StateMap map[string]string `json:"stateMap"`
	// CloseCode is the stored `close_code` value sent when a finding is gone (Q11); per instance.
	CloseCode string          `json:"closeCode"`
	Routing   RoutingSettings `json:"routing"`
}

// Settings is everything the integration needs. The zero value, and any value with an empty BaseURL, is
// disabled: no routes, no client, no worker (Q14).
type Settings struct {
	BaseURL string
	Auth    string
	User    string
	// Password, ClientID and ClientSecret are secrets: read from env only, never logged or sent anywhere.
	Password, ClientID, ClientSecret string
	Table                            string
	// BulkCap is the most tickets one bulk run creates (SERVICENOW_BULK_CAP, default 25); the rest is deferred.
	BulkCap int
	// AppURL is the public URL of this app including its base path (SERVICENOW_APP_URL), for the deep link
	// in a ticket; "" leaves the link out.
	AppURL string
	// SyncEnabled switches off the worker and the automatic pushes only; manual creation stays.
	SyncEnabled bool
	// OnFindingGone is `comment` (a work note only, the default) or `resolve` (also move the ticket to Resolved).
	OnFindingGone string
	// SyncInterval is how often the worker runs a pass (SERVICENOW_SYNC_INTERVAL, default 15m, at least 1m).
	SyncInterval time.Duration
	File         FileSettings
}

// Enabled reports whether the integration exists at all: only SERVICENOW_BASE_URL decides.
func (s Settings) Enabled() bool { return s.BaseURL != "" }

// LoadSettings reads the settings from getenv (the process environment) and, when SERVICENOW_CONFIG_FILE
// is set, the JSON file via readFile. An empty SERVICENOW_BASE_URL yields a disabled value and no error;
// a set but incomplete, non-https or otherwise invalid configuration is an error (refuse startup). Error
// text never contains a secret.
func LoadSettings(getenv func(string) string, readFile func(string) ([]byte, error)) (Settings, error) {
	base := strings.TrimSpace(getenv("SERVICENOW_BASE_URL"))
	if base == "" {
		return Settings{}, nil
	}
	u, err := url.Parse(base)
	if err != nil || u.Scheme != "https" || u.Host == "" {
		return Settings{}, fmt.Errorf("SERVICENOW_BASE_URL must be an https URL")
	}
	if u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return Settings{}, fmt.Errorf("SERVICENOW_BASE_URL must not contain credentials, a query or a fragment")
	}
	s := Settings{
		BaseURL: strings.TrimRight(base, "/"), Auth: strings.ToLower(strings.TrimSpace(getenv("SERVICENOW_AUTH"))),
		User: getenv("SERVICENOW_USER"), Password: getenv("SERVICENOW_PASSWORD"),
		ClientID: getenv("SERVICENOW_CLIENT_ID"), ClientSecret: getenv("SERVICENOW_CLIENT_SECRET"),
		Table: strings.TrimSpace(getenv("SERVICENOW_TABLE")), SyncEnabled: true,
	}
	switch s.Auth {
	case AuthBasic:
		if s.User == "" || s.Password == "" {
			return Settings{}, fmt.Errorf("SERVICENOW_AUTH=basic requires SERVICENOW_USER and SERVICENOW_PASSWORD")
		}
	case AuthOAuth:
		if s.ClientID == "" || s.ClientSecret == "" {
			return Settings{}, fmt.Errorf("SERVICENOW_AUTH=oauth requires SERVICENOW_CLIENT_ID and SERVICENOW_CLIENT_SECRET")
		}
	default:
		return Settings{}, fmt.Errorf("SERVICENOW_AUTH must be %q or %q when SERVICENOW_BASE_URL is set", AuthBasic, AuthOAuth)
	}
	if s.Table == "" {
		s.Table = "incident"
	}
	if !tablePattern.MatchString(s.Table) {
		return Settings{}, fmt.Errorf("SERVICENOW_TABLE is not a valid table name")
	}
	s.BulkCap = defaultBulkCap
	if v := strings.TrimSpace(getenv("SERVICENOW_BULK_CAP")); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 || n > maxBulkCap {
			return Settings{}, fmt.Errorf("SERVICENOW_BULK_CAP must be a number from 1 to %d", maxBulkCap)
		}
		s.BulkCap = n
	}
	if v := strings.TrimSpace(getenv("SERVICENOW_APP_URL")); v != "" {
		a, err := url.Parse(v)
		if err != nil || (a.Scheme != "https" && a.Scheme != "http") || a.Host == "" || a.User != nil || a.RawQuery != "" || a.Fragment != "" {
			return Settings{}, fmt.Errorf("SERVICENOW_APP_URL must be an http(s) URL without credentials, query or fragment")
		}
		s.AppURL = strings.TrimRight(v, "/")
	}
	switch strings.ToLower(strings.TrimSpace(getenv("SERVICENOW_SYNC_ENABLED"))) {
	case "", "true":
	case "false":
		s.SyncEnabled = false
	default:
		return Settings{}, fmt.Errorf("SERVICENOW_SYNC_ENABLED must be true or false")
	}

	if path := strings.TrimSpace(getenv("SERVICENOW_CONFIG_FILE")); path != "" {
		raw, err := readFile(path)
		if err != nil {
			return Settings{}, fmt.Errorf("SERVICENOW_CONFIG_FILE cannot be read: %w", err)
		}
		dec := json.NewDecoder(bytes.NewReader(raw))
		dec.DisallowUnknownFields()
		if err := dec.Decode(&s.File); err != nil {
			return Settings{}, fmt.Errorf("SERVICENOW_CONFIG_FILE is invalid: %w", err)
		}
	}
	s.SyncInterval = defaultSyncInterval
	if v := strings.TrimSpace(getenv("SERVICENOW_SYNC_INTERVAL")); v != "" {
		d, err := time.ParseDuration(v)
		if err != nil || d < minSyncInterval {
			return Settings{}, fmt.Errorf("SERVICENOW_SYNC_INTERVAL must be a duration of at least %s", minSyncInterval)
		}
		s.SyncInterval = d
	}
	switch strings.ToLower(strings.TrimSpace(getenv("SERVICENOW_ON_FINDING_GONE"))) {
	case "", OnFindingGoneComment:
		s.OnFindingGone = OnFindingGoneComment
	case OnFindingGoneResolve:
		s.OnFindingGone = OnFindingGoneResolve
	default:
		return Settings{}, fmt.Errorf("SERVICENOW_ON_FINDING_GONE must be %q or %q", OnFindingGoneComment, OnFindingGoneResolve)
	}
	if v := strings.TrimSpace(getenv("SERVICENOW_CLOSE_CODE")); v != "" {
		s.File.CloseCode = v
	}
	if s.File.CloseCode == "" {
		s.File.CloseCode = defaultCloseCode
	}
	if s.File.StateMap == nil {
		s.File.StateMap = defaultStateMap()
	}
	if err := validateStateMap(s.File.StateMap); err != nil {
		return Settings{}, err
	}
	if err := s.File.Routing.Validate(); err != nil {
		return Settings{}, err
	}
	if s.File.Routing.Unrouted == "" {
		s.File.Routing.Unrouted = UnroutedBlock
	}
	return s, nil
}

var stateValuePattern = regexp.MustCompile(`^[0-9]{1,3}$`)

func validateStateMap(m map[string]string) error {
	for state, status := range m {
		if !stateValuePattern.MatchString(state) {
			return fmt.Errorf("SERVICENOW_CONFIG_FILE: state %q is not a ServiceNow state value", state)
		}
		if !validStatuses[status] {
			return fmt.Errorf("SERVICENOW_CONFIG_FILE: state %s maps to unknown status %q", state, status)
		}
	}
	return nil
}
