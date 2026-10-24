// 物理・数値の検算。失敗があれば exit 1。  npm run check
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
globalThis.spectral = require("../vendor/spectral.js");
const C = await import("../color.js");
const D = await import("../device.js");
const K = await import("../cmyk.js");
const I = await import("../illum.js");

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
  for (const sp of C.SPACES.filter((s) => !s.paint && !s.ink)) {
    let worst = 0;
    for (const g of ["srgb", "p3", "rec2020"]) for (const x of samples) worst = Math.max(worst, dE(sp.from(sp.to(x, g), g), x));
    ok(worst < 1e-4, `往復 [${sp.name}] 最大ΔEok=${worst.toExponential(1)}`);
  }
}

// 2. 白+白=白、同じ色どうし=その色(全空間・3作業色域)。インク式は「刷った色」が基準(白+白=紙)
const SAMPLES = ["#ff0000", "#00ff00", "#0000ff", "#ffff00", "#00ffff", "#ff00ff", "#000000", "#808080", "#c87533", "#3a6ea5", "#7fbf7f", "#ffffff"];
const printed = (x) => K.inkXYZ(K.printCMYK(x));
for (const id of IDS) {
  const ref = (x) => (id === "ink" ? printed(x) : x);
  const w = Math.max(...TS.map((t) => dE(C.mixXYZ(id, C.WHITE, C.WHITE, t), ref(C.WHITE))));
  let worst = 0, at = "";
  for (const g of ["srgb", "p3", "rec2020"]) for (const hex of SAMPLES) for (const t of TS) {
    const x = id === "paint" ? H(hex) : H(hex, g);
    const d = dE(C.mixXYZ(id, x, x, t, g), ref(x));
    if (d > worst) { worst = d; at = `${g} ${hex}`; }
  }
  ok(w < 0.01 && worst < 0.02, `白+白=${id === "ink" ? "紙" : "白"} ΔE=${w.toFixed(4)} / 同色=その色 最大ΔE=${worst.toFixed(4)} ${at} [${name(id)}]`);
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

// 11. 印刷(CMYK): インクの曲線は ISO 12647-2 PC1 のベタ5色+CMY+G に当てはめ、R/B の重ね刷りで答え合わせ
{
  const m = K.makeModel();
  const lab = (c) => C.xyzToLab(m.xyz(c));
  const T = [["紙", [0, 0, 0, 0], [95, 0, -2], 6], ["C", [1, 0, 0, 0], [55, -37, -50], 6], ["M", [0, 1, 0, 0], [48, 74, -3], 6], ["Y", [0, 0, 1, 0], [89, -5, 93], 6], ["K", [0, 0, 0, 1], [16, 0, 0], 6],
    ["CMY", [1, 1, 1, 0], [23, 0, 0], 6], ["G=C+Y", [1, 0, 1, 0], [50, -65, 27], 8], ["R=M+Y(答え合わせ)", [0, 1, 1, 0], [47, 68, 48], 10], ["B=C+M(答え合わせ)", [1, 1, 0, 0], [24, 22, -46], 12]];
  for (const [nm, c, t, tol] of T) {
    const l = lab(c), e = Math.hypot(...l.map((v, i) => v - t[i]));
    ok(e < tol, `印刷 ${nm}: Lab ${l.map((v) => v.toFixed(1)).join(",")} 目標 ${t.join(",")} ΔE76=${e.toFixed(1)}`);
  }
  const G = K.printGamut();
  const outs = ["#0000ff", "#ff0000", "#00ff00", "#ffff00", "#00ffff", "#ff00ff", "#ffffff"].map((h) => H(h));
  for (const mode of ["chroma", "clip"]) {
    const mapped = outs.map((x) => K.toPrint(x, mode));
    const allIn = mapped.every((x) => K.inPrintGamut(x, 0.006));
    const hueOk = outs.every((x, i) => { const a = C.oklch(x), b = C.oklch(mapped[i]); if (a.C < 0.02 || b.C < 0.01) return true; let d = Math.abs(a.h - b.h); if (d > 180) d = 360 - d; return d < 2; });
    ok(allIn && hueOk, `印刷に収める(${mode}): sRGBの原色・白はすべて刷れる範囲に入り、色相は2°以内`);
  }
  const outN = G.samples.filter((s) => !K.inPrintGamut(s.xyz)).length;
  ok(outN === 0, `刷れる見本(${G.samples.length}個)はすべて色域の内側と判定される(外 ${outN} 個)`);
  const inside = G.samples.filter((_, i) => i % 97 === 0).map((s) => s.xyz);
  ok(inside.every((x) => dE(K.toPrint(x), x) < 1e-9), `刷れる色(${inside.length}個)は印刷に収めても変わらない`);
  const rt = Math.max(...inside.slice(0, 40).map((x) => K.toCMYK(x).dE));
  ok(rt < 0.01, `刷れる色 → CMYK → 刷った色 の往復 最大ΔEok=${rt.toFixed(4)}`);
  ok(G.Lmax > 0.9 && G.Lmin < 0.35 && C.oklch(H("#0000ff")).C > C.oklch(K.toPrint(H("#0000ff"))).C, `印刷の明るさ L=${G.Lmin.toFixed(3)}〜${G.Lmax.toFixed(3)}(紙〜黒)、sRGBの青は刷ると彩度が下がる`);
}

// 12. むら: Oklab で混ぜた黒→白は均等(≈1.0)、RGB直線・線形RGBは不均等(明るさの変わり方がそろわない)
{
  const bw = (id) => C.evenness(Array.from({ length: 97 }, (_, i) => C.mixXYZ(id, [0, 0, 0], C.WHITE, i / 96)));
  const ok1 = bw("oklab"), rgb = bw("rgb"), lin = bw("lin");
  ok(ok1 < 1.01 && rgb > 1.1 && lin > rgb, `むら(黒→白): Oklab ${ok1.toFixed(3)} / RGB直線 ${rgb.toFixed(2)} / 線形RGB ${lin.toFixed(2)}`);
  const L = 0.62, Cc = 0.11;
  const ring = C.oklchToXYZ(L, Cc, 40), back = C.oklch(ring);
  ok(Math.abs(back.L - L) < 1e-6 && Math.abs(back.C - Cc) < 1e-6 && Math.abs(back.h - 40) < 1e-4, "Oklch → XYZ → Oklch の往復(ピッカー用)");
}

// 13. 照明と色順応
{
  // spectral.js の等色関数(×D65)を D65 の表で割って取り出した等色関数 → CIE のスペクトル軌跡の表と一致するか(D65 表の書き写しの確認)
  const c = I.cmf();
  let worst = 0;
  for (const [l, x, y] of C.LOCUS) { const i = (l - 380) / 10, s = c[i][0] + c[i][1] + c[i][2]; worst = Math.max(worst, Math.hypot(c[i][0] / s - x, c[i][1] / s - y)); }
  ok(worst < 0.001, `D65 で重みを外した等色関数の色度 = CIE 軌跡の表(最大差 ${worst.toFixed(4)})`);
  const xy = (id) => { const w = I.illumWhite(id), s = w[0] + w[1] + w[2]; return [w[0] / s, w[1] / s]; };
  for (const [id, ref] of [["d65", [0.3127, 0.329]], ["d50", [0.3457, 0.3585]], ["a", [0.4476, 0.4074]]]) {
    const p = xy(id);
    ok(Math.hypot(p[0] - ref[0], p[1] - ref[1]) < 0.0015, `${I.ILLUM[id].name} の白 = (${p[0].toFixed(4)}, ${p[1].toFixed(4)}) 規格 (${ref.join(", ")})`);
  }
  const R = new globalThis.spectral.Color([200, 80, 30]).R;
  ok(dE(I.reflToXYZ(R, "d65"), new globalThis.spectral.Color(R).XYZ) < 1e-9, "D65 の下の反射色 = spectral.js の XYZ(従来と同じ)");
  const flat = new Array(38).fill(1);
  // 白の出どころが2つある(spectral.js の等色関数×D65 と sRGB の行列)ので、差は小数3〜4桁目まで出る
  const wd = Math.max(...I.ILLUMINANTS.map((il) => dE(I.reflToXYZ(flat, il.id), C.WHITE)));
  ok(wd < 0.002, `どの照明でも、色順応のあと真っ白な紙(反射率1)は D65 の白(最大 ΔEok ${wd.toFixed(4)})`);
  const g = K.metamericGrays();
  const dg = (id) => dE(I.reflToXYZ(g.rk, id), I.reflToXYZ(g.rcmy, id));
  ok(dg("d65") < 0.005 && dg("a") > 10 * dg("d65") && dg("tri") > 10 * dg("d65"), `条件等色: 墨だけの灰色 vs CMYの灰色 ΔEok D65 ${dg("d65").toFixed(4)} → A ${dg("a").toFixed(3)} / 三波長 ${dg("tri").toFixed(3)}`);
  I.setIlluminant("a");
  const rgbSame = dE(C.mixXYZ("rgb", H("#0000ff"), H("#ffff00"), 0.5), C.mixXYZ("rgb", H("#0000ff"), H("#ffff00"), 0.5)) === 0;
  const paintA = C.mixPaint(H("#0000ff"), H("#ffff00"), 0.5);
  const endA = C.mixXYZ("paint", H("#2e8b57"), H("#ffff00"), 0), kneeA = C.mixPath("paint", [H("#ff0000"), H("#0000ff"), H("#2e8b57")], 0.5);
  const refA = I.reflToXYZ(C.paintReflectance(H("#2e8b57")));
  I.setIlluminant("d65");
  const paint65 = C.mixPaint(H("#0000ff"), H("#ffff00"), 0.5);
  ok(dE(endA, refA) < 1e-9 && dE(kneeA, refA) < 1e-9 && dE(endA, H("#2e8b57")) > 0.01, `照明 A では絵の具式の端点・3色の折れ目も「Aの下で塗った色」(元の色との差 ${dE(endA, H("#2e8b57")).toFixed(3)})`);
  ok(rgbSame && dE(paintA, paint65) > 0.01, `照明は反射色だけに効く(絵の具の青+黄 D65→A で ΔEok ${dE(paintA, paint65).toFixed(3)}、RGBは不変)`);
}

// 14. 演色性(CIE 13.3)。答えは colour-science 0.4.6 の colour_rendering_index(同じ分光分布 380〜750nm・10nm を渡した値)
{
  const CR = await import("../cri.js");
  const REF = {"d65": {"Ra": 99.98, "T": 6507.0, "R": [99.99, 99.99, 99.98, 99.96, 99.97, 99.98, 99.97, 99.96, 99.94, 100.0, 99.95, 99.77, 99.99, 99.99]}, "d50": {"Ra": 99.98, "T": 5004.0, "R": [99.98, 99.99, 99.98, 99.97, 99.98, 99.98, 99.97, 99.96, 99.94, 99.99, 99.96, 99.76, 99.98, 99.98]}, "a": {"Ra": 100.0, "T": 2856.0, "R": [100.0, 100.0, 99.99, 100.0, 100.0, 100.0, 100.0, 99.99, 99.99, 100.0, 100.0, 100.0, 100.0, 100.0]}, "led": {"Ra": 83.16, "T": 3931.0, "R": [82.29, 87.7, 90.07, 82.72, 81.29, 81.78, 88.47, 70.98, 23.25, 68.82, 79.81, 59.28, 83.19, 93.94]}, "tri": {"Ra": 72.21, "T": 4027.0, "R": [92.69, 83.95, 28.67, 70.96, 85.58, 65.95, 73.12, 76.75, 25.18, 24.02, 74.74, 27.87, 95.97, 53.5]}};
  for (const il of I.ILLUMINANTS) {
    const r = CR.cri(il.spd), ref = REF[il.id];
    const dRi = Math.max(...r.R.map((v, i) => Math.abs(v - ref.R[i])));
    ok(Math.abs(r.Ra - ref.Ra) < 0.3 && dRi < 1.5 && Math.abs(r.T - ref.T) < 5, `演色性 ${il.name}: Ra ${r.Ra.toFixed(2)}(colour-science ${ref.Ra})・${Math.round(r.T)}K(${ref.T})・R1〜R14 の最大差 ${dRi.toFixed(2)}`);
  }
}

// 15. CAM16 と明るさの対比。答えは colour-science 0.4.6 の XYZ_to_CAM16(Average、白 D65)
{
  const M = await import("../cam16.js");
  const REF = [{"xyz": [41.24, 21.26, 1.93], "Yb": 5.0, "LA": 64.0, "J": 50.6136, "C": 131.2286, "h": 27.404}, {"xyz": [41.24, 21.26, 1.93], "Yb": 5.0, "LA": 16.0, "J": 50.4717, "C": 130.5033, "h": 27.4099}, {"xyz": [41.24, 21.26, 1.93], "Yb": 20.0, "LA": 64.0, "J": 46.2862, "C": 113.5661, "h": 27.404}, {"xyz": [41.24, 21.26, 1.93], "Yb": 20.0, "LA": 16.0, "J": 46.1393, "C": 112.9177, "h": 27.4099}, {"xyz": [41.24, 21.26, 1.93], "Yb": 60.0, "LA": 64.0, "J": 40.6088, "C": 108.9478, "h": 27.404}, {"xyz": [41.24, 21.26, 1.93], "Yb": 60.0, "LA": 16.0, "J": 40.4581, "C": 108.2965, "h": 27.4099}, {"xyz": [18.05, 7.22, 95.05], "Yb": 5.0, "LA": 64.0, "J": 29.644, "C": 103.6274, "h": 282.8704}, {"xyz": [18.05, 7.22, 95.05], "Yb": 5.0, "LA": 16.0, "J": 29.5287, "C": 103.6264, "h": 282.7793}, {"xyz": [18.05, 7.22, 95.05], "Yb": 20.0, "LA": 64.0, "J": 25.2712, "C": 86.586, "h": 282.8704}, {"xyz": [18.05, 7.22, 95.05], "Yb": 20.0, "LA": 16.0, "J": 25.16, "C": 86.563, "h": 282.7793}, {"xyz": [18.05, 7.22, 95.05], "Yb": 60.0, "LA": 64.0, "J": 20.0054, "C": 78.9031, "h": 282.8704}, {"xyz": [18.05, 7.22, 95.05], "Yb": 60.0, "LA": 16.0, "J": 19.9025, "C": 78.8526, "h": 282.7793}, {"xyz": [20.0, 20.0, 20.0], "Yb": 5.0, "LA": 64.0, "J": 46.2001, "C": 7.3321, "h": 27.8614}, {"xyz": [20.0, 20.0, 20.0], "Yb": 5.0, "LA": 16.0, "J": 46.0589, "C": 6.8796, "h": 27.8174}, {"xyz": [20.0, 20.0, 20.0], "Yb": 20.0, "LA": 64.0, "J": 41.7471, "C": 6.3074, "h": 27.8614}, {"xyz": [20.0, 20.0, 20.0], "Yb": 20.0, "LA": 16.0, "J": 41.6027, "C": 5.9169, "h": 27.8174}, {"xyz": [20.0, 20.0, 20.0], "Yb": 60.0, "LA": 64.0, "J": 35.9899, "C": 5.9981, "h": 27.8614}, {"xyz": [20.0, 20.0, 20.0], "Yb": 60.0, "LA": 16.0, "J": 35.8443, "C": 5.6251, "h": 27.8174}, {"xyz": [35.0, 40.0, 10.0], "Yb": 5.0, "LA": 64.0, "J": 63.8897, "C": 53.1336, "h": 105.4349}, {"xyz": [35.0, 40.0, 10.0], "Yb": 5.0, "LA": 16.0, "J": 63.7607, "C": 53.1279, "h": 106.0052}, {"xyz": [35.0, 40.0, 10.0], "Yb": 20.0, "LA": 64.0, "J": 60.2411, "C": 46.6906, "h": 105.4349}, {"xyz": [35.0, 40.0, 10.0], "Yb": 20.0, "LA": 16.0, "J": 60.1034, "C": 46.6793, "h": 106.0052}, {"xyz": [35.0, 40.0, 10.0], "Yb": 60.0, "LA": 64.0, "J": 55.2717, "C": 45.8057, "h": 105.4349}, {"xyz": [35.0, 40.0, 10.0], "Yb": 60.0, "LA": 16.0, "J": 55.1239, "C": 45.7857, "h": 106.0052}, {"xyz": [95.047, 100.0, 108.883], "Yb": 5.0, "LA": 64.0, "J": 100.0, "C": 1.892, "h": 209.5422}, {"xyz": [95.047, 100.0, 108.883], "Yb": 5.0, "LA": 16.0, "J": 100.0, "C": 3.0341, "h": 209.4971}, {"xyz": [95.047, 100.0, 108.883], "Yb": 20.0, "LA": 64.0, "J": 100.0, "C": 1.7122, "h": 209.5422}, {"xyz": [95.047, 100.0, 108.883], "Yb": 20.0, "LA": 16.0, "J": 100.0, "C": 2.7458, "h": 209.4971}, {"xyz": [95.047, 100.0, 108.883], "Yb": 60.0, "LA": 64.0, "J": 100.0, "C": 1.7537, "h": 209.5422}, {"xyz": [95.047, 100.0, 108.883], "Yb": 60.0, "LA": 16.0, "J": 100.0, "C": 2.8122, "h": 209.4971}];
  let w = 0;
  for (const r of REF) {
    const o = M.cam16(r.xyz, undefined, r.LA, r.Yb);
    let dh = Math.abs(o.h - r.h); if (dh > 180) dh = 360 - dh;
    w = Math.max(w, Math.abs(o.J - r.J), Math.abs(o.C - r.C), r.C > 1 ? dh : 0);
  }
  ok(w < 0.001, `CAM16(J・C・h)= colour-science(${REF.length}通り・最大差 ${w.toExponential(1)})`);
  const g = [0.2, 0.2, 0.2].map((v) => v * 100);
  const J = [5, 20, 60].map((Yb) => M.cam16(g, undefined, 64, Yb).J);
  ok(J[0] > J[1] && J[1] > J[2], `同じ灰色でも背景が暗いほど明るく見える: J(Yb=5) ${J[0].toFixed(1)} > J(20) ${J[1].toFixed(1)} > J(60) ${J[2].toFixed(1)}`);
  const x = C.linToXYZ("srgb", [0.2, 0.2, 0.2]);
  const same = M.matchLightness(x, 20, 20), dark = M.matchLightness(x, 2, 20);
  ok(Math.abs(same[1] - x[1]) < 1e-6 && dark[1] > x[1], `明るさ合わせ: 同じ背景なら同じ色、黒い背景の上の灰色は灰色の背景では明るい灰色に相当(Y ${x[1].toFixed(3)} → ${dark[1].toFixed(3)})`);
}

// 16. 段差(ビット深度)
{
  const B = await import("../banding.js");
  // 丸めの誤差は半目盛り以内(ガンマの数値で)
  let worst = 0;
  for (let i = 0; i <= 200; i++) {
    const x = C.linToXYZ("srgb", [i / 200, (i / 200) ** 2, 0.3]);
    const q = B.quantize(x, { gamut: "srgb", enc: "gamma", bits: 10 });
    const a = C.xyzToRgb("srgb", x), b = C.xyzToRgb("srgb", q);
    worst = Math.max(worst, ...a.map((v, k) => Math.abs(v - b[k]) * 1023));
  }
  ok(worst <= 0.5 + 1e-6, `10bit に丸めた誤差は半目盛り以内(最大 ${worst.toFixed(3)} 目盛り)`);
  const ramp = (enc, bits) => B.steps(Array.from({ length: 4001 }, (_, i) => B.quantize(C.linToXYZ("srgb", [1, 1, 1].map(() => (i / 4000) ** 2.2)), { gamut: "srgb", enc, bits })));
  const g8 = ramp("gamma", 8), l8 = ramp("linear", 8), p8 = ramp("pq", 8), p10 = ramp("pq", 10), g6 = ramp("gamma", 6);
  ok(g8.visible === 0 && l8.visible > 0 && l8.maxStep > 3 * g8.maxStep, `黒→白 8bit: ガンマは見えやすい段 0(最大 ΔE*ab ${g8.maxStep.toFixed(2)})、線形は ${l8.visible} 段(最大 ${l8.maxStep.toFixed(2)})`);
  ok(p8.visible > 0 && p10.visible === 0 && g6.visible > 0, `PQ は 8bit で段が見え(${p8.visible})10bit で消える、6bit はガンマでも段が見える(${g6.visible})`);
  // ディザ: 同じ色をノイズ違いで丸めて「送る数値(ガンマ付き)」を平均すると、元の数値に戻る(丸めだけより近い)
  const x = C.linToXYZ("srgb", [0.0123, 0.0123, 0.0123]);
  const code = (v) => C.xyzToRgb("srgb", v)[1] * 63;
  const plain = code(B.quantize(x, { bits: 6 }));
  let avg = 0;
  for (let i = 0; i < 4000; i++) avg += code(B.quantize(x, { bits: 6, noise: [0, 1, 2].map((ch) => B.tri(i, 7, ch)) })) / 4000;
  ok(Math.abs(avg - code(x)) < 0.05 && Math.abs(avg - code(x)) < Math.abs(plain - code(x)) / 3, `ディザ(6bit)で送る数値の平均は元に戻る: 元 ${code(x).toFixed(3)} 目盛り / 丸めだけ ${plain.toFixed(0)} / ディザ平均 ${avg.toFixed(3)}`);
}

// 10. 色度図: スペクトル軌跡の表を独立な近似(Wyman, Sloan & Shirley 2013 の等色関数フィット)と突き合わせる
{
  const g = (l, mu, s1, s2) => Math.exp(-0.5 * ((l - mu) / (l < mu ? s1 : s2)) ** 2);
  const cmf = (l) => [
    1.056 * g(l, 599.8, 37.9, 31.0) + 0.362 * g(l, 442.0, 16.0, 26.7) - 0.065 * g(l, 501.1, 20.4, 26.2),
    0.821 * g(l, 568.8, 46.9, 40.5) + 0.286 * g(l, 530.9, 16.3, 31.1),
    1.217 * g(l, 437.0, 11.8, 36.0) + 0.681 * g(l, 459.0, 26.0, 13.8),
  ];
  let worst = 0, at = 0;
  for (const [l, x, y] of C.LOCUS.filter(([l]) => l >= 450 && l <= 620)) {
    const [fx, fy] = C.xyzToXy(cmf(l));
    const d = Math.hypot(fx - x, fy - y);
    if (d > worst) { worst = d; at = l; }
  }
  ok(worst < 0.02, `スペクトル軌跡の表と等色関数フィットの差 最大${worst.toFixed(4)} (${at}nm, 450〜620nm。フィット自体の誤差が520nm付近で約0.016)`);
  // 書き写しの誤り検出: 430〜690nm で隣どうしの間隔の比が 1/3〜3 に収まる(なめらかな曲線)
  const L = C.LOCUS.filter(([l]) => l >= 430 && l <= 690);
  const st = L.slice(1).map((p, i) => Math.hypot(p[1] - L[i][1], p[2] - L[i][2]));
  const bad = st.slice(1).map((d, i) => d / st[i]).filter((r) => r < 1 / 3 || r > 3);
  ok(bad.length === 0, `スペクトル軌跡の間隔がなめらか(比が1/3〜3の外 ${bad.length} 件)`);
  const [wx, wy] = C.xyzToXy(C.WHITE);
  ok(Math.abs(wx - 0.3127) < 1e-3 && Math.abs(wy - 0.329) < 1e-3, `D65 の白 = (${wx.toFixed(4)}, ${wy.toFixed(4)})`);
  const prim = ["srgb", "p3", "rec2020"].flatMap((gm) => [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map((v) => C.xyzToXy(C.linToXYZ(gm, v))));
  // 単色光に近い原色(P3の赤・Rec.2020の3色)は軌跡の上。10nmの折れ線は曲線より内側を通るので 0.003 の余裕をみる
  const segDist = ([px, py]) => Math.min(...C.LOCUS.slice(1).map(([, x2, y2], i) => {
    const [, x1, y1] = C.LOCUS[i], dx = x2 - x1, dy = y2 - y1;
    const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(px - x1 - t * dx, py - y1 - t * dy);
  }));
  ok(prim.every((p) => C.inLocus(p) || segDist(p) < 0.003), `3色域の原色は馬蹄形の内側か軌跡の上(軌跡からの最大距離 ${Math.max(...prim.filter((p) => !C.inLocus(p)).map(segDist)).toFixed(4)})`);
  const [u, v] = C.xyToUv([0.3127, 0.329]), back = C.uvToXy([u, v]);
  ok(Math.abs(u - 0.1978) < 1e-3 && Math.abs(v - 0.4683) < 1e-3 && Math.hypot(back[0] - 0.3127, back[1] - 0.329) < 1e-9, `D65 の u'v' = (${u.toFixed(4)}, ${v.toFixed(4)})・往復一致`);
  const a = H("#ff0000"), b = H("#0000ff");
  const p = [0.25, 0.5, 0.75].map((t) => C.xyzToXy(C.mixXYZ("lin", a, b, t)));
  const [ax, ay] = C.xyzToXy(a), [bx, by] = C.xyzToXy(b);
  const off = Math.max(...p.map(([x, y]) => Math.abs((bx - ax) * (y - ay) - (by - ay) * (x - ax)) / Math.hypot(bx - ax, by - ay)));
  ok(off < 1e-9, `線形RGBの混色は色度図で直線 (直線からのずれ ${off.toExponential(1)})`);
}

console.log(fail ? `\n${fail} 件 NG` : "\nすべて OK");
process.exit(fail ? 1 : 0);
