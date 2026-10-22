// 照明(光源)と色順応。反射で見える色(絵の具・印刷)だけが照明で変わる。画面の色は自分で光るので変わらない。
// 反射率は spectral.js と同じ 38 バンド(380〜750nm・10nm)。
// spectral.js が持つ等色関数は「CIE 1931 × D65」で重み付け済みなので、D65 の分光分布で割って重みを外し、
// 好きな照明をかけ直す。最後に Bradford 変換で「照明の白 → D65 の白」に目を慣らす(内部表現が D65 のため)。

const BANDS = Array.from({ length: 38 }, (_, i) => 380 + i * 10);

// CIE 標準イルミナント D65・D50 の分光分布(10nm、380〜750nm、560nm=100)
const D65 = [49.98, 54.65, 82.75, 91.49, 93.43, 86.68, 104.86, 117.01, 117.81, 114.86, 115.92, 108.81, 109.35, 107.8, 104.79, 107.69, 104.41, 104.05, 100, 96.33, 95.79, 88.69, 90.01, 89.6, 87.7, 83.29, 83.7, 80.03, 80.21, 82.28, 78.28, 69.72, 71.61, 74.35, 61.6, 69.89, 75.09, 63.59];
const D50 = [24.49, 29.87, 49.31, 56.51, 60.03, 57.82, 74.82, 87.25, 90.61, 91.37, 95.11, 91.96, 95.72, 96.61, 97.13, 102.1, 100.75, 102.32, 100, 97.74, 98.92, 93.5, 97.69, 99.27, 99.04, 95.72, 98.86, 95.67, 98.19, 103, 99.13, 87.38, 91.6, 92.89, 76.85, 86.51, 92.58, 78.23];
// CIE 標準イルミナント A(白熱電球 2856K)は式で決まっている
const A = BANDS.map((l) => 100 * (560 / l) ** 5 * (Math.exp(1.435e7 / (2848 * 560)) - 1) / (Math.exp(1.435e7 / (2848 * l)) - 1));
const gauss = (l, mu, s) => Math.exp(-0.5 * ((l - mu) / s) ** 2);
// 近似: 白色LED(青色LED 450nm + 黄緑と赤の蛍光体。色度 (0.384, 0.379) ≈ 3950K になるよう重みを決めた)、
// 三波長形蛍光灯(435/545/611nm の鋭い線+弱い連続光)
const LED = BANDS.map((l) => 50 * (gauss(l, 450, 11) + gauss(l, 560, 50) + 0.6 * gauss(l, 630, 30)));
const TRI = BANDS.map((l) => 100 * (0.05 + 0.55 * gauss(l, 435, 6) + 1.0 * gauss(l, 545, 6) + 0.85 * gauss(l, 611, 7)));

export const ILLUMINANTS = [
  { id: "d65", name: "昼の光 D65", spd: D65 },
  { id: "d50", name: "印刷の標準 D50", spd: D50 },
  { id: "a", name: "白熱電球 A", spd: A },
  { id: "led", name: "白色LED(近似)", spd: LED },
  { id: "tri", name: "三波長蛍光灯(近似)", spd: TRI },
];
export const ILLUM = Object.fromEntries(ILLUMINANTS.map((i) => [i.id, i]));

// 重みを外した等色関数(相対値)。spectral.js の単位インパルス応答 ÷ D65
let CMF = null;
export function cmf() {
  if (!CMF) CMF = BANDS.map((_, i) => new globalThis.spectral.Color(BANDS.map((__, j) => (i === j ? 1 : 0))).XYZ.map((v) => v / D65[i]));
  return CMF;
}

// Bradford の色順応(von Kries 型)
const BFD = [[0.8951, 0.2664, -0.1614], [-0.7502, 1.7135, 0.0367], [0.0389, -0.0685, 1.0296]];
const mul = (m, v) => m.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
const inv3 = (m) => {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const A0 = e * i - f * h, B0 = -(d * i - f * g), C0 = d * h - e * g, det = a * A0 + b * B0 + c * C0;
  return [[A0 / det, -(b * i - c * h) / det, (b * f - c * e) / det], [B0 / det, (a * i - c * g) / det, -(a * f - c * d) / det], [C0 / det, -(a * h - b * g) / det, (a * e - b * d) / det]];
};
const BFD_INV = inv3(BFD);

// 照明 id の下で反射率 R を見たときの XYZ(照明の白は Y=1)。adapt=true なら D65 の白に慣らした値
const cache = new Map();
function setup(id) {
  let s = cache.get(id);
  if (s) return s;
  const c = cmf(), spd = ILLUM[id].spd;
  const k = 1 / c.reduce((acc, row, i) => acc + row[1] * spd[i], 0);
  const w = c.map((row, i) => row.map((v) => v * spd[i] * k)); // 1バンドあたりの重み
  const white = [0, 1, 2].map((j) => w.reduce((acc, row) => acc + row[j], 0));
  const d65 = [0, 1, 2].map((j) => c.reduce((acc, row, i) => acc + row[j] * D65[i], 0) / c.reduce((acc, row, i) => acc + row[1] * D65[i], 0));
  const sw = mul(BFD, white), dw = mul(BFD, d65);
  const scale = [dw[0] / sw[0], dw[1] / sw[1], dw[2] / sw[2]];
  s = { w, white, d65, scale };
  cache.set(id, s);
  return s;
}
export function reflToXYZ(R, id = current, adapt = true) {
  const { w, scale } = setup(id);
  const xyz = [0, 1, 2].map((j) => w.reduce((acc, row, i) => acc + row[j] * R[i], 0));
  if (!adapt) return xyz;
  const lms = mul(BFD, xyz);
  return mul(BFD_INV, lms.map((v, i) => v * scale[i]));
}
export const illumWhite = (id) => setup(id).white;

// いまの照明(アプリ全体で1つ)。D65 のときは従来どおり(spectral.js の XYZ と一致する)
let current = "d65";
export const setIlluminant = (id) => { current = ILLUM[id] ? id : "d65"; };
export const getIlluminant = () => current;
