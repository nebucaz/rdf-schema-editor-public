/**
 * Links to a single validation finding (validation-issues-tracker STORY-390). Pure: the id comes from
 * the backend (`validation.FindingID`, 16 lowercase base32 characters) and is validated here before it
 * is read from a URL or put into one — never interpolated unchecked.
 */
import { absoluteAppUrl, appUrl } from '#lib/utils/urls.js';

const FINDING_ID = /^[a-z2-7]{16}$/;

export function isFindingId(value: string): boolean {
	return FINDING_ID.test(value);
}

export type FindingParam = { kind: 'none' } | { kind: 'malformed' } | { kind: 'ok'; id: string };

/** What `?finding=` on the validation page asks for. */
export function parseFindingParam(params: URLSearchParams): FindingParam {
	const value = params.get('finding');
	if (value === null || value === '') return { kind: 'none' };
	return isFindingId(value) ? { kind: 'ok', id: value } : { kind: 'malformed' };
}

/** `<base>/validation?finding=<id>` for in-app links. */
export function buildFindingPath(id: string): string {
	if (!isFindingId(id)) throw new Error('Not a finding id');
	return appUrl(`/validation?finding=${id}`);
}

/** The same link with the origin, for pasting into another system. */
export function buildFindingLink(origin: string, id: string): string {
	if (!isFindingId(id)) throw new Error('Not a finding id');
	return absoluteAppUrl(origin, `/validation?finding=${id}`);
}
