#!/usr/bin/env bash
# One-time host setup for a CI-deployed app on the Hetzner box.
#
# Run it from inside the checkout, as a user who can sudo:
#
#   git clone https://github.com/D-dezeeuw/StockSensei /nebula/apps/StockSensei
#   cd /nebula/apps/StockSensei && ./scripts/bootstrap-host.sh
#
# Everything is derived from the checkout's directory name — StockSensei gives
# slug "stocksensei", installs /nebula/apps/deploy-stocksensei.sh, and writes
# /etc/sudoers.d/deploy-stocksensei. Nothing here is specific to this project,
# so the next app gets the same treatment by copying these two files.
#
# Idempotent: safe to re-run after changing docker/deploy.sh (in fact that is
# how you reinstall it when CI reports drift).
set -euo pipefail

APPS_ROOT=${APPS_ROOT:-/nebula/apps}
DEPLOY_USER=${DEPLOY_USER:-$(id -un)}

die() { echo "ERROR: $*" >&2; exit 1; }
ok()  { echo "  ok   $*"; }
note(){ echo "  --   $*"; }

# ---- identity ---------------------------------------------------------------
REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
APP_NAME=$(basename "$REPO")                                    # StockSensei
SLUG=$(printf '%s' "$APP_NAME" | tr '[:upper:]' '[:lower:]')    # stocksensei
DEPLOY_SCRIPT="$APPS_ROOT/deploy-$SLUG.sh"
SUDOERS="/etc/sudoers.d/deploy-$SLUG"

echo "==> $APP_NAME (slug: $SLUG)"
echo "    repo         $REPO"
echo "    deploy script $DEPLOY_SCRIPT"
echo "    sudoers      $SUDOERS"
echo "    ci user      $DEPLOY_USER"
echo

# ---- preconditions ----------------------------------------------------------
echo "==> checking preconditions"
[ -f "$REPO/docker-compose.yml" ] || die "no docker-compose.yml in $REPO"
[ -f "$REPO/docker/deploy.sh" ]   || die "no docker/deploy.sh in $REPO"
command -v docker >/dev/null      || die "docker not installed"
docker compose version >/dev/null 2>&1 || die "docker compose v2 not available"
ok "repo layout and docker"

# The deploy script finds the checkout by lowercasing directory names under
# APPS_ROOT. If the repo lives somewhere else, CI will not find it.
case "$REPO" in
  "$APPS_ROOT"/*) ok "repo is under $APPS_ROOT" ;;
  *) die "repo must live under $APPS_ROOT (found $REPO) — the deploy script resolves it by name there" ;;
esac

# ---- external docker networks ----------------------------------------------
# compose fails at `up` if an external network is missing, which is a confusing
# place to discover a typo. Check now.
echo "==> checking external networks referenced by docker-compose.yml"
externals=$(awk '
  /^networks:/{inNet=1; next}
  inNet && /^[a-zA-Z]/{inNet=0}
  inNet && /^  [a-zA-Z0-9_.-]+:/{gsub(/[ :]/,"",$1); cur=$1}
  inNet && /external:[[:space:]]*true/{print cur}
' "$REPO/docker-compose.yml" | sort -u)
if [ -z "$externals" ]; then
  note "none declared"
else
  for net in $externals; do
    if docker network inspect "$net" >/dev/null 2>&1; then
      ok "network '$net' exists"
    else
      die "external network '$net' does not exist — create it or fix the compose file"
    fi
  done
fi

# ---- .env -------------------------------------------------------------------
echo "==> environment file"
if [ -f "$REPO/.env" ]; then
  ok ".env already present (left untouched)"
else
  [ -f "$REPO/.env.example" ] || die "no .env or .env.example"
  cp "$REPO/.env.example" "$REPO/.env"
  chmod 600 "$REPO/.env"
  note ".env created from .env.example — FILL IT IN before the first deploy"
  NEEDS_ENV=1
fi

# ---- install the root-owned deploy script -----------------------------------
# Root-owned and installed by hand on purpose: if CI could overwrite it, a git
# push would be able to change what runs as root on this box.
echo "==> installing deploy script"
if [ -f "$DEPLOY_SCRIPT" ] \
   && cmp -s "$REPO/docker/deploy.sh" "$DEPLOY_SCRIPT"; then
  ok "already installed and identical"
else
  sudo install -o root -g root -m 0755 "$REPO/docker/deploy.sh" "$DEPLOY_SCRIPT"
  ok "installed $(sha256sum "$DEPLOY_SCRIPT" | cut -c1-12)…"
fi

# ---- sudoers ----------------------------------------------------------------
# A single fixed path, never a wildcard: that is what makes passwordless sudo
# here safe. visudo -cf validates before install so a bad line can't lock sudo.
echo "==> sudoers entry"
rule="$DEPLOY_USER ALL=(root) NOPASSWD: $DEPLOY_SCRIPT"
if [ -f "$SUDOERS" ] && grep -qxF "$rule" "$SUDOERS" 2>/dev/null; then
  ok "already present"
else
  tmp=$(mktemp)
  printf '%s\n' "$rule" > "$tmp"
  sudo visudo -cf "$tmp" >/dev/null || { rm -f "$tmp"; die "generated sudoers rule is invalid"; }
  sudo install -o root -g root -m 0440 "$tmp" "$SUDOERS"
  rm -f "$tmp"
  ok "installed"
fi

# ---- verify the exact call CI will make -------------------------------------
echo "==> verifying passwordless sudo"
if sudo -n true 2>/dev/null && sudo -n -l "$DEPLOY_SCRIPT" >/dev/null 2>&1; then
  ok "$DEPLOY_USER may run $DEPLOY_SCRIPT without a password"
else
  note "could not confirm — check with: sudo -n -l $DEPLOY_SCRIPT"
fi

echo
echo "==> done: $APP_NAME"
if [ "${NEEDS_ENV:-0}" = "1" ]; then
  echo
  echo "  NEXT: fill in $REPO/.env, then deploy with"
else
  echo "  Deploy with"
fi
echo "    sudo -n $DEPLOY_SCRIPT"
echo
echo "  CI does the same over SSH. It also needs the HETZNER_SSH_KEY repository"
echo "  secret set (secrets are per-repository — one on another repo won't do)."
