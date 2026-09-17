# External Class Node

An **External Class Node** is a stub marking a reference to a class defined in an *external*
vocabulary (e.g. `schema:Organization` from schema.org) rather than one of your own locally-defined
classes.

## What you see

A small dashed pill showing the class's prefixed name (e.g. `schema:Organization`), styled distinctly
from a regular Entity Node — italic, muted color, no header/attribute list — to make clear it's a
reference, not something you can edit here.

## What you can do

- Hover the pill to confirm it's read-only ("External vocabulary reference — not editable").
- Draw an Inheritance edge *to* it from one of your own Entity Nodes, to declare that your class is a
  `rdfs:subClassOf` the external class.
- Click **×** to remove it from the canvas. This only removes the stub from the current view — it
  doesn't delete the external vocabulary registration itself.

## Where it comes from

External classes are registered once (prefix + base IRI) via the [External Vocabulary
Form](external-vocabulary-form), then referenced on the canvas by creating an External Class Node for
a specific class in that vocabulary — typically as the target of an inheritance relationship, so a
local class can extend a well-known external type without redefining it.

## Related

- [External Vocabulary Form](external-vocabulary-form) — registers the vocabulary this node's class
  belongs to.
- [Inheritance Edge](inheritance-edge) — the only edge type that connects to an External Class Node.
