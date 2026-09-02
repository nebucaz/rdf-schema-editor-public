package sync

import (
	"context"
	"log"
	"time"
)

// BackstageSyncWorker ticks Engine.RunSync on a fixed interval (Story 008), mirroring
// `saloniq/api/internal/worker/outbox_worker.go`'s exact shape — a plain `time.NewTicker` loop
// inside `Run(ctx)`, no new scheduling dependency. Named for Backstage since it's the only
// registered source today, but takes Source as a field rather than hardcoding it, so a second
// source only needs its own worker instance registered in `main.go`, not a change here.
type BackstageSyncWorker struct {
	Engine   *Engine
	Source   Source
	Interval time.Duration
}

// Run ticks RunSync(ctx, dryRun: false) on Interval until ctx is cancelled — the scheduler always
// runs for real; dry-run is a manual-trigger/CLI-only concept, never scheduled. A tick's own error
// (e.g. upstream unreachable) is logged, not fatal — the worker keeps ticking so a transient outage
// self-heals on the next interval.
func (w *BackstageSyncWorker) Run(ctx context.Context) {
	ticker := time.NewTicker(w.Interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if _, err := w.Engine.RunSync(ctx, w.Source, false); err != nil {
				log.Printf("backstage sync worker: %v", err)
			}
		}
	}
}
