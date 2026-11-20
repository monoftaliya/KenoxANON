/* Инструменты: радар соединений, кто подглядывал, метаданные, утечки паролей, браузеры, эфир Wi‑Fi, тревожная кнопка. */
(function () {
  'use strict';
  const { h, toast, confirmBox, fmtBytes, fmtDate, ago, strong, plural } = window.UI;
  const C = window.CONTENT;
  const A = window.APP = window.APP || {};
  const head = window.VIEWS.head;
  const K = window.kenox;
  const capName = (c) => ({ webcam: 'камеру', microphone: 'микрофон', location: 'геопозицию' }[c] || c);
  const stat = (n, label, color) => h('div.plate.stat', { style: color ? { '--c': color } : null }, h('b', String(n)), h('span', label));
  const stack = () => h('div.stack');
  const fail = (box, text) => { box.textContent = ''; box.append(h('p.plate.warn', text)); };

  /* ---------- радар соединений ---------- */
  const KNOWN = [
    [/^(chrome|msedge|firefox|browser|brave|opera|vivaldi|librewolf|tor|mullvadbrowser|zen)$/i, 'браузер'],
    [/^(telegram|whatsapp|signal|discord|slack|teams|ms-teams|viber|zoom|element|session)$/i, 'общение'],
    [/^svchost$/i, 'службы Windows'], [/^(onedrive|dropbox|googledrivefs|yandexdisk.*)$/i, 'облако'],
    [/^(searchhost|searchapp|widgets|msedgewebview2|phoneexperiencehost|startmenuexperiencehost|explorer|lsass|system)$/i, 'встроено в Windows'],
    [/^(xray|v2ray|sing-box|wireguard|openvpn.*|amneziawg|hiddify.*|nekoray|nekobox|clash.*|outline.*|mullvad.*|proton.*vpn.*)$/i, 'VPN / прокси'],
    [/^(msmpeng|mpdefendercoreservice|nissrv|smartscreen)$/i, 'Защитник Windows'],
    [/^(steam|steamwebhelper|epicgameslauncher|battle\.net|riotclientservices)$/i, 'игры'],
    [/^(nvcontainer|nvidia.*|nvbroadcast.*)$/i, 'драйвер NVIDIA'], [/^claude$/i, 'Claude'], [/^(code|cursor|idea64|pycharm64)$/i, 'разработка'],
    [/^(spotify|yandexmusic)$/i, 'музыка'],
  ];
  const kindOf = (name) => (KNOWN.find(([re]) => re.test(name)) || [null, ''])[1];
  const PORTS = { 443: 'https — зашифровано', 80: 'http — без шифрования', 53: 'dns', 853: 'dns-over-tls', 993: 'imap-tls', 587: 'smtp', 465: 'smtp-tls', 5228: 'push-уведомления Google', 9001: 'tor', 3478: 'звонки (stun)', 22: 'ssh', 8080: 'http-alt' };
  A.ptrCache = A.ptrCache || {};

  function ipChip(c) {
    const label = c.ip + ':' + c.port, named = () => A.ptrCache[c.ip] + ' :' + c.port;
    const el = h('button.ip' + (c.port === 80 ? '.ip--plain' : ''), { type: 'button', title: PORTS[c.port] || 'порт ' + c.port, 'data-ip': c.ip }, A.ptrCache[c.ip] ? named() : label);
    el._resolve = async () => {
      if (!A.ptrCache[c.ip]) { el.textContent = 'ищу имя…'; const r = await K.ptr(c.ip); A.ptrCache[c.ip] = r && r.ok ? r.host : 'имя не найдено'; }
      el.textContent = named();
    };
    el.addEventListener('click', () => { if (A.ptrCache[c.ip] && el.textContent !== label) el.textContent = label; else el._resolve(); });
    return el;
  }

  function radar() {
    const s = h('section.screen', head(['Радар', 'живые соединения TCP'], 'Куда ходит', 'компьютер',
      'Каждая полоса — программа и адреса, с которыми она прямо сейчас держит связь. Нажми на адрес — приложение узнает имя сервера. Незашифрованный HTTP подсвечен красным: его содержимое видит провайдер и владелец Wi‑Fi.'));
    const stats = h('div.grid3'), list = stack(), auto = h('input', { type: 'checkbox' });
    let timer = null;
    const resolveAll = async () => {
      const chips = Array.from(list.querySelectorAll('.ip')).filter((c) => !A.ptrCache[c.dataset.ip]);
      let k = 0; const worker = async () => { while (k < chips.length) { const c = chips[k++]; if (c.isConnected) await c._resolve(); } };
      await Promise.all([worker(), worker(), worker(), worker()]);
    };
    auto.addEventListener('change', () => { clearInterval(timer); if (auto.checked) timer = setInterval(() => { if (!s.isConnected) { clearInterval(timer); return; } load(); }, 5000); });
    s.append(h('div.row', h('button.key.key--snow', { type: 'button', onclick: () => load() }, 'Обновить'), h('button.key', { type: 'button', onclick: resolveAll }, 'Узнать имена всех серверов'),
      h('label.switch', auto, h('i'), h('span', 'обновлять каждые 5 секунд'))), stats, list);
    async function load() {
      const r = await K.radar();
      if (!s.isConnected) return;
      if (!r || !r.ok) { fail(list, 'Не получилось прочитать соединения: ' + ((r && r.err) || 'неизвестная ошибка')); return; }
      A.radarTotal = r.total;
      const ips = new Set(), plain = new Set();
      r.groups.forEach((g) => g.conns.forEach((c) => { ips.add(c.ip); if (c.port === 80) plain.add(g.name); }));
      stats.textContent = '';
      stats.append(stat(r.total, 'соединений сейчас'), stat(r.groups.length, 'программ в сети'),
        plain.size ? stat(plain.size, 'программ без шифрования', 'var(--t-trace)') : stat(ips.size, 'разных адресов'));
      const max = Math.max(1, ...r.groups.map((g) => g.conns.length));
      list.textContent = '';
      if (!r.groups.length) list.append(h('p.plate.muted', 'Сейчас нет внешних соединений.'));
      r.groups.forEach((g) => {
        const k = kindOf(g.name);
        list.append(h('article.plate.proc',
          h('div.proc__head', h('span.proc__name', g.name), k ? h('span.pill', k) : null, h('span.proc__bar', h('i', { style: { width: (g.conns.length / max * 100).toFixed(1) + '%' } })), h('span.k', g.conns.length + ' · pid ' + g.pid)),
          h('div.ips', g.conns.map(ipChip))));
      });
    }
    load();
    return s;
  }

  /* ---------- кто подглядывал ---------- */
  const CAP = { webcam: 'Камера', microphone: 'Микрофон', location: 'Геопозиция' };
  const dur = (e) => {
    if (e.live) return 'идёт сейчас';
    if (!e.start || !e.stop) return '—';
    const s = (new Date(e.stop) - new Date(e.start)) / 1000;
    return s < 0 ? '—' : s < 60 ? Math.max(1, Math.round(s)) + ' с' : s < 3600 ? Math.round(s / 60) + ' мин' : (s / 3600).toFixed(1) + ' ч';
  };
  const shortPath = (key) => { const p = key.replace(/#/g, '\\'); return p.length > 58 ? '…' + p.slice(-56) : p; };

  function spy() {
    const s = h('section.screen', head(['Кто подглядывал', 'журнал доступа Windows'], 'Камера, микрофон', 'и место',
      'Windows помнит, какая программа и когда включала камеру, микрофон и геопозицию. Здесь эта память видна целиком: доступ можно запретить любому приложению из Магазина или сразу всем обычным программам.'));
    const body = stack();
    s.append(h('div.row', h('button.key.key--snow', { type: 'button', onclick: () => load() }, 'Обновить'), h('span.muted', 'приложение следит за этим и в фоне: если что-то включит камеру или микрофон, придёт уведомление')), body);
    async function load() {
      const r = await K.spy();
      if (!s.isConnected) return;
      if (!r || !r.ok) { fail(body, 'Не удалось прочитать журнал доступа: ' + ((r && r.err) || '')); return; }
      A.spy = r.list; A.updateNav();
      body.textContent = '';
      const live = r.list.filter((e) => e.live);
      if (live.length) body.append(h('div.plate.alert', h('b', 'Прямо сейчас'), live.map((e) => h('p', e.name + ' использует ' + capName(e.cap)))));
      Object.keys(CAP).forEach((cap) => body.append(capBlock(cap, r.list.filter((e) => e.cap === cap), (r.desk || {})[cap])));
    }
    async function setDesk(cap, sw) {
      const want = sw.checked ? 'Allow' : 'Deny', verb = want === 'Deny' ? 'Запретить' : 'Разрешить';
      const ok = await confirmBox({ title: verb + ' обычным программам: ' + CAP[cap].toLowerCase(), ok: verb, body: [
        h('p', want === 'Deny' ? 'Программы не из Магазина (браузеры, мессенджеры, Zoom, Discord) перестанут получать доступ. Включить обратно можно этим же переключателем.' : 'Обычные программы снова смогут запрашивать доступ.'),
        h('ul', h('li', h('code', 'HKCU\\…\\ConsentStore\\' + cap + '\\NonPackaged → Value = ' + want)))] });
      if (!ok) { sw.checked = !sw.checked; return; }
      const r = await K.spySet(cap, 'NonPackaged', want);
      if (!r.ok) { toast(r.err || 'Не получилось', 'bad'); sw.checked = !sw.checked; return; }
      A.undo.add('spy:' + cap + ':NonPackaged'); toast(want === 'Deny' ? 'Доступ для обычных программ закрыт' : 'Доступ для обычных программ открыт', want === 'Deny' ? 'ok' : 'warn');
      if (want === 'Deny') A.pulse(); A.refreshStatus();
    }
    async function toggle(e, value) {
      const verb = value === 'Deny' ? 'Запретить' : 'Разрешить';
      const ok = await confirmBox({ title: verb + ' ' + e.name + ' ' + capName(e.cap), ok: verb, body: [
        h('ul', h('li', h('code', 'HKCU\\…\\ConsentStore\\' + e.cap + '\\' + e.key + ' → Value = ' + value))), h('p.muted', 'Прежнее значение сохранится — вернуть можно одной кнопкой.')] });
      if (!ok) return;
      const r = await K.spySet(e.cap, e.key, value);
      if (!r.ok) { toast(r.err || 'Не получилось', 'bad'); return; }
      A.undo.add('spy:' + e.cap + ':' + e.key); toast(value === 'Deny' ? 'Доступ запрещён: ' + e.name : 'Доступ разрешён: ' + e.name, value === 'Deny' ? 'ok' : 'warn');
      if (value === 'Deny') A.pulse(); A.refreshStatus(); load();
    }
    async function undo(e) {
      const r = await K.spyUndo(e.cap, e.key);
      if (!r.ok) { toast(r.err || 'Не получилось', 'bad'); return; }
      A.undo.delete('spy:' + e.cap + ':' + e.key); toast('Возвращено как было: ' + e.name, 'warn'); A.refreshStatus(); load();
    }
    function capBlock(cap, rows, deskValue) {
      const sw = h('input', { type: 'checkbox' }); sw.checked = deskValue !== 'Deny';
      sw.addEventListener('change', () => setDesk(cap, sw));
      const p = h('article.plate.tool',
        h('div.tool__head', h('b', CAP[cap]), h('span', rows.length ? rows.length + ' прилож. в журнале' : 'никто не обращался')),
        h('label.switch', sw, h('i'), h('span', 'Обычным программам (не из Магазина) можно включать: ' + CAP[cap].toLowerCase())));
      if (rows.length) {
        p.append(h('div.scroll-x', h('table.tbl',
          h('thead', h('tr', h('th', 'Приложение'), h('th', 'Последний раз'), h('th', 'Длилось'), h('th', 'Доступ'), h('th', ''))),
          h('tbody', rows.map((e) => {
            const id = 'spy:' + e.cap + ':' + e.key;
            const badge = e.live ? h('span.badge.live', 'сейчас') : e.desktop ? h('span.badge', 'программа') : e.value === 'Deny' ? h('span.badge.deny', 'запрещён') : h('span.badge.allow', 'разрешён');
            const act = h('td.tbl__act');
            if (e.desktop) act.append(h('span.chk__note', 'переключатель выше'));
            else {
              act.append(h('button.key.key--sm', { type: 'button', onclick: () => toggle(e, e.value === 'Deny' ? 'Allow' : 'Deny') }, e.value === 'Deny' ? 'Разрешить' : 'Запретить'));
              if (A.undo.has(id)) act.append(h('button.key.key--sm', { type: 'button', onclick: () => undo(e) }, 'Вернуть'));
            }
            return h('tr' + (e.live ? '.is-live' : ''),
              h('td', h('b', e.name), e.desktop ? h('small.muted.mono.block', shortPath(e.key)) : null),
              h('td', e.start ? ago(e.start) : '—', e.start ? h('small.muted.block', fmtDate(e.start)) : null),
              h('td', dur(e)), h('td', badge), act);
          })))));
      }
      return p;
    }
    load();
    return s;
  }

  /* ---------- метаданные файлов ---------- */
  const HOT = /GPS|Серийн|Автор|редактор|Организация|Руководитель|Модель|Производитель|Снято|Владелец|Миниатюра|XMP|IPTC|Комментарий|Дата съёмки|Своё поле|Место|Программа записи|ID снимка|Служебные данные камеры|Название/i;
  const baseName = (p) => String(p).split(/[\\/]/).pop();
  // Правка самого файла необратима, поэтому один раз за сеанс спрашиваем разрешение
  async function allowInPlace() {
    if (A.metaInPlaceOk) return true;
    const ok = await confirmBox({ kicker: 'Правка самого файла', title: 'Удалять метаданные прямо из файлов?', ok: 'Да, удалять', body: [
      h('p', 'Данные стираются из самого файла, без копии. Изображение, звук, видео и текст не меняются, дата файла сохраняется, поворот фото тоже.'),
      h('p.muted', 'В этом сеансе больше спрашивать не буду. Если оригинал нужно сохранить — используй «Чистая копия».')] });
    if (ok) A.metaInPlaceOk = true;
    return ok;
  }
  function meta(opts) {
    const s = h('section.screen', head(['Метаданные', 'EXIF · GPS · автор · видео · аудио'], 'Данные', 'о данных',
      'Перетащи сюда фото, видео, аудио или документы. Приложение покажет, что спрятано внутри — место съёмки, модель телефона, автора, организацию, программу записи, — и сотрёт это: из самого файла целиком, по одному полю или в чистую копию рядом.'));
    const panel = metaPanel({ hint: 'JPEG, PNG, HEIC, WebP, AVIF, PDF, DOCX, XLSX, PPTX, MP4, MOV, MP3, M4A, FLAC' });
    s.append(panel);
    // переход из атласа сразу открывает выбор файлов
    if (opts && opts.pick) setTimeout(() => { if (s.isConnected) panel.pick(); }, 350);
    return s;
  }
  // панель «перетащи — посмотри — сотри»: и раздел «Метаданные», и утилиты №19–№20 (what: 'photo' | 'audio' — какие файлы предлагать в окне выбора)
  function metaPanel(cfg) {
    const box = h('div.stack');
    const out = stack(); let shown = [];
    const pick = async () => { const p = await K.pick(cfg.what); if (p && p.length) inspect(p); };
    const drop = h('div.plate.drop', h('b', 'Перетащи файлы сюда'), h('span.muted', cfg.hint + ' · до 50 файлов за раз'), h('button.key.key--snow', { type: 'button', onclick: pick }, 'Выбрать файлы'));
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('is-over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
    drop.addEventListener('drop', (e) => {
      e.preventDefault(); drop.classList.remove('is-over');
      const paths = Array.from(e.dataTransfer.files).map((f) => { try { return K.pathOf(f); } catch (err) { return ''; } }).filter(Boolean);
      if (paths.length) inspect(paths);
    });
    box.append(drop, out);
    box.pick = pick;

    const dirtyOf = () => shown.filter((x) => !x.error && Object.keys(x.found || {}).length);
    async function inspect(paths) {
      out.textContent = ''; out.append(h('p.muted', 'Читаю ' + paths.length + ' ' + plural(paths.length, 'файл', 'файла', 'файлов') + '…'));
      shown = await K.metaInspect(paths);
      render();
    }
    async function reinspect(files) {
      const fresh = await K.metaInspect(files);
      shown = shown.map((x) => fresh.find((y) => y.file === x.file) || x);
      render();
    }
    function render() {
      out.textContent = '';
      const dirty = dirtyOf(), gps = shown.filter((x) => x.found && x.found.GPS);
      out.append(h('div.grid3', stat(shown.length, plural(shown.length, 'файл', 'файла', 'файлов')), stat(dirty.length, 'с метаданными', dirty.length ? 'var(--t-trace)' : 'var(--t-net)'), stat(gps.length, 'с местом съёмки', gps.length ? 'var(--t-trace)' : 'var(--t-net)')));
      if (dirty.length) out.append(h('div.row',
        h('button.key.key--accent', { type: 'button', onclick: () => stripMany(dirty) }, 'Удалить метаданные у всех · ' + dirty.length),
        h('button.key', { type: 'button', onclick: () => cleanCopies(dirty) }, 'Сделать чистые копии')));
      shown.forEach((x) => out.append(fileCard(x)));
    }
    function fileCard(x) {
      const f = x.found || {}, keys = Object.keys(f), can = new Set(x.removable || []);
      const tools = h('div.row.file__keys');
      if (!x.error && keys.length) tools.append(
        h('button.key.key--sm.key--accent', { type: 'button', onclick: () => stripMany([x], true) }, 'Удалить метаданные'),
        h('button.key.key--sm', { type: 'button', onclick: () => cleanCopies([x]) }, 'Чистая копия'));
      tools.append(h('button.key.key--sm', { type: 'button', title: 'Перезаписать и удалить сам файл', onclick: () => shredFile(x) }, 'Стереть файл'));
      const card = h('article.plate.file', h('div.tool__head', h('b', x.name), h('span', x.error ? 'не прочитан' : (keys.length ? keys.length + ' ' + plural(keys.length, 'поле', 'поля', 'полей') : 'чисто') + ' · ' + fmtBytes(x.size || 0))));
      if (x.error) card.append(h('p.muted', x.error));
      else if (!keys.length) card.append(h('p.ok-line', 'Метаданных не найдено — файл можно отправлять.'));
      else card.append(h('div.kv.kv--x', keys.map((k) => [
        h('span.kv__k', k), h('span.kv__v' + (HOT.test(k) ? '' : '.cool'), String(f[k])),
        can.has(k) ? h('button.kv__x', { type: 'button', title: 'Удалить это поле из файла', onclick: (e) => removeOne(x, k, e.currentTarget) }, 'удалить') : h('span'),
      ])));
      if (f.GPS) card.append(h('p.warn', 'В файле записано место съёмки. Любой, кто получит этот файл, увидит его на карте.'));
      if (x.note) card.append(h('p.muted', x.note));
      card.append(tools);
      return card;
    }
    async function removeOne(x, key, btn) {
      if (!(await allowInPlace())) return;
      btn.disabled = true; btn.textContent = '…';
      const r = await K.metaField(x.file, key);
      if (!r.ok) { toast(r.err || 'Не получилось', 'bad'); btn.disabled = false; btn.textContent = 'удалить'; return; }
      shown = shown.map((y) => (y.file === x.file ? r : y));
      toast('Удалено из файла: ' + key); A.pulse(); A.refreshStatus(); render();
    }
    async function stripMany(list, single) {
      const n = list.length;
      const asked = single ? await allowInPlace() : await confirmBox({ kicker: 'Правка самих файлов', title: 'Удалить метаданные у ' + n + ' ' + plural(n, 'файла', 'файлов', 'файлов') + '?', ok: 'Удалить', danger: true, body: [
        h('ul', list.slice(0, 8).map((x) => { const c = Object.keys(x.found).length; return h('li', x.name + ' — ' + c + ' ' + plural(c, 'поле', 'поля', 'полей')); }), n > 8 ? h('li', '…и ещё ' + (n - 8)) : null),
        h('p', 'Стирается всё найденное: место съёмки, камера, автор, организация, даты, история правок, теги записи. Картинка, звук, видео и текст не меняются, поворот фото сохраняется.'),
        h('p.muted', 'Копий не останется. Если оригиналы нужны — нажми «Сделать чистые копии».')] });
      if (!asked) return;
      if (!single) A.metaInPlaceOk = true;
      const r = await K.metaStrip(list.map((x) => x.file));
      const good = r.filter((x) => !x.error), bad = r.filter((x) => x.error);
      toast('Метаданные удалены: ' + good.length + ' ' + plural(good.length, 'файл', 'файла', 'файлов') + (bad.length ? ', ошибок ' + bad.length : ''), bad.length ? 'warn' : 'ok');
      bad.forEach((x) => toast(baseName(x.file) + ': ' + x.error, 'bad'));
      if (good.length) { A.pulse(); A.refreshStatus(); }
      await reinspect(list.map((x) => x.file));
    }
    async function cleanCopies(list) {
      const ok = await confirmBox({ title: 'Сделать чистые копии', ok: 'Сделать копии', body: [
        h('p', 'Рядом с каждым файлом появится копия с пометкой «-чистый» — без места съёмки, камеры, автора и свойств документа. Оригиналы остаются как были.'),
        h('ul', list.slice(0, 8).map((x) => h('li', x.name)), list.length > 8 ? h('li', '…и ещё ' + (list.length - 8)) : null)] });
      if (!ok) return;
      const r = await K.metaClean(list.map((x) => x.file));
      const good = r.filter((x) => !x.error);
      toast('Готово: чистых копий ' + good.length + (r.length - good.length ? ', ошибок ' + (r.length - good.length) : ''), good.length ? 'ok' : 'bad');
      if (good.length) { A.pulse(); A.refreshStatus(); }
      out.prepend(h('div.plate', h('p.plate__title', 'Чистые копии'), h('div.scroll-x', h('table.tbl', h('tbody', r.map((x) => h('tr',
        h('td', x.error ? '✕' : '✓'), h('td.mono.selectable', x.error ? x.file : x.target), h('td', x.error ? x.error : fmtBytes(x.before) + ' → ' + fmtBytes(x.after)))))))));
    }
    async function shredFile(x) {
      const ok = await confirmBox({ kicker: 'Без возможности восстановления', title: 'Стереть файл «' + x.name + '»?', ok: 'Стереть насовсем', danger: true, check: 'Понимаю: файл нельзя будет восстановить',
        body: [h('p', 'Файл будет перезаписан случайными байтами, переименован и удалён — программы восстановления его не найдут.'), h('ul', h('li', h('code', x.file)))] });
      if (!ok) return;
      const r = await K.shredRun([x.file]);
      const why = (r.failed && r.failed[0] && r.failed[0].err) || (r.skipped && r.skipped[0] && r.skipped[0].why) || r.err;
      if (!r.ok || !r.done) { toast(why || 'Не получилось', 'bad'); return; }
      shown = shown.filter((y) => y.file !== x.file);
      toast('Файл стёрт без восстановления: ' + x.name); A.pulse(true); A.refreshStatus(); render();
    }
    return box;
  }

  /* ---------- утечки паролей и мастер смены ---------- */
  function strength(pw) {
    let pool = 0;
    if (/[a-z]/.test(pw)) pool += 26; if (/[A-Z]/.test(pw)) pool += 26; if (/[0-9]/.test(pw)) pool += 10;
    if (/[а-яё]/i.test(pw)) pool += 66; if (/[^a-zA-Zа-яёА-ЯЁ0-9]/.test(pw)) pool += 33;
    let bits = pw.length * Math.log2(Math.max(pool, 2));
    if (/^(.)\1+$/.test(pw) || /^(123|qwe|йцу|pass|пароль|admin|1q2w)/i.test(pw)) bits = Math.min(bits, 12);
    return Math.round(bits);
  }
  function pwBlock() {
    const inp = h('input.field.grow', { type: 'password', placeholder: 'пароль для проверки', autocomplete: 'off', spellcheck: 'false' });
    const eye = h('button.key.key--sm', { type: 'button' }, 'Показать');
    eye.addEventListener('click', () => { inp.type = inp.type === 'password' ? 'text' : 'password'; eye.textContent = inp.type === 'password' ? 'Показать' : 'Скрыть'; });
    const bar = h('i'), gauge = h('div.gauge', bar), bits = h('span.k', 'надёжность —'), res = h('div.stack');
    inp.addEventListener('input', () => {
      const b = strength(inp.value);
      bar.style.width = Math.min(100, b / 90 * 100) + '%'; bar.style.background = b < 40 ? 'var(--t-trace)' : b < 65 ? 'var(--t-device)' : 'var(--t-net)';
      bits.textContent = inp.value ? 'надёжность ≈ ' + b + ' бит · ' + (b < 40 ? 'слабый' : b < 65 ? 'средний' : 'сильный') : 'надёжность —';
    });
    const btn = h('button.key.key--snow', { type: 'button' }, 'Проверить');
    const go = async () => {
      if (!inp.value) return;
      const pw = inp.value; btn.disabled = true; res.textContent = ''; res.append(h('p.muted', 'Проверяю…'));
      const r = await K.leakPassword(pw);
      btn.disabled = false; inp.value = ''; inp.dispatchEvent(new Event('input'));
      res.textContent = '';
      if (!r.ok) { res.append(h('p.warn', r.err || 'Не получилось')); return; }
      res.append(r.count ? h('p.alert-line', h('b', 'Найден в утечках ' + r.count.toLocaleString('ru-RU') + ' раз.'), ' Он есть в словарях для подбора — смени его везде, где он используется.')
        : h('p.ok-line', h('b', 'В известных утечках не найден.'), ' Это ещё не значит, что он надёжный, но в словарях взломщиков его нет.'),
      h('p.muted.mono', 'В сеть ушли только первые 5 символов хэша SHA-1: ' + r.prefix + '. Сервис вернул сотни похожих хэшей, совпадение искалось на этом компьютере. Поле очищено.'));
    };
    btn.addEventListener('click', go);
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    return h('article.plate.tool', h('div.tool__head', h('b', 'Пароль в слитых базах?'), h('span', 'Pwned Passwords · k-анонимность')),
      h('div.row', inp, eye, btn), gauge, bits, res);
  }
  const MAILS = 'kx.mails';
  function mailBlock() {
    let remember = false, mails = A.mails || [];
    try { const saved = localStorage.getItem(MAILS); if (saved !== null) { remember = true; mails = JSON.parse(saved) || []; } } catch (e) { /* без памяти */ }
    const save = () => { A.mails = mails; try { if (remember) localStorage.setItem(MAILS, JSON.stringify(mails)); else localStorage.removeItem(MAILS); } catch (e) { /* без памяти */ } };
    const inp = h('input.field.grow', { type: 'email', placeholder: 'почта, например name@gmail.com', autocomplete: 'off', spellcheck: 'false' });
    const keyInp = h('input.field.grow', { type: 'password', placeholder: 'ключ API Have I Been Pwned (необязательно)', autocomplete: 'off' });
    const list = stack();
    const add = () => {
      const v = inp.value.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) { toast('Это не похоже на адрес почты', 'warn'); return; }
      if (!mails.find((m) => m.addr === v)) mails.push({ addr: v, changed: null, breaches: null });
      inp.value = ''; save(); draw();
    };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
    const rem = h('input', { type: 'checkbox' }); rem.checked = remember;
    rem.addEventListener('change', () => { remember = rem.checked; save(); toast(remember ? 'Список почт сохранён на этом компьютере — без паролей' : 'Список почт больше не хранится', 'warn'); });
    async function gen(m, note) {
      const pw = strong(20);
      await K.copySecret(pw);
      toast('Новый пароль для ' + m.addr + ' в буфере обмена. Вставь его на странице сервиса и сохрани в менеджер паролей.');
      let left = 30; clearInterval(note._t); note.hidden = false;
      const paint = () => { note.textContent = '•'.repeat(20) + ' · в буфере ещё ' + left + ' с'; };
      paint();
      note._t = setInterval(() => { left--; if (left <= 0 || !note.isConnected) { clearInterval(note._t); note.hidden = true; note.textContent = ''; return; } paint(); }, 1000);
    }
    function row(m) {
      const prov = C.providers.find((p) => p.re.test(m.addr));
      const note = h('code.secret', { hidden: true });
      const info = [h('b', m.addr), h('span.muted', prov ? prov.name : 'сервис не распознан — смени пароль в его настройках')];
      if (m.breaches) info.push(h('span', { class: m.breaches.length ? 'bad-text' : 'ok-text' }, m.breaches.length ? 'в утечках: ' + m.breaches.map((b) => b.name + ' (' + String(b.date || '').slice(0, 4) + ')').join(', ') : 'в известных утечках не найдена'));
      if (m.changed) info.push(h('span.ok-text', 'пароль сменён ' + fmtDate(m.changed)));
      return h('div.mail-row' + (m.changed ? '.is-done' : ''), h('div.mail-row__info', info, note),
        h('div.row',
          h('button.key.key--sm', { type: 'button', onclick: () => gen(m, note) }, '1 · Новый пароль'),
          h('button.key.key--sm', { type: 'button', disabled: prov ? null : true, onclick: () => prov && K.link(prov.url) }, '2 · Страница смены ↗'),
          h('button.key.key--sm' + (m.changed ? '' : '.key--snow'), { type: 'button', onclick: () => { m.changed = m.changed ? null : new Date().toISOString(); save(); draw(); if (m.changed) A.pulse(); } }, m.changed ? 'Снять отметку' : '3 · Готово'),
          h('button.key.key--sm', { type: 'button', title: 'Убрать из списка', 'aria-label': 'Убрать ' + m.addr, onclick: () => { mails = mails.filter((x) => x !== m); save(); draw(); } }, '✕')));
    }
    function draw() {
      list.textContent = '';
      if (!mails.length) list.append(h('p.muted', 'Добавь почты, которыми пользуешься. Пароли сюда вводить не нужно.'));
      else { const done = mails.filter((m) => m.changed).length; list.append(h('div.gauge', h('i', { style: { width: (done / mails.length * 100) + '%', background: 'var(--t-net)' } })), h('span.k', 'сменено ' + done + ' из ' + mails.length)); }
      mails.forEach((m) => list.append(row(m)));
    }
    let busy = false;
    async function checkAll() {
      const key = keyInp.value.trim();
      if (!mails.length) { toast('Сначала добавь почты', 'warn'); return; }
      if (!key) { toast('Без ключа проверка идёт на сайте HIBP — открываю его в браузере', 'warn'); K.link('https://haveibeenpwned.com/'); return; }
      if (busy) return; busy = true;
      for (let i = 0; i < mails.length; i++) {
        const r = await K.leakEmail(mails[i].addr, key);
        if (!r.ok) { toast(mails[i].addr + ': ' + r.err, 'bad'); if (/Ключ/.test(r.err)) break; } else mails[i].breaches = r.breaches;
        draw();
        if (i < mails.length - 1) await new Promise((res) => setTimeout(res, 6500)); // бесплатный лимит HIBP — 10 запросов в минуту
      }
      busy = false; save();
    }
    draw();
    return h('article.plate.tool', h('div.tool__head', h('b', 'Мастер смены паролей почт'), h('span', 'пароли не хранятся')),
      h('p.muted', 'Сменить пароль одной кнопкой за тебя не даст ни один почтовый сервис: это делает только владелец, на странице сервиса, с подтверждением. Поэтому мастер готовит всё остальное — надёжный пароль в буфере обмена на 30 секунд, нужную страницу сервиса и отметку о смене.'),
      h('div.row', inp, h('button.key.key--snow', { type: 'button', onclick: add }, 'Добавить')), list,
      h('div.row', keyInp, h('button.key', { type: 'button', onclick: checkAll }, 'Проверить почты в утечках'), h('button.key', { type: 'button', onclick: () => K.link('https://haveibeenpwned.com/API/Key') }, 'Где взять ключ ↗')),
      h('label.switch', rem, h('i'), h('span', 'Помнить список почт на этом компьютере')),
      h('div.tips', [['Ключ доступа', 'Passkey вместо пароля: его нельзя украсть с сервера и ввести на поддельном сайте.'], ['Второй фактор', 'Приложение-аутентификатор или аппаратный ключ. SMS — худший вариант.'], ['Менеджер паролей', 'Сохрани новый пароль в Bitwarden или KeePassXC сразу после смены: буфер очистится через 30 секунд.']]
        .map(([t, p]) => h('div.tip', h('h3', t), h('p', p)))));
  }
  function leaks() {
    return h('section.screen', head(['Утечки', 'пароль не покидает компьютер'], 'Пароли', 'в утечках',
      'Проверь, не засветился ли пароль в слитых базах, и пройди мастер смены паролей для своих почт. Почта — ключ ко всем остальным аккаунтам, поэтому начинать стоит с неё.'), pwBlock(), mailBlock());
  }

  /* ---------- браузеры ---------- */
  function browserCard(b, reload, preset) {
    const cache = h('input', { type: 'checkbox' }), cookies = h('input', { type: 'checkbox' }), history = h('input', { type: 'checkbox' }), forms = h('input', { type: 'checkbox' });
    if (preset) { cache.checked = !!preset.cache; cookies.checked = !!preset.cookies; history.checked = !!preset.history; forms.checked = !!preset.forms; } else cache.checked = true;
    async function go() {
      const what = { cache: cache.checked, cookies: cookies.checked, history: history.checked, forms: forms.checked };
      if (!what.cache && !what.cookies && !what.history && !what.forms) { toast('Отметь, что удалить', 'warn'); return; }
      const lines = [];
      if (what.cache) lines.push('кэш — ' + fmtBytes(b.cache));
      if (what.cookies) lines.push('cookies и данные сайтов, включая суперкуки и метки HSTS, — придётся заново войти на все сайты');
      if (what.history) lines.push(b.firefox ? 'вкладки прошлых сеансов и значки сайтов' : 'история посещений, вкладки прошлых сеансов, значки сайтов и подсказки адресной строки');
      if (what.forms) lines.push(b.firefox ? 'история форм' : 'автозаполнение: адреса, телефоны, сохранённые карты (сбросятся и свои поисковые системы)');
      const ok = await confirmBox({ kicker: 'Удаление без корзины', title: 'Очистить ' + b.name + '?', ok: 'Удалить насовсем', danger: true, body: [
        h('ul', lines.map((l) => h('li', l))), h('p.warn', 'Файлы удаляются насовсем, вернуть их нельзя. Пароли, закладки и расширения не трогаются.')] });
      if (!ok) return;
      const r = await K.browsersClean(b.id, what);
      if (!r.ok) { toast(r.err || 'Не получилось', 'bad'); return; }
      toast(b.name + ': освобождено ' + fmtBytes(r.freed || 0)); A.pulse(); A.refreshStatus(); reload();
    }
    return h('article.plate.tool',
      h('div.tool__head', h('b', b.name), h('span', b.running ? h('b.bad-text', 'открыт — закрой его перед очисткой') : 'закрыт · можно чистить')),
      h('div.row.gap-lg',
        h('label.switch', cache, h('i'), h('span', 'Кэш · ' + fmtBytes(b.cache))),
        h('label.switch', cookies, h('i'), h('span', 'Cookies и данные сайтов')),
        h('label.switch', history, h('i'), h('span', b.firefox ? 'Вкладки и значки' : 'История и вкладки')),
        h('label.switch', forms, h('i'), h('span', 'Автозаполнение'))),
      b.firefox ? h('p.muted', 'Историю посещений Firefox хранит в одном файле с закладками, поэтому её надёжнее стереть в самом Firefox: Ctrl+Shift+Del.') : null,
      h('div.row', h('button.key' + (b.running ? '' : '.key--accent'), { type: 'button', disabled: b.running ? true : null, onclick: go }, 'Очистить выбранное')));
  }
  function browsers(opts) {
    const s = h('section.screen', head(['Браузеры', 'кэш · cookies · история'], 'Стереть', 'следы',
      'Кэш хранит копии посещённых страниц, cookies держат входы и метки трекеров, история помнит каждый адрес. Выбери, что удалить. Браузер должен быть закрыт: пока он открыт, файлы заняты.'));
    const body = stack();
    s.append(h('div.row', h('button.key.key--snow', { type: 'button', onclick: () => load() }, 'Обновить')), body);
    async function load() {
      body.textContent = ''; body.append(h('p.muted', 'Считаю размеры…'));
      const r = await K.browsers();
      if (!s.isConnected) return;
      body.textContent = '';
      if (!r || !r.ok) { fail(body, (r && r.err) || 'Не получилось'); return; }
      if (!r.list.length) { body.append(h('p.plate.muted', 'Не нашёл профилей Chrome, Edge, Яндекс Браузера, Brave или Firefox.')); return; }
      r.list.forEach((b) => body.append(browserCard(b, load, opts && opts.what)));
    }
    load();
    return s;
  }

  /* ---------- эфир Wi‑Fi ---------- */
  function air() {
    const au = A.audit || {}, none = au.wifi == null;
    let nets = Array.isArray(au.wifi) ? au.wifi.slice() : au.wifi ? [au.wifi] : [];
    const s = h('section.screen', head(['Эфир Wi‑Fi', 'probe requests · MAC'], 'Что компьютер', 'кричит в эфир',
      'Пока Wi‑Fi включён, устройство ищет знакомые сети и выкрикивает их имена. По списку сохранённых сетей можно восстановить, где ты бываешь. Забудь лишние сети и включи случайный MAC-адрес.'));
    const card = h('article.plate.tool', h('div.tool__head', h('b', 'Сохранённые сети'), h('span', none ? 'Wi‑Fi адаптер не найден' : nets.length + ' сет.')));
    async function forget(n, rowEl) {
      const ok = await confirmBox({ title: 'Забыть сеть «' + n + '»?', ok: 'Забыть сеть', body: [
        h('ul', h('li', h('code', 'netsh wlan delete profile name="' + n + '"'))),
        h('p.warn', 'Нужны права администратора — Windows спросит подтверждение. При следующем подключении к этой сети пароль придётся ввести заново.')] });
      if (!ok) return;
      const r = await K.wifiForget(n);
      if (!r.ok) { toast(r.err || 'Не получилось', 'bad'); return; }
      nets = nets.filter((x) => x !== n); if (A.audit) A.audit.wifi = nets;
      rowEl.remove(); toast('Сеть забыта: ' + n); A.pulse(); A.refreshStatus();
    }
    if (none) card.append(h('p.muted', 'На этом компьютере нет Wi‑Fi адаптера или служба беспроводной сети выключена — в эфир он ничего не кричит.'));
    else if (!nets.length) card.append(h('p.ok-line', 'Сохранённых сетей нет.'));
    else card.append(h('div.stack.tight', nets.map((n) => { const r = h('div.net-row', h('span.mono', n)); r.append(h('button.key.key--sm', { type: 'button', onclick: () => forget(n, r) }, 'Забыть')); return r; })));
    s.append(card, h('article.plate.tool', h('div.tool__head', h('b', 'Случайный MAC-адрес'), h('span', 'Параметры → Сеть → Wi‑Fi')),
      h('p.muted', 'С ним в каждой сети компьютер выглядит новым устройством, и датчики в торговых центрах и на вокзалах не склеивают твои визиты.'),
      h('div.row', h('button.key.key--snow', { type: 'button', onclick: () => K.link('ms-settings:network-wifi') }, 'Открыть настройки Wi‑Fi ↗'))));
    return s;
  }

  /* ---------- тревожная кнопка ---------- */
  async function panic() {
    const st = await K.settings();
    const sw = h('input', { type: 'checkbox' }); sw.checked = !!(st && st.hotkey);
    const wipe = h('input', { type: 'checkbox' }); wipe.checked = !!(st && st.panicWipe);
    wipe.addEventListener('change', async () => { const r = await K.panicWipe(wipe.checked); toast(r.on ? 'При тревоге будут стираться журнал Win+V, недавние файлы и история «Выполнить»' : 'Стирание при тревоге выключено', r.on ? 'ok' : 'warn'); A.refreshStatus(); });
    sw.addEventListener('change', async () => { const r = await K.panicHotkey(sw.checked); toast(r.on ? 'Ctrl+Alt+Shift+K работает, даже когда окно свёрнуто' : 'Горячая клавиша выключена', r.on ? 'ok' : 'warn'); A.refreshStatus(); });
    return h('section.screen', head(['Тревожная кнопка', 'одно нажатие'], 'Если кто-то', 'подошёл',
      'Одно нажатие очищает буфер обмена, сворачивает приложение и блокирует экран — как Win+L, только без скопированного пароля в буфере.'),
      h('div.plate.panic',
        h('button.big-red', { type: 'button', onclick: () => K.panic() }, 'ТРЕВОГА', h('small', 'буфер · свернуть · замок')),
        h('label.switch', sw, h('i'), h('span', 'Горячая клавиша ', h('kbd', 'Ctrl+Alt+Shift+K'), ' в любой программе')),
        h('label.switch', wipe, h('i'), h('span', 'Заодно стирать журнал Win+V, недавние файлы, историю «Выполнить» и поиска'))),
      h('div.tips', [['1 · Буфер обмена', 'Скопированный пароль или адрес не достанется тому, кто сядет за компьютер.'], ['2 · Окно свёрнуто', 'Приложение не останется на экране после разблокировки.'], ['3 · Экран заблокирован', 'Вернуться можно только с твоим PIN-кодом или паролем Windows.']]
        .map(([t, p]) => h('article.plate.tip', h('h3', t), h('p', p)))));
  }

  window.TOOLS = { radar, spy, meta, leaks, browsers, air, panic };
  window.META_PANEL = metaPanel;   // для утилит №19–№20: та же панель, что в разделе «Метаданные»
})();
