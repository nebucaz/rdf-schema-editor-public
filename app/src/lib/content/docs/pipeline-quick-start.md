# Ontology Pipeline: Quick Start

You do not need to read the whole book to use this. Five steps, about ten minutes to set up. Everything is optional and in a recommended order only.

## 1. Choose the namespaces that follow the pipeline

Open **Settings, Manage, Namespaces**, edit a namespace and tick **Part of the ontology pipeline**. It is off by default. Only ticked namespaces are listed on the **Pipeline** Overview. Other namespaces keep working as before.

## 2. Write the competency questions

Go to **Pipeline, Questions** and add the questions the model must answer ("Which applications process personal data?"). The book calls this the first design discipline of the ontology stage (pp. 192-193): do it before the first modelling decision, and agree the list with a domain expert. Link each question to the classes and properties it needs; the Overview then shows the statistics in the ontology box. The same questions later guard against drift (p. 240). See [Competency Questions](competency-questions).

## 3. Agree the terms

**Pipeline, Vocabulary**: add the terms people use, each with a definition. **Taxonomy** arranges them from general to specific. See [Vocabulary](vocabulary).

## 4. Model it

On the **Schema** canvas draw classes, properties and shapes. Link each class to its term so the definition is written once. See [Terms, Classes and Deprecation](terms-and-classes).

## 5. Check, change and release

- Run all questions on the Questions page; a question that used to pass and now fails is a regression.
- Work through the **semantic debt** list on the Overview: each item has an Open link to where it is fixed.
- Record decisions in **Governance**: owners, change requests, the change log and releases. See [Changes, Requests and Releases](changes-and-releases).

## Who does what

See [Roles](pipeline-guide) in the pipeline guide.

## Lost?

The Overview shows each namespace per stage, with *Not started* where nothing exists yet. Start with the stage that has counts you recognise, or with the questions.
