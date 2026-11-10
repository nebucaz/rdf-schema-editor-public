# Vocabulary

The **Vocabulary** area (`/vocabulary`) is where the organisation's terms are kept and cared for. It is the first stage of the pipeline: agree on the words before drawing the classes that use them. Each term is a *concept* with a definition, synonyms and a history.

## Why a separate place for terms

A class on the canvas says "this kind of thing exists in the model". A concept says "this is what the word means". Keeping them apart lets the business agree on meaning without touching the model, and lets several classes point to one definition instead of each carrying its own copy.

Concepts live in their own graph (`<core>/vocab`) of one **core namespace**. Until a namespace is marked as the vocabulary namespace, the page offers to do that: pick the namespace and choose **Use as vocabulary namespace**. You can also tick *Vocabulary namespace* in the namespace settings. Only one namespace can carry the mark.

## A concept

| Field | SKOS term | What to write |
|---|---|---|
| Preferred label | `skos:prefLabel` | The one name to use, without parentheses. One per language. |
| Disambiguation | `rse:disambiguation` | A qualifier only when two terms share a name, such as *finance* for *Bank*. Add a scope note that tells the meanings apart. |
| Alternative labels | `skos:altLabel` | Synonyms and abbreviations. |
| Hidden labels | `skos:hiddenLabel` | Misspellings and retired terms: found by search, never shown. |
| Definition | `skos:definition` | Say what kind of thing it is, then what sets it apart. |
| Scope note | `skos:scopeNote` | Where the term applies and where it does not. |
| Scheme / Top concept | `skos:inScheme`, `skos:topConceptOf` | The vocabulary it belongs to. |
| Source, Authority | `rse:source`, `rse:authority` | Where the definition comes from and who answers for it. |

The concept's identifier is created once from the preferred label (and qualifier). Renaming the label later never changes it, so links stay valid.

## Avoiding duplicates

While you type a preferred label, the form compares it with every existing label, tolerating case, accents, plurals, word order and small typos. If the term already exists, reuse it: **Add as alternative label** records what you typed as a synonym of the existing concept instead of creating a second one.

## Status

A concept moves one step at a time: **proposed → approved → active → deprecated → retired**. An approved concept needs a definition.

**Deprecate** asks for a reason and, optionally, a replacement. Deprecating never deletes anything: the concept stays, marked deprecated, with the reason and date. If you pick a replacement, the old preferred label can be added to it as a hidden label, so a search for the old term still finds the new one.

**Delete** is for mistakes. It is refused while classes still point to the concept or other concepts sit below it; the page lists how many and offers *Delete anyway* if you really mean to remove those links.

## Schemes and their scope

A scheme groups concepts. Each scheme has a **scope record**: its purpose, the decisions it supports, what is out of scope and who the stakeholders are. Write it before collecting terms; it is what keeps a vocabulary from growing without limit.

## Linking classes to concepts

A class points to the concept that defines it (`rse:definedByConcept`), stored with the class in its own namespace. In the class form, search the vocabulary under *Defined by concept*, or pick one of the concepts suggested while you name a new class. A class never has two: choosing another replaces the link.

When a vocabulary namespace exists, classes without a concept carry a small **no concept** badge on the canvas. Turn the badge off with the book button in the canvas toolbar; it is not shown at all while no vocabulary namespace exists. Deleting a concept that classes still point to is refused until you deprecate it instead or confirm the removal of those links.

## Promoting a concept to a class

An **approved** or **active** concept can become a class: choose *Promote to class* on the concept and pick the namespace. The class is named from the preferred label and linked to the concept in one step; the definition is not copied, it stays in the vocabulary. Promoting is refused if a class with that name already exists in the namespace.

## Creating concepts for existing classes

*Create concepts for unlinked classes* starts from the classes you already have. It lists every class without a concept and proposes one **proposed** concept for each, taking the class label as the preferred label and the class description as the definition. Edit the label or definition, then accept one row or all of them.

- If a concept with the same label already exists, the class is linked to it instead of creating a duplicate. Classes that share a name across namespaces share the one concept.
- Everything accepted in one go is written in a single update, each link in the namespace of its class.
- Running it again lists nothing for classes that are already linked. The application's own internal classes are never listed.
