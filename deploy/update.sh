#!/bin/sh
# Pull the newest published images and restart whatever changed.
# Runs every couple of minutes from your own crontab (see crontab.example), as
# your user, not root. Safe to run by hand.
#
#   .env          -> production (image tag from IMAGE_TAG, default "latest")
#   .env.staging  -> staging    (image tag "staging")
#
# An environment whose env file is missing is skipped, so the same script works
# on a host that runs only one of them. When nothing new was published this is
# a cheap no-op: the pull finds no change and compose leaves the container alone.
set -eu

cd "$(dirname "$0")/.."
status=0

update() {
  name=$1; shift
  if ! docker compose "$@" pull --quiet web; then
    echo "$name: pull failed, leaving the running container alone" >&2
    status=1
    return
  fi
  # --wait blocks until the container's healthcheck passes
  if docker compose "$@" up --detach --no-build --wait --wait-timeout 60 web; then
    echo "$name: up to date and healthy"
  else
    echo "$name: container did not become healthy" >&2
    docker compose "$@" logs --tail 50 web >&2 || true
    status=1
  fi
}

[ -f .env ] && update production
[ -f .env.staging ] && update staging -p threechords-staging --env-file .env.staging

# old image layers pile up otherwise
docker image prune --force >/dev/null

exit $status
