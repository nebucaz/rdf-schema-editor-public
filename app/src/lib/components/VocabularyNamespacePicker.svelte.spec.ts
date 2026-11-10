import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import VocabularyNamespacePicker from './VocabularyNamespacePicker.svelte';

const ns = (baseIri: string, prefix: string) => ({
	baseIri, prefix, description: null, color: null, publisher: null, license: null,
	locked: false, defaultHidden: false, listedInFilter: true, vocabulary: false, pipeline: false
});

describe('VocabularyNamespacePicker (STORY-323 empty state)', () => {
	it('explains that no vocabulary namespace is marked yet', () => {
		render(VocabularyNamespacePicker, { props: { namespaces: [ns('http://e/core', 'core')], onMark: async () => {} } });
		expect(screen.getByText(/No vocabulary namespace yet/)).toBeTruthy();
	});

	it('marks the chosen namespace', async () => {
		const onMark = vi.fn(async () => {});
		render(VocabularyNamespacePicker, {
			props: { namespaces: [ns('http://e/core', 'core'), ns('http://e/gov', 'gov')], onMark }
		});
		await fireEvent.change(screen.getByLabelText('Namespace'), { target: { value: 'http://e/gov' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Use as vocabulary namespace' }));
		expect(onMark).toHaveBeenCalledWith('http://e/gov');
	});

	it('disables the action while there are no namespaces to choose from', () => {
		render(VocabularyNamespacePicker, { props: { namespaces: [], onMark: async () => {} } });
		expect((screen.getByRole('button', { name: 'Use as vocabulary namespace' }) as HTMLButtonElement).disabled).toBe(true);
	});

	it('shows the error from the connector', async () => {
		const onMark = vi.fn(async () => {
			throw new Error('Another namespace is already the vocabulary namespace');
		});
		render(VocabularyNamespacePicker, { props: { namespaces: [ns('http://e/core', 'core')], onMark } });
		await fireEvent.click(screen.getByRole('button', { name: 'Use as vocabulary namespace' }));
		expect(await screen.findByText(/already the vocabulary namespace/)).toBeTruthy();
	});
});
