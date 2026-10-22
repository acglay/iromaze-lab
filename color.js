// 色の変換と混色。ブラウザでも Node(scripts/check.mjs)でも同じものを使う。
// 内部表現は XYZ(D65, 相対値: SDRの白 = Y 1.0 = 203 nit。HDRでは 1 を超える)。
// 絵の具式は vendor/spectral.js(MIT)を globalThis.spectral として読み込んでおくこと。
import { printCMYK, inkXYZ } from "./cmyk.js";

export const clamp01 = (x) => Math.min(1, Math.max(0, x));
export const SDR_WHITE_NITS = 203; // ITU-R BT.2408 の基準白

// ---- 3x3 行列 ----
export const mul = (m, v) => [
  m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
  m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
  m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
];
export function inv3(m) {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [
    [A / det, -(b * i - c * h) / det, (b * f - c * e) / det],
    [B / det, (a * i - c * g) / det, -(a * f - c * d) / det],
    [C / det, -(a * h - b * g) / det, (a * e - b * d) / det],
  ];
}

// ---- 作業色域(原色)と伝達関数 ----
const sgn = (f) => (v) => (v < 0 ? -f(-v) : f(v)); // 範囲外(負・1超え)もそのまま延長する
const srgbEnc = sgn((c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055));
const srgbDec = sgn((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
const R2020_A = 1.09929682680944, R2020_B = 0.018053968510807; // CSS Color 4 の rec2020
const r2020Enc = sgn((c) => (c < R2020_B ? 4.5 * c : R2020_A * c ** 0.45 - (R2020_A - 1)));
const r2020Dec = sgn((c) => (c < R2020_B * 4.5 ? c / 4.5 : ((c + R2020_A - 1) / R2020_A) ** (1 / 0.45)));

const mk = (id, name, toXYZ, enc, dec) => ({ id, name, toXYZ, fromXYZ: inv3(toXYZ), enc, dec });
export const GAMUTS = {
  srgb: mk("srgb", "sRGB", [
    [0.4123907992659595, 0.357584339383878, 0.1804807884018343],
    [0.21263900587151036, 0.715168678767756, 0.07219231536073371],
    [0.01933081871559185, 0.11919477979462599, 0.9505321522496606],
  ], srgbEnc, srgbDec),
  p3: mk("p3", "Display P3", [
    [0.4865709486482162, 0.26566769316909306, 0.1982172852343625],
    [0.2289745640697488, 0.6917385218365064, 0.079286914093745],
    [0, 0.04511338185890264, 1.043944368900976],
  ], srgbEnc, srgbDec),
  rec2020: mk("rec2020", "Rec.2020", [
    [0.6369580483012914, 0.14461690358620832, 0.1688809751641721],
    [0.2627002120112671, 0.6779980715188708, 0.05930171646986196],
    [0, 0.028072693049087428, 1.060985057710791],
  ], r2020Enc, r2020Dec),
};
export const WHITE = mul(GAMUTS.srgb.toXYZ, [1, 1, 1]); // D65 (Y=1)

export const linToXYZ = (g, lin) => mul(GAMUTS[g].toXYZ, lin);
export const xyzToLin = (g, xyz) => mul(GAMUTS[g].fromXYZ, xyz);
export const rgbToXYZ = (g, rgb) => linToXYZ(g, rgb.map(GAMUTS[g].dec)); // rgb = 伝達関数つき 0..1
export const xyzToRgb = (g, xyz) => xyzToLin(g, xyz).map(GAMUTS[g].enc);
export const inGamut = (g, xyz, peak = 1, eps = 1e-4) => xyzToLin(g, xyz).every((v) => v >= -eps && v <= peak + eps);

export function hexToRgb(hex) {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
}
export function rgbToHex(rgb) {
  return "#" + rgb.map((c) => Math.round(clamp01(c) * 255).toString(16).padStart(2, "0")).join("");
}

// ---- Oklab(Ottosson 2020。線形sRGB経由。範囲外の値もそのまま通す)----
export function xyzToOklab(xyz) {
  const [r, g, b] = xyzToLin("srgb", xyz);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
export function oklabToXYZ([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return linToXYZ("srgb", [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]);
}
const toPolar = ([L, a, b]) => {
  let h = (Math.atan2(b, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return [L, Math.hypot(a, b), h];
};
const fromPolar = ([L, C, h]) => [L, C * Math.cos((h * Math.PI) / 180), C * Math.sin((h * Math.PI) / 180)];
export function oklch(xyz) {
  const [L, C, h] = toPolar(xyzToOklab(xyz));
  return { L, C, h };
}

// ---- CIELAB(D65)----
const LAB_E = 216 / 24389, LAB_K = 24389 / 27;
export function xyzToLab(xyz) {
  const f = xyz.map((v, i) => {
    const t = v / WHITE[i];
    return t > LAB_E ? Math.cbrt(t) : (LAB_K * t + 16) / 116;
  });
  return [116 * f[1] - 16, 500 * (f[0] - f[1]), 200 * (f[1] - f[2])];
}
export function labToXYZ([L, a, b]) {
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
  const inv = (f) => (f ** 3 > LAB_E ? f ** 3 : (116 * f - 16) / LAB_K);
  return [inv(fx) * WHITE[0], (L > LAB_K * LAB_E ? fy ** 3 : L / LAB_K) * WHITE[1], inv(fz) * WHITE[2]];
}

// ---- PQ(SMPTE ST 2084)。入力は nit ----
const PQ = { m1: 2610 / 16384, m2: (2523 / 4096) * 128, c1: 3424 / 4096, c2: (2413 / 4096) * 32, c3: (2392 / 4096) * 32 };
export function pqEnc(nits, m2 = PQ.m2) {
  const y = Math.max(0, nits) / 10000;
  const p = y ** PQ.m1;
  return ((PQ.c1 + PQ.c2 * p) / (1 + PQ.c3 * p)) ** m2;
}
export function pqDec(v, m2 = PQ.m2) {
  const p = Math.max(0, v) ** (1 / m2);
  return 10000 * (Math.max(0, p - PQ.c1) / (PQ.c2 - PQ.c3 * p)) ** (1 / PQ.m1);
}

// ---- ICtCp(ITU-R BT.2100, PQ)----
const ICT_LMS = [[1688, 2146, 262], [683, 2951, 462], [99, 309, 3688]].map((r) => r.map((v) => v / 4096));
const ICT_OUT = [[2048, 2048, 0], [6610, -13613, 7003], [17933, -17390, -543]].map((r) => r.map((v) => v / 4096));
const ICT_LMS_INV = inv3(ICT_LMS), ICT_OUT_INV = inv3(ICT_OUT);
export function xyzToIctcp(xyz) {
  const lms = mul(ICT_LMS, xyzToLin("rec2020", xyz)).map((v) => pqEnc(v * SDR_WHITE_NITS));
  return mul(ICT_OUT, lms);
}
export function ictcpToXYZ(v) {
  const lms = mul(ICT_OUT_INV, v).map((x) => pqDec(x) / SDR_WHITE_NITS);
  return linToXYZ("rec2020", mul(ICT_LMS_INV, lms));
}

// ---- Jzazbz(Safdar et al. 2017)----
const JZ = { b: 1.15, g: 0.66, d: -0.56, d0: 1.6295499532821566e-11, m2: (1.7 * 2523) / 32 };
const JZ_LMS = [[0.41478972, 0.579999, 0.014648], [-0.20151, 1.120649, 0.0531008], [-0.0166008, 0.2648, 0.6684799]];
const JZ_IAB = [[0.5, 0.5, 0], [3.524, -4.066708, 0.542708], [0.199076, 1.096799, -1.295875]];
const JZ_LMS_INV = inv3(JZ_LMS), JZ_IAB_INV = inv3(JZ_IAB);
export function xyzToJzazbz(xyz) {
  const [X, Y, Z] = xyz.map((v) => v * SDR_WHITE_NITS);
  const Xp = JZ.b * X - (JZ.b - 1) * Z, Yp = JZ.g * Y - (JZ.g - 1) * X;
  const lms = mul(JZ_LMS, [Xp, Yp, Z]).map((v) => pqEnc(v, JZ.m2));
  const [Iz, az, bz] = mul(JZ_IAB, lms);
  return [((1 + JZ.d) * Iz) / (1 + JZ.d * Iz) - JZ.d0, az, bz];
}
export function jzazbzToXYZ([Jz, az, bz]) {
  const j = Jz + JZ.d0;
  const Iz = j / (1 + JZ.d - JZ.d * j);
  const lms = mul(JZ_IAB_INV, [Iz, az, bz]).map((v) => pqDec(v, JZ.m2));
  const [Xp, Yp, Z] = mul(JZ_LMS_INV, lms);
  const X = (Xp + (JZ.b - 1) * Z) / JZ.b;
  const Y = (Yp + (JZ.g - 1) * X) / JZ.g;
  return [X, Y, Z].map((v) => v / SDR_WHITE_NITS);
}

// ---- HSL(作業色域の伝達関数つきRGBの上で)----
function rgbToHsl([r, g, b]) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (d < 1e-9) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1) || 1e-9);
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return [h, s, l];
}
function hslToRgb([h, s, l]) {
  const c = (1 - Math.abs(2 * l - 1)) * s, hp = (((h % 360) + 360) % 360) / 60, x = c * (1 - Math.abs((hp % 2) - 1)), m = l - c / 2;
  const [r, g, b] = hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  return [r + m, g + m, b + m];
}

// ---- 混ぜ方(色空間)----
// to/from は XYZ <-> その空間(g = 作業色域)。hue = 色相の添字(極座標の空間だけ)、chroma = 無彩色判定に使う添字
const lerp = (x, y, t) => x + (y - x) * t;
export const SPACES = [
  { id: "rgb", name: "RGB直線", note: "作業色域の数値(ガンマ付き)をそのまま平均", to: (x, g) => xyzToRgb(g, x), from: (v, g) => rgbToXYZ(g, v) },
  { id: "lin", name: "線形RGB", note: "光の量で平均(光の足し算・XYZと同じ)", to: (x, g) => xyzToLin(g, x), from: (v, g) => linToXYZ(g, v) },
  { id: "hsl", name: "HSL", note: "色相・彩度・明度(色相は近回り)", to: (x, g) => rgbToHsl(xyzToRgb(g, x)), from: (v, g) => rgbToXYZ(g, hslToRgb(v)), hue: 0, chroma: 1 },
  { id: "lab", name: "CIELAB", note: "1976年の知覚均等空間", to: xyzToLab, from: labToXYZ },
  { id: "lch", name: "CIELCh", note: "CIELABの極座標(色相は近回り)", to: (x) => toPolar(xyzToLab(x)), from: (v) => labToXYZ(fromPolar(v)), hue: 2, chroma: 1 },
  { id: "oklab", name: "Oklab", note: "見た目の明るさ・色みで平均", to: xyzToOklab, from: oklabToXYZ },
  { id: "oklch", name: "Oklch", note: "Oklabの極座標(色相は近回り)", to: (x) => toPolar(xyzToOklab(x)), from: (v) => oklabToXYZ(fromPolar(v)), hue: 2, chroma: 1 },
  { id: "ictcp", name: "ICtCp", note: "HDR用(BT.2100・PQ)", to: xyzToIctcp, from: ictcpToXYZ },
  { id: "jzazbz", name: "Jzazbz", note: "HDR用の知覚均等空間", to: xyzToJzazbz, from: jzazbzToXYZ },
  { id: "paint", name: "絵の具式", note: "分光反射率+Kubelka-Munk(sRGB内・明るさ1まで)", paint: true },
  { id: "ink", name: "インク式", note: "CMYKの網点の割合を直線で混ぜてコート紙に刷る(両端も刷った色)", ink: true },
];
export const SPACE = Object.fromEntries(SPACES.map((s) => [s.id, s]));

const CHROMA_EPS = { hsl: 0.02, lch: 2, oklch: 0.02 };
export function mixXYZ(spaceId, a, b, t, g = "srgb") {
  const sp = SPACE[spaceId];
  if (sp.ink) {
    const ca = printCMYK(a), cb = printCMYK(b);
    return inkXYZ(ca.map((v, i) => lerp(v, cb[i], Math.min(1, Math.max(0, t)))));
  }
  if (t <= 0) return a.slice();
  if (t >= 1) return b.slice();
  if (sp.paint) return mixPaint(a, b, t);
  const va = sp.to(a, g), vb = sp.to(b, g);
  if (sp.hue !== undefined) {
    const eps = CHROMA_EPS[spaceId];
    if (va[sp.chroma] < eps) va[sp.hue] = vb[sp.hue];
    if (vb[sp.chroma] < eps) vb[sp.hue] = va[sp.hue];
    const d = vb[sp.hue] - va[sp.hue];
    if (d > 180) vb[sp.hue] -= 360;
    if (d < -180) vb[sp.hue] += 360;
  }
  return sp.from(va.map((v, i) => lerp(v, vb[i], t)), g);
}

// 絵の具式: 色→38バンドの分光反射率 → K/S を濃度で平均(単一定数Kubelka-Munk)→ 反射率 → 色
// 反射なので sRGB の 0..1 にクランプしてから混ぜる(広色域・HDRの色は sRGB の端に寄せられる)
const paintCache = new Map();
function paintColor(xyz) {
  const rgb = xyzToRgb("srgb", xyz).map((c) => clamp01(c) * 255);
  const key = rgb.map((c) => c.toFixed(2)).join(",");
  let c = paintCache.get(key);
  if (!c) {
    c = new globalThis.spectral.Color(rgb);
    paintCache.set(key, c);
  }
  return c;
}
export function mixPaint(a, b, t) {
  if (t <= 0) return a.slice();
  if (t >= 1) return b.slice();
  const m = globalThis.spectral.mix([paintColor(a), 1 - t], [paintColor(b), t]);
  return linToXYZ("srgb", m.lRGB);
}

// 2色 or 3色(a → c → b)の経路。t は 0..1
export function mixPath(spaceId, cols, t, g = "srgb") {
  if (cols.length === 2) return mixXYZ(spaceId, cols[0], cols[1], t, g);
  const [a, b, c] = cols;
  return t < 0.5 ? mixXYZ(spaceId, a, c, t * 2, g) : mixXYZ(spaceId, c, b, (t - 0.5) * 2, g);
}

// ---- 色域に収める ----
export function clipTo(xyz, g, peak = 1) {
  return linToXYZ(g, xyzToLin(g, xyz).map((v) => Math.min(peak, Math.max(0, v))));
}
// Oklch で L・h を保ち C だけ下げる。L 自体が範囲外なら最後はクリップ
export function chromaReduce(xyz, g, peak = 1) {
  if (inGamut(g, xyz, peak)) return xyz;
  const [L, C, h] = toPolar(xyzToOklab(xyz));
  let lo = 0, hi = C;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut(g, oklabToXYZ(fromPolar([L, mid, h])), peak)) lo = mid; else hi = mid;
  }
  return clipTo(oklabToXYZ(fromPolar([L, lo, h])), g, peak);
}

// 2色から「灰色の真ん中を避ける」3色目(作業色域 g の中)。
// arc: "near"=色相環の近い側の真ん中 / "far"=反対側。L・C は両端の平均。
// 片方が無彩色ならもう一方の色相(far はその反対色)、両方無彩色なら 暖色(near)/寒色(far)
export function autoThird(a, b, arc = "near", g = "srgb") {
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
  const peak = Math.max(1, ...xyzToLin(g, a), ...xyzToLin(g, b));
  return chromaReduce(oklabToXYZ(fromPolar([L, C, h])), g, peak);
}

// ---- 色度図 ----
export function xyzToXy([X, Y, Z]) {
  const s = X + Y + Z;
  return s > 1e-9 ? [X / s, Y / s] : null;
}
export function xyzToUv([X, Y, Z]) {
  const d = X + 15 * Y + 3 * Z;
  return d > 1e-9 ? [(4 * X) / d, (9 * Y) / d] : null;
}
export const xyToUv = ([x, y]) => { const d = -2 * x + 12 * y + 3; return [(4 * x) / d, (9 * y) / d]; };
export const uvToXy = ([u, v]) => { const d = 6 * u - 16 * v + 12; return [(9 * u) / d, (4 * v) / d]; };
// スペクトル軌跡(馬蹄形の弓の部分)。CIE 1931 2° の色度座標 10nm 刻み [λ, x, y]
export const LOCUS = [
  [380, 0.1741, 0.005], [390, 0.1738, 0.0049], [400, 0.1733, 0.0048], [410, 0.1726, 0.0048], [420, 0.1714, 0.0051],
  [430, 0.1689, 0.0069], [440, 0.1644, 0.0109], [450, 0.1566, 0.0177], [460, 0.144, 0.0297], [470, 0.1241, 0.0578],
  [480, 0.0913, 0.1327], [490, 0.0454, 0.295], [500, 0.0082, 0.5384], [510, 0.0139, 0.7502], [520, 0.0743, 0.8338],
  [530, 0.1547, 0.8059], [540, 0.2296, 0.7543], [550, 0.3016, 0.6923], [560, 0.3731, 0.6245], [570, 0.4441, 0.5547],
  [580, 0.5125, 0.4866], [590, 0.5752, 0.4242], [600, 0.627, 0.3725], [610, 0.6658, 0.334], [620, 0.6915, 0.3083],
  [630, 0.7079, 0.292], [640, 0.719, 0.2809], [650, 0.726, 0.274], [660, 0.73, 0.27], [670, 0.732, 0.268],
  [680, 0.7334, 0.2666], [690, 0.7344, 0.2656], [700, 0.7347, 0.2653],
];
// 馬蹄形(弓+紫の直線)の内側か
export function inLocus([x, y]) {
  let inside = false;
  for (let i = 0, j = LOCUS.length - 1; i < LOCUS.length; j = i++) {
    const [, xi, yi] = LOCUS[i], [, xj, yj] = LOCUS[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
