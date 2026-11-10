# Terms, Classes and Deprecation

A *concept* in the vocabulary names a meaning; a *class* in the schema is a set of things in the model. This section explains how the two are kept together, how clashing names are told apart, how a term leaves the vocabulary, and how terms relate to each other.

## The link between a class and its concept

A class can point to the concept that defines it. The link is stored on the class as `rse:definedByConcept`, in the class's own schema graph, and the class form shows a concept picker. When a class is linked, its definition lives in one place, the concept; the class keeps only a pointer. If the class also has its own description that differs from the concept's definition, the [Gate Report](gate-report) shows *definition drift*.

Starting from the other side, **Promote to class** on an approved or active concept creates a class from it and links the two. For a model that already has classes, **Create concepts for unlinked classes** proposes one concept per class, which you review before anything is written (see [Vocabulary](vocabulary)). Retargeting a link, for example after a concept is replaced, can be done from the Gate Report.

## Two terms, one name

When two meanings share a name, keep the preferred label plain and fill the **disambiguation** field of each concept with a short qualifier, such as *finance* for one *Bank* and *river* for the other. The qualifier shows in brackets after the label, and it is part of the concept's identifier. Add a scope note to each so a reader can tell them apart. Parentheses are not allowed inside the label itself. See pp. 45-52 of the book for the reasoning.

## Taking a term out of use

Nothing is deleted by a status change. A concept moves one step at a time through *proposed, approved, active, deprecated, retired*. **Deprecate** asks for a reason and, if there is one, the replacement concept; it can also copy the old label to the replacement as a hidden label so that a search for the old word still finds the new term. Classes linked to a deprecated or retired concept are flagged, with a one-click retarget when a replacement exists. Deleting a concept that is still in use is refused unless you confirm it.

## Taxonomy

The **Taxonomy** area shows the `skos:broader` outline of a scheme next to the read-only class hierarchy of a namespace. Drag a concept onto another to make it narrower; the app asks whether every instance of the narrower term is a kind of the broader one, because that is the test of a good hierarchy. A move that would create a cycle is refused. A concept can be marked as a top concept of its scheme, and then has no broader concept. A concept with two broader concepts is allowed and marked. If a class is a subclass of another and both are linked to concepts, the class hierarchy and the concept hierarchy should agree; a gate explains both chains when they do not.

## Related terms and mappings

On a concept page, add `skos:related` links between concepts of different branches, and mapping links (`exactMatch`, `closeMatch`, `relatedMatch`, `broadMatch`, `narrowMatch`) to concepts of *other* schemes, chosen from the registered external vocabularies or entered as an IRI. A mapping into the same scheme is refused, and a gate flags a related link between a concept and its own ancestor.
