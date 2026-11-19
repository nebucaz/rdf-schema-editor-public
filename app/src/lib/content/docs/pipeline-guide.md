# Ontology Pipeline Guide

This guide explains how the areas of the app fit together if you want to build a model the way the book *The Ontology Pipeline* lays it out (see pp. 14-20 for the overview). It describes the method in our own words and points to the screens; for the reasoning behind each step, read the book.

## A recommended order, not a rule

The stages below are a **recommended order**. Whether your team adopts the method is up to you: nothing in the app requires it, no stage is locked behind another, and no check ever blocks a save. You can start at the ontology, come back to the vocabulary later, or skip a stage. The [Pipeline View](pipeline-view) shows where each namespace stands, and says *Not started* where there is nothing yet.

## The stages and where they live

| Stage | What you do | Where in the app |
|---|---|---|
| 1. Vocabulary | Agree on the terms and write definitions | **Vocabulary** area, see [Vocabulary](vocabulary) |
| 2. Metadata | Record source, authority and status of each term | The concept form, and the vocabulary gates |
| 3. Taxonomy | Arrange terms from general to specific (`skos:broader`) | **Taxonomy** area |
| 4. Thesaurus | Link related terms and map terms to outside vocabularies | The concept page, see [Terms, Classes and Deprecation](terms-and-classes) |
| 5. Ontology | Write the competency questions first, then model classes, properties and shapes | **Questions** page and the **Schema** canvas |
| 6. Knowledge graph | Load individuals and check them | **Identities** and **Validation** |
| Throughout | Questions, owners, change control, releases | [Competency Questions](competency-questions), **Governance**, see [Changes, Requests and Releases](changes-and-releases) |

The book's six stages and the Ontology page do not line up one to one. The page has no metadata box (metadata is recorded on the terms and on the Governance page, so its guide is linked from the vocabulary box), and it splits the last stage into validation and application, which the knowledge-graph guide covers together.

## Classes or concepts?

**Classes provide inheritance; concepts identify state.** Two kinds of taxonomy live in the app, and the rule above tells you which to use. There is no global setting: you decide per taxonomy.

- **Use a class** when the members share properties or shapes. Draw it on the canvas; the hierarchy is `rdfs:subClassOf`. *Laptop* and *Server* are subclasses of *Device* because they inherit what a device has.
- **Use a concept scheme** for classification values and facets, things that say in which state or category something is. The hierarchy is `skos:broader` and membership is `skos:inScheme`. A *Lifecycle* scheme with *Planned*, *In operation* and *Retired* is a scheme, not three classes: a device does not become a different kind of thing when it is retired.

To point a property at a scheme, use **Add concept property** on an entity, for example `lifecycleStage` with the scheme *Lifecycle*. The property then accepts only concepts of that scheme, and the validation report flags any other value. Do not draw a relation to the external class `skos:Concept` for this: a concept is not typed by a declared class, so `sh:class skos:Concept` is not evaluated for concepts and the report shows false violations.

Mirroring a concept hierarchy as classes is optional. It makes sense only where the concepts really are kinds of one thing that share properties, and then the class links to its concept (see [Terms, Classes and Deprecation](terms-and-classes)). A classification scheme needs no matching classes. The line between the two follows the article [SHACL Taxonomy Revisited](https://ontologist.substack.com/p/shacl-taxonomy-revisited), described here in our own words.

## Concept properties

A concept property is a property whose values are the concepts of one scheme, such as `lifecycleStage` with the scheme *Lifecycle*.

- **Where to add one.** On an entity node on the Schema canvas, choose **+ Add concept property**. Give it a **Name**, pick the **Scheme**, and tick **Required** or **Repeatable** if you need them. The node then shows a row with the property and its scheme. The button is disabled until a vocabulary namespace and at least one scheme exist.
- **What the constraint checks.** The property is stored with no range class. The validation report checks that every value is a concept of the chosen scheme, and reports any other value (a concept of another scheme, or something that is not a concept) with the value, the property and a message naming the scheme. The check is a generated SPARQL constraint on the class, so it runs with the other data checks on the Validation page.
- **Entering values.** On an individual, the value field offers the concepts of the scheme as you type. Only concepts you can still use are offered; a deprecated or retired concept you already set stays selectable, so it is not lost silently. Free text is not accepted.
- **The 1000-concept limit.** The list offers at most 1000 concepts of a scheme. When a scheme has more, the list says so, and you narrow it by typing. A scheme that large is usually better split.
- **Deprecated concepts.** A retired concept is no longer offered for new values. Individuals that already hold it show up in the Model checks, with the replacement when the concept names one.
- **Deleting a concept property** removes the property and its constraint, and leaves the values on the individuals in place.
- **The hazard of `skos:Concept`.** Do not draw a relation to the external class `skos:Concept` to get the same effect. A concept is not typed by a declared class, so that relation is not evaluated and the report shows false violations. The Model checks flags such a relation as **Relation to skos:Concept**.
- **Cost.** Each concept property adds one query to the validation run, which runs one constraint at a time. A constraint that hits the row cap or the timeout is listed under "not checked", never skipped silently.

## Step-by-step guides

| Stage | Guide |
|---|---|
| 1. Vocabulary | [Stage Guide: Vocabulary](guide-vocabulary) |
| 2. Metadata | [Stage Guide: Metadata](guide-metadata) |
| 3. Taxonomy | [Stage Guide: Taxonomy](guide-taxonomy) |
| 4. Thesaurus | [Stage Guide: Thesaurus](guide-thesaurus) |
| 5. Ontology | [Stage Guide: Ontology](guide-ontology) |
| 6. Knowledge graph | [Stage Guide: Validation and Knowledge Graph](guide-knowledge-graph) |
| Throughout | [Governance Sheet](pipeline-governance), and the [Worked Example](pipeline-example) the guides share |

The same guides, with a printable checklist, are in `docs/ontology-pipeline-practitioner-guide.md` in the repository.

## Competency questions: the ontology's contract and test harness

The book teaches competency questions in the ontology stage, as its first design discipline (pp. 192-193): write down what the model must answer **before the first modelling decision**, and agree the list with a domain expert. In the app they belong to the **Ontology** stage: each question is linked to the classes and properties it needs, and the question statistics (linked, passing, regressions) appear in the ontology box of each namespace on the Overview. A line under the namespaces counts the questions that are not linked to anything yet.

They then do three jobs over the life of the model:

- **Scope**: what the questions imply is in, and what you decide not to answer is out.
- **Acceptance criteria**: a model that answers all of them is complete for its purpose; a question that fails points at the gap.
- **Governance** (p. 240): the set is the test harness against drift. A model that can still answer its original questions is healthy; one that cannot has regressed. Review the set at least quarterly: a new question the model cannot answer is a scope change request, an obsolete one is a candidate for deprecation, a wrong answer is a defect. Change requests must name the question that justifies them.

## Gates: advice, not walls

A *gate* is a check over the loaded model. The [Model Checks](gate-report) lists what each one looks at: description and shape coverage for classes, label style and duplicates for terms, cycles and uneven depth in the taxonomy, mappings that stay inside their scheme, the match between the class hierarchy and the concept hierarchy, missing owners, and questions that were not reviewed in time. Findings marked *for human judgement* are prompts to look, not errors.

## Roles

The app has no permissions, and these roles are recorded as names, not enforced. Editing is open to everyone who is signed in. Suggested roles, and where each one is written down:

| Role | What they do | Where it is recorded |
|---|---|---|
| Steward | Looks after the vocabulary and ontology day to day | **Governance**, settings, *Steward* |
| Authority | Has the last word on definitions and approves changes | **Governance**, settings, *Authority* |
| Question owner | Keeps a competency question current and reviews it on time | The *Owner* field of the question |
| Domain expert | Reads and judges questions, terms and status; does not edit | The read-only **Review** pages (`/review`) |
| Modeller | Edits terms, classes and shapes | Anyone signed in; the change log records who did what |

Who made each change is recorded by the server from the signed-in user, and cannot be set from the browser. If a team needs real access control, that has to come from the sign-in system in front of the app.
