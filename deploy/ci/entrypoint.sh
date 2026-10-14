#!/bin/sh
set -eu

if [ ! -f /runner/config.sh ]; then
  cp -R /opt/actions-runner/. /runner/
fi

export ACTIONS_RUNNER_HOOK_JOB_STARTED=/opt/termbook-ci/check-job.sh
if [ "${1:-}" = register ]; then
  [ "$#" -eq 3 ] || exit 2
  [ ! -f /runner/.runner ] || { echo 'Runner already registered.' >&2; exit 1; }
  IFS= read -r ACTIONS_RUNNER_INPUT_TOKEN
  [ -n "$ACTIONS_RUNNER_INPUT_TOKEN" ] || exit 2
  export ACTIONS_RUNNER_INPUT_TOKEN
  exec ./config.sh --unattended --url "https://github.com/$2" \
    --name "$3" --labels termbook-ci --work /work
fi

[ -f /runner/.runner ] || { echo 'Register the runner before starting it.' >&2; exit 1; }
exec ./run.sh --once
