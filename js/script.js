/* ============================================================
   THREE CHORDS DOT DEV — js
   DIY. No framework. No build step.
   ============================================================ */
(() => {
  'use strict';

  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isTyping = (el) => el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
  const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k, fallback) { try { const v = localStorage.getItem(k); return v === null ? fallback : JSON.parse(v); } catch { return fallback; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode: fine */ } },
  };

  /* ---------- toast ------------------------------------------ */
  const toastEl = $('#toast');
  let toastTimer;
  const toast = (msg) => {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.hidden = false;
    toastEl.classList.remove('show');
    void toastEl.offsetWidth;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.classList.remove('show'); toastEl.hidden = true; }, 2600);
  };

  const copyText = async (text) => {
    try { await navigator.clipboard.writeText(text); return true; }
    catch {
      const ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch { /* nope */ }
      ta.remove();
      return ok;
    }
  };
  const share = async (url, title) => {
    if (navigator.share && matchMedia('(pointer: coarse)').matches) {
      try { await navigator.share({ url, title }); return; } catch { /* cancelled */ }
    }
    toast((await copyText(url)) ? 'LINK COPIED 🤘' : 'COPY THIS: ' + url);
  };

  const timeAgo = (ts) => {
    const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
    if (s < 60) return 'JUST NOW';
    const m = Math.round(s / 60); if (m < 60) return `${m}M AGO`;
    const h = Math.round(m / 60); if (h < 24) return `${h}H AGO`;
    const d = Math.round(h / 24); if (d < 30) return `${d}D AGO`;
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase();
  };

  /* ---------- years ------------------------------------------- */
  const year = new Date().getFullYear();
  // only the footer follows the calendar; the hero's 2026 is fixed, to pair with 1976
  ['footer-year'].forEach(id => { const el = document.getElementById(id); if (el) el.textContent = year; });
  // once 2026 is over, the hero talks about it in the past tense
  const heroNow = document.getElementById('hero-now');
  const heroSince = document.getElementById('hero-since');
  if (heroNow && heroSince && year > 2026) { heroNow.hidden = true; heroSince.hidden = false; }

  /* ---------- mobile nav -------------------------------------- */
  const navToggle = $('.nav-toggle');
  const navLinks = $('#nav-links');
  const setNav = (open) => {
    navToggle.setAttribute('aria-expanded', String(open));
    navLinks.classList.toggle('open', open);
    navToggle.querySelector('.nav-toggle-label').textContent = open ? 'CLOSE' : 'MENU';
  };
  if (navToggle && navLinks) {
    navToggle.addEventListener('click', () => setNav(navToggle.getAttribute('aria-expanded') !== 'true'));
    navLinks.addEventListener('click', e => { if (e.target.closest('a')) setNav(false); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && navLinks.classList.contains('open')) { setNav(false); navToggle.focus(); } });
  }

  /* ---------- rotating tagline -------------------------------- */
  const rotator = $('#rotator');
  const rotations = ['PUNK PROGRAMMING', 'THREE-CHORD CODE', 'GARAGE SOFTWARE', 'THE ANTI-BOOTCAMP', 'DIY DEV', 'BASEMENT BUILDS', 'LO-FI LAUNCHES', 'FEEDBACK > FEATURES'];
  if (rotator && !REDUCED) {
    let i = 0;
    setInterval(() => {
      if (document.hidden) return;
      i = (i + 1) % rotations.length;
      rotator.classList.add('swap');
      setTimeout(() => { rotator.textContent = rotations[i]; rotator.classList.remove('swap'); }, 180);
    }, 2400);
  }

  /* ============================================================
     DATA LAYER — shared server when available, this browser if not
     ============================================================ */
  const TOKENS_KEY = '3chords.tokens.v1';  // { postId: deleteToken }
  const LOCAL_POSTS = '3chords.local.posts.v1';
  const LOCAL_SIGS = '3chords.local.sigs.v1';
  const LOCAL_ROCKS = '3chords.local.rocks.v1';
  const tokens = store.get(TOKENS_KEY, {});
  const saveTokens = () => store.set(TOKENS_KEY, tokens);

  class ApiError extends Error {}
  const request = async (method, path, body, headers = {}) => {
    const r = await fetch(path, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (r.status === 204) return null;
    let data = {};
    try { data = await r.json(); } catch { /* empty */ }
    if (!r.ok) throw new ApiError(data.error || `Something broke (${r.status}). Try again.`);
    return data;
  };

  const Remote = {
    mode: 'remote',
    list: () => request('GET', '/api/posts').then(d => d.posts),
    create: (p) => request('POST', '/api/posts', p),
    remove: (id) => request('DELETE', `/api/posts/${encodeURIComponent(id)}`, null, { 'X-Delete-Token': tokens[id] || '' }),
    rock: (id) => request('POST', `/api/posts/${encodeURIComponent(id)}/rock`),
    report: (id) => request('POST', `/api/posts/${encodeURIComponent(id)}/report`),
    signatures: () => request('GET', '/api/signatures'),
    sign: (s) => request('POST', '/api/signatures', s),
  };

  const LOCAL_SEED = [{
    id: 'house-local', house: true, by: 'the house', flavor: 'ZINE', createdAt: Date.now() - 36e5, rocks: 0,
    title: 'WELCOME TO THE WALL. STAPLE SOMETHING UP.',
    body: "This is the offline demo of the wall. Anything you post stays in this browser. Run the server (npm start) and it's shared with everyone.",
  }];
  const Local = {
    mode: 'local',
    _posts() { return store.get(LOCAL_POSTS, null) || LOCAL_SEED; },
    async list() {
      const rocks = store.get(LOCAL_ROCKS, {});
      return this._posts().map(p => ({ ...p, rocks: rocks[p.id] ? 1 : 0, rocked: !!rocks[p.id] })).sort((a, b) => b.createdAt - a.createdAt);
    },
    async create(p) {
      const post = {
        id: 'l' + Date.now().toString(36), house: false, createdAt: Date.now(), rocks: 0,
        title: p.title.trim().toUpperCase(), body: p.body.trim(), by: p.by.replace(/^[~@\s]+/, '').trim(), flavor: p.flavor,
      };
      store.set(LOCAL_POSTS, [post, ...this._posts()]);
      return { post, deleteToken: 'local' };
    },
    async remove(id) { store.set(LOCAL_POSTS, this._posts().filter(p => p.id !== id)); },
    async rock(id) {
      const rocks = store.get(LOCAL_ROCKS, {});
      rocks[id] = !rocks[id];
      store.set(LOCAL_ROCKS, rocks);
      return { rocks: rocks[id] ? 1 : 0, rocked: rocks[id] };
    },
    async report() { return { ok: true }; },
    async signatures() { const names = store.get(LOCAL_SIGS, []); return { names: names.slice().reverse(), count: names.length }; },
    async sign({ handle }) {
      const names = store.get(LOCAL_SIGS, []);
      if (names.some(n => n.toLowerCase() === handle.toLowerCase())) throw new ApiError('That name is already on the wall.');
      names.push(handle); store.set(LOCAL_SIGS, names);
      return { ok: true, count: names.length };
    },
  };

  const detectBackend = async () => {
    if (location.protocol === 'file:') return Local;
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 2500);
      const r = await fetch('/api/health', { signal: ctl.signal });
      clearTimeout(t);
      if (r.ok && (await r.json()).ok) return Remote;
    } catch { /* fall through */ }
    return Local;
  };

  /* ============================================================
     THE AMP — distorted power chords via Web Audio
     ============================================================ */
  const CHORDS = { A: [110.0, 164.81, 220.0], D: [146.83, 220.0, 293.66], E: [82.41, 123.47, 164.81] };
  let ampOn = store.get('3chords.amp.v1', 'on') !== 'off';
  let ctx = null, ampIn = null;

  const getAmp = () => {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    ampIn = ctx.createGain(); ampIn.gain.value = 1.6;
    const fuzz = ctx.createWaveShaper();
    const n = 2048, curve = new Float32Array(n), k = 400;
    for (let i = 0; i < n; i++) { const x = (i * 2) / n - 1; curve[i] = ((3 + k) * x * 20 * Math.PI / 180) / (Math.PI + k * Math.abs(x)); }
    fuzz.curve = curve; fuzz.oversample = '4x';
    const cab = ctx.createBiquadFilter(); cab.type = 'lowpass'; cab.frequency.value = 3200; cab.Q.value = 0.8;
    const master = ctx.createGain(); master.gain.value = 0.18;
    ampIn.connect(fuzz).connect(cab).connect(master).connect(ctx.destination);
    return ctx;
  };

  const strum = (name, when = 0, dur = 1.1) => {
    if (!ampOn) return;
    const ac = getAmp();
    if (!ac) return;
    if (ac.state === 'suspended') ac.resume();
    const t0 = ac.currentTime + when;
    CHORDS[name].forEach((f, i) => {
      const t = t0 + i * 0.012;
      [-6, 6].forEach(detune => {
        const osc = ac.createOscillator();
        osc.type = 'sawtooth'; osc.frequency.value = f; osc.detune.value = detune;
        const env = ac.createGain();
        env.gain.setValueAtTime(0.0001, t);
        env.gain.exponentialRampToValueAtTime(0.5, t + 0.008);
        env.gain.exponentialRampToValueAtTime(0.18, t + 0.25);
        env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        osc.connect(env).connect(ampIn);
        osc.start(t); osc.stop(t + dur + 0.05);
      });
    });
  };

  const chordCards = Object.fromEntries($$('.chord-card[data-chord]').map(c => [c.dataset.chord, c]));
  const play = (name, when = 0) => {
    strum(name, when);
    const card = chordCards[name];
    if (!card || REDUCED) return;
    setTimeout(() => { card.classList.remove('struck'); void card.offsetWidth; card.classList.add('struck'); }, when * 1000);
  };
  Object.entries(chordCards).forEach(([name, card]) => {
    card.addEventListener('click', () => play(name));
    card.addEventListener('animationend', () => card.classList.remove('struck'));
  });

  const ampToggle = $('#amp-toggle');
  const syncAmp = () => {
    if (!ampToggle) return;
    ampToggle.setAttribute('aria-pressed', String(ampOn));
    ampToggle.textContent = ampOn ? 'AMP: ON' : 'AMP: OFF';
  };
  syncAmp();
  ampToggle?.addEventListener('click', () => {
    ampOn = !ampOn;
    store.set('3chords.amp.v1', ampOn ? 'on' : 'off');
    syncAmp();
    if (ampOn) play('E');
  });

  /* ============================================================
     THE WALL
     ============================================================ */
  const grid = $('#zine-grid');
  const filtersEl = $('#zine-filters');
  const sortEl = $('#zine-sort');
  const moreBtn = $('#zine-more');
  const form = $('#zine-form');
  const compose = $('#zine-compose');
  const formError = $('#zine-error');
  const PAGE = window.matchMedia('(max-width: 760px)').matches ? 6 : 12;
  let backend = null;
  let posts = [];
  let flavor = 'ALL';
  let shown = PAGE;
  let lastLoad = 0;

  const flavorLabel = (f) => (f === 'RIFF' ? 'RIFF · PROMPT' : f);
  const isMine = (p) => !!tokens[p.id];
  const postUrl = (id) => `${location.origin}${location.pathname}#post-${encodeURIComponent(id)}`;

  // body text: escape, then make bare http(s) links clickable (rel=nofollow ugc)
  const URL_RE = /\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/g;
  const linkify = (text) => {
    let out = '', last = 0;
    for (const m of text.matchAll(URL_RE)) {
      const url = m[0], shown = url.replace(/^https?:\/\//, '');
      out += esc(text.slice(last, m.index)) +
        `<a href="${esc(url)}" target="_blank" rel="nofollow ugc noopener noreferrer">${esc(shown.length > 48 ? shown.slice(0, 47) + '…' : shown)}</a>`;
      last = m.index + url.length;
    }
    return out + esc(text.slice(last));
  };

  const cardHtml = (p) => `
    <article class="zine-card${p.house ? ' house' : ''}" id="post-${esc(p.id)}" data-id="${esc(p.id)}" data-flavor="${esc(p.flavor)}">
      <header class="zine-meta">
        <span>${esc(flavorLabel(p.flavor))}</span>
        <time datetime="${new Date(p.createdAt).toISOString()}">${timeAgo(p.createdAt)}</time>
      </header>
      <h3>${esc(p.title)}</h3>
      <p class="zine-body">${linkify(p.body)}</p>
      <div class="by">~ ${esc(p.by)}${p.house ? ' <span class="badge badge-house" title="Written by the people who run this site">EDITORS</span>' : ''}${isMine(p) ? ' <span class="badge">YOURS</span>' : ''}</div>
      <footer class="zine-actions">
        <button type="button" class="act rock" data-act="rock" aria-pressed="${!!p.rocked}" aria-label="Rock this post (${p.rocks} so far)">ROCK<span class="n">${p.rocks}</span></button>
        <button type="button" class="act" data-act="share">SHARE</button>
        ${isMine(p)
          ? '<button type="button" class="act act-danger" data-act="tear">TEAR DOWN</button>'
          : p.house ? '' : '<button type="button" class="act act-quiet" data-act="report">REPORT</button>'}
      </footer>
    </article>`;

  const renderFilters = () => {
    const counts = posts.reduce((m, p) => (m[p.flavor] = (m[p.flavor] || 0) + 1, m), {});
    const keys = ['ALL', ...Object.keys(counts).sort()];
    if (!keys.includes(flavor)) flavor = 'ALL';
    filtersEl.innerHTML = keys.map(f => `
      <button type="button" class="zine-chip" data-flavor="${esc(f)}" aria-pressed="${f === flavor}">
        ${esc(flavorLabel(f))}<span class="n">${f === 'ALL' ? posts.length : counts[f]}</span>
      </button>`).join('');
  };

  const visiblePosts = () => {
    let list = flavor === 'ALL' ? posts : posts.filter(p => p.flavor === flavor);
    list = list.slice().sort(sortEl.value === 'top'
      ? (a, b) => b.rocks - a.rocks || b.createdAt - a.createdAt
      : (a, b) => b.createdAt - a.createdAt);
    return list;
  };

  const renderWall = () => {
    renderFilters();
    const list = visiblePosts();
    grid.innerHTML = list.length
      ? list.slice(0, shown).map(cardHtml).join('')
      : '<p class="zine-empty">Nothing stapled here yet. Be the first.</p>';
    moreBtn.hidden = list.length <= shown;
    if (!moreBtn.hidden) moreBtn.textContent = `LOAD MORE (${list.length - shown})`;
    grid.setAttribute('aria-busy', 'false');
    updateStats();
  };

  const loadWall = async () => {
    try {
      posts = await backend.list();
      lastLoad = Date.now();
      renderWall();
    } catch (e) {
      grid.innerHTML = `<p class="zine-empty">The amp's unplugged. ${esc(e.message)} <button type="button" class="btn btn-ghost btn-sm" id="wall-retry">TRY AGAIN</button></p>`;
      $('#wall-retry')?.addEventListener('click', loadWall);
    }
  };

  const highlightPost = (id) => {
    const p = posts.find(x => x.id === id);
    if (!p) return;
    // make sure it is rendered
    flavor = 'ALL';
    const idx = visiblePosts().findIndex(x => x.id === id);
    if (idx >= shown) shown = idx + 1;
    renderWall();
    const el = document.getElementById('post-' + id);
    if (!el) return;
    el.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'center' });
    el.classList.add('spotlight');
    setTimeout(() => el.classList.remove('spotlight'), 2400);
  };

  filtersEl.addEventListener('click', e => {
    const chip = e.target.closest('.zine-chip');
    if (!chip) return;
    flavor = chip.dataset.flavor;
    shown = PAGE;
    renderWall();
  });
  sortEl.addEventListener('change', () => { shown = PAGE; renderWall(); });
  moreBtn.addEventListener('click', () => { shown += PAGE; renderWall(); });

  grid.addEventListener('click', async e => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const card = btn.closest('.zine-card');
    const id = card.dataset.id;
    const post = posts.find(p => p.id === id);
    if (!post) return;
    const act = btn.dataset.act;
    try {
      if (act === 'rock') {
        btn.disabled = true;
        const r = await backend.rock(id);
        post.rocks = r.rocks; post.rocked = r.rocked;
        btn.setAttribute('aria-pressed', String(r.rocked));
        btn.setAttribute('aria-label', `Rock this post (${r.rocks} so far)`);
        btn.querySelector('.n').textContent = r.rocks;
        if (r.rocked) { play('E'); if (!REDUCED) btn.animate([{ transform: 'scale(1.3) rotate(-10deg)' }, { transform: 'none' }], { duration: 300 }); }
        btn.disabled = false;
      } else if (act === 'share') {
        await share(postUrl(id), post.title);
      } else if (act === 'report') {
        if (!confirm('Report this post as breaking the house rules?')) return;
        await backend.report(id);
        btn.textContent = 'REPORTED'; btn.disabled = true;
        toast('THANKS. A HUMAN WILL TAKE A LOOK.');
      } else if (act === 'tear') {
        if (!confirm('Tear down your post? This deletes it for everyone.')) return;
        await backend.remove(id);
        delete tokens[id]; saveTokens();
        const drop = () => { posts = posts.filter(p => p.id !== id); renderWall(); };
        if (REDUCED) drop(); else { card.classList.add('torn'); card.addEventListener('animationend', drop, { once: true }); }
        toast('TORN DOWN.');
      }
    } catch (err) {
      btn.disabled = false;
      toast(err.message.toUpperCase());
    }
  });

  // compose form
  const bodyField = form.elements.body;
  const counter = $('#body-counter');
  const updateCounter = () => { counter.textContent = `${bodyField.value.length} / 600`; };
  bodyField.addEventListener('input', updateCounter);

  const savedHandle = store.get('3chords.handle', '');
  if (savedHandle) { form.elements.by.value = savedHandle; $('#join-form').elements.handle.value = savedHandle; }

  const showError = (el, msg) => { el.textContent = msg; el.hidden = !msg; };

  const validate = (f, rules) => {
    for (const [name, min, label] of rules) {
      const v = f.elements[name].value.trim();
      if (v.replace(/^[~@\s]+/, '').length < min) {
        f.elements[name].setAttribute('aria-invalid', 'true');
        f.elements[name].focus();
        return `${label} needs at least ${min} characters.`;
      }
      f.elements[name].removeAttribute('aria-invalid');
    }
    return '';
  };

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const err = validate(form, [['title', 3, 'Title'], ['by', 1, 'Handle'], ['body', 3, 'The noise']]);
    showError(formError, err);
    if (err) return;
    const submit = form.querySelector('[type=submit]');
    submit.disabled = true; submit.textContent = 'STAPLING…';
    try {
      const data = Object.fromEntries(new FormData(form));
      const { post, deleteToken } = await backend.create(data);
      store.set('3chords.handle', data.by.trim());
      if (post) {
        tokens[post.id] = deleteToken; saveTokens();
        posts.unshift(post);
        flavor = 'ALL'; sortEl.value = 'new';
      }
      form.reset();
      form.elements.by.value = store.get('3chords.handle', '');
      updateCounter();
      compose.open = false;
      renderWall();
      play('A'); play('D', 0.18); play('E', 0.36);
      if (post) highlightPost(post.id);
      toast('STAPLED TO THE WALL 🤘');
    } catch (ex) {
      showError(formError, ex.message);
    } finally {
      submit.disabled = false; submit.textContent = 'STAPLE IT UP ›';
    }
  });

  // refresh the wall when people come back to the tab
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && backend && Date.now() - lastLoad > 60_000) loadWall();
  });

  /* ============================================================
     THE JUKEBOX
     ============================================================ */
  // the setlist lives in js/jukebox.js so anyone can add riffs with a one-line PR
  const { ideas, tools, nerves } = window.JUKEBOX || { ideas: ['a tiny thing'], tools: ['a laptop'], nerves: ['ship it'] };
  const slots = {
    idea: { el: $('#jk-idea'), list: ideas, i: -1, locked: false },
    tool: { el: $('#jk-tool'), list: tools, i: -1, locked: false },
    nerve: { el: $('#jk-nerve'), list: nerves, i: -1, locked: false },
  };
  const jkPrompt = $('#jk-prompt');
  const jkPromptText = $('#jk-prompt-text');
  const rnd = (n) => Math.floor(Math.random() * n);

  const buildPrompt = () =>
    `I'm building ${slots.idea.list[slots.idea.i]}. I've got ${slots.tool.list[slots.tool.i]}. My rule: ${slots.nerve.list[slots.nerve.i]}. ` +
    `Be my bassist, not my boss: give me the shortest plan (3 bullets, no boilerplate, as few files as possible) to ship a v0.1 today. If I over-scope, cut me off.`;

  const showSong = () => {
    Object.values(slots).forEach(s => { s.el.textContent = s.list[s.i]; });
    jkPromptText.textContent = buildPrompt();
    jkPrompt.classList.add('show');
  };

  const roll = () => {
    Object.values(slots).forEach(s => {
      if (s.locked && s.i >= 0) return;
      let next; do { next = rnd(s.list.length); } while (next === s.i && s.list.length > 1);
      s.i = next;
      if (REDUCED) return;
      s.el.classList.add('rolling');
      let n = 0;
      const flick = setInterval(() => {
        s.el.textContent = s.list[rnd(s.list.length)];
        if (++n > 7) { clearInterval(flick); s.el.classList.remove('rolling'); s.el.textContent = s.list[s.i]; }
      }, 60);
    });
    play('A', 0); play('D', 0.18); play('E', 0.36);
    setTimeout(showSong, REDUCED ? 0 : 540);
  };

  $('#jk-btn').addEventListener('click', roll);
  $$('.jk-lock').forEach(btn => btn.addEventListener('click', () => {
    const s = slots[btn.dataset.slot];
    if (s.i < 0) { toast('PLAY FIRST, THEN LOCK WHAT YOU LIKE.'); return; }
    s.locked = !s.locked;
    btn.setAttribute('aria-pressed', String(s.locked));
    btn.textContent = s.locked ? 'LOCKED' : 'LOCK';
    btn.closest('.jukebox-chord').classList.toggle('locked', s.locked);
  }));
  $('#jk-copy').addEventListener('click', async () => toast((await copyText(jkPromptText.textContent)) ? 'PROMPT COPIED 🤘' : 'SELECT THE TEXT AND COPY IT'));
  $('#jk-share').addEventListener('click', () =>
    share(`${location.origin}${location.pathname}#song-${slots.idea.i}-${slots.tool.i}-${slots.nerve.i}`, 'My 3-chord song'));
  $('#jk-post').addEventListener('click', () => {
    form.elements.flavor.value = 'RIFF';
    form.elements.title.value = `PLAYING: ${slots.idea.list[slots.idea.i]}`.slice(0, 80);
    form.elements.body.value = `Tool: ${slots.tool.list[slots.tool.i]}. Rule: ${slots.nerve.list[slots.nerve.i]}. Will report back.`;
    updateCounter();
    compose.open = true;
    $('#wall').scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth' });
    setTimeout(() => form.elements.title.focus({ preventScroll: true }), REDUCED ? 0 : 500);
  });

  /* ============================================================
     SIGN THE WALL
     ============================================================ */
  const joinForm = $('#join-form');
  const namesEl = $('#wall-of-names');
  const wallCount = $('#wall-count');
  const joinError = $('#join-error');
  let sigCount = 0;

  const renderNames = (names, count, fresh) => {
    sigCount = count;
    namesEl.innerHTML = names.map((n, i) => `<li${fresh && i === 0 ? ' class="fresh"' : ''}>${esc(n)}</li>`).join('');
    wallCount.hidden = !count;
    wallCount.textContent = count === 1 ? '1 NAME ON THE WALL' : `${count} NAMES ON THE WALL${count > names.length ? ` · LATEST ${names.length} SHOWN` : ''}`;
    updateStats();
  };
  const loadNames = async () => {
    try { const { names, count } = await backend.signatures(); renderNames(names, count); } catch { /* quiet */ }
  };

  joinForm.addEventListener('submit', async e => {
    e.preventDefault();
    const err = validate(joinForm, [['handle', 2, 'Handle']]);
    showError(joinError, err);
    if (err) return;
    const data = Object.fromEntries(new FormData(joinForm));
    data.handle = data.handle.trim().replace(/^[~@\s]+/, '');
    const submit = joinForm.querySelector('[type=submit]');
    submit.disabled = true;
    try {
      await backend.sign(data);
      store.set('3chords.handle', data.handle);
      const { names, count } = await backend.signatures();
      renderNames(names, count, true);
      $('#join-msg').hidden = false;
      joinForm.reset();
      play('A'); play('E', 0.2);
    } catch (ex) {
      showError(joinError, ex.message);
    } finally {
      submit.disabled = false;
    }
  });

  /* ---------- hero stats -------------------------------------- */
  const statsEl = $('#hero-stats');
  function updateStats() {
    if (!statsEl || !backend || backend.mode !== 'remote') return;
    $('#stat-posts').textContent = posts.length;
    $('#stat-sigs').textContent = sigCount;
    $('#stat-posts-label').textContent = posts.length === 1 ? 'POST ON THE WALL' : 'POSTS ON THE WALL';
    $('#stat-sigs-label').textContent = sigCount === 1 ? 'PUNK SIGNED THE WALL' : 'PUNKS SIGNED THE WALL';
    statsEl.hidden = false;
  }

  /* ---------- hash routes: #post-<id>, #song-i-t-n ------------ */
  const route = () => {
    let h;
    try { h = decodeURIComponent(location.hash.slice(1)); } catch { return; }
    if (h.startsWith('post-')) highlightPost(h.slice(5));
    const m = h.match(/^song-(\d+)-(\d+)-(\d+)$/);
    if (m) {
      const [i, t, n] = m.slice(1).map(Number);
      if (ideas[i] && tools[t] && nerves[n]) {
        slots.idea.i = i; slots.tool.i = t; slots.nerve.i = n;
        showSong();
        $('#jukebox').scrollIntoView({ behavior: 'auto' });
      }
    }
  };
  window.addEventListener('hashchange', route);

  /* ---------- boot -------------------------------------------- */
  (async () => {
    backend = await detectBackend();
    $('#mode-banner').hidden = backend.mode !== 'local';
    await Promise.all([loadWall(), loadNames()]);
    route();
  })();

  /* ---------- keyboard: A/D/E to play, type PUNK for a cheer --- */
  let buff = '';
  document.addEventListener('keydown', e => {
    if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
    if (!/^[a-zA-Z]$/.test(e.key)) return;
    const k = e.key.toUpperCase();
    if (CHORDS[k]) play(k);
    buff = (buff + k).slice(-4);
    if (buff === 'PUNK') {
      buff = '';
      const cheer = document.createElement('div');
      cheer.className = 'cheer';
      cheer.textContent = '🤘 LOUDER. 🤘';
      cheer.setAttribute('aria-hidden', 'true');
      document.body.appendChild(cheer);
      play('E'); play('A', 0.15);
      setTimeout(() => cheer.remove(), 1400);
    }
  });

  /* ---------- hero glitch ------------------------------------- */
  const ransoms = $$('.ransom');
  if (ransoms.length && !REDUCED) {
    setInterval(() => {
      if (document.hidden) return;
      const r = ransoms[rnd(ransoms.length)];
      r.classList.add('glitch');
      setTimeout(() => r.classList.remove('glitch'), 130);
    }, 1800);
  }

  console.log('%c3CHORDS.DEV %cPUNK PROGRAMMING.',
    'background:#ff2d87;color:#000;font-weight:bold;padding:4px 10px;font-family:monospace;font-size:14px;',
    'color:#00e5ff;font-weight:bold;padding:4px 10px;font-family:monospace;font-size:14px;');
  console.log('%cpsst: type "PUNK" anywhere. Press A, D, E to plug in. The source is yours to read.', 'color:#ffee00;font-family:monospace');
})();
