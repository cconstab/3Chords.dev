#!/bin/sh
# Pull the newest published images and restart whatever changed.
# Runs every couple of minutes from your own crontab (see crontab.example), as
# your user, not root. Safe to run by hand.
#
#   .env          -> production (image tag from IMAGE_TAG, default "latest")
#   .env.staging  -> staging    (image tag "staging")
#
# An environment whose env file is missing is skipped, so the same script works
# on a host that runs only one of them.
#
# When nothing new was published, a run costs one small request per environment:
# the pull asks the registry for the tag's current digest, sees it already has
# that image, and downloads nothing. The container is then left untouched and
# nothing is printed, so the log only shows real deploys and failures.
set -eu

cd "$(dirname "$0")/.."
status=0
changed=0

image_id() {
  docker image inspect --format '{{.Id}}' "$1" 2>/dev/null || true
}

update() {
  name=$1; shift
  image=$(docker compose "$@" config --images web)
  before=$(image_id "$image")
  if ! docker compose "$@" pull --quiet web >/dev/null; then
    echo "$name: pull failed, leaving the running container alone" >&2
    status=1
    return
  fi
  after=$(image_id "$image")

  # same image and the container is running: nothing to do
  if [ "$before" = "$after" ] && [ -n "$(docker compose "$@" ps --quiet --status running web)" ]; then
    return
  fi

  changed=1
  # --wait blocks until the container's healthcheck passes
  if docker compose "$@" up --detach --no-build --quiet-pull --wait --wait-timeout 60 web >/dev/null 2>&1; then
    echo "$name: deployed $image ($(printf %s "$after" | cut -c8-19)), healthy"
  else
    echo "$name: container did not become healthy" >&2
    docker compose "$@" logs --tail 50 web >&2 || true
    status=1
  fi
}

[ -f .env ] && update production
[ -f .env.staging ] && update staging -p threechords-staging --env-file .env.staging

# a deploy leaves the previous image behind; clear it out
[ "$changed" = 1 ] && docker image prune --force >/dev/null

exit $status
