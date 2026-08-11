#!/usr/bin/env bash
# Generic deploy script — kill-and-remove-first semantics.
#
# Nothing in here names this project. It derives everything from its own
# installed filename, so the same file works unchanged for the next app:
#
#   installed as /nebula/apps/deploy-stocksensei.sh
#     -> slug   "stocksensei"
#     -> repo   the directory under /nebula/apps whose name matches the slug
#               case-insensitively (so a StockSensei/ checkout is found)
#
# This is the CANONICAL copy of the root-owned script CI invokes over SSH
# (sudo -n /nebula/apps/deploy-<slug>.sh). The host copy is deliberately
# root-owned and NOT auto-synced from the repo — that boundary is what keeps a
# git push from widening what CI may run as root. scripts/bootstrap-host.sh
# installs it; the deploy workflow warns loudly when the two drift.
#
# Why kill-first: `compose up` recreates changed services but can leave
# instances from OTHER compose projects (a renamed dir, an old compose file, a
# hand-started container) alive. Two bots against one exchange account would
# both place orders and each would reconcile against a book the other is
# changing — the position state would be wrong in a way neither could detect.
# Order of operations here guarantees at most one instance per account.
set -euo pipefail

APPS_ROOT=${APPS_ROOT:-/nebula/apps}

# ---- derive identity from our own filename ----------------------------------
self=$(basename "${BASH_SOURCE[0]}")          # deploy-stocksensei.sh
SLUG=${self#deploy-}; SLUG=${SLUG%.sh}        # stocksensei
if [ -z "$SLUG" ] || [ "$SLUG" = "$self" ]; then
  echo "FATAL: expected to be installed as deploy-<slug>.sh, got '$self'" >&2
  exit 2
fi

# Find the checkout: match the directory name case-insensitively so the repo
# can keep its natural casing (StockSensei) while the slug stays lowercase.
REPO=""
for d in "$APPS_ROOT"/*/; do
  [ -d "$d" ] || continue
  name=$(basename "$d")
  if [ "$(printf '%s' "$name" | tr '[:upper:]' '[:lower:]')" = "$SLUG" ]; then
    REPO="${d%/}"
    break
  fi
done
if [ -z "$REPO" ]; then
  echo "FATAL: no checkout for '$SLUG' under $APPS_ROOT" >&2
  echo "       run scripts/bootstrap-host.sh first" >&2
  exit 2
fi

COMPOSE_FILE=${COMPOSE_FILE:-docker-compose.yml}
cd "$REPO"

# The compose project name is the label that separates our containers from
# strays. Read it from the file rather than guessing.
PROJECT=$(awk '/^name:/{print $2; exit}' "$COMPOSE_FILE")
PROJECT=${PROJECT:-$SLUG}

# Deploy whatever the default branch actually is, rather than assuming.
BRANCH=$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null || true)
BRANCH=${BRANCH#origin/}
BRANCH=${BRANCH:-main}

echo "==> $SLUG (project '$PROJECT') in $REPO, branch $BRANCH"

echo "==> pull (deterministic: the deploy IS origin/$BRANCH, local edits lose)"
git fetch origin "$BRANCH"
git reset --hard "origin/$BRANCH"

if [ ! -f .env ]; then
  echo "FATAL: no .env in $REPO — copy .env.example and fill it in" >&2
  exit 2
fi

export GIT_SHA=$(git rev-parse --short HEAD)
export BUILD_TIME=$(date -u +%FT%TZ)

echo "==> build new image (the old container keeps running while this does)"
docker compose -f "$COMPOSE_FILE" build --pull

# Every service in the file, minus any the app asks to keep running.
#
# DEPLOY_KEEP_SERVICES (space-separated, set in the app's .env) names the
# stateful ones: data stores and model servers that should survive a code
# deploy. Killing them is not wrong, just wasteful — a vector store has to
# reopen its storage and an embedding server has to reload multi-GB weights,
# so a one-line app deploy would take the whole stack down for a minute.
# Unset (the default) keeps the original behaviour: stop everything.
IFS=' ' read -r -a KEEP <<< "${DEPLOY_KEEP_SERVICES:-}"
APP_SERVICES=()
while IFS= read -r svc; do
  skip=""
  for k in "${KEEP[@]:-}"; do [ "$svc" = "$k" ] && skip=1 && break; done
  if [ -n "$skip" ]; then
    echo "    keeping '$svc' (DEPLOY_KEEP_SERVICES)"
  else
    APP_SERVICES+=("$svc")
  fi
done < <(docker compose -f "$COMPOSE_FILE" config --services)

echo "==> kill + remove old instances (single-instance guarantee)"
if [ ${#APP_SERVICES[@]} -gt 0 ]; then
  docker compose -f "$COMPOSE_FILE" rm --stop --force "${APP_SERVICES[@]}" || true
fi

echo "==> sweep strays: ${PROJECT}-* containers from any other compose project"
for id in $(docker ps -aq --filter "name=^${PROJECT}-"); do
  proj=$(docker inspect -f '{{ index .Config.Labels "com.docker.compose.project" }}' "$id" 2>/dev/null || echo "")
  if [ "$proj" != "$PROJECT" ]; then
    name=$(docker inspect -f '{{ .Name }}' "$id" 2>/dev/null || echo "$id")
    echo "    removing stray ${name#/} (compose project: '${proj:-none}')"
    docker rm -f "$id" || true
  fi
done

echo "==> start fresh instances (+ drop in-project orphans)"
docker compose -f "$COMPOSE_FILE" up -d --remove-orphans

echo "==> prune dangling images"
docker image prune -f

echo "==> status"
docker compose -f "$COMPOSE_FILE" ps

# Optional per-app smoke check. Keeps this script generic while letting each
# app assert whatever "actually working" means for it. Non-fatal: the deploy
# has already happened, so a failing check is a loud warning, not a rollback.
if [ -x scripts/post-deploy.sh ]; then
  echo "==> post-deploy check"
  COMPOSE_FILE="$COMPOSE_FILE" scripts/post-deploy.sh || echo "    WARNING: post-deploy check failed"
fi
