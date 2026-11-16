package servicenow

import (
	"fmt"
	"os"
	"strings"
	"testing"
	"time"
)

func env(m map[string]string) func(string) string { return func(k string) string { return m[k] } }

func noFile(string) ([]byte, error) { return nil, fmt.Errorf("no file expected") }

func TestEmptyBaseURLDisablesTheIntegration(t *testing.T) {
	s, err := LoadSettings(env(map[string]string{"SERVICENOW_AUTH": "basic"}), noFile)
	if err != nil {
		t.Fatal(err)
	}
	if s.Enabled() {
		t.Error("integration must be disabled without SERVICENOW_BASE_URL")
	}
}

func TestIncompleteOrInsecureConfigRefusesStartup(t *testing.T) {
	cases := map[string]map[string]string{
		"http base":       {"SERVICENOW_BASE_URL": "http://x.service-now.com", "SERVICENOW_AUTH": "basic", "SERVICENOW_USER": "u", "SERVICENOW_PASSWORD": "p"},
		"no auth switch":  {"SERVICENOW_BASE_URL": "https://x.service-now.com"},
		"unknown auth":    {"SERVICENOW_BASE_URL": "https://x.service-now.com", "SERVICENOW_AUTH": "ntlm"},
		"basic no pass":   {"SERVICENOW_BASE_URL": "https://x.service-now.com", "SERVICENOW_AUTH": "basic", "SERVICENOW_USER": "u"},
		"oauth no secret": {"SERVICENOW_BASE_URL": "https://x.service-now.com", "SERVICENOW_AUTH": "oauth", "SERVICENOW_CLIENT_ID": "c"},
		"bad table":       {"SERVICENOW_BASE_URL": "https://x.service-now.com", "SERVICENOW_AUTH": "basic", "SERVICENOW_USER": "u", "SERVICENOW_PASSWORD": "p", "SERVICENOW_TABLE": "a/b"},
		"base with creds": {"SERVICENOW_BASE_URL": "https://u:p@x.service-now.com", "SERVICENOW_AUTH": "basic", "SERVICENOW_USER": "u", "SERVICENOW_PASSWORD": "p"},
		"bad sync flag":   {"SERVICENOW_BASE_URL": "https://x.service-now.com", "SERVICENOW_AUTH": "basic", "SERVICENOW_USER": "u", "SERVICENOW_PASSWORD": "p", "SERVICENOW_SYNC_ENABLED": "maybe"},
	}
	for name, m := range cases {
		if _, err := LoadSettings(env(m), noFile); err == nil {
			t.Errorf("%s: want a startup error", name)
		}
	}
}

func TestCompleteBasicConfigWithDefaults(t *testing.T) {
	s, err := LoadSettings(env(map[string]string{
		"SERVICENOW_BASE_URL": "https://x.service-now.com/", "SERVICENOW_AUTH": "basic", "SERVICENOW_USER": "u", "SERVICENOW_PASSWORD": "p",
	}), noFile)
	if err != nil {
		t.Fatal(err)
	}
	if !s.Enabled() || s.BaseURL != "https://x.service-now.com" || s.Table != "incident" || !s.SyncEnabled {
		t.Errorf("settings = %+v", s)
	}
	if s.File.StateMap["6"] != "resolved" || s.File.StateMap["8"] != "wontfix" {
		t.Errorf("default state map = %v", s.File.StateMap)
	}
}

func TestSyncCanBeSwitchedOff(t *testing.T) {
	s, err := LoadSettings(env(map[string]string{
		"SERVICENOW_BASE_URL": "https://x.service-now.com", "SERVICENOW_AUTH": "basic", "SERVICENOW_USER": "u", "SERVICENOW_PASSWORD": "p",
		"SERVICENOW_SYNC_ENABLED": "false",
	}), noFile)
	if err != nil {
		t.Fatal(err)
	}
	if s.SyncEnabled {
		t.Error("SyncEnabled should be false")
	}
}

func TestStructuredSettingsComeFromTheJSONFile(t *testing.T) {
	read := func(path string) ([]byte, error) {
		if path != "/etc/sn.json" {
			return nil, os.ErrNotExist
		}
		return []byte(`{"stateMap":{"1":"open","9":"wontfix"},"closeCode":"Resolved – Permanent Fix Applied"}`), nil
	}
	s, err := LoadSettings(env(map[string]string{
		"SERVICENOW_BASE_URL": "https://x.service-now.com", "SERVICENOW_AUTH": "basic", "SERVICENOW_USER": "u", "SERVICENOW_PASSWORD": "p",
		"SERVICENOW_CONFIG_FILE": "/etc/sn.json",
	}), read)
	if err != nil {
		t.Fatal(err)
	}
	if s.File.CloseCode != "Resolved – Permanent Fix Applied" || s.File.StateMap["9"] != "wontfix" || len(s.File.StateMap) != 2 {
		t.Errorf("file settings = %+v", s.File)
	}
}

func TestBadConfigFileRefusesStartup(t *testing.T) {
	base := map[string]string{"SERVICENOW_BASE_URL": "https://x.service-now.com", "SERVICENOW_AUTH": "basic", "SERVICENOW_USER": "u", "SERVICENOW_PASSWORD": "p", "SERVICENOW_CONFIG_FILE": "f"}
	for name, content := range map[string]string{
		"not json":    `nope`,
		"unknown key": `{"stateMapp":{}}`,
		"bad status":  `{"stateMap":{"1":"closed-ish"}}`,
		"non numeric": `{"stateMap":{"new":"open"}}`,
	} {
		_, err := LoadSettings(env(base), func(string) ([]byte, error) { return []byte(content), nil })
		if err == nil {
			t.Errorf("%s: want a startup error", name)
		}
	}
	if _, err := LoadSettings(env(base), func(string) ([]byte, error) { return nil, os.ErrNotExist }); err == nil || !strings.Contains(err.Error(), "SERVICENOW_CONFIG_FILE") {
		t.Errorf("missing file error = %v", err)
	}
}

func TestErrorTextNeverContainsSecrets(t *testing.T) {
	_, err := LoadSettings(env(map[string]string{
		"SERVICENOW_BASE_URL": "http://x", "SERVICENOW_AUTH": "basic", "SERVICENOW_USER": "u", "SERVICENOW_PASSWORD": "s3cret",
	}), noFile)
	if err == nil || strings.Contains(err.Error(), "s3cret") {
		t.Errorf("err = %v", err)
	}
}

func baseEnv(extra map[string]string) func(string) string {
	m := map[string]string{"SERVICENOW_BASE_URL": "https://x.service-now.com", "SERVICENOW_AUTH": "basic", "SERVICENOW_USER": "u", "SERVICENOW_PASSWORD": "p"}
	for k, v := range extra {
		m[k] = v
	}
	return env(m)
}

func TestBulkCapAndAppURLSettings(t *testing.T) {
	s, err := LoadSettings(baseEnv(nil), noFile)
	if err != nil || s.BulkCap != 25 || s.AppURL != "" {
		t.Fatalf("defaults = %+v err %v", s, err)
	}
	s, err = LoadSettings(baseEnv(map[string]string{"SERVICENOW_BULK_CAP": "7", "SERVICENOW_APP_URL": "https://rse.example/workbench/"}), noFile)
	if err != nil || s.BulkCap != 7 || s.AppURL != "https://rse.example/workbench" {
		t.Errorf("settings = %+v err %v", s, err)
	}
	for name, m := range map[string]map[string]string{
		"zero cap":        {"SERVICENOW_BULK_CAP": "0"},
		"huge cap":        {"SERVICENOW_BULK_CAP": "100000"},
		"text cap":        {"SERVICENOW_BULK_CAP": "many"},
		"app url scheme":  {"SERVICENOW_APP_URL": "ftp://rse.example"},
		"app url query":   {"SERVICENOW_APP_URL": "https://rse.example/?x=1"},
		"app url no host": {"SERVICENOW_APP_URL": "https:///path"},
	} {
		if _, err := LoadSettings(baseEnv(m), noFile); err == nil {
			t.Errorf("%s: want a startup error", name)
		}
	}
}

func TestFindingGonePolicyAndCloseCodeDefaults(t *testing.T) {
	base := map[string]string{"SERVICENOW_BASE_URL": "https://x.service-now.com", "SERVICENOW_AUTH": "basic", "SERVICENOW_USER": "u", "SERVICENOW_PASSWORD": "p"}
	s, err := LoadSettings(env(base), noFile)
	if err != nil {
		t.Fatal(err)
	}
	if s.OnFindingGone != OnFindingGoneComment || s.File.CloseCode != "Resolved – Permanent Fix Applied" {
		t.Errorf("defaults = %q %q", s.OnFindingGone, s.File.CloseCode)
	}
	base["SERVICENOW_ON_FINDING_GONE"], base["SERVICENOW_CLOSE_CODE"] = "Resolve", "Solved (Permanently)"
	s, err = LoadSettings(env(base), noFile)
	if err != nil || s.OnFindingGone != OnFindingGoneResolve || s.File.CloseCode != "Solved (Permanently)" {
		t.Errorf("settings = %q %q %v", s.OnFindingGone, s.File.CloseCode, err)
	}
	base["SERVICENOW_ON_FINDING_GONE"] = "delete"
	if _, err := LoadSettings(env(base), noFile); err == nil {
		t.Error("an unknown SERVICENOW_ON_FINDING_GONE must refuse startup")
	}
}

func TestSyncIntervalDefaultsAndIsBounded(t *testing.T) {
	base := map[string]string{"SERVICENOW_BASE_URL": "https://x.service-now.com", "SERVICENOW_AUTH": "basic", "SERVICENOW_USER": "u", "SERVICENOW_PASSWORD": "p"}
	s, err := LoadSettings(env(base), noFile)
	if err != nil || s.SyncInterval != 15*time.Minute {
		t.Fatalf("default = %v %v", s.SyncInterval, err)
	}
	base["SERVICENOW_SYNC_INTERVAL"] = "5m"
	if s, err = LoadSettings(env(base), noFile); err != nil || s.SyncInterval != 5*time.Minute {
		t.Errorf("5m = %v %v", s.SyncInterval, err)
	}
	for _, bad := range []string{"soon", "10s", "-1m", "0"} {
		base["SERVICENOW_SYNC_INTERVAL"] = bad
		if _, err := LoadSettings(env(base), noFile); err == nil {
			t.Errorf("%q: want a startup error", bad)
		}
	}
}
