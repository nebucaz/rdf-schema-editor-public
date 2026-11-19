import { describe, expect, it } from 'vitest';
import { load } from './+page';

const run = (search: string) => load({ url: new URL(`http://localhost/validation${search}`) } as never);

describe('/validation', () => {
	it('sends the old Gate report tab to the Model checks tab', () => {
		let thrown: unknown;
		try {
			run('?tab=gates');
		} catch (e) {
			thrown = e;
		}
		expect(thrown).toMatchObject({ status: 307, location: '/pipeline?tab=checks' });
	});

	it('stays on the page for every other query', () => {
		expect(() => run('')).not.toThrow();
		expect(() => run('?tab=shacl&finding=abc')).not.toThrow();
	});
});
