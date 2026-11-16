// Package issues tracks validation findings as persistent issues (spec/validation-issues-tracker).
// One issue per finding id lives as a node in the dedicated graph `<default base>/issues`, written only
// by the backend and deliberately outside `sparqlsafe.NamespaceGraphs`, so the schema, instance and
// shapes graphs (and everything that reads them) never see it.
package issues

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/nebucaz/rdf-schema-editor/backend/internal/graphdb"
	"github.com/nebucaz/rdf-schema-editor/backend/internal/sparqlsafe"
	"github.com/nebucaz/rdf-schema-editor/backend/internal/validation"
)

const xsdDateTime = "http://www.w3.org/2001/XMLSchema#dateTime"

// Status values. `resolved` carries a ResolvedBy: SystemUser or the sub of the user who resolved it.
const (
	StatusOpen       = "open"
	StatusInProgress = "in-progress"
	StatusResolved   = "resolved"
	StatusWontFix    = "wontfix"

	// SystemUser stamps changes the reconcile makes on its own.
	SystemUser = "system"
)

// Statuses lists every valid status.
var Statuses = []string{StatusOpen, StatusInProgress, StatusResolved, StatusWontFix}

// Length limits for client-influenced fields.
const (
	MaxNote     = 4000
	MaxSub      = 200
	MaxExternal = 200
	MaxSystem   = 100
	maxSnapshot = 2000
	// MaxLimit is the hard page size of List.
	MaxLimit     = 500
	defaultLimit = 100
)

var idPattern = regexp.MustCompile(`^[a-z0-9]{8,64}$`)

// Issue is one tracked finding. ExternalURL is derived from the configured template when an issue is
// read out; it is never stored and never accepted from a client.
type Issue struct {
	ID               string `json:"id"` // the finding id
	IndividualIri    string `json:"individualIri"`
	TypeIri          string `json:"typeIri"`
	RuleId           string `json:"ruleId"`
	ShapeIri         string `json:"shapeIri"`
	Path             string `json:"path"`
	Constraint       string `json:"constraint"`
	IndividualLabel  string `json:"individualLabel"`
	Message          string `json:"message"`
	QualityDimension string `json:"qualityDimension"`
	// Value is the finding's offending value (see validation.Violation.Value); nil when it has none.
	Value          *string `json:"value,omitempty"`
	Status         string  `json:"status"`
	ResolvedBy     string  `json:"resolvedBy"`
	Assignee       string  `json:"assignee"`
	AssigneeName   string  `json:"assigneeName"`
	Note           string  `json:"note"`
	ExternalSystem string  `json:"externalSystem"`
	ExternalID     string  `json:"externalId"`
	ExternalURL    string  `json:"externalUrl"`
	CreatedAt      string  `json:"createdAt"`
	UpdatedBy      string  `json:"updatedBy"`
	UpdatedByName  string  `json:"updatedByName"`
	UpdatedAt      string  `json:"updatedAt"`
	LastSeenAt     string  `json:"lastSeenAt"`
	// Tickets is the ServiceNow ticket history, oldest first; the last is the current one. ExternalSystem,
	// ExternalID and ExternalURL mirror it. The sync fields below are written by the ServiceNow sync only.
	Tickets            []Ticket `json:"tickets"`
	ServiceNowAssignee string   `json:"serviceNowAssignee"`
	ServiceNowGroup    string   `json:"serviceNowGroup"`
	SyncState          string   `json:"syncState"`
	LastSyncedAt       string   `json:"lastSyncedAt"`
	LastError          string   `json:"lastError"`
	// ServiceNowResolution is the ticket's resolution note. FollowUpNeeded says the finding returned after
	// ServiceNow resolved its ticket: creating the follow-up stays a manual act (research Q5).
	ServiceNowResolution string `json:"serviceNowResolution"`
	FollowUpNeeded       bool   `json:"followUpNeeded"`
}

// Filter narrows List; empty fields do not filter.
type Filter struct {
	Status, Assignee, RuleID, IndividualIri string
	Limit, Offset                           int
}

// Graph is the slice of the GraphDB client the store uses; *graphdb.Client satisfies it.
type Graph interface {
	Select(ctx context.Context, query string) (graphdb.SelectResult, error)
	Update(ctx context.Context, update string) error
}

type inputError struct{ msg string }

func (e inputError) Error() string { return e.msg }

func inputErrorf(format string, a ...any) error { return inputError{fmt.Sprintf(format, a...)} }

// IsInputError reports whether err was caused by the request (HTTP 400) rather than by GraphDB (502).
func IsInputError(err error) bool {
	var ie inputError
	return errors.As(err, &ie)
}

// GraphIRI is the issues graph of the namespace rooted at defaultNamespaceBaseIRI.
func GraphIRI(defaultNamespaceBaseIRI string) string {
	return strings.TrimSuffix(defaultNamespaceBaseIRI, "/") + "/issues"
}

// Store reads and writes issue nodes.
type Store struct {
	graph Graph
	g     string // the issues graph
	ns    string // g + "#": issue nodes and the vocabulary mint here
}

// NewStore builds a Store for the namespace rooted at defaultNamespaceBaseIRI.
func NewStore(graph Graph, defaultNamespaceBaseIRI string) *Store {
	g := GraphIRI(defaultNamespaceBaseIRI)
	return &Store{graph: graph, g: g, ns: g + "#"}
}

func (s *Store) p(name string) string { return "<" + s.ns + name + ">" }

func (s *Store) nodeIRI(id string) string { return "<" + s.ns + id + ">" }

func lit(v string) string { return `"` + sparqlsafe.EscapeString(v) + `"` }

func dt(v string) string { return `"` + sparqlsafe.EscapeString(v) + `"^^<` + xsdDateTime + `>` }

// ValidID reports whether id is shaped like a finding id; it is spliced into an IRI.
func ValidID(id string) bool { return idPattern.MatchString(id) }

func validStatus(v string) bool {
	for _, s := range Statuses {
		if s == v {
			return true
		}
	}
	return false
}

// Validate checks an issue before it is written.
func Validate(i Issue) error {
	if !ValidID(i.ID) {
		return inputErrorf("Invalid issue id")
	}
	if !validStatus(i.Status) {
		return inputErrorf("Invalid status")
	}
	if !syncStates[i.SyncState] {
		return inputErrorf("Invalid sync state")
	}
	for _, t := range i.Tickets {
		if !correlationPattern.MatchString(t.CorrelationID) {
			return inputErrorf("Invalid ticket correlation id")
		}
		for _, v := range []string{t.Number, t.SysID, t.State, t.StateLabel, t.URL} {
			if len(v) > maxSnapshot {
				return inputErrorf("A ticket field is too long")
			}
		}
	}
	for _, iri := range []string{i.IndividualIri, i.TypeIri, i.ShapeIri, i.Path} {
		if iri != "" && !sparqlsafe.SafeIRI(iri) {
			return inputErrorf("Invalid IRI in issue")
		}
	}
	if i.Status != StatusResolved && i.Status != StatusWontFix && i.ResolvedBy != "" {
		return inputErrorf("Only a resolved issue has a resolver")
	}
	limits := []struct {
		v    string
		max  int
		what string
	}{
		{i.Note, MaxNote, "note"}, {i.Assignee, MaxSub, "assignee"}, {i.AssigneeName, MaxSub, "assignee name"},
		{i.UpdatedBy, MaxSub, "updatedBy"}, {i.UpdatedByName, MaxSub, "updatedByName"}, {i.ResolvedBy, MaxSub, "resolvedBy"},
		{i.ExternalID, MaxExternal, "external id"}, {i.ExternalSystem, MaxSystem, "external system"},
		{i.IndividualLabel, maxSnapshot, "label"}, {i.Message, maxSnapshot, "message"}, {i.RuleId, maxSnapshot, "rule id"},
		{i.QualityDimension, maxSnapshot, "quality dimension"}, {i.Constraint, maxSnapshot, "constraint"},
		{i.ServiceNowAssignee, maxSnapshot, "ServiceNow assignee"}, {i.ServiceNowGroup, maxSnapshot, "ServiceNow group"},
		{i.LastError, maxSnapshot, "last error"}, {i.ServiceNowResolution, maxSnapshot, "ServiceNow resolution"},
	}
	if i.Value != nil {
		limits = append(limits, struct {
			v    string
			max  int
			what string
		}{*i.Value, maxSnapshot, "value"})
	}
	for _, l := range limits {
		if len(l.v) > l.max {
			return inputErrorf("The %s is too long", l.what)
		}
	}
	return nil
}

// triples is the node of one issue as a Turtle statement.
func (s *Store) triples(i Issue) string {
	parts := []string{"a " + s.p("Issue"), s.p("findingId") + " " + lit(i.ID)}
	add := func(name, v string) {
		if v != "" {
			parts = append(parts, s.p(name)+" "+lit(v))
		}
	}
	addDT := func(name, v string) {
		if v != "" {
			parts = append(parts, s.p(name)+" "+dt(v))
		}
	}
	add("individualIri", i.IndividualIri)
	add("typeIri", i.TypeIri)
	add("ruleId", i.RuleId)
	add("shapeIri", i.ShapeIri)
	add("path", i.Path)
	add("constraint", i.Constraint)
	add("individualLabel", i.IndividualLabel)
	add("message", i.Message)
	add("qualityDimension", i.QualityDimension)
	if i.Value != nil { // "" is a real value
		parts = append(parts, s.p("value")+" "+lit(*i.Value))
	}
	add("status", i.Status)
	add("resolvedBy", i.ResolvedBy)
	add("assignee", i.Assignee)
	add("assigneeName", i.AssigneeName)
	add("note", i.Note)
	add("externalSystem", i.ExternalSystem)
	add("externalId", i.ExternalID)
	addDT("createdAt", i.CreatedAt)
	add("updatedBy", i.UpdatedBy)
	add("updatedByName", i.UpdatedByName)
	addDT("updatedAt", i.UpdatedAt)
	addDT("lastSeenAt", i.LastSeenAt)
	add("serviceNowAssignee", i.ServiceNowAssignee)
	add("serviceNowGroup", i.ServiceNowGroup)
	if i.SyncState != SyncNone {
		add("syncState", i.SyncState)
	}
	addDT("lastSyncedAt", i.LastSyncedAt)
	add("lastError", i.LastError)
	add("serviceNowResolution", i.ServiceNowResolution)
	if i.FollowUpNeeded {
		parts = append(parts, s.p("followUpNeeded")+` "true"`)
	}
	return s.nodeIRI(i.ID) + " " + strings.Join(parts, " ; ") + " ." + s.ticketTriples(i)
}

func (s *Store) ticketNode(correlationID string) string { return s.nodeIRI("ticket-" + correlationID) }

// ticketTriples writes one node per ticket, linked to the issue by ticketOf.
func (s *Store) ticketTriples(i Issue) string {
	var b strings.Builder
	for _, t := range i.Tickets {
		parts := []string{"a " + s.p("Ticket"), s.p("ticketOf") + " " + s.nodeIRI(i.ID), s.p("correlationId") + " " + lit(t.CorrelationID)}
		for _, f := range []struct{ name, v string }{{"number", t.Number}, {"sysId", t.SysID}, {"state", t.State}, {"stateLabel", t.StateLabel}, {"url", t.URL}} {
			if f.v != "" {
				parts = append(parts, s.p(f.name)+" "+lit(f.v))
			}
		}
		if t.CreatedAt != "" {
			parts = append(parts, s.p("createdAt")+" "+dt(t.CreatedAt))
		}
		if t.ClosedAt != "" {
			parts = append(parts, s.p("closedAt")+" "+dt(t.ClosedAt))
		}
		b.WriteString("\n" + s.ticketNode(t.CorrelationID) + " " + strings.Join(parts, " ; ") + " .")
	}
	return b.String()
}

func (s *Store) validateAll(is []Issue) error {
	for _, i := range is {
		if err := Validate(i); err != nil {
			return err
		}
	}
	return nil
}

// Create stores one new issue.
func (s *Store) Create(ctx context.Context, i Issue) error { return s.BulkCreate(ctx, []Issue{i}) }

// batch is how many issues one update carries.
const batch = 200

// BulkCreate stores new issues, batch-wise (one update per batch). Every issue is validated first.
func (s *Store) BulkCreate(ctx context.Context, is []Issue) error {
	if err := s.validateAll(is); err != nil {
		return err
	}
	for start := 0; start < len(is); start += batch {
		end := min(start+batch, len(is))
		var b strings.Builder
		for _, i := range is[start:end] {
			b.WriteString(s.triples(i) + "\n")
		}
		if err := s.graph.Update(ctx, fmt.Sprintf("INSERT DATA { GRAPH <%s> { %s } }", s.g, b.String())); err != nil {
			return err
		}
	}
	return nil
}

// Update replaces the stored node of each given issue with the given one.
func (s *Store) Update(ctx context.Context, is ...Issue) error {
	if err := s.validateAll(is); err != nil {
		return err
	}
	for start := 0; start < len(is); start += batch {
		end := min(start+batch, len(is))
		var ops []string
		for _, i := range is[start:end] {
			ops = append(ops,
				fmt.Sprintf("DELETE WHERE { GRAPH <%s> { %s ?p ?o } }", s.g, s.nodeIRI(i.ID)),
				fmt.Sprintf("INSERT DATA { GRAPH <%s> { %s } }", s.g, s.triples(i)))
		}
		if err := s.graph.Update(ctx, strings.Join(ops, " ;\n")); err != nil {
			return err
		}
	}
	return nil
}

// Touch refreshes `lastSeenAt` of the given issues in one update per batch.
func (s *Store) Touch(ctx context.Context, ids []string, at string) error {
	for start := 0; start < len(ids); start += batch {
		end := min(start+batch, len(ids))
		var nodes []string
		for _, id := range ids[start:end] {
			if !ValidID(id) {
				return inputErrorf("Invalid issue id")
			}
			nodes = append(nodes, s.nodeIRI(id))
		}
		p := s.p("lastSeenAt")
		u := fmt.Sprintf("DELETE { GRAPH <%[1]s> { ?i %[2]s ?o } } INSERT { GRAPH <%[1]s> { ?i %[2]s %[3]s } } WHERE { VALUES ?i { %[4]s } GRAPH <%[1]s> { ?i %[2]s ?o } }",
			s.g, p, dt(at), strings.Join(nodes, " "))
		if err := s.graph.Update(ctx, u); err != nil {
			return err
		}
	}
	return nil
}

// stringFields maps a binding variable to the Issue field it fills.
func (i *Issue) stringFields() map[string]*string {
	return map[string]*string{
		"id": &i.ID, "individualIri": &i.IndividualIri, "typeIri": &i.TypeIri, "ruleId": &i.RuleId, "shapeIri": &i.ShapeIri,
		"path": &i.Path, "constraint": &i.Constraint, "individualLabel": &i.IndividualLabel, "message": &i.Message,
		"qualityDimension": &i.QualityDimension, "status": &i.Status, "resolvedBy": &i.ResolvedBy, "assignee": &i.Assignee,
		"assigneeName": &i.AssigneeName, "note": &i.Note, "externalSystem": &i.ExternalSystem, "externalId": &i.ExternalID,
		"createdAt": &i.CreatedAt, "updatedBy": &i.UpdatedBy, "updatedByName": &i.UpdatedByName, "updatedAt": &i.UpdatedAt,
		"lastSeenAt": &i.LastSeenAt, "serviceNowAssignee": &i.ServiceNowAssignee, "serviceNowGroup": &i.ServiceNowGroup,
		"syncState": &i.SyncState, "lastSyncedAt": &i.LastSyncedAt, "lastError": &i.LastError,
		"serviceNowResolution": &i.ServiceNowResolution,
	}
}

var selectVars = []struct{ v, pred string }{
	{"individualIri", "individualIri"}, {"typeIri", "typeIri"}, {"ruleId", "ruleId"}, {"shapeIri", "shapeIri"}, {"path", "path"},
	{"constraint", "constraint"}, {"individualLabel", "individualLabel"}, {"message", "message"},
	{"qualityDimension", "qualityDimension"}, {"value", "value"}, {"status", "status"}, {"resolvedBy", "resolvedBy"}, {"assignee", "assignee"},
	{"assigneeName", "assigneeName"}, {"note", "note"}, {"externalSystem", "externalSystem"}, {"externalId", "externalId"},
	{"createdAt", "createdAt"}, {"updatedBy", "updatedBy"}, {"updatedByName", "updatedByName"}, {"updatedAt", "updatedAt"},
	{"lastSeenAt", "lastSeenAt"}, {"serviceNowAssignee", "serviceNowAssignee"}, {"serviceNowGroup", "serviceNowGroup"},
	{"syncState", "syncState"}, {"lastSyncedAt", "lastSyncedAt"}, {"lastError", "lastError"},
	{"serviceNowResolution", "serviceNowResolution"}, {"followUpNeeded", "followUpNeeded"},
}

func (s *Store) selectClause(idPattern string) string {
	vars := make([]string, 0, len(selectVars)+1)
	opts := make([]string, 0, len(selectVars))
	for _, f := range selectVars {
		vars = append(vars, "?"+f.v)
		opts = append(opts, "OPTIONAL { ?i "+s.p(f.pred)+" ?"+f.v+" }")
	}
	return fmt.Sprintf("SELECT ?id %s FROM <%s> WHERE { ?i a %s ; %s ?id . %s %s }",
		strings.Join(vars, " "), s.g, s.p("Issue"), s.p("findingId"), idPattern, strings.Join(opts, " "))
}

func fromBinding(b map[string]graphdb.Binding) Issue {
	var i Issue
	for name, dst := range i.stringFields() {
		if v, ok := b[name]; ok {
			*dst = v.Value
		}
	}
	if v, ok := b["value"]; ok {
		val := v.Value
		i.Value = &val
	}
	i.FollowUpNeeded = b["followUpNeeded"].Value == "true"
	if i.SyncState == "" {
		i.SyncState = SyncNone
	}
	i.Tickets = []Ticket{}
	return i
}

// loadTickets reads the ticket nodes of the given issues, in batches, and attaches them oldest first.
func (s *Store) loadTickets(ctx context.Context, is []Issue) error {
	pos := make(map[string]int, len(is))
	for n, i := range is {
		pos[i.ID] = n
	}
	for start := 0; start < len(is); start += batch {
		end := min(start+batch, len(is))
		var nodes []string
		for _, i := range is[start:end] {
			if !ValidID(i.ID) {
				return inputErrorf("Invalid issue id")
			}
			nodes = append(nodes, s.nodeIRI(i.ID))
		}
		opt := func(v string) string { return "OPTIONAL { ?t " + s.p(v) + " ?" + v + " }" }
		q := fmt.Sprintf("SELECT ?id ?correlationId ?number ?sysId ?state ?stateLabel ?createdAt ?closedAt ?url FROM <%s> WHERE { VALUES ?i { %s } ?t a %s ; %s ?i ; %s ?correlationId . ?i %s ?id . %s }",
			s.g, strings.Join(nodes, " "), s.p("Ticket"), s.p("ticketOf"), s.p("correlationId"), s.p("findingId"),
			strings.Join([]string{opt("number"), opt("sysId"), opt("state"), opt("stateLabel"), opt("createdAt"), opt("closedAt"), opt("url")}, " "))
		res, err := s.graph.Select(ctx, q)
		if err != nil {
			return err
		}
		for _, b := range res.Results.Bindings {
			n, ok := pos[b["id"].Value]
			if !ok {
				continue
			}
			is[n].Tickets = append(is[n].Tickets, Ticket{
				CorrelationID: b["correlationId"].Value, Number: b["number"].Value, SysID: b["sysId"].Value, State: b["state"].Value,
				StateLabel: b["stateLabel"].Value, CreatedAt: b["createdAt"].Value, ClosedAt: b["closedAt"].Value, URL: b["url"].Value,
			})
		}
	}
	for n := range is {
		sortTickets(is[n].Tickets)
	}
	return nil
}

// Get returns one issue by finding id.
func (s *Store) Get(ctx context.Context, id string) (Issue, bool, error) {
	if !ValidID(id) {
		return Issue{}, false, inputErrorf("Invalid issue id")
	}
	res, err := s.graph.Select(ctx, s.selectClause("FILTER(?id = "+lit(id)+")")+" LIMIT 1")
	if err != nil {
		return Issue{}, false, err
	}
	if len(res.Results.Bindings) == 0 {
		return Issue{}, false, nil
	}
	one := []Issue{fromBinding(res.Results.Bindings[0])}
	if err := s.loadTickets(ctx, one); err != nil {
		return Issue{}, false, err
	}
	return one[0], true, nil
}

// List returns one page of issues, newest change first.
func (s *Store) List(ctx context.Context, f Filter) ([]Issue, error) {
	filters, err := s.filters(f)
	if err != nil {
		return nil, err
	}
	limit := f.Limit
	if limit <= 0 {
		limit = defaultLimit
	}
	limit = min(limit, MaxLimit)
	offset := max(f.Offset, 0)
	q := s.selectClause(strings.Join(filters, " ")) + " ORDER BY DESC(?updatedAt) ?id LIMIT " + strconv.Itoa(limit) + " OFFSET " + strconv.Itoa(offset)
	res, err := s.graph.Select(ctx, q)
	if err != nil {
		return nil, err
	}
	out := make([]Issue, 0, len(res.Results.Bindings))
	for _, b := range res.Results.Bindings {
		out = append(out, fromBinding(b))
	}
	if len(out) > 0 {
		if err := s.loadTickets(ctx, out); err != nil {
			return nil, err
		}
	}
	return out, nil
}

// Count is the number of issues matching the filter (paging ignored).
func (s *Store) Count(ctx context.Context, f Filter) (int, error) {
	filters, err := s.filters(f)
	if err != nil {
		return 0, err
	}
	q := fmt.Sprintf("SELECT (COUNT(DISTINCT ?i) AS ?n) FROM <%s> WHERE { ?i a %s ; %s ?id . %s }",
		s.g, s.p("Issue"), s.p("findingId"), strings.Join(filters, " "))
	res, err := s.graph.Select(ctx, q)
	if err != nil {
		return 0, err
	}
	if len(res.Results.Bindings) == 0 {
		return 0, nil
	}
	n, _ := strconv.Atoi(res.Results.Bindings[0]["n"].Value)
	return n, nil
}

// All returns every issue, paged internally; the reconcile needs the whole set.
func (s *Store) All(ctx context.Context) ([]Issue, error) {
	var all []Issue
	for offset := 0; ; offset += MaxLimit {
		page, err := s.List(ctx, Filter{Limit: MaxLimit, Offset: offset})
		if err != nil {
			return nil, err
		}
		all = append(all, page...)
		if len(page) < MaxLimit {
			return all, nil
		}
	}
}

func (s *Store) filters(f Filter) ([]string, error) {
	var out []string
	eq := func(name, v string) {
		out = append(out, "?i "+s.p(name)+" "+lit(v)+" .")
	}
	if f.Status != "" {
		if !validStatus(f.Status) {
			return nil, inputErrorf("Invalid status")
		}
		eq("status", f.Status)
	}
	if f.Assignee != "" {
		if len(f.Assignee) > MaxSub {
			return nil, inputErrorf("Invalid assignee")
		}
		eq("assignee", f.Assignee)
	}
	if f.RuleID != "" {
		if len(f.RuleID) > maxSnapshot {
			return nil, inputErrorf("Invalid rule id")
		}
		eq("ruleId", f.RuleID)
	}
	if f.IndividualIri != "" {
		if !sparqlsafe.SafeIRI(f.IndividualIri) {
			return nil, inputErrorf("Invalid individual IRI")
		}
		eq("individualIri", f.IndividualIri)
	}
	return out, nil
}

// RunRecord is what the last reconcile saw besides the findings: when it ran and what it could not check.
type RunRecord struct {
	At         string
	NotChecked []validation.NotChecked
}

func (s *Store) runNode() string { return "<" + s.ns + "lastRun>" }

// SaveRun replaces the single last-run node of the issues graph.
func (s *Store) SaveRun(ctx context.Context, r RunRecord) error {
	nc := r.NotChecked
	if nc == nil {
		nc = []validation.NotChecked{}
	}
	raw, err := json.Marshal(nc)
	if err != nil {
		return err
	}
	u := fmt.Sprintf("DELETE WHERE { GRAPH <%[1]s> { %[2]s ?p ?o } } ;\nINSERT DATA { GRAPH <%[1]s> { %[2]s %[3]s %[4]s ; %[5]s %[6]s } }",
		s.g, s.runNode(), s.p("runAt"), dt(r.At), s.p("notChecked"), lit(string(raw)))
	return s.graph.Update(ctx, u)
}

// LastRun reads the record SaveRun wrote; ok is false before the first run.
func (s *Store) LastRun(ctx context.Context) (RunRecord, bool, error) {
	q := fmt.Sprintf("SELECT ?at ?notChecked FROM <%s> WHERE { %s %s ?at . OPTIONAL { %s %s ?notChecked } } LIMIT 1",
		s.g, s.runNode(), s.p("runAt"), s.runNode(), s.p("notChecked"))
	res, err := s.graph.Select(ctx, q)
	if err != nil {
		return RunRecord{}, false, err
	}
	if len(res.Results.Bindings) == 0 {
		return RunRecord{}, false, nil
	}
	b := res.Results.Bindings[0]
	rec := RunRecord{At: b["at"].Value, NotChecked: []validation.NotChecked{}}
	if raw := b["notChecked"].Value; raw != "" {
		if err := json.Unmarshal([]byte(raw), &rec.NotChecked); err != nil {
			return RunRecord{}, false, fmt.Errorf("stored last run is unreadable: %w", err)
		}
	}
	return rec, true, nil
}

func (s *Store) syncNode() string { return "<" + s.ns + "ticketSync>" }

// SyncWatermark is the newest ServiceNow `sys_updated_on` the ticket sync has applied; zero before the
// first sync. It lives on its own node, so the reconcile's run record can be replaced without losing it.
func (s *Store) SyncWatermark(ctx context.Context) (time.Time, error) {
	q := fmt.Sprintf("SELECT ?at FROM <%s> WHERE { %s %s ?at } LIMIT 1", s.g, s.syncNode(), s.p("watermark"))
	res, err := s.graph.Select(ctx, q)
	if err != nil {
		return time.Time{}, err
	}
	if len(res.Results.Bindings) == 0 {
		return time.Time{}, nil
	}
	t, err := time.Parse(time.RFC3339Nano, res.Results.Bindings[0]["at"].Value)
	if err != nil {
		return time.Time{}, fmt.Errorf("stored sync watermark is unreadable: %w", err)
	}
	return t.UTC(), nil
}

// SaveSyncWatermark replaces the watermark.
func (s *Store) SaveSyncWatermark(ctx context.Context, t time.Time) error {
	u := fmt.Sprintf("DELETE WHERE { GRAPH <%[1]s> { %[2]s ?p ?o } } ;\nINSERT DATA { GRAPH <%[1]s> { %[2]s %[3]s %[4]s } }",
		s.g, s.syncNode(), s.p("watermark"), dt(t.UTC().Format("2006-01-02T15:04:05.000Z")))
	return s.graph.Update(ctx, u)
}
