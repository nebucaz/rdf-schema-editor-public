import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { vi } from 'vitest';
import StageStrip from './StageStrip.svelte';
import type { NamespaceSummary } from '#lib/services/pipeline-summary.js';

const summary: NamespaceSummary = {
	namespaceBaseIri: 'http://example.org/a',
	prefix: 'a',
	stages: [
		{ stage: 'vocabulary', status: 'not-started', stats: [], warnings: 0, infos: 0 },
		{ stage: 'taxonomy', status: 'not-started', stats: [], warnings: 0, infos: 0 },
		{ stage: 'thesaurus', status: 'not-started', stats: [], warnings: 0, infos: 0 },
		{
			stage: 'ontology',
			status: 'in-progress',
			stats: [
				{ label: 'Classes', value: 12, href: '/' },
				{ label: 'Findings', value: 3, href: '/validation?tab=gates' }
			],
			warnings: 2,
			infos: 1
		},
		{
			stage: 'validation',
			status: 'in-progress',
			stats: [{ label: 'Passing', value: '4 of 5 run', href: '/questions#results' }],
			warnings: 0,
			infos: 0
		},
		{ stage: 'application', status: 'not-started', stats: [], warnings: 0, infos: 0 }
	]
};

const stageEl = (name: string) => screen.getByRole('heading', { name }).closest('li') as HTMLElement;

describe('StageStrip', () => {
	it('shows the six stages in order, naming the namespace', () => {
		render(StageStrip, { props: { summary } });
		expect(screen.getByRole('heading', { level: 3, name: 'a' })).toBeTruthy();
		const names = screen.getAllByRole('heading', { level: 4 }).map((h) => h.textContent?.trim());
		expect(names).toEqual(['Vocabulary', 'Taxonomy', 'Thesaurus', 'Ontology', 'Validation', 'Application']);
	});

	it('labels a stage without data "Not started" rather than hiding it', () => {
		render(StageStrip, { props: { summary } });
		expect(within(stageEl('Vocabulary')).getByText('Not started')).toBeTruthy();
		expect(within(stageEl('Application')).getByText('Not started')).toBeTruthy();
		expect(within(stageEl('Ontology')).queryByText('Not started')).toBeNull();
	});

	it('links every count to the screen that lists it', () => {
		render(StageStrip, { props: { summary } });
		const ontology = stageEl('Ontology');
		expect(within(ontology).getByRole('link', { name: /Classes/ }).getAttribute('href')).toBe('/');
		expect(within(ontology).getByRole('link', { name: /Findings/ }).getAttribute('href')).toBe('/validation?tab=gates');
		expect(within(stageEl('Validation')).getByRole('link', { name: /Passing/ }).textContent).toContain('4 of 5 run');
	});

	it('shows warnings and info counts of the stage', () => {
		render(StageStrip, { props: { summary } });
		expect(within(stageEl('Ontology')).getByText('2 warnings, 1 info')).toBeTruthy();
		expect(within(stageEl('Validation')).queryByText(/warning/)).toBeNull();
	});
});

describe('StageStrip pending stages', () => {
	it('shows Loading… for a pending stage instead of Not started', () => {
		const summary = {
			namespaceBaseIri: 'http://x/a',
			prefix: 'a',
			stages: (['vocabulary', 'taxonomy', 'thesaurus', 'ontology', 'validation', 'application'] as const).map((stage) => ({
				stage, status: 'not-started' as const, stats: [], warnings: 0, infos: 0
			}))
		};
		render(StageStrip, { props: { summary, pending: ['application'] } });
		expect(screen.getAllByTestId('stage-loading')).toHaveLength(1);
		expect(screen.getAllByText('Not started')).toHaveLength(5);
	});
});

describe('StageStrip: Open in guide (process-description STORY-346)', () => {
	it('shows no guide links when the page gives no handler (the read-only review page)', () => {
		render(StageStrip, { props: { summary } });
		expect(screen.queryByRole('button', { name: /guide/i })).toBeNull();
	});

	it('shows an Open in guide button in every stage and calls the handler with the stage guide', async () => {
		const onOpenGuide = vi.fn();
		render(StageStrip, { props: { summary, onOpenGuide } });
		expect(screen.getAllByRole('button', { name: /^Open in guide/ })).toHaveLength(6);
		await fireEvent.click(within(stageEl('Ontology')).getByRole('button', { name: 'Open in guide: Ontology' }));
		expect(onOpenGuide).toHaveBeenCalledWith('guide-ontology');
		await fireEvent.click(within(stageEl('Application')).getByRole('button', { name: 'Open in guide: Application' }));
		expect(onOpenGuide).toHaveBeenLastCalledWith('guide-knowledge-graph');
	});

	it('adds the metadata guide to the vocabulary box only', async () => {
		const onOpenGuide = vi.fn();
		render(StageStrip, { props: { summary, onOpenGuide } });
		const buttons = screen.getAllByRole('button', { name: 'Metadata guide' });
		expect(buttons).toHaveLength(1);
		expect(stageEl('Vocabulary').contains(buttons[0])).toBe(true);
		await fireEvent.click(buttons[0]);
		expect(onOpenGuide).toHaveBeenCalledWith('guide-metadata');
	});

	it('keeps the guide button available while a stage is still loading', () => {
		render(StageStrip, { props: { summary, onOpenGuide: vi.fn(), pending: ['ontology'] } });
		expect(within(stageEl('Ontology')).getByRole('button', { name: 'Open in guide: Ontology' })).toBeTruthy();
	});
});

