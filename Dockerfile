# 3CHORDS.DEV — one small image: static site + API. Zero npm dependencies, so no install step.
# Base image is kept current by Dependabot (.github/dependabot.yml).
FROM node:26.13.1-alpine3.24

ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    DATA_DIR=/data

# Pick up Alpine security fixes released since the base image was built, and drop
# npm/yarn/corepack: the server never uses them, and they only add attack surface.
# The database lives on a volume, owned by the unprivileged node user.
RUN apk upgrade --no-cache \
 && rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx \
           /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-* \
 && mkdir -p /data && chown node:node /data

WORKDIR /app

# only what the server needs at runtime (see .dockerignore)
COPY --chown=node:node package.json server.js data-seed.json ./
COPY --chown=node:node index.html privacy.html 404.html favicon.svg site.webmanifest robots.txt sitemap.xml ./
COPY --chown=node:node css ./css
COPY --chown=node:node js ./js
COPY --chown=node:node fonts ./fonts
COPY --chown=node:node img ./img

# Which build this is; shown by /api/health. CI passes the release tag or main-<sha>.
# Kept late so it doesn't invalidate the layers above.
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION
LABEL org.opencontainers.image.source="https://github.com/cconstab/3Chords.dev" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version=$APP_VERSION

VOLUME ["/data"]
USER node
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# node handles SIGTERM itself and flushes the db before exiting
CMD ["node", "server.js"]
