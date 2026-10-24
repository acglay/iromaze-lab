// 段差(ビット深度)。画面へ送る数値を 2^bits 段に丸めたとき、グラデーションに出る段を再現する。
// 符号化: "gamma"=色域の伝達関数つき(ふつうの画面)/ "linear"=光の量のまま / "pq"=HDR の PQ(SDRの白=203nit)
// ディザ: 丸める前に ±1 段の三角分布ノイズ(TPDF)を足す。送る数値の平均が元の値に戻る(±0.5 段だと平均にかたよりが残る)
import { xyzToLin, linToXYZ, GAMUTS, pqEnc, pqDec, SDR_WHITE_NITS, xyzToLab } from "./color.js";

export const ENCODINGS = [
  { id: "gamma", name: "ガンマ(ふつう)" },
  { id: "linear", name: "線形のまま" },
  { id: "pq", name: "PQ(HDR)" },
];
export const BITS = [0, 10, 8, 6]; // 0 = 連続(丸めない)

function encode(lin, g, enc) {
  if (enc === "linear") return lin;
  if (enc === "pq") return lin.map((v) => pqEnc(Math.max(0, v) * SDR_WHITE_NITS));
  return lin.map(GAMUTS[g].enc);
}
function decode(code, g, enc) {
  if (enc === "linear") return code;
  if (enc === "pq") return code.map((v) => pqDec(v) / SDR_WHITE_NITS);
  return code.map(GAMUTS[g].dec);
}

// noise: 長さ3の [-1,1] 程度の値(三角分布)。null ならディザなし
export function quantize(xyz, { gamut = "srgb", enc = "gamma", bits = 8, noise = null } = {}) {
  if (!bits) return xyz;
  const q = 2 ** bits - 1;
  const code = encode(xyzToLin(gamut, xyz), gamut, enc).map((v, i) => {
    const c = Math.min(1, Math.max(0, v)) * q + (noise ? noise[i] : 0);
    return Math.min(q, Math.max(0, Math.round(c))) / q;
  });
  return linToXYZ(gamut, decode(code, gamut, enc));
}

// 三角分布のノイズ(-1〜1)。x,y,ch から決まる(描き直しても同じ模様)
export function tri(x, y, ch) {
  const h = (n) => { const s = Math.sin(n * 12.9898 + 78.233) * 43758.5453; return s - Math.floor(s); };
  return h(x * 1.37 + y * 7.91 + ch * 3.17) + h(x * 5.13 + y * 2.29 + ch * 9.71 + 1.7) - 1;
}

// 段の数と、隣どうしの段の色差 ΔE*ab(CIELAB)の最大と「1 を超える段」の数。
// Oklab は真っ黒のそばで差を大きく見積もる(3乗根の傾きが無限大)ので、黒の近くが直線の CIELAB で測る。ΔE*ab ≈ 1 が隣り合う色の見分けの目安
export function steps(xyzs) {
  const lab = xyzs.map(xyzToLab);
  let n = 1, maxStep = 0, visible = 0;
  for (let i = 1; i < lab.length; i++) {
    const d = Math.hypot(lab[i][0] - lab[i - 1][0], lab[i][1] - lab[i - 1][1], lab[i][2] - lab[i - 1][2]);
    if (d > 1e-6) { n++; maxStep = Math.max(maxStep, d); if (d > 1) visible++; }
  }
  return { n, maxStep, visible };
}
