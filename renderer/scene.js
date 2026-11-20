// Воксельная сцена «Спектр»: ортографическая камера без перспективы, кубики со ступенчатым
// пиксельным светом, цвет раздела подкрашивает часть вокселей и свечение за объектом.
// Формы собираются заново, когда меняется раздел; на первом экране кубики складываются в слово.
import * as THREE from './vendor/three.module.min.js';
import { SHAPES } from './shapes.js';

const canvas = document.getElementById('stage');
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const fallback = { shape: 'word', accent: '#f3f4f7', dissolve: 0, score: 0, pointer: { x: 0, y: 0, active: false }, compact: false, vel: 0 };
const S = () => window.__anonState || fallback;

let renderer = null;
try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }); } catch (e) { renderer = null; }
if (!renderer) { if (canvas) canvas.remove(); }
else init();

function init() {
  const small = innerWidth < 760, N = small ? 3600 : 7200, VH = 10;
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, small ? 1.5 : 1.75));
  renderer.setClearColor(0x07080b, 1);
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-8, 8, VH / 2, -VH / 2, 0.1, 100);
  camera.position.set(0, 0, 30);
  const clock = new THREE.Clock();

  /* ---------- фон: пиксельная сетка и цветное свечение за объектом ---------- */
  const bgU = { uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) }, uFocus: { value: new THREE.Vector2(0, 0) }, uAcc: { value: new THREE.Color('#f3f4f7') }, uScroll: { value: 0 }, uGlow: { value: .5 } };
  const bg = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    uniforms: bgU, depthTest: false, depthWrite: false,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, .9999, 1.); }',
    fragmentShader: `
      precision highp float; varying vec2 vUv;
      uniform float uTime, uScroll, uGlow; uniform vec2 uRes, uFocus; uniform vec3 uAcc;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main(){
        vec2 px = vUv * uRes;
        vec3 col = vec3(.027, .031, .043);
        // цветное свечение за объектом, квантованное ступеньками, как в пиксель-арте
        vec2 p = (vUv - .5) * vec2(uRes.x / uRes.y, 1.) * 2.;
        vec2 f = uFocus * vec2(uRes.x / uRes.y, 1.);
        float d = length(p - f);
        float g = exp(-d * d * 1.1) * uGlow;
        g = floor(g * 9.) / 9.;
        col += uAcc * g * .16;
        // сетка точек: сдвигается со скроллом и мерцает
        vec2 cell = floor((px + vec2(0., uScroll * .25)) / 24.);
        vec2 fr = mod(px + vec2(0., uScroll * .25), 24.);
        float dot = step(fr.x, 2.) * step(fr.y, 2.);
        float tw = .35 + .65 * step(.985, h(cell + floor(uTime * .6)));
        col += vec3(.06, .065, .08) * dot * tw;
        col *= 1. - .45 * smoothstep(.7, 1.8, length(p));
        gl_FragColor = vec4(col, 1.);
      }`,
  }));
  bg.frustumCulled = false; bg.renderOrder = -10; scene.add(bg);

  /* ---------- воксели ---------- */
  const cache = {};
  const shape = (name) => {
    if (cache[name]) return cache[name];
    const a = (SHAPES[name] || SHAPES.dust)(N); let ex = 0, ey = 0;
    for (let i = 0; i < N * 3; i += 3) { if (a[i + 2] > -2.5) { ex = Math.max(ex, Math.abs(a[i])); ey = Math.max(ey, Math.abs(a[i + 1])); } }
    a.ext = { x: ex || 2.5, y: ey || 2.5 }; return (cache[name] = a);
  };
  const geo = new THREE.InstancedBufferGeometry().copy(new THREE.BoxGeometry(1, 1, 1));
  geo.instanceCount = N;
  const first = shape(S().compact ? 'word2' : 'word');
  const aFrom = new Float32Array(shape('dust')), aTo = new Float32Array(first), aR = new Float32Array(N * 4);
  for (let i = 0; i < N * 4; i++) aR[i] = Math.random();
  geo.setAttribute('aFrom', new THREE.InstancedBufferAttribute(aFrom, 3));
  geo.setAttribute('aTo', new THREE.InstancedBufferAttribute(aTo, 3));
  geo.setAttribute('aDust', new THREE.InstancedBufferAttribute(new Float32Array(shape('dust')), 3));
  geo.setAttribute('aR', new THREE.InstancedBufferAttribute(aR, 4));
  const U = {
    uMix: { value: 0 }, uTime: { value: 0 }, uDissolve: { value: 0 }, uSize: { value: .05 }, uPK: { value: 0 }, uPulse: { value: 0 }, uSweep: { value: -99 },
    uP: { value: new THREE.Vector3(99, 99, 0) }, uAcc: { value: new THREE.Color('#f3f4f7') }, uKey: { value: new THREE.Vector3(-.5, .75, .45).normalize() },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: U,
    vertexShader: `
      attribute vec3 aFrom; attribute vec3 aTo; attribute vec3 aDust; attribute vec4 aR;
      uniform float uMix, uTime, uDissolve, uSize, uPK, uPulse, uSweep; uniform vec3 uP;
      varying vec3 vN; varying float vShade; varying float vTint; varying float vLoose; varying float vGlow;
      mat3 rotAxis(vec3 a, float g){ float s = sin(g), c = cos(g), o = 1. - c;
        return mat3(o*a.x*a.x + c, o*a.x*a.y + a.z*s, o*a.z*a.x - a.y*s, o*a.x*a.y - a.z*s, o*a.y*a.y + c, o*a.y*a.z + a.x*s, o*a.z*a.x + a.y*s, o*a.y*a.z - a.x*s, o*a.z*a.z + c); }
      void main(){
        float d = clamp(uMix * 1.6 - aR.x * .6, 0., 1.);
        float e = d * d * (3. - 2. * d);
        float tr = sin(e * 3.14159);
        vec3 c = mix(aFrom, aTo, e) + (aR.yzw - .5) * tr * 1.8;
        float dz = smoothstep(aR.x * .9, aR.x * .9 + .1, uDissolve);
        c = mix(c, aDust, dz);
        float loose = max(step(c.z, -2.5), dz);
        c.y += sin(uTime * .3 + aR.y * 6.2832) * .15 * loose;
        vec4 wc = modelMatrix * vec4(c, 1.);
        vec3 tp = wc.xyz - uP; float pd = length(tp.xy);
        wc.xy += normalize(tp.xy + vec2(.001)) * smoothstep(1.4, 0., pd) * uPK * .55;
        wc.xyz += normalize(wc.xyz - modelMatrix[3].xyz + vec3(.001)) * uPulse * .22 * aR.w * (1. - loose);
        vGlow = exp(-pow((wc.x - uSweep) * 1.3, 2.)) * .55 * (1. - loose) + uPulse * step(.6, aR.z) * (1. - loose);
        mat3 R = rotAxis(normalize(aR.wzy - .5 + vec3(.001)), tr * 3. + loose * (uTime * (.2 + aR.w * .5) + aR.z * 6.28));
        float sz = uSize * mix(1., .6 + aR.w * 1.4, loose);
        vec3 lp = mat3(modelMatrix) * (R * (position * sz * .94));
        vN = normalize(mat3(modelMatrix) * (R * normal));
        vShade = aR.y; vTint = step(.8, aR.z) * (1. - loose * .5); vLoose = loose;
        gl_Position = projectionMatrix * viewMatrix * vec4(wc.xyz + lp, 1.);
      }`,
    fragmentShader: `
      uniform vec3 uKey, uAcc;
      varying vec3 vN; varying float vShade; varying float vTint; varying float vLoose; varying float vGlow;
      void main(){
        vec3 N = normalize(vN);
        float dif = max(dot(N, uKey), 0.);
        dif = floor(dif * 4. + .5) / 4.;                       // ступенчатый свет пиксель-арта
        float top = step(.6, N.y) * .18;
        vec3 base = mix(vec3(.16, .17, .2), vec3(.78, .8, .86), vShade * vShade);
        base = mix(base, uAcc, vTint * .85);
        vec3 col = base * (.22 + dif * .9 + top);
        col *= mix(1., .38, vLoose);
        col += uAcc * vGlow * .4 + vec3(vGlow * .1);
        gl_FragColor = vec4(col, 1.);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false;
  const group = new THREE.Group(); group.add(mesh); scene.add(group);

  /* ---------- размеры ---------- */
  let viewW = 16;
  function resize() {
    const w = innerWidth, h = innerHeight, asp = w / h;
    renderer.setSize(w, h, false);
    viewW = VH * asp;
    camera.left = -viewW / 2; camera.right = viewW / 2; camera.top = VH / 2; camera.bottom = -VH / 2; camera.updateProjectionMatrix();
    bgU.uRes.value.set(w * renderer.getPixelRatio(), h * renderer.getPixelRatio());
  }
  addEventListener('resize', resize); resize();

  /* ---------- смена формы ---------- */
  let cur = '', T = 0;
  const DUR = reduce ? .001 : 1.7;
  function morph(name) {
    for (let i = 0; i < N; i++) {
      const d = Math.min(1, Math.max(0, T * 1.6 - aR[i * 4] * .6)), e = d * d * (3 - 2 * d);
      for (let k = 0; k < 3; k++) { const j = i * 3 + k; aFrom[j] += (aTo[j] - aFrom[j]) * e; }
    }
    aTo.set(shape(name)); cur = name; T = 0;
    geo.getAttribute('aFrom').needsUpdate = true; geo.getAttribute('aTo').needsUpdate = true;
  }
  cur = S().compact ? 'word2' : 'word';

  /* ---------- раскладка формы в кадре ---------- */
  function layout(name, st) {
    const s = shape(name), compact = st.compact;
    if (s.box) {   // слова
      const sc = Math.min((compact ? .9 : .84) * viewW / s.box.w, (compact ? .3 : .42) * VH / s.box.h);
      return { x: 0, y: VH * (name === 'kenox' ? .16 : compact ? .2 : .1), s: sc, spin: false };
    }
    if (name === 'dust') return { x: 0, y: 0, s: 1, spin: false };
    const spin = !/^(fingerprint|eye|crowd|link)$/.test(name);
    if (compact) return { x: 0, y: VH * .23, s: .82, spin };
    const e = s.ext; return { x: viewW * .24, y: 0, s: Math.max(.6, Math.min(1.4, (viewW * .26 - .8) / e.x, VH * .36 / e.y)), spin };
  }

  /* ---------- кадр ---------- */
  const acc = new THREE.Color('#f3f4f7'), tmp = new THREE.Color();
  let px = 0, py = 0, ps = 1, rotY = 0, mx = 0, my = 0, pk = 0, scrollS = 0, pulse = 0;
  addEventListener('anon:protect', (e) => { if (e.detail.on) pulse = Math.max(pulse, .9); });
  addEventListener('anon:seal', () => { pulse = 1.8; });
  function frame() {
    requestAnimationFrame(frame);
    if (document.hidden) return;
    const dt = Math.min(clock.getDelta(), .05), st = S(), t = reduce ? 0 : clock.elapsedTime;
    let want = st.shape || 'dust';
    if (want === 'word' && st.compact) want = 'word2';
    if (want !== cur) morph(want);
    if (T < 1 && (st.introDone || !shape(cur).box || performance.now() > 9000)) T = Math.min(1, T + dt / DUR);
    pulse *= Math.pow(.06, dt); U.uPulse.value = reduce ? 0 : pulse;
    U.uSweep.value = reduce ? -99 : (((t * .16) % 1.7) - .35) * viewW - viewW / 2;
    U.uMix.value = T; U.uTime.value = t; bgU.uTime.value = t;
    U.uDissolve.value += (st.dissolve * st.score * .97 - U.uDissolve.value) * Math.min(1, dt * 3);

    tmp.set(st.accent || '#f3f4f7'); acc.lerp(tmp, Math.min(1, dt * 2.5));
    U.uAcc.value.copy(acc); bgU.uAcc.value.copy(acc);

    const L = layout(cur, st), k = reduce ? 1 : Math.min(1, dt * 2.4);
    px += (L.x - px) * k; py += (L.y - py) * k; ps += (L.s - ps) * k;
    group.position.set(px, py, 0); group.scale.setScalar(ps);
    bgU.uFocus.value.set(px / (viewW / 2) * (viewW / VH) / (viewW / VH), py / (VH / 2));
    bgU.uGlow.value += ((cur === 'dust' ? .25 : .75) - bgU.uGlow.value) * k;
    scrollS += (scrollY - scrollS) * .1; bgU.uScroll.value = scrollS * renderer.getPixelRatio();

    mx += ((st.pointer.active ? st.pointer.x : 0) - mx) * .06; my += ((st.pointer.active ? st.pointer.y : 0) - my) * .06;
    if (!reduce) {
      if (L.spin) rotY += dt * .22 + (st.vel || 0) * .004;
      else rotY += (Math.sin(t * .4) * .18 + mx * .35 - rotY) * Math.min(1, dt * 2);
    }
    group.rotation.y = rotY;
    group.rotation.x += ((L.spin ? -.42 : -.08) + my * .22 - group.rotation.x) * Math.min(1, dt * 2);

    pk += ((st.pointer.active && !reduce ? 1 : 0) - pk) * .06; U.uPK.value = pk;
    U.uP.value.set(mx * viewW / 2, my * VH / 2, 0);
    renderer.render(scene, camera);
    window.__anonSceneReady = true;
  }
  frame();
  document.documentElement.classList.add('gl-ready');
}
