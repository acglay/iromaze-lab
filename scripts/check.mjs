// 物理・数値の検算。失敗があれば exit 1。  npm run check
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
globalThis.spectral = require("../vendor/spectral.js");
const C = await import("../color.js");
const D = await import("../device.js");

let fail = 0;
const ok = (cond, msg) => {
  console.log((cond ? "OK  " : "NG  ") + msg);
  if (!cond) fail++;
};
const dE = (x, y) => {
  const a = C.xyzToOklab(x), b = C.xyzToOklab(y);
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
};
const H = (hex, g = "srgb") => C.rgbToXYZ(g, C.hexToRgb(hex));
const hexOf = (xyz) => C.rgbToHex(C.xyzToRgb("srgb", xyz));
const TS = [0.25, 0.5, 0.75];
const IDS = C.SPACES.map((s) => s.id);
const name = (id) => C.SPACE[id].name;

// 1. 各空間の往復(絵の具式以外)。sRGB・P3・Rec.2020 の色と HDR(白の4倍)で
{
  const samples = [H("#ff0000"), H("#00ff00", "rec2020"), H("#0000ff", "p3"), H("#808080"), H("#c87533"), H("#ffffff").map((v) => v * 4)];
  for (const sp of C.SPACES.filter((s) => !s.paint)) {
    let worst = 0;
    for (const g of ["srgb", "p3", "rec2020"]) for (const x of samples) worst = Math.max(worst, dE(sp.from(sp.to(x, g), g), x));
    ok(worst < 1e-4, `往復 [${sp.name}] 最大ΔEok=${worst.toExponential(1)}`);
  }
}

// 2. 白+白=白、同じ色どうし=その色(全空間・3作業色域)
const SAMPLES = ["#ff0000", "#00ff00", "#0000ff", "#ffff00", "#00ffff", "#ff00ff", "#000000", "#808080", "#c87533", "#3a6ea5", "#7fbf7f", "#ffffff"];
for (const id of IDS) {
  const w = Math.max(...TS.map((t) => dE(C.mixXYZ(id, C.WHITE, C.WHITE, t), C.WHITE)));
  let worst = 0, at = "";
  for (const g of ["srgb", "p3", "rec2020"]) for (const hex of SAMPLES) for (const t of TS) {
    const x = id === "paint" ? H(hex) : H(hex, g);
    const d = dE(C.mixXYZ(id, x, x, t, g), x);
    if (d > worst) { worst = d; at = `${g} ${hex}`; }
  }
  ok(w < 0.01 && worst < 0.02, `白+白=白 ΔE=${w.toFixed(4)} / 同色=その色 最大ΔE=${worst.toFixed(4)} ${at} [${name(id)}]`);
}

// 3. 補色ペア: RGB直線の中間は彩度が下がる(両端の平均Cの半分未満)/中間の値を表示
const PAIRS = [["青×黄", "#0000ff", "#ffff00"], ["赤×シアン", "#ff0000", "#00ffff"], ["緑×マゼンタ", "#00ff00", "#ff00ff"]];
for (const [nm, a, b] of PAIRS) {
  const ends = (C.oklch(H(a)).C + C.oklch(H(b)).C) / 2;
  console.log(`     ${nm} 両端の平均C=${ends.toFixed(3)} | ` + IDS.map((id) => `${id} ${C.oklch(C.mixXYZ(id, H(a), H(b), 0.5)).C.toFixed(3)}`).join(" "));
  const rgb = C.oklch(C.mixXYZ("rgb", H(a), H(b), 0.5));
  ok(rgb.C < ends * 0.5, `${nm}: RGB直線の中間で彩度が下がる (C ${rgb.C.toFixed(3)} < ${(ends * 0.5).toFixed(3)})`);
}

// 4. 絵の具式: 青+黄 → 緑
{
  const p = C.oklch(C.mixPaint(H("#0000ff"), H("#ffff00"), 0.5));
  ok(p.h > 100 && p.h < 180 && p.C > 0.1, `絵の具式 青+黄=緑 (h=${p.h.toFixed(0)}° C=${p.C.toFixed(3)})`);
}

// 5. 自動の3色目
for (const [nm, a, b] of PAIRS) for (const arc of ["near", "far"]) {
  const c = C.autoThird(H(a), H(b), arc);
  const minC = Math.min(...Array.from({ length: 97 }, (_, i) => C.oklch(C.mixPath("rgb", [H(a), H(b), c], i / 96)).C));
  ok(minC > 0.05 && C.inGamut("srgb", c), `${nm} ${arc}: 自動3色目 ${hexOf(c)} 色域内・RGBの最小C=${minC.toFixed(3)}`);
}
for (const [nm, a, b] of [...PAIRS, ["白×黒", "#ffffff", "#000000"], ["白×赤", "#ffffff", "#ff0000"]]) {
  const n = C.oklch(C.autoThird(H(a), H(b), "near")), f = C.oklch(C.autoThird(H(a), H(b), "far"));
  let d = Math.abs(n.h - f.h); if (d > 180) d = 360 - d;
  ok(d > 90 && n.C > 0.03 && f.C > 0.03, `${nm}: 近 h=${n.h.toFixed(0)} / 遠 h=${f.h.toFixed(0)}`);
}

// 6. 色域: sRGBの原色は P3・Rec.2020 の内側/P3・Rec.2020 の原色は sRGB の外側/白は全部 Y=1
{
  const prim = ["#ff0000", "#00ff00", "#0000ff"];
  ok(prim.every((h) => C.inGamut("p3", H(h)) && C.inGamut("rec2020", H(h))), "sRGBの原色は P3・Rec.2020 の内側");
  ok(prim.every((h) => !C.inGamut("srgb", H(h, "p3")) && !C.inGamut("p3", H(h, "rec2020"))), "P3の原色はsRGBの外、Rec.2020の原色はP3の外");
  const ws = ["srgb", "p3", "rec2020"].map((g) => C.linToXYZ(g, [1, 1, 1]));
  ok(ws.every((w) => Math.abs(w[1] - 1) < 1e-6 && dE(w, C.WHITE) < 1e-4), "3色域とも白は D65・Y=1");
}

// 7. PQ と HDR 空間
{
  const e = [100, 203, 1000, 10000].map((n) => Math.abs(C.pqDec(C.pqEnc(n)) - n) / n);
  ok(Math.max(...e) < 1e-6 && Math.abs(C.pqEnc(10000) - 1) < 1e-9, `PQ往復 最大相対誤差=${Math.max(...e).toExponential(1)}、10000nit=1.0`);
  const pq100 = C.pqEnc(100);
  ok(Math.abs(pq100 - 0.508) < 0.002, `PQ(100nit)=${pq100.toFixed(4)}(規格の約0.508)`);
  const [, ct, cp] = C.xyzToIctcp(C.WHITE), [, az, bz] = C.xyzToJzazbz(C.WHITE);
  ok(Math.hypot(ct, cp) < 1e-6 && Math.hypot(az, bz) < 2e-3, `白は無彩色: ICtCp |CtCp|=${Math.hypot(ct, cp).toExponential(1)} Jzazbz |azbz|=${Math.hypot(az, bz).toExponential(1)}`);
}

// 8. 出力デバイス: 出力は必ずその色域・上限の中/色域内の色は変わらない/なめらかに圧縮は上限以下
{
  const wide = [H("#00ff00", "rec2020"), H("#ff0000", "rec2020"), H("#0000ff", "p3"), C.WHITE.map((v) => v * 6), H("#ff8000", "rec2020").map((v) => v * 3)];
  for (const dev of D.DEVICES.filter((d) => d.gamut)) for (const gm of ["clip", "chroma"]) for (const tm of ["clip", "rolloff"]) {
    const o = { device: dev.id, gamut: "rec2020", gamutMap: gm, toneMap: tm };
    const allIn = wide.every((x) => C.inGamut(dev.gamut, D.deviceOut(x, o).xyz, dev.peak, 1e-3));
    const keep = dE(D.deviceOut(H("#808080"), o).xyz, H("#808080")) < 1e-6;
    if (!allIn || !keep) ok(false, `出力 [${dev.name} ${gm}/${tm}] 色域内=${allIn} 灰色そのまま=${keep}`);
  }
  ok(true, "出力デバイス 5種×色域2×明るさ2: 出力は必ずデバイスの色域・上限の中、色域内の灰色は変わらない");
  const o = { device: "hdr10", gamut: "rec2020", gamutMap: "chroma", toneMap: "rolloff" };
  const y = [1, 3, 5, 10, 50].map((k) => D.deviceOut(C.WHITE.map((v) => v * k), o).xyz[1]);
  ok(y.every((v, i) => i === 0 || v > y[i - 1]) && y.at(-1) <= 1000 / 203 + 1e-6, `HDR10 なめらかに圧縮: 白×1,3,5,10,50 → Y=${y.map((v) => v.toFixed(2)).join(",")}(単調増加・上限4.93以下)`);
  const g = { device: "srgb", gamut: "rec2020", gamutMap: "chroma", toneMap: "clip" };
  const src = C.oklch(H("#00ff00", "rec2020")), out = C.oklch(D.deviceOut(H("#00ff00", "rec2020"), g).xyz);
  ok(Math.abs(out.h - src.h) < 3 && out.C < src.C, `彩度を下げる: Rec.2020の緑→sRGB 色相 ${src.h.toFixed(1)}→${out.h.toFixed(1)}、C ${src.C.toFixed(3)}→${out.C.toFixed(3)}`);
}

// 9. 見る人: 色覚・映り込み
{
  const base = { device: "ideal", gamut: "srgb", env: "dark" };
  for (const cvd of D.CVDS.filter((c) => c.m)) {
    const w = D.viewer(C.WHITE, { ...base, cvd: cvd.id });
    ok(dE(w, C.WHITE) < 1e-3, `${cvd.name}: 白は白のまま (ΔE=${dE(w, C.WHITE).toExponential(1)})`);
  }
  const r = H("#d03030"), g = H("#3a8a30");
  const n = dE(r, g), p = dE(D.viewer(r, { ...base, cvd: "p" }), D.viewer(g, { ...base, cvd: "p" }));
  ok(p < n * 0.5, `P型: 赤と緑の差が縮む ΔE ${n.toFixed(3)}→${p.toFixed(3)}`);
  const blk = D.viewer([0, 0, 0], { ...base, cvd: "none", env: "sun" });
  const cr = (1 + 0.15) / 0.15;
  ok(Math.abs(blk[1] - 0.15) < 1e-9, `屋外の日なた: 黒が Y=0.15 に浮く(コントラスト比 ${cr.toFixed(1)}:1)`);
}

console.log(fail ? `\n${fail} 件 NG` : "\nすべて OK");
process.exit(fail ? 1 : 0);
