export interface SessionUser {
	sub: string;
	displayName: string;
	email: string;
	department: string;
	groups: string[];
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Maps the `user` member of `GET /api/me` to a `SessionUser`; absent profile fields become empty. */
export function toSessionUser(raw: Record<string, unknown> | null | undefined): SessionUser | null {
	if (!raw) return null;
	return {
		sub: str(raw.sub),
		displayName: str(raw.displayName),
		email: str(raw.email),
		department: str(raw.department),
		groups: Array.isArray(raw.groups) ? raw.groups.filter((g): g is string => typeof g === 'string') : []
	};
}
