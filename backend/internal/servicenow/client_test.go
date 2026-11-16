package servicenow

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/nebucaz/rdf-schema-editor/backend/internal/servicenow/servicenowtest"
)

func basicClient(t *testing.T) (*Client, *servicenowtest.Server) {
	t.Helper()
	fake := servicenowtest.New()
	t.Cleanup(fake.Close)
	fake.BasicUser, fake.BasicPassword = "rse", "s3cret"
	c := NewClient(Settings{BaseURL: fake.URL, Auth: AuthBasic, User: "rse", Password: "s3cret", Table: "incident"}, fake.Client())
	return c, fake
}

func oauthClient(t *testing.T) (*Client, *servicenowtest.Server) {
	t.Helper()
	fake := servicenowtest.New()
	t.Cleanup(fake.Close)
	fake.OAuthClientID, fake.OAuthClientSecret = "cid", "csecret"
	c := NewClient(Settings{BaseURL: fake.URL, Auth: AuthOAuth, ClientID: "cid", ClientSecret: "csecret", Table: "incident"}, fake.Client())
	return c, fake
}

var ctx = context.Background()

func TestCreateGetPatchRoundTrip(t *testing.T) {
	c, fake := basicClient(t)
	tk, err := c.CreateIncident(ctx, map[string]string{"short_description": "Owner missing – “x”", "correlation_id": "abcdefghij234567"})
	if err != nil {
		t.Fatal(err)
	}
	if tk.SysID == "" || !strings.HasPrefix(tk.Number, "INC") || tk.State != "1" || tk.CorrelationID != "abcdefghij234567" {
		t.Fatalf("created = %+v", tk)
	}
	if rec, _ := fake.Record(tk.SysID); rec["short_description"] != "Owner missing – “x”" {
		t.Errorf("UTF-8 body not preserved: %q", rec["short_description"])
	}

	got, err := c.GetIncident(ctx, tk.SysID)
	if err != nil || got.Number != tk.Number {
		t.Fatalf("get = %+v, %v", got, err)
	}

	upd, err := c.UpdateIncident(ctx, tk.SysID, map[string]string{"state": "6", "close_code": "Resolved – Permanent Fix Applied", "close_notes": "Finding gone"})
	if err != nil {
		t.Fatal(err)
	}
	if upd.State != "6" || upd.CloseCode != "Resolved – Permanent Fix Applied" {
		t.Errorf("patched = %+v", upd)
	}
}

func TestFindByCorrelationPrefix(t *testing.T) {
	c, _ := basicClient(t)
	for _, corr := range []string{"abcdefghij234567", "abcdefghij234567-2", "zzzzzzzzzz234567"} {
		if _, err := c.CreateIncident(ctx, map[string]string{"correlation_id": corr}); err != nil {
			t.Fatal(err)
		}
	}
	found, err := c.FindByCorrelation(ctx, "abcdefghij234567")
	if err != nil || len(found) != 2 {
		t.Fatalf("found = %d, %v", len(found), err)
	}
	if _, err := c.FindByCorrelation(ctx, "a^b"); err == nil {
		t.Error("a prefix with the query separator must be refused")
	}
}

func TestListUpdatedSincePagesAndUsesUTC(t *testing.T) {
	c, fake := basicClient(t)
	base := time.Date(2026, 11, 15, 14, 0, 0, 0, time.UTC)
	n := 0
	fake.Now = func() time.Time { n++; return base.Add(time.Duration(n) * time.Minute) }
	for i := 0; i < 5; i++ {
		if _, err := c.CreateIncident(ctx, map[string]string{"correlation_id": "abcdefghij234567-" + string(rune('a'+i))}); err != nil {
			t.Fatal(err)
		}
	}
	c.pageSize = 2
	all, err := c.ListUpdatedSince(ctx, "abcdefghij234567", time.Time{})
	if err != nil || len(all) != 5 {
		t.Fatalf("all = %d, %v", len(all), err)
	}
	// created at minutes 1..5; strictly after minute 3 leaves two
	later, err := c.ListUpdatedSince(ctx, "abcdefghij234567", base.Add(3*time.Minute))
	if err != nil || len(later) != 2 {
		t.Fatalf("later = %d, %v", len(later), err)
	}
	last := fake.Requests[len(fake.Requests)-1]
	if !strings.Contains(last, "sys_updated_on%3E2026-11-15+14%3A03%3A00") {
		t.Errorf("watermark not sent as UTC: %s", last)
	}
	if !strings.Contains(last, "sysparm_fields=") {
		t.Errorf("list must project fields: %s", last)
	}
}

func TestAssigneeUserNameIsReadByDotWalk(t *testing.T) {
	c, fake := basicClient(t)
	fake.Users["00000000000000000000000000001111"] = [2]string{"dev-user", "Dev User"}
	tk, _ := c.CreateIncident(ctx, map[string]string{"correlation_id": "abcdefghij234567"})
	fake.Set(tk.SysID, map[string]string{"assigned_to": "00000000000000000000000000001111"})
	got, err := c.GetIncident(ctx, tk.SysID)
	if err != nil {
		t.Fatal(err)
	}
	if got.AssignedTo != "Dev User" || got.AssignedToUserName != "dev-user" {
		t.Errorf("assignee = %q / %q", got.AssignedTo, got.AssignedToUserName)
	}
}

func TestErrorMapping(t *testing.T) {
	c, fake := basicClient(t)
	tk, _ := c.CreateIncident(ctx, map[string]string{"correlation_id": "abcdefghij234567"})

	if _, err := c.GetIncident(ctx, "ffffffffffffffffffffffffffffffff"); !errors.Is(err, ErrNotFound) {
		t.Errorf("missing record err = %v, want ErrNotFound", err)
	}

	_, err := c.UpdateIncident(ctx, tk.SysID, map[string]string{"state": "6"})
	var rej *ErrRejected
	if !errors.As(err, &rej) || !strings.Contains(rej.Message, "Data Policy Exception") {
		t.Errorf("resolve without close code err = %v, want ErrRejected", err)
	}

	fake.FailNext(429, `{"error":{"message":"Too Many Requests"},"status":"failure"}`, map[string]string{"Retry-After": "7"})
	_, err = c.GetIncident(ctx, tk.SysID)
	var rl *ErrRateLimited
	if !errors.As(err, &rl) || rl.RetryAfter != 7*time.Second {
		t.Errorf("429 err = %v, want ErrRateLimited 7s", err)
	}

	fake.FailNext(503, `<html>down</html>`, nil)
	if _, err = c.GetIncident(ctx, tk.SysID); !errors.Is(err, ErrUnavailable) {
		t.Errorf("503 err = %v, want ErrUnavailable", err)
	}

	// closed tickets are read-only (ACL refusal is a rejection, not "not found")
	_, _ = c.UpdateIncident(ctx, tk.SysID, map[string]string{"state": "7"})
	_, err = c.UpdateIncident(ctx, tk.SysID, map[string]string{"state": "2"})
	if !errors.As(err, &rej) || !strings.Contains(rej.Message, "ACL Exception") {
		t.Errorf("reopen closed err = %v, want ErrRejected", err)
	}
}

func TestTimeoutIsUnavailableAndTextHasNoCredentials(t *testing.T) {
	c, fake := basicClient(t)
	fake.Close() // connection refused
	_, err := c.GetIncident(ctx, "ffffffffffffffffffffffffffffffff")
	if !errors.Is(err, ErrUnavailable) {
		t.Fatalf("err = %v, want ErrUnavailable", err)
	}
	if strings.Contains(err.Error(), "s3cret") {
		t.Errorf("error leaks the password: %v", err)
	}
}

func TestBasicAuthIsSentAndWrongCredentialsAreRejected(t *testing.T) {
	c, _ := basicClient(t)
	c.settings.Password = "wrong"
	_, err := c.GetIncident(ctx, "ffffffffffffffffffffffffffffffff")
	var rej *ErrRejected
	if !errors.As(err, &rej) {
		t.Fatalf("err = %v, want ErrRejected for 401", err)
	}
	if strings.Contains(err.Error(), "wrong") || strings.Contains(err.Error(), "s3cret") {
		t.Errorf("error leaks credentials: %v", err)
	}
}

func TestOAuthTokenIsCachedAndRefreshedOnceWhenExpired(t *testing.T) {
	c, fake := oauthClient(t)
	if _, err := c.CreateIncident(ctx, map[string]string{"correlation_id": "abcdefghij234567"}); err != nil {
		t.Fatal(err)
	}
	if _, err := c.FindByCorrelation(ctx, "abcdefghij234567"); err != nil {
		t.Fatal(err)
	}
	if fake.TokenRequests != 1 {
		t.Errorf("token requests = %d, want the token cached (1)", fake.TokenRequests)
	}
	fake.RevokeTokens() // the instance expires it early
	if _, err := c.FindByCorrelation(ctx, "abcdefghij234567"); err != nil {
		t.Fatalf("expired token must be refreshed once: %v", err)
	}
	if fake.TokenRequests != 2 {
		t.Errorf("token requests = %d, want 2", fake.TokenRequests)
	}
}

func TestOAuthTokenIsRefreshedBeforeItExpires(t *testing.T) {
	c, fake := oauthClient(t)
	fake.TokenTTL = 60
	now := time.Now()
	c.now = func() time.Time { return now }
	_, _ = c.FindByCorrelation(ctx, "a")
	now = now.Add(45 * time.Second) // inside the safety margin
	_, _ = c.FindByCorrelation(ctx, "a")
	if fake.TokenRequests != 2 {
		t.Errorf("token requests = %d, want a refresh before expiry (2)", fake.TokenRequests)
	}
}

func TestFailedOAuthRefreshSurfacesAsAnError(t *testing.T) {
	_, fake := oauthClient(t)
	c := NewClient(Settings{BaseURL: fake.URL, Auth: AuthOAuth, ClientID: "cid", ClientSecret: "bad", Table: "incident"}, fake.Client())
	_, err := c.FindByCorrelation(ctx, "a")
	if err == nil || strings.Contains(err.Error(), "bad") {
		t.Errorf("err = %v, want an error without the secret", err)
	}
}

// Recorded-response fixtures: each decodes through the same path the client uses.
func fixture(t *testing.T, name string) []byte {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("..", "..", "testdata", "servicenow", name))
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func TestRecordedFixturesDecode(t *testing.T) {
	tk, err := decodeOne(fixture(t, "create_response.json"))
	if err != nil || tk.Number != "INC0010001" || tk.State != "1" || tk.UpdatedOn.Hour() != 14 {
		t.Errorf("create fixture = %+v, %v", tk, err)
	}
	tk, err = decodeOne(fixture(t, "get_response.json"))
	if err != nil || tk.AssignedToUserName != "dev-user" || tk.AssignedTo != "Dev User" || tk.CloseCode != "Resolved – Permanent Fix Applied" {
		t.Errorf("get fixture = %+v, %v", tk, err)
	}
	tk, err = decodeOne(fixture(t, "patch_response.json"))
	if err != nil || tk.State != "6" || tk.CloseNotes != "Finding gone" {
		t.Errorf("patch fixture = %+v, %v", tk, err)
	}
	list, err := decodeMany(fixture(t, "list_response.json"))
	if err != nil || len(list) != 1 || list[0].State != "6" {
		t.Errorf("list fixture = %+v, %v", list, err)
	}
	if err := classify(400, nil, fixture(t, "error_data_policy.json")); func() bool { var r *ErrRejected; return !errors.As(err, &r) }() {
		t.Errorf("data policy fixture classified as %v", err)
	}
	if err := classify(404, nil, fixture(t, "error_not_found.json")); !errors.Is(err, ErrNotFound) {
		t.Errorf("not found fixture classified as %v", err)
	}
	// "No Record found" is NotFound whatever the status (an ACL denial looks the same)
	if err := classify(403, nil, fixture(t, "error_not_found.json")); !errors.Is(err, ErrNotFound) {
		t.Errorf("ACL-shaped not found classified as %v", err)
	}
}
