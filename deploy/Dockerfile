FROM node:22-bookworm-slim AS workspace
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.0.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/bindings/package.json packages/bindings/package.json
COPY packages/schema/package.json packages/schema/package.json
COPY packages/sdk/package.json packages/sdk/package.json
COPY server/package.json server/package.json
COPY client/package.json client/package.json
RUN pnpm install --frozen-lockfile
COPY packages ./packages
COPY server ./server
COPY client ./client
COPY deployments ./deployments

FROM workspace AS backend-build
RUN pnpm --filter termbook-server... build

FROM backend-build AS backend
ENV NODE_ENV=production
USER node
EXPOSE 3002
CMD ["node", "server/dist/server.js"]

FROM backend-build AS client-build
ARG PUBLIC_API_BASE
ENV NEXT_PUBLIC_API_URL=$PUBLIC_API_BASE
ENV NEXT_PUBLIC_TERMBOOK_API_URL=$PUBLIC_API_BASE
ENV TERMBOOK_PUBLIC_API_BASE=$PUBLIC_API_BASE
ENV NODE_OPTIONS=--max-old-space-size=2048
RUN test -n "$PUBLIC_API_BASE" && pnpm --filter @termbook/client build

FROM client-build AS client
ENV NODE_ENV=production
RUN chown -R node:node client/.next
WORKDIR /app/client
USER node
EXPOSE 4178
CMD ["node", "node_modules/next/dist/bin/next", "start", "--hostname", "0.0.0.0", "--port", "4178"]
