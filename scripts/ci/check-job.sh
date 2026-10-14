#!/bin/sh
set -eu

repository=${1:-$(cat /opt/termbook-ci/repository)}
deny() { echo 'This runner accepts only the main-branch Tests workflow.' >&2; exit 1; }

[ "${GITHUB_SERVER_URL:-}" = https://github.com ] || deny
[ "${GITHUB_REPOSITORY:-}" = "$repository" ] || deny
[ "${GITHUB_REF:-}" = refs/heads/main ] || deny
[ "${GITHUB_WORKFLOW_REF:-}" = "$repository/.github/workflows/test.yml@refs/heads/main" ] || deny
case "${GITHUB_EVENT_NAME:-}" in push|workflow_dispatch) ;; *) deny ;; esac
case "${GITHUB_JOB:-}" in typescript|evm|solana) ;; *) deny ;; esac
echo 'Trusted CI job accepted.'
