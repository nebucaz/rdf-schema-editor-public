import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/svelte';
import TaggedTextList from './TaggedTextList.svelte';

const rows = (container: HTMLElement) => [...container.querySelectorAll('dd')].map((d) => d.textContent);

describe('TaggedTextList', () => {
	it('renders identical texts side by side without a duplicate-key error', () => {
		const { container } = render(TaggedTextList, { props: { texts: ['Same text (en)', 'Same text (en)'] } });
		expect(rows(container)).toEqual(['Same text (en)', 'Same text (en)']);
	});

	it('shows the placeholder only when empty', () => {
		expect(rows(render(TaggedTextList, { props: { texts: [], empty: '—' } }).container)).toEqual(['—']);
		expect(rows(render(TaggedTextList, { props: { texts: [] } }).container)).toEqual([]);
	});
});
