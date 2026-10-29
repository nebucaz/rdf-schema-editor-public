# Workspace Management View

CRUD for Workspaces — named, savable views of a subset of the canvas — opened from the Settings
menu (cog): **Manage ▸ Workspaces**.

## What you see

A list of every Workspace with its name and default namespace.

## What you can do

- **Add** — create a new, empty Workspace with a name and an optional default namespace (used when
  minting new classes while that Workspace is active).
- **Edit** — rename a Workspace or change its default namespace.
- **Delete** — remove a Workspace. This removes the Workspace itself and its membership list, not the
  classes/individuals that were in it.
- **Export Workspace…** — downloads a `.ttl` bundle of every node currently in that Workspace, plus
  the classes they depend on (up to a dependency-closure cap; you're told if any were left out).
- Switching to a Workspace makes it the canvas's active view — see the app's navbar Workspace
  selector.

## Related

- [Triples Panel](triples-panel) — viewing a Workspace's triples read-only, as opposed to exporting
  them to a file.
- [Import/export](import-export) — the "Import Workspace" counterpart to this view's export action.
