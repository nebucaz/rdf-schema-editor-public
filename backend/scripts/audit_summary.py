#!/usr/bin/env python3
"""Groups the backend's audit log by request shape, to see where a screen's SPARQL requests come from.

The backend (`go run ./cmd/server`) prints one JSON audit line per authenticated request (internal/handler/audit.go),
with the first 500 characters of a SPARQL query as `detail`. Capture stdout while loading ONE screen, then:

    go run ./cmd/server 2>&1 | tee /tmp/backend.log          # in one terminal; load the screen; Ctrl-C
    python3 scripts/audit_summary.py /tmp/backend.log        # or: ... < /tmp/backend.log

Tip: restart the backend (or note the line count) right before loading the screen so earlier traffic is not mixed in.
Lines that are not JSON audit entries (the chi request log, startup messages) are ignored.
"""
import collections
import json
import re
import sys

PREFIX_LINE = re.compile(r"^\s*PREFIX\s+\S+\s*<[^>]*>\s*$", re.MULTILINE)


def fingerprint(detail: str) -> str:
    """The query with prefix lines, graph/resource IRIs and string literals blurred, so repeats of the same
    query against different namespaces fall into one group."""
    text = PREFIX_LINE.sub("", detail)
    text = re.sub(r"<[^>]*>", "<iri>", text)
    text = re.sub(r'"(?:[^"\\]|\\.)*"', '"…"', text)
    text = re.sub(r"\s+", " ", text).strip()
    return text[:110]


def main() -> None:
    source = open(sys.argv[1], encoding="utf-8") if len(sys.argv) > 1 else sys.stdin
    by_shape: collections.Counter[str] = collections.Counter()
    by_path: collections.Counter[str] = collections.Counter()
    for line in source:
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            entry = json.loads(line)
        except json.JSONDecodeError:
            continue
        if "path" not in entry or "caller" not in entry:
            continue
        by_path[entry["path"]] += 1
        if entry["path"] in ("/sparql", "/sparql/update"):
            by_shape[f"{entry['path']}  {fingerprint(entry.get('detail', ''))}"] += 1

    print(f"{sum(by_path.values())} audited requests")
    for path, n in by_path.most_common():
        print(f"  {n:5d}  {path}")
    print(f"\n{sum(by_shape.values())} SPARQL requests in {len(by_shape)} distinct shapes (most frequent first):")
    for shape, n in by_shape.most_common(40):
        print(f"  {n:5d}  {shape}")


if __name__ == "__main__":
    main()
