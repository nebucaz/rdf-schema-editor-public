# Competency Questions

A **competency question** is a plain-language question that the finished model must be able to answer, and for which there is a definite answer. They are the contract between the people who need the model and the people who build it.

## Why use them

The book (*The Ontology Pipeline*, pp. 192-193) calls this the first and most important design discipline in ontology engineering. The questions do three jobs:

- **Scope.** The model has to cover what the questions imply, and nothing else is needed. A question you decide *not* to answer is a deliberate exclusion that prevents scope creep. A class or property that no question needs is a candidate to leave out.
- **Acceptance criteria.** When the model answers every question, it is complete for its intended scope, like a passing test suite. A question that fails (nothing returned, or the wrong thing) shows a gap and where to dig.
- **Communication.** Domain experts who cannot read RDF or SPARQL can judge the questions. The set is the shared contract between those who know the domain and those who formalise it. Walk through every question with a domain expert before writing the first triple.

The questions surface what the model must answer before the first modelling decision is made, which is why they are written first. They are anchored at the **ontology** stage: each question is linked to the classes and properties it needs, and the Overview shows the question statistics in the ontology box of each namespace.

## A good question

- Asks for something definite: *"Which applications process personal data?"* is a question; *"Improve supply chain visibility"* is a goal.
- Is written before the classes and properties it needs, and agreed with a domain expert.
- Is small enough to have one query and one expected result. Split a question that has several answers to check.

## The fields

- **Question** — the question in your own words.
- **Expected result** — one of:
  - *At least N rows*: a SELECT query must return N or more rows.
  - *ASK is true* or *ASK is false*: an ASK query must give that answer.
  - *Rows contain these values*: a SELECT query must return all the listed values.
- **Query** — your own SPARQL, or a saved query from the Query Workbench. An ASK expectation needs an ASK query; the others need a SELECT. The form checks this when you save a query written in place.
- **Linked classes and properties** — the model elements the question needs. This is how you see which part of the model each question justifies.
- **Owner** and **Last reviewed** — who looks after the question, and when it was last confirmed to still matter.

## Running them

The **Results** table on the Questions page has **Run all** and a **Run** button per question. Questions run one after another, not in parallel, so the database is not overloaded.

For each question you see:

- **Pass** or **Fail**, compared with the expected result, and the answer found (for example `3 rows`, or `true`).
- **Error**, with the message, when the query itself could not run: a syntax error, a timeout, or a saved query that was deleted. An error is not a fail, because it says nothing about the model.
- **Regression**, when the question passed in the run before and fails now. This is the signal that a recent change broke something agreed.
- The duration and the time of the last run.
- A **history strip**: one cell per stored run (the last 10), oldest to newest, green for pass and red for fail or error.

Questions are checked against the asserted data only, without reasoning, the same way the rest of the editor reads the repository. A relation that is only implied by a rule will not be found.

The results are also linked from the Validation page, next to the SHACL report.

## Where they are stored

Each question is a node in the default namespace's schema graph, next to the saved queries. They are listed under **Questions** in the main navigation.

## Competency questions as a governance instrument

The book (p. 240) treats the question set as the test harness of the ontology, much like a test suite in software development:

- An ontology that can still answer all its original questions is **healthy**. One that cannot, because a term was changed, a range narrowed or a class removed, has **regressed**. Governance has to track question coverage across versions, not only whether the elements are complete.
- The set is **reviewed periodically**, at least quarterly. A new question that the model cannot answer is a **scope change request**. A question that is no longer relevant is a candidate for deprecation. A question the model should answer but answers wrongly is a **defect** to fix.
- Without this review the model drifts away from the domain, and the damage stays invisible until a query returns an answer a domain expert knows is wrong.

In the app: the Results table flags regressions, a change request without a question can only be returned or marked a scope change, the **review period** setting and the semantic debt list flag questions whose review is overdue, and the **Last reviewed** field records each review. See [Changes, Requests and Releases](changes-and-releases).
