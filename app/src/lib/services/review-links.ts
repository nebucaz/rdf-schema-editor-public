/**
 * Links to the read-only review pages (ontology-pipeline STORY-335), for the editing screens to offer when
 * something is to be shared with a domain expert. A concept IRI travels as a query parameter and is only ever
 * compared with fetched IRIs, never interpolated into a query.
 */
import { appUrl } from '#lib/utils/urls.js';

export const reviewQuestionsUrl = () => appUrl('/review/questions');
export const reviewPipelineUrl = () => appUrl('/review/pipeline');
export const reviewConceptUrl = (conceptIri: string) => appUrl(`/review/concept?iri=${encodeURIComponent(conceptIri)}`);
