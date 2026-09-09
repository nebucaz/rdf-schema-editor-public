package main

import (
	"fmt"
	"io"
	"sort"
	"strings"
	"text/tabwriter"
)

// printDiscover writes `discover <source>`'s output: the unmapped-kinds list plus a one-line
// summary count (Story 011's AC) — exit code is always 0 regardless of content, this is a report.
func printDiscover(w io.Writer, resp discoverResponse) {
	kinds := append([]string(nil), resp.UnmappedKinds...)
	sort.Strings(kinds)

	if len(kinds) == 0 {
		fmt.Fprintln(w, "No unmapped kinds.")
		return
	}
	for _, kind := range kinds {
		fmt.Fprintln(w, kind)
	}
	fmt.Fprintf(w, "\n%d unmapped kinds\n", len(kinds))
}

// printSync writes `sync <source>`'s output: a formatted console table (never raw JSON, per Story
// 011's AC) showing each mapped kind's class + proposed individual count, and each unmapped kind
// with an explicit marker, followed by a one-line mapped/unmapped summary.
func printSync(w io.Writer, source string, resp syncResponse) {
	if resp.DryRun {
		fmt.Fprintln(w, "DRY RUN — no changes written. Use --apply to perform a real sync.")
	} else {
		fmt.Fprintln(w, "SYNC APPLIED — changes written to GraphDB.")
	}
	fmt.Fprintln(w)

	mappedKinds := make([]string, 0, len(resp.Mapping))
	for kind := range resp.Mapping {
		mappedKinds = append(mappedKinds, kind)
	}
	sort.Strings(mappedKinds)
	skippedKinds := append([]string(nil), resp.SkippedKinds...)
	sort.Strings(skippedKinds)
	fallbackNamespaceKinds := append([]string(nil), resp.FallbackNamespaceKinds...)
	sort.Strings(fallbackNamespaceKinds)
	usedFallback := make(map[string]bool, len(fallbackNamespaceKinds))
	for _, kind := range fallbackNamespaceKinds {
		usedFallback[kind] = true
	}

	tw := tabwriter.NewWriter(w, 0, 4, 3, ' ', 0)
	fmt.Fprintln(tw, "KIND\tMAPPED CLASS\tPROPOSED")
	for _, kind := range mappedKinds {
		count := resp.SyncedPerKind[kind]
		if usedFallback[kind] {
			fmt.Fprintf(tw, "%s\t%s\t%d individuals   (no Concept Namespace — used the class's own namespace)\n", kind, resp.Mapping[kind], count)
			continue
		}
		fmt.Fprintf(tw, "%s\t%s\t%d individuals\n", kind, resp.Mapping[kind], count)
	}
	for _, kind := range skippedKinds {
		fmt.Fprintf(tw, "%s\t-\t-   (unmapped: kind has no local class)\n", kind)
	}
	tw.Flush()
	fmt.Fprintln(w)

	if len(skippedKinds) == 0 {
		fmt.Fprintf(w, "%d kinds mapped, 0 kinds unmapped\n", len(mappedKinds))
	} else {
		fmt.Fprintf(w, "%d kinds mapped, %d kind(s) unmapped: %s\n", len(mappedKinds), len(skippedKinds), strings.Join(skippedKinds, ", "))
		fmt.Fprintf(w, "Run 'importctl discover %s' for details on unmapped kinds.\n", source)
	}
	if len(fallbackNamespaceKinds) > 0 {
		fmt.Fprintf(w, "%d kind(s) used their class's own namespace (no Concept Namespace configured): %s\n", len(fallbackNamespaceKinds), strings.Join(fallbackNamespaceKinds, ", "))
	}

	fmt.Fprintln(w)
	fmt.Fprintf(w, "Represents links: %d written, %d failed\n", resp.RepresentsSynced, len(resp.RepresentsFailures))
	for _, f := range resp.RepresentsFailures {
		fmt.Fprintf(w, "  - %s\n", f)
	}
	fmt.Fprintf(w, "Relation edges: %d written, %d skipped\n", resp.RelationsSynced, len(resp.SkippedRelations))
	for _, s := range resp.SkippedRelations {
		fmt.Fprintf(w, "  - %s\n", s)
	}
	if len(resp.MappingFailures) > 0 {
		fmt.Fprintf(w, "Field-mapping failures: %d\n", len(resp.MappingFailures))
		for _, f := range resp.MappingFailures {
			fmt.Fprintf(w, "  - %s\n", f)
		}
	}
}
