package servicenow

import (
	"bytes"
	"encoding/json"
	"fmt"
	"time"
)

// Value is one field of a Table API record. The API sends a plain string, a reference `{link, value}`, or
// with `sysparm_display_value=all` `{display_value, value}`; numbers and booleans are strings. Logic reads
// Value (the raw stored value); Display is for people only.
type Value struct {
	Value   string
	Display string
}

// UnmarshalJSON accepts every shape above, and null.
func (v *Value) UnmarshalJSON(b []byte) error {
	b = bytes.TrimSpace(b)
	switch {
	case len(b) == 0 || string(b) == "null":
		*v = Value{}
		return nil
	case b[0] == '"':
		var s string
		if err := json.Unmarshal(b, &s); err != nil {
			return err
		}
		*v = Value{Value: s}
		return nil
	case b[0] == '{':
		var o struct {
			Value   json.RawMessage `json:"value"`
			Display json.RawMessage `json:"display_value"`
		}
		if err := json.Unmarshal(b, &o); err != nil {
			return err
		}
		*v = Value{Value: scalar(o.Value), Display: scalar(o.Display)}
		return nil
	case b[0] == '[':
		return fmt.Errorf("servicenow: unexpected array value")
	}
	*v = Value{Value: scalar(b)}
	return nil
}

// scalar renders a JSON string, number or boolean as the string ServiceNow would have sent.
func scalar(raw json.RawMessage) string {
	raw = bytes.TrimSpace(raw)
	if len(raw) == 0 || string(raw) == "null" {
		return ""
	}
	if raw[0] == '"' {
		var s string
		_ = json.Unmarshal(raw, &s)
		return s
	}
	return string(raw)
}

const timestampLayout = "2006-01-02 15:04:05"

// ParseTimestamp reads a raw ServiceNow date-time, which is UTC without a zone. Empty is the zero time.
func ParseTimestamp(raw string) time.Time {
	if raw == "" {
		return time.Time{}
	}
	t, err := time.ParseInLocation(timestampLayout, raw, time.UTC)
	if err != nil {
		return time.Time{}
	}
	return t
}

// FormatTimestamp renders t as ServiceNow expects it in a query: UTC, no zone.
func FormatTimestamp(t time.Time) string { return t.UTC().Format(timestampLayout) }

// Ticket is an incident as the sync needs it. Times are UTC, parsed from the raw value.
type Ticket struct {
	SysID, Number, CorrelationID string
	State                        string // stored value of `state`
	StateLabel                   string // display text, people only
	ShortDescription             string
	AssignmentGroup              string // display text
	AssignedTo                   string // display text
	AssignedToUserName           string // dot-walked sys_user.user_name; "" when unassigned
	CloseCode, CloseNotes        string
	Active                       bool
	UpdatedOn, ClosedAt          time.Time
	CreatedOn                    time.Time
}

func ticketFromRecord(rec map[string]Value) Ticket {
	return Ticket{
		SysID: rec["sys_id"].Value, Number: rec["number"].Value, CorrelationID: rec["correlation_id"].Value,
		State: rec["state"].Value, StateLabel: rec["state"].Display, ShortDescription: rec["short_description"].Value,
		AssignmentGroup: rec["assignment_group"].Display, AssignedTo: rec["assigned_to"].Display,
		AssignedToUserName: rec["assigned_to.user_name"].Value,
		CloseCode:          rec["close_code"].Value, CloseNotes: rec["close_notes"].Value,
		Active:    rec["active"].Value == "true",
		UpdatedOn: ParseTimestamp(rec["sys_updated_on"].Value), ClosedAt: ParseTimestamp(rec["closed_at"].Value),
		CreatedOn: ParseTimestamp(rec["sys_created_on"].Value),
	}
}

func decodeOne(body []byte) (Ticket, error) {
	var env struct {
		Result map[string]Value `json:"result"`
	}
	if err := json.Unmarshal(body, &env); err != nil {
		return Ticket{}, fmt.Errorf("servicenow: unreadable response: %w", err)
	}
	return ticketFromRecord(env.Result), nil
}

func decodeMany(body []byte) ([]Ticket, error) {
	var env struct {
		Result []map[string]Value `json:"result"`
	}
	if err := json.Unmarshal(body, &env); err != nil {
		return nil, fmt.Errorf("servicenow: unreadable response: %w", err)
	}
	out := make([]Ticket, 0, len(env.Result))
	for _, rec := range env.Result {
		out = append(out, ticketFromRecord(rec))
	}
	return out, nil
}
