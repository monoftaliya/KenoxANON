// Метаданные файлов: что спрятано в фото, видео, аудио и документах — и как это стереть.
// Форматы: JPEG, PNG, HEIC/HEIF/AVIF, WebP, PDF, DOCX/XLSX/PPTX, MP4/MOV/M4V/3GP, MP3, M4A, FLAC.
// Три способа: чистая копия рядом, удаление из самого файла целиком или по одному полю.
// Запись идёт через временный файл и повторный разбор: если результат не читается, оригинал остаётся как был.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const JSZip = require('jszip');

const MAX = 300 * 1024 * 1024;
const SUPPORTED = 'JPEG, PNG, HEIC, WebP, AVIF, PDF, DOCX, XLSX, PPTX, MP4, MOV, MP3, M4A, FLAC';
const zero = (buf, spans) => { const b = Buffer.from(buf); for (const [a, z] of spans) b.fill(0, a, z); return b; };
const uniq = (obj, label) => { let l = label, k = 2; while (obj[l]) l = label + ' (' + k++ + ')'; return l; };
const short = (v) => String(v).replace(/\s+/g, ' ').trim().slice(0, 80);

/* ---------- XMP: общий для JPEG, PNG и PDF ---------- */
function xmpSummary(x) {
  const parts = [];
  if (/GPSLatitude|GPSLongitude/.test(x)) parts.push('координаты');
  const tool = x.match(/CreatorTool(?:="([^"]+)"|>([^<]+)<)/);
  if (tool && (tool[1] || tool[2]).trim()) parts.push('программа ' + (tool[1] || tool[2]).trim().slice(0, 30));
  if (/<dc:creator/.test(x)) parts.push('автор');
  if (/xmpMM:History|stEvt:/.test(x)) parts.push('история правок');
  return parts.length ? 'есть: ' + parts.join(', ') : 'есть';
}
// Стирает значения внутри пакета XMP, не меняя его длину: текст и атрибуты заменяются пробелами
const blankXmpText = (x) => x
  .replace(/(\s)([A-Za-z_][\w.-]*):([\w.-]+)="([^"]*)"/g, (m, sp, pfx, name, v) => (['xmlns', 'rdf', 'x', 'xml'].includes(pfx) ? m : sp + pfx + ':' + name + '="' + ' '.repeat(v.length) + '"'))
  .replace(/>([^<]+)</g, (m, t) => (t.trim() ? '>' + ' '.repeat(t.length) + '<' : m));
const xmpHasData = (x) => blankXmpText(x) !== x;

/* ---------- JPEG ---------- */
function jpegSegments(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  const segs = []; let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) return null;
    while (buf[i + 1] === 0xff) i++; // байты-заполнители между сегментами
    const m = buf[i + 1];
    if (m === 0xd9) { segs.push({ m, start: i, end: i + 2 }); break; }
    if ((m >= 0xd0 && m <= 0xd7) || m === 0x01) { segs.push({ m, start: i, end: i + 2 }); i += 2; continue; }
    if (i + 4 > buf.length) return null;
    const len = buf.readUInt16BE(i + 2);
    if (m === 0xda) { segs.push({ m, start: i, end: buf.length, sos: true }); break; }
    if (len < 2 || i + 2 + len > buf.length) return null;
    segs.push({ m, start: i, end: i + 2 + len, data: buf.subarray(i + 4, i + 2 + len) });
    i += 2 + len;
  }
  return segs.some((s) => s.sos) ? segs : null;
}
const XMP_HEADS = ['http://ns.adobe.com/xap/1.0/', 'http://ns.adobe.com/xmp/extension/'];
const isXmp = (s) => s.m === 0xe1 && !!s.data && XMP_HEADS.some((h) => s.data.toString('latin1', 0, h.length) === h);
const isExif = (s) => s.m === 0xe1 && !!s.data && s.data.toString('latin1', 0, 6) === 'Exif\0\0';
function dropSegments(buf, pred) {
  const segs = jpegSegments(buf); if (!segs) throw new Error('файл не похож на JPEG');
  return Buffer.concat([buf.subarray(0, 2), ...segs.filter((s) => !pred(s)).map((s) => buf.subarray(s.start, s.end))]);
}

const EXIF0 = { 0x010e: 'Описание', 0x010f: 'Производитель', 0x0110: 'Модель', 0x0131: 'Программа', 0x0132: 'Изменено', 0x013b: 'Автор', 0x8298: 'Авторские права' };
const EXIF1 = { 0x9003: 'Снято', 0xa420: 'ID снимка', 0xa430: 'Владелец камеры', 0xa431: 'Серийный номер', 0xa434: 'Объектив' };
const GPSN = { 1: 'latRef', 2: 'lat', 3: 'lonRef', 4: 'lon', 6: 'alt' };
const TSIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

// Разбор EXIF с запоминанием, где в файле лежит каждое значение, — чтобы стирать поля по одному.
// T — где в data начинается заголовок TIFF: в JPEG после «Exif\0\0» (6), в WebP и HEIC бывает и сразу (0).
function parseExif(data, base, T = 6) {
  if (!data || data.length < T + 8 || !/^(II|MM)$/.test(data.toString('latin1', T, T + 2))) return null;
  const le = data.toString('latin1', T, T + 2) === 'II', len = data.length - T;
  const u16 = (o) => (le ? data.readUInt16LE(T + o) : data.readUInt16BE(T + o));
  const u32 = (o) => (le ? data.readUInt32LE(T + o) : data.readUInt32BE(T + o));
  const abs = (o) => base + T + o;
  const place = (type, count, e) => { const size = (TSIZE[type] || 1) * count; const at = size > 4 ? u32(e + 8) : e + 8; return at + size <= len ? { at, size } : null; };
  const read = (type, count, at) => {
    if (type === 2) return data.toString('utf8', T + at, T + at + count).replace(/\0+$/, '').trim();
    if (type === 3) return u16(at);
    if (type === 4) return u32(at);
    if (type === 5) return Array.from({ length: count }, (_, k) => u32(at + k * 8) / (u32(at + k * 8 + 4) || 1));
    return null;
  };
  const fields = {}; let orientation = null, gpsOff = 0, next0 = null;
  const walk = (off, names, depth) => {
    if (!off || off + 2 > len || depth > 2) return;
    const n = u16(off);
    for (let k = 0; k < n; k++) {
      const e = off + 2 + k * 12; if (e + 12 > len) break;
      const tag = u16(e), type = u16(e + 2), count = u32(e + 4), p = place(type, count, e);
      if (!p) continue;
      if (depth === 0 && tag === 0x0112 && type === 3) orientation = u16(e + 8);
      if (names[tag] && type === 2) { const v = read(type, count, p.at); if (v) fields[names[tag]] = { value: short(v), spans: [[abs(p.at), abs(p.at + p.size)]] }; }
      // заметки производителя: у iPhone, Canon и других там бывают серийные номера и служебные идентификаторы
      if (depth === 1 && tag === 0x927c && p.size > 8) fields['Служебные данные камеры'] = { value: 'есть · ' + p.size + ' байт', spans: [[abs(p.at), abs(p.at + p.size)]] };
      if (tag === 0x8769) walk(u32(e + 8), EXIF1, depth + 1);
      if (tag === 0x8825) gpsOff = u32(e + 8);
    }
    if (depth === 0 && off + 2 + n * 12 + 4 <= len) next0 = off + 2 + n * 12;
  };
  walk(u32(4), EXIF0, 0);
  // координаты съёмки
  if (gpsOff && gpsOff + 2 <= len) {
    const n = u16(gpsOff), vals = {}, spans = [[abs(gpsOff), abs(Math.min(len, gpsOff + 2 + n * 12))]];
    for (let k = 0; k < n; k++) {
      const e = gpsOff + 2 + k * 12; if (e + 12 > len) break;
      const tag = u16(e), type = u16(e + 2), count = u32(e + 4), p = place(type, count, e);
      if (!p) continue;
      if (p.size > 4) spans.push([abs(p.at), abs(p.at + p.size)]);
      if (GPSN[tag]) vals[GPSN[tag]] = read(type, count, p.at);
    }
    if (Array.isArray(vals.lat) && Array.isArray(vals.lon) && vals.lat.length >= 3 && vals.lon.length >= 3) {
      const deg = (a) => a[0] + a[1] / 60 + a[2] / 3600;
      const lat = deg(vals.lat) * (vals.latRef === 'S' ? -1 : 1), lon = deg(vals.lon) * (vals.lonRef === 'W' ? -1 : 1);
      if (lat || lon) fields.GPS = { value: lat.toFixed(5) + ', ' + lon.toFixed(5) + (Array.isArray(vals.alt) ? ' · ' + Math.round(vals.alt[0]) + ' м' : ''), spans, lat, lon };
    } else if (n > 0) fields.GPS = { value: 'есть (неполные данные о месте)', spans };
  }
  // встроенная миниатюра: может показывать снимок до обрезки
  if (next0) {
    const ifd1 = u32(next0);
    if (ifd1 && ifd1 + 2 <= len) {
      const n = u16(ifd1); let at = 0, size = 0;
      for (let k = 0; k < n; k++) { const e = ifd1 + 2 + k * 12; if (e + 12 > len) break; const tag = u16(e); if (tag === 0x0201) at = u32(e + 8); if (tag === 0x0202) size = u32(e + 8); }
      if (at && size && at + size <= len) fields['Миниатюра'] = { value: 'есть — может показывать фото до обрезки', spans: [[abs(next0), abs(next0 + 4)], [abs(at), abs(at + size)]] };
    }
  }
  return { fields, orientation };
}
function analyzeJpeg(buf) {
  const segs = jpegSegments(buf); if (!segs) throw new Error('файл не похож на JPEG');
  const fields = {}; let orientation = null;
  for (const s of segs) {
    if (isExif(s)) {
      const ex = parseExif(s.data, s.start + 4);
      if (ex) {
        if (ex.orientation) orientation = ex.orientation;
        for (const [label, f] of Object.entries(ex.fields)) fields[uniq(fields, label)] = { value: f.value, remove: (b) => zero(b, f.spans) };
      }
    } else if (isXmp(s) && !fields.XMP) fields.XMP = { value: xmpSummary(s.data.toString('utf8')), remove: (b) => dropSegments(b, isXmp) };
    else if (s.m === 0xed && !fields.IPTC) fields.IPTC = { value: 'есть (подписи, авторство, место)', remove: (b) => dropSegments(b, (x) => x.m === 0xed) };
    else if (s.m === 0xfe && !fields['Комментарий']) fields['Комментарий'] = { value: short(s.data.toString('utf8').replace(/\0+$/, '')) || 'есть', remove: (b) => dropSegments(b, (x) => x.m === 0xfe) };
  }
  return { fields, orientation };
}
// Минимальный EXIF только с поворотом: без него фото с телефона после очистки легло бы набок
function tiffOrientation(orientation) {
  const t = Buffer.alloc(26);
  t.write('MM', 0, 'latin1'); t.writeUInt16BE(42, 2); t.writeUInt32BE(8, 4); t.writeUInt16BE(1, 8);
  t.writeUInt16BE(0x0112, 10); t.writeUInt16BE(3, 12); t.writeUInt32BE(1, 14); t.writeUInt16BE(orientation, 18); t.writeUInt32BE(0, 22);
  return t;
}
function minimalExif(orientation) {
  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiffOrientation(orientation)]);
  const head = Buffer.alloc(4); head.writeUInt16BE(0xffe1, 0); head.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([head, payload]);
}
function stripJpeg(buf) {
  const { orientation } = analyzeJpeg(buf);
  const out = dropSegments(buf, (s) => s.m === 0xe1 || s.m === 0xed || s.m === 0xfe || (s.m >= 0xe3 && s.m <= 0xef && s.m !== 0xee));
  if (!orientation || orientation < 2 || orientation > 8) return out;
  const segs = jpegSegments(out), at = segs[0] && segs[0].m === 0xe0 ? segs[0].end : 2;
  return Buffer.concat([out.subarray(0, at), minimalExif(orientation), out.subarray(at)]);
}

/* ---------- PNG ---------- */
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_META = ['tEXt', 'iTXt', 'zTXt', 'eXIf', 'tIME'];
function pngChunks(buf) {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIG)) return null;
  const out = []; let i = 8;
  while (i + 12 <= buf.length) {
    const len = buf.readUInt32BE(i), type = buf.toString('latin1', i + 4, i + 8);
    if (i + 12 + len > buf.length) return null;
    out.push({ type, start: i, end: i + 12 + len, data: buf.subarray(i + 8, i + 8 + len) });
    i += 12 + len;
    if (type === 'IEND') return out;
  }
  return null;
}
const rebuildPng = (buf, keep) => { const ch = pngChunks(buf); if (!ch) throw new Error('файл не похож на PNG'); return Buffer.concat([PNG_SIG, ...ch.filter(keep).map((c) => buf.subarray(c.start, c.end))]); };
function analyzePng(buf) {
  const ch = pngChunks(buf); if (!ch) throw new Error('файл не похож на PNG');
  const fields = {};
  ch.forEach((c, idx) => {
    if (!PNG_META.includes(c.type)) return;
    let label = c.type, value = 'есть';
    if (c.type === 'tEXt' || c.type === 'zTXt' || c.type === 'iTXt') {
      const z = c.data.indexOf(0), key = c.data.toString('latin1', 0, Math.max(0, z));
      label = key === 'XML:com.adobe.xmp' ? 'XMP' : key || c.type;
      try {
        if (c.type === 'tEXt') value = c.data.toString('latin1', z + 1);
        else if (c.type === 'zTXt') value = zlib.inflateSync(c.data.subarray(z + 2)).toString('latin1');
        else { const comp = c.data[z + 1]; let p = c.data.indexOf(0, z + 3) + 1; p = c.data.indexOf(0, p) + 1; const raw = c.data.subarray(p); value = (comp ? zlib.inflateSync(raw) : raw).toString('utf8'); }
      } catch (e) { value = 'есть'; }
      if (label === 'XMP') value = xmpSummary(value);
    } else if (c.type === 'eXIf') { label = 'EXIF'; value = 'есть (камера, дата, возможно место)'; }
    else if (c.type === 'tIME' && c.data.length >= 7) {
      const d = c.data, p2 = (n) => String(n).padStart(2, '0');
      label = 'Время изменения'; value = d.readUInt16BE(0) + '-' + p2(d[2]) + '-' + p2(d[3]) + ' ' + p2(d[4]) + ':' + p2(d[5]);
    }
    fields[uniq(fields, label)] = { value: short(value) || 'есть', remove: (b) => rebuildPng(b, (x, i) => i !== idx) };
  });
  return { fields };
}
const stripPng = (buf) => rebuildPng(buf, (c) => !PNG_META.includes(c.type));

/* ---------- HEIC, HEIF, AVIF: фото с iPhone и современных телефонов ---------- */
// Контейнер ISOBMFF: метаданные — отдельные «элементы» внутри коробки meta (Exif и XMP), на них указывает таблица iloc.
// Правка идёт на месте и не меняет размеров: картинка не сдвигается, поворот (свойство irot) не трогается.
function boxes(buf, from, to) {
  const out = []; let p = from;
  while (p + 8 <= to && out.length < 20000) {
    let size = buf.readUInt32BE(p), hdr = 8; const type = buf.toString('latin1', p + 4, p + 8);
    if (size === 1) { if (p + 16 > to) break; size = Number(buf.readBigUInt64BE(p + 8)); hdr = 16; } else if (size === 0) size = to - p;
    if (size < hdr || p + size > to) break;
    out.push({ type, start: p, end: p + size, body: p + hdr });
    p += size;
  }
  return out;
}
const HEIF_BRANDS = /heic|heix|hevc|hevx|heim|heis|mif1|msf1|avif|avis|mif2/;
function heifItems(buf) {
  const top = boxes(buf, 0, buf.length);
  if (!top.length || top[0].type !== 'ftyp' || !HEIF_BRANDS.test(buf.toString('latin1', top[0].body, top[0].end))) return null;
  const meta = top.find((b) => b.type === 'meta');
  if (!meta) return { items: [] };
  const kids = boxes(buf, meta.body + 4, meta.end);   // meta — «полная» коробка: сначала 4 байта версии и флагов
  const iinf = kids.find((b) => b.type === 'iinf'), iloc = kids.find((b) => b.type === 'iloc'), idat = kids.find((b) => b.type === 'idat');
  const info = new Map();
  if (iinf) {
    for (const e of boxes(buf, iinf.body + 4 + (buf[iinf.body] === 0 ? 2 : 4), iinf.end)) {
      if (e.type !== 'infe' || buf[e.body] < 2) continue;
      const v = buf[e.body]; let p = e.body + 4;
      const id = v === 2 ? buf.readUInt16BE(p) : buf.readUInt32BE(p); p += (v === 2 ? 2 : 4) + 2;
      const type = buf.toString('latin1', p, p + 4); p += 4;
      const z = buf.indexOf(0, p); p = z < 0 || z >= e.end ? e.end : z + 1;
      let mime = '';
      if (type === 'mime' && p < e.end) { const z2 = buf.indexOf(0, p); mime = buf.toString('latin1', p, z2 < 0 || z2 > e.end ? e.end : z2); }
      info.set(id, { type, mime });
    }
  }
  const items = [];
  if (iloc) {
    const v = buf[iloc.body]; let p = iloc.body + 4;
    const rd = (n) => { let x = 0; for (let k = 0; k < n; k++) x = x * 256 + buf[p + k]; p += n; return x; };
    const a = rd(1), b = rd(1), offSize = a >> 4, lenSize = a & 15, baseSize = b >> 4, idxSize = v === 1 || v === 2 ? b & 15 : 0;
    const count = v < 2 ? rd(2) : rd(4);
    for (let i = 0; i < count && p < iloc.end; i++) {
      const id = v < 2 ? rd(2) : rd(4), method = v === 1 || v === 2 ? rd(2) & 15 : 0;
      rd(2);
      const base = rd(baseSize), n = rd(2), ext = [];
      for (let k = 0; k < n && p <= iloc.end; k++) { if (idxSize) rd(idxSize); ext.push([rd(offSize), rd(lenSize)]); }
      const it = info.get(id);
      if (!it || (it.type !== 'Exif' && !(it.type === 'mime' && /xml|xmp/i.test(it.mime)))) continue;
      if (ext.length !== 1 || method > 1 || !ext[0][1] || (method === 1 && !idat)) continue;   // метаданные — всегда один кусок
      const start = (method === 1 ? idat.body : 0) + base + ext[0][0], end = start + ext[0][1];
      if (end <= buf.length) items.push({ kind: it.type === 'Exif' ? 'exif' : 'xmp', start, end });
    }
  }
  return { items };
}
// пустой, но правильный TIFF вместо EXIF: программы, которые ждут EXIF, не ломаются
const emptyTiff = (b, t) => { b.write('MM', t, 'latin1'); b.writeUInt16BE(42, t + 2); b.writeUInt32BE(8, t + 4); b.writeUInt16BE(0, t + 8); b.writeUInt32BE(0, t + 10); };
function analyzeHeif(buf) {
  const h = heifItems(buf); if (!h) throw new Error('файл не похож на HEIC, HEIF или AVIF');
  const fields = {};
  for (const it of h.items) {
    if (it.kind === 'exif' && it.end - it.start > 12) {
      const ex = parseExif(buf.subarray(it.start + 4, it.end), it.start + 4, buf.readUInt32BE(it.start));
      if (ex) for (const [label, f] of Object.entries(ex.fields)) fields[uniq(fields, label)] = { value: f.value, remove: (b) => zero(b, f.spans) };
    } else if (it.kind === 'xmp' && !fields.XMP) {
      const x = buf.toString('utf8', it.start, it.end);
      if (xmpHasData(x)) fields.XMP = { value: xmpSummary(x), remove: (b) => blankXmpIn(b, h.items.filter((y) => y.kind === 'xmp').map((y) => [y.start, y.end])) };
    }
  }
  return { fields };
}
function stripHeif(buf) {
  const h = heifItems(buf); if (!h) throw new Error('файл не похож на HEIC, HEIF или AVIF');
  let b = Buffer.from(buf);
  for (const it of h.items) {
    if (it.kind !== 'exif') continue;
    const t = it.start + 4 + (it.end - it.start >= 4 ? b.readUInt32BE(it.start) : 0);
    if (t + 14 <= it.end && /^(II|MM)$/.test(b.toString('latin1', t, t + 2))) { b.fill(0, t, it.end); emptyTiff(b, t); } else b.fill(0, it.start + 4, it.end);
  }
  const xmp = h.items.filter((y) => y.kind === 'xmp').map((y) => [y.start, y.end]);
  if (xmp.length) b = blankXmpIn(b, xmp);
  return b;
}

/* ---------- WebP ---------- */
// RIFF: метаданные в кусках EXIF и «XMP », их наличие отмечено флагами в куске VP8X
function webpChunks(buf) {
  if (buf.length < 12 || buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WEBP') return null;
  const out = [], end = Math.min(buf.length, 8 + buf.readUInt32LE(4)); let p = 12;
  while (p + 8 <= end) {
    const type = buf.toString('latin1', p, p + 4), size = buf.readUInt32LE(p + 4);
    if (p + 8 + size > buf.length) return null;
    out.push({ type, start: p, size, data: buf.subarray(p + 8, p + 8 + size) });
    p += 8 + size + (size & 1);
  }
  return out.some((c) => /^VP8[ LX]$/.test(c.type)) ? out : null;
}
function rebuildWebp(buf, keep, exif) {
  const ch = webpChunks(buf); if (!ch) throw new Error('файл не похож на WebP');
  const parts = []; let hasExif = false, hasXmp = false;
  const piece = (type, data) => { const h = Buffer.alloc(8); h.write(type, 0, 'latin1'); h.writeUInt32LE(data.length, 4); return Buffer.concat([h, data, data.length & 1 ? Buffer.alloc(1) : Buffer.alloc(0)]); };
  for (const c of ch) {
    if (!keep(c)) continue;
    let data = c.data;
    if (c.type === 'EXIF' && exif !== undefined) { if (!exif) continue; data = exif; }
    if (c.type === 'EXIF') hasExif = true;
    if (c.type === 'XMP ') hasXmp = true;
    parts.push(piece(c.type, data));
  }
  const x = parts.find((p) => p.toString('latin1', 0, 4) === 'VP8X');
  if (x) x[8] = (x[8] & ~0x0c) | (hasExif ? 0x08 : 0) | (hasXmp ? 0x04 : 0);
  const body = Buffer.concat([Buffer.from('WEBP', 'latin1'), ...parts]), head = Buffer.alloc(8);
  head.write('RIFF', 0, 'latin1'); head.writeUInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
}
const webpTiff = (c) => (c.data.toString('latin1', 0, 6) === 'Exif\0\0' ? 6 : 0);
function analyzeWebp(buf) {
  const ch = webpChunks(buf); if (!ch) throw new Error('файл не похож на WebP');
  const fields = {}; let orientation = null;
  for (const c of ch) {
    if (c.type === 'EXIF') {
      const ex = parseExif(c.data, c.start + 8, webpTiff(c));
      if (ex) { if (ex.orientation) orientation = ex.orientation; for (const [label, f] of Object.entries(ex.fields)) fields[uniq(fields, label)] = { value: f.value, remove: (b) => zero(b, f.spans) }; }
    } else if (c.type === 'XMP ' && !fields.XMP) fields.XMP = { value: xmpSummary(c.data.toString('utf8')), remove: (b) => rebuildWebp(b, (k) => k.type !== 'XMP ') };
  }
  return { fields, orientation };
}
function stripWebp(buf) {
  const { orientation } = analyzeWebp(buf);
  return rebuildWebp(buf, (c) => c.type !== 'XMP ', orientation >= 2 && orientation <= 8 ? tiffOrientation(orientation) : null);
}

/* ---------- MP3: теги ID3 ---------- */
// Диктофоны и программы записи оставляют в тегах имя устройства, программу, дату и даже место. Правка тега не трогает звук.
const syncsafe = (b, o) => ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f);
const toSyncsafe = (n) => Buffer.from([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f]);
const ID3N = { TIT2: 'Название', TIT3: 'Подзаголовок', TPE1: 'Исполнитель', TPE2: 'Исполнитель альбома', TALB: 'Альбом', TDRC: 'Дата записи', TYER: 'Год', TDAT: 'Дата', TIME: 'Время', TRDA: 'Дата записи',
  TDEN: 'Дата кодирования', TDTG: 'Дата тегов', TSSE: 'Программа записи', TENC: 'Кем закодировано', TCOM: 'Композитор', TEXT: 'Автор текста', TOWN: 'Владелец', TCOP: 'Права', TPUB: 'Издатель',
  TCON: 'Жанр', TOFN: 'Исходное имя файла', TLAN: 'Язык', COMM: 'Комментарий', USLT: 'Текст', APIC: 'Обложка', GEOB: 'Вложенный объект', PRIV: 'Служебные данные', UFID: 'Идентификатор файла',
  TXXX: 'Своё поле', WXXX: 'Ссылка', WOAR: 'Ссылка на автора', WOAS: 'Ссылка на источник' };
const cp1251 = new TextDecoder('windows-1251');
function id3Text(enc, b) {
  let s;
  if (enc === 1 || enc === 2) {
    let d = b, le = enc === 1;
    if (enc === 1 && d.length >= 2 && d[0] === 0xfe && d[1] === 0xff) { le = false; d = d.subarray(2); } else if (enc === 1 && d.length >= 2 && d[0] === 0xff && d[1] === 0xfe) d = d.subarray(2);
    d = Buffer.from(d.subarray(0, d.length - (d.length & 1)));
    if (!le) d.swap16();
    s = d.toString('utf16le');
  } else if (enc === 3) s = b.toString('utf8');
  else s = /[\x80-\xff]/.test(b.toString('latin1')) ? cp1251.decode(b) : b.toString('latin1');   // по стандарту Latin-1, но русские программы писали cp1251
  return s.replace(/\0+$/, '').replace(/\0/g, ' / ').trim();
}
function id3Head(buf) {
  if (buf.length < 10 || buf.toString('latin1', 0, 3) !== 'ID3' || buf[3] > 4) return null;
  const size = syncsafe(buf, 6), tagEnd = 10 + size, end = tagEnd + (buf[5] & 0x10 ? 10 : 0);
  return end <= buf.length ? { ver: buf[3], flags: buf[5], tagEnd, end } : null;
}
function id3Frames(buf, t) {
  if (t.ver < 3 || (t.flags & 0x80)) return null;   // ID3v2.2 и «несинхронизированные» теги — только целиком
  const out = []; let p = 10;
  if (t.flags & 0x40) p += t.ver === 4 ? syncsafe(buf, 10) : 4 + buf.readUInt32BE(10);
  while (p + 10 <= t.tagEnd) {
    const id = buf.toString('latin1', p, p + 4);
    if (!/^[A-Z0-9]{4}$/.test(id)) break;   // дальше — пустое место
    const size = t.ver === 4 ? syncsafe(buf, p + 4) : buf.readUInt32BE(p + 4);
    if (size < 1 || p + 10 + size > t.tagEnd) break;
    out.push({ id, start: p, end: p + 10 + size, data: buf.subarray(p + 10, p + 10 + size), packed: (buf.readUInt16BE(p + 8) & (t.ver === 4 ? 0x000d : 0x00c0)) !== 0 });
    p += 10 + size;
  }
  return out;
}
function id3Value(f) {
  const d = f.data, enc = d[0];
  if (f.packed) return 'есть';
  if (f.id === 'TXXX') { const z = enc === 1 || enc === 2 ? zeroPair(d, 1) : d.indexOf(0, 1); return z > 0 ? id3Text(enc, d.subarray(z + (enc === 1 || enc === 2 ? 2 : 1))) : id3Text(enc, d.subarray(1)); }
  if (f.id[0] === 'T') return id3Text(enc, d.subarray(1));
  if (f.id === 'COMM' || f.id === 'USLT') { const z = enc === 1 || enc === 2 ? zeroPair(d, 4) : d.indexOf(0, 4); return z > 0 ? id3Text(enc, d.subarray(z + (enc === 1 || enc === 2 ? 2 : 1))) : 'есть'; }
  if (f.id === 'WXXX') { const z = enc === 1 || enc === 2 ? zeroPair(d, 1) : d.indexOf(0, 1); return z > 0 ? d.toString('latin1', z + (enc === 1 || enc === 2 ? 2 : 1)).replace(/\0/g, '').trim() : 'есть'; }
  if (f.id[0] === 'W') return d.toString('latin1').replace(/\0/g, '').trim();
  if (f.id === 'APIC') return 'есть (картинка)';
  if (f.id === 'PRIV') { const z = d.indexOf(0); return 'есть' + (z > 0 ? ' (' + short(d.toString('latin1', 0, Math.min(z, 60))) + ')' : ''); }
  return 'есть';
}
// конец строки в UTF-16 — два нулевых байта на чётной позиции
function zeroPair(d, from) { for (let i = from; i + 1 < d.length; i += 2) if (d[i] === 0 && d[i + 1] === 0) return i; return -1; }
// тег без некоторых кадров, того же размера (остаток — пустое место): звук не сдвигается
function id3Without(buf, t, drop) {
  const frames = id3Frames(buf, t), kept = frames.filter((f) => !drop(f)).map((f) => buf.subarray(f.start, f.end)), body = Buffer.concat(kept);
  const size = t.end - 10, head = Buffer.from([0x49, 0x44, 0x33, t.ver, 0, 0]);
  const tag = Buffer.concat([head, toSyncsafe(size), body, Buffer.alloc(size - body.length)]);
  return Buffer.concat([tag, buf.subarray(t.end)]);
}
const id3v1 = (b) => b.length >= 128 && b.toString('latin1', b.length - 128, b.length - 125) === 'TAG';
function analyzeMp3(buf) {
  const t = id3Head(buf);
  if (!t && !mpegSync(buf, 0, 4096)) throw new Error('файл не похож на MP3');
  const fields = {};
  if (t) {
    const frames = id3Frames(buf, t);
    if (!frames) fields['Тег ID3'] = { value: 'есть (старый формат — удаляется только целиком)', remove: (b) => b.subarray(id3Head(b).end) };
    else frames.forEach((f) => {
      const v = id3Value(f); if (!v) return;
      const desc = f.id === 'TXXX' && !f.packed ? txxxDesc(f.data) : '';
      fields[uniq(fields, (ID3N[f.id] || 'Тег ' + f.id) + (desc ? ' «' + desc.slice(0, 30) + '»' : ''))] = { value: short(v), remove: (b) => id3Without(b, id3Head(b), (x) => x.start === f.start) };
    });
  }
  if (id3v1(buf)) {
    const s = buf.subarray(buf.length - 125), txt = (a, z) => { const raw = s.subarray(a, z), n = raw.indexOf(0); return id3Text(0, n < 0 ? raw : raw.subarray(0, n)); };
    const v = [txt(0, 30), txt(30, 60), txt(60, 90), txt(90, 94), txt(94, 124)].filter(Boolean).join(' · ');
    fields[uniq(fields, 'Старый тег ID3v1')] = { value: short(v) || 'есть', remove: (b) => (id3v1(b) ? b.subarray(0, b.length - 128) : b) };
  }
  return { fields };
}
function txxxDesc(d) { const enc = d[0], wide = enc === 1 || enc === 2, z = wide ? zeroPair(d, 1) : d.indexOf(0, 1); return z > 1 ? id3Text(enc, d.subarray(1, z)) : ''; }
// начало звука MPEG: байт 0xFF и следом три старших бита в единицах
function mpegSync(b, from, to) { for (let i = from; i + 1 < Math.min(b.length, to); i++) if (b[i] === 0xff && (b[i + 1] & 0xe0) === 0xe0) return true; return false; }
function stripMp3(buf) {
  const t = id3Head(buf); let b = t ? buf.subarray(t.end) : buf;
  if (id3v1(b)) b = b.subarray(0, b.length - 128);
  return Buffer.from(b);
}

/* ---------- FLAC ---------- */
// Блоки метаданных перед звуком: комментарии Vorbis (название, программа, место…), обложка, данные программ.
// Удалённый блок превращается в «пустое место» (PADDING) того же размера: звук не сдвигается.
const VORBIS = { TITLE: 'Название', ARTIST: 'Исполнитель', PERFORMER: 'Исполнитель', ALBUM: 'Альбом', DATE: 'Дата', COMMENT: 'Комментарий', DESCRIPTION: 'Описание', ENCODER: 'Программа',
  ENCODED_BY: 'Кем закодировано', LOCATION: 'Место', GENRE: 'Жанр', ORGANIZATION: 'Организация', CONTACT: 'Контакты', COPYRIGHT: 'Права', COMPOSER: 'Композитор' };
function flacBlocks(buf) {
  let p = 0; const pre = id3Head(buf); if (pre) p = pre.end;
  if (buf.toString('latin1', p, p + 4) !== 'fLaC') return null;
  const out = []; p += 4;
  for (let n = 0; n < 1000 && p + 4 <= buf.length; n++) {
    const hb = buf[p], len = buf.readUIntBE(p + 1, 3);
    if (p + 4 + len > buf.length) return null;
    out.push({ type: hb & 0x7f, start: p, end: p + 4 + len, body: p + 4 });
    p += 4 + len;
    if (hb & 0x80) break;
  }
  return out.length && out[0].type === 0 ? out : null;
}
const toPadding = (b, blk) => { b[blk.start] = (b[blk.start] & 0x80) | 1; b.fill(0, blk.body, blk.end); };
const spaces = (a, z) => (b) => { const c = Buffer.from(b); c.fill(0x20, a, z); return c; };
function analyzeFlac(buf) {
  const bl = flacBlocks(buf); if (!bl) throw new Error('файл не похож на FLAC');
  const fields = {};
  if (id3Head(buf)) fields['Тег ID3'] = { value: 'есть (нестандартный тег перед звуком)', remove: (b) => Buffer.from(b.subarray(id3Head(b).end)) };
  for (const blk of bl) {
    if (blk.type === 4 && blk.end - blk.body >= 8) {
      let p = blk.body; const vl = buf.readUInt32LE(p); p += 4;
      if (p + vl > blk.end) continue;
      const vendor = buf.toString('utf8', p, p + vl).trim();
      if (vendor) fields[uniq(fields, 'Программа записи')] = { value: short(vendor), remove: spaces(p, p + vl) };
      p += vl;
      const n = p + 4 <= blk.end ? buf.readUInt32LE(p) : 0; p += 4;
      for (let k = 0; k < n && p + 4 <= blk.end; k++) {
        const l = buf.readUInt32LE(p); p += 4;
        if (p + l > blk.end) break;
        const raw = buf.subarray(p, p + l), eq = raw.indexOf(0x3d);
        const key = eq > 0 ? raw.toString('utf8', 0, eq).toUpperCase() : '', val = eq > 0 ? raw.toString('utf8', eq + 1).trim() : '';
        if (key && val) fields[uniq(fields, VORBIS[key] || 'Тег ' + key)] = { value: short(val), remove: spaces(p + eq + 1, p + l) };
        p += l;
      }
    } else if (blk.type === 6) fields[uniq(fields, 'Обложка')] = { value: 'есть (картинка)', remove: (b) => { const c = Buffer.from(b); toPadding(c, blk); return c; } };
    else if (blk.type === 2) fields[uniq(fields, 'Данные программы')] = { value: 'есть (' + buf.toString('latin1', blk.body, blk.body + 4).replace(/[^\x20-\x7e]/g, '?') + ')', remove: (b) => { const c = Buffer.from(b); toPadding(c, blk); return c; } };
  }
  return { fields };
}
function stripFlac(buf) {
  const bl = flacBlocks(buf); if (!bl) throw new Error('файл не похож на FLAC');
  const c = Buffer.from(buf);
  for (const blk of bl) if (blk.type === 4 || blk.type === 6 || blk.type === 2) toPadding(c, blk);
  const pre = id3Head(c);
  return pre ? Buffer.from(c.subarray(pre.end)) : c;
}

/* ---------- Office: DOCX, XLSX, PPTX ---------- */
const CORE = { 'dc:creator': 'Автор', 'cp:lastModifiedBy': 'Последний редактор', 'dc:title': 'Заголовок', 'dc:subject': 'Тема', 'cp:keywords': 'Ключевые слова', 'dc:description': 'Комментарий', 'cp:category': 'Категория', 'cp:lastPrinted': 'Последняя печать', 'dcterms:created': 'Создан', 'dcterms:modified': 'Изменён' };
const APP = { Company: 'Организация', Manager: 'Руководитель', Template: 'Шаблон' };
// Даты создания и правки выдают распорядок автора — вместо них ставится нейтральная дата
const NEUTRAL = '2000-01-01T00:00:00Z';
const tagRe = (t, g) => new RegExp('<' + t + '(\\s[^>]*)?>([\\s\\S]*?)</' + t + '>', g ? 'g' : '');
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const zipOut = (z) => z.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
const PEOPLE_PART = /^(word|xl|ppt)\/.*\.xml$/;
// Где Office хранит имена людей: авторы правок и комментариев, «люди» документа, их почта в userId
const PEOPLE = [
  [/(\s(?:w|w15):author=")([^"]*)(")/g, 'Автор'],
  [/(\sw:initials=")([^"]*)(")/g, 'А'],
  [/(\sw15:userId=")([^"]*)(")/g, ''],
  [/(<author>)([^<]*)(<\/author>)/g, 'Автор'],
  [/(\sdisplayName=")([^"]*)(")/g, 'Автор'],
  [/(\suserId=")([^"]*)(")/g, ''],
  [/(<p:cmAuthor\b[^>]*\sname=")([^"]*)(")/g, 'Автор'],
  [/(<p188:author\b[^>]*\sname=")([^"]*)(")/g, 'Автор'],
];
const PEOPLE_SHOW = [/\s(?:w|w15):author="([^"]+)"/g, /<author>([^<]+)<\/author>/g, /\sdisplayName="([^"]+)"/g, /<p:cmAuthor\b[^>]*\sname="([^"]+)"/g, /<p188:author\b[^>]*\sname="([^"]+)"/g];
const peopleParts = (zip) => Object.keys(zip.files).filter((n) => PEOPLE_PART.test(n) && !zip.files[n].dir);

async function blankCore(zip, tags) {
  const core = zip.file('docProps/core.xml'); if (!core) return;
  let x = await core.async('string');
  for (const t of tags) x = x.replace(tagRe(t), '<' + t + '$1>' + (/^dcterms:/.test(t) ? NEUTRAL : '') + '</' + t + '>');
  zip.file('docProps/core.xml', x);
}
async function blankApp(zip, tags) {
  const app = zip.file('docProps/app.xml'); if (!app) return;
  let x = await app.async('string');
  for (const t of tags) x = x.replace(tagRe(t), '<' + t + '$1></' + t + '>');
  zip.file('docProps/app.xml', x);
}
async function blankCustom(zip, name) {
  const c = zip.file('docProps/custom.xml'); if (!c) return;
  let x = await c.async('string');
  const who = name == null ? '[^"]*' : reEsc(name);
  x = x.replace(new RegExp('(<property\\b[^>]*\\bname="' + who + '"[^>]*>\\s*<vt:\\w+>)([\\s\\S]*?)(</vt:\\w+>)', 'g'), '$1$3');
  zip.file('docProps/custom.xml', x);
}
async function anonPeople(zip) {
  for (const n of peopleParts(zip)) {
    const x = await zip.file(n).async('string');
    let y = x; for (const [re, rep] of PEOPLE) y = y.replace(re, (m, a, v, z) => a + rep + z);
    if (y !== x) zip.file(n, y);
  }
}
async function analyzeOffice(buf) {
  const zip = await JSZip.loadAsync(buf);
  if (!zip.file('[Content_Types].xml')) throw new Error('файл не похож на документ Office');
  const fields = {};
  const edit = (fn) => async (b) => { const z = await JSZip.loadAsync(b); await fn(z); return zipOut(z); };
  const core = zip.file('docProps/core.xml'), app = zip.file('docProps/app.xml'), custom = zip.file('docProps/custom.xml');
  if (core) {
    const x = await core.async('string');
    for (const [t, n] of Object.entries(CORE)) { const m = x.match(tagRe(t)); const v = m && m[2].trim(); if (v && v !== NEUTRAL) fields[n] = { value: short(v), remove: edit((z) => blankCore(z, [t])) }; }
  }
  if (app) {
    const x = await app.async('string');
    for (const [t, n] of Object.entries(APP)) { const m = x.match(tagRe(t)); const v = m && m[2].trim(); if (v) fields[n] = { value: short(v), remove: edit((z) => blankApp(z, [t])) }; }
  }
  if (custom) {
    const x = await custom.async('string');
    for (const p of x.matchAll(/<property\b[^>]*\bname="([^"]*)"[^>]*>([\s\S]*?)<\/property>/g)) {
      const v = p[2].replace(/<[^>]+>/g, '').trim();
      if (v) fields[uniq(fields, 'Своё поле «' + p[1] + '»')] = { value: short(v), remove: edit((z) => blankCustom(z, p[1])) };
    }
  }
  const names = new Set();
  for (const n of peopleParts(zip)) {
    if (zip.files[n]._data && zip.files[n]._data.uncompressedSize > 40 * 1024 * 1024) continue;
    const x = await zip.file(n).async('string');
    for (const re of PEOPLE_SHOW) for (const m of x.matchAll(re)) if (m[1].trim() && m[1] !== 'Автор') names.add(m[1].trim());
  }
  if (names.size) fields['Авторы правок и комментариев'] = { value: short([...names].slice(0, 6).join(', ')), remove: edit(anonPeople) };
  return { fields };
}
async function stripOffice(buf) {
  const zip = await JSZip.loadAsync(buf);
  await blankCore(zip, Object.keys(CORE)); await blankApp(zip, Object.keys(APP)); await blankCustom(zip, null); await anonPeople(zip);
  return zipOut(zip);
}

/* ---------- PDF ---------- */
const PDF_KEYS = { Author: 'Автор', Creator: 'Программа', Producer: 'Создано в', Title: 'Заголовок', Subject: 'Тема', Keywords: 'Ключевые слова', CreationDate: 'Создан', ModDate: 'Изменён' };
// Словари свойств документа (/Info из трейлера): только в них ищем автора и даты, чтобы не задеть закладки и аннотации
function pdfInfoRanges(s) {
  const ids = new Set(), out = [];
  for (const m of s.matchAll(/\/Info\s+(\d+)\s+(\d+)\s+R/g)) ids.add(m[1] + '\\s+' + m[2]);
  for (const id of ids) {
    const re = new RegExp('(?:^|[^\\d])' + id + '\\s+obj\\b', 'g'); let m;
    while ((m = re.exec(s))) {
      const st = s.indexOf('<<', m.index); if (st < 0 || st - m.index > 40) continue;
      let depth = 0, i = st;
      for (; i < s.length - 1; i++) {
        const c = s[i];
        if (c === '(') { let d = 0; for (; i < s.length; i++) { if (s[i] === '\\') { i++; continue; } if (s[i] === '(') d++; else if (s[i] === ')' && --d === 0) break; } continue; }
        if (c === '<' && s[i + 1] === '<') { depth++; i++; continue; }
        if (c === '>' && s[i + 1] === '>') { depth--; i++; if (depth === 0) break; }
      }
      out.push([st, i + 1]);
    }
  }
  return out;
}
// Все строки после /Ключ: литералы (…) с учётом вложенных скобок и экранирования, и шестнадцатеричные <…>
function pdfStrings(s, key, from = 0, to = s.length) {
  const out = [], re = new RegExp('/' + key + '(?=[\\s(<])', 'g'); let m;
  re.lastIndex = from;
  while ((m = re.exec(s)) && m.index < to) {
    let i = m.index + key.length + 1; while (i < s.length && /\s/.test(s[i])) i++;
    if (s[i] === '(') {
      let depth = 0, j = i;
      for (; j < s.length; j++) { const c = s[j]; if (c === '\\') { j++; continue; } if (c === '(') depth++; else if (c === ')' && --depth === 0) break; }
      if (j < s.length) out.push({ a: i + 1, b: j, hex: false });
    } else if (s[i] === '<' && s[i + 1] !== '<') { const j = s.indexOf('>', i); if (j > 0) out.push({ a: i + 1, b: j, hex: true }); }
  }
  return out;
}
function pdfDecode(s, sp) {
  let bytes;
  if (sp.hex) { const hx = s.slice(sp.a, sp.b).replace(/[^0-9a-fA-F]/g, ''); bytes = Buffer.from(hx.length % 2 ? hx + '0' : hx, 'hex'); }
  else {
    const raw = s.slice(sp.a, sp.b), arr = [];
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i];
      if (c !== '\\') { arr.push(c.charCodeAt(0) & 255); continue; }
      const n = raw[++i];
      if (n === undefined) break;
      const esc = { n: 10, r: 13, t: 9, b: 8, f: 12 }[n];
      if (esc !== undefined) arr.push(esc);
      else if (/[0-7]/.test(n)) { let o = n; while (o.length < 3 && /[0-7]/.test(raw[i + 1])) o += raw[++i]; arr.push(parseInt(o, 8) & 255); }
      else if (n === '\r' || n === '\n') { if (n === '\r' && raw[i + 1] === '\n') i++; }
      else arr.push(n.charCodeAt(0) & 255);
    }
    bytes = Buffer.from(arr);
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) { const b = Buffer.from(bytes.subarray(2, 2 + ((bytes.length - 2) & ~1))); b.swap16(); return b.toString('utf16le'); }
  return bytes.toString('latin1');
}
const pdfDate = (v) => { const m = /^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?/.exec(v); return m ? m[1] + '-' + (m[2] || '01') + '-' + (m[3] || '01') + (m[4] ? ' ' + m[4] + ':' + (m[5] || '00') : '') : v; };
function xmpRanges(s) {
  const out = []; const re = /<x:x[am]pmeta\b/g; let m;
  while ((m = re.exec(s))) { const close = '</x:' + s.slice(m.index + 3, m.index + 10) + '>', end = s.indexOf(close, m.index); if (end > 0) out.push([m.index, end + close.length]); }
  return out;
}
function blankPdf(buf, spans) {
  const b = Buffer.from(buf);
  for (const sp of spans) {
    if (!sp.hex) { b.fill(0x20, sp.a, sp.b); continue; }
    let k = 0; for (let i = sp.a; i < sp.b; i++) if (/[0-9a-fA-F]/.test(String.fromCharCode(b[i]))) b[i] = (k++ % 2 ? 0x30 : 0x32); // «20» — пробел
  }
  return b;
}
function blankXmpIn(buf, ranges) {
  const b = Buffer.from(buf);
  for (const [a, z] of ranges) { const seg = b.toString('latin1', a, z); b.write(blankXmpText(seg), a, 'latin1'); }
  return b;
}
function analyzePdf(buf) {
  if (buf.toString('latin1', 0, 5) !== '%PDF-') throw new Error('файл не похож на PDF');
  const s = buf.toString('latin1'), fields = {};
  if (/\/Encrypt\b/.test(s)) return { fields, note: 'PDF зашифрован: его свойства читаются только с паролем, приложение их не трогает.' };
  const info = pdfInfoRanges(s);
  for (const [key, label] of Object.entries(PDF_KEYS)) {
    const spans = info.flatMap(([a, z]) => pdfStrings(s, key, a, z)); if (!spans.length) continue;
    const values = [...new Set(spans.map((sp) => pdfDecode(s, sp).replace(/\0/g, '').trim()).filter(Boolean))];
    if (!values.length) continue;
    fields[label] = { value: short((/Date$/.test(key) ? values.map(pdfDate) : values).join(' · ')), remove: (b) => blankPdf(b, spans) };
  }
  const xmp = xmpRanges(s).filter(([a, z]) => xmpHasData(s.slice(a, z)));
  if (xmp.length) fields.XMP = { value: xmpSummary(Buffer.from(s.slice(xmp[0][0], xmp[0][1]), 'latin1').toString('utf8')), remove: (b) => blankXmpIn(b, xmp) };
  const note = /\/ObjStm\b/.test(s) && !info.length ? 'Часть структуры PDF сжата: некоторые свойства могут быть скрыты от проверки.' : null;
  return { fields, note };
}
function stripPdf(buf) {
  const s = buf.toString('latin1');
  if (/\/Encrypt\b/.test(s)) throw new Error('PDF зашифрован');
  const info = pdfInfoRanges(s);
  let b = blankPdf(buf, Object.keys(PDF_KEYS).flatMap((k) => info.flatMap(([a, z]) => pdfStrings(s, k, a, z))));
  const xmp = xmpRanges(s); if (xmp.length) b = blankXmpIn(b, xmp);
  return b;
}

/* ---------- Видео: MP4, MOV, M4V, 3GP ---------- */
// Телефоны пишут место съёмки в заголовок видео (атом moov). Правка идёт на месте и не меняет размер файла.
const QT = { '©xyz': 'GPS', '©mak': 'Производитель', '©mod': 'Модель', '©swr': 'Программа', '©day': 'Дата съёмки', '©ART': 'Автор', '©cmt': 'Комментарий' };
const MDTA = { 'com.apple.quicktime.location.ISO6709': 'GPS', 'com.apple.quicktime.make': 'Производитель', 'com.apple.quicktime.model': 'Модель', 'com.apple.quicktime.software': 'Программа', 'com.apple.quicktime.creationdate': 'Дата съёмки', 'com.android.version': 'Версия Android' };
const ISO6709 = /[+-]\d{2}\.\d{2,}[+-]\d{3}\.\d{2,}(?:[+-]\d+(?:\.\d+)?)?(?:CRS[^/]{0,40})?\//g;
const geo = (v) => { const m = /([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)/.exec(v); return m ? Number(m[1]).toFixed(5) + ', ' + Number(m[2]).toFixed(5) : v; };
function topAtoms(fd, size) {
  const out = [], h = Buffer.alloc(16); let pos = 0;
  while (pos + 8 <= size && out.length < 4000) {
    fs.readSync(fd, h, 0, 16, pos);
    let len = h.readUInt32BE(0), hdr = 8; const type = h.toString('latin1', 4, 8);
    if (len === 1) { len = Number(h.readBigUInt64BE(8)); hdr = 16; } else if (len === 0) len = size - pos;
    if (len < hdr || pos + len > size) break;
    out.push({ type, pos, len }); pos += len;
  }
  return out;
}
function videoFields(buf) {
  const fields = {}, covered = [];
  const add = (label, value, act, range) => {
    if (range) covered.push(range);
    if (fields[label]) { const prev = fields[label]; prev.acts.push(act); if (value && !prev.value.includes(value)) prev.value = short(prev.value + ' · ' + value); return; }
    fields[label] = { value: short(value) || 'есть', acts: [act] };
  };
  // классические атомы QuickTime/iTunes: ©xyz, ©mak, ©mod …
  for (const [type, label] of Object.entries(QT)) {
    const pat = Buffer.from(type, 'latin1'); let i = buf.indexOf(pat, 4);
    while (i > 3) {
      const at = i, start = i - 4, size = buf.readUInt32BE(start);
      if (size >= 12 && start + size <= buf.length) {
        let value;
        if (buf.toString('latin1', start + 12, start + 16) === 'data') value = buf.toString('utf8', start + 24, start + size);
        else { const tl = buf.readUInt16BE(start + 8); value = buf.toString('utf8', start + 12, Math.min(start + size, start + 12 + tl)); }
        value = value.replace(/\0/g, '').trim();
        // атом превращается в «пустое место» (free) того же размера: плееры его пропускают
        if (value) add(label, label === 'GPS' ? geo(value) : value, (b) => { b.write('free', at, 'latin1'); b.fill(0, start + 8, start + size); }, [start, start + size]);
      }
      i = buf.indexOf(pat, i + 4);
    }
  }
  // ключи Apple (mdta) в паре keys + ilst
  const k = buf.indexOf(Buffer.from('keys', 'latin1'));
  if (k > 3 && k + 12 <= buf.length && buf.readUInt32BE(k + 4) === 0) {
    const count = buf.readUInt32BE(k + 8), names = {}; let p = k + 12;
    for (let n = 1; n <= count && n < 500 && p + 8 <= buf.length; n++) { const ks = buf.readUInt32BE(p); if (ks < 8) break; names[n] = buf.toString('latin1', p + 8, p + ks); p += ks; }
    const il = buf.indexOf(Buffer.from('ilst', 'latin1'), k);
    if (il > 3) {
      const end = Math.min(buf.length, il - 4 + buf.readUInt32BE(il - 4)); let c = il + 4;
      while (c + 24 <= end) {
        const cs = buf.readUInt32BE(c), idx = buf.readUInt32BE(c + 4);
        if (cs < 8 || c + cs > end) break;
        if (MDTA[names[idx]] && buf.toString('latin1', c + 12, c + 16) === 'data') {
          const ds = buf.readUInt32BE(c + 8), va = c + 24, vz = Math.min(c + 8 + ds, c + cs);
          const value = buf.toString('utf8', va, vz).replace(/\0/g, '').trim(), label = MDTA[names[idx]];
          if (value) add(label, label === 'GPS' ? geo(value) : value, (b) => b.fill(0x20, va, vz), [va, vz]);
        }
        c += cs;
      }
    }
  }
  // запасной поиск координат в формате ISO 6709 по всему заголовку
  const s = buf.toString('latin1'); let m; ISO6709.lastIndex = 0;
  while ((m = ISO6709.exec(s))) {
    const a = m.index, z = a + m[0].length;
    if (covered.some(([x, y]) => a >= x && z <= y)) continue;
    add('GPS', geo(m[0]), (b) => b.fill(0x20, a, z), [a, z]);
  }
  return fields;
}
/* ---------- M4A: аудио в том же контейнере, что и видео ---------- */
// Теги iTunes (moov → udta → meta → ilst): название записи — у диктофона iPhone это часто адрес, где записывали, — программа, дата.
const ILST = { '©nam': 'Название', '©too': 'Программа записи', '©ART': 'Исполнитель', aART: 'Исполнитель альбома', '©alb': 'Альбом', '©day': 'Дата', '©cmt': 'Комментарий', '©gen': 'Жанр',
  '©wrt': 'Автор', '©enc': 'Кем закодировано', '©grp': 'Группа', '©lyr': 'Текст', desc: 'Описание', ldes: 'Описание', cprt: 'Права', covr: 'Обложка' };
function ilstItems(buf) {
  const out = [];
  for (const u of boxes(buf, 8, buf.length).filter((b) => b.type === 'udta')) {
    for (const m of boxes(buf, u.body, u.end).filter((b) => b.type === 'meta')) {
      // meta у iTunes — «полная» коробка (4 байта версии), у QuickTime — обычная: пробуем оба варианта
      const il = boxes(buf, m.body + 4, m.end).find((b) => b.type === 'ilst') || boxes(buf, m.body, m.end).find((b) => b.type === 'ilst');
      if (!il) continue;
      for (const it of boxes(buf, il.body, il.end)) {
        const kids = boxes(buf, it.body, it.end), data = kids.find((b) => b.type === 'data');
        if (!data || data.end - data.body < 8) continue;
        let label = ILST[it.type];
        if (it.type === '----') { const nm = kids.find((b) => b.type === 'name'); label = 'Служебные данные' + (nm ? ' (' + buf.toString('utf8', nm.body + 4, nm.end).slice(0, 30) + ')' : ''); }
        if (!label) continue;
        const kind = buf.readUInt32BE(data.body) & 0xffffff, va = data.body + 8, vz = data.end;
        const text = kind === 1 ? buf.toString('utf8', va, vz) : kind === 2 ? buf.toString('utf16le', va, vz) : '';
        out.push({ label, item: it, va, vz, text: text.replace(/\0/g, '').trim(), binary: kind !== 1 && kind !== 2 });
      }
    }
  }
  return out;
}
function audioFields(buf) {
  const fields = videoFields(buf);   // место (©xyz, ISO 6709), модель и программа — как у видео
  for (const x of ilstItems(buf)) {
    if (QT[x.item.type] && fields[QT[x.item.type]]) continue;   // уже найдено как у видео
    const act = x.binary ? (b) => { b.write('free', x.item.start + 4, 'latin1'); b.fill(0, x.item.start + 8, x.item.end); } : (b) => b.fill(0x20, x.va, x.vz);
    const value = x.binary ? (x.item.type === 'covr' ? 'есть (картинка)' : 'есть') : x.text;
    if (!value) continue;
    const label = uniq(fields, x.label);
    fields[label] = { value: short(value), acts: [act] };
  }
  return fields;
}
function readVideo(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size, moov = topAtoms(fd, size).find((a) => a.type === 'moov');
    if (!moov) throw new Error('не нашёл заголовок файла (moov) — файл повреждён или это другой формат');
    if (moov.len > 128 * 1024 * 1024) throw new Error('заголовок файла слишком большой');
    const buf = Buffer.alloc(moov.len); fs.readSync(fd, buf, 0, moov.len, moov.pos);
    return { size, moov, buf };
  } finally { fs.closeSync(fd); }
}
function writeVideo(file, moov, buf) {
  const fd = fs.openSync(file, 'r+');
  try { fs.writeSync(fd, buf, 0, buf.length, moov.pos); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

/* ---------- общий вход ---------- */
const KIND = { '.jpg': 'jpeg', '.jpeg': 'jpeg', '.jfif': 'jpeg', '.png': 'png', '.heic': 'heif', '.heif': 'heif', '.hif': 'heif', '.avif': 'heif', '.webp': 'webp',
  '.pdf': 'pdf', '.docx': 'office', '.xlsx': 'office', '.pptx': 'office', '.mp4': 'video', '.mov': 'video', '.m4v': 'video', '.3gp': 'video',
  '.mp3': 'mp3', '.m4a': 'm4a', '.m4b': 'm4a', '.flac': 'flac' };
const kindOf = (f) => KIND[path.extname(f).toLowerCase()] || null;
const ANALYZE = { jpeg: analyzeJpeg, png: analyzePng, heif: analyzeHeif, webp: analyzeWebp, pdf: analyzePdf, office: analyzeOffice, mp3: analyzeMp3, flac: analyzeFlac };
const STRIP = { jpeg: stripJpeg, png: stripPng, heif: stripHeif, webp: stripWebp, pdf: stripPdf, office: stripOffice, mp3: stripMp3, flac: stripFlac };

async function analyzeFile(f) {
  const kind = kindOf(f);
  if (!kind) throw new Error('этот формат пока не поддерживается (' + SUPPORTED + ')');
  // видео и M4A правятся на месте: читается и переписывается только заголовок moov
  if (kind === 'video' || kind === 'm4a') { const v = readVideo(f), fields = kind === 'm4a' ? audioFields(v.buf) : videoFields(v.buf); return { kind, size: v.size, fields, video: v }; }
  const size = fs.statSync(f).size;
  if (size > MAX) throw new Error('файл больше 300 МБ');
  const buf = fs.readFileSync(f), r = await ANALYZE[kind](buf);
  return { kind, size, buf, fields: r.fields, note: r.note || null };
}
const view = (f, a) => ({
  file: f, name: path.basename(f), kind: a.kind, size: a.size, note: a.note || null,
  found: Object.fromEntries(Object.entries(a.fields).map(([k, v]) => [k, v.value])), removable: Object.keys(a.fields),
});
// Новый файл сначала пишется рядом и проверяется разбором, потом подменяет оригинал (дата изменения сохраняется)
async function writeChecked(file, kind, buf, target) {
  await ANALYZE[kind](buf);
  const dest = target || file, tmp = dest + '.kx-' + crypto.randomBytes(4).toString('hex');
  const st = fs.statSync(file);
  fs.writeFileSync(tmp, buf);
  try { if (!target) fs.chmodSync(file, 0o666); fs.renameSync(tmp, dest); } catch (e) { fs.rmSync(tmp, { force: true }); throw e; }
  try { fs.utimesSync(dest, st.atime, st.mtime); } catch (e) { /* даты не критичны */ }
}

async function inspect(files) {
  const out = [];
  for (const f of files.slice(0, 50)) {
    try { out.push(view(f, await analyzeFile(f))); } catch (e) { out.push({ file: f, name: path.basename(f), kind: kindOf(f), error: e.message }); }
  }
  return out;
}
// Удаление всех метаданных из самого файла
async function strip(files) {
  const out = [];
  for (const f of files.slice(0, 50)) {
    try {
      const a = await analyzeFile(f), removed = Object.keys(a.fields);
      if (!removed.length) { out.push({ file: f, before: a.size, after: a.size, removed }); continue; }
      if (a.video) { Object.values(a.fields).forEach((fl) => fl.acts.forEach((act) => act(a.video.buf))); writeVideo(f, a.video.moov, a.video.buf); }
      else await writeChecked(f, a.kind, await STRIP[a.kind](a.buf));
      out.push({ file: f, before: a.size, after: fs.statSync(f).size, removed });
    } catch (e) { out.push({ file: f, error: e.message }); }
  }
  return out;
}
// Чистая копия «…-чистый» рядом, оригинал не меняется
async function clean(files) {
  const out = [];
  for (const f of files.slice(0, 50)) {
    try {
      const a = await analyzeFile(f), ext = path.extname(f), target = path.join(path.dirname(f), path.basename(f, ext) + '-чистый' + ext);
      if (a.video) {
        fs.copyFileSync(f, target);
        Object.values(a.fields).forEach((fl) => fl.acts.forEach((act) => act(a.video.buf)));
        writeVideo(target, a.video.moov, a.video.buf);
      } else await writeChecked(f, a.kind, await STRIP[a.kind](a.buf), target);
      out.push({ file: f, target, before: a.size, after: fs.statSync(target).size });
    } catch (e) { out.push({ file: f, error: e.message }); }
  }
  return out;
}
// Удаление одного поля из самого файла
async function removeField(f, label) {
  try {
    const a = await analyzeFile(f), fl = a.fields[label];
    if (!fl) return { ok: false, err: 'Этого поля уже нет' };
    if (a.video) { fl.acts.forEach((act) => act(a.video.buf)); writeVideo(f, a.video.moov, a.video.buf); }
    else await writeChecked(f, a.kind, await fl.remove(a.buf));
    return { ok: true, ...view(f, await analyzeFile(f)) };
  } catch (e) { return { ok: false, err: e.message }; }
}

/* ---------- быстрый взгляд для «Двойника» ---------- */
// Читается только начало фото (EXIF лежит в первых килобайтах) — тысячи снимков проверяются за секунды
const exifTime = (v) => (v ? String(v).replace(/^(\d{4}):(\d{2}):(\d{2}) /, '$1-$2-$3T') : null);
const fv = (fields, k) => (fields[k] ? fields[k].value : null);
const coords = (v) => { const m = /(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/.exec(v || ''); return m ? { lat: Number(m[1]), lon: Number(m[2]) } : null; };
async function peek(f) {
  const kind = kindOf(f);
  if (kind === 'jpeg') {
    const fd = fs.openSync(f, 'r'), buf = Buffer.alloc(196608); let n;
    try { n = fs.readSync(fd, buf, 0, buf.length, 0); } finally { fs.closeSync(fd); }
    const b = buf.subarray(0, n);
    if (b[0] !== 0xff || b[1] !== 0xd8) return null;
    let i = 2;
    while (i + 4 <= b.length) {
      if (b[i] !== 0xff) return null;
      while (b[i + 1] === 0xff) i++;
      const m = b[i + 1]; if (m === 0xda || m === 0xd9) break;
      const len = b.readUInt16BE(i + 2);
      if (m === 0xe1 && b.toString('latin1', i + 4, i + 10) === 'Exif\0\0') {
        if (i + 2 + len > b.length) return null;
        const ex = parseExif(b.subarray(i + 4, i + 2 + len), i + 4); if (!ex) return null;
        const g = ex.fields.GPS;
        return { kind, make: fv(ex.fields, 'Производитель'), model: fv(ex.fields, 'Модель'), serial: fv(ex.fields, 'Серийный номер'), owner: fv(ex.fields, 'Владелец камеры'), artist: fv(ex.fields, 'Автор'), taken: exifTime(fv(ex.fields, 'Снято')), lat: g && g.lat != null ? g.lat : null, lon: g && g.lon != null ? g.lon : null };
      }
      i += 2 + len;
    }
    return null;
  }
  if (kind === 'heif') {
    // фото iPhone: коробка meta и элемент Exif почти всегда лежат в первых сотнях килобайт
    const fd = fs.openSync(f, 'r'); let b;
    try { b = Buffer.alloc(Math.min(fs.fstatSync(fd).size, 2 * 1024 * 1024)); b = b.subarray(0, fs.readSync(fd, b, 0, b.length, 0)); } finally { fs.closeSync(fd); }
    const h = heifItems(b), it = h && h.items.find((x) => x.kind === 'exif' && x.end - x.start > 12);
    const ex = it ? parseExif(b.subarray(it.start + 4, it.end), it.start + 4, b.readUInt32BE(it.start)) : null;
    if (!ex) return null;
    const g = ex.fields.GPS;
    return { kind, make: fv(ex.fields, 'Производитель'), model: fv(ex.fields, 'Модель'), serial: fv(ex.fields, 'Серийный номер'), owner: fv(ex.fields, 'Владелец камеры'), artist: fv(ex.fields, 'Автор'), taken: exifTime(fv(ex.fields, 'Снято')), lat: g && g.lat != null ? g.lat : null, lon: g && g.lon != null ? g.lon : null };
  }
  if (kind === 'video') {
    const fl = videoFields(readVideo(f).buf), c = coords(fl.GPS && fl.GPS.value);
    return { kind, make: fl['Производитель'] ? fl['Производитель'].value : null, model: fl['Модель'] ? fl['Модель'].value : null, taken: fl['Дата съёмки'] ? fl['Дата съёмки'].value : null, lat: c ? c.lat : null, lon: c ? c.lon : null };
  }
  if (kind === 'office' || kind === 'pdf') {
    if (fs.statSync(f).size > 40 * 1024 * 1024) return null;
    const a = await analyzeFile(f), g = (k) => (a.fields[k] ? a.fields[k].value : null);
    return { kind, author: g('Автор'), editor: g('Последний редактор'), org: g('Организация'), people: g('Авторы правок и комментариев') };
  }
  return null;
}

module.exports = { inspect, clean, strip, removeField, peek, SUPPORTED };
