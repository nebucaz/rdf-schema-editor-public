# Stage Guide: Metadata

The second stage: decide what facts you keep *about* things, and who looks after those facts. This guide follows the *IT landscape* example from [Worked Example: IT Landscape](pipeline-example). It is a recommended step, not a gate.

**A note up front.** The book's answer for this stage is a *metadata application profile*: a document that declares the elements you use, how each system uses them, and how they map to one another. This app has no profile editor. So the guide does two things and says which is which: steps marked **on paper** are method, done in a spreadsheet or a document; steps marked **in the app** use screens that exist today.

## What this stage is for

Metadata is data about data: who owns an application, when it was last confirmed, where a definition comes from. This stage makes those facts explicit and consistent, so that the vocabulary before it and the ontology after it describe things in the same way.

## Before you start

- A first version of the vocabulary exists (see the [Vocabulary guide](guide-vocabulary)), so that elements can use its terms as their allowed values.
- You know which systems keep facts about your things today. In the example: the application inventory and the service desk's ticket tool.
- You have decided who will be steward and who will be authority for the model. If you do not know yet, you can still start.

## Steps

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
12. **Version and review.** Treat the profile as living documentation: change it through a change request, let the change log record the decision, and raise the **Version** on release (see [Changes, Requests and Releases](changes-and-releases)).

## Done when

- [ ] One entity has a written list of elements, each with a one-sentence definition
- [ ] Each system's use of those elements and the crosswalks between systems are written down
- [ ] Every element that takes a list of values points to a scheme in the vocabulary
- [ ] Every term has a source and an authority
- [ ] Steward, authority, maturity and version are filled in on the Governance page
- [ ] Each element that the model must keep is an attribute, with the right datatype and required or repeatable setting

## Watch out for

- **Treating metadata as a by-product.** If nobody owns the elements, each team invents its own and nothing lines up. Name an owner for every element.
- **One schema to rule them all.** The book does not ask for one global schema. Let each system's owner document their own use and keep the crosswalks central (book, p. 78).
- **Starting wide.** Cover one entity first, then add elements bit by bit (book, p. 79).
- **Using the same field for two meanings.** A field that means "owner" in one record and "operator" in another breaks every query that joins them.

## What the app does not do

- It has no metadata application profile: you cannot declare a profile, version it or compare it with another one in the app. Steps 1 to 6 stay on paper.
- It has no crosswalk editor and no per-system profile view.
- It has no metadata gates. The Gate report checks terms, classes and shapes, not the completeness of a profile.
- It does not enforce who may add an element.

## Governance for this stage

The book asks that governance and meaning are designed together, not split between a data governance team and a separate semantic team (p. 68). A profile governs in three ways: every element is precisely defined, a new meaning gets a new element through a formal process, and rules enforce the profile (pp. 76-77). Version the profile, track changes, and let the owners of each system keep their own metadata while one place coordinates the standards and automates checks (p. 79). One organisation described in the book asked every system owner to submit a revised profile every quarter (p. 78).

In the app, record steward, authority, maturity and version on the Governance page, use a change request for each new or changed element, and read the change log for the history. The roles and cadence are on the [Governance Sheet](pipeline-governance). Fields of the forms used above are in [Attribute Form](attribute-form) and [Catalog Metadata Form](catalog-metadata-form); the fields of a term are in [Vocabulary](vocabulary).

## Next stage

Arrange the terms from general to specific in the [Taxonomy guide](guide-taxonomy).
