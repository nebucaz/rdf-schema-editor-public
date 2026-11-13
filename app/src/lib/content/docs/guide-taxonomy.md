# Stage Guide: Taxonomy

The third stage: arrange the agreed terms from general to specific, so that every term has a place and every place makes sense. This guide follows the *IT landscape* example from [Worked Example: IT Landscape](pipeline-example). It is a recommended step, not a gate: you can start with a short list and refine the hierarchy as you learn.

## What this stage is for

A taxonomy puts each term under a broader one (*Web application* under *Application*, *Application* under *Software*). It gives people and programs a way to browse from the general to the specific, and to find everything of a kind.

## Before you start

- A vocabulary with defined terms exists (see the [Vocabulary guide](guide-vocabulary)); every term you will place has a definition.
- You have a scheme to hold the hierarchy. The outline works on one scheme at a time.
- Optional but useful: some classes already exist on the Schema canvas, so you can compare the two hierarchies.

## Steps

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
12. **Retire, don't delete.** When a term is superseded, **Deprecate** it with a reason and its replacement, so that old tagging still finds the new term (see [Terms, Classes and Deprecation](terms-and-classes)).

## Done when

- [ ] Every term has a parent or is a top concept of its scheme
- [ ] For every parent and child, "every child is a kind of the parent" is true
- [ ] Siblings do not overlap
- [ ] Branches are about equally deep, or the difference is explained
- [ ] Acronyms and project names are alternative labels, not preferred labels
- [ ] No definition uses the term itself
- [ ] The Gate report shows no taxonomy warning that you have not decided about

## Watch out for

- **Mixed depth.** One branch with five levels and another with two makes browsing feel random. Balance them or explain the difference.
- **Orphans.** A term that fits nowhere often points to a missing top-level category, or to scope creep. Revisit the top level before forcing it under a bad parent.
- **Overlapping categories.** If something can legitimately be in two siblings, refine the definitions or restructure. A term with two parents is allowed and the outline marks it as *multiple parents*, but use it sparingly and never as a way around unclear boundaries (book, p. 115).
- **Hierarchy by habit.** Do not copy the org chart or the folder tree. Test every link with "is every X a kind of Y?".

## What the app does not do

- It does not review a taxonomy change the way a code change is reviewed: there is no branch, pull request or approval step. The nearest things are a change request and the change log.
- It does not stop a move. The is-a question is a prompt; a move that would create a cycle is refused, anything else is your decision.
- It cannot tell whether siblings truly exclude each other. The overlap gate only compares their definitions, so the check in step 5 stays with you.

## Governance for this stage

Treat the taxonomy like production code: changes should be deliberate, reviewed and reversible (book, p. 134). Validate on every change: one preferred label per language, no label used in two roles of one concept, no cycles, no top concept with a broader concept (book, pp. 134-135). Give each concept a lifecycle from proposed to retired, with notes that say what changed and why, and keep the old label findable on the replacement (book, p. 135). A deprecated term that is not handled properly keeps being used and the tagging drifts (book, p. 135). Use the quality checklist before you call a branch final (book, pp. 115, 137).

In the app, the five statuses are the same lifecycle, a change request records the decision, and the change log shows who changed what. Review mappings with each taxonomy review. Roles and cadence are on the [Governance Sheet](pipeline-governance); every check above is in the [Gate Report](gate-report); the outline itself is described in [Terms, Classes and Deprecation](terms-and-classes) and the fields of a term in [Vocabulary](vocabulary).

## Next stage

Link related terms and map them to other vocabularies in the [Thesaurus guide](guide-thesaurus).
