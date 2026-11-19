import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import GuidesTile from './GuidesTile.svelte';
import { STAGE_GUIDES } from '#lib/services/pipeline-guides.js';

describe('GuidesTile (STORY-471)', () => {
	it('lists each guide once, however many stages share it', () => {
		render(GuidesTile, { props: { onOpenGuide: () => {} } });
		const unique = new Set(Object.values(STAGE_GUIDES).flat().map((g) => g.sectionId));
		expect(screen.getAllByRole('button')).toHaveLength(unique.size);
		expect(screen.getAllByRole('button', { name: /knowledge graph/i })).toHaveLength(1);
	});

	it('opens the guide section of the clicked entry', async () => {
		const onOpenGuide = vi.fn();
		render(GuidesTile, { props: { onOpenGuide } });
		await fireEvent.click(screen.getByRole('button', { name: /^Taxonomy/ }));
		expect(onOpenGuide).toHaveBeenCalledWith('guide-taxonomy');
	});

	it('renders no guide links without a handler (the read-only page)', () => {
		render(GuidesTile, { props: {} });
		expect(screen.queryAllByRole('button')).toHaveLength(0);
	});
});
