package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func glossaryServer(t *testing.T, seen *[]string) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		*seen = append(*seen, r.URL.String()+" auth="+r.Header.Get("Authorization"))
		page := r.URL.Query().Get("page")
		more := page == "" || page == "1"
		w.Header().Set("X-Has-More", fmt.Sprint(more))
		if r.URL.Query().Get("format") == "turtle" {
			w.Header().Set("Content-Type", "text/turtle")
			fmt.Fprintf(w, "@prefix skos: <http://www.w3.org/2004/02/skos/core#> .\n\n<http://e/%s> a skos:Concept .\n", page)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintf(w, `{"items":[{"id":"c%s"}],"page":1,"hasMore":%v}`, page, more)
	}))
}

func TestRun_GlossaryExport_TurtleFollowsEveryPageAndSendsTheToken(t *testing.T) {
	var seen []string
	server := glossaryServer(t, &seen)
	defer server.Close()

	var stdout, stderr bytes.Buffer
	code := run([]string{"glossary", "export", "--backend-url", server.URL, "--token", "tok", "--scheme", "Workforce", "--lang", "de"}, &stdout, &stderr)
	if code != 0 {
		t.Fatalf("exit %d: %s", code, stderr.String())
	}
	if len(seen) != 2 || !strings.Contains(seen[0], "format=turtle") || !strings.Contains(seen[0], "scheme=Workforce") || !strings.Contains(seen[0], "lang=de") || !strings.Contains(seen[1], "page=2") || !strings.HasSuffix(seen[0], "auth=Bearer tok") {
		t.Errorf("requests = %v", seen)
	}
	out := stdout.String()
	if strings.Count(out, "@prefix") != 1 || !strings.Contains(out, "<http://e/1>") || !strings.Contains(out, "<http://e/2>") {
		t.Errorf("output = %s", out)
	}
}

func TestRun_GlossaryExport_JSONMergesThePagesAndWritesToAFile(t *testing.T) {
	var seen []string
	server := glossaryServer(t, &seen)
	defer server.Close()
	out := filepath.Join(t.TempDir(), "g.json")

	var stdout, stderr bytes.Buffer
	code := run([]string{"glossary", "export", "--format", "json", "--out", out, "--backend-url", server.URL}, &stdout, &stderr)
	if code != 0 {
		t.Fatalf("exit %d: %s", code, stderr.String())
	}
	raw, _ := os.ReadFile(out)
	var doc struct{ Items []struct{ ID string } }
	if err := json.Unmarshal(raw, &doc); err != nil || len(doc.Items) != 2 {
		t.Errorf("file = %s (%v)", raw, err)
	}
}

func TestRun_GlossaryExport_RejectsBadUsage(t *testing.T) {
	for _, args := range [][]string{{"glossary"}, {"glossary", "import"}, {"glossary", "export", "--format", "xml"}} {
		var stdout, stderr bytes.Buffer
		if code := run(args, &stdout, &stderr); code == 0 || stderr.Len() == 0 {
			t.Errorf("%v: exit %d, stderr %q", args, code, stderr.String())
		}
	}
}

func TestRun_GlossaryExport_AnApiErrorIsReported(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
	}))
	defer server.Close()
	var stdout, stderr bytes.Buffer
	if code := run([]string{"glossary", "export", "--backend-url", server.URL}, &stdout, &stderr); code == 0 || !strings.Contains(stderr.String(), "401") {
		t.Errorf("exit %d, stderr %q", code, stderr.String())
	}
}
