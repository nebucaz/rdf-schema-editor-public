# Vocabulary

The **Vocabulary** area (`/vocabulary`) is where the organisation's terms are kept and cared for. It is the first stage of the pipeline: agree on the words before drawing the classes that use them. Each term is a *concept* with a definition, synonyms and a history.

## Why a separate place for terms

A class on the canvas says "this kind of thing exists in the model". A concept says "this is what the word means". Keeping them apart lets the business agree on meaning without touching the model, and lets several classes point to one definition instead of each carrying its own copy.

Concepts live in their own graph (`<core>/vocab`) of one **core namespace**. Until a namespace is marked as the vocabulary namespace, the page offers to do that: pick the namespace and choose **Use as vocabulary namespace**. You can also tick *Vocabulary namespace* in the namespace settings. Only one namespace can carry the mark.

## Tabs: Concepts, Schemes, Collections

The page has three tabs, kept in the address (`?tab=concepts|schemes|collections`, and `?concept=` for the open concept), so a link opens the same view. Each tab has a search box, a paged list and its own **Add concept**, **Add scheme** or **Add collection** button above the list; **Import** and **Export** stay in the page header.

- **Concepts** searches preferred, alternative and hidden labels on the server and pages through the results, so a vocabulary of thousands of concepts stays quick. Filter by scheme or status. A selected concept shows a **Neighbourhood** graph of its broader, narrower and related concepts.
- **Schemes** lists each scheme with its number of concepts, top concepts and *orphans* (concepts with no broader, narrower, related or mapped concept that are not top concepts, as in Scheme health). A scheme with no name shows the last part of its IRI. Selecting one opens its scope record, metadata and links to its concepts, the taxonomy and the printable view. **Delete scheme** removes the scheme together with its concepts. If it has concepts, the dialog first tells you how many concepts go, which class links and collection memberships are removed with them, and which concept properties take its values (those stay, and the Gate report flags them); nothing is deleted until you confirm. The change log records the removal. Use it for a sample or a mistake: to retire a term in use, deprecate it instead.
- **Collections** lists the named groups of concepts. A collection is a set of concepts that belong together without being broader or narrower than each other (for example *Regions*), either unordered or ordered; it does not change the hierarchy.

## A concept

| Field | SKOS term | What to write |
|---|---|---|
| Preferred label | `skos:prefLabel` | The one name to use, without parentheses. One per language. |
| Disambiguation | `rse:disambiguation` | A qualifier only when two terms share a name, such as *finance* for *Bank*. Add a scope note that tells the meanings apart. |
| Alternative labels | `skos:altLabel` | Synonyms and abbreviations. |
| Hidden labels | `skos:hiddenLabel` | Misspellings and retired terms: found by search, never shown. |
| Definition | `skos:definition` | Say what kind of thing it is, then what sets it apart. |
| Scope note | `skos:scopeNote` | Where the term applies and where it does not. |
| Notation | `skos:notation` | A legacy or system code, such as a spreadsheet ID. Found by search. |
| Examples | `skos:example` | How the term is used in practice. |
| Editorial notes | `skos:editorialNote` | Internal working notes. Never shown on read-only pages. |
| Scheme / Top concept | `skos:inScheme`, `skos:topConceptOf` | The vocabulary it belongs to. |
| Source, Authority | `rse:source`, `rse:authority` | Where the definition comes from and who answers for it. |

The concept's **History** (`skos:historyNote`) is not typed in: it lists the change-log entries about the concept, with who, when and in which version, and nothing is stored for it.

The concept's identifier is created once from the preferred label (and qualifier). Renaming the label later never changes it, so links stay valid.

## Importing terms

Choose **Import** on the Vocabulary page to bring in a SKOS Turtle file or a spreadsheet saved as CSV. The file is read in your browser and **Preview import** compares it with the vocabulary before anything is written, in five lists: *New*, *Changed*, *Conflicting* (the same identifier with a different preferred label, or a notation already used in the scheme), *Similar* (a new term that looks like an existing one: say it is the *same as* that concept, and only its labels and links are added) and *Skipped* (what the import does not read, such as SKOS-XL, and anything that is not SKOS). Nothing is skipped silently. New concepts are tick boxes; for a changed or conflicting one you choose *Keep existing*, *Take imported* or *Skip*. **Apply import** then writes everything chosen in one step. New concepts start as *proposed* with the file name as their source, the change log gets one entry, and the gates run on what was imported. Importing the same file again changes nothing. A CSV uses the same columns as the export, or one column per level (`L1`, `L2`, `L3`) for an indented glossary; columns the import does not know can be mapped in the wizard.

**Where it lands.** An import always writes into the vocabulary graph of the core namespace. Under **Where it lands**, after you choose the file, you can also decide two things. **Use my own IRIs instead of the file's** (Turtle) replaces the start of every IRI in the file (the dialog suggests the start the concepts share) with one you choose, for example your core namespace, and updates every link, mapping and collection member to match; IRIs outside that start, such as mappings to other vocabularies, stay as they are. **Scheme for every concept** puts all concepts into one existing scheme, or into a new scheme you name; the file's own schemes are then not imported and each concept keeps its top-concept mark. Both choices only change what the preview shows and what is written; the file is not touched. Importing the same file later with the same choices finds the concepts again, because their IRIs come out the same.

## Exporting the vocabulary

Choose **Export** on the Vocabulary page to download one scheme or all schemes. **Turtle** is standard SKOS that other tools can read: every `broader` comes with its `narrower`, both halves of every `related` pair are stated, and the scheme's Dublin Core description and your collections are included. Editorial notes and project fields (`rse:`) are left out unless you tick **Include editorial notes** or **Include project predicates**. **Add skos:exactMatch from classes to concepts** writes that link in the file only; the app keeps its own link. **Include SHACL shapes** adds a second file that checks every concept has a label per language, a definition and a scheme. **CSV** opens in a spreadsheet: one row per concept, with `;` between several values and the broader and related concepts written as `label <iri>`. The export only reads; it changes nothing in the repository.

## Browsing, printing and sharing

Signed-in readers can use the read-only pages without any editing right: **Glossary** (`/review/glossary`) lists the concepts alphabetically or as a tree, searches preferred, alternative and hidden labels and notation, and shows the definition, relations and the classes defined by a concept. Hidden labels and editorial notes are never shown. A scheme can be printed from `/review/scheme?scheme=<id>`; the Vocabulary page links to it as **Printable view to share**. See [SKOS: Import, Export and API](skos-support).

## Merging duplicates

If two concepts are one idea, open the one that should go and choose **Merge into…**. Pick the concept to keep; the preview lists everything that moves: labels (a preferred label in a language the survivor lacks stays preferred, the others become alternative labels), the broader, related and mapping links, collection memberships, links from other concepts, and the classes whose *Defined by concept* is the old concept. If both concepts have a different definition or notation you decide which stays. Links that would make a cycle, a link to itself or a repeat are left out and listed. The merge is written in one update. The old concept keeps its IRI, becomes *retired* and points to the survivor with a replaced-by link. The change log records a *merge* entry. Merging into a concept of another scheme is allowed, with a warning.

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

The promote dialog starts with advice: keep a term as a concept when it is a status value, a tag, a capability label or only a word people must agree on; promote it when it needs properties, restrictions or subclasses. The advice is only advice. For a fixed list of values, choose **Create enumerated class…** on a collection: it creates a class named after the collection with one member per concept (labels only, no link back to the concepts), in one write. It refuses an empty collection and an existing class name.

## Creating concepts for existing classes

*Create concepts for unlinked classes* starts from the classes you already have. It lists every class without a concept and proposes one **proposed** concept for each, taking the class label as the preferred label and the class description as the definition. Edit the label or definition, then accept one row or all of them.

- If a concept with the same label already exists, the class is linked to it instead of creating a duplicate. Classes that share a name across namespaces share the one concept.
- Everything accepted in one go is written in a single update, each link in the namespace of its class.
- Running it again lists nothing for classes that are already linked. The application's own internal classes are never listed.
