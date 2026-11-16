package servicenow

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/nebucaz/rdf-schema-editor/backend/internal/issues"
)

type fakePush struct {
	res     issues.PushResult
	pending int
	err     error
	calls   int
	gate    chan struct{} // when set, PushPending blocks until it is closed
	entered chan struct{}
	once    sync.Once
}

func (f *fakePush) PushPending(context.Context, string) (issues.PushResult, error) {
	f.calls++
	if f.entered != nil {
		f.once.Do(func() { close(f.entered) })
	}
	if f.gate != nil {
		<-f.gate
	}
	return f.res, f.err
}

func (f *fakePush) PendingPushes(context.Context) (int, error) { return f.pending, f.err }

func runnerRig(t *testing.T, push *fakePush) (*Runner, *syncRig) {
	t.Helper()
	r := newRig(t)
	return NewRunner(r.syn, push), r
}

func TestRunnerAppliesPullThenPush(t *testing.T) {
	push := &fakePush{res: issues.PushResult{Pushed: 2, Skipped: 1, Failed: 1}}
	run, rig := runnerRig(t, push)
	_, tk := rig.track(t, id1)
	rig.advance(time.Minute)
	rig.fake.Set(tk.SysID, map[string]string{"state": "2"})
	rig.advance(time.Minute)
	rep, err := run.Run(ctx, true)
	if err != nil {
		t.Fatal(err)
	}
	if rep.DryRun || rep.Pulled != 1 || rep.Pushed != 2 || rep.Skipped != 1 || rep.Errors != 1 {
		t.Errorf("report = %+v", rep)
	}
	if rig.repo.issues[id1].Status != issues.StatusInProgress || push.calls != 1 {
		t.Errorf("pull/push not applied: %q calls %d", rig.repo.issues[id1].Status, push.calls)
	}
}

func TestRunnerDryRunWritesNothing(t *testing.T) {
	push := &fakePush{pending: 3}
	run, rig := runnerRig(t, push)
	_, tk := rig.track(t, id1)
	rig.advance(time.Minute)
	rig.fake.Set(tk.SysID, map[string]string{"state": "2"})
	rig.advance(time.Minute)
	rep, err := run.Run(ctx, false)
	if err != nil {
		t.Fatal(err)
	}
	if !rep.DryRun || rep.Pulled != 1 || rep.Pushed != 3 {
		t.Errorf("report = %+v", rep)
	}
	if rig.repo.written != 0 || len(rig.repo.saved) != 0 || push.calls != 0 || rig.repo.issues[id1].Status != issues.StatusOpen {
		t.Errorf("dry run wrote: written %d saved %v push calls %d", rig.repo.written, rig.repo.saved, push.calls)
	}
}

func TestRunnerCountsAServiceNowOutageAsAnErrorAndStillPushes(t *testing.T) {
	push := &fakePush{}
	run, rig := runnerRig(t, push)
	rig.track(t, id1)
	rig.fake.FailNext(503, `{"error":{"message":"down"}}`, nil)
	rep, err := run.Run(ctx, true)
	if err != nil {
		t.Fatal(err)
	}
	if rep.Errors != 1 || rep.Message == "" || push.calls != 1 {
		t.Errorf("report = %+v push calls %d", rep, push.calls)
	}
}

func TestRunnerRefusesAConcurrentRun(t *testing.T) {
	push := &fakePush{gate: make(chan struct{}), entered: make(chan struct{})}
	run, _ := runnerRig(t, push)
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		_, _ = run.Run(ctx, true)
	}()
	<-push.entered
	_, err := run.Run(ctx, true)
	if !errors.Is(err, issues.ErrSyncBusy) || !issues.IsConflict(err) {
		t.Errorf("err = %v, want ErrSyncBusy as a conflict", err)
	}
	close(push.gate)
	wg.Wait()
	if _, err := run.Run(ctx, true); err != nil && errors.Is(err, issues.ErrSyncBusy) {
		t.Errorf("the guard did not release: %v", err)
	}
}
