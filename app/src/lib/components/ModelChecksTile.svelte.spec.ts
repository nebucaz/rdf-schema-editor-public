import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/svelte';
import ModelChecksTile from './ModelChecksTile.svelte';
import { checksTileModel } from '#lib/services/ontology-dashboard-model.js';
import type { GateFinding } from '#lib/services/gates/types.js';

const f = (stage: GateFinding['stage'], severity: GateFinding['severity'], n: number): GateFinding => ({ gateId: 'g', stage, severity, elementIri: `urn:e${n}`, message: `m${n}` });

describe('ModelChecksTile (STORY-472)', () => {
	it('shows the total and links each severity and stage to the filtered list', () => {
		render(ModelChecksTile, { props: { model: checksTileModel([f('ontology', 'warning', 1), f('ontology', 'info', 2), f('vocabulary', 'warning', 3)]) } });
		expect(screen.getByTestId('checks-total')).toHaveTextContent('Total3 problems');
		expect(screen.getByTestId('checks-total').querySelector('a')?.getAttribute('href')).toBe('/pipeline?tab=checks');
		expect(within(screen.getByLabelText('Problems by severity')).getByRole('link', { name: /Warnings\s*2/ }).getAttribute('href')).toBe('/pipeline?tab=checks&severity=warning');
		const stages = within(screen.getByLabelText('Problems by stage'));
		expect(stages.getAllByRole('link').map((a) => a.textContent?.trim())).toEqual(['Vocabulary1', 'Ontology2']);
		expect(stages.getByRole('link', { name: /Ontology\s*2/ }).getAttribute('href')).toBe('/pipeline?tab=checks&stage=ontology');
	});

	it('puts the total after the severity and stage lists, as a summary', () => {
		render(ModelChecksTile, { props: { model: checksTileModel([f('ontology', 'warning', 1)]) } });
		const stages = screen.getByLabelText('Problems by stage');
		const total = screen.getByTestId('checks-total');
		expect(stages.compareDocumentPosition(total) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
		expect(screen.getByTestId('checks-total')).toHaveTextContent('1 problem');
	});

	it('says so when there are no problems', () => {
		render(ModelChecksTile, { props: { model: checksTileModel([]) } });
		expect(screen.getByTestId('checks-none')).toBeInTheDocument();
		expect(screen.queryByRole('link')).toBeNull();
	});
});
