package servicenow

import (
	"context"
	"sync/atomic"
	"testing"
	"time"

	"github.com/nebucaz/rdf-schema-editor/backend/internal/issues"
)

type fakeRun struct {
	calls  atomic.Int32
	panics bool
	err    error
	apply  []bool
	done   chan struct{}
}

func (f *fakeRun) Run(_ context.Context, apply bool) (issues.SyncReport, error) {
	f.apply = append(f.apply, apply)
	n := f.calls.Add(1)
	defer func() { f.done <- struct{}{} }()
	if f.panics && n == 1 {
		panic("boom")
	}
	return issues.SyncReport{}, f.err
}

func TestWorkerTicksOnTheIntervalAndAlwaysApplies(t *testing.T) {
	ticks := make(chan time.Time)
	var gotInterval time.Duration
	f := &fakeRun{done: make(chan struct{}, 4)}
	w := &SyncWorker{Runner: f, Interval: 15 * time.Minute, newTicker: func(d time.Duration) (<-chan time.Time, func()) {
		gotInterval = d
		return ticks, func() {}
	}}
	ctx, cancel := context.WithCancel(context.Background())
	stopped := make(chan struct{})
	go func() { w.Run(ctx); close(stopped) }()
	ticks <- time.Now()
	<-f.done
	ticks <- time.Now()
	<-f.done
	cancel()
	<-stopped
	if gotInterval != 15*time.Minute || f.calls.Load() != 2 || !f.apply[0] || !f.apply[1] {
		t.Errorf("interval %v calls %d apply %v", gotInterval, f.calls.Load(), f.apply)
	}
}

func TestWorkerSurvivesAPanicAndAnError(t *testing.T) {
	ticks := make(chan time.Time)
	f := &fakeRun{panics: true, done: make(chan struct{}, 4), err: issues.ErrSyncBusy}
	w := &SyncWorker{Runner: f, Interval: time.Minute, newTicker: func(time.Duration) (<-chan time.Time, func()) { return ticks, func() {} }}
	ctx, cancel := context.WithCancel(context.Background())
	stopped := make(chan struct{})
	go func() { w.Run(ctx); close(stopped) }()
	ticks <- time.Now() // panics
	<-f.done
	ticks <- time.Now() // the worker is still alive; an error is only logged
	<-f.done
	cancel()
	<-stopped
	if f.calls.Load() != 2 {
		t.Errorf("calls = %d", f.calls.Load())
	}
}
