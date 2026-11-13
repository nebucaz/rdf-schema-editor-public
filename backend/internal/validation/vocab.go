// Package validation is the Go-side SHACL constraint-checking engine (spec/validation/plan.md) —
// resolves each class's own+inherited effective shape, loads a bulk snapshot of every identity in
// the graph, and checks every identity against every one of its declared types' effective shape.
// A deliberate exception to this repo's "validation lives entirely in the app layer" convention
// (CLAUDE.md), justified by Backstage-sync data volume (see plan.md's ADR table).
package validation

// RDF/RDFS/OWL/SHACL IRIs this package needs, written as literal, fully-qualified `<IRI>` terms
// throughout (no `PREFIX` declarations) — a second, independent copy of the handful of terms
// `internal/sync/vocab.go` already declares (rdfType/rdfsLabel/rdfsSubClassOf/owlClass plus the
// SHACL terms), duplicated rather than imported since those are unexported in that package and
// this repo's own accepted convention is independent Go-side re-declarations of shared vocabulary
// (see CLAUDE.md's named-graphs section on backend/internal/config and sync/iri.go mirroring
// utils/iri.ts/config.ts).
const (
	rdfType        = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type"
	rdfRest        = "http://www.w3.org/1999/02/22-rdf-syntax-ns#rest"
	rdfFirst       = "http://www.w3.org/1999/02/22-rdf-syntax-ns#first"
	rdfsComment    = "http://www.w3.org/2000/01/rdf-schema#comment"
	rdfsLabel      = "http://www.w3.org/2000/01/rdf-schema#label"
	rdfsSubClassOf = "http://www.w3.org/2000/01/rdf-schema#subClassOf"
	owlClass       = "http://www.w3.org/2002/07/owl#Class"
	xsdString      = "http://www.w3.org/2001/XMLSchema#string"

	shNodeShape   = "http://www.w3.org/ns/shacl#NodeShape"
	shTargetClass = "http://www.w3.org/ns/shacl#targetClass"
	shProperty    = "http://www.w3.org/ns/shacl#property"
	shPath        = "http://www.w3.org/ns/shacl#path"
	shMinCount    = "http://www.w3.org/ns/shacl#minCount"
	shMaxCount    = "http://www.w3.org/ns/shacl#maxCount"
	shDatatype    = "http://www.w3.org/ns/shacl#datatype"
	shClass       = "http://www.w3.org/ns/shacl#class"
	shOr          = "http://www.w3.org/ns/shacl#or"
	shMessage     = "http://www.w3.org/ns/shacl#message"
	shSparql      = "http://www.w3.org/ns/shacl#sparql"
	shSelect      = "http://www.w3.org/ns/shacl#select"
	shAsk         = "http://www.w3.org/ns/shacl#ask"
	shPrefixes    = "http://www.w3.org/ns/shacl#prefixes"
	shDeactivated = "http://www.w3.org/ns/shacl#deactivated"
	shNS          = "http://www.w3.org/ns/shacl#"
	shPattern     = "http://www.w3.org/ns/shacl#pattern"
	shFlags       = "http://www.w3.org/ns/shacl#flags"
	shMinLength   = "http://www.w3.org/ns/shacl#minLength"

	// armID and armQualityDimension are annotations on a NodeShape in the ITAM namespace
	// (examples/itam-shapes): the rule id a finding is filed under and its quality dimension.
	// A shape without them just has an empty rule id / dimension.
	armID               = "https://lida.pnet.ch/arm/schema#id"
	armQualityDimension = "https://lida.pnet.ch/arm/schema#qualityDimension"
)
