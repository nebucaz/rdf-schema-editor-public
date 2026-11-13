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

The book's six stages and the Pipeline page do not line up one to one. The page has no metadata box (metadata is recorded on the terms and on the Governance page, so its guide is linked from the vocabulary box), and it splits the last stage into validation and application, which the knowledge-graph guide covers together.

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

A *gate* is a check over the loaded model. The [Gate Report](gate-report) lists what each one looks at: description and shape coverage for classes, label style and duplicates for terms, cycles and uneven depth in the taxonomy, mappings that stay inside their scheme, the match between the class hierarchy and the concept hierarchy, missing owners, and questions that were not reviewed in time. Findings marked *for human judgement* are prompts to look, not errors. The **semantic debt** list on the Pipeline page collects the open ones in one place.

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
