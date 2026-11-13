# Stage Guide: Validation and Knowledge Graph

The last stage of the book: check the model against real data, load that data, and run the result as something people rely on. The Pipeline page splits this stage in two, **Validation** (the shapes and their checks) and **Application** (the individuals), because the app counts them separately; this guide covers both, in the order you will usually do them. It follows the *IT landscape* example from [Worked Example: IT Landscape](pipeline-example), and it is a recommended step, not a gate.

## What this stage is for

A knowledge graph is the model plus the data: real applications, owners and data categories, connected as the ontology says. This stage shows whether the model holds up against real data, and sets up the habits that keep it correct as the data and the domain change.

## Before you start

- An ontology exists with competency questions linked to classes and properties (see the [Ontology guide](guide-ontology)).
- You have **real data** from a real source system. The book is firm about this: not sample or made-up data (book, p. 307).
- You know the first few questions you want answered; three to five are enough to begin.

## Steps

1. **Run the shape checks.** Choose **Validation** in the navigation, then **Run Validation** on the SHACL validation tab. It evaluates every individual against the shapes and lists the violations per individual. Nothing is cached: each run starts fresh.
2. **Read the Gate report.** On the same page, open the **Gate report** tab. It lists model and data findings by stage, each with an **Open** link to where it is fixed.
3. **Look at the whole picture.** On the Pipeline **Overview**, read the stage strip of each namespace and the **Semantic debt** list. Every count links to the screen that shows it.
4. **Load the data.** For a catalog you already keep elsewhere, use the sync (see [Backstage Catalog Sync](backstage-catalog-sync)). For a few individuals by hand, open a class's members and choose **+ Add**.
5. **Classify what has no class.** In **Identities**, set the class filter to **Unclassified (no class)** and give each individual a class (see [Identities](identities-area)).
6. **Run the validation again.** New data breaks the shapes in ways the model did not show. Fix the data or the shape, whichever is wrong.
7. **Run all the competency questions on the real data.** On the Questions page, choose **Run all**. Questions that cannot be answered point at a gap in the data, the vocabulary or the model.
8. **Write down the gaps.** Keep a short gap analysis: what the questions showed about the data, the vocabulary and the model (book, p. 308). It is the list for the next iteration.
9. **Put it in front of real users.** Show the graph to people who will rely on it. Domain experts catch errors that engineers cannot, such as a link that holds in the model but not in the business. The read-only Review pages are made for this (book, p. 309).
10. **Set the maturity.** On the **Governance** page, set **Maturity** to POC, pilot or production as the work moves on. The three phases are below.
11. **Keep the rhythm.** Work the Semantic debt list, review the competency questions every quarter and update **Last reviewed**, and release through the Governance page when the change log has entries.

### The three phases

- **Proof of concept.** Narrow: three to five competency questions, one or two source systems, a vocabulary and ontology just big enough for those questions, a populated store and a documented gap analysis. Nothing needs to be production grade, but everything must work (book, pp. 307-308).
- **Pilot.** The full set of priority questions, usually ten to twenty, more source systems, shapes checking every load, and real users. The pilot also tests the governance itself: can the vocabulary process keep pace with the data, does the change process work when people propose conflicting changes (book, pp. 308-309).
- **Production.** Not a launch but a change of footing: operational funding instead of project funding, quality measures instead of delivery dates, and a team that includes semantic skills, not only system administration (book, pp. 309-310).

## Done when

- [ ] Real data from a real source is loaded
- [ ] The shape validation runs and every violation is fixed or explained
- [ ] Individuals without a class are classified, or you know why not
- [ ] All competency questions have been run on the real data and the failing ones are on the gap list
- [ ] At least one domain expert has looked at the results
- [ ] Maturity is set to the phase you are in
- [ ] There is a review rhythm for the questions and the debt list

## Watch out for

- **Trying it on made-up data.** The model passes, then fails on the first real record. Use real data from the start.
- **Fixing the data to match a wrong model.** A violation can mean the shape is wrong. Ask the data's owner before changing either.
- **Mixing data changes and model changes.** An ontology change can invalidate data that was fine yesterday. Keep the two under separate rules (see Governance below).
- **Declaring a launch.** Production is the start of operation, not the end of the project. Plan the people who will look after it.

## What the app does not do

- It has no permissions per user: everyone who is signed in can edit. Who may change data and who may change the model is a rule you write down, not one the app enforces.
- It keeps no history of changed individuals. When a relation is updated, the old triple is replaced; the book recommends keeping it with a validity period so that history questions stay answerable (book, p. 239).
- It does not check every SHACL construct. Cardinality, datatype, class, length, pattern and `sh:sparql` constraints are checked; anything else is named in the banner of the report instead of being ignored.
- It does not run the shape checks on every load. Validation runs when you choose **Run Validation**, so make it part of the rhythm.
- It does not use a reasoner to assess the impact of a model change before it is made.
- It does not write the Backstage sync's changes to the model change log, because they are data and not model.

## Governance for this stage

Two kinds of governance, kept apart. **Data governance** asks who can add, change or remove triples. **Semantic governance** asks who can change the ontology: add a class, change a property's domain or range, add a rule. Programmes stall when the two are mixed (book, p. 311). Assess the impact of a semantic change before it is committed, and version the ontology so that the systems that use it can move on their own schedule (book, pp. 311-312). Use the pilot to test the governance process as well as the model (book, p. 309).

In the app, model changes go through a change request and the change log, a release sets the version, and the debt list and the quarterly review keep an eye on quality. Data arrives through the sync or by hand and is checked by the shapes. The roles, cadence and checklist are on the [Governance Sheet](pipeline-governance). The pages used above are described in [SHACL/Structural Validation](shacl-validation), [Validation Report View](validation-report-view), [Gate Report](gate-report), [Pipeline View](pipeline-view) and [Changes, Requests and Releases](changes-and-releases).

## Next stage

This is the last stage. Go back to the earlier ones whenever the data shows a gap: the order is a recommendation, and every stage can be revisited.
