package issues

import (
	"context"
	"errors"
	"regexp"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/nebucaz/rdf-schema-editor/backend/internal/graphdb"
)

// multiGraph answers per-id reads (`FILTER(?id = "x")`), the ticket read of a batch and list/count queries
// for a set of issues, and records every update.
type multiGraph struct {
	issues  []map[string]graphdb.Binding
	tickets []map[string]graphdb.Binding
	updates []string
	queries []string
}

var idFilter = regexp.MustCompile(`FILTER\(\?id = "([^"]+)"\)`)

func (g *multiGraph) Update(_ context.Context, u string) error {
	g.updates = append(g.updates, u)
	return nil
}

func (g *multiGraph) Select(_ context.Context, q string) (graphdb.SelectResult, error) {
	g.queries = append(g.queries, q)
	var r graphdb.SelectResult
	switch {
	case strings.Contains(q, "COUNT(DISTINCT"):
		r.Results.Bindings = []map[string]graphdb.Binding{{"n": {Value: strconv.Itoa(len(g.issues))}}}
	case strings.Contains(q, "#Ticket>"):
		for _, t := range g.tickets {
			if strings.Contains(q, "#"+t["id"].Value+">") {
				r.Results.Bindings = append(r.Results.Bindings, t)
			}
		}
	case idFilter.MatchString(q):
		id := idFilter.FindStringSubmatch(q)[1]
		for _, i := range g.issues {
			if i["id"].Value == id {
				r.Results.Bindings = append(r.Results.Bindings, i)
			}
		}
	default:
		r.Results.Bindings = g.issues
	}
	return r, nil
}

func ids(n int) []string {
	out := make([]string, n)
	for k := range out {
		out[k] = "abcdefgh" + string(rune('a'+k/26)) + string(rune('a'+k%26))
	}
	return out
}

func issueOf(id string, extra map[string]string) map[string]graphdb.Binding {
	b := map[string]graphdb.Binding{"id": {Value: id}, "status": {Value: "open"}, "individualIri": {Value: base + "#" + id}, "ruleId": {Value: "arm-s:7"}, "individualLabel": {Value: "App " + id}}
	for k, v := range extra {
		b[k] = graphdb.Binding{Value: v}
	}
	return b
}

func graphOf(extras map[string]map[string]string, n int) *multiGraph {
	g := &multiGraph{}
	for _, id := range ids(n) {
		g.issues = append(g.issues, issueOf(id, extras[id]))
	}
	return g
}

func bulkService(g Graph, c TicketCreator, cap int) *Service {
	svc := NewService(NewStore(g, base), base, "")
	svc.EnableTickets(c, TicketOptions{AppURL: appURL, BulkCap: cap})
	svc.sleep = func(context.Context, time.Duration) error { return nil }
	return svc
}

func byID(items []TicketItem) map[string]TicketItem {
	m := map[string]TicketItem{}
	for _, it := range items {
		m[it.IssueID] = it
	}
	return m
}

func TestDryRunPlansEveryActionAndWritesNothing(t *testing.T) {
	all := ids(5)
	g := graphOf(map[string]map[string]string{
		all[1]: {"externalId": "ABC-1", "externalSystem": "Jira"},
		all[2]: {"status": "wontfix"},
	}, 5)
	g.tickets = []map[string]graphdb.Binding{{"id": {Value: all[3]}, "correlationId": {Value: all[3]}, "number": {Value: "INC1"}, "state": {Value: "6"}}}
	c := newCreator()
	c.routing.UnroutedReason = "" // routed
	run, err := bulkService(g, c, 25).PlanTickets(context.Background(), TicketSelection{IDs: all})
	if err != nil {
		t.Fatal(err)
	}
	m := byID(run.Items)
	if m[all[0]].Action != TicketActionCreate || m[all[0]].AssignmentGroup != "G" || m[all[0]].Headline == "" {
		t.Errorf("create item = %+v", m[all[0]])
	}
	if m[all[1]].Action != TicketActionSkip || !strings.Contains(m[all[1]].Reason, "external id") {
		t.Errorf("manual item = %+v", m[all[1]])
	}
	if m[all[2]].Action != TicketActionSkip || !strings.Contains(m[all[2]].Reason, "won't fix") {
		t.Errorf("wontfix item = %+v", m[all[2]])
	}
	if m[all[3]].Action != TicketActionFollowUp {
		t.Errorf("follow-up item = %+v", m[all[3]])
	}
	if len(run.Items) != 5 || !run.DryRun || run.Cap != 25 {
		t.Errorf("run = %+v", run)
	}
	if len(g.updates) != 0 || len(c.created) != 0 || c.finds != 0 {
		t.Errorf("the dry-run wrote: updates %d created %d finds %d", len(g.updates), len(c.created), c.finds)
	}
}

func TestRunCreatesWhatTheDryRunPlannedAndStopsAtTheCap(t *testing.T) {
	g := graphOf(nil, 5)
	c := newCreator()
	svc := bulkService(g, c, 3)
	sel := TicketSelection{IDs: ids(5)}
	plan, err := svc.PlanTickets(context.Background(), sel)
	if err != nil {
		t.Fatal(err)
	}
	run, err := svc.CreateTickets(context.Background(), sel, alice, "2026-03-01T00:00:00.000Z")
	if err != nil {
		t.Fatal(err)
	}
	if len(c.created) != 3 {
		t.Errorf("created %d tickets, want the cap of 3", len(c.created))
	}
	if run.DryRun || len(run.Items) != len(plan.Items) {
		t.Fatalf("run = %+v", run)
	}
	for n, it := range run.Items {
		p := plan.Items[n]
		if it.IssueID != p.IssueID || it.Action != p.Action {
			t.Errorf("item %d differs from the plan: %+v vs %+v", n, it, p)
		}
		wantDeferred := n >= 3
		if (it.Result == TicketResultDeferred) != wantDeferred || (p.Result == TicketResultDeferred) != wantDeferred {
			t.Errorf("item %d result %q plan result %q", n, it.Result, p.Result)
		}
		if !wantDeferred && (it.Result != TicketResultCreated || it.Number == "") {
			t.Errorf("item %d = %+v", n, it)
		}
	}
	if len(g.updates) != 3 {
		t.Errorf("updates = %d, want 3", len(g.updates))
	}
}

func TestOneFailureDoesNotStopTheRun(t *testing.T) {
	g := graphOf(nil, 3)
	c := &failFirst{fakeCreator: newCreator()}
	run, err := bulkService(g, c, 25).CreateTickets(context.Background(), TicketSelection{IDs: ids(3)}, alice, "t")
	if err != nil {
		t.Fatal(err)
	}
	got := []string{run.Items[0].Result, run.Items[1].Result, run.Items[2].Result}
	if strings.Join(got, ",") != "error,created,created" || run.Items[0].Error == "" {
		t.Errorf("results = %v items %+v", got, run.Items)
	}
}

type failFirst struct {
	*fakeCreator
	n int
}

func (f *failFirst) CreateTicket(ctx context.Context, r TicketRequest) (Ticket, error) {
	f.n++
	if f.n == 1 {
		return Ticket{}, errors.New("servicenow: rejected: Data Policy Exception")
	}
	return f.fakeCreator.CreateTicket(ctx, r)
}

func TestUnroutedFindingsAreLabelledAndBlockedOrSentToTheFallback(t *testing.T) {
	g := graphOf(nil, 2)
	c := newCreator()
	c.routing = TicketRouting{Blocked: true, UnroutedReason: "no authoritative entity", AssignmentGroup: "Fallback"}
	svc := bulkService(g, c, 25)
	plan, err := svc.PlanTickets(context.Background(), TicketSelection{IDs: ids(2)})
	if err != nil {
		t.Fatal(err)
	}
	if it := plan.Items[0]; it.Action != TicketActionBlocked || it.Unrouted != "no authoritative entity" || !strings.Contains(it.Reason, "no authoritative entity") {
		t.Errorf("blocked item = %+v", it)
	}
	run, _ := svc.CreateTickets(context.Background(), TicketSelection{IDs: ids(2)}, alice, "t")
	if run.Items[0].Result != TicketResultBlocked || len(c.created) != 0 {
		t.Errorf("a blocked finding was ticketed: %+v", run.Items[0])
	}

	c.routing.Blocked = false // fallback policy
	plan, _ = svc.PlanTickets(context.Background(), TicketSelection{IDs: ids(2)})
	if it := plan.Items[0]; it.Action != TicketActionCreate || it.Unrouted != "no authoritative entity" || it.AssignmentGroup != "Fallback" {
		t.Errorf("fallback item = %+v", it)
	}
}

// rateLimited fails the first creates with a rate limit that asks to wait.
type rateLimited struct{ wait time.Duration }

func (r rateLimited) Error() string             { return "servicenow: rate limited" }
func (r rateLimited) RetryDelay() time.Duration { return r.wait }

type throttled struct {
	*fakeCreator
	limit int // creates answered with a rate limit before one succeeds
	wait  time.Duration
	calls int
}

func (f *throttled) CreateTicket(ctx context.Context, r TicketRequest) (Ticket, error) {
	f.calls++
	if f.calls <= f.limit {
		return Ticket{}, rateLimited{f.wait}
	}
	return f.fakeCreator.CreateTicket(ctx, r)
}

func TestARateLimitPausesPerRetryAfterThenContinues(t *testing.T) {
	g := graphOf(nil, 2)
	c := &throttled{fakeCreator: newCreator(), limit: 1, wait: 2 * time.Second}
	svc := bulkService(g, c, 25)
	var slept []time.Duration
	svc.sleep = func(_ context.Context, d time.Duration) error { slept = append(slept, d); return nil }
	run, err := svc.CreateTickets(context.Background(), TicketSelection{IDs: ids(2)}, alice, "t")
	if err != nil {
		t.Fatal(err)
	}
	if len(slept) != 1 || slept[0] != 2*time.Second {
		t.Errorf("slept = %v", slept)
	}
	if run.Items[0].Result != TicketResultCreated || run.Items[1].Result != TicketResultCreated {
		t.Errorf("items = %+v", run.Items)
	}
}

func TestAnExhaustedRateLimitBudgetDefersTheRemainder(t *testing.T) {
	g := graphOf(nil, 3)
	c := &throttled{fakeCreator: newCreator(), limit: 100, wait: time.Hour}
	svc := bulkService(g, c, 25)
	run, err := svc.CreateTickets(context.Background(), TicketSelection{IDs: ids(3)}, alice, "t")
	if err != nil {
		t.Fatal(err)
	}
	for n, it := range run.Items {
		if it.Result != TicketResultDeferred || !strings.Contains(it.Reason, "rate") {
			t.Errorf("item %d = %+v", n, it)
		}
	}
	if len(g.updates) != 0 {
		t.Error("a deferred issue must not be marked as failed")
	}
}

func TestSelectionIsBoundedAndValidated(t *testing.T) {
	svc := bulkService(graphOf(nil, 1), newCreator(), 25)
	tooMany := make([]string, MaxBulkSelection+1)
	for k := range tooMany {
		tooMany[k] = ids(1)[0]
	}
	bad := []TicketSelection{
		{IDs: tooMany},
		{IDs: []string{"NOPE"}},
		{Status: "done"},
		{IndividualIri: "http://x/>; DROP"},
	}
	for n, sel := range bad {
		if _, err := svc.PlanTickets(context.Background(), sel); !IsInputError(err) {
			t.Errorf("selection %d: err = %v", n, err)
		}
	}
	big := graphOf(nil, 0)
	big.issues = make([]map[string]graphdb.Binding, 0)
	for k := 0; k < MaxBulkSelection+1; k++ {
		big.issues = append(big.issues, issueOf("abcdefgh"+string(rune('a'+k%26))+string(rune('a'+k/26)), nil))
	}
	if _, err := bulkService(big, newCreator(), 25).PlanTickets(context.Background(), TicketSelection{Status: "open"}); !IsInputError(err) {
		t.Errorf("a filter matching too many issues: err = %v", err)
	}
}

func TestSelectionByFilterUsesTheStoreFilter(t *testing.T) {
	g := graphOf(nil, 2)
	run, err := bulkService(g, newCreator(), 25).PlanTickets(context.Background(), TicketSelection{Status: "open", RuleID: "arm-s:7"})
	if err != nil || len(run.Items) != 2 {
		t.Fatalf("run = %+v err %v", run, err)
	}
	found := false
	for _, q := range g.queries {
		if strings.Contains(q, `"arm-s:7"`) && strings.Contains(q, `"open"`) {
			found = true
		}
	}
	if !found {
		t.Error("the filter did not reach the store query")
	}
}
