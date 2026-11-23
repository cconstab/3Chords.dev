#!/bin/sh
# Deploy newly published images: check the registry, pull and restart only what changed.
# Runs every few minutes from your own crontab (see crontab.example), as
# your user, not root. Safe to run by hand.
#
#   .env          -> production (image tag from IMAGE_TAG, default "latest")
#   .env.staging  -> staging    (image tag "staging")
#
# An environment whose env file is missing is skipped, so the same script works
# on a host that runs only one of them.
#
# Nothing is pulled unless there is something new. Each run asks the registry
# for the digest (the sha256) its tag points at and compares it with the image
# already on this host. Same digest and the container is running: done, and
# nothing is printed, so the log only shows real deploys and failures.
set -eu

cd "$(dirname "$0")/.."
status=0
changed=0

update() {
  name=$1; shift
  image=$(docker compose "$@" config --images web)

  # what the registry has: a metadata request, no image data
  if ! remote=$(docker buildx imagetools inspect "$image" --format '{{.Manifest.Digest}}' 2>&1); then
    echo "$name: could not read the digest of $image, leaving the running container alone" >&2
    echo "$remote" >&2
    status=1
    return
  fi
  # what this host has
  have=$(docker image inspect --format '{{join .RepoDigests " "}}' "$image" 2>/dev/null || true)

  case " $have " in
    *"@$remote "*)
      # same image and the container is running: nothing to do
      [ -n "$(docker compose "$@" ps --quiet --status running web)" ] && return
      ;;
    *)
      if ! out=$(docker compose "$@" pull --quiet web 2>&1); then
        echo "$name: pull failed, leaving the running container alone" >&2
        echo "$out" >&2
        status=1
        return
      fi
      changed=1
      ;;
  esac

  # --wait blocks until the container's healthcheck passes
  if docker compose "$@" up --detach --no-build --pull never --wait --wait-timeout 60 web >/dev/null 2>&1; then
    echo "$name: deployed $image ($(printf %s "$remote" | cut -c8-19)), healthy"
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
