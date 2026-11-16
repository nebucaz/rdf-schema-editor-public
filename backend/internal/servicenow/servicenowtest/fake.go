// Package servicenowtest is an in-memory fake of the ServiceNow Table API for tests (no instance exists
// in development, spec/service-now-ticket research Q12). It speaks the real response envelope
// `{"result": ...}`, the `sysparm_display_value=all` shape, the UTC `sys_updated_on` and the Data Policy
// refusal of a Resolved ticket without close code and notes, as recorded on a developer instance.
package servicenowtest

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

const timeLayout = "2006-01-02 15:04:05"

// Server is the fake. Records is every incident by sys_id; set the exported knobs before use.
type Server struct {
	*httptest.Server

	mu      sync.Mutex
	records map[string]map[string]string
	next    int
	// Now stamps sys_updated_on; tests move it to control the watermark.
	Now func() time.Time

	// BasicUser/BasicPassword, when set, are the only accepted Basic credentials.
	BasicUser, BasicPassword string
	// OAuthClientID/OAuthClientSecret, when set, enable POST /oauth_token.do and require the bearer token.
	OAuthClientID, OAuthClientSecret string
	// TokenTTL is the expires_in handed out (seconds); default 1800.
	TokenTTL int
	// Users maps a sys_id to a user_name/name pair, used to answer assigned_to dot-walks.
	Users map[string][2]string

	notes    map[string][]string
	tokens   map[string]bool
	issued   int
	failures []failure
	// Requests logs "METHOD path?query" of every Table API call.
	Requests []string
	// TokenRequests counts calls to the OAuth token endpoint.
	TokenRequests int
}

type failure struct {
	status  int
	body    string
	headers map[string]string
}

// New starts a fake with the table name `incident`.
func New() *Server {
	s := &Server{records: map[string]map[string]string{}, tokens: map[string]bool{}, Now: time.Now, Users: map[string][2]string{}}
	s.Server = httptest.NewTLSServer(http.HandlerFunc(s.handle))
	return s
}

// FailNext makes the next Table API call answer status and body (headers optional).
func (s *Server) FailNext(status int, body string, headers map[string]string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.failures = append(s.failures, failure{status, body, headers})
}

// RevokeTokens makes every issued OAuth token invalid, as if it had expired.
func (s *Server) RevokeTokens() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.tokens = map[string]bool{}
}

// Record returns a copy of one stored incident.
func (s *Server) Record(sysID string) (map[string]string, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	r, ok := s.records[sysID]
	if !ok {
		return nil, false
	}
	cp := map[string]string{}
	for k, v := range r {
		cp[k] = v
	}
	return cp, true
}

// Notes returns the work notes written to an incident; the API never reads them back, so a test asks here.
func (s *Server) Notes(sysID string) []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]string(nil), s.notes[sysID]...)
}

// Count is the number of stored incidents.
func (s *Server) Count() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.records)
}

// Set changes fields of a stored incident as ServiceNow itself would (a person working the ticket),
// stamping sys_updated_on.
func (s *Server) Set(sysID string, fields map[string]string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	r := s.records[sysID]
	for k, v := range fields {
		r[k] = v
	}
	r["sys_updated_on"] = s.Now().UTC().Format(timeLayout)
}

func (s *Server) writeError(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json;charset=UTF-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]string{"message": msg, "detail": ""}, "status": "failure"})
}

func (s *Server) handle(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if r.URL.Path == "/oauth_token.do" {
		s.token(w, r)
		return
	}
	if !s.authorized(r) {
		s.writeError(w, http.StatusUnauthorized, "User Not Authenticated")
		return
	}
	s.Requests = append(s.Requests, r.Method+" "+r.URL.Path+"?"+r.URL.RawQuery)
	if len(s.failures) > 0 {
		f := s.failures[0]
		s.failures = s.failures[1:]
		for k, v := range f.headers {
			w.Header().Set(k, v)
		}
		w.Header().Set("Content-Type", "application/json;charset=UTF-8")
		w.WriteHeader(f.status)
		_, _ = w.Write([]byte(f.body))
		return
	}

	const prefix = "/api/now/table/incident"
	if !strings.HasPrefix(r.URL.Path, prefix) {
		s.writeError(w, http.StatusNotFound, "Invalid table")
		return
	}
	sysID := strings.TrimPrefix(strings.TrimPrefix(r.URL.Path, prefix), "/")
	display := r.URL.Query().Get("sysparm_display_value") == "all"

	switch {
	case r.Method == http.MethodPost && sysID == "":
		fields, ok := s.body(w, r)
		if !ok {
			return
		}
		s.next++
		id := fmt.Sprintf("%032x", s.next)
		rec := map[string]string{"sys_id": id, "number": fmt.Sprintf("INC%07d", s.next), "state": "1", "impact": "3", "urgency": "3", "priority": "4", "category": "inquiry", "active": "true"}
		for k, v := range fields {
			rec[k] = v
		}
		rec["sys_updated_on"] = s.Now().UTC().Format(timeLayout)
		rec["sys_created_on"] = rec["sys_updated_on"]
		s.records[id] = rec
		s.reply(w, http.StatusCreated, s.shape(rec, display, nil))
	case r.Method == http.MethodGet && sysID != "":
		rec, ok := s.records[sysID]
		if !ok {
			s.writeError(w, http.StatusNotFound, "No Record found")
			return
		}
		s.reply(w, http.StatusOK, s.shape(rec, display, fieldList(r)))
	case r.Method == http.MethodGet:
		s.list(w, r, display)
	case r.Method == http.MethodPatch && sysID != "":
		rec, ok := s.records[sysID]
		if !ok {
			s.writeError(w, http.StatusNotFound, "No Record found")
			return
		}
		fields, ok := s.body(w, r)
		if !ok {
			return
		}
		if fields["state"] == "6" && (fields["close_code"] == "" && rec["close_code"] == "" || fields["close_notes"] == "" && rec["close_notes"] == "") {
			s.writeError(w, http.StatusBadRequest, "Data Policy Exception: The following fields are mandatory: Resolution code, Resolution notes")
			return
		}
		if rec["state"] == "7" || rec["state"] == "8" {
			s.writeError(w, http.StatusForbidden, "ACL Exception Update Failed due to security constraints")
			return
		}
		for k, v := range fields {
			if k == "work_notes" { // write-only
				if s.notes == nil {
					s.notes = map[string][]string{}
				}
				s.notes[sysID] = append(s.notes[sysID], v)
				continue
			}
			rec[k] = v
		}
		if fields["state"] == "7" {
			rec["active"] = "false"
		}
		rec["sys_updated_on"] = s.Now().UTC().Format(timeLayout)
		s.reply(w, http.StatusOK, s.shape(rec, display, nil))
	default:
		s.writeError(w, http.StatusMethodNotAllowed, "Unsupported")
	}
}

func fieldList(r *http.Request) []string {
	if f := r.URL.Query().Get("sysparm_fields"); f != "" {
		return strings.Split(f, ",")
	}
	return nil
}

func (s *Server) list(w http.ResponseWriter, r *http.Request, display bool) {
	q := r.URL.Query()
	var prefix string
	var since string
	for _, clause := range strings.Split(q.Get("sysparm_query"), "^") {
		switch {
		case strings.HasPrefix(clause, "correlation_idSTARTSWITH"):
			prefix = strings.TrimPrefix(clause, "correlation_idSTARTSWITH")
		case strings.HasPrefix(clause, "sys_updated_on>"):
			since = strings.TrimPrefix(clause, "sys_updated_on>")
		}
	}
	var matched []map[string]string
	for _, rec := range s.records {
		if prefix != "" && !strings.HasPrefix(rec["correlation_id"], prefix) {
			continue
		}
		if since != "" && rec["sys_updated_on"] <= since {
			continue
		}
		matched = append(matched, rec)
	}
	sort.Slice(matched, func(i, j int) bool {
		if matched[i]["sys_updated_on"] != matched[j]["sys_updated_on"] {
			return matched[i]["sys_updated_on"] < matched[j]["sys_updated_on"]
		}
		return matched[i]["sys_id"] < matched[j]["sys_id"]
	})
	limit, _ := strconv.Atoi(q.Get("sysparm_limit"))
	offset, _ := strconv.Atoi(q.Get("sysparm_offset"))
	if offset > len(matched) {
		offset = len(matched)
	}
	matched = matched[offset:]
	if limit > 0 && limit < len(matched) {
		matched = matched[:limit]
	}
	out := make([]map[string]any, 0, len(matched))
	for _, rec := range matched {
		out = append(out, s.shape(rec, display, fieldList(r)))
	}
	s.reply(w, http.StatusOK, out)
}

// shape renders a record the way the Table API does: plain strings, or {display_value, value} for every
// field with sysparm_display_value=all. A set assigned_to is a reference with its dot-walked user_name.
func (s *Server) shape(rec map[string]string, display bool, fields []string) map[string]any {
	out := map[string]any{}
	add := func(k, v string) {
		if display {
			out[k] = map[string]string{"display_value": v, "value": v}
		} else {
			out[k] = v
		}
	}
	for k, v := range rec {
		if k == "assigned_to" && v != "" {
			name := s.Users[v][1]
			if display {
				out[k] = map[string]string{"display_value": name, "value": v}
			} else {
				out[k] = map[string]string{"link": "https://example.service-now.com/api/now/table/sys_user/" + v, "value": v}
			}
			continue
		}
		add(k, v)
	}
	if v := rec["assigned_to"]; v != "" && contains(fields, "assigned_to.user_name") {
		add("assigned_to.user_name", s.Users[v][0])
	}
	return out
}

func contains(l []string, v string) bool {
	for _, x := range l {
		if x == v {
			return true
		}
	}
	return false
}

func (s *Server) body(w http.ResponseWriter, r *http.Request) (map[string]string, bool) {
	var raw map[string]any
	if err := json.NewDecoder(r.Body).Decode(&raw); err != nil {
		s.writeError(w, http.StatusBadRequest, "Invalid JSON")
		return nil, false
	}
	out := map[string]string{}
	for k, v := range raw {
		out[k] = fmt.Sprint(v)
	}
	return out, true
}

func (s *Server) reply(w http.ResponseWriter, status int, result any) {
	w.Header().Set("Content-Type", "application/json;charset=UTF-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"result": result})
}

func (s *Server) authorized(r *http.Request) bool {
	if s.OAuthClientID != "" {
		return s.tokens[strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")]
	}
	if s.BasicUser != "" {
		u, p, ok := r.BasicAuth()
		return ok && u == s.BasicUser && p == s.BasicPassword
	}
	return true
}

func (s *Server) token(w http.ResponseWriter, r *http.Request) {
	s.TokenRequests++
	_ = r.ParseForm()
	if r.Form.Get("grant_type") != "client_credentials" || r.Form.Get("client_id") != s.OAuthClientID || r.Form.Get("client_secret") != s.OAuthClientSecret {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"error":"server_error","error_description":"access_denied"}`))
		return
	}
	s.issued++
	tok := "tok-" + strconv.Itoa(s.issued)
	s.tokens[tok] = true
	ttl := s.TokenTTL
	if ttl == 0 {
		ttl = 1800
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"access_token": tok, "token_type": "Bearer", "expires_in": ttl})
}
