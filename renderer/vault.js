/* Хранилище данных: загрузка своих выгрузок, поиск, метки и удаление. Всё хранится только на этом компьютере.
   По желанию — под паролем: база шифруется, а открытая копия живёт только в памяти и сама запирается. */
(function () {
  'use strict';
  const { h, toast, confirmBox, fmtBytes, plural } = window.UI;
  const A = window.APP = window.APP || {};
  const head = window.VIEWS.head;
  const K = window.kenox;

  const CAT = {
    history: { name: 'История', icon: '◷', color: 'var(--t-browser)' },
    bookmark: { name: 'Закладки', icon: '★', color: 'var(--t-device)' },
    contact: { name: 'Контакты', icon: '☺', color: 'var(--t-behav)' },
    message: { name: 'Сообщения', icon: '✉', color: 'var(--t-net)' },
    media: { name: 'Медиа', icon: '▣', color: 'var(--t-trace)' },
    file: { name: 'Файлы', icon: '▤', color: 'var(--mist)' },
    activity: { name: 'Активность', icon: '◔', color: 'var(--t-super)' },
  };
  const SERVICE = { telegram: 'Telegram', discord: 'Discord', chrome: 'Chrome', google: 'Google', youtube: 'YouTube', instagram: 'Instagram', facebook: 'Facebook', whatsapp: 'WhatsApp', contacts: 'Контакты', browser: 'Браузер', files: 'Папка', export: 'Файл из выгрузки', csv: 'Таблица', reader: 'Сохранено из Читалки' };
  const HELP = [
    ['Telegram', 'Telegram Desktop → Настройки → Продвинутые настройки → «Экспорт данных из Telegram», формат «Машиночитаемый JSON». Загрузи папку выгрузки или файл result.json.'],
    ['Discord', 'Настройки → Конфиденциальность → «Запросить все мои данные». Через несколько дней на почту придёт архив package.zip — загрузи его целиком.'],
    ['Google', 'takeout.google.com: отметь Chrome, «Мои действия» (в настройках выбери формат JSON), YouTube и Контакты. Загрузи ZIP-архив.'],
    ['Instagram и Facebook', 'Центр аккаунтов → «Ваша информация и разрешения» → «Скачать информацию», формат JSON. Загрузи архив.'],
    ['WhatsApp', 'Открой чат → меню → «Ещё» → «Экспорт чата» → «Без медиафайлов». Получится файл .txt.'],
    ['Закладки браузера', 'В любом браузере: «Диспетчер закладок» → «Экспорт закладок». Получится файл .html.'],
    ['Контакты телефона', 'В приложении «Контакты» → «Экспорт» в файл .vcf.'],
    ['Steam и другие', 'Если сервис даёт таблицу CSV, она загрузится как «Активность».'],
    ['Страницы из интернета', 'В «Анонимном поиске» открой результат в «Читалке» и нажми «★ Сохранить в хранилище» — текст страницы можно будет читать без сети.'],
  ];
  const IDLE = [[5, '5 минут'], [15, '15 минут'], [60, '1 час'], [240, '4 часа'], [0, 'никогда']];
  const when = (ts) => {
    if (!ts) return '';
    if (/(Z|[+-]\d{2}:?\d{2})$/i.test(ts)) { const d = new Date(ts); if (!Number.isNaN(d.getTime())) return d.toLocaleDateString('ru-RU') + ' ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }); }
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(ts); return m ? m[3] + '.' + m[2] + '.' + m[1] + (m[4] ? ' ' + m[4] + ':' + m[5] : '') : ts; };
  // подсветка совпадений: маркеры \u0001…\u0002 из поиска превращаются в <mark> без innerHTML
  function marked(text) {
    const frag = document.createDocumentFragment();
    String(text).split('\u0001').forEach((part, i) => { if (!i) { frag.append(part); return; } const [m, rest] = part.split('\u0002'); frag.append(h('mark', m), rest || ''); });
    return frag;
  }
  // оценка пароля: длина и разнообразие символов (без отправки куда-либо)
  function strength(p) {
    if (!p) return { n: 0, label: '', c: 'transparent' };
    let pool = 0;
    if (/[a-z]/.test(p)) pool += 26; if (/[A-Z]/.test(p)) pool += 26; if (/[а-яё]/.test(p)) pool += 33; if (/[А-ЯЁ]/.test(p)) pool += 33;
    if (/\d/.test(p)) pool += 10; if (/[^a-zA-Zа-яёА-ЯЁ\d]/.test(p)) pool += 30;
    const bits = p.length * Math.log2(Math.max(pool, 2)) * Math.min(1, new Set(p).size / Math.max(4, p.length * 0.6));
    if (p.length < 8) return { n: 1, label: 'короче 8 символов', c: 'var(--t-trace)' };
    return bits < 45 ? { n: 1, label: 'слабый', c: 'var(--t-trace)' } : bits < 65 ? { n: 2, label: 'средний', c: 'var(--t-super)' } : bits < 85 ? { n: 3, label: 'хороший', c: 'var(--t-net)' } : { n: 4, label: 'отличный', c: 'var(--t-net)' };
  }
  const pwField = (ph) => h('input.field.grow', { type: 'password', placeholder: ph, autocomplete: 'new-password', spellcheck: 'false', maxlength: '256', 'aria-label': ph });
  const clear = (...inputs) => inputs.forEach((i) => { if (i) i.value = ''; });

  function vault(opts) {
    const s = h('section.screen.vault', head(['Хранилище', 'только на этом компьютере'], 'Мои', 'данные',
      'Загрузи выгрузки из Telegram, Discord, Google, Instagram или WhatsApp, папки с фото и страницы из «Читалки» — всё сложится в одну базу на этом компьютере. Здесь можно искать, ставить метки и удалять лишнее.'));
    const headEl = s.firstChild;
    let gen = 0;
    async function build() {
      const my = ++gen, st = await K.vaultStatus();
      if (my !== gen) return;
      while (s.lastChild !== headEl) s.lastChild.remove();
      if (st.locked) s.append(lockCard()); else full(st);
    }

    /* ---------- заперто: только поле пароля ---------- */
    function lockCard() {
      const pw = h('input.field.grow', { type: 'password', placeholder: 'пароль хранилища', autocomplete: 'current-password', spellcheck: 'false', 'aria-label': 'Пароль хранилища' });
      const msg = h('p.muted.vlock__msg', 'Пароль нигде не хранится. Без него данные не прочитать — даже если скопировать файл.');
      const go = h('button.key.key--snow', { type: 'button', onclick: tryUnlock }, 'Открыть');
      pw.addEventListener('keydown', (e) => { if (e.key === 'Enter') tryUnlock(); });
      async function tryUnlock() {
        if (!pw.value || go.disabled) return;
        go.disabled = true; msg.classList.remove('is-bad'); msg.textContent = 'Проверяю пароль…';
        const r = await K.vaultUnlock(pw.value); clear(pw);
        go.disabled = false;
        if (!r.ok) { msg.textContent = r.err || 'Не получилось открыть'; msg.classList.add('is-bad'); pw.focus(); return; }
        toast('Хранилище открыто', 'ok'); A.refreshStatus(); build();
      }
      async function wipeForgot() {
        if (!(await confirmBox({ kicker: 'Без возможности восстановления', title: 'Стереть хранилище и снять пароль?', ok: 'Стереть всё', danger: true, check: 'Понимаю: все данные в хранилище исчезнут навсегда',
          body: [h('p', 'Зашифрованный файл будет перезаписан случайными байтами и удалён. Хранилище станет пустым и без пароля. Исходные выгрузки и папки на диске не трогаются.')] }))) return;
        await K.vaultWipe(); toast('Хранилище стёрто'); A.pulse(true); A.refreshStatus(); build();
      }
      requestAnimationFrame(() => pw.focus());
      return h('div.plate.vlock',
        h('div.vlock__top', h('span.vlock__ico', '⚿'), h('div', h('b', 'Хранилище заперто паролем'), h('span.muted', 'База зашифрована (AES-256). Введи пароль, чтобы открыть её на этом компьютере.'))),
        h('div.row', pw, go), msg,
        h('details.vlock__forgot', h('summary', 'Забыл пароль?'),
          h('p.muted', 'Восстановить пароль нельзя — ни нам, ни кому-либо ещё: так устроено шифрование. Можно только стереть хранилище и начать заново. Исходные выгрузки и папки на диске не пострадают.'),
          h('button.key.key--sm.key--accent', { type: 'button', onclick: wipeForgot }, 'Стереть хранилище и снять пароль')));
    }

    /* ---------- открыто: загрузка, поиск, источники, пароль ---------- */
    function full(st) {
      const f = { q: '', category: null, tag: null, source: null };
      let offset = 0, total = 0, stats = null, busy = false;

      /* 1 · загрузить */
      const drop = h('div.plate.drop.vdrop',
        h('b', 'Перетащи выгрузку сюда'),
        h('span.muted', 'ZIP-архив, JSON, HTML, CSV, VCF, TXT или распакованная папка выгрузки'),
        h('div.row',
          h('button.key.key--snow', { type: 'button', onclick: async () => go(await K.pickExport()) }, 'Выбрать файлы выгрузки'),
          h('button.key', { type: 'button', onclick: async () => go(await K.pickAny(true)) }, 'Выбрать папку выгрузки'),
          h('button.key', { type: 'button', onclick: async () => { const d = await K.pickAny(true); if (d && d[0]) index(d[0]); } }, 'Добавить папку с фото и файлами')));
      drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('is-over'); });
      drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
      drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('is-over'); go(Array.from(e.dataTransfer.files).map((x) => { try { return K.pathOf(x); } catch (err) { return ''; } }).filter(Boolean)); });
      const help = h('details.plate.vhelp', h('summary', 'Где взять свои данные — короткие инструкции'),
        h('div.vhelp__list', HELP.map(([t, p]) => h('div', h('b', t), h('p', p)))),
        h('p.muted', 'Пароли и данные платёжных карт не импортируются, даже если попались в выгрузке. Почта, телефон и IP из профиля Discord тоже не берутся — только друзья.'));
      const prog = h('div.plate.vprog', { hidden: true }), report = h('div.stack');

      /* 2 · найти */
      const cats = h('div.vcats'), input = h('input.field.grow', { type: 'search', placeholder: 'искать по всем данным: слово, имя, адрес сайта', spellcheck: 'false' });
      const chips = h('div.row.vchips'), tagbar = h('div.row.vtags'), chart = h('div.plate.vchart'), list = h('div.vlist'), more = h('div.row');
      const found = h('div.row.vfound');
      let t;
      input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { f.q = input.value.trim(); load(); }, 250); });

      /* 3 · источники, 4 · пароль */
      const sources = h('div.stack'), guard = h('div.stack');

      s.append(
        st.encrypted ? h('div.row.vlockbar', h('span.vlockbar__ico', '⚿'), h('span', 'Под паролем · база зашифрована, открытая копия только в памяти' + (st.idle ? ' · запрётся через ' + (IDLE.find((x) => x[0] === st.idle) || [0, st.idle + ' мин'])[1] + ' без действий' : '')),
          h('button.key.key--sm', { type: 'button', onclick: lockNow }, 'Запереть сейчас')) : null,
        h('p.vstep', h('b', '1'), 'Загрузить'), drop, help, prog, report,
        h('p.vstep', h('b', '2'), 'Найти'), cats, h('div.row', input), chips, tagbar, chart, found, list, more,
        h('p.vstep', h('b', '3'), 'Источники и удаление'), sources,
        h('p.vstep', h('b', '4'), 'Пароль на хранилище'), guard,
        h('p.muted.vnote', 'Ничего из хранилища не уходит в сеть. Удаление здесь стирает только копию в KenoxANON — сами сервисы и твои файлы не меняются.'));

      /* загрузка выгрузок и папок */
      const off = K.onVaultProgress((p) => { prog.hidden = false; prog.textContent = ''; prog.append(h('b', 'Читаю ' + p.name), h('span.muted', p.total ? (p.done + ' из ' + p.total + ' файлов' + (p.file ? ' · ' + p.file : '')) : 'добавлено ' + p.done)); });
      const obs = new MutationObserver(() => { if (!s.isConnected || !drop.isConnected) { off(); obs.disconnect(); } });
      requestAnimationFrame(() => obs.observe(document.getElementById('viewIn'), { childList: true, subtree: true }));
      async function go(paths) {
        if (!paths || !paths.length || busy) return;
        busy = true; prog.hidden = false; prog.textContent = 'Начинаю…';
        const r = await K.vaultImport(paths);
        busy = false; prog.hidden = true;
        if (r.locked) { build(); return; }
        report.textContent = '';
        (r.results || []).forEach((x) => report.append(h('div.plate.vreport' + (x.error ? '.is-bad' : x.added ? '' : '.is-empty'),
          h('div.tool__head', h('b', x.name), h('span', x.error ? 'ошибка' : '+' + x.added + ' ' + plural(x.added, 'запись', 'записи', 'записей'))),
          x.error ? h('p', x.error) : null,
          x.recognized && Object.keys(x.recognized).length ? h('p', 'Распознано: ' + Object.entries(x.recognized).map(([k, n]) => k + ' — ' + n).join(', ') + '.') : null,
          x.added === 0 && !x.error ? h('p.muted', 'Новых записей нет: либо всё уже загружено раньше, либо формат не подошёл.') : null,
          x.unknownCount ? h('p.muted', 'Не распознано файлов: ' + x.unknownCount + (x.unknown.some((u) => /\.html?$/i.test(u)) ? '. Для Google выбирай при выгрузке формат JSON вместо HTML.' : '.')) : null,
          x.skipped && x.skipped.length ? h('p.muted', 'Пропущено: ' + x.skipped.join('; ')) : null)));
        const added = (r.results || []).reduce((n, x) => n + (x.added || 0), 0);
        toast(added ? 'Загружено записей: ' + added : 'Новых записей нет', added ? 'ok' : 'warn');
        if (added) A.refreshStatus();
        await refresh();
      }
      async function index(dir) {
        if (busy) return; busy = true; prog.hidden = false; prog.textContent = 'Смотрю папку…';
        const r = await K.vaultIndex(dir);
        busy = false; prog.hidden = true;
        if (r.locked) { build(); return; }
        if (!r.ok) { toast(r.err || 'Не получилось', 'bad'); return; }
        toast('Добавлено файлов: ' + r.added + (r.limited ? ' (дошёл до предела 200 000)' : ''), r.added ? 'ok' : 'warn');
        if (r.added) A.refreshStatus();
        await refresh();
      }

      /* фильтры, поиск, список */
      function drawCats() {
        cats.textContent = '';
        const all = h('button.vcat', { type: 'button', 'aria-pressed': f.category ? 'false' : 'true', style: { '--c': 'var(--snow)' }, onclick: () => { f.category = null; load(); } }, h('b', String(stats.total)), h('span', 'Всё'));
        cats.append(all, ...Object.entries(CAT).map(([id, c]) => h('button.vcat', { type: 'button', 'aria-pressed': f.category === id ? 'true' : 'false', disabled: stats.by[id] ? null : true, style: { '--c': c.color }, onclick: () => { f.category = f.category === id ? null : id; load(); } },
          h('b', String(stats.by[id] || 0)), h('span', c.icon + ' ' + c.name))));
        tagbar.textContent = '';
        if (stats.tags.length) tagbar.append(h('span.k', 'Метки'), ...stats.tags.map((x) => h('button.vtag', { type: 'button', 'aria-pressed': f.tag === x.tag ? 'true' : 'false', onclick: () => { f.tag = f.tag === x.tag ? null : x.tag; load(); } }, '#' + x.tag + ' · ' + x.n)));
      }
      function drawChips() {
        chips.textContent = '';
        const chip = (label, clr) => h('button.vchip', { type: 'button', onclick: () => { clr(); load(); } }, label + ' ✕');
        if (f.category) chips.append(chip('Раздел: ' + CAT[f.category].name, () => { f.category = null; }));
        if (f.tag) chips.append(chip('Метка: #' + f.tag, () => { f.tag = null; }));
        if (f.source) { const src = stats.sources.find((x) => x.id === f.source); chips.append(chip('Источник: ' + (src ? src.name : f.source), () => { f.source = null; })); }
        if (f.q) chips.append(chip('Поиск: ' + f.q, () => { f.q = ''; input.value = ''; }));
      }
      function drawChart(r) {
        chart.textContent = '';
        if (!r.months.length) { chart.hidden = true; return; }
        chart.hidden = false;
        const max = Math.max(...r.months.map((m) => m.n));
        chart.append(h('div.vchart__head', h('b', 'Активность по месяцам'), h('span.k', r.months[0].m + ' — ' + r.months[r.months.length - 1].m)),
          h('div.vbars', r.months.map((m) => h('i', { title: m.m + ': ' + m.n, style: { height: Math.max(4, m.n / max * 100) + '%' } }))),
          r.people.length ? h('p.muted', 'Чаще всего: ' + r.people.map((p) => p.who + ' — ' + p.n).join(', ')) : null);
      }
      function row(r) {
        const c = CAT[r.category] || CAT.file, el = h('article.vrow', { style: { '--c': c.color } });
        const meta = [...new Set([SERVICE[r.service] || r.service, r.place, r.who, r.extra && r.extra.size != null ? fmtBytes(r.extra.size) : null].filter(Boolean))].join(' · ');
        // короткие сообщения: заголовок и текст совпадают — показываем один раз, с подсветкой найденного
        const plainSnip = r.snip ? r.snip.replace(/[\u0001\u0002]/g, '').replace(/^…|…$/g, '').trim() : '';
        const snipIsTitle = !!plainSnip && !!r.title && r.title.replace(/\s+/g, ' ').trim().startsWith(plainSnip.replace(/\s+/g, ' ').slice(0, 60));
        const tags = h('span.vrow__tags', r.tags.map((tg) => h('button.vtag.vtag--on', { type: 'button', title: 'Снять метку', onclick: async () => { await K.vaultUntag(r.id, tg); r.tags = r.tags.filter((x) => x !== tg); el.replaceWith(row(r)); refreshStats(); } }, '#' + tg + ' ✕')));
        const addTag = h('button.vrow__btn', { type: 'button', onclick: () => {
          const inp = h('input.field.vtag-input', { placeholder: 'метка и Enter', maxlength: '32' });
          inp.addEventListener('keydown', async (e) => {
            if (e.key === 'Escape') { inp.replaceWith(addTag); return; }
            if (e.key !== 'Enter' || !inp.value.trim()) return;
            const res = await K.vaultTag([r.id], inp.value);
            if (res.ok && !r.tags.includes(res.tag)) r.tags.push(res.tag);
            el.replaceWith(row(r)); refreshStats();
          });
          inp.addEventListener('blur', () => { if (inp.isConnected && !inp.value.trim()) inp.replaceWith(addTag); });
          addTag.replaceWith(inp); inp.focus();
        } }, '+ метка');
        // сохранённая из «Читалки» страница читается прямо здесь, без сети
        const readBtn = r.extra && r.extra.saved && window.VIEWER ? h('button.vrow__btn.vrow__read', { type: 'button', onclick: async () => {
          const x = await K.vaultItem(r.id);
          if (x.ok) window.VIEWER.openSaved(x.item); else toast(x.err || 'Не получилось открыть', 'bad');
        } }, 'читать') : null;
        const openBtn = /^https:\/\//i.test(r.url || '') ? h('button.vrow__btn', { type: 'button', onclick: () => K.link(r.url) }, 'открыть ↗')
          : r.url && /^[a-z]:\\/i.test(r.url) ? h('button.vrow__btn', { type: 'button', onclick: () => K.vaultReveal(r.url) }, 'в папке') : null;
        const del = h('button.vrow__btn.vrow__del', { type: 'button', title: 'Удалить из хранилища', onclick: async () => { await K.vaultDelete([r.id]); el.remove(); total--; if (found.firstChild) found.firstChild.textContent = 'Найдено: ' + total; toast('Удалено из хранилища'); refreshStats(); } }, 'удалить');
        const body = r.snip && !snipIsTitle ? marked(r.snip) : !r.snip && r.body && r.body !== r.title ? r.body.slice(0, 260) : null;
        el.append(h('span.vrow__ico', c.icon),
          h('div.vrow__main',
            h('div.vrow__top', h('b.vrow__title', snipIsTitle ? marked(r.snip) : r.title || r.url || '—'), h('span.vrow__when', when(r.ts))),
            body ? h('p.vrow__body', body) : null,
            h('div.vrow__meta', h('span', meta), tags)),
          h('div.vrow__act', readBtn, addTag, openBtn, del));
        return el;
      }
      async function load(append) {
        if (!append) offset = 0;
        drawChips();
        if (stats) drawCats();
        const r = await K.vaultQuery({ ...f, limit: 50, offset });
        if (r.locked) { build(); return; }
        if (!s.isConnected || !r.ok) return;
        total = r.total;
        if (!append) {
          list.textContent = ''; drawChart(r);
          found.textContent = '';
          found.append(h('b', 'Найдено: ' + total));
          if (total && (f.q || f.category || f.tag || f.source)) found.append(h('button.key.key--sm', { type: 'button', onclick: removeFound }, 'Удалить найденное'));
        }
        if (!total && !append) list.append(h('p.plate.muted', stats && stats.total ? 'Ничего не нашлось — попробуй другое слово или сними фильтры.' : 'Хранилище пока пустое. Начни с шага 1: загрузи выгрузку или добавь папку.'));
        r.rows.forEach((x) => list.append(row(x)));
        offset += r.rows.length;
        more.textContent = '';
        if (offset < total) more.append(h('button.key', { type: 'button', onclick: () => load(true) }, 'Показать ещё · осталось ' + (total - offset)));
      }
      async function removeFound() {
        const ok = await confirmBox({ kicker: 'Удаление из хранилища', title: 'Удалить ' + total + ' ' + plural(total, 'запись', 'записи', 'записей') + '?', ok: 'Удалить', danger: true, body: [
          h('p', 'Удалятся все записи, которые сейчас найдены. Сами сервисы и файлы на диске не изменятся — стирается только копия в KenoxANON.')] });
        if (!ok) return;
        const r = await K.vaultDeleteQuery({ ...f });
        toast('Удалено записей: ' + (r.removed || 0)); f.q = ''; input.value = ''; await refresh();
      }
      function drawSources() {
        sources.textContent = '';
        if (!stats.sources.length) sources.append(h('p.muted', 'Источников пока нет.'));
        else sources.append(h('div.plate.vsources', stats.sources.map((x) => h('div.vsrc',
          h('div', h('b', x.name), h('span.muted', ({ folder: 'папка', saved: 'страницы из Читалки' }[x.kind] || 'выгрузка') + ' · ' + x.count + ' ' + plural(x.count, 'запись', 'записи', 'записей') + ' · ' + when(x.added))),
          h('div.row',
            h('button.key.key--sm', { type: 'button', onclick: () => { f.source = x.id; load(); list.scrollIntoView({ block: 'start', behavior: 'smooth' }); } }, 'Показать'),
            h('button.key.key--sm', { type: 'button', onclick: async () => {
              if (!(await confirmBox({ kicker: 'Удаление из хранилища', title: 'Удалить источник «' + x.name + '»?', ok: 'Удалить', danger: true, body: [h('p', 'Удалятся ' + x.count + ' ' + plural(x.count, 'запись', 'записи', 'записей') + ' из этого источника. Исходные файлы не меняются.')] }))) return;
              await K.vaultDeleteSource(x.id); if (f.source === x.id) f.source = null; toast('Источник удалён'); refresh();
            } }, 'Удалить'))))));
        sources.append(h('div.row.vwipe', h('span.muted', (stats.encrypted ? 'Зашифрованная база: ' : 'База: ') + fmtBytes(stats.size) + ' · ' + stats.file),
          h('button.key.key--accent', { type: 'button', onclick: async () => {
            if (!(await confirmBox({ kicker: 'Без возможности восстановления', title: 'Стереть хранилище целиком?', ok: 'Стереть всё', danger: true, check: 'Понимаю: все загруженные данные исчезнут из KenoxANON',
              body: [h('p', stats.encrypted ? 'Все записи удалятся, старый зашифрованный файл будет перезаписан случайными байтами. Пароль останется. Исходные выгрузки и папки не трогаются.'
                : 'Файл базы будет перезаписан случайными байтами и удалён, вместо него появится пустой. Исходные выгрузки и папки не трогаются.')] }))) return;
            await K.vaultWipe(); f.q = ''; f.category = f.tag = f.source = null; input.value = ''; report.textContent = ''; toast('Хранилище стёрто'); A.pulse(true); refresh();
          } }, 'Стереть хранилище целиком')));
      }

      /* 4 · пароль: поставить, сменить, снять; когда запирать */
      function drawGuard() {
        guard.textContent = '';
        if (!st.encrypted) {
          const p1 = pwField('новый пароль, от 8 символов'), p2 = pwField('ещё раз');
          const meter = h('div.vpass__meter', h('i')), hint = h('span.vpass__hint'), msg = h('p.muted');
          const sure = h('input', { type: 'checkbox' });
          const goB = h('button.key.key--snow', { type: 'button', onclick: setPw }, 'Зашифровать хранилище');
          p1.addEventListener('input', () => { const x = strength(p1.value); meter.style.setProperty('--w', (x.n * 25) + '%'); meter.style.setProperty('--c', x.c); hint.textContent = x.label ? 'Пароль: ' + x.label : ''; });
          async function setPw() {
            if (goB.disabled) return;
            if (p1.value !== p2.value) { msg.textContent = 'Пароли не совпадают'; return; }
            if (p1.value.length < 8) { msg.textContent = 'Пароль короче 8 символов'; return; }
            if (!sure.checked) { msg.textContent = 'Отметь, что понимаешь: забытый пароль не восстановить'; return; }
            goB.disabled = true; msg.textContent = 'Шифрую базу…';
            const r = await K.vaultSetPassword(p1.value); clear(p1, p2);
            goB.disabled = false;
            if (!r.ok) { msg.textContent = r.err || 'Не получилось'; return; }
            toast('Хранилище зашифровано · открытый файл перезаписан и удалён', 'ok'); A.pulse(); A.refreshStatus(); build();
          }
          guard.append(h('div.plate.vpass',
            h('p', 'Сейчас база хранится открытым файлом: кто скопирует его с компьютера, прочитает всё. С паролем база шифруется (AES-256), а расшифрованная копия живёт только в памяти, пока хранилище открыто, и сама запирается.'),
            h('div.row', p1, p2), h('div.row.vpass__strength', meter, hint),
            h('label.vpass__sure', sure, h('span', 'Понимаю: если забуду пароль, данные не вернуть — его нельзя восстановить')),
            h('div.row', goB), msg,
            h('p.muted', 'Пароль нигде не сохраняется. Старый открытый файл перезаписывается случайными байтами и удаляется.')));
          return;
        }
        // под паролем: когда запирать и управление паролем
        const idleSel = h('select.field.vpass__idle', { 'aria-label': 'Запирать без действий через' }, IDLE.map(([v, n]) => h('option', { value: String(v) }, n)));
        idleSel.value = String(IDLE.some((x) => x[0] === st.idle) ? st.idle : 15);
        idleSel.addEventListener('change', async () => { const r = await K.vaultLockSettings({ idle: Number(idleSel.value) }); st.idle = r.idle; toast('Запирать без действий: ' + idleSel.selectedOptions[0].textContent); });
        const chk = (key, label) => { const c = h('input', { type: 'checkbox' }); c.checked = !!st[key]; c.addEventListener('change', async () => { const r = await K.vaultLockSettings({ [key]: c.checked }); st[key] = r[key]; }); return h('label.vpass__chk', c, h('span', label)); };
        const area = h('div.stack');
        const form = (title, fields, label, fn, danger) => {
          const msg = h('p.muted'), b = h('button.key' + (danger ? '.key--accent' : '.key--snow'), { type: 'button' }, label);
          b.addEventListener('click', async () => { if (b.disabled) return; b.disabled = true; msg.textContent = 'Проверяю…'; const r = await fn(msg); b.disabled = false; if (r && !r.ok) msg.textContent = r.err || 'Не получилось'; });
          area.replaceChildren(h('div.plate.vpass', h('b', title), h('div.row', ...fields), h('div.row', b, h('button.key', { type: 'button', onclick: () => area.replaceChildren() }, 'Отмена')), msg));
          fields[0].focus();
        };
        const changeB = h('button.key.key--sm', { type: 'button', onclick: () => {
          const o = pwField('текущий пароль'), n1 = pwField('новый пароль'), n2 = pwField('ещё раз');
          form('Сменить пароль', [o, n1, n2], 'Сменить', async (msg) => {
            if (n1.value !== n2.value) return { ok: false, err: 'Новые пароли не совпадают' };
            const r = await K.vaultChangePassword(o.value, n1.value); clear(o, n1, n2);
            if (r.ok) { toast('Пароль сменён', 'ok'); area.replaceChildren(); }
            return r;
          });
        } }, 'Сменить пароль');
        const removeB = h('button.key.key--sm', { type: 'button', onclick: () => {
          const o = pwField('текущий пароль');
          form('Снять пароль — база снова будет храниться открытым файлом', [o], 'Снять пароль', async () => {
            const r = await K.vaultRemovePassword(o.value); clear(o);
            if (r.ok) { toast('Пароль снят', 'warn'); A.refreshStatus(); build(); }
            return r;
          }, true);
        } }, 'Снять пароль');
        guard.append(h('div.plate.vpass',
          h('p', h('b', '⚿ Хранилище под паролем.'), ' База зашифрована AES-256-GCM, ключ получается из пароля (scrypt). Пока хранилище открыто, расшифрованная копия есть только в памяти.'),
          h('div.row', h('span.k', 'Запирать без действий через'), idleSel),
          chk('onSystemLock', 'запирать, когда блокируешь Windows (Win+L) или компьютер засыпает'),
          chk('onHide', 'запирать, когда окно KenoxANON уходит в трей'),
          h('p.muted', 'Тревожная кнопка и выход из приложения запирают хранилище всегда.'),
          h('div.row', h('button.key.key--sm.key--snow', { type: 'button', onclick: lockNow }, 'Запереть сейчас'), changeB, removeB)), area);
      }
      async function lockNow() { const r = await K.vaultLock(); if (r.deferred) toast('Хранилище запрётся, как только закончится загрузка'); else if (!r.ok) toast(r.err, 'bad'); }

      async function refreshStats() {
        stats = await K.vaultStats(); A.refreshStatus();
        if (stats.locked) { build(); return; }
        if (s.isConnected) { drawCats(); drawSources(); }
      }
      async function refresh() { await refreshStats(); if (!stats.locked) await load(); }
      drawGuard();
      refresh();
    }

    build();
    return s;
  }

  Object.assign(window.TOOLS, { vault });
})();
