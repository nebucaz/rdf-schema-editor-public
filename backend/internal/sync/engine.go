package sync

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/nebucaz/rdf-schema-editor/backend/internal/graphdb"
)

// ErrSyncInProgress is returned by RunSync when a real (non-dry-run) sync for the same source is
// already running — Story 008's concurrency guard. Dry runs never trigger or observe this error.
var ErrSyncInProgress = errors.New("sync already in progress")

// SyncSummary is RunSync's return shape — identical in both dry-run and real-run mode (Story 007),
// and exactly what Story 008's `POST /sources/{source}/sync` route serializes as its JSON response.
type SyncSummary struct {
	Source        string            `json:"source"`
	DryRun        bool              `json:"dryRun"`
	SyncedPerKind map[string]int    `json:"syncedPerKind"`
	Mapping       map[string]string `json:"mapping"`
	SkippedKinds  []string          `json:"skippedKinds"`
}

// Engine runs one full sync pass (Story 007) for any registered Source, shared by Story 008's
// scheduler/manual-trigger route and Story 011's CLI (indirectly, via the HTTP route) — the single
// place that knows how to plan and execute a source's merge writes.
type Engine struct {
	gdb   *graphdb.Client
	vocab Vocabulary

	mu       sync.Mutex
	inFlight map[string]bool
}

// NewEngine builds an Engine. vocab must be derived from the same config.Config the rest of the
// service uses (see config.Config's SyncSourcePredicateIRI/etc. methods) so predicate IRIs agree
// with what the frontend reads.
func NewEngine(gdb *graphdb.Client, vocab Vocabulary) *Engine {
	return &Engine{gdb: gdb, vocab: vocab, inFlight: make(map[string]bool)}
}

// RunSync executes one full sync pass against source (Story 007's `RunSync(ctx, dryRun)`, source
// resolved by the caller via a Registry lookup so this package never hardcodes "backstage"). Dry-run
// and real-run share this exact planning path — every read (kind mapping, existing-synced-IRI
// lookups, bootstrap existence checks) runs in both modes; only the final `gdb.Update` call at the
// end is skipped when dryRun is true, per Story 007's "one code path" requirement.
func (e *Engine) RunSync(ctx context.Context, source Source, dryRun bool) (SyncSummary, error) {
	if !dryRun {
		e.mu.Lock()
		if e.inFlight[source.Name()] {
			e.mu.Unlock()
			return SyncSummary{}, ErrSyncInProgress
		}
		e.inFlight[source.Name()] = true
		e.mu.Unlock()
		defer func() {
			e.mu.Lock()
			delete(e.inFlight, source.Name())
			e.mu.Unlock()
		}()
	}

	mapping, err := FetchKindMapping(ctx, e.gdb, e.vocab.BackstageKindPredicateIRI)
	if err != nil {
		return SyncSummary{}, err
	}

	kinds, err := source.DiscoverKinds(ctx)
	if err != nil {
		return SyncSummary{}, err
	}

	sourceNS := deriveNamespaceGraphs(sourceNamespaceBaseIRI(e.vocab.DefaultNamespaceBaseIRI, source.Name()))
	defaultNS := deriveNamespaceGraphs(e.vocab.DefaultNamespaceBaseIRI)

	var ops []string
	bootstrapOps, systemOfWorkIRI, isMasterForIRI, err := e.planBootstrap(ctx, source, sourceNS, defaultNS)
	if err != nil {
		return SyncSummary{}, err
	}
	ops = append(ops, bootstrapOps...)

	activity := activityIRI(sourceNS, source.Name(), strconv.FormatInt(time.Now().UnixNano(), 10))
	activityUsed := false

	syncedPerKind := make(map[string]int)
	reportedMapping := make(map[string]string)
	var skippedKinds []string
	kindsWithInstances := make(map[string]string) // kind -> classIRI, for the isMasterFor pass below

	for _, kind := range kinds {
		classIRI, mapped := mapping[kind]
		if !mapped {
			skippedKinds = append(skippedKinds, kind)
			continue
		}
		reportedMapping[kind] = classIRI

		entities, err := source.FetchEntities(ctx, kind)
		if err != nil {
			return SyncSummary{}, err
		}

		existing, err := e.fetchExistingSyncedIRIs(ctx, sourceNS.instances, classIRI, source.Name())
		if err != nil {
			return SyncSummary{}, err
		}

		seen := make(map[string]bool, len(entities))
		for _, entity := range entities {
			iri := individualIRI(sourceNS, source.Name(), entity.UID)
			seen[iri] = true
			label := entity.Name
			if label == "" {
				label = entity.UID
			}
			ops = append(ops, mergeWriteOps(e.vocab, sourceNS.instances, iri, classIRI, label, source.Name(), activity)...)
			activityUsed = true
		}

		if len(entities) > 0 {
			syncedPerKind[kind] = len(entities)
			kindsWithInstances[kind] = classIRI
		}

		for _, existingIRI := range existing {
			if !seen[existingIRI] {
				ops = append(ops, staleOps(e.vocab, sourceNS.instances, existingIRI)...)
			}
		}
	}

	if activityUsed {
		ops = append(ops, activityTripleOps(sourceNS.instances, activity, time.Now().UTC().Format(time.RFC3339))...)
	}

	isMasterForOps, err := e.planIsMasterForAssertions(ctx, sourceNS, systemOfWorkIRI, isMasterForIRI, kindsWithInstances)
	if err != nil {
		return SyncSummary{}, err
	}
	ops = append(ops, isMasterForOps...)

	if !dryRun && len(ops) > 0 {
		if err := e.gdb.Update(ctx, strings.Join(ops, " ;\n")); err != nil {
			return SyncSummary{}, err
		}
	}

	return SyncSummary{
		Source:        source.Name(),
		DryRun:        dryRun,
		SyncedPerKind: syncedPerKind,
		Mapping:       reportedMapping,
		SkippedKinds:  skippedKinds,
	}, nil
}

// fetchExistingSyncedIRIs returns every individual of classIRI, in graph, already marked as synced
// from sourceName — the read Story 007's "created vs. updated" counting and Story 009's staleness
// diff both key off, shared so the two stories never compute this set differently.
func (e *Engine) fetchExistingSyncedIRIs(ctx context.Context, graph, classIRI, sourceName string) ([]string, error) {
	query := fmt.Sprintf(
		`SELECT ?i WHERE { GRAPH <%s> { ?i <%s> <%s> ; <%s> "%s" } }`,
		graph, rdfType, classIRI, e.vocab.SyncSourcePredicateIRI, escapeString(sourceName),
	)
	result, err := e.gdb.Select(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("fetch existing synced individuals: %w", err)
	}
	iris := make([]string, 0, len(result.Results.Bindings))
	for _, binding := range result.Results.Bindings {
		if i, ok := binding["i"]; ok {
			iris = append(iris, i.Value)
		}
	}
	return iris, nil
}

// planBootstrap computes (read-only, side-effect-free) the ops needed to idempotently bring up
// source's own Namespace declaration, its `SystemOfWork` class + singleton individual, and resolve
// (never eagerly mint outside the returned ops) the `isMasterFor` predicate IRI — identical in both
// dry-run and real-run mode, per Story 007's shared-planning-path requirement.
func (e *Engine) planBootstrap(
	ctx context.Context,
	source Source,
	sourceNS, defaultNS namespaceGraphs,
) (ops []string, systemOfWorkIRI string, isMasterForIRI string, err error) {
	sourceBaseIRI := sourceNS.instances

	nsExists, err := e.gdb.Ask(ctx, askTripleExistsIRI(defaultNS.schema, sourceBaseIRI, rdfType, e.vocab.NamespaceClassIRI))
	if err != nil {
		return nil, "", "", fmt.Errorf("check namespace bootstrap: %w", err)
	}
	if !nsExists {
		ops = append(ops, insertDataOp(defaultNS.schema, fmt.Sprintf(
			`<%s> <%s> <%s> . <%s> <%s> "%s" .`,
			sourceBaseIRI, rdfType, e.vocab.NamespaceClassIRI,
			sourceBaseIRI, e.vocab.NamespacePrefixIRI, escapeString(source.Name()),
		)))
	}

	classIRI := systemOfWorkClassIRI(sourceNS)
	classExists, err := e.gdb.Ask(ctx, askTripleExistsIRI(sourceNS.schema, classIRI, rdfType, owlClass))
	if err != nil {
		return nil, "", "", fmt.Errorf("check SystemOfWork class bootstrap: %w", err)
	}
	if !classExists {
		ops = append(ops, insertDataOp(sourceNS.schema, fmt.Sprintf(
			`<%s> <%s> <%s> . <%s> <%s> "SystemOfWork" .`,
			classIRI, rdfType, owlClass, classIRI, rdfsLabel,
		)))
	}

	systemOfWorkIRI = systemOfWorkIndividualIRI(sourceNS, source.Name())
	indivExists, err := e.gdb.Ask(ctx, askTripleExistsIRI(sourceNS.instances, systemOfWorkIRI, rdfType, classIRI))
	if err != nil {
		return nil, "", "", fmt.Errorf("check SystemOfWork individual bootstrap: %w", err)
	}
	if !indivExists {
		ops = append(ops, insertDataOp(sourceNS.instances, fmt.Sprintf(
			`<%s> <%s> <%s> . <%s> <%s> "%s" .`,
			systemOfWorkIRI, rdfType, classIRI,
			systemOfWorkIRI, rdfsLabel, escapeString(capitalize(source.Name())),
		)))
	}

	isMasterForIRI, err = e.findIsMasterForPredicate(ctx)
	if err != nil {
		return nil, "", "", err
	}
	if isMasterForIRI == "" {
		isMasterForIRI = genericIsMasterForPredicateIRI(sourceNS)
		ops = append(ops, insertDataOp(sourceNS.schema, fmt.Sprintf(
			`<%s> <%s> <%s> . <%s> <%s> "%s" .`,
			isMasterForIRI, rdfType, owlObjectProperty, isMasterForIRI, rdfsLabel, isMasterForLabel,
		)))
	}

	return ops, systemOfWorkIRI, isMasterForIRI, nil
}

// findIsMasterForPredicate mirrors `sparql-connector.ts`'s `findObjectPropertyByLabel`: an
// unrestricted cross-graph search for any existing `owl:ObjectProperty` labeled "isMasterFor",
// reused verbatim if a human already declared one — returns "" (not an error) when none exists yet.
func (e *Engine) findIsMasterForPredicate(ctx context.Context) (string, error) {
	query := fmt.Sprintf(
		`SELECT ?p WHERE { GRAPH ?g { ?p <%s> <%s> ; <%s> "%s" } } LIMIT 1`,
		rdfType, owlObjectProperty, rdfsLabel, isMasterForLabel,
	)
	result, err := e.gdb.Select(ctx, query)
	if err != nil {
		return "", fmt.Errorf("find isMasterFor predicate: %w", err)
	}
	if len(result.Results.Bindings) == 0 {
		return "", nil
	}
	return result.Results.Bindings[0]["p"].Value, nil
}

// planIsMasterForAssertions computes the (idempotent, ASK-guarded) `isMasterFor` assertion ops for
// every mapped kind that found ≥1 instance this run — never for a mapped kind with zero instances
// found this run (Story 007's AC), and never retracted once asserted (this app's non-destructive
// bias — see plan.md's staleness ADR).
func (e *Engine) planIsMasterForAssertions(
	ctx context.Context,
	sourceNS namespaceGraphs,
	systemOfWorkIRI, isMasterForIRI string,
	kindsWithInstances map[string]string,
) ([]string, error) {
	var ops []string
	for _, classIRI := range kindsWithInstances {
		exists, err := e.gdb.Ask(ctx, askTripleExistsIRI(sourceNS.instances, systemOfWorkIRI, isMasterForIRI, classIRI))
		if err != nil {
			return nil, fmt.Errorf("check isMasterFor assertion: %w", err)
		}
		if !exists {
			ops = append(ops, insertDataOp(sourceNS.instances, fmt.Sprintf(`<%s> <%s> <%s> .`, systemOfWorkIRI, isMasterForIRI, classIRI)))
		}
	}
	return ops, nil
}
