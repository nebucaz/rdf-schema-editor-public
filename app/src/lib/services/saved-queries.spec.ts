import { describe, it, expect } from 'vitest';
import {
	toSavedQueryItem,
	filterCreatedByMe,
	saveDisabledReason,
	openSavedQuery
} from './saved-queries';
import { emptyQueryModel, serializeQueryModel } from './query-model';
import type { FetchedSavedQuery } from './sparql-connector';

const base: FetchedSavedQuery = {
	iri: 'http://ex.org/schema#SavedQueryA',
	label: 'A',
	sparqlText: 'SELECT * WHERE { ?s ?p ?o }',
	description: '',
	published: false
};

describe('toSavedQueryItem', () => {
	it('tags a query without a model as legacy SPARQL', () => {
		expect(toSavedQueryItem(base, null).kind).toBe('sparql');
	});

	it('tags a query with a model as builder', () => {
		const sq = { ...base, queryModel: serializeQueryModel(emptyQueryModel('http://ex.org#C')), createdBy: 'u1' };
		expect(toSavedQueryItem(sq, null).kind).toBe('builder');
	});

	it('shows the display name for the current user and the sub for others', () => {
		const mine = toSavedQueryItem({ ...base, createdBy: 'u1' }, { sub: 'u1', displayName: 'Una' });
		const other = toSavedQueryItem({ ...base, createdBy: 'u2' }, { sub: 'u1', displayName: 'Una' });
		expect(mine.creator).toBe('Una');
		expect(mine.mine).toBe(true);
		expect(other.creator).toBe('u2');
		expect(other.mine).toBe(false);
	});

	it('has no creator for legacy queries', () => {
		expect(toSavedQueryItem(base, null).creator).toBe('');
	});
});

describe('filterCreatedByMe', () => {
	it('keeps only own queries when on, everything when off', () => {
		const user = { sub: 'u1', displayName: 'Una' };
		const items = [
			toSavedQueryItem({ ...base, iri: 'a', createdBy: 'u1' }, user),
			toSavedQueryItem({ ...base, iri: 'b', createdBy: 'u2' }, user)
		];
		expect(filterCreatedByMe(items, true).map((i) => i.iri)).toEqual(['a']);
		expect(filterCreatedByMe(items, false)).toHaveLength(2);
	});
});

describe('saveDisabledReason', () => {
	it('explains a missing user identity', () => {
		expect(saveDisabledReason(null, true)).toMatch(/sign in|identity/i);
	});
	it('explains a model that cannot run', () => {
		expect(saveDisabledReason({ sub: 'u', displayName: 'U' }, false)).toMatch(/run/i);
	});
	it('is null when saving is allowed', () => {
		expect(saveDisabledReason({ sub: 'u', displayName: 'U' }, true)).toBeNull();
	});
});

describe('openSavedQuery', () => {
	it('restores a deep-equal model for a builder query', () => {
		const model = emptyQueryModel('http://ex.org#C', ['http://ex.org']);
		const item = toSavedQueryItem({ ...base, queryModel: serializeQueryModel(model), createdBy: 'u' }, null);
		const opened = openSavedQuery(item);
		expect(opened).toEqual({ kind: 'builder', model });
	});

	it('opens a legacy query as SPARQL text for the console', () => {
		expect(openSavedQuery(toSavedQueryItem(base, null))).toEqual({
			kind: 'sparql',
			text: base.sparqlText
		});
	});

	it('reports an unreadable stored model instead of throwing', () => {
		const item = toSavedQueryItem({ ...base, queryModel: '{nope', createdBy: 'u' }, null);
		expect(openSavedQuery(item).kind).toBe('error');
	});
});
