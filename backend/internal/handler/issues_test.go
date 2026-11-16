package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/nebucaz/rdf-schema-editor/backend/internal/issues"
	"github.com/nebucaz/rdf-schema-editor/backend/internal/userjwt"
	"github.com/nebucaz/rdf-schema-editor/backend/internal/validation"
)

type fakeIssues struct {
	reconcileBy issues.Actor
	reconcileAt string
	violations  []validation.Violation
	notChecked  []validation.NotChecked
	filter      issues.Filter
	patchID     string
	patch       issues.Patch
	patchBy     issues.Actor
	ticketID    string
	ticketBy    issues.Actor
	selection   issues.TicketSelection
	runBy       issues.Actor
	dry         bool
	err         error
}

func (f *fakeIssues) Reconcile(_ context.Context, v []validation.Violation, nc []validation.NotChecked, by issues.Actor, at string) (issues.Run, error) {
	f.violations, f.notChecked, f.reconcileBy, f.reconcileAt = v, nc, by, at
	return issues.Run{Outcomes: []issues.Outcome{{FindingID: "f1", IssueID: "f1", Status: "open", IsNew: true}}, ResolvedBySystem: 2}, f.err
}
func (f *fakeIssues) List(_ context.Context, fl issues.Filter) (issues.Page, error) {
	f.filter = fl
	return issues.Page{Issues: []issues.Issue{{ID: "f1"}}, Total: 1}, f.err
}
func (f *fakeIssues) Patch(_ context.Context, id string, p issues.Patch, by issues.Actor, _ string) (issues.Issue, error) {
	f.patchID, f.patch, f.patchBy = id, p, by
	return issues.Issue{ID: id, Status: "resolved"}, f.err
}
func (f *fakeIssues) CreateTicket(_ context.Context, id string, by issues.Actor, _ string) (issues.Issue, error) {
	f.ticketID, f.ticketBy = id, by
	return issues.Issue{ID: id, ExternalID: "INC1"}, f.err
}
func (f *fakeIssues) PlanTickets(_ context.Context, sel issues.TicketSelection) (issues.TicketRun, error) {
	f.selection, f.dry = sel, true
	return issues.TicketRun{DryRun: true, Cap: 25, Items: []issues.TicketItem{{IssueID: "f1", Action: issues.TicketActionCreate}}}, f.err
}
func (f *fakeIssues) CreateTickets(_ context.Context, sel issues.TicketSelection, by issues.Actor, _ string) (issues.TicketRun, error) {
	f.selection, f.runBy, f.dry = sel, by, false
	return issues.TicketRun{Cap: 25, Items: []issues.TicketItem{{IssueID: "f1", Action: issues.TicketActionCreate, Result: issues.TicketResultCreated, Number: "INC1"}}}, f.err
}
func (f *fakeIssues) Report(context.Context) (issues.Report, error) {
	return issues.Report{RunAt: "2026-03-04T05:06:07.089Z", Violations: []validation.Violation{{ID: "f1"}}, NotChecked: []validation.NotChecked{}, Issues: []issues.Outcome{{FindingID: "f1", IssueID: "f1", Status: "open"}}}, f.err
}
func (f *fakeIssues) Assignees(_ context.Context, caller issues.Actor) ([]issues.Assignee, error) {
	return []issues.Assignee{{Sub: caller.Sub, DisplayName: caller.DisplayName}}, f.err
}

func issuesRouter(svc *fakeIssues, runErr error) http.Handler {
	run := func(context.Context) (validation.CheckResult, error) {
		return validation.CheckResult{Violations: []validation.Violation{{ID: "f1"}}}, runErr
	}
	h := NewIssuesHandler(svc, run)
	h.now = func() string { return "2026-03-04T05:06:07.089Z" }
	r := chi.NewRouter()
	r.Use(RequireUser)
	r.Post("/issues/reconcile", h.Reconcile)
	r.Get("/issues", h.List)
	r.Get("/issues/report", h.Report)
	r.Get("/issues/assignees", h.Assignees)
	r.Patch("/issues/{id}", h.Patch)
	r.Post("/issues/{id}/ticket", h.CreateTicket)
	r.Post("/issues/tickets/dry-run", h.PlanTickets)
	r.Post("/issues/tickets", h.CreateTickets)
	return r
}

var alicia = &userjwt.User{Sub: "alice", Name: "Alice A"}

func TestIssues_AllRoutesRequireAUser(t *testing.T) {
	svc := &fakeIssues{}
	for _, c := range [][2]string{{"POST", "/issues/reconcile"}, {"GET", "/issues"}, {"GET", "/issues/assignees"}, {"PATCH", "/issues/f1"}} {
		if w := do(issuesRouter(svc, nil), c[0], c[1], `{}`, nil); w.Code != http.StatusUnauthorized {
			t.Errorf("%s %s = %d", c[0], c[1], w.Code)
		}
	}
	if svc.patchID != "" || svc.violations != nil {
		t.Error("an anonymous request reached the service")
	}
}

func TestIssuesReconcile_RunsTheCheckAndStampsTheCaller(t *testing.T) {
	svc := &fakeIssues{}
	w := do(issuesRouter(svc, nil), http.MethodPost, "/issues/reconcile", `{"by":"mallory"}`, alicia)
	if w.Code != 200 {
		t.Fatalf("status = %d: %s", w.Code, w.Body)
	}
	if svc.reconcileBy.Sub != "alice" || svc.reconcileBy.DisplayName != "Alice A" || svc.reconcileAt != "2026-03-04T05:06:07.089Z" {
		t.Errorf("stamp = %+v at %q", svc.reconcileBy, svc.reconcileAt)
	}
	var out struct {
		Violations []validation.Violation  `json:"violations"`
		NotChecked []validation.NotChecked `json:"notChecked"`
		Issues     []issues.Outcome        `json:"issues"`
		Resolved   int                     `json:"resolvedBySystem"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if len(out.Violations) != 1 || out.NotChecked == nil || len(out.Issues) != 1 || !out.Issues[0].IsNew || out.Resolved != 2 {
		t.Errorf("body = %s", w.Body)
	}
}

func TestIssuesReconcile_AFailedCheckWritesNothing(t *testing.T) {
	svc := &fakeIssues{}
	if w := do(issuesRouter(svc, errors.New("snapshot failed")), http.MethodPost, "/issues/reconcile", ``, alicia); w.Code != 502 || svc.reconcileAt != "" {
		t.Errorf("status = %d, reconciled = %q", w.Code, svc.reconcileAt)
	}
}

func TestIssuesList_PassesFilters(t *testing.T) {
	svc := &fakeIssues{}
	w := do(issuesRouter(svc, nil), http.MethodGet, "/issues?status=open&assignee=bob&ruleId=r1&individualIri=urn:x&limit=20&offset=40", "", alicia)
	if w.Code != 200 || svc.filter != (issues.Filter{Status: "open", Assignee: "bob", RuleID: "r1", IndividualIri: "urn:x", Limit: 20, Offset: 40}) {
		t.Errorf("status = %d filter = %+v", w.Code, svc.filter)
	}
}

func TestIssuesPatch_IgnoresClientStampsAndUsesTheCaller(t *testing.T) {
	svc := &fakeIssues{}
	body := `{"status":"resolved","note":"n","updatedBy":"mallory","updatedAt":"1998","externalUrl":"https://evil.example"}`
	w := do(issuesRouter(svc, nil), http.MethodPatch, "/issues/f1", body, alicia)
	if w.Code != 200 || svc.patchID != "f1" || svc.patchBy.Sub != "alice" || *svc.patch.Status != "resolved" || *svc.patch.Note != "n" {
		t.Errorf("status = %d patch = %+v by %+v", w.Code, svc.patch, svc.patchBy)
	}
}

func TestIssuesPatch_StatusMapping(t *testing.T) {
	if w := do(issuesRouter(&fakeIssues{err: issues.ErrNotFound}, nil), http.MethodPatch, "/issues/f1", `{"note":"x"}`, alicia); w.Code != 404 {
		t.Errorf("unknown id = %d", w.Code)
	}
	if w := do(issuesRouter(&fakeIssues{}, nil), http.MethodPatch, "/issues/f1", `[1]`, alicia); w.Code != 400 {
		t.Errorf("non-object = %d", w.Code)
	}
	if w := do(issuesRouter(&fakeIssues{err: errors.New("graphdb down")}, nil), http.MethodGet, "/issues", "", alicia); w.Code != 502 {
		t.Errorf("graph error = %d", w.Code)
	}
}

func TestIssuesAssignees_IncludesTheCaller(t *testing.T) {
	w := do(issuesRouter(&fakeIssues{}, nil), http.MethodGet, "/issues/assignees", "", alicia)
	var out struct{ Assignees []issues.Assignee }
	_ = json.Unmarshal(w.Body.Bytes(), &out)
	if w.Code != 200 || len(out.Assignees) != 1 || out.Assignees[0].Sub != "alice" {
		t.Errorf("status = %d body = %s", w.Code, w.Body)
	}
}

func TestReportReturnsTheStoredRun(t *testing.T) {
	rec := do(issuesRouter(&fakeIssues{}, nil), http.MethodGet, "/issues/report", "", alicia)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
	}
	var body struct {
		RunAt      string           `json:"runAt"`
		Violations []map[string]any `json:"violations"`
		NotChecked []any            `json:"notChecked"`
		Issues     []map[string]any `json:"issues"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil || body.RunAt == "" || len(body.Violations) != 1 || body.NotChecked == nil || len(body.Issues) != 1 {
		t.Errorf("body = %s err=%v", rec.Body.String(), err)
	}
	if rec := do(issuesRouter(&fakeIssues{}, nil), http.MethodGet, "/issues/report", "", nil); rec.Code != http.StatusUnauthorized {
		t.Errorf("anonymous status = %d", rec.Code)
	}
}

func TestIssuesCreateTicket_UsesTheCallerAndReturnsTheIssue(t *testing.T) {
	svc := &fakeIssues{}
	w := do(issuesRouter(svc, nil), http.MethodPost, "/issues/f1/ticket", `{"by":"mallory"}`, alicia)
	if w.Code != 200 || svc.ticketID != "f1" || svc.ticketBy.Sub != "alice" || !strings.Contains(w.Body.String(), "INC1") {
		t.Errorf("status = %d id = %q by %+v body %s", w.Code, svc.ticketID, svc.ticketBy, w.Body)
	}
	if w := do(issuesRouter(&fakeIssues{}, nil), http.MethodPost, "/issues/f1/ticket", `{}`, nil); w.Code != 401 {
		t.Errorf("anonymous = %d", w.Code)
	}
}

func TestIssuesCreateTicket_StatusMapping(t *testing.T) {
	cases := map[int]error{
		404: issues.ErrNotFound,
		409: nil,
		502: &issues.TicketError{Err: errors.New("unavailable")},
	}
	for want, err := range cases {
		if want == 409 {
			err = conflictOf(t)
		}
		if w := do(issuesRouter(&fakeIssues{err: err}, nil), http.MethodPost, "/issues/f1/ticket", ``, alicia); w.Code != want {
			t.Errorf("%v = %d, want %d", err, w.Code, want)
		}
	}
}

// conflictOf is a real conflict error: ticket creation on a service whose integration is off.
func conflictOf(t *testing.T) error {
	t.Helper()
	_, err := issues.NewService(nil, "http://example.org/o", "").CreateTicket(context.Background(), "abcdefghij234567", issues.Actor{}, "t")
	if !issues.IsConflict(err) {
		t.Fatalf("not a conflict: %v", err)
	}
	return err
}

func TestIssuesBulkTickets_DryRunAndRunTakeTheSelectionAndStampTheCaller(t *testing.T) {
	svc := &fakeIssues{}
	body := `{"ids":["f1","f2"],"status":"","by":"mallory"}`
	w := do(issuesRouter(svc, nil), http.MethodPost, "/issues/tickets/dry-run", body, alicia)
	if w.Code != 200 || !svc.dry || len(svc.selection.IDs) != 2 || !strings.Contains(w.Body.String(), `"dryRun":true`) {
		t.Errorf("dry-run = %d %s selection %+v", w.Code, w.Body, svc.selection)
	}
	w = do(issuesRouter(svc, nil), http.MethodPost, "/issues/tickets", `{"status":"open","ruleId":"arm-s:7"}`, alicia)
	if w.Code != 200 || svc.dry || svc.runBy.Sub != "alice" || svc.selection.Status != "open" || svc.selection.RuleID != "arm-s:7" || !strings.Contains(w.Body.String(), "INC1") {
		t.Errorf("run = %d %s by %+v selection %+v", w.Code, w.Body, svc.runBy, svc.selection)
	}
}

func TestIssuesBulkTickets_AuthAndErrors(t *testing.T) {
	for _, path := range []string{"/issues/tickets/dry-run", "/issues/tickets"} {
		if w := do(issuesRouter(&fakeIssues{}, nil), http.MethodPost, path, `{}`, nil); w.Code != 401 {
			t.Errorf("%s anonymous = %d", path, w.Code)
		}
		if w := do(issuesRouter(&fakeIssues{}, nil), http.MethodPost, path, `[1]`, alicia); w.Code != 400 {
			t.Errorf("%s non-object = %d", path, w.Code)
		}
		if w := do(issuesRouter(&fakeIssues{err: errors.New("graphdb down")}, nil), http.MethodPost, path, `{}`, alicia); w.Code != 502 {
			t.Errorf("%s graph error = %d", path, w.Code)
		}
	}
	if w := do(issuesRouter(&fakeIssues{err: conflictOf(t)}, nil), http.MethodPost, "/issues/tickets", `{}`, alicia); w.Code != 409 {
		t.Errorf("disabled integration = %d", w.Code)
	}
}

type fakeSyncer struct {
	apply []bool
	rep   issues.SyncReport
	err   error
}

func (f *fakeSyncer) Run(_ context.Context, apply bool) (issues.SyncReport, error) {
	f.apply = append(f.apply, apply)
	rep := f.rep
	rep.DryRun = !apply
	return rep, f.err
}

func syncRouter(s TicketSyncer) http.Handler {
	h := NewIssuesHandler(&fakeIssues{}, nil)
	if s != nil {
		h.EnableSync(s)
	}
	r := chi.NewRouter()
	r.Post("/issues/tickets/sync", h.SyncTickets)
	return r
}

func TestIssuesSyncTickets_RunsThePassAndHonoursDryRun(t *testing.T) {
	s := &fakeSyncer{rep: issues.SyncReport{Pulled: 2, Pushed: 3, Errors: 1}}
	w := do(syncRouter(s), http.MethodPost, "/issues/tickets/sync", ``, nil)
	if w.Code != 200 || len(s.apply) != 1 || !s.apply[0] || !strings.Contains(w.Body.String(), `"pulled":2`) || !strings.Contains(w.Body.String(), `"pushed":3`) || !strings.Contains(w.Body.String(), `"errors":1`) || !strings.Contains(w.Body.String(), `"dryRun":false`) {
		t.Errorf("apply = %d %s %v", w.Code, w.Body, s.apply)
	}
	w = do(syncRouter(s), http.MethodPost, "/issues/tickets/sync?dryRun=true", ``, nil)
	if w.Code != 200 || s.apply[1] || !strings.Contains(w.Body.String(), `"dryRun":true`) {
		t.Errorf("dry run = %d %s %v", w.Code, w.Body, s.apply)
	}
}

func TestIssuesSyncTickets_BusyIs409DisabledIs409AndFailuresAre502(t *testing.T) {
	if w := do(syncRouter(&fakeSyncer{err: issues.ErrSyncBusy}), http.MethodPost, "/issues/tickets/sync", ``, nil); w.Code != 409 {
		t.Errorf("busy = %d", w.Code)
	}
	if w := do(syncRouter(nil), http.MethodPost, "/issues/tickets/sync", ``, nil); w.Code != 409 {
		t.Errorf("disabled = %d", w.Code)
	}
	if w := do(syncRouter(&fakeSyncer{err: errors.New("graphdb down")}), http.MethodPost, "/issues/tickets/sync", ``, nil); w.Code != 502 {
		t.Errorf("failure = %d", w.Code)
	}
}
