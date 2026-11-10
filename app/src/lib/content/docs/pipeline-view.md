# Pipeline View

The **Pipeline** page shows, for each namespace, where it stands in six stages: vocabulary, taxonomy, thesaurus, ontology, validation and application.

## Recommended order, not a rule

The order is a suggestion: a controlled vocabulary of terms first, then how the terms relate (taxonomy, thesaurus), then the ontology, then the checks, then the data. Work on any stage at any time and return to earlier ones. Nothing on this page, and no stage, blocks or disables anything.

## What each stage shows

- **Vocabulary, taxonomy, thesaurus**: *Not started* until the core vocabulary exists.
- **Ontology**: the number of classes and properties, the gate findings for them, and the competency questions linked to the namespace: how many, how many of those that have been run pass, and any regression. A line under the namespaces counts the questions not linked to anything yet.
- **Validation**: the number of SHACL shapes of the namespace.
- **Application**: the number of individuals, and the gate findings for them.

A stage without data is shown as *Not started*; that is a state, not an error.

## Links

Every count links to the screen that lists it: classes and properties to the Schema canvas, findings to the Gate report, questions to the Questions page, individuals to the Identities browser filtered to the namespace.

The page uses the schema that is already loaded plus the competency question results, and sends no other requests.
