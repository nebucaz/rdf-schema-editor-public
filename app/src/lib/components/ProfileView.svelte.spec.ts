import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import ProfileView from './ProfileView.svelte';

const full = { sub: 'u1', displayName: 'Ada Lovelace', email: 'ada@x.org', department: 'R&D', groups: ['admins', 'editors'] };

describe('ProfileView', () => {
	it('shows every field', () => {
		render(ProfileView, { props: { user: full } });
		for (const text of ['Ada Lovelace', 'ada@x.org', 'R&D', 'admins', 'editors']) {
			expect(screen.getByText(text)).toBeTruthy();
		}
		expect(screen.getAllByRole('listitem')).toHaveLength(2);
	});

	it('shows "—" for empty values and an empty group list', () => {
		render(ProfileView, { props: { user: { ...full, displayName: '', email: '', department: '', groups: [] } } });
		expect(screen.getAllByText('—')).toHaveLength(4);
		expect(screen.queryAllByRole('listitem')).toHaveLength(0);
	});
});
