package servicenow

import (
	"context"
	"sync"
	"time"

	"github.com/nebucaz/rdf-schema-editor/backend/internal/issues"
)

// PushRunner is the push side of a pass; *issues.Service satisfies it.
type PushRunner interface {
	PushPending(ctx context.Context, at string) (issues.PushResult, error)
	PendingPushes(ctx context.Context) (int, error)
}

// Runner is the one code path of a sync pass (pull from ServiceNow, then push local changes), used by the
// worker, `POST /issues/tickets/sync` and importctl alike. Only one pass runs at a time.
type Runner struct {
	syncer *Syncer
	push   PushRunner
	mu     sync.Mutex
	now    func() time.Time
}

// NewRunner builds a Runner.
func NewRunner(s *Syncer, p PushRunner) *Runner { return &Runner{syncer: s, push: p, now: time.Now} }

// Run executes one pass. A ServiceNow failure is counted and reported (SyncReport.Errors/Message), never
// returned: the error return is for a pass that could not run at all (another one is running, GraphDB is
// unreachable). With apply false nothing is written and the report says what an applied pass would do.
func (r *Runner) Run(ctx context.Context, apply bool) (issues.SyncReport, error) {
	if !r.mu.TryLock() {
		return issues.SyncReport{}, issues.ErrSyncBusy
	}
	defer r.mu.Unlock()

	rep := issues.SyncReport{DryRun: !apply}
	note := func(err error) {
		rep.Errors++
		if rep.Message == "" {
			rep.Message = err.Error()
		}
	}

	var pull PullResult
	var err error
	if apply {
		pull, err = r.syncer.Pull(ctx)
	} else {
		pull, err = r.syncer.Preview(ctx)
	}
	if err != nil {
		note(err)
	}
	rep.Pulled = pull.Changed

	if !apply {
		n, err := r.push.PendingPushes(ctx)
		if err != nil {
			note(err)
		}
		rep.Pushed = n
		return rep, nil
	}
	res, err := r.push.PushPending(ctx, formatLocal(r.now()))
	if err != nil {
		note(err)
	}
	rep.Pushed, rep.Skipped, rep.Deferred = res.Pushed, res.Skipped, res.Deferred
	rep.Errors += res.Failed
	return rep, nil
}
