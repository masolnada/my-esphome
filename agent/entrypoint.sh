#!/bin/sh
set -eu

: "${HOME_AGENT_REPO_DIR:=/data/repo}"
: "${PI_CODING_AGENT_DIR:=/data/pi-agent}"
: "${REPO_URL:=git@github.com:masolnada/my-esphome.git}"

mkdir -p "$HOME/.ssh" "$PI_CODING_AGENT_DIR" /data/sessions /data/state
chmod 700 "$HOME/.ssh" "$PI_CODING_AGENT_DIR"

if [ -n "${GIT_DEPLOY_KEY_B64:-}" ]; then
  printf '%s' "$GIT_DEPLOY_KEY_B64" | base64 -d > "$HOME/.ssh/id_ed25519"
  chmod 600 "$HOME/.ssh/id_ed25519"
  unset GIT_DEPLOY_KEY_B64
fi

if [ ! -f "$HOME/.ssh/known_hosts" ]; then
  ssh-keyscan -t ed25519 github.com > "$HOME/.ssh/known_hosts" 2>/dev/null
  chmod 600 "$HOME/.ssh/known_hosts"
fi

if [ ! -d "$HOME_AGENT_REPO_DIR/.git" ]; then
  find "$HOME_AGENT_REPO_DIR" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
  git clone "$REPO_URL" "$HOME_AGENT_REPO_DIR"
fi

exec node /app/dist/index.js
