# Ontology Pipeline: Practitioner Guide

<!-- Generated from the in-app documentation by `bun run docs:guide` (run in `app/`). Do not edit by hand: change the in-app section and regenerate. -->

A governance sheet and a step-by-step guide for each stage of the ontology pipeline, for the people who run the RDF Schema Editor. It summarises the book *The Ontology Pipeline* in our own words and cites it by page; the book itself is not included. The same text is available in the app under Documentation, in the Ontology Pipeline category. The method is a recommended order, not a rule.

## Contents

- [Governance Sheet](#governance-sheet)
- [Worked Example: The IT Landscape](#worked-example-the-it-landscape)
- [Stage Guide: Vocabulary](#stage-guide-vocabulary)
- [Stage Guide: Metadata](#stage-guide-metadata)
- [Stage Guide: Taxonomy](#stage-guide-taxonomy)
- [Stage Guide: Thesaurus](#stage-guide-thesaurus)
- [Stage Guide: Ontology](#stage-guide-ontology)
- [Stage Guide: Validation and Knowledge Graph](#stage-guide-validation-and-knowledge-graph)
- [Printable checklist](#printable-checklist)

---

## Governance Sheet

One page on the governance the book *The Ontology Pipeline* asks for at each stage, who does what, how often, and where this app records it. It summarises the book in our own words and cites it by page. For the reasoning, read the book.

Governance here is a **recommended practice**. The app records owners, requests, decisions and versions, but it does not enforce any of them: no stage blocks another, no check blocks a save, and roles are names, not permissions (see Roles). The stage guides repeat the part of this sheet that applies to them.

### What the book asks for, stage by stage

| Stage | What the book asks for | What the app gives you |
|---|---|---|
| **Vocabulary** | Treat the vocabulary as a living system (p. 47). Decide how a new term gets in *before* rollout, and base that on evidence such as how often the term is used, a regulation, a business priority or visible user confusion (p. 50). Say who can ask for a change, who approves it, how often you review, and how you version and retire terms (p. 50). A request names the requester, the proposed term, definition and relations, and the reason; a rejection gives its reason; a synonym becomes an alternative label instead of a new term (p. 51). Retire terms by marking them, with a reason, a date and a replacement, and keep them for old data (p. 51). Before each release check for cycles, missing definitions, duplicate labels and labels that clash (p. 51). | Status steps from proposed to retired; **Deprecate** with reason, date and replacement; duplicate check that offers *Add as alternative label*; the vocabulary gates in the Gate Report; change requests and the change log on the Governance page. |
| **Metadata** | Design governance and meaning together, not in separate teams (p. 68). A metadata application profile (MAP) keeps meaning steady in three ways: every element has a precise definition, a new meaning gets a new element through a formal process, and rules enforce the profile (pp. 76-77). Version the profile and track changes (p. 79). Let domain experts own their metadata while one place coordinates the standards, and automate the checks (p. 79). | Source, authority and status on each concept; steward, authority, maturity and version on the Governance page. The profile itself is not modelled in the app. |
| **Taxonomy** | Keep the hierarchy under change control, so every change is deliberate, reviewed and reversible (p. 134). Validate on every change: one preferred label per language, no label used in two roles, no cycles, top concepts without a broader concept (pp. 134-135). Give each concept a lifecycle from proposed to retired, with notes that say what changed and why, and keep the old label findable on the replacement (p. 135). Use the quality checklists (pp. 115, 137). | The same five statuses; the change log; deprecation that can copy the old label to the replacement as a hidden label; taxonomy gates for cycles, top concepts, uneven depth, overlapping siblings and circular definitions. |
| **Thesaurus** | Collapse and refine candidate terms into one reconciled, defined vocabulary and resist pressure to keep vague catch-alls (pp. 149-150). Build the review of mappings into the taxonomy review cycle (p. 128). Run a quality check for hierarchy cycles, labels that collide, concepts without definition and related links that only repeat the tree (pp. 165-166). | Mapping gate (no mapping inside one scheme), a prompt when a related link joins a concept and its own ancestor, and the label and definition gates. |
| **Ontology** | Name a **steward** (looks after health: drift, documentation, the test suite) and an **authority** (approves changes); this is the first governance requirement (pp. 235-236). The practical minimum is both roles named and a change log with the reason for every model change (p. 236). Version with major, minor and patch numbers so every release is a deliberate decision (pp. 236-237). Tie every change request to a competency question, assess its impact by re-running the questions, and let the authority decide anything that changes an existing element (p. 238). Review the competency questions at least every quarter (p. 240). | Steward, authority, maturity and version on the Governance page; change requests that need a question; **Assess impact** over the questions and gates; the change log; the release dialog with a suggested version; the quarterly review gate. |
| **Knowledge graph** | Keep **data governance** (who may add or change triples) apart from **semantic governance** (who may change the ontology) (p. 311). Assess impact before a semantic change is committed, and version the ontology so consumers can move on their own schedule (pp. 311-312). Grow through proof of concept, pilot and production, and let the pilot test the governance itself (pp. 307-310). | The *maturity* field (POC, pilot, production); the change log for model changes; Backstage sync as a separate data path. |

### Who does what

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

### How often

| When | What |
|---|---|
| With every change to the model | Change request, impact assessment, decision, change log entry |
| With every release | Read the log since the last release, accept or change the suggested version, check the gates first |
| Every quarter, at least | Review the competency questions: a new question the model cannot answer is a scope change, an obsolete one a candidate for deprecation, a wrong answer a defect (p. 240) |
| With each taxonomy review | Review mappings to other vocabularies |
| When the debt list grows | Work the semantic debt list on the Pipeline Overview |

### The minimum to start with

If you do nothing else:

1. Name a **steward** and an **authority** on the Governance page.
2. Set a **version** and a **maturity**.
3. Use **change requests** and let the **change log** record the decision.
4. Review the **competency questions** every quarter.
5. **Release** with a new version when the log has changes in it.

### Two kinds of change

A **model change** alters a term, a class, a property or a shape. It is governed: request, assessment, decision, log, release. A **data change** adds or updates individuals, for example the Backstage sync. It follows the data owner's rules and is not written to the model change log (pp. 237-238, 311). Do not mix the two: an ontology change can invalidate data that was fine yesterday.

### What the app does not do

- It has no **committee** or membership list, and no **decision matrix** for accepting a term.
- It has no fields for **acceptance evidence**, and does not monitor how often a term is used.
- It does not enforce an **approval scope**: nothing stops a steward from approving a change that the book reserves for the authority.
- It does not use a **reasoner** to assess impact; the assessment shows what the questions and gates say now.
- It keeps no **history of instance data**: when an individual's relation changes, the old triple is not kept with a validity period.
- It does not model the metadata application profile (see the metadata guide).

### Steward checklist

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

See Changes, Requests and Releases, Competency Questions and the Gate Report for how each step works in the app.

---

## Worked Example: The IT Landscape

Every stage guide uses this one small example, so the steps stay concrete. It is **invented** for this documentation: the names, systems and owners are made up, and none of it is the book's example or real data. Follow along in a scratch namespace, or just read.

The organisation in the example keeps an inventory of its applications and wants to answer questions about it.

### 1. The scheme and its scope record

Write this before collecting any term. It keeps the vocabulary from growing without limit.

| Field | Entry |
|---|---|
| Scheme | IT landscape |
| Purpose | Give architects, application owners and auditors one meaning for the words used in the application inventory |
| Decisions supported | Which applications handle personal data, who answers for each application, which applications depend on one that is being retired |
| Out of scope | Product and vendor names, hardware, project names |
| Stakeholders | Enterprise architecture, application owners, data protection, service desk |

Each term below is recorded with the source *Architecture board glossary* and the authority *Enterprise Architecture*.

### 2. Candidate terms and what happened to them

Collected from the inventory, the service desk's ticket categories and two architecture documents:

| Candidate | Decision |
|---|---|
| Application, App, Software system | One concept. *Application* is preferred; the other two become alternative labels |
| Web application, Web app | One concept: *Web application*, with *Web app* as an alternative label |
| Interface, API | One concept. *Interface* is preferred; *API* is an acronym, so it is an alternative label |
| Service | Two meanings, so two concepts that share a name and are told apart by a qualifier (see below) |
| Application owner, System owner | One concept: *Application owner* |
| Personal data, PII | One concept: *Personal data*, with *PII* as an alternative label |
| Other systems | Rejected: it is a catch-all that nobody can define |

### 3. The terms

| Preferred label | Qualifier | Alternative labels | Definition | Broader |
|---|---|---|---|---|
| Software | | | Programs and the components they are built from, kept and changed by people in the organisation. | — |
| Application | | App, Software system | A program that people or other programs use to carry out a business task, looked after as one unit. | Software |
| Web application | | Web app | An application that people use through a browser. | Application |
| Interface | | API | A defined way for one program to ask another for facts or for an action. | Software |
| Service | technical | | A function that one program offers to other programs through an interface. | Software |
| Service | business | | An outcome that the organisation provides to its customers or staff, such as paying an invoice. | Offering |
| Offering | | | Anything the organisation provides to people outside or inside it. | — |
| Data | | | Facts the organisation records about its customers, its money, its programs and its operations. | — |
| Personal data | | PII, Personal information | Facts about a living person who can be identified from them. | Data |
| Customer contact data | | | Personal facts that let the organisation reach a customer, such as an address or a phone number. | Personal data |
| Financial data | | | Facts about amounts of money, payments and accounts. | Data |
| Role | | | A set of duties that a person holds for the organisation. | — |
| Application owner | | System owner | The person who answers for the budget, changes and retirement of one application. | Role |

#### Telling the two services apart

Both concepts have the preferred label *Service*, so each carries a qualifier, and each has a scope note:

- *Service (technical)*: use for a function that software offers to software. Not for something a customer receives.
- *Service (business)*: use for an outcome a customer or colleague receives. Not for a program function.

### 4. The taxonomy

Three levels at most, with the branches about equally deep:

- Software
  - Application
    - Web application
  - Interface
  - Service (technical)
- Offering
  - Service (business)
- Data
  - Personal data
    - Customer contact data
  - Financial data
- Role
  - Application owner

### 5. Related terms and mappings

Related links join concepts of different branches:

| From | Related to |
|---|---|
| Application | Personal data |
| Application | Application owner |

Mappings point to concepts of another scheme. The target scheme here is an invented partner glossary:

| Concept | Mapping | Target |
|---|---|---|
| Personal data | closeMatch | https://example.org/partner-glossary#PersonalInformation |
| Application | broadMatch | https://example.org/partner-glossary#SoftwareAsset |

### 6. Competency questions and the model they imply

| # | Question | What the model needs |
|---|---|---|
| 1 | Which applications process personal data? | Classes *Application* and *Data category*; relation *processes* from Application to Data category |
| 2 | Who owns each application, and when did the owner last confirm it? | Class *Person*; relation *owned by*; attribute *last confirmed* (a date) |
| 3 | Which applications depend on an application that is being retired? | Relation *depends on* from Application to Application; attribute *lifecycle status* |

Link *Application* to the concept Application and *Data category* to the concept Data. *Person* gets no link, because the vocabulary has no concept for a person yet; the "no concept" badge on the canvas stays until one is added.

### 7. A shape

Every application has exactly one owner, who is a person: the property `owned by` on *Application* has a minimum and a maximum count of 1 and the class *Person*.

### 8. A few individuals

| Individual | Class | Facts |
|---|---|---|
| Invoice Portal | Application | processes: Customer contact data; owned by: Pat Example; last confirmed: 2026-09-30 |
| Ledger | Application | processes: Financial data; owned by: Sam Sample; depends on: nothing |
| Pat Example | Person | |

### 9. A change request and its release

New question 4: *Which interfaces carry personal data?* The model cannot answer it yet, so a change request names it and proposes a relation *carries* from Interface to Data category. It adds something and changes nothing that exists, so the suggested version moves from 1.2.0 to **1.3.0** (minor). The decision, the question and the version are recorded in the change log.

---

## Stage Guide: Vocabulary

The first stage of the pipeline: agree on the words before you draw the classes that use them. This guide follows the *IT landscape* example from [Worked Example: IT Landscape](#worked-example-the-it-landscape). The stage is a recommended first step, not a gate: nothing here blocks anything, and you can come back to it at any time.

### What this stage is for

A controlled vocabulary gives each thing in your domain one preferred name, a written definition and a list of the other names people use for it. It ends the argument about what a word means before that argument gets built into the model.

### Before you start

- You can sign in and open **Vocabulary** in the Pipeline navigation.
- You know who will answer for the meaning of the terms (an authority) and where definitions come from (a source). If you do not know yet, you can still start and fill both in later.
- You have a rough list of the words people use. A service desk's ticket categories or an application inventory is a good source.

### Steps

1. **Choose the vocabulary namespace.** On the Vocabulary page, if the page says *No vocabulary namespace yet*, pick the namespace that will hold the terms and choose **Use as vocabulary namespace**. Only one namespace can carry the mark. *Why:* the terms live in their own graph of that namespace, apart from the classes.
2. **Create a scheme.** In the Schemes panel, type a name (*IT landscape*) and choose **Add scheme**. A scheme groups concepts that belong together.
3. **Write the scope record before you collect terms.** Select the scheme and fill in **Purpose**, **Decisions supported**, **Out of scope** and **Stakeholders**, then save. *Why:* the scope record is what stops a vocabulary from growing without limit; the example's is in section 1 of the worked example.
4. **Collect candidate terms.** List every word in use, with duplicates and variants. Do not enter them yet. Decide which are one concept under several names (*Application*, *App*, *Software system*), which are one name for two concepts (*Service*) and which cannot be defined (*Other systems*): drop those.
5. **Add a concept.** Choose **Add concept**. Type the **Preferred label** first. The form compares it with every label already in the vocabulary, ignoring case, accents, plurals and small typos. If it shows a similar concept, reuse it: choose **Add as alternative label** instead of creating a second one.
6. **Pick the preferred label.** Use the plain name your users would search for, without parentheses or colons, and without an acronym. Four words are the most you should need (book, p. 50). Keep the abbreviation (*API*) as an alternative label.
7. **Record the other names.** In **Alternative labels** (one per line) put synonyms and abbreviations. In **Hidden labels** put misspellings and retired terms: they are found by search but never shown.
8. **Write the definition.** In **Definition**, say what kind of thing it is, then what sets it apart. Do not use the term itself in the definition. Two sentences are enough (kind, then difference: book, p. 33).
9. **Tell homonyms apart.** When two meanings share a name, fill **Disambiguation** with a short qualifier (*technical*, *business*) and write a **Scope note** that says where each meaning applies. Do not put the qualifier in brackets in the label.
10. **Record where it comes from.** Fill **Source** (where the definition comes from) and **Authority** (who answers for the meaning). Choose the **Scheme** and tick **Top concept** for the broadest terms of a branch. Choose **Save**.
11. **Approve.** A new concept starts as *proposed*. When the authority agrees, select the concept and choose **Mark approved**. An approved concept needs a definition. A concept moves one step at a time: proposed, approved, active, deprecated, retired.
12. **Run the checks.** Open **Validation**, then the **Gate report** tab, and read the vocabulary findings: missing definitions, duplicate labels, labels that clash, acronyms as preferred labels, label style. The Vocabulary list also shows a badge with the number of findings on each concept. Fix what is wrong, or decide to leave it and say why.
13. **Retire a term with care.** Do not delete. Select the concept and choose **Deprecate**, give the reason and, if there is one, the replacement. Tick the option that adds the old label to the replacement as a hidden label, so a search for it still finds the new concept. **Delete** is for mistakes only.

### Done when

- [ ] The scheme has a scope record
- [ ] Every term has one preferred label, written without brackets or an acronym
- [ ] Every preferred term has a definition that does not use the term itself
- [ ] No two terms share a preferred label unless a qualifier tells them apart
- [ ] Synonyms and abbreviations are alternative labels, and no alternative label equals another term's preferred label
- [ ] Every term has a source and an authority
- [ ] The Gate report shows no vocabulary warning that you have not decided about

### Watch out for

- **Terms that mean two things.** Merging them into one concept hides the problem. Give each meaning its own concept and a qualifier.
- **Long compound labels.** *Enterprise Wide Customer Facing Mobile Banking Application* is a hierarchy in disguise. Split it into a broader and a narrower term.
- **Catch-all terms.** *Other*, *Misc* and *General* cannot be defined and attract anything. Refuse them, even under pressure.
- **Circular definitions.** "An application owner owns an application" tells nobody anything. Say what kind of thing it is first.

### What the app does not do

- It has no committee or membership list, and no decision matrix for accepting a term.
- It has no field for acceptance evidence (how often the term appears, a regulation, user confusion) and does not measure how often a term is used.
- It does not force a term through any approval: *Mark approved* is available to everyone who is signed in.

### Governance for this stage

Decide *before* the vocabulary is shared how a new term gets in, and write the rule down. The book suggests grounding acceptance in evidence: how often people use the term, a regulatory need, a business priority, or visible confusion (p. 50). Say who can ask for a change, who approves it, how often you review, and how terms are versioned and retired (p. 50). A request names who asks, the proposed term, definition and relations, and the reason; a rejection gives its reason; a synonym becomes an alternative label instead of a new term (p. 51). Before each release, check that there are no cycles, every preferred term has a definition, no labels are duplicated and no alternative label clashes with another term (p. 51).

In the app, use a change request for a term that needs a decision, and read the change log to see who changed what. The roles, the cadence and the minimum to start with are on the [Governance Sheet](#governance-sheet). Every check named above is a gate in the Gate Report; fields and statuses are described in Vocabulary, and homonyms and deprecation in Terms, Classes and Deprecation.

### Next stage

Record the facts about each term and the model around it in the [Metadata guide](#stage-guide-metadata).

---

## Stage Guide: Metadata

The second stage: decide what facts you keep *about* things, and who looks after those facts. This guide follows the *IT landscape* example from [Worked Example: IT Landscape](#worked-example-the-it-landscape). It is a recommended step, not a gate.

**A note up front.** The book's answer for this stage is a *metadata application profile*: a document that declares the elements you use, how each system uses them, and how they map to one another. This app has no profile editor. So the guide does two things and says which is which: steps marked **on paper** are method, done in a spreadsheet or a document; steps marked **in the app** use screens that exist today.

### What this stage is for

Metadata is data about data: who owns an application, when it was last confirmed, where a definition comes from. This stage makes those facts explicit and consistent, so that the vocabulary before it and the ontology after it describe things in the same way.

### Before you start

- A first version of the vocabulary exists (see the [Vocabulary guide](#stage-guide-vocabulary)), so that elements can use its terms as their allowed values.
- You know which systems keep facts about your things today. In the example: the application inventory and the service desk's ticket tool.
- You have decided who will be steward and who will be authority for the model. If you do not know yet, you can still start.

### Steps

1. **On paper: start with one entity.** Pick the one thing that matters most and prove the approach on it before widening (book, p. 79). In the example: *Application*.
2. **On paper: list the elements you need.** For that entity, write the facts you must keep, with a name for each: owner, last confirmed, lifecycle status, data processed. This is your core schema (book, p. 77); a small standard set such as Dublin Core is a good place to borrow names from.
3. **On paper: define every element precisely.** One sentence each, so that two readers cannot understand it two ways. "Owner" means the person who answers for the application's budget and retirement, not the team that runs it (book, p. 76).
4. **On paper: describe how each system uses the elements.** The inventory may call it *Owner*, the ticket tool *Assignee group*. Write down, per system, which field holds which element and what format it uses (book, pp. 73-74).
5. **On paper: write the crosswalks.** For each pair of systems, the mapping between their fields, including the cases that are not one to one (book, p. 78).
6. **On paper: choose the allowed values.** Where an element takes a value from a list, such as *data processed*, use a scheme from your vocabulary as that list (book, p. 78).
7. **In the app: record source and authority on every term.** Open each concept in **Vocabulary**, choose **Edit** and fill **Source** and **Authority**. The Gate report warns about terms without them.
8. **In the app: name the owners of the model.** On the **Governance** page, in *Owners and version*, fill **Steward**, **Authority**, **Maturity** (POC, pilot or production) and **Version**, and save.
9. **In the app: model the elements as attributes.** On the Schema canvas, choose **+ Add attribute** on the class, give it a **Name** and a **Datatype**, and tick **Required** or **Repeatable** as the definition says. The attribute becomes a property with a shape constraint, which is how the rules of your profile are enforced when data is validated.
10. **In the app: describe the catalog entry.** For classes you publish in a data catalog, open the **Catalog** tab of the Triples Panel and fill the fields such as **Publisher override**; leave a field empty to use the namespace's default.
11. **Add an element, do not stretch one.** When a new system needs a new fact, add a new attribute and write its definition. Do not reuse an old element for a new meaning (book, p. 76).
12. **Version and review.** Treat the profile as living documentation: change it through a change request, let the change log record the decision, and raise the **Version** on release (see Changes, Requests and Releases).

### Done when

- [ ] One entity has a written list of elements, each with a one-sentence definition
- [ ] Each system's use of those elements and the crosswalks between systems are written down
- [ ] Every element that takes a list of values points to a scheme in the vocabulary
- [ ] Every term has a source and an authority
- [ ] Steward, authority, maturity and version are filled in on the Governance page
- [ ] Each element that the model must keep is an attribute, with the right datatype and required or repeatable setting

### Watch out for

- **Treating metadata as a by-product.** If nobody owns the elements, each team invents its own and nothing lines up. Name an owner for every element.
- **One schema to rule them all.** The book does not ask for one global schema. Let each system's owner document their own use and keep the crosswalks central (book, p. 78).
- **Starting wide.** Cover one entity first, then add elements bit by bit (book, p. 79).
- **Using the same field for two meanings.** A field that means "owner" in one record and "operator" in another breaks every query that joins them.

### What the app does not do

- It has no metadata application profile: you cannot declare a profile, version it or compare it with another one in the app. Steps 1 to 6 stay on paper.
- It has no crosswalk editor and no per-system profile view.
- It has no metadata gates. The Gate report checks terms, classes and shapes, not the completeness of a profile.
- It does not enforce who may add an element.

### Governance for this stage

The book asks that governance and meaning are designed together, not split between a data governance team and a separate semantic team (p. 68). A profile governs in three ways: every element is precisely defined, a new meaning gets a new element through a formal process, and rules enforce the profile (pp. 76-77). Version the profile, track changes, and let the owners of each system keep their own metadata while one place coordinates the standards and automates checks (p. 79). One organisation described in the book asked every system owner to submit a revised profile every quarter (p. 78).

In the app, record steward, authority, maturity and version on the Governance page, use a change request for each new or changed element, and read the change log for the history. The roles and cadence are on the [Governance Sheet](#governance-sheet). Fields of the forms used above are in Attribute Form and Catalog Metadata Form; the fields of a term are in Vocabulary.

### Next stage

Arrange the terms from general to specific in the [Taxonomy guide](#stage-guide-taxonomy).

---

## Stage Guide: Taxonomy

The third stage: arrange the agreed terms from general to specific, so that every term has a place and every place makes sense. This guide follows the *IT landscape* example from [Worked Example: IT Landscape](#worked-example-the-it-landscape). It is a recommended step, not a gate: you can start with a short list and refine the hierarchy as you learn.

### What this stage is for

A taxonomy puts each term under a broader one (*Web application* under *Application*, *Application* under *Software*). It gives people and programs a way to browse from the general to the specific, and to find everything of a kind.

### Before you start

- A vocabulary with defined terms exists (see the [Vocabulary guide](#stage-guide-vocabulary)); every term you will place has a definition.
- You have a scheme to hold the hierarchy. The outline works on one scheme at a time.
- Optional but useful: some classes already exist on the Schema canvas, so you can compare the two hierarchies.

### Steps

1. **Open the outline.** Choose **Taxonomy** in the Pipeline navigation and pick the scheme. The left side shows **Concepts (skos:broader)**, the right side the read-only class hierarchy, **Classes (rdfs:subClassOf)**. If the page says no namespace is the core vocabulary, set it up in Vocabulary first.
2. **Choose the top-level categories.** Aim for a few broad headings that do not overlap. In the example: *Software*, *Offering*, *Data* and *Role*. For each, open the concept in Vocabulary and tick **Top concept**. A top concept has no broader concept. *Why:* a term with no home is a sign of a gap in the top level (book, p. 114).
3. **Place one term at a time.** Take a term and ask where it belongs. Choose the preferred label that your users would use, then find its parent (book, p. 112).
4. **Apply the is-a test.** Drag the concept onto its broader concept. The outline asks *Is every Web application a kind of Application?* Answer it honestly. If the answer is "not always", the parent is wrong. Choose **Move** only when the answer is yes (book, p. 113).
5. **Group the siblings.** Look at the terms that share a parent. They should not overlap: nothing should fit under two of them. If two are the same idea, merge them as one concept with an alternative label (book, p. 115).
6. **Keep the depth even.** Three levels is a good target. If one branch is far deeper than the others, ask whether the extra levels are needed; if they are, write down why (book, p. 114).
7. **Keep acronyms and jargon out of the preferred labels.** The preferred label should make sense to a new colleague. Keep the abbreviation or the project name as an alternative label (book, p. 115).
8. **Check the definitions.** A definition says what kind of thing the term is, then what sets it apart. It never uses the term itself. Rewrite those that do (book, p. 115).
9. **Take a term out of a branch.** Drag it to **Drop here to remove the broader concept**. Nothing is deleted; the term simply has no parent until you place it again.
10. **Compare with the classes.** Read the class hierarchy next to the concept hierarchy. If a class is a subclass of another and both are linked to concepts (use **Defined by concept** on the class, or **Promote to class** on an approved concept), the concept of the subclass should sit under the concept of the superclass.
11. **Run the checks.** Open **Validation**, then the **Gate report** tab. Work through cycles, a top concept that still has a broader concept, concepts in no scheme, uneven depth, overlapping siblings, circular and overlong definitions, and class hierarchies that disagree with the concept hierarchy. Findings marked *for human judgement* are prompts to look, not errors.
12. **Retire, don't delete.** When a term is superseded, **Deprecate** it with a reason and its replacement, so that old tagging still finds the new term (see Terms, Classes and Deprecation).

### Done when

- [ ] Every term has a parent or is a top concept of its scheme
- [ ] For every parent and child, "every child is a kind of the parent" is true
- [ ] Siblings do not overlap
- [ ] Branches are about equally deep, or the difference is explained
- [ ] Acronyms and project names are alternative labels, not preferred labels
- [ ] No definition uses the term itself
- [ ] The Gate report shows no taxonomy warning that you have not decided about

### Watch out for

- **Mixed depth.** One branch with five levels and another with two makes browsing feel random. Balance them or explain the difference.
- **Orphans.** A term that fits nowhere often points to a missing top-level category, or to scope creep. Revisit the top level before forcing it under a bad parent.
- **Overlapping categories.** If something can legitimately be in two siblings, refine the definitions or restructure. A term with two parents is allowed and the outline marks it as *multiple parents*, but use it sparingly and never as a way around unclear boundaries (book, p. 115).
- **Hierarchy by habit.** Do not copy the org chart or the folder tree. Test every link with "is every X a kind of Y?".

### What the app does not do

- It does not review a taxonomy change the way a code change is reviewed: there is no branch, pull request or approval step. The nearest things are a change request and the change log.
- It does not stop a move. The is-a question is a prompt; a move that would create a cycle is refused, anything else is your decision.
- It cannot tell whether siblings truly exclude each other. The overlap gate only compares their definitions, so the check in step 5 stays with you.

### Governance for this stage

Treat the taxonomy like production code: changes should be deliberate, reviewed and reversible (book, p. 134). Validate on every change: one preferred label per language, no label used in two roles of one concept, no cycles, no top concept with a broader concept (book, pp. 134-135). Give each concept a lifecycle from proposed to retired, with notes that say what changed and why, and keep the old label findable on the replacement (book, p. 135). A deprecated term that is not handled properly keeps being used and the tagging drifts (book, p. 135). Use the quality checklist before you call a branch final (book, pp. 115, 137).

In the app, the five statuses are the same lifecycle, a change request records the decision, and the change log shows who changed what. Review mappings with each taxonomy review. Roles and cadence are on the [Governance Sheet](#governance-sheet); every check above is in the Gate Report; the outline itself is described in Terms, Classes and Deprecation and the fields of a term in Vocabulary.

### Next stage

Link related terms and map them to other vocabularies in the [Thesaurus guide](#stage-guide-thesaurus).

---

## Stage Guide: Thesaurus

The fourth stage: connect terms that belong together but are not in the same line of descent, and connect your vocabulary to other people's. This guide follows the *IT landscape* example from [Worked Example: IT Landscape](#worked-example-the-it-landscape). It is a recommended step, not a gate.

### What this stage is for

The taxonomy says what is a kind of what. The thesaurus adds the links that a hierarchy cannot carry: *Application* is related to *Personal data* (an application processes it), and your *Personal data* is close in meaning to a term in a partner's glossary. Searches and programs can then widen a question from one term to its neighbours.

### Before you start

- A vocabulary and a taxonomy exist (see the [Taxonomy guide](#stage-guide-taxonomy)); relations only make sense between terms that are defined and placed.
- For mappings: the outside vocabulary is registered in the app. Open the Settings menu, choose **Manage**, then **External Vocabularies**, and add its prefix and base IRI. You can also type a full IRI without registering anything.
- Plan to do this stage as its own pass. The book recommends modelling vocabulary, taxonomy and thesaurus one after another and expects you to revise as you learn (p. 149).

### Steps

1. **Finish the term list first.** Merge duplicates and settle synonyms before linking anything, so that links do not have to be moved later. Do not keep a vague catch-all term because a colleague asks for it (book, pp. 149-150).
2. **Find the cross-branch pairs.** For each term, ask: what else would a person want to see next to this one, that is not its parent or child? In the example: *Application* and *Personal data*, *Application* and *Application owner*.
3. **Open the concept.** In **Vocabulary**, select the concept. The section **Related and mapped** lists what is already linked.
4. **Add a related link.** Choose the kind **skos:related**, pick the other concept and choose **Add relation**. The link is stored once, on one concept, and shown on both. You do not need to add the reverse.
5. **Do not relate siblings.** Two concepts under the same parent are already tied together by that parent. A related link between them only repeats the tree (book, p. 166). Link across branches instead.
6. **Do not relate a concept to its own ancestor.** The app flags this too, as a prompt.
7. **Choose the kind of mapping.** For a concept in another scheme, pick the kind that says how close the two are: **exactMatch** (the same concept in both), **closeMatch** (nearly the same), **relatedMatch** (an associative link), **broadMatch** (the other concept is broader than yours) or **narrowMatch** (the other concept is narrower). The book explains the first three on p. 164. When in doubt, take the weaker one.
8. **Point at the other concept.** Pick the registered vocabulary and type the term, or choose **(enter a full IRI)** and paste the concept's IRI. The app refuses a mapping to a concept of the same scheme: use a hierarchy or a related link there.
9. **Add the link.** Choose **Add relation**. Repeat for each mapping.
10. **Run the checks.** Open **Validation**, then the **Gate report** tab. Read the thesaurus findings (a mapping inside one scheme, a related link along a concept's own ancestry) together with the label and definition findings from the earlier stages.
11. **Use the other names.** Make sure synonyms live in **Alternative labels** and misspellings in **Hidden labels** of the concept. Search and query expansion rely on them, so that one concept answers to all of its names.
12. **Schedule the mapping review.** Put a date in the calendar to look at the mappings again, together with the next taxonomy review (book, p. 128).

### Done when

- [ ] Every related link joins concepts of different branches
- [ ] No related link joins siblings or a concept and its own ancestor
- [ ] Every mapping points to a concept of another scheme and uses the weakest kind that is true
- [ ] Every external vocabulary you map to is registered, or its IRI is recorded in full
- [ ] Synonyms and misspellings are on the concept as alternative and hidden labels
- [ ] The Gate report shows no thesaurus warning that you have not decided about
- [ ] A mapping review date is set

### Watch out for

- **Mapping too strongly.** *exactMatch* says the two concepts are the same. If you only believe they are close, say *closeMatch*. Strong claims break when the other vocabulary changes.
- **Links that repeat the tree.** A related link that a parent already implies adds noise and no meaning.
- **Everything related to everything.** If most concepts have a dozen related links, none of them helps. Keep the few that someone would actually follow.
- **Forgetting the outside world moves.** A mapping points at a vocabulary you do not control. Check it when you review, not only when you create it.

### What the app does not do

- It does not check for related links between siblings; its gate only looks at a concept and its own ancestors, so step 5 stays with you.
- It does not flag concepts that have no relations at all.
- It does not model SKOS collections (named groups used for navigation) or `skos:notation` (a code from another classification system).
- It does not schedule or remind you of a mapping review.

### Governance for this stage

The thesaurus has no governance section of its own in the book; its rules come from the stages around it. Refine candidate terms into one reconciled, defined vocabulary and resist the pressure to keep ambiguous catch-alls (book, pp. 149-150). Build the review of mappings into the taxonomy governance cycle (book, p. 128). Check the structure with a quality tool for hierarchy cycles, colliding labels, missing documentation and related links that only repeat the tree (book, pp. 165-166).

In the app, the Gate report covers the checks it can, a change request records a decision to add or change a mapping, and the change log shows who did it. The cadence is on the [Governance Sheet](#governance-sheet). The relations are described in Terms, Classes and Deprecation, the registered vocabularies in External Vocabulary Management View, and the checks in the Gate Report.

### Next stage

Turn the agreed terms into classes, properties and shapes in the [Ontology guide](#stage-guide-ontology).

---

## Stage Guide: Ontology

The fifth stage: turn the agreed terms into classes, properties and shapes that can answer real questions, and keep them healthy as things change. This guide follows the *IT landscape* example from [Worked Example: IT Landscape](#worked-example-the-it-landscape). It is a recommended step, not a gate. The one thing the book insists on first is writing the questions down, and that is where this guide starts.

### What this stage is for

An ontology is the model: what kinds of things exist, how they relate, and what rules their data must follow. Each class, property and rule should earn its place by helping to answer a question someone actually has.

### Before you start

- You have a vocabulary with defined terms (see the [Vocabulary guide](#stage-guide-vocabulary)). Classes can point to the concept that defines them, so the definition is written once.
- You have a domain expert you can ask. The questions in step 2 need their agreement.
- You know who is steward and who is authority, or you are ready to record them in step 12.

### Steps

1. **Open the questions page.** Choose **Questions** in the Pipeline navigation. The page lists the questions, what each expects, which classes and properties it needs, its owner and when it was last reviewed.
2. **Write the competency questions first, before the first modelling decision.** Choose **Add question** and write each question the model must be able to answer, in the words of the people who will ask. In the example: *Which applications process personal data?* Agree the list with a domain expert (book, pp. 192-193).
3. **Say what a good answer looks like.** In the form, describe the expected result (at least some rows, or a yes or no) and how to check it: your own SPARQL query or a saved query. Fill in **Owner**, so that someone looks after the question.
4. **Work out what each question needs.** For each question, list the classes, properties and rules it implies. *Which applications process personal data?* needs a class *Application*, a class *Data category* and a relation *processes* between them (book, pp. 201-202). Every class and property should trace back to a question.
5. **Look for existing standards first.** Before you invent a term, check what exists: Dublin Core, DCAT, PROV-O, Schema.org, FOAF. Register an outside vocabulary and use its terms where they fit (book, p. 202).
6. **Draw the classes.** On the Schema canvas, use **+ Add Entity** (the toolbar split button, or Option/Alt+click on the canvas). Link each class to the concept that defines it with **Defined by concept**, or start from an approved concept with **Promote to class** in the Vocabulary area. The definition stays with the concept.
7. **Add attributes and relations.** On a class, choose **+ Add attribute** for facts such as a date, with a datatype and required or repeatable. Drag from one class to another to draw a relation. Attributes and relations bring their SHACL shape constraint with them, which is the rule your data is validated against later (see Attribute Form and Relation Form).
8. **Link the questions to the model.** Edit each question and, under **Linked classes and properties**, tick what it needs. A question with nothing linked is a question the model cannot yet answer.
9. **Run all the questions.** On the Questions page, choose **Run all**. A question that used to pass and now fails is marked **Regression**. A model that still answers its original questions is healthy; one that cannot has regressed (book, p. 240).
10. **Handle a failing question.** Decide: is the model missing something (change the model), is the question wrong or out of date (change or deprecate the question), or is the question right and the answer wrong (a defect, fix it first).
11. **Change the model through a request.** On the **Governance** page choose **New request**: name the proposed term, definition or relations, the reason and the competency question that justifies it. A request without a question can only be returned or marked as a scope change on purpose. Choose **Start review**, then **Assess impact** to see which questions and gate findings changed since the request was made. Decide with **Approve** or the other outcomes, with a rationale. An approved request adds an entry to the change log (book, p. 238).
12. **Name the owners and release.** In *Owners and version* on the Governance page fill **Steward**, authority, maturity and version. When the change log has entries, choose **Release…**: the dialog suggests how the version moves (patch, minor or major) and you confirm or override. Additions are minor; removing or renaming a class or changing a domain or range is major (book, pp. 236-237).
13. **Review the questions every quarter.** Update **Last reviewed** on each question you checked. A new question the model cannot answer is a scope change request; an obsolete one is a candidate for deprecation (book, p. 240).

### Done when

- [ ] Every question is written down, agreed with a domain expert and has an owner
- [ ] Every class and property can be traced to at least one question
- [ ] Every class is linked to the concept that defines it, or you know why not
- [ ] Every question is linked to the classes and properties it needs
- [ ] All questions have been run, and every failing one is explained
- [ ] Steward, authority, maturity and version are filled in
- [ ] Every model change since the last release went through a request, or has a reason in the log

### Watch out for

- **Modelling before asking.** A model drawn before the questions exist answers nothing in particular. Write the questions first.
- **Classes without a question.** If you cannot say which question a class helps to answer, you probably do not need it yet.
- **Stretching one property.** Do not reuse a property for a second meaning. Add a new one and define it.
- **Hiding a defect in a scope change.** A question the model should answer but answers wrongly is a defect. Do not file it as a scope change to avoid fixing it.

### What the app does not do

- It does not use a reasoner to assess impact. **Assess impact** re-runs the questions and gates and shows what they say now; it does not infer what else would change.
- It does not enforce the split between steward and authority. Nothing stops a steward from approving a change that the book would send to the authority.
- It does not edit disjointness or functional-property declarations, which the book discusses.
- It does not keep a separate version for instance data: the version is the ontology's.

### Governance for this stage

Ownership is the first requirement: a named **steward** who looks after the health of the ontology (drift, documentation, the test suite) and a named **authority** who approves changes. The practical minimum is both roles named, plus a change log that records the reason for every model change. A small organisation can have one person hold both (book, pp. 235-236). Number each release with major, minor and patch, so every version is a deliberate decision (book, pp. 236-237). Keep model changes under change control and data changes under the data owner's rules (book, pp. 237-238). Tie every change request to a competency question, assess its impact by re-running the questions, and send changes to existing elements to the authority (book, p. 238). Review the questions at least every quarter (book, p. 240).

The roles, cadence and the minimum to start with are on the [Governance Sheet](#governance-sheet). The pages used above are described in Competency Questions, Changes, Requests and Releases, Entity Form and Terms, Classes and Deprecation; the checks are in the Gate Report.

### Next stage

Check the model against real data and operate it in the [Validation and knowledge graph guide](#stage-guide-validation-and-knowledge-graph).

---

## Stage Guide: Validation and Knowledge Graph

The last stage of the book: check the model against real data, load that data, and run the result as something people rely on. The Pipeline page splits this stage in two, **Validation** (the shapes and their checks) and **Application** (the individuals), because the app counts them separately; this guide covers both, in the order you will usually do them. It follows the *IT landscape* example from [Worked Example: IT Landscape](#worked-example-the-it-landscape), and it is a recommended step, not a gate.

### What this stage is for

A knowledge graph is the model plus the data: real applications, owners and data categories, connected as the ontology says. This stage shows whether the model holds up against real data, and sets up the habits that keep it correct as the data and the domain change.

### Before you start

- An ontology exists with competency questions linked to classes and properties (see the [Ontology guide](#stage-guide-ontology)).
- You have **real data** from a real source system. The book is firm about this: not sample or made-up data (book, p. 307).
- You know the first few questions you want answered; three to five are enough to begin.

### Steps

1. **Run the shape checks.** Choose **Validation** in the navigation, then **Run Validation** on the SHACL validation tab. It evaluates every individual against the shapes and lists the violations per individual. Nothing is cached: each run starts fresh.
2. **Read the Gate report.** On the same page, open the **Gate report** tab. It lists model and data findings by stage, each with an **Open** link to where it is fixed.
3. **Look at the whole picture.** On the Pipeline **Overview**, read the stage strip of each namespace and the **Semantic debt** list. Every count links to the screen that shows it.
4. **Load the data.** For a catalog you already keep elsewhere, use the sync (see Backstage Catalog Sync). For a few individuals by hand, open a class's members and choose **+ Add**.
5. **Classify what has no class.** In **Identities**, set the class filter to **Unclassified (no class)** and give each individual a class (see Identities).
6. **Run the validation again.** New data breaks the shapes in ways the model did not show. Fix the data or the shape, whichever is wrong.
7. **Run all the competency questions on the real data.** On the Questions page, choose **Run all**. Questions that cannot be answered point at a gap in the data, the vocabulary or the model.
8. **Write down the gaps.** Keep a short gap analysis: what the questions showed about the data, the vocabulary and the model (book, p. 308). It is the list for the next iteration.
9. **Put it in front of real users.** Show the graph to people who will rely on it. Domain experts catch errors that engineers cannot, such as a link that holds in the model but not in the business. The read-only Review pages are made for this (book, p. 309).
10. **Set the maturity.** On the **Governance** page, set **Maturity** to POC, pilot or production as the work moves on. The three phases are below.
11. **Keep the rhythm.** Work the Semantic debt list, review the competency questions every quarter and update **Last reviewed**, and release through the Governance page when the change log has entries.

#### The three phases

- **Proof of concept.** Narrow: three to five competency questions, one or two source systems, a vocabulary and ontology just big enough for those questions, a populated store and a documented gap analysis. Nothing needs to be production grade, but everything must work (book, pp. 307-308).
- **Pilot.** The full set of priority questions, usually ten to twenty, more source systems, shapes checking every load, and real users. The pilot also tests the governance itself: can the vocabulary process keep pace with the data, does the change process work when people propose conflicting changes (book, pp. 308-309).
- **Production.** Not a launch but a change of footing: operational funding instead of project funding, quality measures instead of delivery dates, and a team that includes semantic skills, not only system administration (book, pp. 309-310).

### Done when

- [ ] Real data from a real source is loaded
- [ ] The shape validation runs and every violation is fixed or explained
- [ ] Individuals without a class are classified, or you know why not
- [ ] All competency questions have been run on the real data and the failing ones are on the gap list
- [ ] At least one domain expert has looked at the results
- [ ] Maturity is set to the phase you are in
- [ ] There is a review rhythm for the questions and the debt list

### Watch out for

- **Trying it on made-up data.** The model passes, then fails on the first real record. Use real data from the start.
- **Fixing the data to match a wrong model.** A violation can mean the shape is wrong. Ask the data's owner before changing either.
- **Mixing data changes and model changes.** An ontology change can invalidate data that was fine yesterday. Keep the two under separate rules (see Governance below).
- **Declaring a launch.** Production is the start of operation, not the end of the project. Plan the people who will look after it.

### What the app does not do

- It has no permissions per user: everyone who is signed in can edit. Who may change data and who may change the model is a rule you write down, not one the app enforces.
- It keeps no history of changed individuals. When a relation is updated, the old triple is replaced; the book recommends keeping it with a validity period so that history questions stay answerable (book, p. 239).
- It does not check every SHACL construct. Cardinality, datatype, class, length, pattern and `sh:sparql` constraints are checked; anything else is named in the banner of the report instead of being ignored.
- It does not run the shape checks on every load. Validation runs when you choose **Run Validation**, so make it part of the rhythm.
- It does not use a reasoner to assess the impact of a model change before it is made.
- It does not write the Backstage sync's changes to the model change log, because they are data and not model.

### Governance for this stage

Two kinds of governance, kept apart. **Data governance** asks who can add, change or remove triples. **Semantic governance** asks who can change the ontology: add a class, change a property's domain or range, add a rule. Programmes stall when the two are mixed (book, p. 311). Assess the impact of a semantic change before it is committed, and version the ontology so that the systems that use it can move on their own schedule (book, pp. 311-312). Use the pilot to test the governance process as well as the model (book, p. 309).

In the app, model changes go through a change request and the change log, a release sets the version, and the debt list and the quarterly review keep an eye on quality. Data arrives through the sync or by hand and is checked by the shapes. The roles, cadence and checklist are on the [Governance Sheet](#governance-sheet). The pages used above are described in SHACL/Structural Validation, Validation Report View, Gate Report, Pipeline View and Changes, Requests and Releases.

### Next stage

This is the last stage. Go back to the earlier ones whenever the data shows a gap: the order is a recommendation, and every stage can be revisited.

---

<div style="page-break-before: always"></div>

## Printable checklist

Tick the boxes on paper. Each list is copied from the section it belongs to.

### Steward checklist

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

### Vocabulary

- [ ] The scheme has a scope record
- [ ] Every term has one preferred label, written without brackets or an acronym
- [ ] Every preferred term has a definition that does not use the term itself
- [ ] No two terms share a preferred label unless a qualifier tells them apart
- [ ] Synonyms and abbreviations are alternative labels, and no alternative label equals another term's preferred label
- [ ] Every term has a source and an authority
- [ ] The Gate report shows no vocabulary warning that you have not decided about

### Metadata

- [ ] One entity has a written list of elements, each with a one-sentence definition
- [ ] Each system's use of those elements and the crosswalks between systems are written down
- [ ] Every element that takes a list of values points to a scheme in the vocabulary
- [ ] Every term has a source and an authority
- [ ] Steward, authority, maturity and version are filled in on the Governance page
- [ ] Each element that the model must keep is an attribute, with the right datatype and required or repeatable setting

### Taxonomy

- [ ] Every term has a parent or is a top concept of its scheme
- [ ] For every parent and child, "every child is a kind of the parent" is true
- [ ] Siblings do not overlap
- [ ] Branches are about equally deep, or the difference is explained
- [ ] Acronyms and project names are alternative labels, not preferred labels
- [ ] No definition uses the term itself
- [ ] The Gate report shows no taxonomy warning that you have not decided about

### Thesaurus

- [ ] Every related link joins concepts of different branches
- [ ] No related link joins siblings or a concept and its own ancestor
- [ ] Every mapping points to a concept of another scheme and uses the weakest kind that is true
- [ ] Every external vocabulary you map to is registered, or its IRI is recorded in full
- [ ] Synonyms and misspellings are on the concept as alternative and hidden labels
- [ ] The Gate report shows no thesaurus warning that you have not decided about
- [ ] A mapping review date is set

### Ontology

- [ ] Every question is written down, agreed with a domain expert and has an owner
- [ ] Every class and property can be traced to at least one question
- [ ] Every class is linked to the concept that defines it, or you know why not
- [ ] Every question is linked to the classes and properties it needs
- [ ] All questions have been run, and every failing one is explained
- [ ] Steward, authority, maturity and version are filled in
- [ ] Every model change since the last release went through a request, or has a reason in the log

### Validation and knowledge graph

- [ ] Real data from a real source is loaded
- [ ] The shape validation runs and every violation is fixed or explained
- [ ] Individuals without a class are classified, or you know why not
- [ ] All competency questions have been run on the real data and the failing ones are on the gap list
- [ ] At least one domain expert has looked at the results
- [ ] Maturity is set to the phase you are in
- [ ] There is a review rhythm for the questions and the debt list
