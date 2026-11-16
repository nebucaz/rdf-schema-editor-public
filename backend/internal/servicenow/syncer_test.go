package servicenow

import (
	"context"
	"errors"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/nebucaz/rdf-schema-editor/backend/internal/issues"
	"github.com/nebucaz/rdf-schema-editor/backend/internal/servicenow/servicenowtest"
)

// memRepo is the issues store as the syncer sees it.
type memRepo struct {
	issues    map[string]issues.Issue
	users     []issues.KnownUser
	mark      time.Time
	updates   int // Update calls
	written   int // issues written
	updateErr error
	saved     []time.Time
}

func (r *memRepo) All(context.Context) ([]issues.Issue, error) {
	out := make([]issues.Issue, 0, len(r.issues))
	for _, i := range r.issues {
		out = append(out, i)
	}
	return out, nil
}

func (r *memRepo) Update(_ context.Context, is ...issues.Issue) error {
	if r.updateErr != nil {
		return r.updateErr
	}
	r.updates++
	for _, i := range is {
		r.issues[i.ID] = i
		r.written++
	}
	return nil
}

func (r *memRepo) KnownUsers(context.Context) ([]issues.KnownUser, error) { return r.users, nil }

func (r *memRepo) SyncWatermark(context.Context) (time.Time, error) { return r.mark, nil }

func (r *memRepo) SaveSyncWatermark(_ context.Context, t time.Time) error {
	r.mark = t
	r.saved = append(r.saved, t)
	return nil
}

var t0 = time.Date(2026, 3, 1, 10, 0, 0, 0, time.UTC)

type syncRig struct {
	syn  *Syncer
	repo *memRepo
	fake *servicenowtest.Server
	cl   *Client
	now  time.Time
}

func newRig(t *testing.T) *syncRig {
	t.Helper()
	c, fake := basicClient(t)
	r := &syncRig{repo: &memRepo{issues: map[string]issues.Issue{}}, fake: fake, cl: c, now: t0}
	fake.Now = func() time.Time { return r.now }
	r.syn = NewSyncer(c, r.repo, Settings{BaseURL: fake.URL, Table: "incident", File: FileSettings{StateMap: defaultStateMap()}})
	r.syn.now = func() time.Time { return r.now }
	return r
}

// track opens a ticket for a new issue with the given finding id and stores both.
func (r *syncRig) track(t *testing.T, id string) (issues.Issue, issues.Ticket) {
	t.Helper()
	tk, err := r.cl.CreateIncident(ctx, map[string]string{"short_description": "x", "correlation_id": id})
	if err != nil {
		t.Fatal(err)
	}
	i := issues.Issue{ID: id, Status: issues.StatusOpen, SyncState: issues.SyncSynced, Tickets: []issues.Ticket{}}
	it := issues.Ticket{CorrelationID: id, Number: tk.Number, SysID: tk.SysID, State: "1", StateLabel: "1", URL: "https://sn.example/x"}
	if err := i.AddTicket(it); err != nil {
		t.Fatal(err)
	}
	r.repo.issues[id] = i
	return i, it
}

func (r *syncRig) advance(d time.Duration) { r.now = r.now.Add(d) }

func (r *syncRig) pull(t *testing.T) PullResult {
	t.Helper()
	res, err := r.syn.PullOnce(ctx, r.repo.mark)
	if err != nil {
		t.Fatal(err)
	}
	return res
}

const (
	id1 = "aaaaaaaaaaaaaaaa"
	id2 = "bbbbbbbbbbbbbbbb"
)

func TestPullRequestsTheAssigneeFieldsInOneCallAndOverlapsTheWatermark(t *testing.T) {
	r := newRig(t)
	r.track(t, id1)
	r.fake.Requests = nil
	mark := t0.Add(time.Hour)
	if _, err := r.syn.PullOnce(ctx, mark); err != nil {
		t.Fatal(err)
	}
	if len(r.fake.Requests) != 1 {
		t.Fatalf("requests = %v, want one list call", r.fake.Requests)
	}
	q := r.fake.Requests[0]
	for _, want := range []string{"assigned_to.user_name", "sysparm_display_value=all", "sys_updated_on%3E" + url.QueryEscape(FormatTimestamp(mark.Add(-time.Minute)))} {
		if !strings.Contains(q, want) {
			t.Errorf("request lacks %q: %s", want, q)
		}
	}
}

func TestPullCopiesStateGroupAssigneeAndResolutionAndStampsServiceNow(t *testing.T) {
	r := newRig(t)
	r.repo.users = []issues.KnownUser{{Sub: "JDoe", DisplayName: "Jane Doe"}}
	_, tk := r.track(t, id1)
	r.fake.Users["u1"] = [2]string{"jdoe", "Jane D."}
	r.advance(time.Minute)
	r.fake.Set(tk.SysID, map[string]string{"state": "2", "assigned_to": "u1", "assignment_group": "Data Team", "close_notes": "looking"})
	r.advance(time.Minute)
	res := r.pull(t)
	if res.Examined != 1 || res.Changed != 1 {
		t.Fatalf("result = %+v", res)
	}
	got := r.repo.issues[id1]
	if got.Status != issues.StatusInProgress || got.ServiceNowGroup != "Data Team" || got.ServiceNowAssignee != "Jane D." || got.ServiceNowResolution != "looking" {
		t.Errorf("issue = %+v", got)
	}
	if got.Assignee != "JDoe" || got.AssigneeName != "Jane Doe" {
		t.Errorf("assignee = %q %q", got.Assignee, got.AssigneeName)
	}
	if got.UpdatedBy != issues.ServiceNowUser || got.UpdatedAt != formatLocal(r.now) || got.LastSyncedAt != formatLocal(r.now) {
		t.Errorf("stamp = %q %q %q", got.UpdatedBy, got.UpdatedAt, got.LastSyncedAt)
	}
	if cur, _ := got.CurrentTicket(); cur.State != "2" || cur.Number != tk.Number || cur.URL != "https://sn.example/x" {
		t.Errorf("ticket = %+v", cur)
	}
}

func TestPullAssigneeWithoutAKnownUserKeepsTheDisplayNameOnly(t *testing.T) {
	r := newRig(t)
	r.repo.users = []issues.KnownUser{{Sub: "someone-else", DisplayName: "Other"}}
	_, tk := r.track(t, id1)
	r.fake.Users["u1"] = [2]string{"jdoe", "Jane D."}
	r.advance(time.Minute)
	r.fake.Set(tk.SysID, map[string]string{"assigned_to": "u1"})
	r.advance(time.Minute)
	r.pull(t)
	got := r.repo.issues[id1]
	if got.Assignee != "" || got.ServiceNowAssignee != "Jane D." {
		t.Errorf("assignee = %q, sn = %q", got.Assignee, got.ServiceNowAssignee)
	}
}

func TestPullMapsResolvedAndClosedAndReopens(t *testing.T) {
	for _, state := range []string{"6", "7"} {
		r := newRig(t)
		_, tk := r.track(t, id1)
		r.advance(time.Minute)
		r.fake.Set(tk.SysID, map[string]string{"state": state, "close_code": "x", "close_notes": "done", "closed_at": FormatTimestamp(r.now)})
		r.advance(time.Minute)
		r.pull(t)
		got := r.repo.issues[id1]
		if got.Status != issues.StatusResolved || got.ResolvedBy != issues.ServiceNowUser {
			t.Errorf("state %s: status = %q by %q", state, got.Status, got.ResolvedBy)
		}
		if cur, _ := got.CurrentTicket(); cur.ClosedAt == "" || cur.State != state {
			t.Errorf("state %s: ticket = %+v", state, cur)
		}
		if state == "6" {
			r.advance(time.Minute)
			r.fake.Set(tk.SysID, map[string]string{"state": "2"})
			r.advance(time.Minute)
			r.pull(t)
			got = r.repo.issues[id1]
			if got.Status != issues.StatusInProgress || got.ResolvedBy != "" {
				t.Errorf("reopened: status = %q by %q", got.Status, got.ResolvedBy)
			}
		}
	}
}

func TestPullUnmappedStateKeepsTheStatusAndRecordsTheLabel(t *testing.T) {
	r := newRig(t)
	_, tk := r.track(t, id1)
	r.advance(time.Minute)
	r.fake.Set(tk.SysID, map[string]string{"state": "42"})
	r.advance(time.Minute)
	r.pull(t)
	got := r.repo.issues[id1]
	cur, _ := got.CurrentTicket()
	if got.Status != issues.StatusOpen || cur.State != "42" {
		t.Errorf("status = %q, ticket = %+v", got.Status, cur)
	}
}

func TestPullNeverTouchesWontFixOrTicketlessIssues(t *testing.T) {
	r := newRig(t)
	_, tk := r.track(t, id1)
	wf := r.repo.issues[id1]
	wf.Status, wf.ResolvedBy = issues.StatusWontFix, "alice"
	r.repo.issues[id1] = wf
	manual := issues.Issue{ID: id2, Status: issues.StatusOpen, ExternalSystem: "Jira", ExternalID: "ABC-1", Tickets: []issues.Ticket{}}
	r.repo.issues[id2] = manual
	// a ticket of the same prefix that no issue owns must be ignored as well
	if _, err := r.cl.CreateIncident(ctx, map[string]string{"correlation_id": id2}); err != nil {
		t.Fatal(err)
	}
	r.advance(time.Minute)
	r.fake.Set(tk.SysID, map[string]string{"state": "6", "close_code": "x", "close_notes": "n"})
	r.advance(time.Minute)
	r.pull(t)
	if got := r.repo.issues[id1]; got.Status != issues.StatusWontFix || got.ResolvedBy != "alice" {
		t.Errorf("wontfix changed: %+v", got)
	}
	if got := r.repo.issues[id2]; got.Status != issues.StatusOpen || got.ExternalID != "ABC-1" || len(got.Tickets) != 0 {
		t.Errorf("manual issue changed: %+v", got)
	}
}

func TestPullAlreadyResolvedBySystemKeepsItsResolver(t *testing.T) {
	r := newRig(t)
	_, tk := r.track(t, id1)
	i := r.repo.issues[id1]
	i.Status, i.ResolvedBy = issues.StatusResolved, issues.SystemUser
	r.repo.issues[id1] = i
	r.advance(time.Minute)
	r.fake.Set(tk.SysID, map[string]string{"state": "6", "close_code": "x", "close_notes": "n"})
	r.advance(time.Minute)
	r.pull(t)
	if got := r.repo.issues[id1]; got.ResolvedBy != issues.SystemUser {
		t.Errorf("resolvedBy = %q", got.ResolvedBy)
	}
}

func TestPullDoesNotResolveAgainWhileAFollowUpIsNeeded(t *testing.T) {
	r := newRig(t)
	_, tk := r.track(t, id1)
	i := r.repo.issues[id1]
	i.FollowUpNeeded = true // the reconcile re-opened it after SN had resolved the ticket
	r.repo.issues[id1] = i
	r.advance(time.Minute)
	r.fake.Set(tk.SysID, map[string]string{"state": "6", "close_code": "x", "close_notes": "n"})
	r.advance(time.Minute)
	r.pull(t)
	if got := r.repo.issues[id1]; got.Status != issues.StatusOpen || !got.FollowUpNeeded {
		t.Errorf("issue = %+v", got)
	}
}

func TestPullIsIdempotentAndWritesOnlyChangedIssues(t *testing.T) {
	r := newRig(t)
	_, tk := r.track(t, id1)
	r.track(t, id2)
	r.advance(time.Minute)
	r.fake.Set(tk.SysID, map[string]string{"state": "2"})
	r.advance(time.Minute)
	first, err := r.syn.PullOnce(ctx, time.Time{})
	if err != nil {
		t.Fatal(err)
	}
	if first.Examined != 2 || first.Changed != 1 || r.repo.written != 1 {
		t.Fatalf("first = %+v, written %d", first, r.repo.written)
	}
	r.advance(time.Minute)
	again, err := r.syn.PullOnce(ctx, time.Time{})
	if err != nil {
		t.Fatal(err)
	}
	if again.Changed != 0 || r.repo.written != 1 {
		t.Errorf("repeat = %+v, written %d", again, r.repo.written)
	}
}

func TestPullHandlesMoreThanOnePage(t *testing.T) {
	r := newRig(t)
	r.cl.pageSize = 2
	ids := []string{"aaaaaaaaaaaaaaa1", "aaaaaaaaaaaaaaa2", "aaaaaaaaaaaaaaa3", "aaaaaaaaaaaaaaa4", "aaaaaaaaaaaaaaa5"}
	for n, id := range ids {
		_, tk := r.track(t, id)
		r.advance(time.Second)
		r.fake.Set(tk.SysID, map[string]string{"state": "2", "assignment_group": "G" + id[len(id)-1:]})
		_ = n
	}
	res := r.pull(t)
	if res.Examined != 5 || res.Changed != 5 {
		t.Errorf("result = %+v", res)
	}
}

func TestPullOnlyAdvancesTheWatermarkAfterASuccessfulWrite(t *testing.T) {
	r := newRig(t)
	_, tk := r.track(t, id1)
	r.advance(time.Minute)
	r.fake.Set(tk.SysID, map[string]string{"state": "2"})
	r.advance(time.Minute)
	stamp := ParseTimestamp(FormatTimestamp(t0.Add(time.Minute)))

	r.repo.updateErr = errors.New("graphdb down")
	if _, err := r.syn.Pull(ctx); err == nil {
		t.Fatal("want the write error")
	}
	if !r.repo.mark.IsZero() {
		t.Errorf("watermark advanced on failure: %v", r.repo.mark)
	}
	r.repo.updateErr = nil
	if _, err := r.syn.Pull(ctx); err != nil {
		t.Fatal(err)
	}
	if !r.repo.mark.Equal(stamp) {
		t.Errorf("watermark = %v, want newest ticket update %v", r.repo.mark, stamp)
	}
	if got := r.repo.issues[id1]; got.Status != issues.StatusInProgress {
		t.Errorf("status = %q", got.Status)
	}

	// ServiceNow failing leaves the watermark alone as well
	r.fake.FailNext(503, `{"error":{"message":"down"}}`, nil)
	before := r.repo.mark
	if _, err := r.syn.Pull(ctx); err == nil {
		t.Fatal("want the ServiceNow error")
	}
	if !r.repo.mark.Equal(before) {
		t.Errorf("watermark moved on a failed poll")
	}
}
