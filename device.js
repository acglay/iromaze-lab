// 混ぜた色が「どの画面で・どんな部屋で・どんな目で」見られるかの再現。
// すべて XYZ(SDRの白 = Y 1.0)の上で行う。順番: 明るさの上限 → 色域 → 映り込み → 色覚
import { xyzToLin, linToXYZ, clipTo, chromaReduce, WHITE, SDR_WHITE_NITS } from "./color.js";

// peak = 出せる最大の明るさ(SDRの白=1)。ideal は作業色域そのまま(何もしない)
export const DEVICES = [
  { id: "ideal", name: "理想(作業色域そのまま)", gamut: null, peak: Infinity },
  { id: "srgb", name: "sRGBモニタ", gamut: "srgb", peak: 1 },
  { id: "p3", name: "P3スマホ・Mac", gamut: "p3", peak: 1 },
  { id: "r2020", name: "Rec.2020テレビ(SDR)", gamut: "rec2020", peak: 1 },
  { id: "hdrphone", name: "HDRスマホ(P3・800nit)", gamut: "p3", peak: 800 / SDR_WHITE_NITS },
  { id: "hdr10", name: "HDR10テレビ(2020・1000nit)", gamut: "rec2020", peak: 1000 / SDR_WHITE_NITS },
];
export const DEVICE = Object.fromEntries(DEVICES.map((d) => [d.id, d]));

export const GAMUT_MAPS = [
  { id: "clip", name: "切りとる", note: "はみ出したRGBを0〜上限で切る(色相がずれることがある)" },
  { id: "chroma", name: "彩度を下げる", note: "Oklchで明るさと色相を保ったまま、入るまで彩度を下げる" },
];
export const TONE_MAPS = [
  { id: "clip", name: "切りとる", note: "上限より明るい所は同じ明るさに張りつく" },
  { id: "rolloff", name: "なめらかに圧縮", note: "上限の75%から先を指数でゆるやかに寝かせる" },
];
// 画面に映り込む周りの光(SDRの白に対する割合)。足し算で黒が浮き、色が薄くなる
export const ENVS = [
  { id: "dark", name: "暗い部屋", flare: 0 },
  { id: "room", name: "明るい室内", flare: 0.02 },
  { id: "sun", name: "屋外の日なた", flare: 0.15 },
];
// 色覚: Machado, Oliveira & Fernandes 2009(重さ1.0)。線形sRGBにかける
export const CVDS = [
  { id: "none", name: "ふつう(3色型)" },
  { id: "p", name: "P型(1型)", m: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]] },
  { id: "d", name: "D型(2型)", m: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]] },
  { id: "t", name: "T型(3型)", m: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]] },
];
export const CVD = Object.fromEntries(CVDS.map((c) => [c.id, c]));
export const ENV = Object.fromEntries(ENVS.map((e) => [e.id, e]));

export function toneMap(xyz, peak, mode) {
  const Y = xyz[1];
  if (mode !== "rolloff" || !isFinite(peak) || Y <= 0) return xyz;
  const knee = 0.75 * peak;
  if (Y <= knee) return xyz;
  const Y2 = knee + (peak - knee) * (1 - Math.exp(-(Y - knee) / (peak - knee)));
  return xyz.map((v) => (v * Y2) / Y);
}

// 1色を出力デバイスに通す。flags: はみ出しの種類(帯の下の目印用)
export function deviceOut(xyz, o) {
  const dev = DEVICE[o.device];
  const g = dev.gamut || o.gamut;
  const peak = dev.peak;
  const lin = xyzToLin(g, xyz);
  const flags = {
    outGamut: lin.some((v) => v < -1e-3),
    overPeak: isFinite(peak) && Math.max(...lin) > peak * 1.001,
  };
  if (dev.id === "ideal") return { xyz, flags };
  let out = toneMap(xyz, peak, o.toneMap);
  out = o.gamutMap === "chroma" ? chromaReduce(out, g, peak) : clipTo(out, g, peak);
  return { xyz: out, flags };
}

export function viewer(xyz, o) {
  let out = xyz;
  const fl = ENV[o.env].flare;
  if (fl > 0) out = out.map((v, i) => v + fl * WHITE[i]);
  const cvd = CVD[o.cvd];
  if (cvd.m) {
    const lin = xyzToLin("srgb", out);
    out = linToXYZ("srgb", [0, 1, 2].map((i) => cvd.m[i][0] * lin[0] + cvd.m[i][1] * lin[1] + cvd.m[i][2] * lin[2]));
  }
  return out;
}

export const pipeline = (xyz, o) => {
  const d = deviceOut(xyz, o);
  return { xyz: viewer(d.xyz, o), flags: d.flags };
};
