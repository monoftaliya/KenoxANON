// Аудит Windows, исправления с откатом и системные инструменты (радар, подглядывание, эфир, браузеры, паника).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const ps = require('./ps');
const { CHECKS, REG_READS, P } = require('./checks');
const q = ps.q;

// Что именно поменяется — показывается человеку до применения
const ADMIN_PLAN = {
  firewall: ['Set-NetFirewallProfile -Profile Domain,Public,Private -Enabled True'],
  rdp: ['HKLM\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server → fDenyTSConnections = 1'],
  telemetry: ['HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\DataCollection → AllowTelemetry = 1 (только обязательные данные)'],
  dns: ['DNS активных адаптеров → 9.9.9.9, 149.112.112.112 (Quad9)', 'DNS-over-HTTPS → https://dns.quad9.net/dns-query', 'Clear-DnsClientCache'],
};
const regName = (p) => p.replace(/^HKCU:\\/, 'HKCU\\').replace(/^HKLM:\\/, 'HKLM\\');
const planOf = (c) => (c.fix.reg ? c.fix.reg.map((w) => regName(w.path) + ' → ' + w.name + ' = ' + w.value) : c.fix.admin ? ADMIN_PLAN[c.fix.admin] || null : null);

/* ---------- аудит: всё нужное читается одним вызовом PowerShell ---------- */
function auditScript() {
  const L = ['$r = [ordered]@{}', 'function Get-KxValue($p, $n) { try { (Get-ItemProperty -LiteralPath $p -Name $n -ErrorAction Stop).$n } catch { $null } }'];
  for (const [k, [p, n]] of Object.entries(REG_READS)) L.push('$r[' + q(k) + '] = Get-KxValue ' + q(p) + ' ' + q(n));
  L.push('$r["consent"] = @{ location = Get-KxValue ' + q(P.cam + '\\location') + " 'Value'; webcam = Get-KxValue " + q(P.cam + '\\webcam') + " 'Value'; microphone = Get-KxValue " + q(P.cam + '\\microphone') + " 'Value' }");
  L.push('try { $fw = [ordered]@{}; Get-NetFirewallProfile -ErrorAction Stop | ForEach-Object { $fw[[string]$_.Name] = [bool]$_.Enabled }; $r["firewall"] = $fw } catch { $r["firewall"] = $null }');
  L.push('try { $m = Get-MpComputerStatus -ErrorAction Stop; $r["defender"] = @{ rt = [bool]$m.RealTimeProtectionEnabled; age = [int]$m.AntivirusSignatureAge } } catch { $r["defender"] = $null }');
  L.push("try { $r['bitlocker'] = (New-Object -ComObject Shell.Application).NameSpace('C:').Self.ExtendedProperty('System.Volume.BitLockerProtection') } catch { $r['bitlocker'] = $null }");
  L.push('try { $h = Get-HotFix -ErrorAction Stop | Where-Object InstalledOn | Sort-Object InstalledOn -Descending | Select-Object -First 1; $r["hotfixDays"] = [int]((Get-Date) - $h.InstalledOn).TotalDays } catch { $r["hotfixDays"] = $null }');
  L.push('try { $o = Get-CimInstance Win32_OperatingSystem; $r["os"] = @{ caption = $o.Caption; build = $o.BuildNumber; user = $env:USERNAME; host = $env:COMPUTERNAME } } catch { }');
  L.push('try { $up = @(Get-NetAdapter -ErrorAction Stop | Where-Object Status -eq "Up"); $r["dns"] = @($up | ForEach-Object { $s = @((Get-DnsClientServerAddress -InterfaceIndex $_.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue).ServerAddresses); @{ alias = $_.Name; index = $_.ifIndex; servers = $s } }) } catch { $r["dns"] = $null }');
  L.push('try { $r["doh"] = @(Get-DnsClientDohServerAddress -ErrorAction Stop | Where-Object AutoUpgrade | ForEach-Object { $_.ServerAddress }) } catch { $r["doh"] = @() }');
  L.push('try { $e = [Console]::OutputEncoding; [Console]::OutputEncoding = [Text.Encoding]::GetEncoding([Globalization.CultureInfo]::CurrentCulture.TextInfo.OEMCodePage); $w = netsh wlan show profiles 2>$null; $code = $LASTEXITCODE; [Console]::OutputEncoding = $e; if ($code -eq 0) { $r["wifi"] = @($w | Where-Object { $_ -match "^\\s+.+\\s:\\s(.+)$" } | ForEach-Object { $Matches[1].Trim() }) } else { $r["wifi"] = $null } } catch { $r["wifi"] = $null }');
  L.push("$keys = 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'");
  L.push('$r["apps"] = @(Get-ItemProperty $keys -ErrorAction SilentlyContinue | ForEach-Object { $_.DisplayName } | Where-Object { $_ } | Sort-Object -Unique)');
  L.push('foreach ($t in @("$env:USERPROFILE\\Desktop\\Tor Browser", "$env:LOCALAPPDATA\\Tor Browser", "$env:USERPROFILE\\Desktop\\Mullvad Browser")) { if (Test-Path -LiteralPath $t) { $r["apps"] += (Split-Path $t -Leaf) + " (portable)" } }');
  L.push('$r | ConvertTo-Json -Depth 6 -Compress');
  return L.join('\n');
}

async function audit() {
  const res = await ps.json(auditScript(), { timeout: 60000 });
  if (!res.ok) return { ok: false, err: res.err };
  const d = res.data || {};
  if (d.apps && !Array.isArray(d.apps)) d.apps = [d.apps];
  if (d.wifi && !Array.isArray(d.wifi)) d.wifi = [d.wifi];
  if (d.dns && !Array.isArray(d.dns)) d.dns = [d.dns];
  (d.dns || []).forEach((a) => { if (!Array.isArray(a.servers)) a.servers = a.servers ? [a.servers] : []; });
  const items = CHECKS.map((c) => {
    let good = null, shown = '';
    try { good = c.good(d); shown = c.show(d); } catch (e) { good = null; shown = 'нет данных'; }
    return { id: c.id, layer: c.layer, w: c.w, title: c.title, term: c.term || null, good, shown, advice: c.advice, plan: planOf(c), fix: { kind: c.fix.reg ? 'reg' : c.fix.admin ? 'admin' : c.fix.tool ? 'tool' : 'open', label: c.fix.label, tool: c.fix.tool || null } };
  });
  const known = items.filter((i) => i.good !== null);
  const score = Math.round(known.reduce((s, i) => s + (i.good ? i.w : 0), 0) / Math.max(1, known.reduce((s, i) => s + i.w, 0)) * 100);
  return { ok: true, items, score, os: d.os || null, wifi: d.wifi || null, dns: d.dns || null, apps: d.apps || [], raw: { defender: d.defender, firewall: d.firewall } };
}

/* ---------- исправления и откат ---------- */
async function snapReg(writes) {
  const lines = writes.map((w, i) => '$o += @{ i = ' + i + '; prev = $(try { (Get-ItemProperty -LiteralPath ' + q(w.path) + ' -Name ' + q(w.name) + ' -ErrorAction Stop).' + "'" + w.name.replace(/'/g, "''") + "'" + ' } catch { $null }); kind = $(try { [string](Get-Item -LiteralPath ' + q(w.path) + ' -ErrorAction Stop).GetValueKind(' + q(w.name) + ') } catch { $null }) }');
  const r = await ps.json('$o = @(); ' + lines.join('; ') + '; ConvertTo-Json -InputObject @($o) -Compress');
  const arr = r.ok ? (Array.isArray(r.data) ? r.data : [r.data]) : [];
  return writes.map((w, i) => { const s = arr.find((x) => x && x.i === i) || {}; return { path: w.path, name: w.name, type: w.type, prev: s.prev === undefined ? null : s.prev, kind: s.kind || null }; });
}
const setLine = (p, n, t, v) => 'if (-not (Test-Path -LiteralPath ' + q(p) + ')) { New-Item -Path ' + q(p) + ' -Force | Out-Null }; New-ItemProperty -LiteralPath ' + q(p) + ' -Name ' + q(n) + ' -PropertyType ' + t + ' -Value ' + (t === 'DWord' ? Number(v) : q(v)) + ' -Force | Out-Null';
const delLine = (p, n) => 'Remove-ItemProperty -LiteralPath ' + q(p) + ' -Name ' + q(n) + ' -ErrorAction SilentlyContinue';

const ADMIN = {
  async firewall() {
    const r = await ps.json('$o = [ordered]@{}; Get-NetFirewallProfile | ForEach-Object { $o[[string]$_.Name] = [bool]$_.Enabled }; $o | ConvertTo-Json -Compress');
    return { snap: r.data || {}, run: 'Set-NetFirewallProfile -Profile Domain,Public,Private -Enabled True',
      undo: (s) => Object.entries(s).map(([k, v]) => 'Set-NetFirewallProfile -Profile ' + q(k) + ' -Enabled ' + (v ? 'True' : 'False')).join('; ') };
  },
  async rdp() {
    const prev = (await ps.run("(Get-ItemProperty -LiteralPath 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server' -Name fDenyTSConnections -ErrorAction SilentlyContinue).fDenyTSConnections")).out;
    return { snap: { prev }, run: "Set-ItemProperty -LiteralPath 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server' -Name fDenyTSConnections -Value 1",
      undo: (s) => s.prev === '' ? '' : "Set-ItemProperty -LiteralPath 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server' -Name fDenyTSConnections -Value " + Number(s.prev) };
  },
  async telemetry() {
    const prev = (await ps.run("(Get-ItemProperty -LiteralPath 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\DataCollection' -Name AllowTelemetry -ErrorAction SilentlyContinue).AllowTelemetry")).out;
    return { snap: { prev }, run: setLine('HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\DataCollection', 'AllowTelemetry', 'DWord', 1),
      undo: (s) => s.prev === '' ? delLine('HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\DataCollection', 'AllowTelemetry') : setLine('HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\DataCollection', 'AllowTelemetry', 'DWord', Number(s.prev)) };
  },
  async dns() {
    const r = await ps.json('$o = @(Get-NetAdapter | Where-Object Status -eq "Up" | ForEach-Object { @{ index = $_.ifIndex; static = [string](Get-ItemProperty -LiteralPath ("HKLM:\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters\\Interfaces\\" + $_.InterfaceGuid) -Name NameServer -ErrorAction SilentlyContinue).NameServer } }); ConvertTo-Json -InputObject $o -Compress');
    const snap = r.ok ? (Array.isArray(r.data) ? r.data : [r.data]) : [];
    const doh = "foreach ($a in '9.9.9.9','149.112.112.112') { try { if (Get-DnsClientDohServerAddress -ServerAddress $a -ErrorAction SilentlyContinue) { Set-DnsClientDohServerAddress -ServerAddress $a -DohTemplate 'https://dns.quad9.net/dns-query' -AllowFallbackToUdp $false -AutoUpgrade $true } else { Add-DnsClientDohServerAddress -ServerAddress $a -DohTemplate 'https://dns.quad9.net/dns-query' -AllowFallbackToUdp $false -AutoUpgrade $true } } catch { } }";
    return { snap, run: snap.map((a) => "Set-DnsClientServerAddress -InterfaceIndex " + Number(a.index) + " -ServerAddresses ('9.9.9.9','149.112.112.112')").join('; ') + '; ' + doh + '; Clear-DnsClientCache',
      undo: (s) => s.map((a) => 'Set-DnsClientServerAddress -InterfaceIndex ' + Number(a.index) + (a.static ? ' -ServerAddresses (' + a.static.split(/[ ,]+/).filter(Boolean).map(q).join(',') + ')' : ' -ResetServerAddresses')).join('; ') + '; Clear-DnsClientCache' };
  },
};

async function fix(id, undoStore, journal) {
  const c = CHECKS.find((x) => x.id === id);
  if (!c) return { ok: false, err: 'Нет такой проверки' };
  if (c.fix.reg) {
    const snap = await snapReg(c.fix.reg);
    const r = await ps.run(c.fix.reg.map((w) => setLine(w.path, w.name, w.type, w.value)).join('; '));
    if (!r.ok) return { ok: false, err: r.err };
    undoStore.set(id, { kind: 'reg', snap });
    journal.add('fix', c.title, c.fix.reg.map((w) => w.name + '=' + w.value).join(', '));
    return { ok: true };
  }
  if (c.fix.admin) {
    const plan = await ADMIN[c.fix.admin]();
    const r = await ps.admin(plan.run);
    if (!r.ok) return r;
    undoStore.set(id, { kind: 'admin', name: c.fix.admin, snap: plan.snap });
    journal.add('fix', c.title, 'с правами администратора');
    return { ok: true };
  }
  return { ok: false, err: 'Эту настройку меняют вручную' };
}

async function revert(id, undoStore, journal) {
  const c = CHECKS.find((x) => x.id === id), u = undoStore.get(id);
  if (!c || !u) return { ok: false, err: 'Нечего откатывать: изменение делалось не в KenoxANON' };
  if (u.kind === 'reg') {
    const r = await ps.run(u.snap.map((s) => (s.prev === null ? delLine(s.path, s.name) : setLine(s.path, s.name, s.kind === 'String' ? 'String' : s.kind === 'DWord' ? 'DWord' : s.type, s.prev))).join('; '));
    if (!r.ok) return { ok: false, err: r.err };
  } else {
    const plan = await ADMIN[u.name]();
    const script = plan.undo(u.snap);
    if (script) { const r = await ps.admin(script); if (!r.ok) return r; }
  }
  undoStore.del(id);
  journal.add('revert', c.title, 'возвращено как было');
  return { ok: true };
}

function openFor(id) {
  const c = CHECKS.find((x) => x.id === id);
  return c && c.fix.open ? c.fix.open : null;
}
function runUac() { execFile('UserAccountControlSettings.exe', [], { windowsHide: false }, () => {}); }

/* ---------- радар соединений ---------- */
async function radar() {
  const r = await ps.json('$p = @{}; Get-Process | ForEach-Object { $p[$_.Id] = $_.ProcessName }; $c = @(Get-NetTCPConnection -State Established -ErrorAction SilentlyContinue | Where-Object { $_.RemoteAddress -notmatch "^(127\\.|::1|0\\.0\\.0\\.0)" }); ConvertTo-Json -InputObject @($c | ForEach-Object { @{ pid = [int]$_.OwningProcess; name = $p[[int]$_.OwningProcess]; ip = [string]$_.RemoteAddress; port = [int]$_.RemotePort } }) -Compress');
  if (!r.ok) return r;
  const list = Array.isArray(r.data) ? r.data : r.data ? [r.data] : [];
  const by = {};
  list.forEach((c) => { const k = c.name || 'pid ' + c.pid; (by[k] = by[k] || { name: k, pid: c.pid, conns: [] }).conns.push({ ip: c.ip, port: c.port }); });
  return { ok: true, groups: Object.values(by).sort((a, b) => b.conns.length - a.conns.length), total: list.length };
}
async function ptr(ip) {
  if (!/^[0-9a-fA-F:.]+$/.test(ip)) return { ok: false };
  const r = await ps.run('(Resolve-DnsName -Name ' + q(ip) + ' -Type PTR -QuickTimeout -ErrorAction SilentlyContinue | Select-Object -First 1).NameHost', { timeout: 8000 });
  return { ok: true, host: r.out || 'имя не найдено' };
}

/* ---------- кто подглядывал: камера, микрофон, геопозиция ---------- */
async function spy() {
  const s = '$out = @(); $dv = @{}; foreach ($cap in "webcam","microphone","location") { $base = "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\$cap"; ' +
    '$dv[$cap] = [string](Get-ItemProperty -LiteralPath "$base\\NonPackaged" -Name Value -ErrorAction SilentlyContinue).Value; ' +
    'Get-ChildItem -LiteralPath $base -ErrorAction SilentlyContinue | Where-Object { $_.PSChildName -ne "NonPackaged" } | ForEach-Object { $v = Get-ItemProperty -LiteralPath $_.PSPath; $out += @{ cap = $cap; app = $_.PSChildName; desktop = $false; value = [string]$v.Value; start = [string]$v.LastUsedTimeStart; stop = [string]$v.LastUsedTimeStop } }; ' +
    'Get-ChildItem -LiteralPath "$base\\NonPackaged" -ErrorAction SilentlyContinue | ForEach-Object { $v = Get-ItemProperty -LiteralPath $_.PSPath; $out += @{ cap = $cap; app = $_.PSChildName; desktop = $true; value = [string]$v.Value; start = [string]$v.LastUsedTimeStart; stop = [string]$v.LastUsedTimeStop } } }; ConvertTo-Json -InputObject @{ list = @($out); desk = $dv } -Depth 5 -Compress';
  const r = await ps.json(s);
  if (!r.ok) return r;
  const d = r.data || {};
  const ft = (x) => { const n = Number(x); return n > 0 ? new Date(n / 10000 - 11644473600000).toISOString() : null; };
  const list = (Array.isArray(d.list) ? d.list : d.list ? [d.list] : []).map((e) => ({
    cap: e.cap, key: e.app, desktop: e.desktop, value: e.value || '', start: ft(e.start), stop: ft(e.stop),
    live: Number(e.start) > 0 && Number(e.stop) === 0 && Date.now() - (Number(e.start) / 10000 - 11644473600000) < 12 * 3600 * 1000,
    name: e.desktop ? e.app.split('#').pop() : e.app.replace(/_[a-z0-9]{13}$/, '').replace(/^Microsoft\./, ''),
  })).filter((e) => e.start || e.value).sort((a, b) => (b.live - a.live) || String(b.start || '').localeCompare(String(a.start || '')));
  return { ok: true, list, desk: d.desk || {} };
}
async function spySet(cap, key, value, undoStore, journal) {
  if (!['webcam', 'microphone', 'location'].includes(cap) || !/^[\w.#:\\ -]+$/.test(key) || key.includes('..')) return { ok: false, err: 'Неверное приложение' };
  const p = P.cam + '\\' + cap + (key === 'NonPackaged' ? '\\NonPackaged' : '\\' + key);
  const snap = await snapReg([{ path: p, name: 'Value', type: 'String', value }]);
  const r = await ps.run(setLine(p, 'Value', 'String', value));
  if (!r.ok) return { ok: false, err: r.err };
  const id = 'spy:' + cap + ':' + key;
  if (!undoStore.get(id)) undoStore.set(id, { kind: 'reg', snap });
  journal.add('fix', 'Доступ к ' + { webcam: 'камере', microphone: 'микрофону', location: 'геопозиции' }[cap] + (value === 'Deny' ? ' запрещён' : ' разрешён'), key);
  return { ok: true };
}

/* ---------- эфир: сохранённые сети Wi-Fi ---------- */
async function forgetWifi(name, journal) {
  if (typeof name !== 'string' || !name || name.length > 64) return { ok: false, err: 'Неверное имя сети' };
  const r = await ps.admin('$n = ' + q(name) + '; & netsh wlan delete profile ("name=" + $n) | Out-Null; if ($LASTEXITCODE -ne 0) { throw "netsh не удалил сеть" }');
  if (r.ok) journal.add('clean', 'Забыта сеть Wi‑Fi', name);
  return r;
}

/* ---------- браузеры: кэш, cookies, история ---------- */
const LA = process.env.LOCALAPPDATA || '', RA = process.env.APPDATA || '';
const CHROMIUM = [
  { id: 'chrome', name: 'Google Chrome', exe: 'chrome', root: path.join(LA, 'Google', 'Chrome', 'User Data') },
  { id: 'edge', name: 'Microsoft Edge', exe: 'msedge', root: path.join(LA, 'Microsoft', 'Edge', 'User Data') },
  { id: 'yandex', name: 'Яндекс Браузер', exe: 'browser', root: path.join(LA, 'Yandex', 'YandexBrowser', 'User Data') },
  { id: 'brave', name: 'Brave', exe: 'brave', root: path.join(LA, 'BraveSoftware', 'Brave-Browser', 'User Data') },
];
function profilesOf(root) { try { return fs.readdirSync(root).filter((d) => d === 'Default' || /^Profile \d+$/.test(d)).map((d) => path.join(root, d)); } catch (e) { return []; } }
function sizeOf(p, budget = { n: 0 }) {
  let s = 0;
  try {
    const st = fs.statSync(p);
    if (st.isFile()) return st.size;
    for (const e of fs.readdirSync(p)) { if (++budget.n > 40000) break; s += sizeOf(path.join(p, e), budget); }
  } catch (e) { /* нет доступа */ }
  return s;
}
// Что стирается в профиле. Закладки, сохранённые пароли и расширения не трогаются никогда.
// cookies — вместе с хранилищами сайтов и HSTS (там прячутся суперкуки из атласа); history — с вкладками, значками сайтов и подсказками адресной строки.
const withJournal = (list) => list.flatMap((f) => [f, f + '-journal', f + '-wal']);
function targets(b) {
  const out = { cache: [], cookies: [], history: [], forms: [] };
  if (b.firefox) {
    let profs = []; try { profs = fs.readdirSync(b.root); } catch (e) { /* нет профилей */ }
    profs.forEach((d) => {
      const p = path.join(b.root, d);
      out.cache.push(path.join(LA, 'Mozilla', 'Firefox', 'Profiles', d, 'cache2'));
      out.cookies.push(...withJournal([path.join(p, 'cookies.sqlite'), path.join(p, 'webappsstore.sqlite')]), path.join(p, 'storage'), path.join(p, 'SiteSecurityServiceState.bin'), path.join(p, 'SiteSecurityServiceState.txt'));
      // история Firefox лежит в одном файле с закладками (places.sqlite) — его не трогаем, стираем вкладки и значки
      out.history.push(...withJournal([path.join(p, 'favicons.sqlite')]), path.join(p, 'sessionstore.jsonlz4'), path.join(p, 'sessionstore-backups'));
      out.forms.push(...withJournal([path.join(p, 'formhistory.sqlite')]));
    });
  } else {
    profilesOf(b.root).forEach((p) => {
      out.cache.push(path.join(p, 'Cache'), path.join(p, 'Code Cache'), path.join(p, 'GPUCache'));
      out.cookies.push(...withJournal([path.join(p, 'Network', 'Cookies'), path.join(p, 'Cookies')]), path.join(p, 'Network', 'TransportSecurity'),
        ...['Local Storage', 'Session Storage', 'IndexedDB', 'Service Worker', 'File System', 'WebStorage'].map((d) => path.join(p, d)));
      out.history.push(...withJournal(['History', 'Visited Links', 'Top Sites', 'Shortcuts', 'Favicons', 'Network Action Predictor'].map((f) => path.join(p, f))), path.join(p, 'Sessions'),
        ...['Current Session', 'Last Session', 'Current Tabs', 'Last Tabs'].map((f) => path.join(p, f)));
      out.forms.push(...withJournal([path.join(p, 'Web Data')]));
    });
  }
  Object.keys(out).forEach((k) => { out[k] = out[k].filter((x) => fs.existsSync(x)); });
  return out;
}
const BROWSERS = () => CHROMIUM.concat([{ id: 'firefox', name: 'Firefox', exe: 'firefox', firefox: true, root: path.join(RA, 'Mozilla', 'Firefox', 'Profiles') }]).filter((b) => fs.existsSync(b.root));
async function browsers() {
  const running = (await ps.run('(Get-Process -ErrorAction SilentlyContinue | ForEach-Object ProcessName | Sort-Object -Unique) -join ","')).out.toLowerCase().split(',');
  return { ok: true, list: BROWSERS().map((b) => { const t = targets(b); return { id: b.id, name: b.name, running: running.includes(b.exe), cache: t.cache.reduce((s, p) => s + sizeOf(p), 0), cookies: t.cookies.length, history: t.history.length, forms: t.forms.length, firefox: !!b.firefox }; }) };
}
async function cleanBrowser(id, what, journal) {
  const b = BROWSERS().find((x) => x.id === id);
  if (!b) return { ok: false, err: 'Браузер не найден' };
  const running = (await ps.run('Get-Process -Name ' + q(b.exe) + ' -ErrorAction SilentlyContinue | Select-Object -First 1 | ForEach-Object { "yes" }')).out;
  if (running) return { ok: false, err: 'Сначала закрой ' + b.name + ': файлы заняты, пока браузер работает.' };
  const t = targets(b); let freed = 0, removed = 0;
  for (const k of ['cache', 'cookies', 'history', 'forms']) {
    if (!what[k]) continue;
    for (const p of t[k]) { freed += sizeOf(p); try { fs.rmSync(p, { recursive: true, force: true }); removed++; } catch (e) { /* занято */ } }
  }
  journal.add('clean', 'Очищен ' + b.name, Object.keys(what).filter((k) => what[k]).join(', ') + ' · ' + Math.round(freed / 1048576) + ' МБ');
  return { ok: true, freed, removed };
}

/* ---------- тревожная кнопка ---------- */
function lockScreen() { execFile('rundll32.exe', ['user32.dll,LockWorkStation'], { windowsHide: true }, () => {}); }

module.exports = { audit, fix, revert, openFor, runUac, radar, ptr, spy, spySet, forgetWifi, browsers, cleanBrowser, lockScreen, CHECKS };
