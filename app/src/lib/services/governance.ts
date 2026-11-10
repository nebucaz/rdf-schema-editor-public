/**
 * Named ownership and version of the core namespace (ontology-pipeline STORY-331; book pp. 236, 307).
 * Recorded, not enforced: the app has no permissions, so a steward is a name, not a role.
 */
export const MATURITY_LEVELS = ['poc', 'pilot', 'production'] as const;
export type MaturityLevel = (typeof MATURITY_LEVELS)[number];

export interface Governance {
	steward: string;
	authority: string;
	maturity: MaturityLevel | '';
	/** Semantic version, stored as `owl:versionInfo`. */
	version: string;
}

export const EMPTY_GOVERNANCE: Governance = { steward: '', authority: '', maturity: '', version: '' };

const SEMVER = /^\d+\.\d+\.\d+$/;

export function validateGovernance(g: Governance): string[] {
	const errors: string[] = [];
	if (g.maturity && !(MATURITY_LEVELS as readonly string[]).includes(g.maturity)) errors.push('Maturity must be POC, pilot or production');
	if (g.version.trim() && !SEMVER.test(g.version.trim())) errors.push('The version must have three numbers, like 1.0.0');
	return errors;
}

/** What a core namespace still has to name. Maturity is optional. */
export function missingGovernance(g: Governance): ('steward' | 'authority' | 'version')[] {
	const missing: ('steward' | 'authority' | 'version')[] = [];
	if (!g.steward.trim()) missing.push('steward');
	if (!g.authority.trim()) missing.push('authority');
	if (!g.version.trim()) missing.push('version');
	return missing;
}
