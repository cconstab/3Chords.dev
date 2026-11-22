# 3CHORDS.DEV — punk programming HQ

Three chords and a prompt. A community wall where people who build with AI share
what they made, what broke, and what they learned.

- **The Wall**: public posts (field notes, riffs, hot takes, tutorials…), 🤘 "rock" reactions, permalinks, flavor filters, owner-only delete, community reporting.
- **The Jukebox**: random idea + tool + nerve, with a starter prompt. Lock slots, copy, share a link, post it to the wall.
- **Sign the Wall**: public handle, optional *private* contact for the mailing list.
- **The Amp**: the three chord cards play distorted power chords (Web Audio). Press A, D, E.

No framework, no build step, **zero npm dependencies**. Fonts are self-hosted; no third-party requests at all.

## Run it

```sh
npm start            # http://localhost:8080
npm test             # API tests (node:test)
```

Needs Node 18+. Data lives in `./data/db.json` (created on first run, seeded with posts from `data-seed.json`).

Opening `index.html` straight from disk also works: it runs in **offline demo mode**, where posts are stored only in that browser, and a banner says so.

## Configuration

| env | default | what |
|---|---|---|
| `PORT` | `8080` | port |
| `HOST` | `0.0.0.0` | bind address |
| `DATA_DIR` | `./data` | where `db.json` lives. Put it on a persistent volume. |
| `ADMIN_TOKEN` | *(unset)* | enables moderation endpoints. Use a long random string. |
| `TRUST_PROXY` | *(unset)* | set to `1` **only** behind a reverse proxy that sets `X-Forwarded-For`, so rate limits apply per visitor |
| `PUBLIC_ORIGIN` | *(unset)* | the only origin allowed to post, e.g. `https://3chords.dev`. Unset means "same host as the request". |
| `HIDE_AFTER` | `3` | reports from distinct people before a post is auto-hidden |

## Docker (recommended)

```sh
cp .env.example .env          # set ADMIN_TOKEN (openssl rand -hex 24)
docker compose up -d --build  # http://<host>:8080
docker compose logs -f        # watch it
docker compose down           # stop (data is kept in the `wall-data` volume)
```

The image is small (`node:22-alpine`, no npm install). It runs as the unprivileged `node` user on a read-only filesystem with all capabilities dropped, and has a built-in healthcheck. The database is the named volume `wall-data`, mounted at `/data`.

- **Back up:** `docker compose cp web:/data/db.json ./backup-$(date +%F).json`
- **Update:** `git pull && docker compose up -d --build`. The volume is untouched.
- **Wipe everything:** `docker compose down -v`. This deletes all posts and signatures.

`.env.example` holds the **production** settings: `TRUST_PROXY=1`, `PUBLIC_ORIGIN=https://3chords.dev`, and the container published on `127.0.0.1:8080` only, so the proxy is the only way in. For LAN or local testing, leave `TRUST_PROXY` and `PUBLIC_ORIGIN` empty and set `PUBLISH_PORT=8080`. Over plain `http://` on a LAN, browsers disable the modern clipboard API and `navigator.share`. The site falls back to an older copy method automatically.

## Domains + HTTPS

**3chords.dev** is the real site. **threechords.dev** (and both `www.` names) permanently redirect to it, so a spoken "three chords dot dev" lands either way. With [Caddy](https://caddyserver.com) on the same host, which gets and renews the HTTPS certificates itself:

```
# /etc/caddy/Caddyfile
3chords.dev {
  encode zstd gzip
  reverse_proxy 127.0.0.1:8080
}

threechords.dev, www.threechords.dev, www.3chords.dev {
  redir https://3chords.dev{uri} permanent
}
```

Point the DNS `A`/`AAAA` records for all four names at the server, then run `sudo systemctl reload caddy`. Caddy keeps the Host header and sets `X-Forwarded-For`, which is exactly what `TRUST_PROXY=1` and `PUBLIC_ORIGIN` expect.

## Deploy without Docker

Any box that runs Node works. Use the same Caddyfile as above.

```sh
HOST=127.0.0.1 TRUST_PROXY=1 PUBLIC_ORIGIN=https://3chords.dev ADMIN_TOKEN=$(openssl rand -hex 24) DATA_DIR=/var/lib/3chords node server.js
```

Run it under systemd, pm2 or a container restart policy. On SIGTERM the server flushes the database to disk before exiting. Back up `DATA_DIR/db.json`: it's the whole community.

The canonical URL, Open Graph tags, `robots.txt` and `sitemap.xml` point at `https://3chords.dev`.

## Moderation

Posts reported by `HIDE_AFTER` different people are hidden automatically until a human looks.

```sh
H="Authorization: Bearer $ADMIN_TOKEN"
curl -H "$H" https://3chords.dev/api/admin/reports                     # flagged + hidden posts
curl -H "$H" -X POST https://3chords.dev/api/posts/<id>/restore         # un-hide, clear reports
curl -H "$H" -X DELETE https://3chords.dev/api/posts/<id>               # remove for good
```

Signature contact details are only in `db.json` (`signatures[].contact`). They are never served by the API.

## Spam & abuse protection

- Per-visitor rate limits (posts 5/10 min, signatures 3/10 min, reactions, reports)
- Hidden honeypot field; duplicate-post rejection; length limits; control/bidi characters stripped
- Cross-origin writes refused (Origin check); strict Content-Security-Policy, no inline scripts
- Visitors are identified only by a **salted hash** of their IP. Raw IPs are never stored.

## Layout

```
index.html  privacy.html  404.html     pages
css/styles.css  js/script.js           the whole front end
server.js                              static files + JSON API + storage
data-seed.json                         starter "house" posts for a fresh database
fonts/  img/                           self-hosted fonts (see fonts/LICENSES.txt), icons, share image
test/server.test.js                    API tests
```

## Before launch

- [ ] Make sure mail to **info@3chords.dev** arrives (MX records or email forwarding) and send a test message. The address is on the privacy page, in the house rules and in the footer.
- [ ] `cp .env.example .env` on the server and set `ADMIN_TOKEN`
- [ ] Point DNS for 3chords.dev, threechords.dev and both www. names at the server, and install the Caddyfile above
- [ ] Back up `db.json` on a schedule
