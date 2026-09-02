package main

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
)

const defaultBackendURL = "http://localhost:8090"

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}

func run(args []string, stdout, stderr io.Writer) int {
	if len(args) < 1 {
		printUsage(stderr)
		return 1
	}

	subcommand, rest := args[0], args[1:]
	switch subcommand {
	case "discover":
		return runDiscover(rest, stdout, stderr)
	case "sync":
		return runSync(rest, stdout, stderr)
	case "-h", "--help", "help":
		printUsage(stdout)
		return 0
	default:
		fmt.Fprintf(stderr, "unknown subcommand: %s\n\n", subcommand)
		printUsage(stderr)
		return 1
	}
}

func printUsage(w io.Writer) {
	fmt.Fprintln(w, "importctl — trigger an ingestion source's discovery/sync against a running rdf-schema-editor backend")
	fmt.Fprintln(w)
	fmt.Fprintln(w, "Usage:")
	fmt.Fprintln(w, "  importctl discover <source> [--backend-url URL]")
	fmt.Fprintln(w, "  importctl sync <source> [--apply] [--backend-url URL]")
	fmt.Fprintln(w)
	fmt.Fprintln(w, "  --backend-url URL   Go backend base URL (default: BACKEND_URL env var, or "+defaultBackendURL+")")
	fmt.Fprintln(w, "  --apply             perform a real sync (default: dry-run, no GraphDB writes)")
	fmt.Fprintln(w)
	fmt.Fprintln(w, "Example: importctl sync backstage")
}

// parsedArgs separates the two flags this CLI supports (--backend-url, --apply) from positional
// arguments, tolerant of flags appearing before or after the positional source argument — Go's
// stdlib `flag` package stops parsing at the first non-flag argument, which would break
// `sync backstage --apply`, so this is a small hand-rolled parser instead.
func parseArgs(args []string) (positional []string, backendURL string, apply bool, err error) {
	backendURL = os.Getenv("BACKEND_URL")
	if backendURL == "" {
		backendURL = defaultBackendURL
	}

	for i := 0; i < len(args); i++ {
		a := args[i]
		switch {
		case a == "--apply":
			apply = true
		case a == "--backend-url":
			if i+1 >= len(args) {
				return nil, "", false, fmt.Errorf("--backend-url requires a value")
			}
			i++
			backendURL = args[i]
		case strings.HasPrefix(a, "--backend-url="):
			backendURL = strings.TrimPrefix(a, "--backend-url=")
		default:
			positional = append(positional, a)
		}
	}
	return positional, backendURL, apply, nil
}

func runDiscover(args []string, stdout, stderr io.Writer) int {
	positional, backendURL, _, err := parseArgs(args)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	if len(positional) != 1 {
		fmt.Fprintln(stderr, "usage: importctl discover <source> [--backend-url URL]")
		return 1
	}

	client := &apiClient{baseURL: backendURL, http: http.DefaultClient}
	resp, err := client.discover(context.Background(), positional[0])
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	printDiscover(stdout, resp)
	return 0
}

func runSync(args []string, stdout, stderr io.Writer) int {
	positional, backendURL, apply, err := parseArgs(args)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	if len(positional) != 1 {
		fmt.Fprintln(stderr, "usage: importctl sync <source> [--apply] [--backend-url URL]")
		return 1
	}
	source := positional[0]

	client := &apiClient{baseURL: backendURL, http: http.DefaultClient}
	resp, err := client.sync(context.Background(), source, !apply)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	printSync(stdout, source, resp)
	return 0
}
