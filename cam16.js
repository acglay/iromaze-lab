// CAM16(色の見えのモデル)の順方向: XYZ → 明度 J・クロマ C・色相 h。
// 背景の明るさ Yb(白=100)で「同じ色でも暗い背景の上では明るく見える」(明るさの対比)を予測できる。
// 色みの対比(赤い背景の上で緑っぽく見える等)は CAM16 では扱わない。
// 式は Li et al. 2017 / CIE 248。検算で colour-science 0.4.6 の XYZ_to_CAM16 と突き合わせる。
const M16 = [[0.401288, 0.650173, -0.051461], [-0.250268, 1.204414, 0.045854], [-0.002079, 0.048952, 0.953127]];
const mul = (m, v) => m.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
const SURROUND = { F: 1.0, c: 0.69, Nc: 1.0 }; // 「Average」(ふつうの明るさの部屋)

// xyz・white は Y=100 のスケール。LA = 順応輝度 cd/m²、Yb = 背景の明るさ(白=100)
export function cam16(xyz, white = [95.047, 100, 108.883], LA = 64, Yb = 20) {
  const { F, c, Nc } = SURROUND;
  const k = 1 / (5 * LA + 1), k4 = k ** 4;
  const FL = 0.2 * k4 * 5 * LA + 0.1 * (1 - k4) ** 2 * Math.cbrt(5 * LA);
  const n = Yb / white[1], z = 1.48 + Math.sqrt(n), Nbb = 0.725 * n ** -0.2;
  const D = Math.min(1, Math.max(0, F * (1 - (1 / 3.6) * Math.exp((-LA - 42) / 92))));
  const rgbW = mul(M16, white);
  const Dj = rgbW.map((v) => (D * white[1]) / v + 1 - D);
  const adapt = (v) => { const t = (FL * Math.abs(v)) / 100; const p = t ** 0.42; return (Math.sign(v) * 400 * p) / (p + 27.13) + 0.1; };
  const post = (x) => mul(M16, x).map((v, i) => adapt(v * Dj[i]));
  const [Rw, Gw, Bw] = post(white);
  const Aw = (2 * Rw + Gw + 0.05 * Bw - 0.305) * Nbb;
  const [R, G, B] = post(xyz);
  const A = (2 * R + G + 0.05 * B - 0.305) * Nbb;
  const J = 100 * Math.max(0, A / Aw) ** (c * z);
  const a = R - (12 * G) / 11 + B / 11, b = (R + G - 2 * B) / 9;
  let h = (Math.atan2(b, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  const et = 0.25 * (Math.cos((h * Math.PI) / 180 + 2) + 3.8);
  const t = ((50000 / 13) * Nc * Nbb * et * Math.hypot(a, b)) / (R + G + (21 * B) / 20);
  const C = t ** 0.9 * Math.sqrt(J / 100) * (1.64 - 0.29 ** n) ** 0.73;
  return { J, C, h };
}

// 背景 Yb1 の上の色 xyz と「同じ明るさに見える」色を、背景 Yb2 の上で探す(色度は保って明るさだけ変える)
export function matchLightness(xyz, Yb1, Yb2, LA = 64) {
  const x100 = xyz.map((v) => v * 100);
  const target = cam16(x100, undefined, LA, Yb1).J;
  let lo = 0, hi = 4;
  for (let i = 0; i < 40; i++) {
    const s = (lo + hi) / 2;
    if (cam16(x100.map((v) => v * s), undefined, LA, Yb2).J < target) lo = s; else hi = s;
  }
  return xyz.map((v) => (v * (lo + hi)) / 2);
}
