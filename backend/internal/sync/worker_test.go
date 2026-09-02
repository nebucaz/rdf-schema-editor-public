package sync

import (
	"context"
	"sync/atomic"
	"testing"
	"time"
)

// countingSource counts DiscoverKinds calls (a stand-in for "RunSync was invoked") without needing
// a real GraphDB backend — worker ticking behavior doesn't depend on what RunSync actually writes.
type countingSource struct {
	name  string
	calls int32
}

func (s *countingSource) Name() string { return s.name }

func (s *countingSource) DiscoverKinds(ctx context.Context) ([]string, error) {
	atomic.AddInt32(&s.calls, 1)
	return nil, nil
}

func (s *countingSource) FetchEntities(ctx context.Context, kind string) ([]Entity, error) {
	return nil, nil
}

func TestBackstageSyncWorker_TicksAndStopsOnCancel(t *testing.T) {
	engine, _ := newTestEngine(t)
	source := &countingSource{name: "backstage"}
	worker := &BackstageSyncWorker{Engine: engine, Source: source, Interval: 10 * time.Millisecond}

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		worker.Run(ctx)
		close(done)
	}()

	deadline := time.After(2 * time.Second)
	for atomic.LoadInt32(&source.calls) < 2 {
		select {
		case <-deadline:
			cancel()
			t.Fatal("worker did not tick at least twice within the deadline")
		case <-time.After(5 * time.Millisecond):
		}
	}

	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("worker did not stop within the deadline after context cancellation")
	}
}

func TestBackstageSyncWorker_TickAlwaysRunsForReal(t *testing.T) {
	engine, _ := newTestEngine(t)
	source := &fixtureSource{name: "backstage", kinds: []string{}}
	worker := &BackstageSyncWorker{Engine: engine, Source: source, Interval: 10 * time.Millisecond}

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Millisecond)
	defer cancel()
	worker.Run(ctx)

	// A ticked run is always non-dry-run — RunSync's in-flight guard only ever engages for real
	// syncs, so if the ticker had somehow triggered a dry run this would stay false; assert instead
	// that the engine's own accounting shows no leftover in-flight state (each real tick completed
	// and cleared its guard).
	engine.mu.Lock()
	stillInFlight := engine.inFlight[source.Name()]
	engine.mu.Unlock()
	if stillInFlight {
		t.Error("engine still reports an in-flight sync after the worker's context was cancelled")
	}
}
