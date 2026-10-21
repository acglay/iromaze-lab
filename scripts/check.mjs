// 物理・数値の検算。失敗があれば exit 1。  npm run check
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
globalThis.spectral = require("../vendor/spectral.js");
const C = await import("../color.js");

let fail = 0;
const ok = (cond, msg) => {
  console.log((cond ? "OK  " : "NG  ") + msg);
  if (!cond) fail++;
};
const dE = (x, y) => {
  const a = C.rgbToOklab(x), b = C.rgbToOklab(y);
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
};
const H = C.hexToRgb;
const TS = [0.25, 0.5, 0.75];

// 1. 白+白=白
for (const m of C.METHODS) {
  const worst = Math.max(...TS.map((t) => dE(m.fn(H("#ffffff"), H("#ffffff"), t), H("#ffffff"))));
  ok(worst < 0.01, `白+白=白 [${m.name}] ΔEok=${worst.toFixed(4)}`);
}

// 2. 同じ色どうし=その色(Oklab ΔE。0.02 ≒ ほぼ見分けがつかない)
const SAMPLES = ["#ff0000", "#00ff00", "#0000ff", "#ffff00", "#00ffff", "#ff00ff", "#000000", "#808080", "#c87533", "#3a6ea5", "#7fbf7f"];
for (const m of C.METHODS) {
  let worst = 0, at = "";
  for (const hex of SAMPLES) for (const t of TS) {
    const d = dE(m.fn(H(hex), H(hex), t), H(hex));
    if (d > worst) { worst = d; at = hex; }
  }
  ok(worst < 0.02, `同色どうし=その色 [${m.name}] 最大ΔEok=${worst.toFixed(4)} (${at})`);
}

// 3. 端点 t=0/1 は元の色
for (const m of C.METHODS) {
  const d = Math.max(dE(m.fn(H("#0000ff"), H("#ffff00"), 0), H("#0000ff")), dE(m.fn(H("#0000ff"), H("#ffff00"), 1), H("#ffff00")));
  ok(d < 1e-6, `端点が元の色 [${m.name}] ΔEok=${d.toExponential(1)}`);
}

// 4. 補色ペア: RGB直線の中間は彩度が下がる(両端の平均Cの半分未満)
const PAIRS = [["青×黄", "#0000ff", "#ffff00"], ["赤×シアン", "#ff0000", "#00ffff"], ["緑×マゼンタ", "#00ff00", "#ff00ff"]];
for (const [name, a, b] of PAIRS) {
  const ends = (C.oklch(H(a)).C + C.oklch(H(b)).C) / 2;
  const row = C.METHODS.map((m) => {
    const mid = m.fn(H(a), H(b), 0.5);
    const l = C.oklch(mid);
    return { m: m.id, C: l.C, h: l.h, hex: C.rgbToHex(mid) };
  });
  console.log(`     ${name} 両端の平均C=${ends.toFixed(3)} | ` + row.map((r) => `${r.m} C=${r.C.toFixed(3)} h=${r.h.toFixed(0)} ${r.hex}`).join(" | "));
  const rgb = row.find((r) => r.m === "rgb");
  ok(rgb.C < ends * 0.5, `${name}: RGB直線の中間で彩度が下がる (C ${rgb.C.toFixed(3)} < ${(ends * 0.5).toFixed(3)})`);
}

// 5. 絵の具式: 青+黄 → 緑(色相 100〜180°、彩度はRGBより高い)
{
  const p = C.oklch(C.mixPaint(H("#0000ff"), H("#ffff00"), 0.5));
  const r = C.oklch(C.mixRgb(H("#0000ff"), H("#ffff00"), 0.5));
  ok(p.h > 100 && p.h < 180 && p.C > r.C, `絵の具式 青+黄=緑 (h=${p.h.toFixed(0)}° C=${p.C.toFixed(3)} > RGB ${r.C.toFixed(3)})`);
}

// 6. Oklab 往復
{
  let worst = 0;
  for (const hex of SAMPLES) {
    const back = C.oklabToRgb(C.rgbToOklab(H(hex)));
    worst = Math.max(worst, ...back.map((v, i) => Math.abs(v - H(hex)[i])));
  }
  ok(worst < 1e-4, `Oklab往復 最大誤差=${worst.toExponential(1)}`);
}

console.log(fail ? `\n${fail} 件 NG` : "\nすべて OK");
process.exit(fail ? 1 : 0);
