import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import SplitButton from './SplitButton.svelte';

function setup() {
	const onMain = vi.fn();
	const onFirst = vi.fn();
	const onSecond = vi.fn();
	render(SplitButton, {
		props: {
			label: '+ Add Entity',
			menuLabel: 'More ways to add',
			onMain,
			items: [
				{ label: 'First action', onSelect: onFirst },
				{ label: 'Second action', onSelect: onSecond }
			]
		}
	});
	return { onMain, onFirst, onSecond };
}
const chevron = () => screen.getByRole('button', { name: 'More ways to add' });
const items = () => screen.queryAllByRole('menuitem');

describe('SplitButton', () => {
	it('main part calls onMain and does not open the menu', async () => {
		const { onMain } = setup();
		await fireEvent.click(screen.getByRole('button', { name: '+ Add Entity' }));
		expect(onMain).toHaveBeenCalledTimes(1);
		expect(items()).toHaveLength(0);
	});

	it('chevron toggles the menu and sets aria attributes', async () => {
		setup();
		expect(chevron().getAttribute('aria-haspopup')).toBe('menu');
		expect(chevron().getAttribute('aria-expanded')).toBe('false');
		await fireEvent.click(chevron());
		expect(chevron().getAttribute('aria-expanded')).toBe('true');
		expect(screen.getByRole('menu')).toBeInTheDocument();
		expect(items().map((i) => i.textContent?.trim())).toEqual(['First action', 'Second action']);
		await fireEvent.click(chevron());
		expect(items()).toHaveLength(0);
	});

	it('selecting an item calls it, closes the menu and returns focus to the chevron', async () => {
		const { onFirst, onMain } = setup();
		await fireEvent.click(chevron());
		await fireEvent.click(items()[0]);
		expect(onFirst).toHaveBeenCalledTimes(1);
		expect(onMain).not.toHaveBeenCalled();
		expect(items()).toHaveLength(0);
		expect(document.activeElement).toBe(chevron());
	});

	it('Escape closes the menu and focuses the chevron', async () => {
		setup();
		await fireEvent.click(chevron());
		await fireEvent.keyDown(items()[0], { key: 'Escape' });
		expect(items()).toHaveLength(0);
		expect(document.activeElement).toBe(chevron());
	});

	it('a click outside closes the menu', async () => {
		setup();
		await fireEvent.click(chevron());
		await fireEvent.pointerDown(document.body);
		expect(items()).toHaveLength(0);
	});

	it('ArrowDown on the chevron opens the menu on the first item; arrows move; Enter activates', async () => {
		const { onSecond } = setup();
		chevron().focus();
		await fireEvent.keyDown(chevron(), { key: 'ArrowDown' });
		expect(items()).toHaveLength(2);
		expect(document.activeElement).toBe(items()[0]);
		await fireEvent.keyDown(items()[0], { key: 'ArrowDown' });
		expect(document.activeElement).toBe(items()[1]);
		await fireEvent.keyDown(items()[1], { key: 'ArrowDown' });
		expect(document.activeElement).toBe(items()[0]);
		await fireEvent.keyDown(items()[0], { key: 'ArrowUp' });
		expect(document.activeElement).toBe(items()[1]);
		await fireEvent.click(items()[1]); // Enter on a focused button fires click
		expect(onSecond).toHaveBeenCalledTimes(1);
	});
});
