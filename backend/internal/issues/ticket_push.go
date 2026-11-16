package issues

import (
	"context"
	"errors"
)

// EnablePush wires the ServiceNow side of PushPending.
func (s *Service) EnablePush(p TicketPusher) { s.pusher = p }

// PushResult counts what one PushPending did: Pushed went to ServiceNow, Skipped had nothing to push (a closed
// or locked ticket), Failed is recorded on the issue and retried, Deferred was not attempted because
// ServiceNow was unavailable.
type PushResult struct {
	Pushed, Skipped, Failed, Deferred int
}

// ErrSyncBusy is returned when a sync pass is requested while another one is running (HTTP 409).
var ErrSyncBusy = conflictError{"A ticket sync is already running"}

// SyncReport is the answer of one sync pass (worker, `POST /issues/tickets/sync`, importctl). With DryRun
// nothing is written: the counts say what an applied pass would do.
type SyncReport struct {
	DryRun   bool   `json:"dryRun"`
	Pulled   int    `json:"pulled"` // issues updated from ServiceNow
	Pushed   int    `json:"pushed"` // issues whose changes went to ServiceNow
	Skipped  int    `json:"skipped"`
	Deferred int    `json:"deferred"`
	Errors   int    `json:"errors"`
	Message  string `json:"message,omitempty"` // the first error, without secrets
}

// pendingPushes lists the ticketed issues a push would send.
func (s *Service) pendingPushes(ctx context.Context) ([]Issue, error) {
	all, err := s.store.All(ctx)
	if err != nil {
		return nil, err
	}
	var queue []Issue
	for _, i := range all {
		if i.HasTickets() && (i.SyncState == SyncPending || i.SyncState == SyncError) {
			queue = append(queue, i)
		}
	}
	return queue, nil
}

// PendingPushes is how many issues the next PushPending would try; it writes nothing.
func (s *Service) PendingPushes(ctx context.Context) (int, error) {
	if s.pusher == nil || s.tickets == nil {
		return 0, nil
	}
	q, err := s.pendingPushes(ctx)
	return len(q), err
}

// PushPending sends the local changes of every ticketed issue whose SyncState is `pending` or `error` to its
// current ticket (research D3). A failure is recorded on the issue (SyncState=error, LastError) and retried by
// the next call; it never fails the call itself, and an outage stops the run so the rest stays queued.
func (s *Service) PushPending(ctx context.Context, at string) (PushResult, error) {
	var res PushResult
	if s.pusher == nil || s.tickets == nil {
		return res, nil
	}
	queue, err := s.pendingPushes(ctx)
	if err != nil {
		return res, err
	}
	var changed []Issue
	for n, i := range queue {
		cur, _ := i.CurrentTicket()
		var pushErr error
		if s.tickets.TicketClosed(cur.State) {
			res.Skipped++
		} else if pushErr = s.pusher.PushIssue(ctx, i); pushErr == nil {
			res.Pushed++
		} else if errors.Is(pushErr, ErrTicketLocked) {
			pushErr = nil
			res.Skipped++
		}
		if pushErr == nil {
			i.SyncState, i.LastError, i.LastSyncedAt = SyncSynced, "", at
			changed = append(changed, i)
			continue
		}
		res.Failed++
		i.SyncState, i.LastError = SyncError, pushErr.Error()
		if len(i.LastError) > maxSnapshot {
			i.LastError = i.LastError[:maxSnapshot]
		}
		changed = append(changed, i)
		if errors.Is(pushErr, ErrServiceUnavailable) {
			res.Deferred = len(queue) - n - 1
			break
		}
	}
	if len(changed) > 0 {
		if err := s.store.Update(ctx, changed...); err != nil {
			return res, err
		}
	}
	return res, nil
}
