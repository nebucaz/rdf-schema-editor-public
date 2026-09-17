# Missing Concepts Panel

Lists every Backstage entity `kind` the live catalog has that no local class maps to yet, with a
one-click way to create and tag a class for it. Part of [Backstage catalog sync](backstage-catalog-sync).

## What you see

Every unmapped `kind` discovered from the connected Backstage instance.

## What you can do

- **Dismiss** — hides a kind from this session's list without creating anything. This is session-only:
  it isn't persisted, so the kind reappears the next time discovery runs (only an actual class mapping
  makes a kind stop showing up here for good).
- **Create** — opens a small inline form to name the new class and pick which namespace it belongs to
  (pre-filled with a Pascal-cased guess at the class name from the kind, e.g. `component` →
  `Component`). Submitting creates the class and tags it with this Backstage kind in one step, so the
  next sync run picks it up.

## Related

- [Backstage catalog sync](backstage-catalog-sync) — the discover/sync/regenerate flow this panel is
  part of.
- [Entity Form](entity-form) — where a "Backstage kind" mapping can also be set/changed after the
  class already exists.
