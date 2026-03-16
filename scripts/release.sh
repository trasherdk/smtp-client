#!/usr/bin/env bash
set -e

# Release script: bump version (or re-tag current), build, test, commit, tag, push.
# Usage: pnpm release [patch|minor|major] [--no-push]
# Or: ./scripts/release.sh patch [--no-push]
# No bump level = re-release current version (force tag).

BUMP=""
NO_PUSH=""
while [[ $# -ne 0 ]]; do
  case "$1" in
    patch|minor|major) BUMP="$1" ;;
    --no-push) NO_PUSH=1 ;;
    *) ;;  # first release or re-release; no bump
  esac
  shift
done

ORIG_BRANCH="$(git branch --show-current)"
if [[ "$ORIG_BRANCH" != "master" ]]; then
  echo "> Branch is $ORIG_BRANCH; checking out master and merging..."
  git checkout master
  git merge "$ORIG_BRANCH"
fi

echo "> Building..."
pnpm build

echo "> Testing..."
pnpm test

if [[ -n "$BUMP" ]]; then
  echo "> Bumping version ($BUMP)..."
  pnpm version "$BUMP"
else
  echo "> Re-release: no version bump"
fi

if [[ -z "$NO_PUSH" ]]; then
  echo "> Pushing..."
  VERSION="$(node -p "require('./package.json').version")"
  TAG="v$VERSION"
  git push
  if git rev-parse "$TAG" &>/dev/null; then
    git push origin "$TAG" --force
  else
    git push --tags
  fi
  echo "Done. CI will publish to npm on tag push."
else
  echo "Done. Run 'git push --follow-tags' when ready."
fi
