FROM node:24.13.1-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY src src
RUN npm run build && npm prune --omit=dev

FROM node:24.13.1-bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git openssh-client tzdata \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/dist dist
COPY entrypoint.sh /usr/local/bin/home-agent-entrypoint
RUN chmod 0755 /usr/local/bin/home-agent-entrypoint \
    && mkdir -p /data/repo /data/pi-agent /data/sessions /data/state \
    && chown -R node:node /app /data
USER node
ENV NODE_ENV=production
ENTRYPOINT ["/usr/local/bin/home-agent-entrypoint"]
