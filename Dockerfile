# 3CHORDS.DEV — one small image: static site + API. Zero npm dependencies, so no install step.
FROM node:22.11.0-alpine3.20

ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    DATA_DIR=/data

WORKDIR /app

# only what the server needs at runtime (see .dockerignore)
COPY --chown=node:node package.json server.js data-seed.json ./
COPY --chown=node:node index.html privacy.html 404.html favicon.svg site.webmanifest robots.txt sitemap.xml ./
COPY --chown=node:node css ./css
COPY --chown=node:node js ./js
COPY --chown=node:node fonts ./fonts
COPY --chown=node:node img ./img

# the database lives on a volume, owned by the unprivileged node user
RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]

USER node
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# node handles SIGTERM itself and flushes the db before exiting
CMD ["node", "server.js"]
