// Копирует библиотеки и шрифты в renderer/vendor, чтобы интерфейс работал без интернета.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'renderer', 'vendor');
const nm = (...p) => path.join(root, 'node_modules', ...p);
fs.mkdirSync(path.join(out, 'fonts'), { recursive: true });

const copy = (from, to) => { fs.copyFileSync(from, path.join(out, to)); };
copy(nm('three', 'build', 'three.module.min.js'), 'three.module.min.js');
copy(nm('lenis', 'dist', 'lenis.min.js'), 'lenis.min.js');

const RANGES = {
  cyrillic: 'U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116',
  latin: 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
};
const FAMILIES = [
  { pkg: 'pixelify-sans', name: 'Pixelify Sans', weights: [500, 700] },
  { pkg: 'geologica', name: 'Geologica', weights: [300, 400, 500, 600, 700, 800] },
  { pkg: 'jetbrains-mono', name: 'JetBrains Mono', weights: [400, 500, 700] },
];
let css = '/* Сгенерировано scripts/vendor.js: локальные шрифты (SIL OFL 1.1) */\n';
for (const f of FAMILIES) {
  for (const w of f.weights) {
    for (const subset of ['cyrillic', 'latin']) {
      const file = `${f.pkg}-${subset}-${w}-normal.woff2`;
      const src = nm('@fontsource', f.pkg, 'files', file);
      if (!fs.existsSync(src)) { console.warn('нет файла шрифта', file); continue; }
      copy(src, path.join('fonts', file));
      css += `@font-face{font-family:"${f.name}";font-style:normal;font-weight:${w};font-display:swap;src:url(./fonts/${file}) format("woff2");unicode-range:${RANGES[subset]};}\n`;
    }
  }
}
fs.writeFileSync(path.join(out, 'fonts.css'), css);
console.log('vendor: библиотеки и шрифты скопированы в renderer/vendor');

// npm 11 иногда пропускает загрузку самого Electron — тогда докачиваем его здесь
if (!fs.existsSync(nm('electron', 'path.txt')) && fs.existsSync(nm('electron', 'install.js'))) {
  console.log('vendor: докачиваю Electron…');
  require('child_process').execFileSync(process.execPath, [nm('electron', 'install.js')], { stdio: 'inherit' });
}
