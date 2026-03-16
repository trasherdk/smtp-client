#!/usr/bin/env bash
set -e

# Release script: bump version, build, test, commit, tag, push.
# Usage: pnpm release [patch|minor|major] [--no-push]
# Or: ./scripts/release.sh patch [--no-push]

BUMP="${1:-patch}"
NO_PUSH=""
[[ "${2:-}" == "--no-push" || "${1:-}" == "--no-push" ]] && NO_PUSH=1
[[ "${BUMP}" == "--no-push" ]] && BUMP="patch"

case "$BUMP" in
  patch|minor|major) ;;
  *) echo "Usage: pnpm release [patch|minor|major] [--no-push]"; exit 1 ;;
esac

BRANCH="$(git branch --show-current)"
if [[ "$BRANCH" != "master" ]]; then
  echo "> Branch is $BRANCH; checking out master and merging..."
  git checkout master
  git merge "$BRANCH"
fi

echo "> Building..."
pnpm build

echo "> Testing..."
pnpm test

echo "> Bumping version ($BUMP)..."
pnpm version "$BUMP"

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
