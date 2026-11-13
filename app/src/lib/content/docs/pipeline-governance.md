# Governance Sheet

One page on the governance the book *The Ontology Pipeline* asks for at each stage, who does what, how often, and where this app records it. It summarises the book in our own words and cites it by page. For the reasoning, read the book.

Governance here is a **recommended practice**. The app records owners, requests, decisions and versions, but it does not enforce any of them: no stage blocks another, no check blocks a save, and roles are names, not permissions (see [Roles](pipeline-guide)). The stage guides repeat the part of this sheet that applies to them.

## What the book asks for, stage by stage

| Stage | What the book asks for | What the app gives you |
|---|---|---|
| **Vocabulary** | Treat the vocabulary as a living system (p. 47). Decide how a new term gets in *before* rollout, and base that on evidence such as how often the term is used, a regulation, a business priority or visible user confusion (p. 50). Say who can ask for a change, who approves it, how often you review, and how you version and retire terms (p. 50). A request names the requester, the proposed term, definition and relations, and the reason; a rejection gives its reason; a synonym becomes an alternative label instead of a new term (p. 51). Retire terms by marking them, with a reason, a date and a replacement, and keep them for old data (p. 51). Before each release check for cycles, missing definitions, duplicate labels and labels that clash (p. 51). | Status steps from proposed to retired; **Deprecate** with reason, date and replacement; duplicate check that offers *Add as alternative label*; the vocabulary gates in the [Gate Report](gate-report); change requests and the change log on the Governance page. |
| **Metadata** | Design governance and meaning together, not in separate teams (p. 68). A metadata application profile (MAP) keeps meaning steady in three ways: every element has a precise definition, a new meaning gets a new element through a formal process, and rules enforce the profile (pp. 76-77). Version the profile and track changes (p. 79). Let domain experts own their metadata while one place coordinates the standards, and automate the checks (p. 79). | Source, authority and status on each concept; steward, authority, maturity and version on the Governance page. The profile itself is not modelled in the app. |
| **Taxonomy** | Keep the hierarchy under change control, so every change is deliberate, reviewed and reversible (p. 134). Validate on every change: one preferred label per language, no label used in two roles, no cycles, top concepts without a broader concept (pp. 134-135). Give each concept a lifecycle from proposed to retired, with notes that say what changed and why, and keep the old label findable on the replacement (p. 135). Use the quality checklists (pp. 115, 137). | The same five statuses; the change log; deprecation that can copy the old label to the replacement as a hidden label; taxonomy gates for cycles, top concepts, uneven depth, overlapping siblings and circular definitions. |
| **Thesaurus** | Collapse and refine candidate terms into one reconciled, defined vocabulary and resist pressure to keep vague catch-alls (pp. 149-150). Build the review of mappings into the taxonomy review cycle (p. 128). Run a quality check for hierarchy cycles, labels that collide, concepts without definition and related links that only repeat the tree (pp. 165-166). | Mapping gate (no mapping inside one scheme), a prompt when a related link joins a concept and its own ancestor, and the label and definition gates. |
| **Ontology** | Name a **steward** (looks after health: drift, documentation, the test suite) and an **authority** (approves changes); this is the first governance requirement (pp. 235-236). The practical minimum is both roles named and a change log with the reason for every model change (p. 236). Version with major, minor and patch numbers so every release is a deliberate decision (pp. 236-237). Tie every change request to a competency question, assess its impact by re-running the questions, and let the authority decide anything that changes an existing element (p. 238). Review the competency questions at least every quarter (p. 240). | Steward, authority, maturity and version on the Governance page; change requests that need a question; **Assess impact** over the questions and gates; the change log; the release dialog with a suggested version; the quarterly review gate. |
| **Knowledge graph** | Keep **data governance** (who may add or change triples) apart from **semantic governance** (who may change the ontology) (p. 311). Assess impact before a semantic change is committed, and version the ontology so consumers can move on their own schedule (pp. 311-312). Grow through proof of concept, pilot and production, and let the pilot test the governance itself (pp. 307-310). | The *maturity* field (POC, pilot, production); the change log for model changes; Backstage sync as a separate data path. |

## Who does what

Suggested split, recorded in the app as names and not enforced. *R* does it, *A* decides, *C* is consulted, *I* is informed.

| Action | Steward | Authority | Domain expert | Modeller |
|---|---|---|---|---|
| Request a change | C | I | R | R |
| Assess impact | R | I | C | C |
| Approve (existing terms and classes) | C | A | C | I |
| Approve (small additions and label fixes) | A | I | I | I |
| Release (set the new version) | R | A | I | I |
| Review the competency questions | R | A | R | C |
| Review mappings | R | I | C | R |
| Review concepts not reviewed for a long time | R | C | C | I |

*One person may hold both steward and authority in a small organisation (book, p. 236). What matters is that the roles exist, are known and are used.* The domain expert reads the read-only Review pages and does not edit.

## How often

| When | What |
|---|---|
| With every change to the model | Change request, impact assessment, decision, change log entry |
| With every release | Read the log since the last release, accept or change the suggested version, check the gates first |
| Every quarter, at least | Review the competency questions: a new question the model cannot answer is a scope change, an obsolete one a candidate for deprecation, a wrong answer a defect (p. 240) |
| With each taxonomy review | Review mappings to other vocabularies |
| When the debt list grows | Work the semantic debt list on the Pipeline Overview |

## The minimum to start with

If you do nothing else:

1. Name a **steward** and an **authority** on the Governance page.
2. Set a **version** and a **maturity**.
3. Use **change requests** and let the **change log** record the decision.
4. Review the **competency questions** every quarter.
5. **Release** with a new version when the log has changes in it.

## Two kinds of change

A **model change** alters a term, a class, a property or a shape. It is governed: request, assessment, decision, log, release. A **data change** adds or updates individuals, for example the Backstage sync. It follows the data owner's rules and is not written to the model change log (pp. 237-238, 311). Do not mix the two: an ontology change can invalidate data that was fine yesterday.

## What the app does not do

- It has no **committee** or membership list, and no **decision matrix** for accepting a term.
- It has no fields for **acceptance evidence**, and does not monitor how often a term is used.
- It does not enforce an **approval scope**: nothing stops a steward from approving a change that the book reserves for the authority.
- It does not use a **reasoner** to assess impact; the assessment shows what the questions and gates say now.
- It keeps no **history of instance data**: when an individual's relation changes, the old triple is not kept with a validity period.
- It does not model the metadata application profile (see the metadata guide).

## Steward checklist

Print this from the standalone guide; the in-app page is for reading.

Before a release:

- [ ] Gate report read; no warning left without a decision
- [ ] Every approved change request has a rationale and a change log entry
- [ ] Failing competency questions explained or fixed
- [ ] Suggested version checked (major, minor or patch)

Every quarter:

- [ ] Competency questions reviewed and their *Last reviewed* date updated
- [ ] Semantic debt list worked through
- [ ] Mappings to other vocabularies reviewed
- [ ] Steward, authority and maturity still correct

When a change request arrives:

- [ ] It names a competency question, or is returned or marked as a scope change
- [ ] Impact assessed
- [ ] Decision and rationale recorded

See [Changes, Requests and Releases](changes-and-releases), [Competency Questions](competency-questions) and the [Gate Report](gate-report) for how each step works in the app.
