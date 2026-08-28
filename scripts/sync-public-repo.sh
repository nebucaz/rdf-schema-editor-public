#!/usr/bin/env bash
# Syncs this repo's tracked files (excluding spec/ and CLAUDE.md) into the public
# mirror repo at PUBLIC_REPO_DIR (nebucaz/rdf-schema-editor-public).
#
# Only git-tracked files are exported (via `git archive`), so gitignored content
# (.env, node_modules, build output, ...) is never touched. spec/ and CLAUDE.md
# are stripped after export — CLAUDE.md documents internal working conventions,
# not something meant for the public mirror. History is NOT preserved — each
# sync lands as one new commit on the public repo, on top of its own
# accumulating history.
#
# Usage: scripts/sync-public-repo.sh [branch]   (default branch: main)

set -euo pipefail

PRIVATE_REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PUBLIC_REPO_DIR="${PUBLIC_REPO_DIR:-$HOME/Data/workspace/rdf-schema-editor-public}"
BRANCH="${1:-main}"

if [ ! -d "$PUBLIC_REPO_DIR/.git" ]; then
	echo "Public repo clone not found at $PUBLIC_REPO_DIR" >&2
	echo "Clone it first: git clone git@github.com:nebucaz/rdf-schema-editor-public.git \"$PUBLIC_REPO_DIR\"" >&2
	exit 1
fi

SHA="$(git -C "$PRIVATE_REPO_DIR" rev-parse --short "$BRANCH")"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

git -C "$PRIVATE_REPO_DIR" archive "$BRANCH" | tar -x -C "$TMP_DIR"
rm -rf "$TMP_DIR/spec"
rm -f "$TMP_DIR/CLAUDE.md"

rsync -a --delete --exclude='.git' "$TMP_DIR"/ "$PUBLIC_REPO_DIR"/

cd "$PUBLIC_REPO_DIR"
git add -A
if git diff --cached --quiet; then
	echo "Nothing to sync — public repo already matches $BRANCH@$SHA (minus spec/)"
	exit 0
fi

git commit -m "Sync from private repo @ $SHA"
git push origin HEAD
echo "Synced $BRANCH@$SHA to $(git remote get-url origin)"
