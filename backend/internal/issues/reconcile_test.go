package issues

import (
	"context"
	"testing"

	"github.com/nebucaz/rdf-schema-editor/backend/internal/validation"
)

type memRepo struct {
	byID    map[string]Issue
	touched []string
	lastRun *RunRecord
}

func newMemRepo(is ...Issue) *memRepo {
	m := &memRepo{byID: map[string]Issue{}}
	for _, i := range is {
		m.byID[i.ID] = i
	}
	return m
}

func (m *memRepo) All(context.Context) ([]Issue, error) {
	var out []Issue
	for _, i := range m.byID {
		out = append(out, i)
	}
	return out, nil
}
func (m *memRepo) BulkCreate(_ context.Context, is []Issue) error {
	for _, i := range is {
		if err := Validate(i); err != nil {
			return err
		}
		m.byID[i.ID] = i
	}
	return nil
}
func (m *memRepo) Update(_ context.Context, is ...Issue) error {
	for _, i := range is {
		m.byID[i.ID] = i
	}
	return nil
}
func (m *memRepo) Touch(_ context.Context, ids []string, _ string) error {
	m.touched = append(m.touched, ids...)
	return nil
}

func (m *memRepo) SaveRun(_ context.Context, r RunRecord) error {
	m.lastRun = &r
	return nil
}
func (m *memRepo) LastRun(context.Context) (RunRecord, bool, error) {
	if m.lastRun == nil {
		return RunRecord{}, false, nil
	}
	return *m.lastRun, true, nil
}

func viol(id string) validation.Violation {
	return validation.Violation{ID: id, IndividualIri: base + "#a", TypeIri: base + "#T", Path: base + "#p", Constraint: "minCount",
		IndividualLabel: "A", Message: "m", RuleId: "arm-s:1", ShapeIri: base + "/shapes#S", QualityDimension: "completeness"}
}

const (
	t1 = "2026-02-01T00:00:00.000Z"
	t2 = "2026-02-02T00:00:00.000Z"
)

func run(t *testing.T, repo *memRepo, vs []validation.Violation, nc []validation.NotChecked, at string) []Outcome {
	t.Helper()
	out, _ := runCounted(t, repo, vs, nc, at)
	return out
}

func runCounted(t *testing.T, repo *memRepo, vs []validation.Violation, nc []validation.NotChecked, at string) ([]Outcome, int) {
	t.Helper()
	out, err := Reconcile(context.Background(), repo, vs, nc, "alice", "Alice A", at)
	if err != nil {
		t.Fatal(err)
	}
	return out.Outcomes, out.ResolvedBySystem
}

func TestReconcile_NewFindingCreatesOneIssueAndIsNewOnlyOnThatRun(t *testing.T) {
	repo := newMemRepo()
	out := run(t, repo, []validation.Violation{viol("aaaaaaaaaaaaaaaa")}, nil, t1)
	if len(repo.byID) != 1 || len(out) != 1 || !out[0].IsNew || out[0].Status != StatusOpen || out[0].FindingID != "aaaaaaaaaaaaaaaa" {
		t.Fatalf("out=%+v issues=%+v", out, repo.byID)
	}
	got := repo.byID["aaaaaaaaaaaaaaaa"]
	if got.UpdatedBy != "alice" || got.UpdatedByName != "Alice A" || got.CreatedAt != t1 || got.LastSeenAt != t1 || got.Message != "m" {
		t.Errorf("issue = %+v", got)
	}
	out = run(t, repo, []validation.Violation{viol("aaaaaaaaaaaaaaaa")}, nil, t2)
	if len(repo.byID) != 1 || out[0].IsNew {
		t.Errorf("second run: out=%+v issues=%d", out, len(repo.byID))
	}
	if len(repo.touched) != 1 {
		t.Errorf("lastSeenAt not refreshed: %v", repo.touched)
	}
}

func TestReconcile_DisappearedFindingIsSystemResolvedAndReappearingReopens(t *testing.T) {
	repo := newMemRepo()
	run(t, repo, []validation.Violation{viol("aaaaaaaaaaaaaaaa")}, nil, t1)
	if _, resolved := runCounted(t, repo, nil, nil, t2); resolved != 1 {
		t.Errorf("resolvedBySystem = %d, want 1", resolved)
	}
	got := repo.byID["aaaaaaaaaaaaaaaa"]
	if got.Status != StatusResolved || got.ResolvedBy != SystemUser || got.UpdatedBy != SystemUser || got.UpdatedAt != t2 {
		t.Fatalf("after disappear = %+v", got)
	}
	out := run(t, repo, []validation.Violation{viol("aaaaaaaaaaaaaaaa")}, nil, "2026-02-03T00:00:00.000Z")
	got = repo.byID["aaaaaaaaaaaaaaaa"]
	if got.Status != StatusOpen || got.ResolvedBy != "" || out[0].IsNew {
		t.Errorf("after return = %+v out=%+v", got, out)
	}
}

func TestReconcile_WontFixAndUserResolvedAreNeverAutoChanged(t *testing.T) {
	wf := Issue{ID: "wwwwwwwwwwwwwwww", Status: StatusWontFix, ResolvedBy: "bob", UpdatedBy: "bob"}
	ur := Issue{ID: "uuuuuuuuuuuuuuuu", Status: StatusResolved, ResolvedBy: "bob", UpdatedBy: "bob"}
	repo := newMemRepo(wf, ur)
	// both disappear: untouched
	run(t, repo, nil, nil, t2)
	// both reappear: untouched
	run(t, repo, []validation.Violation{viol("wwwwwwwwwwwwwwww"), viol("uuuuuuuuuuuuuuuu")}, nil, t2)
	if repo.byID[wf.ID].Status != StatusWontFix || repo.byID[ur.ID].Status != StatusResolved || repo.byID[ur.ID].ResolvedBy != "bob" {
		t.Errorf("auto-changed: %+v %+v", repo.byID[wf.ID], repo.byID[ur.ID])
	}
}

func TestReconcile_NotCheckedConstraintsNeverAutoResolve(t *testing.T) {
	repo := newMemRepo()
	run(t, repo, []validation.Violation{viol("aaaaaaaaaaaaaaaa")}, nil, t1)
	nc := []validation.NotChecked{{ShapeIri: base + "/shapes#S", RuleId: "arm-s:1", Construct: "sh:xone", Reason: "unsupported"}}
	run(t, repo, nil, nc, t2)
	if repo.byID["aaaaaaaaaaaaaaaa"].Status != StatusOpen {
		t.Errorf("resolved despite notChecked: %+v", repo.byID["aaaaaaaaaaaaaaaa"])
	}
	// a notChecked entry for another shape does not protect it
	other := []validation.NotChecked{{ShapeIri: base + "/shapes#Other", RuleId: "arm-s:9"}}
	run(t, repo, nil, other, t2)
	if repo.byID["aaaaaaaaaaaaaaaa"].Status != StatusResolved {
		t.Errorf("not resolved: %+v", repo.byID["aaaaaaaaaaaaaaaa"])
	}
}

func TestReconcile_DuplicateFindingIDsCreateOneIssue(t *testing.T) {
	repo := newMemRepo()
	run(t, repo, []validation.Violation{viol("aaaaaaaaaaaaaaaa"), viol("aaaaaaaaaaaaaaaa")}, nil, t1)
	if len(repo.byID) != 1 {
		t.Errorf("issues = %d", len(repo.byID))
	}
}

func TestReconcile_SeenIssuesGetTheirSnapshotRefreshedButKeepTheirUserFields(t *testing.T) {
	repo := newMemRepo()
	first := viol("aaaaaaaaaaaaaaaa")
	first.Value = ptr("old")
	run(t, repo, []validation.Violation{first}, nil, t1)
	i := repo.byID["aaaaaaaaaaaaaaaa"]
	i.Assignee, i.Note = "bob", "mine"
	repo.byID[i.ID] = i
	if got := repo.byID[i.ID]; got.Value == nil || *got.Value != "old" {
		t.Fatalf("value not stored on create: %+v", got)
	}
	next := viol("aaaaaaaaaaaaaaaa")
	next.Message, next.IndividualLabel, next.Value = "new wording", "Renamed", ptr("new")
	repo.touched = nil
	run(t, repo, []validation.Violation{next}, nil, t2)
	got := repo.byID[i.ID]
	if got.Message != "new wording" || got.IndividualLabel != "Renamed" || got.Value == nil || *got.Value != "new" {
		t.Errorf("snapshot not refreshed: %+v", got)
	}
	if got.Assignee != "bob" || got.Note != "mine" || got.UpdatedAt != t1 || got.LastSeenAt != t2 {
		t.Errorf("user fields or stamps changed: %+v", got)
	}
	if len(repo.touched) != 0 {
		t.Errorf("a refreshed issue is rewritten, not only touched: %v", repo.touched)
	}
}

func TestReconcile_RecordsTheRun(t *testing.T) {
	repo := newMemRepo()
	nc := []validation.NotChecked{{ShapeIri: base + "/shapes#S", RuleId: "r", Construct: "sh:xone", Reason: "unsupported"}}
	run(t, repo, []validation.Violation{viol("aaaaaaaaaaaaaaaa")}, nc, t1)
	if repo.lastRun == nil || repo.lastRun.At != t1 || len(repo.lastRun.NotChecked) != 1 || repo.lastRun.NotChecked[0].Construct != "sh:xone" {
		t.Errorf("run record = %+v", repo.lastRun)
	}
}

func ptr(s string) *string { return &s }
