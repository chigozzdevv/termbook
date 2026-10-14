#!/bin/sh
set -eu

[ "$(id -u)" -eq 0 ] || { echo 'Run this installer as root on the CI server.' >&2; exit 1; }
root=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
mode=${1:-prepare}
repository=${CI_REPOSITORY:-chigozzdevv/termbook}
name=${CI_RUNNER_NAME:-termbook-vps}
printf '%s\n' "$repository" | grep -Eq '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'
printf '%s\n' "$name" | grep -Eq '^[A-Za-z0-9_.-]+$'

as_ci() {
  (cd /var/lib/termbook-ci && runuser -u termbook-ci -- env HOME=/var/lib/termbook-ci \
    XDG_RUNTIME_DIR="/run/user/$(id -u termbook-ci)" \
    DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$(id -u termbook-ci)/bus" "$@")
}

case "$mode" in
  prepare)
    [ ! -f /etc/termbook-ci/runner.env ] || { echo 'CI is already prepared; inspect it before replacing its image.' >&2; exit 1; }
    : "${RUNNER_VERSION:?official runner version required}"
    : "${RUNNER_SHA256:?official runner checksum required}"
    printf '%s\n' "$RUNNER_VERSION" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$'
    printf '%s\n' "$RUNNER_SHA256" | grep -Eq '^[a-f0-9]{64}$'
    case "$(uname -m)" in x86_64) arch=x64 ;; aarch64) arch=arm64 ;; *) exit 2 ;; esac
    export DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=l
    apt-get update
    apt-get install -y --no-install-recommends podman slirp4netns uidmap fuse-overlayfs catatonit dbus-user-session
    if ! id termbook-ci >/dev/null 2>&1; then
      useradd --create-home --home-dir /var/lib/termbook-ci --shell /usr/sbin/nologin termbook-ci
    fi
    uid=$(id -u termbook-ci)
    [ "$uid" -ge 1000 ]
    ! id -nG termbook-ci | grep -Eq '(^| )(sudo|docker|root)( |$)'
    grep -q '^termbook-ci:' /etc/subuid
    grep -q '^termbook-ci:' /etc/subgid
    chmod 700 /var/lib/termbook-ci
    install -d -m 755 "/etc/systemd/system/user-$uid.slice.d" /etc/termbook-ci
    install -m 644 "$root/deploy/ci/resources.conf" "/etc/systemd/system/user-$uid.slice.d/termbook-ci.conf"
    sed "s/@CI_UID@/$uid/g" "$root/deploy/ci/termbook-ci.service" > /etc/systemd/system/termbook-ci.service
    systemctl daemon-reload
    loginctl enable-linger termbook-ci
    systemctl start "user@$uid.service"
    image="localhost/termbook-ci:$RUNNER_VERSION"
    systemd-run --wait --pipe --collect --unit termbook-ci-build \
      --uid=termbook-ci --gid=termbook-ci --slice="user-$uid.slice" --property=Delegate=yes \
      --setenv=HOME=/var/lib/termbook-ci --setenv="XDG_RUNTIME_DIR=/run/user/$uid" \
      --setenv="DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/$uid/bus" \
      /usr/bin/podman --cgroup-manager=systemd build --file "$root/deploy/ci/Dockerfile" \
      --build-arg "RUNNER_VERSION=$RUNNER_VERSION" --build-arg "RUNNER_SHA256=$RUNNER_SHA256" \
      --build-arg "RUNNER_ARCH=$arch" --build-arg "CI_REPOSITORY=$repository" --tag "$image" "$root"
    printf 'CI_IMAGE=%s\n' "$image" > /etc/termbook-ci/runner.env
    chmod 600 /etc/termbook-ci/runner.env
    echo 'CI image prepared. Register it with a short-lived GitHub registration token.'
    ;;
  register)
    . /etc/termbook-ci/runner.env
    as_ci podman --cgroup-manager=systemd run --rm --interactive --userns=keep-id:uid=1000,gid=1000 --user=1000:1000 \
      --cap-drop=ALL --security-opt=no-new-privileges --network=slirp4netns:allow_host_loopback=false \
      --dns=1.1.1.1 --cpus=2 --memory=6g --volume=termbook-ci-state:/runner \
      "$CI_IMAGE" register "$repository" "$name"
    systemctl enable --now termbook-ci.service
    ;;
  status)
    systemctl status termbook-ci.service --no-pager
    as_ci podman ps --format '{{.Names}}|{{.Status}}'
    ;;
  *) echo 'Use prepare, register or status.' >&2; exit 2 ;;
esac
