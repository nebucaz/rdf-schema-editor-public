# Stage Guide: Vocabulary

The first stage of the pipeline: agree on the words before you draw the classes that use them. This guide follows the *IT landscape* example from [Worked Example: IT Landscape](pipeline-example). The stage is a recommended first step, not a gate: nothing here blocks anything, and you can come back to it at any time.

## What this stage is for

A controlled vocabulary gives each thing in your domain one preferred name, a written definition and a list of the other names people use for it. It ends the argument about what a word means before that argument gets built into the model.

## Before you start

- You can sign in and open **Vocabulary** in the Ontology navigation.
- You know who will answer for the meaning of the terms (an authority) and where definitions come from (a source). If you do not know yet, you can still start and fill both in later.
- You have a rough list of the words people use. A service desk's ticket categories or an application inventory is a good source.

## Steps

1. **Choose the vocabulary namespace.** On the Vocabulary page, if the page says *No vocabulary namespace yet*, pick the namespace that will hold the terms and choose **Use as vocabulary namespace**. Only one namespace can carry the mark. *Why:* the terms live in their own graph of that namespace, apart from the classes.
2. **Create a scheme.** On the **Schemes** tab, choose **Add scheme** above the list, type a name (*IT landscape*) and choose **Create scheme**. A scheme groups concepts that belong together.
3. **Write the scope record before you collect terms.** Select the scheme and fill in **Purpose**, **Decisions supported**, **Out of scope** and **Stakeholders**, then save. *Why:* the scope record is what stops a vocabulary from growing without limit; the example's is in section 1 of the worked example.
4. **Collect candidate terms.** If the terms already exist in a spreadsheet or another SKOS file, choose **Import** on the Vocabulary page, **Preview import**, check the lists and choose **Apply import**: the terms arrive as proposed concepts you can then refine. Otherwise list every word in use, with duplicates and variants. Do not enter them yet. Decide which are one concept under several names (*Application*, *App*, *Software system*), which are one name for two concepts (*Service*) and which cannot be defined (*Other systems*): drop those.
5. **Add a concept.** On the **Concepts** tab, choose **Add concept** above the list. Type the **Preferred label** first. The form compares it with every label already in the vocabulary, ignoring case, accents, plurals and small typos. If it shows a similar concept, reuse it: choose **Add as alternative label** instead of creating a second one.
6. **Pick the preferred label.** Use the plain name your users would search for, without parentheses or colons, and without an acronym. Four words are the most you should need (book, p. 50). Keep the abbreviation (*API*) as an alternative label.
7. **Record the other names.** In **Alternative labels** (one per line) put synonyms and abbreviations. In **Hidden labels** put misspellings and retired terms: they are found by search but never shown.
8. **Write the definition.** In **Definition**, say what kind of thing it is, then what sets it apart. Do not use the term itself in the definition. Two sentences are enough (kind, then difference: book, p. 33).
9. **Tell homonyms apart.** When two meanings share a name, fill **Disambiguation** with a short qualifier (*technical*, *business*) and write a **Scope note** that says where each meaning applies. Do not put the qualifier in brackets in the label.
10. **Add examples and working notes.** In **Examples** (one per line) show how the term is used. In **Editorial notes** write internal remarks for editors: they never appear on read-only pages. If the term has a legacy code, put it in **Notation**. The concept's **History** below its details is generated from the change log; you do not write it.
11. **Record where it comes from.** Fill **Source** (where the definition comes from) and **Authority** (who answers for the meaning). Choose the **Scheme** and tick **Top concept** for the broadest terms of a branch. Choose **Save**.
12. **Approve.** A new concept starts as *proposed*. When the authority agrees, select the concept and choose **Mark approved**. An approved concept needs a definition. A concept moves one step at a time: proposed, approved, active, deprecated, retired.
13. **Run the checks.** Open the **Ontology** page, then the **Model checks** tab, and read the vocabulary findings: missing definitions, duplicate labels, labels that clash, acronyms as preferred labels, label style. The Vocabulary list also shows a badge with the number of findings on each concept. Fix what is wrong, or decide to leave it and say why.
14. **Merge a duplicate you find later.** If two concepts turn out to be one idea, open the one that should go and choose **Merge into…**, then pick the concept to keep. The preview lists everything that moves (labels, relations, collections, the classes that point at it) and what it leaves out; decide any conflict between two definitions or two notations, then choose **Merge**. The old concept stays as a retired entry that points to the one you kept.
15. **Retire a term with care.** Do not delete. Select the concept and choose **Deprecate**, give the reason and, if there is one, the replacement. Tick the option that adds the old label to the replacement as a hidden label, so a search for it still finds the new concept. **Delete** is for mistakes only. A retired concept is no longer offered as a value of a concept property, and the Model checks lists individuals that still hold it (see "Concept properties" in the [Pipeline Guide](pipeline-guide)).

## Done when

- [ ] The scheme has a scope record
- [ ] Every term has one preferred label, written without brackets or an acronym
- [ ] Every preferred term has a definition that does not use the term itself
- [ ] No two terms share a preferred label unless a qualifier tells them apart
- [ ] Synonyms and abbreviations are alternative labels, and no alternative label equals another term's preferred label
- [ ] Every term has a source and an authority
- [ ] The Model checks shows no vocabulary warning that you have not decided about

## Watch out for

- **Terms that mean two things.** Merging them into one concept hides the problem. Give each meaning its own concept and a qualifier.
- **Long compound labels.** *Enterprise Wide Customer Facing Mobile Banking Application* is a hierarchy in disguise. Split it into a broader and a narrower term.
- **Catch-all terms.** *Other*, *Misc* and *General* cannot be defined and attract anything. Refuse them, even under pressure.
- **Circular definitions.** "An application owner owns an application" tells nobody anything. Say what kind of thing it is first.

## What the app does not do

- It has no committee or membership list, and no decision matrix for accepting a term.
- It has no field for acceptance evidence (how often the term appears, a regulation, user confusion) and does not measure how often a term is used.
- It does not force a term through any approval: *Mark approved* is available to everyone who is signed in.

## Governance for this stage

Decide *before* the vocabulary is shared how a new term gets in, and write the rule down. The book suggests grounding acceptance in evidence: how often people use the term, a regulatory need, a business priority, or visible confusion (p. 50). Say who can ask for a change, who approves it, how often you review, and how terms are versioned and retired (p. 50). A request names who asks, the proposed term, definition and relations, and the reason; a rejection gives its reason; a synonym becomes an alternative label instead of a new term (p. 51). Before each release, check that there are no cycles, every preferred term has a definition, no labels are duplicated and no alternative label clashes with another term (p. 51).

In the app, use a change request for a term that needs a decision, and read the change log to see who changed what. The roles, the cadence and the minimum to start with are on the [Governance Sheet](pipeline-governance). Every check named above is a gate in the [Model Checks](gate-report); fields and statuses are described in [Vocabulary](vocabulary), and homonyms and deprecation in [Terms, Classes and Deprecation](terms-and-classes).

## Next stage

Record the facts about each term and the model around it in the [Metadata guide](guide-metadata).
