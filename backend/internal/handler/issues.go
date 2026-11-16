package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/nebucaz/rdf-schema-editor/backend/internal/graphdb"
	"github.com/nebucaz/rdf-schema-editor/backend/internal/issues"
	"github.com/nebucaz/rdf-schema-editor/backend/internal/validation"
)

// IssuesService is what the handler needs from *issues.Service.
type IssuesService interface {
	Reconcile(ctx context.Context, v []validation.Violation, nc []validation.NotChecked, by issues.Actor, at string) (issues.Run, error)
	Report(ctx context.Context) (issues.Report, error)
	List(ctx context.Context, f issues.Filter) (issues.Page, error)
	Patch(ctx context.Context, id string, p issues.Patch, by issues.Actor, at string) (issues.Issue, error)
	Assignees(ctx context.Context, caller issues.Actor) ([]issues.Assignee, error)
	CreateTicket(ctx context.Context, id string, by issues.Actor, at string) (issues.Issue, error)
	PlanTickets(ctx context.Context, sel issues.TicketSelection) (issues.TicketRun, error)
	CreateTickets(ctx context.Context, sel issues.TicketSelection, by issues.Actor, at string) (issues.TicketRun, error)
}

// TicketSyncer runs one ServiceNow sync pass; *servicenow.Runner satisfies it.
type TicketSyncer interface {
	Run(ctx context.Context, apply bool) (issues.SyncReport, error)
}

// CheckRunner runs the same full validation as GET /validation/report.
type CheckRunner func(ctx context.Context) (validation.CheckResult, error)

// NewCheckRunner is the full check against GraphDB: a fresh snapshot, then `validation.CheckAll`.
func NewCheckRunner(gdb *graphdb.Client) CheckRunner {
	return func(ctx context.Context) (validation.CheckResult, error) {
		snapshot, err := validation.LoadValidationSnapshot(ctx, gdb)
		if err != nil {
			return validation.CheckResult{}, err
		}
		return validation.CheckAll(ctx, gdb, snapshot), nil
	}
}

// IssuesHandler serves `/issues*`. The server stamps who and when from the verified cookie user;
// any author, time or external URL in a request body is never read.
type IssuesHandler struct {
	svc    IssuesService
	run    CheckRunner
	now    func() string
	syncer TicketSyncer // nil while the ServiceNow integration is off
}

// EnableSync wires the ticket sync pass behind POST /issues/tickets/sync.
func (h *IssuesHandler) EnableSync(s TicketSyncer) { h.syncer = s }

// NewIssuesHandler builds the handler around svc and the check runner.
func NewIssuesHandler(svc IssuesService, run CheckRunner) *IssuesHandler {
	return &IssuesHandler{svc: svc, run: run, now: func() string { return time.Now().UTC().Format("2006-01-02T15:04:05.000Z") }}
}

func issuesStatus(err error) int {
	switch {
	case issues.IsInputError(err):
		return http.StatusBadRequest
	case issues.IsNotFound(err):
		return http.StatusNotFound
	case issues.IsConflict(err):
		return http.StatusConflict
	}
	return http.StatusBadGateway
}

func actorOf(w http.ResponseWriter, r *http.Request) (issues.Actor, bool) {
	user, ok := UserFromRequest(r)
	if !ok {
		writeJSONError(w, http.StatusUnauthorized, "Sign in required")
		return issues.Actor{}, false
	}
	return issues.Actor{Sub: user.Sub, DisplayName: user.DisplayName(), Email: user.Email}, true
}

// Reconcile handles POST /issues/reconcile: runs the full check, reconciles the issues with it and
// returns `{violations, notChecked, issues, resolvedBySystem}`. A check that fails writes nothing.
func (h *IssuesHandler) Reconcile(w http.ResponseWriter, r *http.Request) {
	by, ok := actorOf(w, r)
	if !ok {
		return
	}
	result, err := h.run(r.Context())
	if err != nil {
		auditLog(r, "", http.StatusBadGateway, "run validation: "+err.Error())
		writeJSONError(w, http.StatusBadGateway, "Validation could not run: "+err.Error())
		return
	}
	run, err := h.svc.Reconcile(r.Context(), result.Violations, result.NotChecked, by, h.now())
	if err != nil {
		writeJSONError(w, issuesStatus(err), err.Error())
		return
	}
	if result.Violations == nil {
		result.Violations = []validation.Violation{}
	}
	if result.NotChecked == nil {
		result.NotChecked = []validation.NotChecked{}
	}
	outcomes := run.Outcomes
	if outcomes == nil {
		outcomes = []issues.Outcome{}
	}
	writeJSON(w, map[string]any{"violations": result.Violations, "notChecked": result.NotChecked, "issues": outcomes, "resolvedBySystem": run.ResolvedBySystem})
}

// Report handles GET /issues/report: the findings, issue outcomes and notChecked of the last run, so
// the validation page can open with them without running the check.
func (h *IssuesHandler) Report(w http.ResponseWriter, r *http.Request) {
	if _, ok := actorOf(w, r); !ok {
		return
	}
	rep, err := h.svc.Report(r.Context())
	if err != nil {
		writeJSONError(w, issuesStatus(err), err.Error())
		return
	}
	writeJSON(w, rep)
}

// List handles GET /issues?status=&assignee=&ruleId=&individualIri=&limit=&offset=.
func (h *IssuesHandler) List(w http.ResponseWriter, r *http.Request) {
	if _, ok := actorOf(w, r); !ok {
		return
	}
	q := r.URL.Query()
	limit, _ := strconv.Atoi(q.Get("limit"))
	offset, _ := strconv.Atoi(q.Get("offset"))
	page, err := h.svc.List(r.Context(), issues.Filter{
		Status: q.Get("status"), Assignee: q.Get("assignee"), RuleID: q.Get("ruleId"), IndividualIri: q.Get("individualIri"),
		Limit: limit, Offset: offset,
	})
	if err != nil {
		writeJSONError(w, issuesStatus(err), err.Error())
		return
	}
	if page.Issues == nil {
		page.Issues = []issues.Issue{}
	}
	writeJSON(w, page)
}

// Patch handles PATCH /issues/{id}.
func (h *IssuesHandler) Patch(w http.ResponseWriter, r *http.Request) {
	by, ok := actorOf(w, r)
	if !ok {
		return
	}
	body, ok := readJSONObject(w, r)
	if !ok {
		return
	}
	raw, _ := json.Marshal(body)
	var patch issues.Patch // has no stamp or URL field, so those client values cannot be read
	if err := json.Unmarshal(raw, &patch); err != nil {
		writeJSONError(w, http.StatusBadRequest, "Invalid issue update")
		return
	}
	issue, err := h.svc.Patch(r.Context(), chi.URLParam(r, "id"), patch, by, h.now())
	if err != nil {
		writeJSONError(w, issuesStatus(err), err.Error())
		return
	}
	writeJSON(w, issue)
}

// Assignees handles GET /issues/assignees.
func (h *IssuesHandler) Assignees(w http.ResponseWriter, r *http.Request) {
	by, ok := actorOf(w, r)
	if !ok {
		return
	}
	list, err := h.svc.Assignees(r.Context(), by)
	if err != nil {
		writeJSONError(w, issuesStatus(err), err.Error())
		return
	}
	writeJSON(w, map[string]any{"assignees": list})
}

// CreateTicket handles POST /issues/{id}/ticket: opens the ServiceNow ticket of one issue, stamped with the
// verified user. The body is not read; nothing a client sends influences the ticket.
func (h *IssuesHandler) CreateTicket(w http.ResponseWriter, r *http.Request) {
	by, ok := actorOf(w, r)
	if !ok {
		return
	}
	issue, err := h.svc.CreateTicket(r.Context(), chi.URLParam(r, "id"), by, h.now())
	if err != nil {
		auditLog(r, "", issuesStatus(err), "create ticket: "+err.Error())
		writeJSONError(w, issuesStatus(err), err.Error())
		return
	}
	writeJSON(w, issue)
}

// selectionOf reads the bulk selection (ids or filter fields) from the request body.
func selectionOf(w http.ResponseWriter, r *http.Request) (issues.TicketSelection, bool) {
	body, ok := readJSONObject(w, r)
	if !ok {
		return issues.TicketSelection{}, false
	}
	raw, _ := json.Marshal(body)
	var sel issues.TicketSelection
	if err := json.Unmarshal(raw, &sel); err != nil {
		writeJSONError(w, http.StatusBadRequest, "Invalid selection")
		return issues.TicketSelection{}, false
	}
	return sel, true
}

// PlanTickets handles POST /issues/tickets/dry-run: what a bulk creation would do, changing nothing.
func (h *IssuesHandler) PlanTickets(w http.ResponseWriter, r *http.Request) {
	if _, ok := actorOf(w, r); !ok {
		return
	}
	sel, ok := selectionOf(w, r)
	if !ok {
		return
	}
	run, err := h.svc.PlanTickets(r.Context(), sel)
	if err != nil {
		writeJSONError(w, issuesStatus(err), err.Error())
		return
	}
	writeJSON(w, run)
}

// CreateTickets handles POST /issues/tickets: the bulk creation, bounded by the per-run cap.
func (h *IssuesHandler) CreateTickets(w http.ResponseWriter, r *http.Request) {
	by, ok := actorOf(w, r)
	if !ok {
		return
	}
	sel, ok := selectionOf(w, r)
	if !ok {
		return
	}
	run, err := h.svc.CreateTickets(r.Context(), sel, by, h.now())
	if err != nil {
		auditLog(r, "", issuesStatus(err), "create tickets: "+err.Error())
		writeJSONError(w, issuesStatus(err), err.Error())
		return
	}
	writeJSON(w, run)
}

// SyncTickets handles POST /issues/tickets/sync[?dryRun=true]: one pull-then-push pass, the same code the
// worker runs. It is service-only (no user needed, like /sources/*) so importctl can call it; the pass stamps
// its changes `servicenow`, never a caller. A pass already running answers 409.
func (h *IssuesHandler) SyncTickets(w http.ResponseWriter, r *http.Request) {
	if h.syncer == nil {
		writeJSONError(w, http.StatusConflict, "The ServiceNow integration is not enabled")
		return
	}
	dryRun := r.URL.Query().Get("dryRun") == "true"
	rep, err := h.syncer.Run(r.Context(), !dryRun)
	if err != nil {
		auditLog(r, "", issuesStatus(err), "sync tickets: "+err.Error())
		writeJSONError(w, issuesStatus(err), err.Error())
		return
	}
	writeJSON(w, rep)
}
