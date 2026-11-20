// Стирание: следы в Windows и программах, шредер файлов, затирание свободного места.
// Всё удаляется насовсем, поэтому интерфейс сначала показывает, что и сколько будет стёрто.
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { clipboard } = require('electron');
const ps = require('./ps');
const q = ps.q;

const LA = process.env.LOCALAPPDATA || '', RA = process.env.APPDATA || '', HOME = os.homedir();
const EXPL = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer';

/* ---------- обход папок ---------- */
// Размер и число файлов (с ограничением, чтобы не зависнуть на огромных деревьях)
function measure(p, opts = {}, budget = { n: 0 }) {
  let size = 0, count = 0, list;
  try { list = fs.readdirSync(p, { withFileTypes: true }); } catch (e) { return { size, count }; }
  for (const e of list) {
    if (++budget.n > 60000) break;
    const full = path.join(p, e.name);
    try {
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) { const r = measure(full, opts, budget); size += r.size; count += r.count; continue; }
      const st = fs.statSync(full);
      if (opts.olderThan && Date.now() - st.mtimeMs < opts.olderThan) continue;
      size += st.size; count++;
    } catch (err) { /* нет доступа */ }
  }
  return { size, count };
}
// Удаляет содержимое папки, саму папку оставляет. Занятые файлы пропускает, по ссылкам не переходит.
function wipeInside(p, opts = {}) {
  let freed = 0, removed = 0, busy = 0, list;
  try { list = fs.readdirSync(p, { withFileTypes: true }); } catch (e) { return { freed, removed, busy }; }
  for (const e of list) {
    const full = path.join(p, e.name);
    try {
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        const r = wipeInside(full, opts); freed += r.freed; removed += r.removed; busy += r.busy;
        if (!opts.keepDirs) { try { fs.rmdirSync(full); } catch (err) { /* не пуста или занята */ } }
        continue;
      }
      const st = fs.statSync(full);
      if (opts.olderThan && Date.now() - st.mtimeMs < opts.olderThan) continue;
      fs.rmSync(full, { force: true }); freed += st.size; removed++;
    } catch (err) { busy++; }
  }
  return { freed, removed, busy };
}
const sizeOfFile = (f) => { try { return fs.statSync(f).size; } catch (e) { return 0; } };
const existing = (list) => list.filter((p) => { try { return fs.existsSync(p); } catch (e) { return false; } });

/* ---------- следы ---------- */
function thumbFiles() {
  const dir = path.join(LA, 'Microsoft', 'Windows', 'Explorer');
  try { return fs.readdirSync(dir).filter((n) => /^thumbcache_.*\.db$/i.test(n)).map((n) => path.join(dir, n)); } catch (e) { return []; }
}
function telegramDirs() {
  const root = path.join(RA, 'Telegram Desktop', 'tdata'), out = [];
  try { for (const d of fs.readdirSync(root)) if (/^user_data(#\d+)?$/.test(d)) out.push(path.join(root, d, 'cache'), path.join(root, d, 'media_cache')); } catch (e) { /* не установлен */ }
  return existing(out);
}
const TRACES = [
  { id: 'recent', title: 'Недавние файлы и списки переходов', why: 'ярлыки всего, что ты открывал, и списки «Недавние» в «Пуске» и на панели задач', dirs: () => existing([path.join(RA, 'Microsoft', 'Windows', 'Recent')]), keepDirs: true, safe: true },
  { id: 'run', title: 'История «Выполнить» и адресной строки', why: 'команды из Win+R и пути, набранные в проводнике', reg: [EXPL + '\\RunMRU', EXPL + '\\TypedPaths'], safe: true },
  { id: 'search', title: 'История поиска в проводнике', why: 'всё, что ты искал в окне проводника', reg: [EXPL + '\\WordWheelQuery'], safe: true },
  { id: 'clipboard', title: 'Буфер обмена и журнал Win+V', why: 'скопированные пароли, адреса и куски переписки', safe: true },
  { id: 'temp', title: 'Временные файлы старше суток', why: 'распакованные архивы, вложения из почты, черновики программ', dirs: () => existing([path.join(LA, 'Temp')]), olderThan: 864e5, safe: true },
  { id: 'thumbs', title: 'Кэш эскизов', why: 'миниатюры фотографий — в том числе тех, что ты уже удалил', files: thumbFiles, safe: true },
  { id: 'wer', title: 'Отчёты об ошибках', why: 'снимки памяти программ в момент сбоя: в них бывают куски документов', dirs: () => existing(['ReportArchive', 'ReportQueue'].map((d) => path.join(LA, 'Microsoft', 'Windows', 'WER', d))), safe: true },
  { id: 'dns', title: 'Кэш DNS', why: 'адреса сайтов, на которые недавно заходили', safe: true },
  { id: 'recycle', title: 'Корзина', why: 'удалённые файлы, которые на самом деле ещё лежат на диске' },
  { id: 'telegram', title: 'Кэш Telegram Desktop', why: 'фото, видео и голосовые из чатов, сохранённые на диске', dirs: telegramDirs, proc: 'Telegram' },
  { id: 'discord', title: 'Кэш Discord', why: 'картинки и вложения из каналов и личных сообщений', dirs: () => existing(['Cache', 'Code Cache', 'GPUCache'].map((d) => path.join(RA, 'discord', d))), proc: 'Discord' },
  { id: 'prefetch', title: 'Prefetch: журнал запуска программ', why: 'Windows хранит, какие программы и когда запускались', admin: true },
];
const SCAN_PS = [
  '$r = @{}',
  'function Get-KxCount($p) { try { $k = Get-Item -LiteralPath $p -ErrorAction Stop; @($k.GetValueNames() | Where-Object { $_ -and $_ -notmatch "^MRUList" }).Count } catch { 0 } }',
  '$r.run = (Get-KxCount ' + q(EXPL + '\\RunMRU') + ') + (Get-KxCount ' + q(EXPL + '\\TypedPaths') + ')',
  '$r.search = Get-KxCount ' + q(EXPL + '\\WordWheelQuery'),
  'try { $r.cliphist = [int](Get-ItemProperty -LiteralPath "HKCU:\\Software\\Microsoft\\Clipboard" -Name EnableClipboardHistory -ErrorAction Stop).EnableClipboardHistory } catch { $r.cliphist = 0 }',
  'try { $items = @((New-Object -ComObject Shell.Application).NameSpace(10).Items()); $r.recycleCount = $items.Count; $s = [int64]0; foreach ($i in $items) { $s += [int64]$i.Size }; $r.recycleSize = $s } catch { }',
  'try { $r.dns = @(Get-DnsClientCache -ErrorAction Stop).Count } catch { }',
  '$r.procs = @(Get-Process -Name Telegram, Discord -ErrorAction SilentlyContinue | ForEach-Object { $_.ProcessName } | Sort-Object -Unique)',
  '$r | ConvertTo-Json -Compress',
].join('\n');
const running = async () => {
  const r = await ps.run('@(Get-Process -Name Telegram, Discord -ErrorAction SilentlyContinue | ForEach-Object { $_.ProcessName }) -join ","');
  return r.out.toLowerCase().split(',').filter(Boolean);
};

async function scan() {
  const r = await ps.json(SCAN_PS), d = (r.ok && r.data) || {};
  const procs = (Array.isArray(d.procs) ? d.procs : d.procs ? [d.procs] : []).map((x) => String(x).toLowerCase());
  const items = TRACES.map((t) => {
    const it = { id: t.id, title: t.title, why: t.why, safe: !!t.safe, admin: !!t.admin, size: null, count: null, running: t.proc ? procs.includes(t.proc.toLowerCase()) : false, note: null, missing: false };
    if (t.dirs) {
      const dirs = t.dirs();
      if (!dirs.length) { it.missing = !!t.proc; it.note = t.proc ? 'не установлен' : 'пусто'; }
      const m = dirs.map((p) => measure(p, { olderThan: t.olderThan })).reduce((a, b) => ({ size: a.size + b.size, count: a.count + b.count }), { size: 0, count: 0 });
      it.size = m.size; it.count = m.count;
    }
    if (t.files) { const fl = t.files(); it.count = fl.length; it.size = fl.reduce((s, f) => s + sizeOfFile(f), 0); }
    if (t.id === 'run') it.count = d.run == null ? null : d.run;
    if (t.id === 'search') it.count = d.search == null ? null : d.search;
    if (t.id === 'clipboard') it.note = d.cliphist ? 'журнал Win+V включён' : 'журнал Win+V выключен';
    if (t.id === 'recycle') { it.count = d.recycleCount == null ? null : d.recycleCount; it.size = d.recycleSize == null ? null : d.recycleSize; }
    if (t.id === 'dns') it.count = d.dns == null ? null : d.dns;
    if (t.id === 'prefetch') it.note = 'нужны права администратора';
    if (it.running) it.note = 'сейчас открыт — закрой перед очисткой';
    return it;
  });
  return { ok: true, items };
}

// Журнал Win+V очищается через WinRT; текущий буфер — средствами Electron
const CLIP_PS = 'try { Add-Type -AssemblyName System.Runtime.WindowsRuntime; $null = [Windows.ApplicationModel.DataTransfer.Clipboard, Windows.ApplicationModel.DataTransfer, ContentType = WindowsRuntime]; $null = [Windows.ApplicationModel.DataTransfer.Clipboard]::ClearHistory() } catch { }';

async function clean(ids, journal) {
  const want = new Set(ids), results = [], script = [], viaPs = new Set();
  const procs = TRACES.some((t) => t.proc && want.has(t.id)) ? await running() : [];
  for (const t of TRACES) {
    if (!want.has(t.id)) continue;
    if (t.proc && procs.includes(t.proc.toLowerCase())) { results.push({ id: t.id, ok: false, note: 'закрой ' + t.proc + ' и повтори' }); continue; }
    try {
      if (t.dirs) {
        const agg = { freed: 0, removed: 0, busy: 0 };
        for (const p of t.dirs()) { const r = wipeInside(p, { olderThan: t.olderThan, keepDirs: t.keepDirs }); agg.freed += r.freed; agg.removed += r.removed; agg.busy += r.busy; }
        results.push({ id: t.id, ok: true, ...agg, note: agg.busy ? agg.busy + ' занято другими программами' : null });
      } else if (t.files) {
        let freed = 0, removed = 0, busy = 0;
        for (const f of t.files()) { const s = sizeOfFile(f); try { fs.rmSync(f, { force: true }); freed += s; removed++; } catch (e) { busy++; } }
        results.push({ id: t.id, ok: true, freed, removed, busy, note: busy ? busy + ' файл(ов) занято проводником — удалятся после перезапуска' : null });
      } else if (t.reg) {
        script.push(...t.reg.map((k) => 'Remove-Item -LiteralPath ' + q(k) + ' -Recurse -Force -ErrorAction SilentlyContinue'));
        viaPs.add(t.id); results.push({ id: t.id, ok: true });
      } else if (t.id === 'clipboard') { clipboard.clear(); script.push(CLIP_PS); viaPs.add(t.id); results.push({ id: t.id, ok: true }); }
      else if (t.id === 'recycle') { script.push('Clear-RecycleBin -Force -ErrorAction SilentlyContinue'); viaPs.add(t.id); results.push({ id: t.id, ok: true }); }
      else if (t.id === 'dns') { script.push('try { Clear-DnsClientCache -ErrorAction Stop } catch { ipconfig /flushdns | Out-Null }'); viaPs.add(t.id); results.push({ id: t.id, ok: true }); }
      else if (t.id === 'prefetch') {
        const r = await ps.admin('Remove-Item -Path (Join-Path $env:SystemRoot "Prefetch\\*.pf") -Force -ErrorAction SilentlyContinue');
        results.push({ id: t.id, ok: r.ok, note: r.ok ? null : r.err });
      }
    } catch (e) { results.push({ id: t.id, ok: false, note: e.message }); }
  }
  if (script.length) { const r = await ps.run(script.join('\n'), { timeout: 60000 }); if (!r.ok) results.filter((x) => viaPs.has(x.id)).forEach((x) => { x.ok = false; x.note = r.err || 'PowerShell не ответил'; }); }
  const done = results.filter((x) => x.ok).map((x) => TRACES.find((t) => t.id === x.id).title.toLowerCase());
  if (done.length && journal) journal.add('clean', 'Стёрты следы', done.join(', '));
  return { ok: true, results };
}

/* ---------- шредер ---------- */
const MAX_FILES = 20000, MAX_BYTES = 64 * 1024 ** 3;
const norm = (p) => path.resolve(String(p)).replace(/[\\/]+$/, '').toLowerCase();
let guard = [];
function setGuard(paths) { guard = paths.filter(Boolean).map(norm); }
function systemDirs() {
  const e = process.env, sd = (e.SystemDrive || 'C:') + '\\';
  return [e.SystemRoot, e.ProgramFiles, e['ProgramFiles(x86)'], e.ProgramW6432, e.ProgramData, sd + 'Recovery', sd + '$Recycle.Bin', sd + 'System Volume Information', sd + 'Boot', sd + 'EFI']
    .filter(Boolean).map(norm);
}
function profileDirs() {
  const base = ['', 'Desktop', 'Documents', 'Downloads', 'Pictures', 'Videos', 'Music', 'OneDrive', 'AppData', 'AppData\\Roaming', 'AppData\\Local', 'AppData\\LocalLow', 'OneDrive\\Desktop', 'OneDrive\\Documents', 'OneDrive\\Pictures'];
  return base.map((b) => norm(path.join(HOME, b))).concat(norm(path.dirname(HOME)));
}
function blockedReason(p) {
  const n = norm(p);
  if (/^[a-z]:$/.test(n) || /^\\\\[^\\]+\\[^\\]+$/.test(n)) return 'это целый диск';
  if (systemDirs().some((s) => n === s || n.startsWith(s + '\\'))) return 'системная папка Windows или программ';
  if (profileDirs().includes(n)) return 'целая папка профиля — выбери файлы внутри неё';
  if (guard.some((g) => n === g || n.startsWith(g + '\\'))) return 'файлы самого KenoxANON';
  return null;
}
function planShred(paths) {
  const files = [], dirs = [], skipped = []; let bytes = 0;
  const walk = (p) => {
    if (files.length > MAX_FILES) return;
    let st; try { st = fs.lstatSync(p); } catch (e) { skipped.push({ path: p, why: 'не найден или нет доступа' }); return; }
    if (st.isSymbolicLink()) { skipped.push({ path: p, why: 'ссылка на другое место — пропущена' }); return; }
    if (st.isDirectory()) {
      let list; try { list = fs.readdirSync(p); } catch (e) { skipped.push({ path: p, why: 'нет доступа к папке' }); return; }
      list.forEach((n) => walk(path.join(p, n)));
      dirs.push(p); return;
    }
    if (st.isFile()) { files.push({ path: p, size: st.size }); bytes += st.size; }
  };
  for (const p of paths) { const why = blockedReason(p); if (why) skipped.push({ path: p, why }); else walk(p); }
  return { files, dirs, bytes, skipped, tooMany: files.length > MAX_FILES || bytes > MAX_BYTES };
}
function summary(paths) {
  const p = planShred(paths);
  return { ok: true, files: p.files.length, dirs: p.dirs.length, bytes: p.bytes, skipped: p.skipped.slice(0, 50), tooMany: p.tooMany, limit: { files: MAX_FILES, gb: MAX_BYTES / 1024 ** 3 } };
}
let cancelled = false;
function cancel() { cancelled = true; return { ok: true }; }
// Каждый файл: перезапись случайными байтами → обрезка до нуля → случайное имя → удаление
async function shred(paths, onProgress, journal) {
  const plan = planShred(paths);
  if (plan.tooMany) return { ok: false, err: 'Слишком много за раз: не больше ' + MAX_FILES + ' файлов и ' + MAX_BYTES / 1024 ** 3 + ' ГБ' };
  cancelled = false;
  const buf = Buffer.alloc(1 << 20), failed = []; let done = 0, wiped = 0, last = 0;
  const tick = (name, force) => { const now = Date.now(); if (force || now - last > 120) { last = now; onProgress({ done, total: plan.files.length, bytes: wiped, totalBytes: plan.bytes, name }); } };
  for (const f of plan.files) {
    if (cancelled) break;
    try {
      try { fs.chmodSync(f.path, 0o666); } catch (e) { /* только чтение снять не вышло */ }
      const fh = await fsp.open(f.path, 'r+');
      try {
        for (let off = 0; off < f.size; off += buf.length) {
          const n = Math.min(buf.length, f.size - off);
          crypto.randomFillSync(buf, 0, n);
          await fh.write(buf, 0, n, off); wiped += n; tick(path.basename(f.path));
        }
        await fh.sync(); await fh.truncate(0);
      } finally { await fh.close(); }
      const tmp = path.join(path.dirname(f.path), crypto.randomBytes(8).toString('hex'));
      fs.renameSync(f.path, tmp); fs.rmSync(tmp, { force: true });
      done++; tick(path.basename(f.path));
    } catch (e) { failed.push({ path: f.path, err: e.code === 'EBUSY' || e.code === 'EPERM' || e.code === 'EACCES' ? 'файл занят или защищён' : e.message }); }
  }
  // опустевшие папки, начиная с самых глубоких
  for (const d of plan.dirs) {
    try { if (fs.readdirSync(d).length) continue; const tmp = path.join(path.dirname(d), crypto.randomBytes(8).toString('hex')); fs.renameSync(d, tmp); fs.rmdirSync(tmp); } catch (e) { /* занята */ }
  }
  tick('', true);
  if (journal && (done || failed.length)) journal.add('clean', 'Шредер', done + ' файл(ов) стёрто без восстановления' + (failed.length ? ', не удалось: ' + failed.length : '') + (cancelled ? ', остановлено' : ''));
  return { ok: true, done, total: plan.files.length, wiped, failed: failed.slice(0, 50), skipped: plan.skipped.slice(0, 50), cancelled };
}

/* ---------- свободное место ---------- */
const DRIVES_PS = '$out = @(Get-Volume -ErrorAction SilentlyContinue | Where-Object { $_.DriveLetter -and $_.DriveType -eq "Fixed" } | Sort-Object DriveLetter | ForEach-Object { $m = ""; try { $p = Get-Partition -DriveLetter $_.DriveLetter -ErrorAction Stop; $m = [string](Get-PhysicalDisk -ErrorAction Stop | Where-Object DeviceId -eq ([string]$p.DiskNumber) | Select-Object -First 1).MediaType } catch { }; @{ letter = [string]$_.DriveLetter; label = [string]$_.FileSystemLabel; free = [int64]$_.SizeRemaining; size = [int64]$_.Size; media = $m } }); ConvertTo-Json -InputObject $out -Compress';
async function drives() {
  const r = await ps.json(DRIVES_PS);
  if (!r.ok) return r;
  return { ok: true, list: Array.isArray(r.data) ? r.data : r.data ? [r.data] : [] };
}
// cipher /w трижды перезаписывает свободное место (нули, единицы, случайные байты) в отдельном окне — его видно и можно закрыть
async function wipeFree(letter, journal) {
  if (!/^[A-Za-z]$/.test(String(letter))) return { ok: false, err: 'Неверный диск' };
  const L = String(letter).toUpperCase();
  const r = await ps.run('Start-Process -FilePath cmd.exe -ArgumentList ' + q('/k title KenoxANON - затирание свободного места ' + L + ': & cipher /w:' + L + ':\\'));
  if (!r.ok) return { ok: false, err: r.err };
  journal.add('clean', 'Затирание свободного места', 'диск ' + L + ': (cipher /w)');
  return { ok: true };
}

module.exports = { scan, clean, summary, shred, cancel, setGuard, drives, wipeFree, TRACES };
