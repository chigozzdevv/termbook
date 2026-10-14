FROM node:22-bookworm-slim

ARG RUNNER_VERSION
ARG RUNNER_SHA256
ARG RUNNER_ARCH=x64
ARG CI_REPOSITORY=chigozzdevv/termbook

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl git jq python3 build-essential pkg-config libssl-dev libicu72 \
    && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.0.0 --activate
RUN test -n "$RUNNER_VERSION" && test -n "$RUNNER_SHA256" \
    && mkdir /opt/actions-runner \
    && curl --fail --location --retry 3 \
      "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-${RUNNER_ARCH}-${RUNNER_VERSION}.tar.gz" \
      -o /tmp/runner.tar.gz \
    && printf '%s  /tmp/runner.tar.gz\n' "$RUNNER_SHA256" | sha256sum --check \
    && tar -xzf /tmp/runner.tar.gz -C /opt/actions-runner \
    && /opt/actions-runner/bin/installdependencies.sh \
    && rm /tmp/runner.tar.gz \
    && rm -rf /var/lib/apt/lists/*

COPY scripts/ci/check-job.sh /opt/termbook-ci/check-job.sh
COPY deploy/ci/entrypoint.sh /opt/termbook-ci/entrypoint.sh
RUN printf '%s\n' "$CI_REPOSITORY" > /opt/termbook-ci/repository \
    && chmod 555 /opt/termbook-ci/*.sh \
    && mkdir /runner /work && chown node:node /runner /work

ENV AGENT_TOOLSDIRECTORY=/runner/toolcache
ENV HOME=/home/node
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /runner
USER node
ENTRYPOINT ["/opt/termbook-ci/entrypoint.sh"]
