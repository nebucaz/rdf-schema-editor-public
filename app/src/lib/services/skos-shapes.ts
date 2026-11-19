/**
 * SHACL shapes shipped next to the SKOS Turtle export (skos-support STORY-413). A constant: the shapes never
 * change with the data, are never written to GraphDB or the `/shapes` graph, and use only constructs the
 * backend's validation engine evaluates (`sh:minCount`, `sh:uniqueLang`, `sh:class` inside `sh:or`).
 */
import { SKOS_NS, SKOS } from '#lib/utils/iri.js';
import { SCHEMA_NAMESPACE } from '#lib/config.js';

export const SKOS_SHAPES_TURTLE = `@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix skos: <${SKOS_NS}> .
@prefix rse: <${SCHEMA_NAMESPACE}> .

rse:SkosConceptShape a sh:NodeShape ;
    sh:targetClass <${SKOS.Concept}> ;
    sh:property [
        sh:path skos:prefLabel ;
        sh:minCount 1 ;
        sh:uniqueLang true ;
        sh:message "A concept needs a preferred label, and only one per language."
    ] , [
        sh:path skos:definition ;
        sh:minCount 1 ;
        sh:message "A concept needs a definition."
    ] , [
        sh:path skos:inScheme ;
        sh:minCount 1 ;
        sh:message "A concept belongs to at least one scheme."
    ] .

rse:SkosCollectionShape a sh:NodeShape ;
    sh:targetClass <${SKOS.Collection}> ;
    sh:property [
        sh:path skos:prefLabel ;
        sh:minCount 1 ;
        sh:uniqueLang true ;
        sh:message "A collection needs a preferred label, and only one per language."
    ] , [
        sh:path skos:member ;
        sh:or ( [ sh:class <${SKOS.Concept}> ] [ sh:class <${SKOS.Collection}> ] ) ;
        sh:message "A collection holds concepts or other collections."
    ] .
`;

export const skosShapesTurtle = (): string => SKOS_SHAPES_TURTLE;
