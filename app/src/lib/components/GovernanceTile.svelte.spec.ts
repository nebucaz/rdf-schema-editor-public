import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import GovernanceTile from './GovernanceTile.svelte';

describe('GovernanceTile (STORY-473)', () => {
	it('shows the governance of the core namespace and the open requests, and links to Governance', () => {
		render(GovernanceTile, { props: { status: 'ready', governance: { steward: 'Sam', authority: '', maturity: 'pilot', version: '1.2.0' }, openRequests: 3 } });
		expect(screen.getByTestId('governance-steward')).toHaveTextContent('Sam');
		expect(screen.getByTestId('governance-authority')).toHaveTextContent('Not set');
		expect(screen.getByTestId('governance-maturity')).toHaveTextContent('Pilot');
		expect(screen.getByTestId('governance-version')).toHaveTextContent('1.2.0');
		expect(screen.getByTestId('governance-requests')).toHaveTextContent('3');
		expect(screen.getByRole('link', { name: 'Governance' }).getAttribute('href')).toBe('/governance');
	});

	it('says Unknown when only the request count failed', () => {
		render(GovernanceTile, { props: { status: 'ready', governance: { steward: 'Sam', authority: 'a', maturity: '', version: '1.0.0' }, openRequests: null } });
		expect(screen.getByTestId('governance-requests')).toHaveTextContent('Unknown');
		expect(screen.getByTestId('governance-maturity')).toHaveTextContent('Not set');
	});

	it('shows a loading state, a local notice on failure and a hint without a core namespace', () => {
		const { unmount } = render(GovernanceTile, { props: { status: 'loading' } });
		expect(screen.getByTestId('governance-loading')).toBeInTheDocument();
		unmount();
		const failed = render(GovernanceTile, { props: { status: 'error', error: 'down' } });
		expect(screen.getByTestId('governance-error')).toHaveTextContent('Governance could not be read: down.');
		failed.unmount();
		render(GovernanceTile, { props: { status: 'ready', governance: null } });
		expect(screen.getByTestId('governance-none')).toBeInTheDocument();
	});
});
