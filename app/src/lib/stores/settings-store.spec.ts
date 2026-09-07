import { describe, it, expect, vi, afterEach } from 'vitest';
import { sparqlConnector } from '$lib/services/sparql-connector';
import { settingsStore } from './settings-store.svelte';

describe('settingsStore — represents-predicate setting (Backstage-sync STORY-104)', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('refresh populates representsPredicateIri from fetchRepresentsPredicateIri', async () => {
		vi.spyOn(sparqlConnector, 'fetchAuthoritativeEntityClassIri').mockResolvedValue(null);
		vi.spyOn(sparqlConnector, 'fetchRepresentsPredicateIri').mockResolvedValue(
			'http://ld.example.org/schema#represents'
		);

		await settingsStore.refresh();

		expect(settingsStore.representsPredicateIri).toBe('http://ld.example.org/schema#represents');
	});

	it('refresh leaves representsPredicateIri null when unset', async () => {
		vi.spyOn(sparqlConnector, 'fetchAuthoritativeEntityClassIri').mockResolvedValue(null);
		vi.spyOn(sparqlConnector, 'fetchRepresentsPredicateIri').mockResolvedValue(null);

		await settingsStore.refresh();

		expect(settingsStore.representsPredicateIri).toBeNull();
	});

	it('refresh also still populates authoritativeEntityClassIri alongside representsPredicateIri', async () => {
		vi.spyOn(sparqlConnector, 'fetchAuthoritativeEntityClassIri').mockResolvedValue(
			'http://ld.example.org/schema#Application'
		);
		vi.spyOn(sparqlConnector, 'fetchRepresentsPredicateIri').mockResolvedValue(null);

		await settingsStore.refresh();

		expect(settingsStore.authoritativeEntityClassIri).toBe('http://ld.example.org/schema#Application');
		expect(settingsStore.representsPredicateIri).toBeNull();
	});
});
