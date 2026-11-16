package servicenow

import (
	"context"
	"errors"
	"log"
	"time"

	"github.com/nebucaz/rdf-schema-editor/backend/internal/issues"
)

// PassRunner is what the worker ticks; *Runner satisfies it.
type PassRunner interface {
	Run(ctx context.Context, apply bool) (issues.SyncReport, error)
}

// SyncWorker runs a sync pass on a fixed interval, mirroring sync.BackstageSyncWorker: a plain ticker loop,
// always applying (a dry run is for a person asking). The Runner's guard keeps passes from overlapping, a
// tick that finds one running is skipped, and a failing or panicking pass is logged without stopping the loop.
type SyncWorker struct {
	Runner   PassRunner
	Interval time.Duration

	newTicker func(time.Duration) (<-chan time.Time, func()) // replaced in tests
}

func realTicker(d time.Duration) (<-chan time.Time, func()) {
	t := time.NewTicker(d)
	return t.C, t.Stop
}

// Run ticks until ctx is cancelled.
func (w *SyncWorker) Run(ctx context.Context) {
	mk := w.newTicker
	if mk == nil {
		mk = realTicker
	}
	ticks, stop := mk(w.Interval)
	defer stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticks:
			w.tick(ctx)
		}
	}
}

func (w *SyncWorker) tick(ctx context.Context) {
	defer func() {
		if r := recover(); r != nil {
			log.Printf("servicenow sync worker: recovered from panic: %v", r)
		}
	}()
	rep, err := w.Runner.Run(ctx, true)
	switch {
	case errors.Is(err, issues.ErrSyncBusy):
		log.Printf("servicenow sync worker: a pass is already running, tick skipped")
	case err != nil:
		log.Printf("servicenow sync worker: %v", err)
	case rep.Errors > 0:
		log.Printf("servicenow sync worker: pass finished with %d error(s): %s", rep.Errors, rep.Message)
	}
}
