package issues

import (
	"context"

	"github.com/nebucaz/rdf-schema-editor/backend/internal/validation"
)

// Repository is what Reconcile and the Service need from the store; *Store satisfies it.
type Repository interface {
	All(ctx context.Context) ([]Issue, error)
	BulkCreate(ctx context.Context, is []Issue) error
	Update(ctx context.Context, is ...Issue) error
	Touch(ctx context.Context, ids []string, at string) error
	SaveRun(ctx context.Context, r RunRecord) error
	LastRun(ctx context.Context) (RunRecord, bool, error)
}

// Run is what one reconcile reports: an outcome per current finding, and how many issues the run
// resolved because their finding is gone.
type Run struct {
	Outcomes         []Outcome
	ResolvedBySystem int
}

// Outcome is what a run reports per current finding.
type Outcome struct {
	FindingID   string `json:"findingId"`
	IssueID     string `json:"issueId"`
	Status      string `json:"status"`
	Assignee    string `json:"assignee"`
	ExternalURL string `json:"externalUrl"`
	// IsNew is true only on the run that created the issue; it is never stored.
	IsNew bool `json:"isNew"`

	issue Issue
}

func fromViolation(v validation.Violation, by, byName, at string) Issue {
	return Issue{
		ID: v.ID, IndividualIri: v.IndividualIri, TypeIri: v.TypeIri, RuleId: v.RuleId, ShapeIri: v.ShapeIri, Path: v.Path,
		Constraint: v.Constraint, IndividualLabel: v.IndividualLabel, Message: v.Message, QualityDimension: v.QualityDimension,
		Value: v.Value, Status: StatusOpen, CreatedAt: at, UpdatedBy: by, UpdatedByName: byName, UpdatedAt: at, LastSeenAt: at,
	}
}

// refreshSnapshot copies what the finding currently says into the issue and reports whether that
// changed anything. Status, assignee, note, ticket and the update stamps are never touched.
func refreshSnapshot(i Issue, v validation.Violation) (Issue, bool) {
	same := i.TypeIri == v.TypeIri && i.RuleId == v.RuleId && i.ShapeIri == v.ShapeIri && i.IndividualLabel == v.IndividualLabel &&
		i.Message == v.Message && i.QualityDimension == v.QualityDimension && sameValue(i.Value, v.Value)
	if same {
		return i, false
	}
	i.TypeIri, i.RuleId, i.ShapeIri, i.IndividualLabel = v.TypeIri, v.RuleId, v.ShapeIri, v.IndividualLabel
	i.Message, i.QualityDimension, i.Value = v.Message, v.QualityDimension, v.Value
	return i, true
}

func sameValue(a, b *string) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}

// covered reports whether a constraint the run could not check may have produced the issue's finding;
// such an issue stays as it is, because its absence from the findings proves nothing.
func covered(i Issue, notChecked []validation.NotChecked) bool {
	for _, nc := range notChecked {
		if (nc.ShapeIri != "" && nc.ShapeIri == i.ShapeIri) || (nc.RuleId != "" && nc.RuleId == i.RuleId) {
			return true
		}
	}
	return false
}

type reconcileOptions struct{ noPush bool }

// ReconcileOption tunes one Reconcile call.
type ReconcileOption func(*reconcileOptions)

// WithoutPush leaves ticketed issues out of the push queue (SERVICENOW_SYNC_ENABLED=false).
func WithoutPush() ReconcileOption { return func(o *reconcileOptions) { o.noPush = true } }

// Reconcile brings the stored issues in line with one validation run and returns an outcome per current
// finding. A finding without an issue gets one (open, stamped with the caller); an issue whose finding is
// gone is resolved by SystemUser, and a system- or ServiceNow-resolved one whose finding returns is re-opened (the
// latter is flagged FollowUpNeeded). `wontfix`
// and user-resolved issues are never changed automatically, and an issue covered by a `notChecked`
// constraint is never auto-resolved. Every issue still present gets a fresh `lastSeenAt`.
func Reconcile(ctx context.Context, repo Repository, violations []validation.Violation, notChecked []validation.NotChecked, by, byName, at string, opts ...ReconcileOption) (Run, error) {
	var o reconcileOptions
	for _, opt := range opts {
		opt(&o)
	}
	markPending := markPending
	if o.noPush {
		markPending = func(i Issue) Issue { return i }
	}
	existing, err := repo.All(ctx)
	if err != nil {
		return Run{}, err
	}
	byID := make(map[string]Issue, len(existing))
	for _, i := range existing {
		byID[i.ID] = i
	}

	var created, changed []Issue
	resolved := 0
	var seen []string
	var outcomes []Outcome
	current := make(map[string]bool, len(violations))
	for _, v := range violations {
		if current[v.ID] {
			continue
		}
		current[v.ID] = true
		i, ok := byID[v.ID]
		isNew := !ok
		switch {
		case !ok:
			i = fromViolation(v, by, byName, at)
			created = append(created, i)
		case i.Status == StatusResolved && (i.ResolvedBy == SystemUser || i.ResolvedBy == ServiceNowUser):
			// a ticket ServiceNow resolved while the finding is still there needs a follow-up, created by hand
			i.FollowUpNeeded = i.FollowUpNeeded || (i.ResolvedBy == ServiceNowUser && i.HasTickets())
			i.Status, i.ResolvedBy = StatusOpen, ""
			i.UpdatedBy, i.UpdatedByName, i.UpdatedAt, i.LastSeenAt = SystemUser, "", at, at
			i, _ = refreshSnapshot(i, v)
			i = markPending(i)
			changed = append(changed, i)
		default:
			if refreshed, differs := refreshSnapshot(i, v); differs {
				refreshed.LastSeenAt = at
				i = markPending(refreshed)
				changed = append(changed, i)
			} else {
				seen = append(seen, i.ID)
			}
		}
		outcomes = append(outcomes, Outcome{FindingID: v.ID, IssueID: i.ID, Status: i.Status, Assignee: i.Assignee, IsNew: isNew, issue: i})
	}
	for _, i := range existing {
		if current[i.ID] || (i.Status != StatusOpen && i.Status != StatusInProgress) || covered(i, notChecked) {
			continue
		}
		i.Status, i.ResolvedBy = StatusResolved, SystemUser
		i.UpdatedBy, i.UpdatedByName, i.UpdatedAt = SystemUser, "", at
		i = markPending(i)
		changed = append(changed, i)
		resolved++
	}

	if len(created) > 0 {
		if err := repo.BulkCreate(ctx, created); err != nil {
			return Run{}, err
		}
	}
	if len(changed) > 0 {
		if err := repo.Update(ctx, changed...); err != nil {
			return Run{}, err
		}
	}
	if len(seen) > 0 {
		if err := repo.Touch(ctx, seen, at); err != nil {
			return Run{}, err
		}
	}
	if err := repo.SaveRun(ctx, RunRecord{At: at, NotChecked: notChecked}); err != nil {
		return Run{}, err
	}
	return Run{Outcomes: outcomes, ResolvedBySystem: resolved}, nil
}
