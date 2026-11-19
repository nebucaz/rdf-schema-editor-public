import { buildIdentitySearchUrl } from '#lib/utils/identity-search-url.js';
import { appUrl } from '#lib/utils/urls.js';
import type { FetchedSchema } from '../sparql-connector';
import type { GateFinding } from './types';

/** Where a finding's element can be looked at: a concept in the Vocabulary area, an individual in the identity browser, a class (or the class a
 *  shape targets) focused on the canvas. `null` when the element is neither. */
export function gateFindingLink(finding: GateFinding, schema: FetchedSchema): string | null {
	const iri = finding.elementIri;
	const conceptLink = appUrl(`/vocabulary?concept=${encodeURIComponent(iri)}`);
	if (finding.stage === 'vocabulary') return conceptLink;
	if (finding.gateId === 'question-review-overdue' || finding.gateId === 'failing-question') return appUrl('/questions');
	if (finding.stage === 'governance') return appUrl('/governance');
	// Taxonomy and thesaurus findings are about a concept, except the ones about a class (link consistency).
	if ((finding.stage === 'taxonomy' || finding.stage === 'thesaurus') && !schema.classes.some((c) => c.iri === iri)) return conceptLink;
	// A finding about a property (concept property or relation): open the class that carries it.
	const propertyOwner =
		schema.conceptProperties?.find((p) => p.iri === iri)?.domain ?? schema.objectProperties.find((p) => p.iri === iri)?.domain;
	if (propertyOwner && (finding.gateId.startsWith('concept-property-') || finding.gateId === 'relation-to-skos-concept')) {
		return appUrl(`/?focus=${encodeURIComponent(propertyOwner)}`);
	}
	const isIndividual =
		schema.individuals.some((i) => i.iri === iri) || (schema.untypedIndividuals ?? []).some((u) => u.iri === iri);
	if (isIndividual) return buildIdentitySearchUrl({ node: iri });

	const classIri = schema.classes.some((c) => c.iri === iri)
		? iri
		: schema.shapes?.find((s) => s.iri === iri)?.targetClassIri;
	return classIri ? appUrl(`/?focus=${encodeURIComponent(classIri)}`) : null;
}
