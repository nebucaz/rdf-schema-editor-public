package servicenow

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/nebucaz/rdf-schema-editor/backend/internal/issues"
	"github.com/nebucaz/rdf-schema-editor/backend/internal/servicenow/servicenowtest"
)

const closeCode = "Resolved – Permanent Fix Applied"

func pushRig(t *testing.T, onGone string) (*Pusher, *servicenowtest.Server, *Client) {
	t.Helper()
	c, fake := basicClient(t)
	s := Settings{BaseURL: fake.URL, Table: "incident", OnFindingGone: onGone, File: FileSettings{StateMap: defaultStateMap(), CloseCode: closeCode}}
	return NewPusher(c, s), fake, c
}

func ticketedIssue(t *testing.T, c *Client, status string) (issues.Issue, string) {
	t.Helper()
	tk, err := c.CreateIncident(ctx, map[string]string{"correlation_id": findingID, "short_description": "x"})
	if err != nil {
		t.Fatal(err)
	}
	i := sampleIssue()
	i.Status, i.Note = status, "internal: do not leak SECRET-NOTE"
	i.UpdatedAt = "2026-03-02T08:00:00.000Z"
	if err := i.AddTicket(issues.Ticket{CorrelationID: findingID, Number: tk.Number, SysID: tk.SysID, State: "1"}); err != nil {
		t.Fatal(err)
	}
	return i, tk.SysID
}

func lastPatch(fake *servicenowtest.Server) string {
	for n := len(fake.Requests) - 1; n >= 0; n-- {
		if strings.HasPrefix(fake.Requests[n], "PATCH") {
			return fake.Requests[n]
		}
	}
	return ""
}

func TestFindingGoneCommentsOnlyByDefault(t *testing.T) {
	p, fake, c := pushRig(t, OnFindingGoneComment)
	i, sys := ticketedIssue(t, c, issues.StatusResolved)
	i.ResolvedBy = issues.SystemUser
	if err := p.PushIssue(ctx, i); err != nil {
		t.Fatal(err)
	}
	rec := fake.Notes(sys)
	if len(rec) != 1 || !strings.Contains(rec[0], "no longer reported by validation run 2026-03-02T08:00:00.000Z") {
		t.Errorf("work notes = %q", rec)
	}
	if r, _ := fake.Record(sys); r["state"] != "1" {
		t.Errorf("state = %q, must be untouched", r["state"])
	}
}

func TestFindingGoneResolvesWithCloseCodeAndNotesWhenConfigured(t *testing.T) {
	p, fake, c := pushRig(t, OnFindingGoneResolve)
	i, sys := ticketedIssue(t, c, issues.StatusResolved)
	i.ResolvedBy = issues.SystemUser
	if err := p.PushIssue(ctx, i); err != nil {
		t.Fatal(err)
	}
	r, _ := fake.Record(sys)
	if r["state"] != "6" || r["close_code"] != closeCode || !strings.Contains(r["close_notes"], "no longer reported") {
		t.Errorf("record = %v", r)
	}
	if len(fake.Notes(sys)) != 1 {
		t.Errorf("notes = %q", fake.Notes(sys))
	}
}

func TestWontFixCancelsWithAWorkNote(t *testing.T) {
	p, fake, c := pushRig(t, OnFindingGoneComment)
	i, sys := ticketedIssue(t, c, issues.StatusWontFix)
	i.ResolvedBy = "alice"
	if err := p.PushIssue(ctx, i); err != nil {
		t.Fatal(err)
	}
	if r, _ := fake.Record(sys); r["state"] != "8" {
		t.Errorf("state = %q, want 8", r["state"])
	}
	if n := fake.Notes(sys); len(n) != 1 || !strings.Contains(n[0], "won't fix") {
		t.Errorf("notes = %q", n)
	}
}

func TestChangedSnapshotAddsAWorkNoteOnly(t *testing.T) {
	p, fake, c := pushRig(t, OnFindingGoneResolve)
	i, sys := ticketedIssue(t, c, issues.StatusOpen)
	i.Message = "owner missing (new wording)"
	v := "no-owner"
	i.Value = &v
	if err := p.PushIssue(ctx, i); err != nil {
		t.Fatal(err)
	}
	r, _ := fake.Record(sys)
	n := fake.Notes(sys)
	if r["state"] != "1" || r["short_description"] != "x" || len(n) != 1 || !strings.Contains(n[0], "new wording") || !strings.Contains(n[0], "no-owner") {
		t.Errorf("record %v notes %q", r, n)
	}
}

func TestThePayloadNeverCarriesTheLocalNote(t *testing.T) {
	for _, status := range []string{issues.StatusOpen, issues.StatusWontFix, issues.StatusResolved} {
		p, fake, c := pushRig(t, OnFindingGoneResolve)
		i, sys := ticketedIssue(t, c, status)
		i.ResolvedBy = issues.SystemUser
		if err := p.PushIssue(ctx, i); err != nil {
			t.Fatal(err)
		}
		r, _ := fake.Record(sys)
		raw, _ := json.Marshal(r)
		all := string(raw) + strings.Join(fake.Notes(sys), "|")
		if strings.Contains(all, "SECRET-NOTE") {
			t.Errorf("%s: the local note reached ServiceNow: %s", status, all)
		}
	}
}

func TestResolvedByAPersonOrServiceNowPushesNothing(t *testing.T) {
	for _, by := range []string{"alice", issues.ServiceNowUser} {
		p, fake, c := pushRig(t, OnFindingGoneResolve)
		i, _ := ticketedIssue(t, c, issues.StatusResolved)
		i.ResolvedBy = by
		fake.Requests = nil
		if err := p.PushIssue(ctx, i); err != nil || lastPatch(fake) != "" {
			t.Errorf("%s: err %v patch %q", by, err, lastPatch(fake))
		}
	}
}

func TestTicketlessAndClosedTicketsAreNotTouched(t *testing.T) {
	p, fake, c := pushRig(t, OnFindingGoneResolve)
	plain := sampleIssue()
	plain.Tickets = []issues.Ticket{}
	if err := p.PushIssue(ctx, plain); err != nil {
		t.Fatal(err)
	}
	i, _ := ticketedIssue(t, c, issues.StatusOpen)
	i.Tickets[0].State = "6"
	fake.Requests = nil
	if err := p.PushIssue(ctx, i); err != nil || len(fake.Requests) != 0 {
		t.Errorf("closed: err %v requests %v", err, fake.Requests)
	}
}

func TestClosedAndCancelledTicketsAnswerALockedError(t *testing.T) {
	for _, state := range []string{"7", "8"} {
		p, fake, c := pushRig(t, OnFindingGoneComment)
		i, sys := ticketedIssue(t, c, issues.StatusOpen) // local copy still thinks the ticket is open
		fake.Set(sys, map[string]string{"state": state})
		err := p.PushIssue(ctx, i)
		if !errors.Is(err, issues.ErrTicketLocked) {
			t.Errorf("state %s: err = %v, want ErrTicketLocked", state, err)
		}
	}
}

func TestARejectedCloseValueSurfacesTheServiceNowMessage(t *testing.T) {
	p, fake, c := pushRig(t, OnFindingGoneResolve)
	p.closeCode = ""
	i, _ := ticketedIssue(t, c, issues.StatusResolved)
	i.ResolvedBy = issues.SystemUser
	err := p.PushIssue(ctx, i)
	var rej *ErrRejected
	if !errors.As(err, &rej) || !strings.Contains(err.Error(), "Data Policy Exception") || errors.Is(err, issues.ErrTicketLocked) {
		t.Errorf("err = %v", err)
	}
	_ = fake
}
