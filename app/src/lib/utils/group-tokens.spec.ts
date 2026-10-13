import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { wcagContrast } from './contrast';

const css = '\n' + readFileSync(resolve(__dirname, '../../app.css'), 'utf8');

/** Token values declared in the first `selector { ... }` block of app.css. */
function tokens(selector: ':root' | ':root.dark'): Record<string, string> {
	const start = css.indexOf(`\n${selector} {`) + 1;
	expect(start).toBeGreaterThan(0);
	const block = css.slice(start, css.indexOf('\n}', start));
	const out: Record<string, string> = {};
	for (const m of block.matchAll(/(--[\w-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim();
	return out;
}

describe.each<{ selector: ':root' | ':root.dark'; theme: string }>([
	{ selector: ':root', theme: 'light' },
	{ selector: ':root.dark', theme: 'dark' }
])('workbench group tokens ($theme theme)', ({ selector }) => {
	const t = tokens(selector);

	it('declares the group background and border tokens', () => {
		expect(t['--color-group-bg']).toMatch(/^#[0-9a-f]{6}$/i);
		expect(t['--color-group-border']).toMatch(/^#[0-9a-f]{6}$/i);
	});

	it('keeps body text on the group background at WCAG AA (4.5:1)', () => {
		expect(wcagContrast(t['--color-text'], t['--color-group-bg'])).toBeGreaterThanOrEqual(4.5);
	});

	it('is visibly different from the page and the enclosing region background', () => {
		expect(wcagContrast(t['--color-group-bg'], t['--color-bg'])).toBeGreaterThanOrEqual(1.1);
		expect(wcagContrast(t['--color-group-bg'], t['--color-bg-secondary'])).toBeGreaterThanOrEqual(1.1);
	});
});

describe.each<{ selector: ':root' | ':root.dark'; theme: string }>([
	{ selector: ':root', theme: 'light' },
	{ selector: ':root.dark', theme: 'dark' }
])('rule chip tokens ($theme theme)', ({ selector }) => {
	const t = tokens(selector);
	it.each(['green', 'amber', 'red', 'blue', 'grey'])('%s chip text meets AA contrast', (name) => {
		expect(wcagContrast(t[`--rule-${name}-chip-fg`], t[`--rule-${name}-chip-bg`])).toBeGreaterThanOrEqual(4.5);
	});
});
