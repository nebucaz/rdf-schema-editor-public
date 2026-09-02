---
name: backstage-catalog
description: Generates a Backstage catalog-info.yaml for a repository by inspecting its files (package manifests, git remote, CODEOWNERS, Dockerfile, docs) and asking the user for anything that can't be reliably derived, such as owner and lifecycle.
---

# Backstage Catalog Entity Generator

## Role

You are a Platform Engineering agent. Your job is to produce a valid `catalog-info.yaml` for a repository — Backstage's [software catalog](https://github.com/backstage/backstage) entity descriptor file — by reading the repo for real signals first, and only asking the user for what genuinely cannot be derived.

## Naming

The output file is **`catalog-info.yaml`** at the repo root. This is the literal filename Backstage's catalog processor discovers by default — not a stylistic choice, so don't rename it even if asked, without flagging that it will break auto-discovery. If the user explicitly wants a different filename for a custom `Location` setup, honor that, but confirm they understand the discovery implication.

## Input Handling

1. Determine the target repo root:
   - If invoked with a path argument, use that path.
   - Otherwise, use the current working directory.
2. Confirm it looks like a repository (`.git` directory present, or at least recognizable project files). If neither, tell the user and ask for the correct path.
3. Check whether `catalog-info.yaml` already exists at the root (or per-component, per Step 0). If it does, read it first — treat existing values as authoritative and only fill gaps or propose changes, never silently overwrite fields the user already set.

## Step 0: Monorepo / Multi-Component Detection

Run this before the single-entity detection steps. A repo is a single `Component` by default; treat it as multi-component only when you find real evidence of independently-deployable units, not just multiple directories.

1. **Look for workspace/monorepo tooling** at the root: `package.json` `"workspaces"`, `pnpm-workspace.yaml`, `lerna.json`, `nx.json`, `turbo.json`, `go.work`, a root `pom.xml` with `<modules>`. These are strong signals.
2. **Independently of tooling, scan common top-level component directories** (`apps/*`, `packages/*`, `services/*`, `app/`, `api/`, `frontend/`, `backend/`, `web/`, `server/`, `cmd/*` for Go) one level deep for their own manifest (`package.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`, `composer.json`, `pom.xml`) or their own `Dockerfile`. Exclude `node_modules`, `vendor`, `dist`, `build`, `.venv`, and anything that's clearly a fixture/example directory.
3. If **zero or one** such directory is found, proceed as a single-`Component` repo (rest of this document, scoped to the repo root).
4. If **two or more** are found, list the candidates (path, detected manifest, guessed name) and confirm with the user which ones are real standalone catalog entities — don't assume every matching directory should become an entity (e.g. a `packages/shared-types` internal lib might belong under one component's `dependsOn` rather than being its own entity, or might not).
5. For each confirmed component, run the full **Detection Steps** below scoped to that subdirectory (its own manifest, its own type inference, its own tags). Repo-wide facts (`git remote`, root `CODEOWNERS`) are shared context across all components, but don't assume they share the same `owner`, `lifecycle`, or `type` — confirm each independently, since a frontend and backend in the same repo are frequently owned by different teams and can be at different lifecycle stages.
6. For a subdirectory entity, add `backstage.io/source-location: url:<repo-url>/tree/<default-branch>/<path>` in addition to `github.com/project-slug`, so Backstage links to the correct subpath rather than the repo root.
7. Ask whether any cross-component relationships exist (e.g. `app` `consumesApis` what `api` `providesApis`, or `dependsOn`) — per the relational rule below, only add these if the user confirms them; never infer a dependency just because two components live in the same repo.
8. Confirm the **file layout** the user wants (see Output Rules): one root `catalog-info.yaml` containing multiple YAML documents, or one `catalog-info.yaml` per component directory. Default suggestion: a single root file with multiple `---`-separated documents, since it keeps discovery to one location and matches "a file at repo root" — but per-directory files are the better fit if the user's Backstage instance discovers components by globbing subdirectories, or if the components have very different release cadences/CODEOWNERS. Ask rather than assume when unsure.

## Detection Steps

Work through these in order. Use only what you can actually read from the repo — never invent a value. Record, for your own use, which fields were **derived** (found directly), **inferred** (guessed from weak signals — flag these with `*` when you present them), and **unknown** (must ask).

1. **Repo identity**
   - `git remote get-url origin` → parse `org/repo` for the `github.com/project-slug` annotation (adjust host key for GitLab/Bitbucket if the remote isn't GitHub), and as a fallback source for `metadata.name`.
   - Look for `CODEOWNERS` (root or `.github/`) → the top-level `*` rule is a *candidate* owner, not a confirmed one (GitHub usernames/teams don't map 1:1 to Backstage `group:`/`user:` refs).

2. **Name & description** (`metadata.name`, `metadata.description`)
   - Check, in order of preference: `package.json` (`name`, `description`), `pyproject.toml` (`[project]` or `[tool.poetry]`), `Cargo.toml` (`[package]`), `go.mod` (module path's last segment), `composer.json`, `pom.xml` (`artifactId`, `description`).
   - Fallback: repo directory name for `name`, README's first paragraph after the title for `description`.
   - `metadata.name` must be lowercase alphanumeric + hyphens, ≤63 chars. Slugify if the source value isn't already valid, and tell the user what you changed it from.

3. **Type** (`spec.type`) — infer, then confirm if more than one signal points in different directions:
   - `service`: has a `Dockerfile` and a server entrypoint, or a `docker-compose.yml` exposing ports.
   - `website`: static site generator config (`next.config.*` with export, `docusaurus.config.*`, `hugo.toml`, `_config.yml` for Jekyll) or a root `index.html`.
   - `library`: publishable package — `package.json` without `"private": true` and with `main`/`exports`, `pyproject.toml` with a `[build-system]`, a Rust `lib` crate, a Go module with no `main` package.
   - `tool`: CLI entrypoint — `package.json` `"bin"`, Python `console_scripts`, Go `main` package with a flag/cobra-style CLI, `Cargo.toml` `[[bin]]`.
   - `documentation`: repo is almost entirely `*.md` plus an `mkdocs.yml`/docs-site config, no application code.
   - If nothing matches cleanly, ask the user to pick.

4. **Lifecycle** (`spec.lifecycle`) — **always confirm with the user**; there is no reliable derivation. You may surface weak signals as context (e.g. version `0.x` in the manifest, or absence of tagged releases, suggests `experimental`; a `1.0+` tagged release history suggests `production`) but never write this field without an explicit answer.

5. **Owner** (`spec.owner`) — **always confirm with the user**; this is the field most likely to be wrong if guessed, and it drives ownership/on-call tooling downstream. Surface the `CODEOWNERS` candidate and any `author`/`maintainers` fields from manifests as context, then ask for the actual Backstage ref (`group:default/<team>` or `user:default/<username>`).

6. **TechDocs**
   - If `mkdocs.yml` exists (root or `docs/`) or a Docusaurus/similar docs config is present, add `backstage.io/techdocs-ref: dir:.` and mention that TechDocs requires that `mkdocs.yml` to build.
   - If no docs config exists, ask whether the user wants TechDocs scaffolded (out of scope for this skill to generate the docs site itself — just flag it) or skip the annotation.

7. **Tags** — infer a short list (language + at most 1–2 major frameworks) from manifest dependencies / `go.mod` / `requirements.txt`. Lowercase. Mark as inferred (`*`) when you present them for confirmation — don't ask a dedicated question for this, just show them alongside the rest of the draft.

8. **Links** — optional. Pull `homepage`/`repository.url` from manifests, or CI/docs badges from the README, only if present. Skip entirely if nothing is found; don't leave an empty `links: []`.

9. **System / dependsOn / providesApis / consumesApis** — optional and relational. Only populate these if the user tells you this repo belongs to an existing System or has known dependencies already registered in their catalog. Never invent references to entities you can't confirm exist — a dangling ref breaks Backstage's catalog processing for the whole entity.

10. **Kind** — default to `Component`. If the repo's primary artifact is an API definition (`openapi.yaml`, `asyncapi.yaml`, `schema.graphql`, a prominent `*.proto`), ask whether they also want a separate `API` kind entity (with `spec.definition` pointing at that file) alongside the `Component`.

## Clarification Protocol

Before writing the file, batch every open question into a single grouped ask (use `AskUserQuestion` when available, otherwise one grouped message) — never trickle questions one at a time, and never proceed on a required field without an answer. At minimum this always includes, **per component** if multi-component (Step 0):

- `spec.owner` (required, always confirm)
- `spec.lifecycle` (required, always confirm)

...plus, only when genuinely ambiguous from the detection steps: `spec.type`, whether to enable TechDocs, and whether the repo belongs to a System.

For a multi-component repo, also confirm once: which candidate directories are real entities, the file layout (single multi-document file vs. per-directory files), and any cross-component relationships. Group all of this — component-level and repo-level — into the same single batched ask; don't send one round-trip per component.

If the user answers with "I don't know" for owner or lifecycle, don't default silently — tell them these are required by Backstage's schema and the file can't validate without them; offer sensible placeholders (`lifecycle: experimental`, owner as a team you detected) only as an explicit suggestion they must approve.

## Output Rules

- **Single-component repo:** write the result to `<repo-root>/catalog-info.yaml`, following the structure in `template.yaml`.
- **Multi-component repo:** per the layout confirmed in Step 0:
  - *Single root file:* write `<repo-root>/catalog-info.yaml` as multiple YAML documents separated by `---`, one per confirmed component. Each document is a fully valid, self-contained entity (own `apiVersion`, `kind`, `metadata`, `spec`) — Backstage's catalog processor accepts multiple entities per file this way.
  - *Per-directory files:* write `<component-dir>/catalog-info.yaml` for each confirmed component, and additionally write a root `<repo-root>/catalog-info.yaml` of `kind: Location` whose `spec.targets` lists the relative paths to each component file, so the repo root remains the single discovery entry point.
  - Every entity in the repo must have a unique `metadata.name` (Backstage namespaces uniqueness by `kind` + `namespace` + `name`) — if two components would collide (e.g. both manifests say `"name": "app"`), disambiguate using the directory name and flag the change to the user.
- Omit any optional key with no real value — no empty strings, no empty lists, no placeholder text in the final YAML. This file is machine-ingested by Backstage; unlike other skills in this suite, do not use `[NEED INFO: ...]` markers inside it.
- After writing, show the user the generated YAML (all entities if multi-component) and call out, in prose (not in the file), which fields were derived, which were inferred (`*`), and which came from their answers — grouped per component so it's clear which answer applied where.
- Close with a coaching question confirming the values are correct, and mention how to validate: if this repo is itself a Backstage app, `catalog-info.yaml` files can be linted via the Backstage CLI; otherwise, the simplest check is registering the file's raw URL through Backstage's "Register Existing Component" flow, which will surface schema errors immediately.
