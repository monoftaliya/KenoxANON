// Импортёры: превращают официальные выгрузки сервисов в записи единой схемы хранилища.
// Распознавание идёт по содержимому файла, а не по имени — так понимаются и выгрузки Google с русскими названиями папок.
// Каждый импортёр: { id, name, ext: [...], test(data, file), parse(data, file, ctx) } → записи
//   { category, service, title, body, url, who, place, ts, extra }.
// Таблицы с паролями не импортируются никогда: для паролей есть менеджер паролей.
const path = require('path');

const s = (v, n = 4000) => (v == null ? '' : String(v)).replace(/\u0000/g, '').slice(0, n).trim();
const iso = (d) => { const t = d instanceof Date ? d : new Date(d); return Number.isFinite(t.getTime()) ? t.toISOString() : null; };
const fromUnix = (sec) => iso(Number(sec) * 1000);
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const unhtml = (t) => s(t).replace(/<[^>]+>/g, '').replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e.toLowerCase()] || m));
// Meta (Instagram, Facebook) пишет UTF-8 байтами в виде latin1: «Ð¿Ñ€Ð¸Ð²ÐµÑ‚» → «привет»
const unmojibake = (t) => { const v = s(t); return /[À-ÿ][\u0080-¿]/.test(v) ? Buffer.from(v, 'latin1').toString('utf8') : v; };

/* ---------- CSV ---------- */
function parseCsv(text) {
  const first = text.slice(0, text.indexOf('\n') > 0 ? text.indexOf('\n') : text.length);
  const sep = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : ',';
  const rows = []; let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c; continue; }
    if (c === '"') q = true;
    else if (c === sep) { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const head = (rows.shift() || []).map((h) => h.trim());
  return { head, rows: rows.filter((r) => r.some((v) => v.trim())).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] == null ? '' : r[i]]))) };
}
const col = (head, re) => head.find((h) => re.test(h));
const PASSWORDS = /pass(word)?|passwd|парол/i;

/* ---------- vCard ---------- */
function qpDecode(v, charset) {
  const bytes = []; for (let i = 0; i < v.length; i++) { if (v[i] === '=' && /^[0-9A-F]{2}$/i.test(v.substr(i + 1, 2))) { bytes.push(parseInt(v.substr(i + 1, 2), 16)); i += 2; } else bytes.push(v.charCodeAt(i) & 255); }
  try { return new TextDecoder((charset || 'utf-8').toLowerCase()).decode(Buffer.from(bytes)); } catch (e) { return Buffer.from(bytes).toString('utf8'); }
}
function parseVcf(text) {
  const raw = text.split(/\r?\n/), lines = [];
  for (let i = 0; i < raw.length; i++) {
    let l = raw[i];
    if (/^[ \t]/.test(l) && lines.length) { lines[lines.length - 1] += l.slice(1); continue; }   // свёрнутые строки
    while (/QUOTED-PRINTABLE/i.test(l) && l.endsWith('=') && i + 1 < raw.length) l = l.slice(0, -1) + raw[++i]; // мягкие переносы QP
    lines.push(l);
  }
  const cards = []; let cur = null;
  for (const l of lines) {
    if (/^BEGIN:VCARD/i.test(l)) { cur = { tel: [], email: [] }; continue; }
    if (/^END:VCARD/i.test(l)) { if (cur) cards.push(cur); cur = null; continue; }
    if (!cur) continue;
    const c = l.indexOf(':'); if (c < 0) continue;
    const [name, ...params] = l.slice(0, c).split(';'), key = name.toUpperCase().replace(/^ITEM\d+\./, '');
    if (key === 'PHOTO' || params.some((p) => /ENCODING=(B|BASE64)/i.test(p))) continue;
    let v = l.slice(c + 1);
    if (params.some((p) => /QUOTED-PRINTABLE/i.test(p))) v = qpDecode(v, (params.find((p) => /CHARSET=/i.test(p)) || '').split('=')[1]);
    v = v.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim();
    if (key === 'FN') cur.fn = v;
    else if (key === 'N') cur.n = v.split(';');
    else if (key === 'TEL') cur.tel.push(v);
    else if (key === 'EMAIL') cur.email.push(v);
    else if (key === 'ORG') cur.org = v.replace(/;+$/, '').replace(/;/g, ', ');
    else if (key === 'BDAY') cur.bday = v;
    else if (key === 'NOTE') cur.note = v;
  }
  return cards;
}

/* ---------- WhatsApp: «Экспорт чата» в .txt ---------- */
const WA = /^‎?\[?(\d{1,2})[./-](\d{1,2})[./-](\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s?([AaPp]\.?[Mm]\.?)?\]?\s?(?:[-–]\s)?(.*)$/;
function waLine(l) {
  const m = WA.exec(l); if (!m) return null;
  let [, a, b, y, H, M, S, ap, rest] = m;
  const us = !!ap && l.includes('/'); // американский формат: месяц/день
  const day = us ? b : a, mon = us ? a : b, year = y.length === 2 ? '20' + y : y;
  let h = Number(H); if (ap) { const pm = /p/i.test(ap); if (pm && h < 12) h += 12; if (!pm && h === 12) h = 0; }
  const c = rest.indexOf(': ');
  return { ts: year + '-' + mon.padStart(2, '0') + '-' + day.padStart(2, '0') + 'T' + String(h).padStart(2, '0') + ':' + M + ':' + (S || '00'), who: c > 0 && c < 60 ? rest.slice(0, c) : null, text: c > 0 && c < 60 ? rest.slice(c + 2) : rest };
}

/* ---------- закладки браузера (формат Netscape, экспорт из любого браузера) ---------- */
function parseBookmarks(html) {
  const out = [], stack = []; let folder = null;
  const re = /<DT><H3[^>]*>([\s\S]*?)<\/H3>|<DL>|<\/DL>|<DT><A\b([^>]*)>([\s\S]*?)<\/A>/gi; let m;
  while ((m = re.exec(html))) {
    if (m[1] !== undefined) folder = unhtml(m[1]);
    else if (/^<DL>$/i.test(m[0])) { stack.push(folder); folder = null; }
    else if (/^<\/DL>$/i.test(m[0])) stack.pop();
    else {
      const href = /HREF="([^"]*)"/i.exec(m[2]), added = /ADD_DATE="(\d+)"/i.exec(m[2]);
      out.push({ url: href ? unhtml(href[1]) : '', title: unhtml(m[3]), ts: added ? fromUnix(added[1]) : null, place: stack.filter(Boolean).join(' / ') });
    }
  }
  return out;
}

/* ---------- импортёры ---------- */
const flatTg = (t) => (Array.isArray(t) ? t.map((e) => (typeof e === 'string' ? e : e && e.text) || '').join('') : s(t));
const DISCORD_ID = /(?:^|[\\/])c?(\d{6,})[\\/][^\\/]+$/;

const IMPORTERS = [
  { id: 'telegram', name: 'Telegram', ext: ['.json'],
    test: (d) => !!d && typeof d === 'object' && ((d.chats && Array.isArray(d.chats.list)) || (d.contacts && Array.isArray(d.contacts.list)) || (Array.isArray(d.messages) && d.messages.some((m) => m && 'date' in m && ('from' in m || 'actor' in m)))),
    parse(d) {
      const out = [];
      const chats = d.chats && Array.isArray(d.chats.list) ? d.chats.list : Array.isArray(d.messages) ? [d] : [];
      for (const ch of chats) {
        const place = s(ch.name) || (ch.type === 'saved_messages' ? 'Избранное' : 'чат');
        for (const m of ch.messages || []) {
          if (m.type !== 'message') continue;
          const text = flatTg(m.text), media = m.photo ? '[фото]' : m.file ? '[файл ' + s(m.file_name || path.basename(String(m.file))) + ']' : m.media_type ? '[' + m.media_type + ']' : '';
          if (!text && !media) continue;
          out.push({ category: 'message', service: 'telegram', title: text.slice(0, 120) || media, body: [text, media].filter(Boolean).join(' '), who: s(m.from), place, ts: m.date ? s(m.date) : null, extra: { chat: ch.type || null } });
        }
      }
      for (const c of (d.contacts && d.contacts.list) || []) {
        const name = [c.first_name, c.last_name].map((v) => s(v)).filter(Boolean).join(' ');
        if (name || c.phone_number) out.push({ category: 'contact', service: 'telegram', title: name || s(c.phone_number), body: s(c.phone_number), ts: c.date ? s(c.date) : null });
      }
      return out;
    } },
  { id: 'meta', name: 'Instagram / Facebook', ext: ['.json'],
    test: (d) => !!d && Array.isArray(d.participants) && Array.isArray(d.messages) && d.messages.some((m) => m && 'sender_name' in m),
    parse(d, file) {
      const service = /instagram/i.test(file.rel) ? 'instagram' : 'facebook';
      const place = unmojibake(d.title) || d.participants.map((p) => unmojibake(p.name)).join(', ');
      return d.messages.map((m) => {
        const text = unmojibake(m.content), extra = m.photos ? '[фото]' : m.videos ? '[видео]' : m.audio_files ? '[голосовое]' : m.share ? '[ссылка]' : '';
        return { category: 'message', service, title: (text || extra).slice(0, 120), body: [text, extra].filter(Boolean).join(' '), url: m.share && m.share.link ? s(m.share.link) : '', who: unmojibake(m.sender_name), place, ts: m.timestamp_ms ? iso(m.timestamp_ms) : null };
      }).filter((x) => x.body);
    } },
  { id: 'discord', name: 'Discord: сообщения', ext: ['.json'],
    test: (d) => Array.isArray(d) && d.length > 0 && d[0] && 'Contents' in d[0] && 'Timestamp' in d[0],
    parse(d, file, ctx) {
      const id = (DISCORD_ID.exec(file.rel) || [])[1], place = (id && ctx.discordIndex[id]) || (id ? 'канал ' + id : 'Discord');
      return d.filter((m) => m && (m.Contents || m.Attachments)).map((m) => ({ category: 'message', service: 'discord', title: s(m.Contents || '[вложение]').slice(0, 120), body: s(m.Contents) + (m.Attachments ? ' [вложение]' : ''), who: 'ты', place, ts: m.Timestamp ? iso(String(m.Timestamp).replace(' ', 'T')) : null }));
    } },
  { id: 'discord-friends', name: 'Discord: друзья', ext: ['.json'],
    // из профиля берутся только друзья; почта, телефон и платёжные данные из этого файла не импортируются
    test: (d) => !!d && !Array.isArray(d) && Array.isArray(d.relationships) && ('username' in d || 'id' in d),
    parse: (d) => d.relationships.map((r) => r && r.user ? { category: 'contact', service: 'discord', title: s(r.user.global_name || r.user.username), body: s(r.user.username), extra: { type: r.type } } : null).filter(Boolean) },
  { id: 'google-history', name: 'Google: история Chrome', ext: ['.json'],
    test: (d) => !!d && !Array.isArray(d) && Object.values(d).some((v) => Array.isArray(v) && v.length && v[0] && 'time_usec' in v[0] && 'url' in v[0]),
    parse: (d) => Object.values(d).filter((v) => Array.isArray(v) && v.length && v[0] && 'time_usec' in v[0]).flat()
      .map((h) => ({ category: 'history', service: 'chrome', title: s(h.title) || s(h.url), url: s(h.url), ts: iso(Number(h.time_usec) / 1000) })) },
  { id: 'google-activity', name: 'Google: мои действия и YouTube', ext: ['.json'],
    test: (d) => Array.isArray(d) && d.length > 0 && d[0] && 'header' in d[0] && 'time' in d[0],
    parse: (d) => d.map((a) => ({ category: 'activity', service: /youtube/i.test(a.header) ? 'youtube' : 'google', title: s(a.title), body: (a.subtitles || []).map((x) => s(x.name)).filter(Boolean).join(' · '), url: s(a.titleUrl), place: s(a.header), ts: a.time ? iso(a.time) : null })) },
  { id: 'bookmarks', name: 'Закладки браузера', ext: ['.html', '.htm'],
    test: (t) => /NETSCAPE-Bookmark-file/i.test(t.slice(0, 400)),
    parse: (t) => parseBookmarks(t).map((b) => ({ category: 'bookmark', service: 'browser', title: b.title || b.url, url: b.url, place: b.place, ts: b.ts })) },
  { id: 'vcard', name: 'Контакты (vCard)', ext: ['.vcf'],
    test: (t) => /BEGIN:VCARD/i.test(t.slice(0, 2000)),
    parse: (t) => parseVcf(t).map((c) => {
      const name = c.fn || (c.n ? [c.n[1], c.n[2], c.n[0]].map((v) => s(v)).filter(Boolean).join(' ') : '');
      return { category: 'contact', service: 'contacts', title: name || c.tel[0] || c.email[0] || 'без имени', body: c.tel.concat(c.email).join(' · '), place: c.org || '', extra: { bday: c.bday || null, note: c.note || null } };
    }) },
  { id: 'whatsapp', name: 'WhatsApp: экспорт чата', ext: ['.txt'],
    test: (t) => t.split(/\r?\n/, 30).filter((l) => waLine(l)).length >= 2,
    parse(t, file) {
      const place = path.basename(file.rel, path.extname(file.rel)).replace(/^(Чат WhatsApp с |WhatsApp Chat with |WhatsApp Chat - )/i, '');
      const out = []; let last = null;
      for (const l of t.split(/\r?\n/)) {
        const m = waLine(l);
        if (m) { last = m.who ? { category: 'message', service: 'whatsapp', title: '', body: m.text, who: m.who, place, ts: m.ts } : null; if (last) out.push(last); }
        else if (last && l.trim()) last.body += '\n' + l;
      }
      out.forEach((x) => { x.body = s(x.body); x.title = x.body.slice(0, 120); });
      return out.filter((x) => x.body);
    } },
  { id: 'csv', name: 'Таблица CSV', ext: ['.csv'],
    test: () => true,
    parse(t, file) {
      const { head, rows } = parseCsv(t);
      if (!head.length || head.some((h) => PASSWORDS.test(h))) { const e = new Error('похоже на таблицу паролей — не импортируется'); e.skip = true; throw e; }
      if (col(head, /^ID$/) && col(head, /^Timestamp$/) && col(head, /^Contents$/)) {   // Discord, старые выгрузки
        const id = (DISCORD_ID.exec(file.rel) || [])[1];
        return rows.filter((r) => r.Contents).map((r) => ({ category: 'message', service: 'discord', title: s(r.Contents).slice(0, 120), body: s(r.Contents), who: 'ты', place: id ? 'канал ' + id : 'Discord', ts: iso(String(r.Timestamp).replace(' ', 'T')) }));
      }
      const name = col(head, /^(name|full name|display name|имя|фио|first name|given name)$/i), phone = col(head, /phone|телефон|mobile/i), mail = col(head, /e-?mail|почт/i);
      if (name && (phone || mail)) {   // контакты Google, Outlook и телефонов
        const last = col(head, /^(last name|family name|фамилия)$/i);
        return rows.map((r) => ({ category: 'contact', service: 'contacts', title: s([r[name], last ? r[last] : ''].filter(Boolean).join(' ')) || s(r[phone] || r[mail]), body: head.filter((h) => /phone|телефон|mobile|e-?mail|почт/i.test(h) && !/type|label|тип/i.test(h)).map((h) => s(r[h])).filter(Boolean).join(' · ') })).filter((x) => x.title);
      }
      const title = col(head, /^(title|name|subject|название|имя|тема|game|игра)$/i) || head[0], url = col(head, /url|link|ссылк/i), when = col(head, /date|time|дата|время|timestamp/i);
      return rows.map((r) => ({ category: 'activity', service: 'csv', title: s(r[title]).slice(0, 200), body: head.filter((h) => h !== title && h !== url && h !== when && r[h]).map((h) => h + ': ' + s(r[h], 300)).join(' · '), url: url ? s(r[url]) : '', place: path.basename(file.rel), ts: when ? iso(r[when]) : null })).filter((x) => x.title || x.body);
    } },
];

// Индекс каналов Discord (messages/index.json): номер канала → понятное имя
const isDiscordIndex = (rel, d) => /messages[\\/]index\.json$/i.test(rel) && d && !Array.isArray(d) && typeof d === 'object';

module.exports = { IMPORTERS, isDiscordIndex, parseCsv };
