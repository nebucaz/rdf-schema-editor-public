# Stage Guide: Ontology

The fifth stage: turn the agreed terms into classes, properties and shapes that can answer real questions, and keep them healthy as things change. This guide follows the *IT landscape* example from [Worked Example: IT Landscape](pipeline-example). It is a recommended step, not a gate. The one thing the book insists on first is writing the questions down, and that is where this guide starts.

## What this stage is for

An ontology is the model: what kinds of things exist, how they relate, and what rules their data must follow. Each class, property and rule should earn its place by helping to answer a question someone actually has.

## Before you start

- You have a vocabulary with defined terms (see the [Vocabulary guide](guide-vocabulary)). Classes can point to the concept that defines them, so the definition is written once.
- You have a domain expert you can ask. The questions in step 2 need their agreement.
- You know who is steward and who is authority, or you are ready to record them in step 12.

## Steps

1. **Open the questions page.** Choose **Questions** in the Pipeline navigation. The page lists the questions, what each expects, which classes and properties it needs, its owner and when it was last reviewed.
2. **Write the competency questions first, before the first modelling decision.** Choose **Add question** and write each question the model must be able to answer, in the words of the people who will ask. In the example: *Which applications process personal data?* Agree the list with a domain expert (book, pp. 192-193).
3. **Say what a good answer looks like.** In the form, describe the expected result (at least some rows, or a yes or no) and how to check it: your own SPARQL query or a saved query. Fill in **Owner**, so that someone looks after the question.
4. **Work out what each question needs.** For each question, list the classes, properties and rules it implies. *Which applications process personal data?* needs a class *Application*, a class *Data category* and a relation *processes* between them (book, pp. 201-202). Every class and property should trace back to a question.
5. **Look for existing standards first.** Before you invent a term, check what exists: Dublin Core, DCAT, PROV-O, Schema.org, FOAF. Register an outside vocabulary and use its terms where they fit (book, p. 202).
6. **Draw the classes.** On the Schema canvas, use **+ Add Entity** (the toolbar split button, or Option/Alt+click on the canvas). Link each class to the concept that defines it with **Defined by concept**, or start from an approved concept with **Promote to class** in the Vocabulary area. The definition stays with the concept.
7. **Add attributes and relations.** On a class, choose **+ Add attribute** for facts such as a date, with a datatype and required or repeatable. Drag from one class to another to draw a relation. Attributes and relations bring their SHACL shape constraint with them, which is the rule your data is validated against later (see [Attribute Form](attribute-form) and [Relation Form](relation-form)).
8. **Link the questions to the model.** Edit each question and, under **Linked classes and properties**, tick what it needs. A question with nothing linked is a question the model cannot yet answer.
9. **Run all the questions.** On the Questions page, choose **Run all**. A question that used to pass and now fails is marked **Regression**. A model that still answers its original questions is healthy; one that cannot has regressed (book, p. 240).
10. **Handle a failing question.** Decide: is the model missing something (change the model), is the question wrong or out of date (change or deprecate the question), or is the question right and the answer wrong (a defect, fix it first).
11. **Change the model through a request.** On the **Governance** page choose **New request**: name the proposed term, definition or relations, the reason and the competency question that justifies it. A request without a question can only be returned or marked as a scope change on purpose. Choose **Start review**, then **Assess impact** to see which questions and gate findings changed since the request was made. Decide with **Approve** or the other outcomes, with a rationale. An approved request adds an entry to the change log (book, p. 238).
12. **Name the owners and release.** In *Owners and version* on the Governance page fill **Steward**, authority, maturity and version. When the change log has entries, choose **Release…**: the dialog suggests how the version moves (patch, minor or major) and you confirm or override. Additions are minor; removing or renaming a class or changing a domain or range is major (book, pp. 236-237).
13. **Review the questions every quarter.** Update **Last reviewed** on each question you checked. A new question the model cannot answer is a scope change request; an obsolete one is a candidate for deprecation (book, p. 240).

## Done when

- [ ] Every question is written down, agreed with a domain expert and has an owner
- [ ] Every class and property can be traced to at least one question
- [ ] Every class is linked to the concept that defines it, or you know why not
- [ ] Every question is linked to the classes and properties it needs
- [ ] All questions have been run, and every failing one is explained
- [ ] Steward, authority, maturity and version are filled in
- [ ] Every model change since the last release went through a request, or has a reason in the log

## Watch out for

- **Modelling before asking.** A model drawn before the questions exist answers nothing in particular. Write the questions first.
- **Classes without a question.** If you cannot say which question a class helps to answer, you probably do not need it yet.
- **Stretching one property.** Do not reuse a property for a second meaning. Add a new one and define it.
- **Hiding a defect in a scope change.** A question the model should answer but answers wrongly is a defect. Do not file it as a scope change to avoid fixing it.

## What the app does not do

- It does not use a reasoner to assess impact. **Assess impact** re-runs the questions and gates and shows what they say now; it does not infer what else would change.
- It does not enforce the split between steward and authority. Nothing stops a steward from approving a change that the book would send to the authority.
- It does not edit disjointness or functional-property declarations, which the book discusses.
- It does not keep a separate version for instance data: the version is the ontology's.

## Governance for this stage

Ownership is the first requirement: a named **steward** who looks after the health of the ontology (drift, documentation, the test suite) and a named **authority** who approves changes. The practical minimum is both roles named, plus a change log that records the reason for every model change. A small organisation can have one person hold both (book, pp. 235-236). Number each release with major, minor and patch, so every version is a deliberate decision (book, pp. 236-237). Keep model changes under change control and data changes under the data owner's rules (book, pp. 237-238). Tie every change request to a competency question, assess its impact by re-running the questions, and send changes to existing elements to the authority (book, p. 238). Review the questions at least every quarter (book, p. 240).

The roles, cadence and the minimum to start with are on the [Governance Sheet](pipeline-governance). The pages used above are described in [Competency Questions](competency-questions), [Changes, Requests and Releases](changes-and-releases), [Entity Form](entity-form) and [Terms, Classes and Deprecation](terms-and-classes); the checks are in the [Gate Report](gate-report).

## Next stage

Check the model against real data and operate it in the [Validation and knowledge graph guide](guide-knowledge-graph).
