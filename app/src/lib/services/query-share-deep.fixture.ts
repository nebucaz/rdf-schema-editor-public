import { applyBrowserSelection, type BrowserPick } from './query-object-browser';
import { startQueryFromClass } from './query-model-edit';

// Realistic IRIs: a Backstage-synced catalog namespace with long local names.
const NS = 'https://catalog.example-company.com/ontology/platform';
const o = (n: string) => `${NS}#${n}`;
const CHAIN = ['ownedByTeam', 'memberOfDepartment', 'reportsToDivision', 'locatedInRegion', 'managedByProgram', 'fundedByBudget'];
const CLASSES = ['Component', 'Team', 'Department', 'Division', 'Region', 'Program', 'Budget'];
const steps = CHAIN.map((rel, i) => ({
	relationshipIri: o(rel),
	direction: 'forward' as const,
	targetClassIri: o(CLASSES[i + 1])
}));

/** `n` tick(s) on every level of a 6-level path, ~10 property columns in total. */
export function deepModel(columns: number) {
	const picks: BrowserPick[] = Array.from({ length: columns }, (_, i) => ({
		path: { anchor: { hopId: null }, steps: steps.slice(0, 1 + (i % 6)) },
		source: { propertyIri: o(`${CLASSES[1 + (i % 6)].toLowerCase()}DisplayName${i}`) },
		header: `${CLASSES[1 + (i % 6)]} display name ${i}`
	}));
	const r = applyBrowserSelection(startQueryFromClass(o('Component'), [`${NS}`]), picks);
	if (!r.ok) throw new Error('fixture rejected');
	return r.model;
}
