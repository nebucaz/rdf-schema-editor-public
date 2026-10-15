import { sparqlConnector, type SparqlSelectResults } from '$lib/services/sparql-connector';
import type { BuilderSchema } from '$lib/services/query-builder-schema';
import { compileCountQuery, compileQuery, type CompiledQuery } from '$lib/services/query-compiler';
import type { QueryModel } from '$lib/services/query-model';
import { describeRelativeFilters, type ResolvedRelativeFilter } from '$lib/services/query-relative-time';
import {
	DEFAULT_PAGE_SIZE,
	buildResultRows,
	clampPageSize,
	pageInfo,
	readableQueryError,
	type PageInfo,
	type ResultRows
} from '$lib/services/query-results';

/** The slice of `SparqlConnector` this store needs — keeps it testable without GraphDB. */
export interface QueryExecutor {
	selectQuery(query: string): Promise<SparqlSelectResults>;
}

/**
 * Runs a `QueryModel` against GraphDB one server-side page at a time (STORY-192). `table`/`total`
 * keep the last *successful* result, so a failed or in-flight run never blanks the previous table.
 * Overlapping runs are ordered by a sequence number: only the newest one may publish.
 */
export class QueryRunStore {
	table = $state<ResultRows | null>(null);
	compiled = $state<CompiledQuery | null>(null);
	/** The count query's result — what the query matches, before any row limit. */
	total = $state<number | null>(null);
	/** `QueryModel.limit` of the last successful run, so paging stops at the cap. */
	rowLimit = $state<number | undefined>(undefined);
	offset = $state(0);
	pageSize = $state(DEFAULT_PAGE_SIZE);
	running = $state(false);
	error = $state<string | null>(null);
	/** The clock reading the last successful run was compiled against ("as of"). */
	asOf = $state<Date | null>(null);
	/** The bounds that run's relative-time filters resolved to; empty when the model has none. */
	timeWindow = $state<ResolvedRelativeFilter[]>([]);

	private seq = 0;
	private readonly executor: QueryExecutor;
	private readonly clock: () => Date;

	/** `clock` is injectable so relative time is testable; the compiler itself never reads time. */
	constructor(executor: QueryExecutor = sparqlConnector, clock: () => Date = () => new Date()) {
		this.executor = executor;
		this.clock = clock;
	}

	get info(): PageInfo | null {
		return this.total === null ? null : pageInfo(this.total, this.offset, this.pageSize, this.rowLimit);
	}

	/** Fresh run for a (changed) model: back to page 1, total re-counted. */
	run(model: QueryModel, schema: BuilderSchema): Promise<void> {
		return this.execute(model, schema, 0, true);
	}

	next(model: QueryModel, schema: BuilderSchema): Promise<void> {
		const info = this.info;
		return info?.hasNext ? this.execute(model, schema, info.nextOffset, false) : Promise.resolve();
	}

	previous(model: QueryModel, schema: BuilderSchema): Promise<void> {
		const info = this.info;
		return info?.hasPrev ? this.execute(model, schema, info.prevOffset, false) : Promise.resolve();
	}

	setPageSize(size: number, model: QueryModel, schema: BuilderSchema): Promise<void> {
		this.pageSize = clampPageSize(size);
		return this.execute(model, schema, 0, false);
	}

	/** Re-queries the current page, e.g. after a header sort (the order changes, the total doesn't). */
	rerun(model: QueryModel, schema: BuilderSchema): Promise<void> {
		return this.execute(model, schema, 0, false);
	}

	private async execute(
		model: QueryModel,
		schema: BuilderSchema,
		offset: number,
		withCount: boolean
	): Promise<void> {
		const mine = ++this.seq;
		this.running = true;
		this.error = null;
		try {
			// One reading per run, so the page and its count query describe the same window.
			const now = this.clock();
			const compiled = compileQuery(model, schema, { limit: this.pageSize, offset }, { now });
			const needCount = withCount || this.total === null;
			const [page, count] = await Promise.all([
				this.executor.selectQuery(compiled.sparql),
				needCount
					? this.executor.selectQuery(compileCountQuery(model, schema, { now }).sparql)
					: Promise.resolve(null)
			]);
			if (mine !== this.seq) return;
			this.compiled = compiled;
			this.table = buildResultRows(model, compiled, page);
			this.offset = offset;
			this.rowLimit = model.limit;
			this.asOf = now;
			this.timeWindow = describeRelativeFilters(model, schema, now);
			if (count) this.total = Number(count.results.bindings[0]?.total?.value ?? 0);
		} catch (e) {
			if (mine === this.seq) this.error = readableQueryError(e);
		} finally {
			if (mine === this.seq) this.running = false;
		}
	}
}

export const queryRunStore = new QueryRunStore();
