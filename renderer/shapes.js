// Формы слоёв для роя кубиков. Каждая функция возвращает N позиций (x, y, z), привязанных к воксельной сетке,
// поэтому собранный объект выглядит как воксельная скульптура, а не облако точек.
const TAU = Math.PI * 2;
const G = 0.05;                         // шаг воксельной сетки
const snap = (v) => Math.round(v / G) * G;

function rng(seed) {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}
function kit(N, seed) {
  const rnd = rng(seed), a = new Float32Array(N * 3);
  const gauss = () => (rnd() + rnd() + rnd() - 1.5) / 1.5;
  const put = (i, x, y, z, raw) => { a[i * 3] = raw ? x : snap(x); a[i * 3 + 1] = raw ? y : snap(y); a[i * 3 + 2] = raw ? z : snap(z); };
  const sph = (r) => { const u = rnd() * 2 - 1, t = rnd() * TAU, s = Math.sqrt(1 - u * u); return [r * s * Math.cos(t), r * u, r * s * Math.sin(t)]; };
  const edgePt = (p, q) => { const t = rnd(); return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t]; };
  const box = (cx, cy, cz, w, h, d) => {
    const x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - h / 2, y1 = cy + h / 2, z0 = cz - d / 2, z1 = cz + d / 2;
    const v = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
    return [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]].map(([i, k]) => [v[i], v[k]]);
  };
  const pick = (edges) => {
    if (!edges._c) { let s = 0; edges._c = edges.map(([p, q]) => (s += Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]))); }
    const c = edges._c, u = rnd() * c[c.length - 1]; let lo = 0, hi = c.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (c[m] < u) lo = m + 1; else hi = m; }
    return edges[lo];
  };
  return { a, rnd, gauss, put, sph, edgePt, box, pick };
}

export const SHAPES = {
  // пыль в пустоте: кубики свободно висят по всему кадру
  dust(N) {
    const { a, rnd, put } = kit(N, 3);
    for (let i = 0; i < N; i++) put(i, (rnd() * 2 - 1) * 9.5, (rnd() * 2 - 1) * 5.5, -3 - rnd() * 8, true);
    return a;
  },
  // папиллярный узор: спираль гребней с разрывами на выпуклой подушечке
  fingerprint(N) {
    const { a, rnd, put } = kit(N, 7);
    const b = 0.085, a0 = 0.06, T = TAU * 24, c = b / TAU, S = a0 * T + c * T * T / 2;
    for (let i = 0; i < N;) {
      const s = rnd() * S, t = (-a0 + Math.sqrt(a0 * a0 + 2 * c * s)) / c;
      let r = a0 + c * t;
      if (Math.sin(t * 0.37) * Math.sin(t * 1.9 + 1.3) > 0.82) continue;
      r *= 1 + 0.05 * Math.sin(3 * t + r * 2) + 0.025 * Math.sin(5 * t - r * 3);
      let x = r * Math.cos(t) * 0.8; const y = r * Math.sin(t) * 1.02;
      x += 0.12 * Math.sin(y * 1.4);
      const m = (x / 1.62) ** 2 + ((y - 0.15) / 2.15) ** 2;
      if (m > 1 || y < -1.95) continue;
      put(i++, x, y, 0.55 * (1 - m));
    }
    return a;
  },
  // глаз наблюдения: радужка из волокон, зрачок, веки
  eye(N) {
    const { a, rnd, gauss, put } = kit(N, 11); const W = 2.6;
    for (let i = 0; i < N; i++) {
      const u = rnd();
      if (u < 0.48) { const th = Math.floor(rnd() * 150) / 150 * TAU, r = 0.5 + rnd() ** 0.8 * 0.95; put(i, r * Math.cos(th), r * Math.sin(th), 0.32 * (1 - r * r / 2.4)); }
      else if (u < 0.58) { const th = rnd() * TAU, r = 0.5; put(i, r * Math.cos(th), r * Math.sin(th), 0.25); }
      else if (u < 0.63) { const th = rnd() * TAU, r = 1.46; put(i, r * Math.cos(th), r * Math.sin(th), 0); }
      else { const x = (rnd() * 2 - 1) * W, k = 1 - (x / W) ** 2, up = rnd() < 0.55, off = Math.floor(rnd() * 2) * 0.06; put(i, x, up ? (1.22 + off) * k : -(1.0 + off) * k, -0.1 + gauss() * 0.02); }
    }
    return a;
  },
  // сейф-решётка
  vault(N) {
    const { a, put, pick, edgePt } = kit(N, 13); const n = 4, L = 3.0, e = [];
    for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) {
      const p = -L / 2 + i * L / n, q = -L / 2 + j * L / n;
      e.push([[-L / 2, p, q], [L / 2, p, q]], [[p, -L / 2, q], [p, L / 2, q]], [[p, q, -L / 2], [p, q, L / 2]]);
    }
    for (let i = 0; i < N; i++) { const [p, q] = pick(e); put(i, ...edgePt(p, q)); }
    return a;
  },
  // торический узел шифра
  knot(N) {
    const { a, rnd, put } = kit(N, 17); const P = 2, Q = 3, R = 0.3, sc = 0.66;
    const f = (t) => { const r = Math.cos(Q * t) + 2; return [r * Math.cos(P * t) * sc, r * Math.sin(P * t) * sc, -Math.sin(Q * t) * sc]; };
    for (let i = 0; i < N; i++) {
      const t = rnd() * TAU, p = f(t), p2 = f(t + 0.001);
      const T = [p2[0] - p[0], p2[1] - p[1], p2[2] - p[2]], l = Math.hypot(...T); T[0] /= l; T[1] /= l; T[2] /= l;
      let Nn = [-T[1], T[0], 0]; const ln = Math.hypot(...Nn) || 1; Nn = Nn.map((v) => v / ln);
      const B = [T[1] * Nn[2] - T[2] * Nn[1], T[2] * Nn[0] - T[0] * Nn[2], T[0] * Nn[1] - T[1] * Nn[0]];
      const g = rnd() * TAU, ca = Math.cos(g) * R, sa = Math.sin(g) * R;
      put(i, p[0] + Nn[0] * ca + B[0] * sa, p[1] + Nn[1] * ca + B[1] * sa, p[2] + Nn[2] * ca + B[2] * sa);
    }
    return a;
  },
  // луковые оболочки Tor с вырезом, как на разрезе
  onion(N) {
    const { a, rnd, put, sph } = kit(N, 19); const shells = [[0.22, .05], [0.85, .2], [1.45, .32], [2.05, .43]];
    for (let i = 0; i < N; i++) {
      let u = rnd(), k = 0; while (k < 3 && u > shells[k][1]) { u -= shells[k][1]; k++; }
      let p = sph(shells[k][0]);
      if (k > 1 && p[0] > 0 && p[2] > 0) { i--; continue; }
      if (k === 0) p = p.map((v) => v * Math.cbrt(rnd()));
      put(i, ...p);
    }
    return a;
  },
  // толпа одинаковых фигур: против отпечатка работает одинаковость
  crowd(N) {
    // ряды одинаковых фигур: голова, плечи, корпус — никто не выделяется
    const { a, rnd, put, sph } = kit(N, 23); const C = 7, R = 4;
    for (let i = 0; i < N; i++) {
      const col = Math.floor(rnd() * C), row = Math.floor(rnd() * R);
      const cx = (col - (C - 1) / 2) * 0.62 + (row % 2) * 0.31, cz = (row - (R - 1) / 2) * 0.75, cy = -0.55 + row * 0.12;
      const u = rnd();
      if (u < 0.3) { const p = sph(0.15); put(i, cx + p[0], cy + 0.78 + p[1], cz + p[2]); }
      else if (u < 0.45) { put(i, cx + (rnd() - .5) * 0.5, cy + 0.5, cz + (rnd() - .5) * 0.14); }
      else { const t = rnd(); put(i, cx + (rnd() - .5) * (0.44 - t * 0.12), cy + 0.5 - t * 0.95, cz + (rnd() - .5) * 0.16); }
    }
    return a;
  },
  // два собеседника и зашифрованный туннель между ними
  link(N) {
    const { a, rnd, put, sph } = kit(N, 29); const X = 1.85;
    for (let i = 0; i < N; i++) {
      const u = rnd();
      if (u < 0.46) { const p = sph(0.6); put(i, p[0] + (u < 0.23 ? -X : X), p[1], p[2]); }
      else {
        const t = rnd(), x = -X + 0.6 + t * (2 * X - 1.2), ph = t * TAU * 4;
        if (u < 0.86) { const s = u < 0.66 ? 0 : Math.PI; put(i, x, Math.cos(ph + s) * 0.32, Math.sin(ph + s) * 0.32); }
        else { const st = Math.round(t * 24) / 24, x2 = -X + 0.6 + st * (2 * X - 1.2), ph2 = st * TAU * 4, m = rnd() * 2 - 1; put(i, x2, Math.cos(ph2) * 0.32 * m, Math.sin(ph2) * 0.32 * m); }
      }
    }
    return a;
  },
  // монолит устройства с сеткой экрана
  monolith(N) {
    const { a, rnd, put, pick, edgePt, box } = kit(N, 31); const W = 1.7, H = 3.4, D = 0.3, e = box(0, 0, 0, W, H, D);
    for (let i = 0; i < N; i++) {
      const u = rnd();
      if (u < 0.35) { const [p, q] = pick(e); put(i, ...edgePt(p, q)); }
      else if (u < 0.78) {
        const gx = rnd() < 0.5;
        const x = gx ? Math.round(((rnd() - .5) * (W - .3)) / 0.15) * 0.15 : (rnd() - .5) * (W - .3);
        const y = gx ? (rnd() - .5) * (H - .5) : Math.round(((rnd() - .5) * (H - .5)) / 0.15) * 0.15;
        put(i, x, y, D / 2);
      } else put(i, (rnd() - .5) * W, (rnd() - .5) * H, -D / 2);
    }
    return a;
  },
  // глобус с меридианами и меткой геопозиции
  globe(N) {
    const { a, rnd, put, sph } = kit(N, 37); const R = 1.95, lat = 55.75 * Math.PI / 180, lon = 37.6 * Math.PI / 180;
    for (let i = 0; i < N; i++) {
      const u = rnd();
      if (u < 0.4) { const m = Math.floor(rnd() * 12) / 12 * TAU, v = rnd() * Math.PI; put(i, R * Math.sin(v) * Math.cos(m), R * Math.cos(v), R * Math.sin(v) * Math.sin(m)); }
      else if (u < 0.76) { const pp = (Math.floor(rnd() * 8) + 1) / 9 * Math.PI, m = rnd() * TAU; put(i, R * Math.sin(pp) * Math.cos(m), R * Math.cos(pp), R * Math.sin(pp) * Math.sin(m)); }
      else if (u < 0.93) put(i, ...sph(R));
      else { const r = R + rnd() * 0.9; put(i, r * Math.cos(lat) * Math.cos(lon), r * Math.sin(lat), r * Math.cos(lat) * Math.sin(lon)); }
    }
    return a;
  },
  // изолированные ячейки: личности не пересекаются
  cells(N) {
    const { a, rnd, put, pick, edgePt, box, sph } = kit(N, 41);
    const bx = [[-1.4, 0.9, 0, 1.0], [1.3, 1.1, -0.4, 0.8], [0, -0.1, 0.5, 1.15], [-1.2, -1.3, -0.3, 0.75], [1.35, -1.15, 0.2, 0.9]];
    const e = bx.flatMap(([x, y, z, s]) => box(x, y, z, s, s, s));
    for (let i = 0; i < N; i++) {
      if (rnd() < 0.7) { const [p, q] = pick(e); put(i, ...edgePt(p, q)); }
      else { const [x, y, z, s] = bx[Math.floor(rnd() * bx.length)]; const p = sph(s * 0.28 * Math.cbrt(rnd())); put(i, x + p[0], y + p[1], z + p[2]); }
    }
    return a;
  },
  // воксельные слова: собственный пиксельный шрифт 5×7, каждый пиксель — блок кубиков
  word(N) { return voxelText(N, ['АНОНИМНОСТЬ'], 51); },
  word2(N) { return voxelText(N, ['АНОНИМ', 'НОСТЬ'], 53); },
  kenox(N) { return voxelText(N, ['KENOX'], 59); },
};

const FONT = {
  'А': ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  'Н': ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  'О': ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  'И': ['#...#', '#...#', '#..##', '#.#.#', '##..#', '#...#', '#...#'],
  'М': ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  'С': ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  'Т': ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  'Ь': ['#....', '#....', '#....', '####.', '#...#', '#...#', '####.'],
  'K': ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  'E': ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  'N': ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
  'X': ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
};
FONT.O = FONT['О'];

function voxelText(N, rows, seed) {
  const { a, rnd, put } = kit(N, seed);
  const px = [];
  const widest = Math.max(...rows.map((r) => r.length * 6 - 1));
  rows.forEach((text, ri) => {
    const w = text.length * 6 - 1, ox = Math.floor((widest - w) / 2);
    [...text].forEach((ch, ci) => (FONT[ch] || FONT['О']).forEach((line, y) => [...line].forEach((c, x) => {
      if (c === '#') px.push([ox + ci * 6 + x, ri * 9 + y]);
    })));
  });
  const cols = widest, rowsH = rows.length * 9 - 2;
  const k = px.length * 27 <= N * 0.8 ? 3 : 2, dz = 3, per = k * k * dz;
  const used = Math.min(N, px.length * per);
  let i = 0;
  for (const [x, y] of px) for (let u = 0; u < k; u++) for (let v = 0; v < k; v++) for (let w = 0; w < dz; w++) {
    if (i >= used) break;
    put(i++, ((x - cols / 2) * k + u) * G, (-(y - rowsH / 2) * k - v) * G, (w - (dz - 1) / 2) * G, true);
  }
  for (; i < N; i++) put(i, (rnd() * 2 - 1) * 8, (rnd() * 2 - 1) * 4.5, -3 - rnd() * 6, true);
  a.box = { w: cols * k * G, h: rowsH * k * G, solid: used };
  return a;
}
