# Gate Report

The **Gate report** tab on the Validation page lists quality findings about the model, grouped by pipeline stage. A *gate* is a check that looks at the loaded model and points out something worth a second look.

Gates only advise. A finding never blocks a save and never disables a button; the method is a recommended order, not a mandatory process.

## What is checked today

All checks use the data as written in the repository, without reasoning.

- **Class without description** (warning): the class has no `rdfs:comment`.
- **Class without parent** (info): the class is not a subclass of another class. Top-level classes are fine; this is a prompt to check that the hierarchy is complete.
- **Class without SHACL shape** (warning): no shape targets the class.
- **Shape path that is not a declared property** (warning): a shape constrains a property the model does not declare, which usually means a typo or a deleted property.
- **Individual outside the property's domain** (warning): an individual uses a property but is not an instance of the class the property is declared for (or a subclass of it). Because the model does not reason, this is how the mistake is caught.

### Vocabulary checks

These run over the concepts of the core vocabulary (see *Vocabulary*) and are shown under their own Vocabulary heading. Concepts that are deprecated or retired are left out.

- **Concept without definition**, **without source or authority** (warning).
- **Duplicate preferred label** (warning): two concepts share a preferred label in the same language, ignoring case. A concept with a *disambiguation* (Bank, finance / Bank, river) is not a duplicate.
- **Alternative label equals another concept's preferred label** (warning).
- **More than one preferred label in a language**, and **a label used in two roles** (preferred, alternative, hidden) of one concept (warning).
- **Acronym as preferred label** (warning): use the full term and keep the acronym as an alternative label.
- **Label style**: more than four words is only a prompt to review (info). A label with any of `: ; ( ) ? !`, with markup, or with odd capitalisation (a capital inside a word, or capitals used inconsistently) is a warning. The preferred and alternative labels are checked; hidden labels are not, since they hold misspellings on purpose.

The Vocabulary list shows a badge with the number of findings for each concept.

### Class and concept checks

These look at the link between a class and its vocabulary concept. They report nothing while no vocabulary namespace exists, and the application's own internal classes are left out.

- **Neither concept nor description** (warning): the class has no concept and no `rdfs:comment`.
- **Described but no concept** (info): the class has a description of its own but no concept. The backfill in the Vocabulary area can create the concepts.
- **Definition drift** (warning): the class has its own description and a concept with a definition, and the two differ (case and spacing are ignored). Keep the definition in one place: the concept.
- **Defined by a deprecated or retired concept** (warning): when the concept has a live replacement, the finding shows a **Retarget** button that points the class at the replacement. The class form offers the same.

The class form shows the findings about the class you are editing.

## Taxonomy and thesaurus gates

These read the vocabulary's live concepts and report nothing without a vocabulary namespace. Findings marked *for human judgement* are review prompts (info): they ask for a look, not a fix.

- **Cycle** (warning): a concept is, through `skos:broader`, broader than itself.
- **Top concept with a broader concept** (warning) and **concept in no scheme** (warning).
- **Uneven depth** (info): one top-concept branch is three or more levels shallower than another in the same scheme.
- **Sibling overlap** (info): two concepts under the same broader concept have nearly the same definition.
- **Circular definition** (warning): the definition contains the term. **Long definition** (warning): more than two sentences.
- **Mapping within a scheme** (warning): a `skos:exactMatch`, `closeMatch`, `relatedMatch`, `broadMatch` or `narrowMatch` points to a concept of the same scheme. **Related within a hierarchy chain** (info): a `skos:related` joins a concept and one of its own ancestors.
- **Class and concept hierarchy** (warning): class A is a subclass of B and both have a concept, but A's concept is not (transitively) narrower than B's. The message spells out the class chain and both concept chains. Two classes sharing one concept are not reported.

The taxonomy outline shows these findings next to the concept or class they are about.

## Governance gates

- **Core namespace without steward, authority or version** (warning): name them on the Governance page. Silent when no namespace is the core vocabulary.
- **Competency question not reviewed** (warning): a question was last reviewed longer ago than the review period (quarterly by default, a setting on the Pipeline page's debt list) or never.

## Reading the report

Each finding has a severity, a sentence saying what is wrong, and an **Open** link: classes (and the class a shape targets) are selected on the canvas when the active workspace shows them, individuals open in the Identities browser, concepts in the Vocabulary area.

The report uses the schema that is already loaded, so opening it adds no extra requests once the model is in memory. The vocabulary is read in pages with one query per page, never one per concept.
