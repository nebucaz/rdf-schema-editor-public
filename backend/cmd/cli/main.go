package main

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/nebucaz/rdf-schema-editor/backend/internal/jwtauth"
)

const defaultBackendURL = "http://localhost:8090"

// defaultTokenTTL is mint-token's default `--ttl` (spec/threat-mitigation/plan.md's ADR on
// static-JWT expiry: a long, explicit exp rather than special-casing verification).
const defaultTokenTTL = 365 * 24 * time.Hour

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
	case "mint-token":
		return runMintToken(rest, stdout, stderr)
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
	fmt.Fprintln(w, "  importctl discover <source> [--backend-url URL] [--token TOKEN]")
	fmt.Fprintln(w, "  importctl sync <source> [--apply] [--backend-url URL] [--token TOKEN]")
	fmt.Fprintln(w, "  importctl mint-token --sub <value> [--ttl DURATION]")
	fmt.Fprintln(w)
	fmt.Fprintln(w, "  --backend-url URL   Go backend base URL (default: BACKEND_URL env var, or "+defaultBackendURL+")")
	fmt.Fprintln(w, "  --apply             perform a real sync (default: dry-run, no GraphDB writes)")
	fmt.Fprintln(w, "  --token TOKEN       signed JWT sent as Authorization: Bearer <token> (default: IMPORTCTL_AUTH_TOKEN env var)")
	fmt.Fprintln(w, "  --sub value         mint-token: JWT subject, e.g. frontend-app or importctl (required)")
	fmt.Fprintln(w, "  --ttl DURATION      mint-token: token lifetime, a Go duration string (default: 8760h / 1 year)")
	fmt.Fprintln(w)
	fmt.Fprintln(w, "Example: importctl sync backstage")
	fmt.Fprintln(w, "Example: AUTH_JWT_SECRET=... importctl mint-token --sub frontend-app")
}

// parsedArgs separates the flags this CLI supports (--backend-url, --apply, --token) from
// positional arguments, tolerant of flags appearing before or after the positional source
// argument — Go's stdlib `flag` package stops parsing at the first non-flag argument, which would
// break `sync backstage --apply`, so this is a small hand-rolled parser instead.
func parseArgs(args []string) (positional []string, backendURL string, apply bool, token string, err error) {
	backendURL = os.Getenv("BACKEND_URL")
	if backendURL == "" {
		backendURL = defaultBackendURL
	}
	token = os.Getenv("IMPORTCTL_AUTH_TOKEN")

	for i := 0; i < len(args); i++ {
		a := args[i]
		switch {
		case a == "--apply":
			apply = true
		case a == "--backend-url":
			if i+1 >= len(args) {
				return nil, "", false, "", fmt.Errorf("--backend-url requires a value")
			}
			i++
			backendURL = args[i]
		case strings.HasPrefix(a, "--backend-url="):
			backendURL = strings.TrimPrefix(a, "--backend-url=")
		case a == "--token":
			if i+1 >= len(args) {
				return nil, "", false, "", fmt.Errorf("--token requires a value")
			}
			i++
			token = args[i]
		case strings.HasPrefix(a, "--token="):
			token = strings.TrimPrefix(a, "--token=")
		default:
			positional = append(positional, a)
		}
	}
	return positional, backendURL, apply, token, nil
}

func runDiscover(args []string, stdout, stderr io.Writer) int {
	positional, backendURL, _, token, err := parseArgs(args)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	if len(positional) != 1 {
		fmt.Fprintln(stderr, "usage: importctl discover <source> [--backend-url URL] [--token TOKEN]")
		return 1
	}

	client := &apiClient{baseURL: backendURL, token: token, http: http.DefaultClient}
	resp, err := client.discover(context.Background(), positional[0])
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	printDiscover(stdout, resp)
	return 0
}

func runSync(args []string, stdout, stderr io.Writer) int {
	positional, backendURL, apply, token, err := parseArgs(args)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	if len(positional) != 1 {
		fmt.Fprintln(stderr, "usage: importctl sync <source> [--apply] [--backend-url URL] [--token TOKEN]")
		return 1
	}
	source := positional[0]

	client := &apiClient{baseURL: backendURL, token: token, http: http.DefaultClient}
	resp, err := client.sync(context.Background(), source, !apply)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	printSync(stdout, source, resp)
	return 0
}

// runMintToken implements `importctl mint-token --sub <value> [--ttl DURATION]` (STORY-003): signs
// a JWT against AUTH_JWT_SECRET (read from env — this subcommand talks to no backend, unlike
// discover/sync) and prints it to stdout. Used to generate the frontend's and importctl's own
// static, long-lived tokens.
func runMintToken(args []string, stdout, stderr io.Writer) int {
	sub, ttl, err := parseMintTokenArgs(args)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}

	secret := os.Getenv("AUTH_JWT_SECRET")
	if secret == "" {
		fmt.Fprintln(stderr, "AUTH_JWT_SECRET must be set to mint a token")
		return 1
	}

	token, err := jwtauth.Mint(secret, sub, ttl)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}

	fmt.Fprintln(stdout, token)
	return 0
}

// parseMintTokenArgs parses mint-token's flags: --sub (required) and --ttl (optional, defaults to
// defaultTokenTTL), each accepted as either `--flag value` or `--flag=value`.
func parseMintTokenArgs(args []string) (sub string, ttl time.Duration, err error) {
	ttl = defaultTokenTTL

	for i := 0; i < len(args); i++ {
		a := args[i]
		switch {
		case a == "--sub":
			if i+1 >= len(args) {
				return "", 0, fmt.Errorf("--sub requires a value")
			}
			i++
			sub = args[i]
		case strings.HasPrefix(a, "--sub="):
			sub = strings.TrimPrefix(a, "--sub=")
		case a == "--ttl":
			if i+1 >= len(args) {
				return "", 0, fmt.Errorf("--ttl requires a value")
			}
			i++
			if ttl, err = time.ParseDuration(args[i]); err != nil {
				return "", 0, fmt.Errorf("--ttl: %w", err)
			}
		case strings.HasPrefix(a, "--ttl="):
			if ttl, err = time.ParseDuration(strings.TrimPrefix(a, "--ttl=")); err != nil {
				return "", 0, fmt.Errorf("--ttl: %w", err)
			}
		default:
			return "", 0, fmt.Errorf("unknown argument: %s", a)
		}
	}

	if sub == "" {
		return "", 0, fmt.Errorf("--sub is required")
	}
	return sub, ttl, nil
}
