/* Двойник: досье на тебя по твоим же файлам — и кнопки, которые убирают найденные следы. */
(function () {
  'use strict';
  const { h, toast, confirmBox, plural } = window.UI;
  const A = window.APP = window.APP || {};
  const head = window.VIEWS.head;
  const K = window.kenox;
  const LEVEL = { high: ['уверенно', 'var(--t-trace)'], medium: ['вероятно', 'var(--t-device)'], low: ['догадка', 'var(--t-browser)'], none: ['чисто', 'var(--t-net)'] };
  const FIX = {
    gps: ['Стереть место съёмки', 'Координаты удалятся из самих фото и видео. Изображение, модель камеры и даты останутся.'],
    serial: ['Стереть серийные номера', 'Из снимков удалятся серийный номер камеры и имя владельца. Остальное не меняется.'],
    docs: ['Стереть авторов документов', 'Из документов удалятся автор, редакторы, авторы комментариев, организация и даты. Текст и оформление не меняются.'],
  };

  // карта без карты: точки снимков в относительных координатах, ничего не загружается из сети
  function dots(f) {
    const c = h('canvas.tmap', { width: '640', height: '220' });
    requestAnimationFrame(() => {
      // приближаем к району дома (±20 км), далёкие снимки только подсчитываем
      const near = f.home ? f.points.filter((p) => Math.abs(p[0] - f.home[0]) < 0.2 && Math.abs(p[1] - f.home[1]) < 0.35) : f.points;
      const ctx = c.getContext('2d'), W = c.width, H = c.height, pts = near.length >= 2 ? near : f.points, far = f.points.length - pts.length;
      const lats = pts.map((p) => p[0]), lons = pts.map((p) => p[1]);
      const minLa = Math.min(...lats), maxLa = Math.max(...lats), minLo = Math.min(...lons), maxLo = Math.max(...lons);
      const sx = (lo) => 16 + (maxLo === minLo ? 0.5 : (lo - minLo) / (maxLo - minLo)) * (W - 32), sy = (la) => H - 16 - (maxLa === minLa ? 0.5 : (la - minLa) / (maxLa - minLa)) * (H - 32);
      ctx.fillStyle = 'rgba(255,255,255,.05)'; for (let x = 0; x < W; x += 16) for (let y = 0; y < H; y += 16) ctx.fillRect(x, y, 1, 1);
      ctx.fillStyle = 'rgba(214,166,255,.75)'; for (const [la, lo] of pts) ctx.fillRect(Math.round(sx(lo)) - 2, Math.round(sy(la)) - 2, 4, 4);
      const placed = [];
      const mark = (p, color, label) => {
        if (!p || !pts.some((q) => q[0] === p[0] && q[1] === p[1]) && !(near.length >= 2 && Math.abs(p[0] - (f.home || p)[0]) < 0.2)) return;
        const x = Math.round(sx(p[1])), y = Math.round(sy(p[0]));
        let ly = Math.max(14, y - 10); while (placed.some((q) => Math.abs(q - ly) < 15)) ly += 16; placed.push(ly);
        ctx.fillStyle = color; ctx.fillRect(x - 6, y - 6, 12, 12); ctx.fillStyle = '#07080b'; ctx.fillRect(x - 2, y - 2, 4, 4);
        ctx.fillStyle = color; ctx.font = '12px "JetBrains Mono", monospace'; ctx.fillText(label, Math.min(W - 80, x + 12), ly);
      };
      mark(f.home, '#ff8fa3', 'дом?'); mark(f.work, '#ffe08a', 'работа?');
      if (far > 0) { ctx.fillStyle = 'rgba(201,206,216,.7)'; ctx.font = '11px "JetBrains Mono", monospace'; ctx.textAlign = 'right'; ctx.fillText('ещё ' + far + ' снимк. далеко отсюда', W - 10, H - 8); ctx.textAlign = 'left'; }
    });
    return c;
  }
  function bars(hours) {
    const max = Math.max(1, ...hours);
    return h('div.thours', hours.map((n, i) => h('i', { title: String(i).padStart(2, '0') + ':00 — ' + n, style: { height: Math.max(3, n / max * 100) + '%' } })), h('div.thours__axis', ['00', '06', '12', '18', '23'].map((t) => h('span', t))));
  }

  function twin() {
    let folders = [];
    const s = h('section.screen', head(['Двойник', 'досье по твоим же данным'], 'Твой', 'двойник',
      'Так тебя видит тот, кому попали твои файлы или фото, которые ты отправляешь. Всё считается на этом компьютере и нигде не сохраняется. Рядом с выводами — кнопки, которые убирают след.'));
    const chips = h('div.row.tfolders'), prog = h('p.muted', { hidden: true }), out = h('div.stack');
    const runBtn = h('button.key.key--accent', { type: 'button', onclick: () => run() }, 'Собрать досье');
    const where = h('article.plate.tool.twhere',
      h('div.tool__head', h('b', 'Где искать'), h('span', 'читаются только метаданные · папку можно перетащить сюда')),
      chips,
      h('div.row', runBtn, h('button.key', { type: 'button', onclick: async () => { const d = await K.pickAny(true); if (d && d[0] && !folders.includes(d[0])) { folders.push(d[0]); drawChips(); } } }, 'Добавить папку'), prog),
      h('p.muted', 'Из фото и видео берутся координаты, камера и время съёмки, из документов — авторы и организация. Сами снимки и тексты не открываются, в сеть ничего не уходит.'));
    where.addEventListener('dragover', (e) => { e.preventDefault(); where.classList.add('is-over'); });
    where.addEventListener('dragleave', () => where.classList.remove('is-over'));
    where.addEventListener('drop', (e) => {
      e.preventDefault(); where.classList.remove('is-over');
      Array.from(e.dataTransfer.files).map((x) => { try { return K.pathOf(x); } catch (err) { return ''; } }).filter((p) => p && !folders.includes(p)).forEach((p) => folders.push(p));
      drawChips();
    });
    s.append(where, out);
    function drawChips() {
      chips.textContent = '';
      if (!folders.length) chips.append(h('span.muted', 'Папок нет — добавь хотя бы одну.'));
      folders.forEach((f) => chips.append(h('button.vchip.tchip', { type: 'button', title: 'Убрать папку', onclick: () => { folders = folders.filter((x) => x !== f); drawChips(); } }, f + ' ✕')));
    }
    const off = K.onTwinProgress((p) => {
      prog.hidden = false;
      prog.textContent = p.phase === 'files' ? 'Смотрю файлы… ' + p.done : p.phase === 'photo' ? 'Читаю снимки: ' + p.done + ' из ' + p.total : p.phase === 'doc' ? 'Читаю документы: ' + p.done + ' из ' + p.total : 'Смотрю систему: сети, программы, соединения…';
    });
    const obs = new MutationObserver(() => { if (!s.isConnected) { off(); obs.disconnect(); } });
    requestAnimationFrame(() => obs.observe(document.getElementById('viewIn'), { childList: true }));

    async function run() {
      if (!folders.length) { toast('Добавь хотя бы одну папку', 'warn'); return; }
      runBtn.disabled = true; out.textContent = '';
      const r = await K.twinScan(folders);
      runBtn.disabled = false; prog.hidden = true; runBtn.textContent = 'Собрать заново';
      if (!s.isConnected) return;
      if (!r.ok) { toast(r.err || 'Не получилось', 'bad'); return; }
      const col = r.score >= 60 ? 'var(--t-trace)' : r.score >= 30 ? 'var(--t-device)' : 'var(--t-net)';
      out.append(h('article.plate.tdoc',
        h('div.tdoc__head', h('span.k', 'Досье · ' + r.host), h('span.k', 'проверено ' + r.stats.files + ' ' + plural(r.stats.files, 'файл', 'файла', 'файлов') + ' · фото ' + r.stats.photos + ' · видео ' + r.stats.videos + ' · документов ' + r.stats.docs)),
        h('div.tdoc__score', h('b', { style: { color: col } }, r.score + '%'), h('span', r.score >= 60 ? 'Двойник узнаёт тебя очень хорошо' : r.score >= 30 ? 'Двойник узнаёт тебя частично' : 'Двойника почти не из чего собрать')),
        h('div.gauge', h('i', { style: { width: r.score + '%', background: col } }))));
      const grid = h('div.tgrid');
      r.findings.forEach((f) => grid.append(card(f)));
      out.append(grid);
      A.pulse();
    }
    function card(f) {
      const [lv, color] = LEVEL[f.found ? f.level : 'none'];
      const el = h('article.plate.tcard' + (f.found ? '' : '.is-clean'), { style: { '--c': color } },
        h('div.tcard__head', h('b', f.title), h('span.tlevel', lv)),
        h('p', f.text));
      if (f.id === 'home' && f.points && f.points.length) el.append(dots(f));
      if (f.id === 'rhythm' && f.found) el.append(bars(f.hours));
      if (f.details && f.details.length) el.append(h('ul.tdetails', f.details.map((d) => h('li', d))));
      const keys = h('div.row');
      for (const a of f.actions || []) {
        if (a.fix) keys.append(h('button.key.key--sm.key--accent', { type: 'button', onclick: () => fix(a.fix, a.label, el) }, a.label));
        else if (a.go) keys.append(h('button.key.key--sm', { type: 'button', onclick: () => A.go(a.go) }, a.label));
        else if (a.link) keys.append(h('button.key.key--sm', { type: 'button', onclick: () => K.link(a.link) }, a.label));
      }
      if (keys.childNodes.length) el.append(keys);
      return el;
    }
    async function fix(kind, label, el) {
      const ok = await confirmBox({ kicker: 'Правка самих файлов', title: label + '?', ok: FIX[kind][0], danger: true, body: [h('p', FIX[kind][1]), h('p.muted', 'Копий не останется — так след исчезает по-настоящему.')] });
      if (!ok) return;
      const r = await K.twinFix(kind);
      if (!r.ok) { toast(r.err || 'Не получилось', 'bad'); return; }
      toast('Готово: ' + r.done + ' ' + plural(r.done, 'файл', 'файла', 'файлов') + (r.failed ? ', не удалось ' + r.failed : ''), r.failed ? 'warn' : 'ok');
      A.pulse(true); A.refreshStatus();
      el.classList.add('is-clean'); el.style.setProperty('--c', 'var(--t-net)');
      el.querySelectorAll('.key--accent').forEach((b) => { if (b.textContent === label) b.replaceWith(h('span.ok-text', '✓ стёрто из ' + r.done + ' ' + plural(r.done, 'файла', 'файлов', 'файлов') + ' — собери досье заново, чтобы увидеть новый результат')); });
    }
    K.twinDefaults().then((d) => { folders = d.folders || []; drawChips(); });
    return s;
  }

  Object.assign(window.TOOLS, { twin });
})();
