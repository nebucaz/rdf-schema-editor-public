package servicenow

import (
	"encoding/json"
	"testing"
)

func TestValueAcceptsTheThreeObservedShapes(t *testing.T) {
	var rec map[string]Value
	raw := `{"a":"plain","b":{"link":"https://x/api/now/table/sys_user/1","value":"1"},"c":{"display_value":"Dev User","value":"u1"},"d":"","e":true,"f":3,"g":null}`
	if err := json.Unmarshal([]byte(raw), &rec); err != nil {
		t.Fatal(err)
	}
	want := map[string]Value{
		"a": {Value: "plain"}, "b": {Value: "1"}, "c": {Value: "u1", Display: "Dev User"},
		"d": {}, "e": {Value: "true"}, "f": {Value: "3"}, "g": {},
	}
	for k, w := range want {
		if rec[k] != w {
			t.Errorf("%s = %+v, want %+v", k, rec[k], w)
		}
	}
}

func TestValueRejectsAnArray(t *testing.T) {
	var v Value
	if err := json.Unmarshal([]byte(`[1]`), &v); err == nil {
		t.Error("want an error for an array")
	}
}

func TestUpdatedOnIsParsedAsUTCFromTheRawValue(t *testing.T) {
	var rec map[string]Value
	_ = json.Unmarshal([]byte(`{"sys_updated_on":{"display_value":"2026-11-15 15:39:55","value":"2026-11-15 14:39:55"}}`), &rec)
	tk := ticketFromRecord(rec)
	if got := tk.UpdatedOn.UTC().Format("2006-01-02T15:04:05Z"); got != "2026-11-15T14:39:55Z" {
		t.Errorf("UpdatedOn = %s", got)
	}
}
