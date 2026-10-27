// Package querymodel validates a Query Workbench model exactly as `parseQueryModel`
// (`app/src/lib/services/query-model.ts`) does and writes it back the way `JSON.stringify` would.
// `backend/testdata/golden/query-model.json` is the agreement mechanism with the Vitest suite.
//
// Like the TypeScript parser this is strict about the types of known fields, keeps unknown fields
// untouched, and does not run the semantic `validateQueryModel` checks.
package querymodel

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"
)

// object is a JSON object that remembers key order, as a JavaScript object does.
type object struct {
	keys []string
	vals map[string]any
}

func (o *object) get(key string) (any, bool) {
	v, ok := o.vals[key]
	return v, ok
}

func (o *object) set(key string, v any) {
	if _, dup := o.vals[key]; !dup {
		o.keys = append(o.keys, key)
	}
	o.vals[key] = v
}

// Parse validates text and returns the model serialised the way the browser would
// (`serializeQueryModel`): compact, key order preserved. The error text is the one the UI shows.
func Parse(text string) (string, error) {
	if !json.Valid([]byte(text)) {
		return "", errors.New("Query model is not valid JSON")
	}
	dec := json.NewDecoder(strings.NewReader(text))
	raw, err := decodeValue(dec)
	if err != nil {
		return "", errors.New("Query model is not valid JSON")
	}
	root, ok := raw.(*object)
	if !ok {
		return "", errors.New("Query model must be a JSON object")
	}
	if v, present := root.get("version"); !present || !isNumber(v, 1) {
		return "", fmt.Errorf("Unsupported query model version: %s", jsString(root, "version"))
	}
	if msg := shapeError(root); msg != "" {
		return "", errors.New(msg)
	}
	var b strings.Builder
	writeValue(&b, root)
	return b.String(), nil
}

func decodeValue(dec *json.Decoder) (any, error) {
	tok, err := dec.Token()
	if err != nil {
		return nil, err
	}
	switch t := tok.(type) {
	case json.Delim:
		if t == '{' {
			o := &object{vals: map[string]any{}}
			for dec.More() {
				k, err := dec.Token()
				if err != nil {
					return nil, err
				}
				v, err := decodeValue(dec)
				if err != nil {
					return nil, err
				}
				o.set(k.(string), v)
			}
			_, err := dec.Token()
			return o, err
		}
		arr := []any{}
		for dec.More() {
			v, err := decodeValue(dec)
			if err != nil {
				return nil, err
			}
			arr = append(arr, v)
		}
		_, err := dec.Token()
		return arr, err
	default:
		return tok, nil
	}
}

func isNumber(v any, want float64) bool {
	f, ok := v.(float64)
	return ok && f == want
}

func isStr(v any) bool       { _, ok := v.(string); return ok }
func isStrOrNull(v any) bool { return v == nil || isStr(v) }
func isBool(v any) bool      { _, ok := v.(bool); return ok }
func isNum(v any) bool       { _, ok := v.(float64); return ok }

func isStrArr(v any) bool {
	arr, ok := v.([]any)
	if !ok {
		return false
	}
	for _, e := range arr {
		if !isStr(e) {
			return false
		}
	}
	return true
}

// field reads key from v when v is an object; a missing key and a non-object both read as absent.
func field(v any, key string) (any, bool) {
	o, ok := v.(*object)
	if !ok {
		return nil, false
	}
	return o.get(key)
}

// strField is a present string; optional says an absent key is acceptable as well.
func strField(v any, key string) bool {
	f, ok := field(v, key)
	return ok && isStr(f)
}

func strOrNullField(v any, key string) bool {
	f, ok := field(v, key)
	return ok && isStrOrNull(f)
}

func optional(v any, key string, valid func(any) bool) bool {
	f, ok := field(v, key)
	return !ok || valid(f)
}

func oneOf(v any, options ...string) bool {
	s, ok := v.(string)
	if !ok {
		return false
	}
	for _, o := range options {
		if s == o {
			return true
		}
	}
	return false
}

var (
	filterOps  = []string{"eq", "neq", "contains", "isEmpty", "isNotEmpty", "in", "gt", "gte", "lt", "lte"}
	havingOps  = []string{"gt", "gte", "lt", "lte", "eq", "neq"}
	measureFns = []string{"count", "countDistinct", "sum", "avg", "min", "max"}
	ruleOps    = []string{"eq", "contains", "isEmpty"}
)

// shapeError mirrors `shapeError` in query-model.ts, check for check and in the same order.
func shapeError(m *object) string {
	root, _ := m.get("root")
	if _, isObj := root.(*object); !isObj || !strField(root, "classIri") || !isBool(mustField(root, "includeSubclasses")) {
		return "root must be { classIri: string, includeSubclasses: boolean }"
	}
	if ns, _ := m.get("namespaces"); !isStrArr(ns) {
		return "namespaces must be an array of strings"
	}

	hops, ok := arrayOf(m, "hops")
	if !ok {
		return "hops must be an array"
	}
	for _, h := range hops {
		if _, isObj := h.(*object); !isObj || !strField(h, "id") || !strOrNullField(h, "parentHopId") ||
			!strField(h, "propertyIri") || !oneOf(mustField(h, "direction"), "forward", "inverse") ||
			!strField(h, "targetClassIri") {
			return "hops contains a malformed entry"
		}
	}

	filters, ok := arrayOf(m, "filters")
	if !ok {
		return "filters must be an array"
	}
	for _, f := range filters {
		if _, isObj := f.(*object); !isObj || !strField(f, "id") || !strOrNullField(f, "hopId") ||
			!strOrNullField(f, "propertyIri") || !oneOf(mustField(f, "op"), filterOps...) ||
			!optional(f, "value", func(v any) bool { return isStr(v) || isStrArr(v) }) ||
			!optional(f, "orGroup", func(v any) bool { s, ok := v.(string); return ok && s != "" }) ||
			!optional(f, "relativeTime", isStr) {
			return "filters contains a malformed entry"
		}
	}

	columns, ok := arrayOf(m, "columns")
	if !ok {
		return "columns must be an array"
	}
	for _, c := range columns {
		source := mustField(c, "source")
		sourceOK := oneOf(source, "label", "iri")
		if _, isObj := source.(*object); isObj && strField(source, "propertyIri") {
			sourceOK = true
		}
		if _, isObj := c.(*object); !isObj || !strField(c, "id") || !strOrNullField(c, "hopId") || !sourceOK ||
			!strField(c, "header") {
			return "columns contains a malformed entry"
		}
	}

	sorts, ok := arrayOf(m, "sort")
	if !ok {
		return "sort must be an array"
	}
	for _, s := range sorts {
		if _, isObj := s.(*object); !isObj || !strField(s, "columnId") || !oneOf(mustField(s, "direction"), "asc", "desc") {
			return "sort contains a malformed entry"
		}
	}

	if limit, present := m.get("limit"); present && !isNum(limit) {
		return "limit must be a number"
	}
	if _, present := m.get("having"); present {
		return "having belongs inside aggregation"
	}
	if a, present := m.get("aggregation"); present {
		if _, isObj := a.(*object); !isObj || !isStrArrField(a, "groupBy") || !isArrayField(a, "measures") {
			return "aggregation must be { groupBy: string[], measures: [] }"
		}
		measures, _ := a.(*object).get("measures")
		for _, me := range measures.([]any) {
			if _, isObj := me.(*object); !isObj || !strField(me, "fn") || !oneOf(mustField(me, "fn"), measureFns...) ||
				!strField(me, "of") || !strField(me, "alias") {
				return "aggregation.measures contains a malformed entry"
			}
		}
		if having, present := a.(*object).get("having"); present {
			arr, isArr := having.([]any)
			if !isArr {
				return "aggregation.having must be an array"
			}
			for _, h := range arr {
				if _, isObj := h.(*object); !isObj || !strField(h, "measure") || !oneOf(mustField(h, "op"), havingOps...) ||
					!isNum(mustField(h, "value")) {
					return "aggregation.having contains a malformed entry"
				}
			}
		}
	}

	if rules, present := m.get("columnRules"); present {
		arr, isArr := rules.([]any)
		if !isArr {
			return "columnRules must be an array"
		}
		for _, r := range arr {
			match := mustField(r, "match")
			if _, isObj := r.(*object); !isObj || !strField(r, "columnId") || !strField(r, "color") ||
				func() bool { _, ok := match.(*object); return !ok }() ||
				!oneOf(mustField(match, "op"), ruleOps...) ||
				!optional(match, "value", isStr) || !optional(r, "chip", isBool) || !optional(r, "row", isBool) {
				return "columnRules contains a malformed entry"
			}
		}
	}
	return ""
}

// mustField is field without the presence flag: an absent key reads as nil, which no check accepts.
func mustField(v any, key string) any {
	f, _ := field(v, key)
	return f
}

func arrayOf(m *object, key string) ([]any, bool) {
	v, _ := m.get(key)
	arr, ok := v.([]any)
	return arr, ok
}

func isArrayField(v any, key string) bool {
	_, ok := mustField(v, key).([]any)
	return ok
}

func isStrArrField(v any, key string) bool { return isStrArr(mustField(v, key)) }

// jsString renders root[key] the way `String(raw.key)` does in the error message.
func jsString(root *object, key string) string {
	v, present := root.get(key)
	if !present {
		return "undefined"
	}
	return stringify(v)
}

func stringify(v any) string {
	switch t := v.(type) {
	case nil:
		return "null"
	case string:
		return t
	case bool:
		return strconv.FormatBool(t)
	case float64:
		return jsNumber(t)
	case []any:
		parts := make([]string, len(t))
		for i, e := range t {
			if e != nil {
				parts[i] = stringify(e)
			}
		}
		return strings.Join(parts, ",")
	default:
		return "[object Object]"
	}
}

// jsNumber formats like JavaScript's Number#toString.
func jsNumber(f float64) string {
	if f == 0 || math.IsNaN(f) || math.IsInf(f, 0) {
		return "0"
	}
	e := strconv.FormatFloat(f, 'e', -1, 64) // d[.ddd]e±XX
	mantissa, expStr, _ := strings.Cut(e, "e")
	exp, _ := strconv.Atoi(expStr)
	if exp >= -6 && exp < 21 {
		return strconv.FormatFloat(f, 'f', -1, 64)
	}
	sign := "+"
	if exp < 0 {
		sign, exp = "-", -exp
	}
	return mantissa + "e" + sign + strconv.Itoa(exp)
}

func writeValue(b *strings.Builder, v any) {
	switch t := v.(type) {
	case nil:
		b.WriteString("null")
	case bool:
		b.WriteString(strconv.FormatBool(t))
	case float64:
		b.WriteString(jsNumber(t))
	case string:
		writeString(b, t)
	case []any:
		b.WriteByte('[')
		for i, e := range t {
			if i > 0 {
				b.WriteByte(',')
			}
			writeValue(b, e)
		}
		b.WriteByte(']')
	case *object:
		b.WriteByte('{')
		for i, k := range t.keys {
			if i > 0 {
				b.WriteByte(',')
			}
			writeString(b, k)
			b.WriteByte(':')
			writeValue(b, t.vals[k])
		}
		b.WriteByte('}')
	}
}

// writeString quotes like JSON.stringify: only `"`, `\` and C0 controls are escaped.
func writeString(b *strings.Builder, s string) {
	b.WriteByte('"')
	for _, r := range s {
		switch {
		case r == '"':
			b.WriteString(`\"`)
		case r == '\\':
			b.WriteString(`\\`)
		case r == '\b':
			b.WriteString(`\b`)
		case r == '\f':
			b.WriteString(`\f`)
		case r == '\n':
			b.WriteString(`\n`)
		case r == '\r':
			b.WriteString(`\r`)
		case r == '\t':
			b.WriteString(`\t`)
		case r < 0x20:
			fmt.Fprintf(b, `\u%04x`, r)
		default:
			b.WriteRune(r)
		}
	}
	b.WriteByte('"')
}
