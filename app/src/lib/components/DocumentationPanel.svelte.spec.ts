import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import DocumentationPanel from './DocumentationPanel.svelte';
import { documentationStore } from '#lib/stores/documentation-store.js';

describe('DocumentationPanel cross-section links', () => {
	it('opens the linked section instead of navigating', async () => {
		documentationStore.setLastSectionId('pipeline-quick-start');
		render(DocumentationPanel, { props: { onClose: () => {} } });
		const link = (await screen.findAllByRole('link', { name: 'Competency Questions' }))[0];
		await fireEvent.click(link);
		expect(await screen.findByRole('heading', { level: 1, name: 'Competency Questions' })).toBeTruthy();
	});
});

describe('DocumentationPanel categories', () => {
	it('lists the Ontology Pipeline category with its quick start', async () => {
		render(DocumentationPanel, { props: { onClose: () => {} } });
		expect(await screen.findByText('Ontology Pipeline')).toBeTruthy();
		expect(screen.getAllByRole('button', { name: /Ontology Pipeline: Quick Start/ }).length).toBeGreaterThan(0);
	});
});

describe('DocumentationPanel opened on a guide (process-description STORY-346)', () => {
	it('opens on the section the Pipeline page asked for', async () => {
		documentationStore.setLastSectionId('guide-ontology');
		render(DocumentationPanel, { props: { onClose: () => {} } });
		expect(await screen.findByRole('heading', { level: 1, name: 'Stage Guide: Ontology' })).toBeTruthy();
	});
});
