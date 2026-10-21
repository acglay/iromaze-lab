// 色の変換と3通りの混色。ブラウザでも Node(scripts/check.mjs)でも同じものを使う。
// 絵の具式は vendor/spectral.js(MIT)を globalThis.spectral として読み込んでおくこと。

export const clamp01 = (x) => Math.min(1, Math.max(0, x));
const toLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGam = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

export function hexToRgb(hex) {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
}
export function rgbToHex(rgb) {
  return "#" + rgb.map((c) => Math.round(clamp01(c) * 255).toString(16).padStart(2, "0")).join("");
}

// sRGB(0..1, ガンマ付き) <-> Oklab(Björn Ottosson 2020)
export function rgbToOklab([r, g, b]) {
  r = toLin(r); g = toLin(g); b = toLin(b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
export function linToOklab([r, g, b]) {
  return rgbToOklab([toGam(r), toGam(g), toGam(b)]);
}
// 戻り値は sRGB(ガンマ付き)。範囲外はクランプ前の値を返すので、表示側で clamp01 する
export function oklabToRgb([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return lin.map((c) => toGam(clamp01(c)));
}
export function oklch(rgb) {
  const [L, a, b] = rgbToOklab(rgb);
  let h = (Math.atan2(b, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { L, C: Math.hypot(a, b), h };
}

// 2色から「灰色の真ん中を避ける」3色目を決める。Oklch で L・C は両端の平均、
// 色相は近い側の弧の中間。sRGB に入らなければ C だけ下げて収める
function oklabToLinRaw([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}
// arc: "near"=色相環の近い側の真ん中 / "far"=反対側の真ん中。
// 片方が無彩色ならもう一方の色相(far はその反対色)、両方無彩色なら 暖色(near)/寒色(far)
export function autoThird(a, b, arc = "near") {
  const A = oklch(a), B = oklch(b);
  const L = (A.L + B.L) / 2;
  let C = (A.C + B.C) / 2;
  let h;
  if (A.C < 0.02 && B.C < 0.02) {
    C = 0.12;
    h = arc === "far" ? 250 : 60;
  } else {
    if (A.C < 0.02) h = B.h;
    else if (B.C < 0.02) h = A.h;
    else {
      let d = B.h - A.h;
      if (d > 180) d -= 360;
      if (d < -180) d += 360;
      h = A.h + d / 2;
    }
    if (arc === "far") h += 180;
  }
  const hr = (h * Math.PI) / 180;
  const inGamut = (c) => oklabToLinRaw([L, c * Math.cos(hr), c * Math.sin(hr)]).every((v) => v >= -1e-4 && v <= 1 + 1e-4);
  if (!inGamut(C)) {
    let lo = 0, hi = C;
    for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (inGamut(mid)) lo = mid; else hi = mid; }
    C = lo;
  }
  return oklabToRgb([L, C * Math.cos(hr), C * Math.sin(hr)]);
}

// ---- 3通りの混色(t=0 で a、t=1 で b)----
const lerp = (x, y, t) => x + (y - x) * t;

// RGB直線補間: 画面のsRGB値(ガンマ付き)をそのまま直線で結ぶ(CSSやお絵かきソフトの既定と同じ)
export function mixRgb(a, b, t) {
  return a.map((v, i) => lerp(v, b[i], t));
}
// Oklab: 知覚的に均等な空間で直線補間
export function mixOklab(a, b, t) {
  const A = rgbToOklab(a), B = rgbToOklab(b);
  return oklabToRgb(A.map((v, i) => lerp(v, B[i], t)));
}
// 絵の具式: 色→38バンドの分光反射率 → K/S を濃度で平均(単一定数Kubelka-Munk)→ 反射率 → 色
const paintCache = new Map();
function paintColor(rgb) {
  const key = rgb.map((c) => Math.round(clamp01(c) * 255)).join(",");
  let c = paintCache.get(key);
  if (!c) {
    c = new globalThis.spectral.Color(key.split(",").map(Number));
    paintCache.set(key, c);
  }
  return c;
}
export function mixPaint(a, b, t) {
  if (t <= 0) return a.slice();
  if (t >= 1) return b.slice();
  const m = globalThis.spectral.mix([paintColor(a), 1 - t], [paintColor(b), t]);
  return m.lRGB.map((c) => toGam(clamp01(c)));
}

export const METHODS = [
  { id: "rgb", name: "RGB直線", note: "画面の数値をそのまま平均", fn: mixRgb },
  { id: "oklab", name: "Oklab", note: "見た目の明るさ・色みで平均", fn: mixOklab },
  { id: "paint", name: "絵の具式", note: "分光反射率+Kubelka-Munk", fn: mixPaint },
];

// 2色 or 3色(a → c → b)の経路。t は 0..1
export function mixPath(fn, cols, t) {
  if (cols.length === 2) return fn(cols[0], cols[1], t);
  const [a, b, c] = cols;
  return t < 0.5 ? fn(a, c, t * 2) : fn(c, b, (t - 0.5) * 2);
}
