/* Каркас приложения: заставка с настоящей проверкой системы, навигация, состояние воксельной сцены, строка статуса. */
(function () {
  'use strict';
  const { $, $$, h, toast, scramble, reduce } = window.UI;
  const C = window.CONTENT;
  const A = window.APP = window.APP || {};
  const K = window.kenox;
  const root = document.documentElement;

  // scene.js читает это состояние каждый кадр
  const state = window.__anonState = { shape: 'word', accent: '#f3f4f7', dissolve: 0, score: 0, pointer: { x: 0, y: 0, active: false }, compact: false, vel: 0, introDone: false };
  addEventListener('pointermove', (e) => { state.pointer.x = e.clientX / innerWidth * 2 - 1; state.pointer.y = -(e.clientY / innerHeight * 2 - 1); state.pointer.active = true; }, { passive: true });
  document.addEventListener('pointerleave', () => { state.pointer.active = false; });

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* без памяти */ } },
  };

  // раздел → [заголовок, цвет, форма на сцене]
  const SCREENS = {
    overview: ['Обзор', '#f3f4f7', 'fingerprint'],
    utils: ['Утилиты', '#ffe08a', 'crowd'],
    radar: ['Радар соединений', '#7fe3c4', 'onion'],
    spy: ['Кто подглядывал', '#ff8fa3', 'eye'],
    meta: ['Метаданные', '#ffe08a', 'globe'],
    leaks: ['Утечки паролей', '#d6a6ff', 'vault'],
    browsers: ['Браузеры', '#8fb4ff', 'crowd'],
    air: ['Эфир Wi‑Fi', '#7fe3c4', 'link'],
    panic: ['Тревожная кнопка', '#ff8fa3', 'cells'],
    vault: ['Хранилище данных', '#7fe3c4', 'vault'],
    twin: ['Двойник', '#d6a6ff', 'fingerprint'],
    search: ['Анонимный поиск', '#8fb4ff', 'onion'],
    guard: ['Страж', '#7fe3c4', 'monolith'],
    traces: ['Следы в Windows', '#ff8fa3', 'dust'],
    shredder: ['Шредер файлов', '#ff8fa3', 'cells'],
    footprint: ['След в интернете', '#d6a6ff', 'globe'],
    atlas: ['Атлас слежки', '#8fb4ff', 'dust'],
    journal: ['Журнал', '#d6a6ff', 'monolith'],
  };

  Object.assign(A, {
    audit: null, auditedAt: null, undo: new Set(), adversary: store.get('kx.adv', 'ads'), spy: [], radarTotal: null, view: 'overview',
    save() { store.set('kx.adv', A.adversary); },
    pulse(big) { dispatchEvent(new CustomEvent(big ? 'anon:seal' : 'anon:protect', { detail: { on: true } })); },
    go, refresh, refreshSoon, refreshStatus, updateNav,
  });

  /* ---------- плавная прокрутка области контента ---------- */
  const view = $('#view'), viewIn = $('#viewIn');
  let lenis = null;
  if (!reduce && window.Lenis) {
    try { lenis = new Lenis({ wrapper: view, content: viewIn, lerp: 0.1, smoothWheel: true }); lenis.on('scroll', (e) => { state.vel = e.velocity || 0; }); } catch (e) { lenis = null; }
  }

  /* ---------- свет за курсором и плёночное зерно, как на сайте ---------- */
  const spot = $('#spot');
  let tx = innerWidth / 2, ty = innerHeight / 2, sx = tx, sy = ty;
  if (matchMedia('(pointer: fine)').matches) addEventListener('pointermove', (e) => { tx = e.clientX; ty = e.clientY; spot.classList.add('on'); }, { passive: true });
  (function frame(t) {
    requestAnimationFrame(frame);
    if (lenis) lenis.raf(t);
    sx += (tx - sx) * 0.12; sy += (ty - sy) * 0.12;
    spot.style.setProperty('--x', sx.toFixed(1) + 'px'); spot.style.setProperty('--y', sy.toFixed(1) + 'px');
  })(performance.now());
  const grain = $('#grain');
  try {
    const c = document.createElement('canvas'); c.width = c.height = 180;
    const x = c.getContext('2d'), im = x.createImageData(180, 180);
    for (let i = 0; i < im.data.length; i += 4) { const v = Math.random() * 255; im.data[i] = im.data[i + 1] = im.data[i + 2] = v; im.data[i + 3] = 255; }
    x.putImageData(im, 0, 0); grain.style.backgroundImage = 'url(' + c.toDataURL() + ')';
  } catch (e) { grain.remove(); }

  /* ---------- навигация ---------- */
  let token = 0;
  async function go(name, opts) {
    const my = ++token;
    if (A.closeViewer) A.closeViewer();   // открытая страница закрывается при переходе в другой раздел
    if (A.closeSheet) A.closeSheet();     // и окно утилиты тоже
    const m = /^layer-(\d)$/.exec(name), L = m ? C.layers[Number(m[1]) - 1] : null;
    if (!L && !SCREENS[name]) name = 'overview';
    A.view = name;
    $$('.nav-btn').forEach((b) => { if (b.dataset.view === name) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    const [title, accent, shape] = L ? [String(L.n).padStart(2, '0') + ' · ' + L.title, L.accent, L.shape] : SCREENS[name];
    root.style.setProperty('--acc', accent);
    state.accent = accent; state.shape = shape; state.dissolve = name === 'overview' ? 1 : 0;
    scramble($('#tbSection'), title, 520);
    let el;
    try {
      if (name === 'overview') el = window.VIEWS.overview();
      else if (L) el = window.VIEWS.layer(L.n, opts);
      else if (name === 'atlas') el = window.VIEWS.atlas(opts);
      else if (name === 'journal') el = await window.VIEWS.journal();
      else el = await window.TOOLS[name](opts);
    } catch (e) {
      console.error(e);
      el = h('section.screen', h('p.plate.warn', 'Экран не открылся: ' + e.message));
    }
    if (my !== token) return;
    // переход из атласа: плашка с названием пункта и кнопкой назад
    if (opts && opts.from) el.prepend(h('div.plate.from-atlas', h('span.k', 'Из атласа слежки'), h('b', opts.from.name), opts.from.note ? h('span.muted', opts.from.note) : null,
      h('button.key.key--sm', { type: 'button', onclick: () => go('atlas', { term: opts.from.id }) }, '← Назад к пункту')));
    viewIn.textContent = ''; viewIn.append(el);
    if (lenis) { lenis.scrollTo(0, { immediate: true }); lenis.resize(); } else view.scrollTop = 0;
  }
  $$('.nav-btn').forEach((b) => b.addEventListener('click', () => go(b.dataset.view)));
  // хранилище заперлось (бездействие, блокировка Windows, тревога): его данные сразу убираются с экрана
  K.onVaultLocked(() => { refreshStatus(); if (A.view === 'vault') go('vault'); });
  // переход из уведомления (например, «срок ответа истёк» → «Утилиты»)
  K.onGo((name) => { if (typeof name === 'string' && SCREENS[name]) go(name); });
  // перетаскивание файла мимо зоны не должно открывать его в окне
  ['dragover', 'drop'].forEach((ev) => addEventListener(ev, (e) => { if (!e.target.closest || !e.target.closest('.drop')) e.preventDefault(); }));

  /* ---------- проверка и счётчики ---------- */
  async function refresh(showToast) {
    let r;
    try { r = await K.audit(); } catch (e) { r = { ok: false, err: e.message }; }
    if (!r || !r.ok) { toast('Проверка не удалась: ' + ((r && r.err) || 'неизвестная ошибка'), 'bad'); return r; }
    A.audit = r; A.auditedAt = new Date().toISOString(); A.undo = new Set(r.undo || []);
    state.score = r.score / 100;
    updateNav(); refreshStatus();
    if (showToast) { toast('Проверено заново: индекс ' + r.score + '%'); if (A.view === 'overview' || /^layer-/.test(A.view)) go(A.view); }
    return r;
  }
  let soonT;
  function refreshSoon() {
    clearTimeout(soonT);
    soonT = setTimeout(async () => { await refresh(false); if (A.view === 'overview') go('overview'); }, 1200);
  }
  function updateNav() {
    const items = (A.audit && A.audit.items) || [];
    let total = 0;
    for (let n = 1; n <= 9; n++) {
      const own = items.filter((i) => i.layer === n), bad = own.filter((i) => i.good === false).length, el = $('#cnt-' + n);
      total += bad;
      el.className = 'cnt' + (bad ? ' bad' : own.length ? ' ok' : '');
      el.textContent = bad ? String(bad) : own.length ? '✓' : '';
      el.title = bad ? 'требует внимания: ' + bad : '';
    }
    const all = $('#cnt-all');
    all.className = 'cnt' + (total ? ' bad' : ' ok'); all.textContent = A.audit ? (total ? String(total) : '✓') : '';
    const live = (A.spy || []).filter((e) => e.live), sp = $('#cnt-spy');
    sp.className = 'cnt' + (live.length ? ' live' : ''); sp.textContent = live.length ? 'LIVE' : '';
  }
  async function refreshStatus() {
    try { const g = await K.guardStatus(), c = $('#cnt-guard'); c.className = 'cnt' + (g.cfg.on ? ' ok' : ''); c.textContent = g.cfg.on ? 'ВКЛ' : ''; } catch (e) { /* Страж недоступен */ }
    try {
      const v = await K.vaultStats(), c = $('#cnt-vault');
      c.className = 'cnt' + (v.locked ? ' lock' : v.total ? ' ok' : '');
      c.textContent = v.locked ? '⚿' : v.total ? (v.total > 9999 ? Math.round(v.total / 1000) + 'k' : String(v.total)) : '';
      c.title = v.locked ? 'хранилище заперто паролем' : v.encrypted ? 'хранилище открыто, база зашифрована' : '';
    } catch (e) { /* хранилище недоступно */ }
    $('#tbScore').textContent = A.audit ? 'индекс ' + A.audit.score + '%' : 'индекс —';
    try {
      const j = await K.journal(), ok = j.verify.ok;
      $('#tbJournal').textContent = 'журнал ' + (ok ? j.verify.count : j.items.length);
      const hash = $('#tbHash');
      hash.textContent = ok ? '#' + (j.items[0] ? j.items[0].hash.slice(0, 8) : '——') : '#цепочка нарушена';
      hash.style.color = ok ? '' : 'var(--t-trace)';
      hash.title = ok ? 'хэш последней записи журнала (SHA-256)' : 'журнал изменён вне приложения';
    } catch (e) { /* журнал недоступен */ }
  }

  /* ---------- слежка за камерой и микрофоном в фоне ---------- */
  const CAPS = { webcam: 'камеру', microphone: 'микрофон', location: 'геопозицию' };
  let seen = null;
  async function pollSpy() {
    let r; try { r = await K.spy(); } catch (e) { return; }
    if (!r || !r.ok) return;
    const live = r.list.filter((e) => e.live), keys = new Set(live.map((e) => e.cap + ':' + e.key));
    if (seen) live.filter((e) => !seen.has(e.cap + ':' + e.key)).forEach((e) => {
      if (!A.guardWatch) K.notify('KenoxANON · ' + e.name, e.name + ' включил ' + CAPS[e.cap]);
      toast(e.name + ' включил ' + CAPS[e.cap], 'warn');
    });
    seen = keys; A.spy = r.list; updateNav();
  }

  /* ---------- заставка: пока Windows отвечает, показываем, что проверяется ---------- */
  const STEPS = ['Ядро и журнал изменений', 'Реестр приватности', 'Брандмауэр и Защитник', 'Шифрование диска', 'DNS и сетевые адаптеры', 'Профили Wi‑Fi', 'Установленные программы'];
  async function boot() {
    const log = $('#bootLog'), bar = $('#bootBar'), bootEl = $('#boot');
    let i = 0;
    const line = (t, v, tone) => { log.append(h('li', h('span', t), h('b', { style: tone ? { color: tone } : null }, v || 'ok'))); while (log.children.length > 8) log.firstChild.remove(); };
    const setBar = (p) => { bar.style.transform = 'scaleX(' + p.toFixed(3) + ')'; };
    setBar(0.04);
    const tick = setInterval(() => { if (i < STEPS.length - 1) { line(STEPS[i++]); setBar(0.06 + i / STEPS.length * 0.8); } }, 760);
    const auditP = refresh(false);
    const extra = Promise.all([
      pollSpy(),
      K.guardStatus().then((g) => { A.guardWatch = g.cfg.on && g.cfg.watch; }).catch(() => {}),
      K.radar().then((r) => { if (r && r.ok) A.radarTotal = r.total; }).catch(() => {}),
      refreshStatus(),
    ]);
    await Promise.all([auditP, extra, new Promise((res) => setTimeout(res, reduce ? 100 : 2600))]);
    const r = await auditP;
    clearInterval(tick);
    while (i < STEPS.length) line(STEPS[i++]);
    line('Индекс невидимости', r && r.ok ? r.score + '%' : 'ошибка', r && r.ok ? null : 'var(--t-trace)');
    setBar(1);
    await new Promise((res) => setTimeout(res, reduce ? 0 : 650));
    await go('overview');
    state.introDone = true;
    openCurtain(bootEl);
    setInterval(pollSpy, 20000);
  }

  // пиксельный занавес: квадраты гаснут от центра к краям
  function openCurtain(el) {
    const cv = $('#bootPx'), dpr = Math.min(2, devicePixelRatio || 1), W = innerWidth, H = innerHeight, S = 32;
    const cols = Math.ceil(W / S), rows = Math.ceil(H / S), x = cv.getContext('2d');
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); x.scale(dpr, dpr);
    const cells = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const dx = (c + 0.5) / cols - 0.5, dy = ((r + 0.5) / rows - 0.5) * (H / W);
      cells.push({ c, r, t: Math.hypot(dx, dy) * 1.6 + Math.random() * 0.32 });
    }
    const maxT = Math.max(...cells.map((k) => k.t)) + 0.06, t0 = performance.now(), D = reduce ? 1 : 1150;
    const accent = getComputedStyle(root).getPropertyValue('--acc').trim() || '#f3f4f7';
    const draw = (now) => {
      const p = (now - t0) / D * maxT;
      x.clearRect(0, 0, W, H);
      let left = 0;
      x.fillStyle = '#07080b';
      for (const k of cells) if (k.t > p) { x.fillRect(k.c * S, k.r * S, S, S); left++; }
      x.fillStyle = accent;
      for (const k of cells) if (k.t > p && k.t < p + 0.05) x.fillRect(k.c * S + S * 0.34, k.r * S + S * 0.34, S * 0.32, S * 0.32);
      if (left && now - t0 < D + 300) requestAnimationFrame(draw); else el.remove();
    };
    draw(t0);
    el.classList.add('is-opening');
  }

  addEventListener('keydown', (e) => {
    if (e.key === 'F5') { e.preventDefault(); toast('Проверяю систему заново…', 'warn'); refresh(true); }
  });

  boot();
})();
