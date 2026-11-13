# Stage Guide: Thesaurus

The fourth stage: connect terms that belong together but are not in the same line of descent, and connect your vocabulary to other people's. This guide follows the *IT landscape* example from [Worked Example: IT Landscape](pipeline-example). It is a recommended step, not a gate.

## What this stage is for

The taxonomy says what is a kind of what. The thesaurus adds the links that a hierarchy cannot carry: *Application* is related to *Personal data* (an application processes it), and your *Personal data* is close in meaning to a term in a partner's glossary. Searches and programs can then widen a question from one term to its neighbours.

## Before you start

- A vocabulary and a taxonomy exist (see the [Taxonomy guide](guide-taxonomy)); relations only make sense between terms that are defined and placed.
- For mappings: the outside vocabulary is registered in the app. Open the Settings menu, choose **Manage**, then **External Vocabularies**, and add its prefix and base IRI. You can also type a full IRI without registering anything.
- Plan to do this stage as its own pass. The book recommends modelling vocabulary, taxonomy and thesaurus one after another and expects you to revise as you learn (p. 149).

## Steps

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

## Done when

- [ ] Every related link joins concepts of different branches
- [ ] No related link joins siblings or a concept and its own ancestor
- [ ] Every mapping points to a concept of another scheme and uses the weakest kind that is true
- [ ] Every external vocabulary you map to is registered, or its IRI is recorded in full
- [ ] Synonyms and misspellings are on the concept as alternative and hidden labels
- [ ] The Gate report shows no thesaurus warning that you have not decided about
- [ ] A mapping review date is set

## Watch out for

- **Mapping too strongly.** *exactMatch* says the two concepts are the same. If you only believe they are close, say *closeMatch*. Strong claims break when the other vocabulary changes.
- **Links that repeat the tree.** A related link that a parent already implies adds noise and no meaning.
- **Everything related to everything.** If most concepts have a dozen related links, none of them helps. Keep the few that someone would actually follow.
- **Forgetting the outside world moves.** A mapping points at a vocabulary you do not control. Check it when you review, not only when you create it.

## What the app does not do

- It does not check for related links between siblings; its gate only looks at a concept and its own ancestors, so step 5 stays with you.
- It does not flag concepts that have no relations at all.
- It does not model SKOS collections (named groups used for navigation) or `skos:notation` (a code from another classification system).
- It does not schedule or remind you of a mapping review.

## Governance for this stage

The thesaurus has no governance section of its own in the book; its rules come from the stages around it. Refine candidate terms into one reconciled, defined vocabulary and resist the pressure to keep ambiguous catch-alls (book, pp. 149-150). Build the review of mappings into the taxonomy governance cycle (book, p. 128). Check the structure with a quality tool for hierarchy cycles, colliding labels, missing documentation and related links that only repeat the tree (book, pp. 165-166).

In the app, the Gate report covers the checks it can, a change request records a decision to add or change a mapping, and the change log shows who did it. The cadence is on the [Governance Sheet](pipeline-governance). The relations are described in [Terms, Classes and Deprecation](terms-and-classes), the registered vocabularies in [External Vocabulary Management View](external-vocabulary-management-view), and the checks in the [Gate Report](gate-report).

## Next stage

Turn the agreed terms into classes, properties and shapes in the [Ontology guide](guide-ontology).
