// Двойник: что о тебе можно узнать по твоим же файлам и настройкам — только чтение, без взлома и без сети.
// Досье считается на этом компьютере и нигде не сохраняется; рядом с выводами — кнопки, которые убирают след.
const fs = require('fs');
const path = require('path');
const os = require('os');
const meta = require('./meta');
const sys = require('./system');
const vault = require('./vault');

const HOME = os.homedir();
const PHOTO = new Set(['.jpg', '.jpeg', '.jfif', '.heic', '.heif', '.avif']), VIDEO = new Set(['.mp4', '.mov', '.m4v', '.3gp']), DOC = new Set(['.docx', '.xlsx', '.pptx', '.pdf']);
const LIMIT = { photo: 4000, video: 200, doc: 600, files: 150000 };
const YEAR = 365 * 24 * 3600e3;
const tick = () => new Promise((r) => setImmediate(r));
let last = null;   // доказательства последнего досье: какие файлы можно почистить кнопками

function defaults() {
  const folders = ['Pictures', 'Desktop', 'Downloads', 'Documents', 'Videos', 'OneDrive\\Pictures', 'OneDrive\\Desktop', 'OneDrive\\Documents']
    .map((d) => path.join(HOME, d)).filter((d) => { try { return fs.statSync(d).isDirectory(); } catch (e) { return false; } });
  return { ok: true, folders, user: os.userInfo().username, host: os.hostname() };
}

// обход папок: собираем фото, видео и документы и время изменения файлов для распорядка дня
async function collect(folders, onProgress) {
  const found = { photo: [], video: [], doc: [] }, hours = new Array(24).fill(0); let n = 0;
  const seen = new Set();
  for (const root of folders) {
    const stack = [[root, 0]];
    while (stack.length && n < LIMIT.files) {
      const [d, depth] = stack.pop();
      let list; try { list = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { continue; }
      for (const e of list) {
        if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'AppData' || e.isSymbolicLink()) continue;
        const full = path.join(d, e.name);
        if (e.isDirectory()) { if (depth < 8) stack.push([full, depth + 1]); continue; }
        if (!e.isFile() || seen.has(full.toLowerCase())) continue;
        seen.add(full.toLowerCase());
        let st; try { st = fs.statSync(full); } catch (err) { continue; }
        if (Date.now() - st.mtimeMs < YEAR) hours[new Date(st.mtimeMs).getHours()]++;
        const ext = path.extname(e.name).toLowerCase(), item = { file: full, mtime: st.mtimeMs };
        if (PHOTO.has(ext)) found.photo.push(item); else if (VIDEO.has(ext)) found.video.push(item); else if (DOC.has(ext)) found.doc.push(item);
        if (++n % 2000 === 0) { onProgress({ phase: 'files', done: n }); await tick(); }
      }
    }
  }
  for (const k of Object.keys(found)) found[k] = found[k].sort((a, b) => b.mtime - a.mtime).slice(0, LIMIT[k]);
  return { found, hours, files: n };
}

const hourOf = (taken, mtime) => { const m = /T(\d{2}):/.exec(taken || ''); return m ? Number(m[1]) : new Date(mtime).getHours(); };
const dayOf = (taken, mtime) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(taken || ''); return (m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(mtime)).getDay(); };
const fmt = (n, one, few, many) => { const a = Math.abs(n) % 100, b = a % 10; return n + ' ' + (a > 10 && a < 20 ? many : b === 1 ? one : b > 1 && b < 5 ? few : many); };
const pos = (lat, lon) => lat.toFixed(3) + ', ' + lon.toFixed(3);
const hh = (h) => String((h + 24) % 24).padStart(2, '0') + ':00';

const APPS = [
  ['мессенджеры', /telegram|discord|whatsapp|viber|signal|skype|zoom|slack|element|threema|microsoft teams/i],
  ['игры', /steam|epic games|battle\.net|riot|roblox|minecraft|ubisoft|ea app|gog galaxy|faceit|wargaming/i],
  ['VPN и прокси', /vpn|wireguard|openvpn|outline|amnezia|v2ray|xray|hiddify|nekoray|clash|tor browser|psiphon|lantern/i],
  ['криптовалюта', /exodus|electrum|ledger|trezor|atomic wallet|metamask|wasabi|sparrow/i],
];

async function scan(folders, onProgress) {
  const roots = (Array.isArray(folders) ? folders : []).map(String).filter((d) => { try { return fs.statSync(d).isDirectory(); } catch (e) { return false; } }).slice(0, 20);
  const id = defaults();
  onProgress({ phase: 'files', done: 0 });
  const { found, hours, files } = await collect(roots, onProgress);

  // фото и видео: место, время, камера
  const points = [], devices = new Map(), serialFiles = [], gpsFiles = [], artists = new Map();
  const media = found.photo.concat(found.video);
  for (let i = 0; i < media.length; i++) {
    const it = media[i];
    if (i % 50 === 0) { onProgress({ phase: 'photo', done: i, total: media.length }); await tick(); }
    let p; try { p = await meta.peek(it.file); } catch (e) { p = null; }
    if (!p) continue;
    const h = hourOf(p.taken, it.mtime), dow = dayOf(p.taken, it.mtime);
    if (p.taken) hours[h]++;
    if (p.lat != null && p.lon != null && (p.lat || p.lon)) { points.push({ lat: p.lat, lon: p.lon, h, dow }); gpsFiles.push(it.file); }
    const cam = [p.make, p.model].filter(Boolean).join(' ').replace(/^(\S+) \1/i, '$1').trim();
    if (cam) { const d = devices.get(cam) || { name: cam, n: 0, serial: false }; d.n++; if (p.serial) d.serial = true; devices.set(cam, d); }
    if (p.serial || p.owner) serialFiles.push(it.file);
    for (const a of [p.artist, p.owner]) if (a) artists.set(a, (artists.get(a) || 0) + 1);
  }
  // документы: автор, редакторы, организация
  const authors = new Map(), orgs = new Map(), docFiles = [];
  for (let i = 0; i < found.doc.length; i++) {
    if (i % 20 === 0) { onProgress({ phase: 'doc', done: i, total: found.doc.length }); await tick(); }
    let p; try { p = await meta.peek(found.doc[i].file); } catch (e) { p = null; }
    if (!p) continue;
    const names = [p.author, p.editor].concat(p.people ? p.people.split(', ') : []).filter(Boolean);
    if (names.length || p.org) docFiles.push(found.doc[i].file);
    for (const nm of new Set(names)) authors.set(nm, (authors.get(nm) || 0) + 1);
    if (p.org) orgs.set(p.org, (orgs.get(p.org) || 0) + 1);
  }
  onProgress({ phase: 'system', done: 0 });
  const [audit, radar] = await Promise.all([sys.audit(), sys.radar()]);

  const out = [];
  // 1. дом и работа по координатам снимков
  const clusters = new Map();
  for (const p of points) {
    const k = p.lat.toFixed(2) + ',' + p.lon.toFixed(2), c = clusters.get(k) || { n: 0, lat: 0, lon: 0, night: 0, weekend: 0, work: 0 };
    c.n++; c.lat += p.lat; c.lon += p.lon; if (p.h >= 20 || p.h < 8) c.night++; if (p.dow === 0 || p.dow === 6) c.weekend++; if (p.dow > 0 && p.dow < 6 && p.h >= 9 && p.h < 18) c.work++;
    clusters.set(k, c);
  }
  const cl = [...clusters.values()].map((c) => ({ ...c, lat: c.lat / c.n, lon: c.lon / c.n }));
  const home = cl.slice().sort((a, b) => b.n * (0.4 + (b.night + b.weekend * 0.5) / b.n) - a.n * (0.4 + (a.night + a.weekend * 0.5) / a.n))[0];
  const work = cl.filter((c) => c !== home && c.work >= 3).sort((a, b) => b.work - a.work)[0];
  out.push({
    id: 'home', title: 'Где ты живёшь', weight: 25, found: !!home,
    level: !home ? 'none' : home.n >= 10 ? 'high' : home.n >= 3 ? 'medium' : 'low',
    text: home ? 'Скорее всего, рядом с ' + pos(home.lat, home.lon) + ': здесь снято ' + fmt(home.n, 'фото', 'фото', 'фото') + (home.night ? ', ' + Math.round(home.night / home.n * 100) + '% — вечером и ночью' : '') + '.' + (work ? ' По будням днём ты часто бываешь у ' + pos(work.lat, work.lon) + ' (' + fmt(work.work, 'снимок', 'снимка', 'снимков') + ') — похоже на работу или учёбу.' : '')
      : points.length ? 'Координаты есть, но слишком разрознены, чтобы назвать дом.' : 'В проверенных фото и видео нет координат — этот след чист.',
    details: cl.sort((a, b) => b.n - a.n).slice(0, 5).map((c) => pos(c.lat, c.lon) + ' — ' + fmt(c.n, 'снимок', 'снимка', 'снимков')),
    points: points.slice(0, 1500).map((p) => [p.lat, p.lon]), home: home ? [home.lat, home.lon] : null, work: work ? [work.lat, work.lon] : null,
    actions: gpsFiles.length ? [{ fix: 'gps', label: 'Стереть место съёмки из ' + fmt(gpsFiles.length, 'файла', 'файлов', 'файлов') }] : [],
  });
  // 2. камеры
  const devs = [...devices.values()].sort((a, b) => b.n - a.n);
  out.push({
    id: 'devices', title: 'Чем ты снимаешь', weight: 15, found: devs.length > 0, level: !devs.length ? 'none' : serialFiles.length ? 'high' : 'medium',
    text: devs.length ? 'Твои камеры: ' + devs.slice(0, 4).map((d) => d.name + ' — ' + fmt(d.n, 'снимок', 'снимка', 'снимков')).join(', ') + '.' + (serialFiles.length ? ' В ' + fmt(serialFiles.length, 'файле', 'файлах', 'файлах') + ' записан серийный номер камеры или имя владельца — по ним снимки связывают с покупателем.' : '') : 'Модель камеры в проверенных снимках не записана.',
    details: devs.slice(0, 6).map((d) => d.name + (d.serial ? ' · есть серийный номер' : '')),
    actions: serialFiles.length ? [{ fix: 'serial', label: 'Стереть серийные номера из ' + fmt(serialFiles.length, 'файла', 'файлов', 'файлов') }] : [],
  });
  // 3. имя
  const names = [...authors.entries(), ...artists.entries()].sort((a, b) => b[1] - a[1]), org = [...orgs.entries()].sort((a, b) => b[1] - a[1]);
  out.push({
    id: 'name', title: 'Как тебя зовут', weight: 15, found: names.length > 0 || org.length > 0, level: names.length ? 'high' : org.length ? 'medium' : 'low',
    text: (names.length ? 'В документах и снимках стоит имя «' + names[0][0] + '» (' + fmt(names[0][1], 'файл', 'файла', 'файлов') + ')' + (names.length > 1 ? ', ещё ' + names.slice(1, 4).map((x) => '«' + x[0] + '»').join(', ') : '') + '. ' : 'Имени в проверенных документах нет. ')
      + (org.length ? 'Организация: «' + org[0][0] + '». ' : '') + 'Имя пользователя Windows «' + id.user + '» и имя компьютера «' + id.host + '» попадают в пути файлов и видны в локальной сети.',
    details: names.slice(0, 6).map((x) => x[0] + ' — ' + fmt(x[1], 'файл', 'файла', 'файлов')).concat(org.slice(0, 3).map((x) => 'организация ' + x[0])),
    actions: (docFiles.length ? [{ fix: 'docs', label: 'Стереть авторов из ' + fmt(docFiles.length, 'документа', 'документов', 'документов') }] : []).concat([{ link: 'ms-settings:about', label: 'Переименовать компьютер ↗' }]),
  });
  // 4. распорядок дня
  const total = hours.reduce((a, b) => a + b, 0);
  let sleep = 0, best = Infinity;
  for (let s = 0; s < 24; s++) { let v = 0; for (let k = 0; k < 6; k++) v += hours[(s + k) % 24]; if (v < best) { best = v; sleep = s; } }
  const peak = hours.indexOf(Math.max(...hours));
  out.push({
    id: 'rhythm', title: 'Твой распорядок', weight: 10, found: total >= 50, level: total >= 300 ? 'medium' : total >= 50 ? 'low' : 'none',
    text: total >= 50 ? 'Больше всего действий около ' + hh(peak) + '. Тише всего с ' + hh(sleep) + ' до ' + hh(sleep + 6) + ' — похоже, в это время ты спишь. Так же время публикаций выдаёт часовой пояс и привычки.' : 'Слишком мало данных, чтобы понять распорядок.',
    hours, details: [], actions: [{ go: 'layer-9', label: 'Как прятать ритм активности →' }],
  });
  // 5. места по сетям Wi‑Fi
  const nets = audit && audit.ok ? (Array.isArray(audit.wifi) ? audit.wifi : audit.wifi ? [audit.wifi] : null) : null;
  out.push({
    id: 'places', title: 'Где ты бываешь', weight: 10, found: !!(nets && nets.length), level: nets && nets.length >= 3 ? 'high' : nets && nets.length ? 'medium' : 'none',
    text: nets == null ? 'Wi‑Fi адаптера нет — компьютер не выкрикивает имена сетей. Этот след чист.' : nets.length ? 'Компьютер помнит ' + fmt(nets.length, 'сеть', 'сети', 'сетей') + ' Wi‑Fi: ' + nets.slice(0, 6).map((x) => '«' + x + '»').join(', ') + '. По их именам видно, где ты бываешь.' : 'Сохранённых сетей нет.',
    details: [], actions: nets && nets.length ? [{ go: 'air', label: 'Забыть сети →' }] : [],
  });
  // 6. чем пользуешься
  const apps = audit && audit.ok ? audit.apps || [] : [];
  const groups = APPS.map(([name, re]) => [name, [...new Set(apps.filter((a) => re.test(a)).map((a) => a.replace(/\s*\(.*$|\s+\d[\d.]*.*$/, '').trim()))]]).filter((g) => g[1].length);
  out.push({
    id: 'apps', title: 'Чем ты пользуешься', weight: 5, found: groups.length > 0, level: groups.length ? 'high' : 'none',
    text: groups.length ? 'По установленным программам видно: ' + groups.map(([n, l]) => n + ' — ' + l.slice(0, 4).join(', ')).join('; ') + '.' : 'Ничего характерного среди программ не нашлось.',
    details: [], actions: [{ go: 'footprint', label: 'Удалить забытые аккаунты →' }],
  });
  // 7. с кем общаешься — только по тому, что ты сам загрузил в хранилище
  let people = [];
  try { const q = vault.query({ category: 'message', limit: 1 }); people = q.ok ? q.people : []; } catch (e) { people = []; }
  out.push({
    id: 'people', title: 'С кем ты общаешься', weight: 5, found: people.length > 0, level: people.length ? 'high' : 'none',
    text: people.length ? 'По переписке в хранилище: ' + people.map((p) => p.who + ' — ' + p.n).join(', ') + '. Такой граф связей — главное, что ищут в чужих данных.' : 'В хранилище нет переписки — Двойник не знает твоих собеседников.',
    details: [], actions: people.length ? [{ go: 'vault', label: 'Открыть хранилище →' }] : [],
  });
  // 8. на связи прямо сейчас
  const conns = radar && radar.ok ? radar.groups.slice(0, 6).map((g) => g.name + ' (' + g.conns.length + ')') : [];
  out.push({
    id: 'net', title: 'Кому сейчас виден компьютер', weight: 0, found: conns.length > 0, level: conns.length ? 'medium' : 'none',
    text: conns.length ? 'Прямо сейчас ' + fmt(radar.total, 'соединение', 'соединения', 'соединений') + ': ' + conns.join(', ') + '. Каждый сервер видит твой IP-адрес.' : 'Внешних соединений сейчас нет.',
    details: [], actions: [{ go: 'radar', label: 'Открыть радар →' }],
  });

  last = { gps: gpsFiles, serial: serialFiles, docs: docFiles };
  const lv = { high: 1, medium: 0.7, low: 0.35, none: 0 };
  const score = Math.round(out.reduce((s, f) => s + (f.found ? f.weight * lv[f.level] : 0), 0) / out.reduce((s, f) => s + f.weight, 0) * 100);
  return { ok: true, score, findings: out, stats: { files, photos: found.photo.length, videos: found.video.length, docs: found.doc.length, gps: gpsFiles.length }, user: id.user, host: id.host, folders: roots };
}

// Кнопки досье: чистят только файлы, найденные последним сбором
async function fix(kind, journal) {
  if (!last || !last[kind]) return { ok: false, err: 'Сначала собери досье' };
  const files = last[kind]; let done = 0; const failed = [];
  if (kind === 'docs') {
    const r = await meta.strip(files);
    r.forEach((x) => (x.error ? failed.push(x.file) : done++));
  } else {
    for (const f of files) {
      const labels = kind === 'gps' ? ['GPS'] : ['Серийный номер', 'Владелец камеры'];
      let ok = false;
      for (const l of labels) { const r = await meta.removeField(f, l); if (r.ok) { ok = true; if (kind === 'gps' && r.found && /координаты/.test(r.found.XMP || '')) await meta.removeField(f, 'XMP'); } }
      if (ok) done++; else failed.push(f);
    }
  }
  last[kind] = [];
  const what = { gps: 'место съёмки', serial: 'серийные номера камер', docs: 'авторы документов' }[kind];
  if (done) journal.add('clean', 'Двойник: стёрто — ' + what, done + ' файл(ов)');
  return { ok: true, done, failed: failed.length };
}

module.exports = { defaults, scan, fix };
