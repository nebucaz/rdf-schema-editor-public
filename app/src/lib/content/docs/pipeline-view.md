# Ontology Page

The **Ontology** page (the **Overview** link of the Ontology navigation) is a dashboard of tiles: where each namespace stands in six stages (vocabulary, taxonomy, thesaurus, ontology, validation and application), the Model checks, the competency questions, the health of each concept scheme, governance, recent changes and the guides. Its second tab, **Model checks**, lists every model problem with filters.

## Recommended order, not a rule

The order of the stages is a suggestion. Work on any stage at any time and return to earlier ones. Nothing on this page, and no stage, blocks or disables anything.

## Arranging the dashboard

- **Drag** a tile by its handle (the grip at the top of the tile). Drop it on another tile to put it in that tile's column, just before it, or on a column, even an empty one, to put it at the end. The other tiles stay in their columns. Only the handle drags; the rest of the tile stays selectable.
- **Keyboard:** Tab to a tile's handle. Up and down move the tile within its column, left and right move it to the next column; the new place is announced.
- **Hide** removes a tile from the dashboard; the hidden tiles are listed so you can show them again.
- **Reset layout** restores the default order and shows every tile.

The arrangement is stored per user on the server, so it follows you to another browser and never changes what other users see. The read-only review page always shows the default layout.

## What the tiles show

- **Stages**: for each namespace, the vocabulary, taxonomy and thesaurus state, the number of classes and properties, the competency questions (how many, how many of those run pass, any regression), the number of SHACL shapes, and the individuals. A stage without data is *Not started*; that is a state, not an error.
- **Model checks**: the number of findings by severity, each linking to the Model checks tab with that filter set.
- **Competency questions**: how many exist, how many pass, and any regression.
- **Scheme health**: one block for each concept scheme: how many concepts it holds, the orphans (no broader, narrower, related or mapped concept, and not a top concept), the groups of concepts cut off from the rest, concepts with more than one broader concept, related links that only repeat the hierarchy, and references to concepts that do not exist, plus the average depth and number of narrower concepts. Collections are not counted, and deprecated or retired concepts are left out. Orphans, disconnected groups and unknown references are also Model checks findings.
- **Governance** and **Recent changes**: the steward, authority, maturity and version, and the latest entries of the change log. They load when they come into view.
- **Guides**: links to the stage guides.

## Links

Every count links to the screen that lists it: classes and properties to the Schema canvas, findings to the Model checks tab, questions to the Questions page, individuals to the Identities browser filtered to the namespace.
