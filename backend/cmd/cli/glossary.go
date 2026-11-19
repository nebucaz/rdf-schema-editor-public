package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
)

const glossaryUsage = "usage: importctl glossary export [--format turtle|json] [--scheme ID] [--lang TAG] [--modified-since DATE] [--out FILE] [--backend-url URL] [--token TOKEN]"

// maxGlossaryPages stops a misbehaving backend from looping the export forever.
const maxGlossaryPages = 10000

type glossaryArgs struct {
	format, scheme, lang, modifiedSince, out, backendURL, token string
}

func parseGlossaryArgs(args []string) (glossaryArgs, error) {
	g := glossaryArgs{format: "turtle", backendURL: defaultBackendURL}
	if v := os.Getenv("BACKEND_URL"); v != "" {
		g.backendURL = v
	}
	g.token = os.Getenv("IMPORTCTL_AUTH_TOKEN")
	targets := map[string]*string{
		"--format": &g.format, "--scheme": &g.scheme, "--lang": &g.lang, "--modified-since": &g.modifiedSince,
		"--out": &g.out, "--backend-url": &g.backendURL, "--token": &g.token,
	}
	for i := 0; i < len(args); i++ {
		name, value, hasValue := strings.Cut(args[i], "=")
		target, known := targets[name]
		if !known {
			return g, fmt.Errorf("unknown argument %q", args[i])
		}
		if !hasValue {
			if i+1 >= len(args) {
				return g, fmt.Errorf("%s requires a value", name)
			}
			i++
			value = args[i]
		}
		*target = value
	}
	if g.format != "turtle" && g.format != "json" {
		return g, fmt.Errorf("--format must be turtle or json")
	}
	return g, nil
}

// glossaryPage fetches one page of /glossary/concepts and reports whether the backend says there is more.
func (c *apiClient) glossaryPage(ctx context.Context, g glossaryArgs, page int) (body []byte, more bool, err error) {
	q := url.Values{"format": {g.format}, "page": {strconv.Itoa(page)}}
	for k, v := range map[string]string{"scheme": g.scheme, "lang": g.lang, "modifiedSince": g.modifiedSince} {
		if v != "" {
			q.Set(k, v)
		}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/glossary/concepts?"+q.Encode(), nil)
	if err != nil {
		return nil, false, err
	}
	c.setAuth(req)
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, false, fmt.Errorf("backend unreachable at %s: %w", req.URL, err)
	}
	defer resp.Body.Close()
	body, err = io.ReadAll(resp.Body)
	if err != nil {
		return nil, false, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, false, &apiError{status: resp.StatusCode, body: string(body)}
	}
	return body, resp.Header.Get("X-Has-More") == "true", nil
}

// runGlossary implements `importctl glossary export`: every page of GET /glossary/concepts as one Turtle or JSON
// document, on stdout or in --out. It needs the service token, like the other commands.
func runGlossary(args []string, stdout, stderr io.Writer) int {
	if len(args) < 1 || args[0] != "export" {
		fmt.Fprintln(stderr, glossaryUsage)
		return 1
	}
	g, err := parseGlossaryArgs(args[1:])
	if err != nil {
		fmt.Fprintln(stderr, err)
		fmt.Fprintln(stderr, glossaryUsage)
		return 1
	}
	client := &apiClient{baseURL: g.backendURL, token: g.token, http: http.DefaultClient}

	var turtle strings.Builder
	items := []json.RawMessage{}
	for page := 1; page <= maxGlossaryPages; page++ {
		body, more, err := client.glossaryPage(context.Background(), g, page)
		if err != nil {
			fmt.Fprintln(stderr, err)
			return 1
		}
		if g.format == "turtle" {
			text := string(body)
			if page > 1 {
				text = dropPrefixes(text)
			}
			turtle.WriteString(text)
		} else {
			var doc struct {
				Items []json.RawMessage `json:"items"`
			}
			if err := json.Unmarshal(body, &doc); err != nil {
				fmt.Fprintln(stderr, "unreadable response:", err)
				return 1
			}
			items = append(items, doc.Items...)
		}
		if !more {
			break
		}
	}

	out := []byte(turtle.String())
	if g.format == "json" {
		out, _ = json.MarshalIndent(map[string]any{"items": items}, "", "  ")
		out = append(out, '\n')
	}
	if g.out != "" {
		if err := os.WriteFile(g.out, out, 0o644); err != nil {
			fmt.Fprintln(stderr, err)
			return 1
		}
		return 0
	}
	_, _ = stdout.Write(out)
	return 0
}

// dropPrefixes removes the `@prefix` header every Turtle page starts with, so merged pages declare them once.
func dropPrefixes(text string) string {
	lines := strings.Split(text, "\n")
	kept := lines[:0]
	for _, l := range lines {
		if !strings.HasPrefix(l, "@prefix") {
			kept = append(kept, l)
		}
	}
	return strings.TrimLeft(strings.Join(kept, "\n"), "\n")
}
