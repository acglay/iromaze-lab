// 紙とCMYKインクの分光モデルを、ISO 12647-2 PC1(コート紙オフセット・FOGRA39相当)の
// ベタ5色+CMY重ね+G(C+Y)重ねの目標 Lab に当てはめる。R/B の重ね刷りは当てはめに使わず、検算(check.mjs)で答え合わせする。
// (G を入れないと緑の重ね刷りが鮮やかすぎる ΔE15。入れると R/B の答え合わせは崩れず G も ΔE6 程度に収まる)
//   node scripts/fit-inks.mjs   → 結果を cmyk.js の INK_PARAMS に貼る
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
globalThis.spectral = require("../vendor/spectral.js");
const C = await import("../color.js");
const K = await import("../cmyk.js");

const TARGETS = { paper: [95, 0, -2], c: [55, -37, -50], m: [48, 74, -3], y: [89, -5, 93], k: [16, 0, 0], cmy: [23, 0, 0], g: [50, -65, 27] };
const solids = (p) => {
  const m = K.makeModel(p);
  return { paper: m.solid([0, 0, 0, 0]), c: m.solid([1, 0, 0, 0]), m: m.solid([0, 1, 0, 0]), y: m.solid([0, 0, 1, 0]), k: m.solid([0, 0, 0, 1]), cmy: m.solid([1, 1, 1, 0]), g: m.solid([1, 0, 1, 0]) };
};
const dE = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
function loss(v) {
  const p = K.unpack(v);
  if (!p) return 1e9;
  const s = solids(p);
  let e = 0;
  for (const k of Object.keys(TARGETS)) e += dE(C.xyzToLab(s[k]), TARGETS[k]) ** 2;
  return e;
}

// Nelder–Mead(数回やり直し)
function nm(f, x0, scale, iters = 4000) {
  const n = x0.length;
  let pts = [x0, ...x0.map((_, i) => x0.map((v, j) => (i === j ? v + scale[i] : v)))].map((x) => [x, f(x)]);
  for (let it = 0; it < iters; it++) {
    pts.sort((a, b) => a[1] - b[1]);
    const c = Array(n).fill(0);
    for (const [x] of pts.slice(0, n)) x.forEach((v, i) => (c[i] += v / n));
    const w = pts[n][0];
    const at = (t) => c.map((v, i) => v + t * (w[i] - v));
    const r = at(-1), fr = f(r);
    if (fr < pts[0][1]) { const e = at(-2), fe = f(e); pts[n] = fe < fr ? [e, fe] : [r, fr]; }
    else if (fr < pts[n - 1][1]) pts[n] = [r, fr];
    else {
      const k = at(0.5), fk = f(k);
      if (fk < pts[n][1]) pts[n] = [k, fk];
      else pts = pts.map(([x], i) => (i === 0 ? pts[0] : ((y) => [y, f(y)])(x.map((v, j) => pts[0][0][j] + 0.5 * (v - pts[0][0][j])))));
    }
  }
  pts.sort((a, b) => a[1] - b[1]);
  return pts[0];
}
let best = [K.pack(K.INK_PARAMS), loss(K.pack(K.INK_PARAMS))];
for (let r = 0; r < 6; r++) {
  const start = best[0].map((v) => v * (1 + (r ? (Math.random() - 0.5) * 0.2 : 0)));
  const res = nm(loss, start, start.map((v) => Math.abs(v) * 0.1 + 0.02));
  if (res[1] < best[1]) best = res;
  console.log(`round ${r}: loss=${res[1].toFixed(3)}`);
}
const p = K.unpack(best[0]);
console.log("export const INK_PARAMS = " + JSON.stringify(p, (k, v) => (typeof v === "number" ? Math.round(v * 10000) / 10000 : v)) + ";");
const s = solids(p);
for (const k of Object.keys(TARGETS)) console.log(k, C.xyzToLab(s[k]).map((v) => v.toFixed(1)).join(", "), "目標", TARGETS[k].join(", "));
