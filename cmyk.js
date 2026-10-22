// 印刷(CMYK・コート紙オフセット)の物理モデル。
// 紙の分光反射率と、C/M/Y/K インクの分光透過率(38バンド 380〜750nm・10nm)から:
//  ベタ・重ね刷り = rs + (1-rs) × 紙 × Π(インク透過率)²(光がインク層を行きと帰りの2回通る。rs=表面の反射、Saunderson補正の簡略形)
//  網点 = Demichel の式で16通りの重なりの面積率 → Yule–Nielsen 補正つき分光 Neugebauer(n=2)
// インクの曲線は scripts/fit-inks.mjs で ISO 12647-2 PC1(FOGRA39相当)のベタ5色+CMY重ね+G重ねの Lab に当てはめた(R/B重ねは検算で答え合わせ)。
// 見る光は D65(このアプリの内部表現に合わせる。規格は D50)。
import { xyzToOklab, oklabToXYZ, oklch } from "./color.js";

const BANDS = Array.from({ length: 38 }, (_, i) => 380 + i * 10);
const YN = 2; // Yule–Nielsen の n

// ---- 曲線の形(パラメータ → 38バンド)----
const sig = (x) => 1 / (1 + Math.exp(-x));
const curves = (p) => ({
  paper: BANDS.map((l) => Math.min(1, p.paper[0] + p.paper[1] * ((550 - l) / 200))),
  c: BANDS.map((l) => p.c[0] + (p.c[1] - p.c[0]) * sig((p.c[2] - l) / p.c[3])),
  m: BANDS.map((l) => p.m[1] - (p.m[1] - p.m[0]) * Math.exp(-0.5 * ((l - p.m[2]) / (l < p.m[2] ? p.m[3] : p.m[4])) ** 2)),
  y: BANDS.map((l) => p.y[0] + (p.y[1] - p.y[0]) * sig((l - p.y[2]) / p.y[3])),
  k: BANDS.map(() => p.k[0]),
  rs: p.rs[0],
});

// fit-inks.mjs の結果
export const INK_PARAMS = {"paper":[0.9269,0.1083],"c":[0.0672,0.8116,545.3973,4.6643],"m":[0.0214,1,544.2921,91.8961,37.0812],"y":[0.0352,0.9741,499.7766,18.4484],"k":[0.004],"rs":[0.0326]};

// 当てはめ用: パラメータ <-> 数値の列(範囲外なら null)
const KEYS = ["paper", "c", "m", "y", "k", "rs"];
export const pack = (p) => KEYS.flatMap((k) => p[k]);
export function unpack(v) {
  const lens = [2, 4, 5, 4, 1, 1], p = {};
  let i = 0;
  KEYS.forEach((k, j) => { p[k] = v.slice(i, i + lens[j]); i += lens[j]; });
  const t = [p.c[0], p.c[1], p.m[0], p.m[1], p.y[0], p.y[1], p.k[0]];
  if (t.some((x) => x < 0.001 || x > 1) || p.paper[0] > 1 || p.paper[0] < 0.5 || p.c[3] <= 1 || p.y[3] <= 1 || p.m[3] <= 1 || p.m[4] <= 1 || p.rs[0] < 0 || p.rs[0] > 0.1) return null;
  return p;
}

// 38バンドの反射率 → XYZ(spectral.js の D65×CIE1931 の表を使う。単位インパルスの応答を表にしておく)
let CMF = null;
function specToXYZ(R) {
  if (!CMF) CMF = BANDS.map((_, i) => new globalThis.spectral.Color(BANDS.map((__, j) => (i === j ? 1 : 0))).XYZ);
  const out = [0, 0, 0];
  for (let i = 0; i < 38; i++) for (let k = 0; k < 3; k++) out[k] += CMF[i][k] * R[i];
  return out;
}

export function makeModel(p = INK_PARAMS) {
  const cv = curves(p);
  // 16通りの重なり(Neugebauer の原色)の反射率
  const prim = [];
  for (let b = 0; b < 16; b++) {
    prim.push(cv.paper.map((r, i) => {
      let t = 1;
      if (b & 1) t *= cv.c[i];
      if (b & 2) t *= cv.m[i];
      if (b & 4) t *= cv.y[i];
      if (b & 8) t *= cv.k[i];
      return cv.rs + (1 - cv.rs) * r * t * t;
    }));
  }
  const primN = prim.map((R) => R.map((r) => r ** (1 / YN)));
  const spectrum = ([c, m, y, k]) => {
    const R = new Array(38).fill(0);
    const cov = [c, m, y, k];
    for (let b = 0; b < 16; b++) {
      let w = 1;
      for (let j = 0; j < 4; j++) w *= b & (1 << j) ? cov[j] : 1 - cov[j];
      if (w < 1e-9) continue;
      for (let i = 0; i < 38; i++) R[i] += w * primN[b][i];
    }
    return R.map((r) => r ** YN);
  };
  return {
    curves: cv,
    spectrum,
    xyz: (cmyk) => specToXYZ(spectrum(cmyk)),
    solid: (cmyk) => specToXYZ(spectrum(cmyk)),
  };
}

// ---- 印刷できる範囲(色域)と、色 → CMYK ----
// 11^4 の網点の組み合わせ(総インク量 300% まで)を刷った色を Oklab で持ち、
// 明るさ×色相のマスごとに一番あざやかな値を記録する(Segment Maxima 法)
const LB = 40, HB = 90;
let GAMUT = null;
export function printGamut() {
  if (GAMUT) return GAMUT;
  const model = makeModel();
  const samples = [];
  const n = 10;
  for (let a = 0; a <= n; a++) for (let b = 0; b <= n; b++) for (let c = 0; c <= n; c++) for (let d = 0; d <= n; d++) {
    const cmyk = [a / n, b / n, c / n, d / n];
    if (a + b + c + d > 3 * n) continue;
    const xyz = model.xyz(cmyk);
    samples.push({ cmyk, xyz, lab: xyzToOklab(xyz) });
  }
  const Ls = samples.map((s) => s.lab[0]);
  const Lmin = Math.min(...Ls), Lmax = Math.max(...Ls);
  const cmax = Array.from({ length: LB }, () => new Array(HB).fill(0));
  const li = (L) => Math.min(LB - 1, Math.max(0, Math.floor(((L - Lmin) / (Lmax - Lmin)) * LB)));
  const hi = (h) => Math.floor((((h % 360) + 360) % 360) / (360 / HB)) % HB;
  for (const s of samples) {
    const [L, a, b] = s.lab;
    const C = Math.hypot(a, b), h = (Math.atan2(b, a) * 180) / Math.PI;
    const i = li(L), j = hi(h);
    cmax[i][j] = Math.max(cmax[i][j], C);
  }
  // 空いたマス(見本が落ちなかった色相)は、同じ明るさの左右で一番近い値から直線で補う
  for (const row of cmax) {
    const has = row.map((v, j) => (v > 0 ? j : -1)).filter((j) => j >= 0);
    if (!has.length) continue;
    for (let j = 0; j < HB; j++) {
      if (row[j] > 0) continue;
      const prev = [...has].reverse().find((k) => k < j) ?? has.at(-1) - HB, next = has.find((k) => k > j) ?? has[0] + HB;
      const vp = row[(prev + HB) % HB], vn = row[next % HB];
      row[j] = vp + ((vn - vp) * (j - prev)) / (next - prev);
    }
  }
  // 補間するとマスの山がならされて、山を作った見本自身が外に出る → 周り8マスの最大で広げてから使う
  const dil = cmax.map((row, i) => row.map((_, j) => {
    let m = 0;
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      const ii = i + di;
      if (ii >= 0 && ii < LB) m = Math.max(m, cmax[ii][(j + dj + HB) % HB]);
    }
    return m;
  }));
  GAMUT = { model, samples, Lmin, Lmax, cmax: dil };
  return GAMUT;
}
// (L, 色相) での最大彩度(マスの間は直線補間)
function cmaxAt(L, h) {
  const G = printGamut();
  const fl = ((L - G.Lmin) / (G.Lmax - G.Lmin)) * LB - 0.5, fh = ((((h % 360) + 360) % 360) / (360 / HB)) - 0.5;
  const i0 = Math.max(0, Math.min(LB - 1, Math.floor(fl))), i1 = Math.min(LB - 1, i0 + 1), ti = Math.max(0, Math.min(1, fl - i0));
  const j0 = ((Math.floor(fh) % HB) + HB) % HB, j1 = (j0 + 1) % HB, tj = fh - Math.floor(fh);
  const r = (i) => G.cmax[i][j0] * (1 - tj) + G.cmax[i][j1] * tj;
  return r(i0) * (1 - ti) + r(i1) * ti;
}
export function inPrintGamut(xyz, eps = 0.004) {
  const G = printGamut();
  const { L, C, h } = oklch(xyz);
  return L >= G.Lmin - eps && L <= G.Lmax + eps && C <= cmaxAt(L, h) + eps;
}
// 印刷に収める。mode "clip"=明るさを紙〜黒の間に切り、彩度だけ下げる(色相・明るさ固定)
// mode "chroma"=色相を保ったまま、その色相で一番あざやかになる明るさ(cusp)の灰色に向かってまっすぐ近づける(明るさも動く。Ottosson の cusp 方式)
export function toPrint(xyz, mode = "chroma") {
  const G = printGamut();
  const { L, C, h } = oklch(xyz);
  const r = (h * Math.PI) / 180;
  const at = (L2, C2) => oklabToXYZ([L2, C2 * Math.cos(r), C2 * Math.sin(r)]);
  if (mode === "clip") {
    const L2 = Math.min(G.Lmax, Math.max(G.Lmin, L));
    return at(L2, Math.min(C, cmaxAt(L2, h)));
  }
  if (inPrintGamut(xyz)) return xyz; // 境界は補間なので少し余裕をみる(既定 0.004)
  let L0 = (G.Lmin + G.Lmax) / 2, best = 0;
  for (let i = 0; i <= 64; i++) {
    const Li = G.Lmin + ((G.Lmax - G.Lmin) * i) / 64, c = cmaxAt(Li, h);
    if (c > best) { best = c; L0 = Li; }
  }
  let lo = 0, hi = 1; // t=0 が灰色、t=1 が元の色
  for (let i = 0; i < 24; i++) {
    const t = (lo + hi) / 2;
    if (inPrintGamut(at(L0 + (L - L0) * t, C * t), 0)) lo = t; else hi = t;
  }
  return at(L0 + (L - L0) * lo, C * lo);
}
// 色 → いちばん近く刷れる CMYK(近い見本から始めて、1%刻みまで座標ごとに詰める)
export function toCMYK(xyz) {
  const G = printGamut();
  const t = xyzToOklab(xyz);
  const d = (lab) => Math.hypot(lab[0] - t[0], lab[1] - t[1], lab[2] - t[2]);
  let best = G.samples[0], bd = Infinity;
  for (const s of G.samples) { const e = d(s.lab); if (e < bd) { bd = e; best = s; } }
  let x = best.cmyk.slice();
  for (const step of [0.05, 0.02, 0.01]) {
    let moved = true;
    while (moved) {
      moved = false;
      for (let j = 0; j < 4; j++) for (const s of [step, -step]) {
        const y = x.slice(); y[j] = Math.min(1, Math.max(0, y[j] + s));
        if (y.reduce((a, b) => a + b) > 3) continue;
        const e = d(xyzToOklab(G.model.xyz(y)));
        if (e < bd - 1e-9) { bd = e; x = y; moved = true; }
      }
    }
  }
  return { cmyk: x, dE: bd };
}

// 混ぜ方「インク式」用: 色 → CMYK(同じ色はキャッシュ)/CMYK → 刷った色
const cmykCache = new Map();
export function printCMYK(xyz) {
  const key = xyz.map((v) => v.toFixed(4)).join(",");
  let c = cmykCache.get(key);
  if (!c) {
    c = toCMYK(xyz).cmyk;
    cmykCache.set(key, c);
  }
  return c;
}
export const inkXYZ = (cmyk) => printGamut().model.xyz(cmyk);
// 図に描く印刷の範囲: 3D=CMYの立方体の12辺(K=0)、2D=C→G→Y→R→M→B→C のベタと重ねの輪
export function printOutline() {
  const m = printGamut().model;
  const edges = [];
  for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) {
    const a = [i & 1, (i >> 1) & 1, (i >> 2) & 1], b = [j & 1, (j >> 1) & 1, (j >> 2) & 1];
    if (a.reduce((s, v, k) => s + Math.abs(v - b[k]), 0) !== 1) continue;
    edges.push(Array.from({ length: 25 }, (_, t) => m.xyz([...a.map((v, k) => v + (b[k] - v) * (t / 24)), 0])));
  }
  const ring = [[1, 0, 0], [1, 0, 1], [0, 0, 1], [0, 1, 1], [0, 1, 0], [1, 1, 0], [1, 0, 0]];
  const loop = [];
  for (let i = 0; i < 6; i++) for (let t = 0; t < 24; t++) loop.push(m.xyz([...ring[i].map((v, k) => v + (ring[i + 1][k] - v) * (t / 24)), 0]));
  loop.push(loop[0]);
  return { edges, ring: loop };
}
