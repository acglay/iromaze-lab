import { SPACES, SPACE, GAMUTS, paintReflectance, mixPath, hexToRgb, rgbToHex, rgbToXYZ, xyzToRgb, xyzToLin, linToXYZ, xyzToOklab, oklabToXYZ, xyzToLab, oklch, oklchToXYZ, autoThird, clipTo, chromaReduce, inGamut, evenness } from "./color.js";
import { DEVICES, DEVICE, GAMUT_MAPS, TONE_MAPS, ENVS, CVDS, pipeline, deviceOut } from "./device.js";
import { screen, initHdr, paintBand, paintFlags, cssColor, toScreenRgb } from "./present.js";
import { MODES, VIEW_PRESETS, view, setPreset, renderView, bindView, rgbOutline } from "./view.js";
import { printOutline, toCMYK, metamericGrays, printGamut } from "./cmyk.js";
import { ILLUMINANTS, ILLUM, setIlluminant, reflToXYZ, reflUnderSpd } from "./illum.js";
import { cri, planck, daylight, TCS, TCS_NAMES } from "./cri.js";
import { cam16, matchLightness } from "./cam16.js";
import { ENCODINGS, BITS, quantize, tri, steps } from "./banding.js";

const PRESET_GROUPS = [
  ["補色ペア", [
    { name: "青×黄", a: "#0000ff", b: "#ffff00" },
    { name: "赤×シアン", a: "#ff0000", b: "#00ffff" },
    { name: "緑×マゼンタ", a: "#00ff00", b: "#ff00ff" },
    { name: "橙×青", a: "#ff8000", b: "#0060ff" },
    { name: "紫×黄緑", a: "#8000ff", b: "#80ff00" },
    { name: "赤×緑", a: "#e02020", b: "#20a040" },
  ]],
  ["絵の具の定番", [
    { name: "群青×山吹", a: "#1e3a8a", b: "#f2b01e" },
    { name: "紺×レモン", a: "#16235c", b: "#fff44f" },
    { name: "赤×青", a: "#d42020", b: "#1f3fbf" },
    { name: "黄×赤", a: "#ffd400", b: "#d42020" },
    { name: "朱×白", a: "#e8452c", b: "#ffffff" },
    { name: "黒×黄", a: "#111111", b: "#ffe000" },
    { name: "緑×赤茶", a: "#2e8b57", b: "#a0442a" },
  ]],
  ["自然の色", [
    { name: "夕焼け", a: "#ff5e3a", b: "#2a2a72" },
    { name: "空と砂", a: "#6ec6ff", b: "#e8c48a" },
    { name: "若葉×桜", a: "#8bc34a", b: "#f6a5c0" },
    { name: "紅葉", a: "#c0392b", b: "#f1c40f" },
    { name: "海と珊瑚", a: "#0b6fa4", b: "#ff7f6a" },
    { name: "ラベンダー×麦", a: "#9a7fd1", b: "#e3c76b" },
  ]],
  ["明るさ", [
    { name: "白×黒", a: "#ffffff", b: "#000000" },
    { name: "白×赤", a: "#ffffff", b: "#ff0000" },
    { name: "黒×シアン", a: "#000000", b: "#00ffff" },
    { name: "白×青", a: "#ffffff", b: "#0000ff" },
  ]],
];
const PRESETS = PRESET_GROUPS.flatMap(([, ps]) => ps);
const DEFAULT = { ...PRESETS[0], name: "青×黄+近回り", use3: true, arc: "near" }; // 開いた直後は3色(自動・近回り)
const FAV_KEY = "iromaze-lab-favs-v1";
const METHOD_COL = { rgb: "#ffffff", lin: "#9ad0ff", hsl: "#ff7ad9", lab: "#b6f36a", lch: "#6af3c0", oklab: "#4fd1ff", oklch: "#3d8bff", ictcp: "#ffe14d", jzazbz: "#ff8a4d", paint: "#ffa94d", ink: "#c792ff" };
// 見え方の設定(リセットでは変えない「モード」)。URLには既定値と違うものだけ書く
const MODE_DEFAULTS = { methods: ["rgb", "oklab", "paint"], gamut: "srgb", device: "ideal", gm: "chroma", tm: "rolloff", env: "dark", cvd: "none", scr: "auto", il: "d65" };
const K_DEFAULT = 1;

const $ = (id) => document.getElementById(id);
const state = {
  a: DEFAULT.a, b: DEFAULT.b, c: "#00c070", cAuto: true, cArc: "near", use3: true, preset: DEFAULT,
  k: { a: K_DEFAULT, b: K_DEFAULT, c: K_DEFAULT },
  ...structuredClone(MODE_DEFAULTS),
};
const opts = () => ({ device: state.device, gamut: state.gamut, gamutMap: state.gm, toneMap: state.tm, env: state.env, cvd: state.cvd });

// ---- hub(🏠だけ。進捗は持たない)----
{
  const m = location.hash.match(/#hub=([0-9a-f]+)/);
  if (m) {
    localStorage.setItem("hub-token", m[1]);
    history.replaceState(null, "", location.pathname + location.search);
  }
  if (localStorage.getItem("hub-token")) $("home").hidden = false;
}

// ---- URLハッシュ(#a=0000ff&b=ffff00&c=auto&g=p3&dev=srgb …) ----
const HASH_KEYS = { gamut: "g", device: "dev", gm: "gm", tm: "tm", env: "env", cvd: "cvd", scr: "scr", il: "il" };
function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  const hex = (v) => (v && /^[0-9a-f]{6}$/i.test(v) ? "#" + v.toLowerCase() : null);
  if (hex(p.get("a")) && hex(p.get("b"))) {
    state.a = hex(p.get("a"));
    state.b = hex(p.get("b"));
    state.use3 = !!hex(p.get("c")) || p.get("c") === "auto" || p.get("c") === "far";
    state.cAuto = !hex(p.get("c"));
    state.cArc = p.get("c") === "far" ? "far" : "near";
    if (hex(p.get("c"))) state.c = hex(p.get("c"));
    for (const n of ["a", "b", "c"]) state.k[n] = Math.min(10, Math.max(0.05, Number(p.get("k" + n)) || K_DEFAULT));
    state.preset = { name: "URL", a: state.a, b: state.b, c: state.use3 && !state.cAuto ? state.c : undefined, use3: state.use3, arc: state.cArc, k: { ...state.k } };
  }
  for (const [key, h] of Object.entries(HASH_KEYS)) state[key] = p.get(h) || MODE_DEFAULTS[key];
  const m = (p.get("m") || "").split(",").filter((id) => SPACE[id]);
  state.methods = m.length ? m : [...MODE_DEFAULTS.methods];
}
function writeHash() {
  let h = `a=${state.a.slice(1)}&b=${state.b.slice(1)}` + (state.use3 ? `&c=${state.cAuto ? (state.cArc === "far" ? "far" : "auto") : state.c.slice(1)}` : "");
  for (const n of ["a", "b", "c"]) if (state.k[n] !== K_DEFAULT) h += `&k${n}=${state.k[n]}`;
  for (const [key, k] of Object.entries(HASH_KEYS)) if (state[key] !== MODE_DEFAULTS[key]) h += `&${k}=${state[key]}`;
  if (state.methods.join(",") !== MODE_DEFAULTS.methods.join(",")) h += `&m=${state.methods.join(",")}`;
  history.replaceState(null, "", "#" + h);
}

// 入力色: hex を作業色域の原色で読み、明るさ倍率をかけた XYZ
const colorXYZ = (n) => rgbToXYZ(state.gamut, hexToRgb(state[n])).map((v) => v * state.k[n]);
const VARIANTS = [
  { key: "2", label: "なし", cols: () => [colorXYZ("a"), colorXYZ("b")] },
  { key: "3", label: "あり", cols: () => [colorXYZ("a"), colorXYZ("b"), colorXYZ("c")] },
];
const activeVariants = () => (state.use3 ? VARIANTS : VARIANTS.slice(0, 1));

function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast.tid);
  toast.tid = setTimeout(() => t.classList.remove("show"), msg.length > 30 ? 4000 : 1600);
}

// ---- 帯のデータ: 混ぜる → 出力デバイス → 見る人 ----
const N = 96;
function rowData(spaceId, cols) {
  const o = opts();
  const raw = Array.from({ length: N + 1 }, (_, i) => mixPath(spaceId, cols, i / N, state.gamut));
  const out = raw.map((x) => pipeline(x, o));
  const seen = out.map((r) => r.xyz);
  const Cs = seen.map((x) => oklch(x).C);
  const ends = (Cs[0] + Cs[N]) / 2;
  let min = Infinity;
  for (const c of Cs) min = Math.min(min, c);
  return { raw, seen, flags: out.map((r) => r.flags), mid: seen[N / 2], midC: Cs[N / 2], ends, min, even: evenness(seen) };
}
// SDRの画面でHDRを見せるときの縮小率(デバイスの上限、理想なら入力の最大の明るさを画面の白に)
function sdrScale() {
  const dev = DEVICE[state.device];
  const peak = isFinite(dev.peak) ? dev.peak : Math.max(1, ...["a", "b", "c"].map((n) => Math.max(...xyzToLin(state.gamut, colorXYZ(n)))));
  return peak > 1.0001 ? 1 / peak : 1;
}
const useHdr = () => !!screen.gpu && state.scr === "auto";

function buildBands() {
  $("bands").innerHTML = state.methods.map((id) => {
    const m = SPACE[id];
    return `<div class="band" data-m="${id}">
      <div class="bandhead"><b><span style="color:${METHOD_COL[id]}">■</span> ${m.name}</b><small>${m.note}</small></div>
      ${VARIANTS.map((v) => `<div class="vrow" data-v="${v.key}">
        <span class="vlabel">${v.label}</span>
        <div class="vbody">
          <canvas class="bandcv"></canvas>
          <div class="flags" title="赤紫=デバイスの色域の外 / 黄=明るさの上限を超えた / 橙=両方"></div>
          <div class="stats"><span class="sw"></span><span class="num txt"></span><span class="meter" title="いちばん濁ったところ(最小C)÷ 両はしの平均彩度"><i></i></span><span class="num pct"></span></div>
        </div>
      </div>`).join("")}
    </div>`;
  }).join("");
}

function renderBands() {
  const hdr = useHdr(), scale = hdr ? 1 : sdrScale();
  for (const id of state.methods) {
    for (const v of VARIANTS) {
      const el = document.querySelector(`.band[data-m="${id}"] .vrow[data-v="${v.key}"]`);
      el.hidden = v.key === "3" && !state.use3;
      if (el.hidden) continue;
      const d = rowData(id, v.cols());
      paintBand(el.querySelector(".bandcv"), d.seen, { hdr, scale });
      paintFlags(el.querySelector(".flags"), d.flags);
      const ratio = d.ends > 1e-4 ? d.min / d.ends : 1;
      el.querySelector(".sw").style.background = cssColor(d.mid, scale);
      el.querySelector(".sw").title = "押すと真ん中の色のsRGB値と印刷用CMYK";
      el.querySelector(".sw")._mid = d.raw[N / 2];
      el.querySelector(".txt").textContent = `中C=${d.midC.toFixed(3)} 最小C=${d.min.toFixed(3)} むら${d.even.toFixed(1)}`;
      el.querySelector(".meter i").style.width = Math.min(100, ratio * 100) + "%";
      el.querySelector(".pct").textContent = d.ends > 1e-4 ? `${Math.round(ratio * 100)}%` : "(灰色)";
      el.dataset.midc = d.midC.toFixed(4);
      el.dataset.minc = d.min.toFixed(4);
      el.dataset.even = d.even.toFixed(3);
      el.dataset.out = d.flags.filter((f) => f.outGamut || f.overPeak).length;
    }
  }
  const dev = DEVICE[state.device];
  const parts = [`作業色域 ${GAMUTS[state.gamut].name}`, `→ ${dev.name}`];
  if (state.cvd !== "none") parts.push(`→ 色覚 ${CVDS.find((c) => c.id === state.cvd).name}`);
  if (state.il !== "d65") parts.push(`(絵の具・インクは ${ILLUMINANTS.find((i) => i.id === state.il).name} の下)`);
  if (state.env !== "dark") parts.push(`→ ${ENVS.find((e) => e.id === state.env).name}`);
  parts.push(`→ この画面(${hdr ? "HDR" : screen.p3 ? "P3" : "sRGB"})`);
  if (scale < 1) parts.push(`※HDRを1/${(1 / scale).toFixed(1)}に暗くして表示`);
  $("pipeinfo").textContent = parts.join(" ");
}

// 真ん中の色見本を押す → sRGB 表記と、刷るならの CMYK(混ぜた結果そのもの。色覚・映り込みは通さない)
$("bands").addEventListener("click", (e) => {
  const sw = e.target.closest(".sw");
  if (!sw?._mid) return;
  const { cmyk, dE } = toCMYK(sw._mid);
  const pct = cmyk.map((v) => Math.round(v * 100));
  toast(`真ん中 ${rgbToHex(xyzToRgb("srgb", sw._mid))}(sRGB)/ 印刷なら C${pct[0]} M${pct[1]} Y${pct[2]} K${pct[3]}` + (dE > 0.02 ? `(刷れない色。差ΔEok ${dE.toFixed(2)})` : ""));
});

// ---- 色の空間の図(view.js)----
const HINTS = {
  rgb: (g) => `${g}の数値の立方体(黒が下・白が上)。点線=灰色の軸。補色を直線で結ぶとこの軸を突きぬける。「上から」で見ると色相の六角形。`,
  oklab: () => "縦=明るさL、横=色み(a,b)。中心の点線(灰色の軸)に近いほど濁った色。",
  xy: () => "CIE 1931 xy色度図。弓=虹の単色光、真ん中=白(D65)。三角形=色域。線形RGBの混色はこの図で必ず直線になる。",
  uv: () => "CIE 1976 u'v'色度図。xyより距離が見た目の差に近い。三角形=色域。",
};
function renderCube() {
  const dev = DEVICE[state.device];
  const layers = (state.use3 ? [[VARIANTS[0].cols(), 0.3], [VARIANTS[1].cols(), 1]] : [[VARIANTS[0].cols(), 1]]).map(([c, alpha]) => ({
    alpha,
    paths: state.methods.map((id) => {
      // 太線=デバイスが出す色、細い点線=混ぜた色そのまま(理想デバイスでは同じなので点線は省く)
      const raw = Array.from({ length: 49 }, (_, i) => mixPath(id, c, i / 48, state.gamut));
      if (dev.id === "ideal") return { id, color: METHOD_COL[id], pts: raw };
      return { id, color: METHOD_COL[id], raw, pts: raw.map((x) => deviceOut(x, opts()).xyz) };
    }),
  }));
  const devOutline = dev.print ? printOutline() : dev.gamut && dev.gamut !== state.gamut ? rgbOutline(dev.gamut) : null;
  renderView($("cube"), { gamut: state.gamut, dev: devOutline, layers, ends: activeVariants().at(-1).cols(), p3: screen.p3 });
  $("cubehint").textContent = HINTS[view.mode](GAMUTS[state.gamut].name) +
    (devOutline ? ` 橙の破線=${dev.name}${dev.print ? "(CMYのベタと重ねの輪/K=0の立体)" : ""}が出せる範囲。` : "") +
    (dev.id !== "ideal" ? " 太線=デバイスが実際に出す色、細い点線=混ぜた色そのまま。" : "") +
    (view.mode === "xy" || view.mode === "uv" ? " ドラッグで移動・ピンチで拡大。" : " ドラッグで回転・ピンチで拡大。");
  // 凡例(押すとその方式だけ強調)
  const lg = $("vlegend");
  if (lg.dataset.key !== state.methods.join(",")) {
    lg.dataset.key = state.methods.join(",");
    lg.innerHTML = "";
    for (const id of state.methods) {
      const b = chip(SPACE[id].name, [METHOD_COL[id]], () => { view.focus = view.focus === id ? null : id; renderCube(); });
      b.dataset.m = id;
      lg.appendChild(b);
    }
  }
  lg.querySelectorAll(".chip").forEach((b) => b.classList.toggle("off", !!view.focus && view.focus !== b.dataset.m));
  document.querySelectorAll("#vmode button").forEach((b) => b.classList.toggle("on", b.dataset.v === view.mode));
  $("vpreset").hidden = view.mode === "xy" || view.mode === "uv";
}
{
  bindView($("cube"), () => renderCube());
  const mk = (box, items, onPick) => {
    for (const it of items) {
      const b = document.createElement("button");
      b.textContent = it.name; b.dataset.v = it.id;
      b.addEventListener("click", () => { onPick(it.id); renderCube(); });
      $(box).appendChild(b);
    }
  };
  mk("vmode", MODES, (id) => { view.mode = id; view.zoom = 1; view.panX = view.panY = 0; });
  mk("vpreset", [...VIEW_PRESETS, { id: "reset", name: "↺" }], (id) => setPreset(id === "reset" ? "tilt" : id));
}

// ---- パネル ----
function chip(label, colors, onClick, onDelete) {
  const b = document.createElement("button");
  b.className = "chip";
  b.innerHTML = colors.map((c) => `<span class="dot" style="background:${c}"></span>`).join("") + `<span></span>`;
  b.lastChild.textContent = label;
  b.addEventListener("click", onClick);
  if (onDelete) {
    const x = document.createElement("span");
    x.className = "x"; x.textContent = "×";
    x.addEventListener("click", (e) => { e.stopPropagation(); onDelete(); });
    b.appendChild(x);
  }
  return b;
}
// 色(色の数値+明るさ)だけを入れかえる。見え方の設定(色域・デバイス等)はお気に入り由来のときだけ
function applyPreset(p) {
  state.preset = p;
  state.a = p.a; state.b = p.b;
  state.use3 = !!p.c || !!p.use3;
  state.cAuto = !p.c;
  state.cArc = p.arc === "far" ? "far" : "near";
  if (p.c) state.c = p.c;
  state.k = { ...{ a: K_DEFAULT, b: K_DEFAULT, c: K_DEFAULT }, ...(p.k || {}) };
  if (p.mode) Object.assign(state, structuredClone(p.mode));
  syncInputs(); rebuild();
}
const autoHex = (a, b, arc) => rgbToHex(xyzToRgb(state.gamut, autoThird(rgbToXYZ(state.gamut, hexToRgb(a)), rgbToXYZ(state.gamut, hexToRgb(b)), arc, state.gamut)));
function renderPresets() {
  const box = $("presets");
  box.innerHTML = "";
  for (const [group, ps] of PRESET_GROUPS) {
    const h = document.createElement("div");
    h.className = "group"; h.textContent = group;
    box.appendChild(h);
    for (const p of ps) {
      // 2色 + 3色(近回り・遠回り)を1行に
      const row = document.createElement("div");
      row.className = "prow";
      row.appendChild(chip(p.name, [p.a, p.b], () => applyPreset(p)));
      for (const [arc, label] of [["near", "近回り"], ["far", "遠回り"]]) {
        const c = autoHex(p.a, p.b, arc);
        const v = { name: `${p.name}+${label}`, a: p.a, b: p.b, use3: true, arc };
        const el = chip(label, [p.a, c, p.b], () => applyPreset(v));
        el.classList.add("mini");
        el.title = `${p.name} を ${c} 経由で(${label})`;
        row.appendChild(el);
      }
      box.appendChild(row);
    }
  }
}
const loadFavs = () => { try { return JSON.parse(localStorage.getItem(FAV_KEY)) || []; } catch { return []; } };
function renderFavs() {
  const box = $("favs");
  box.innerHTML = "";
  const favs = loadFavs();
  if (!favs.length) box.innerHTML = '<span class="hint">☆で今の組み合わせを保存(色域・デバイス等の設定も)</span>';
  favs.forEach((f, i) =>
    box.appendChild(chip(f.name, [f.a, f.b, f.c].filter(Boolean), () => applyPreset(f), () => {
      if (!confirm(`「${f.name}」を消しますか?`)) return;
      const all = loadFavs(); all.splice(i, 1);
      localStorage.setItem(FAV_KEY, JSON.stringify(all)); renderFavs();
    }))
  );
}

// 選択ボタン群(作業色域・はみ出し処理・環境・画面)
function segment(id, items, key, after) {
  const box = $(id);
  box.innerHTML = "";
  for (const it of items) {
    const b = document.createElement("button");
    b.textContent = it.name; b.dataset.v = it.id;
    if (it.note) b.title = it.note;
    b.addEventListener("click", () => { state[key] = it.id; after?.(); syncInputs(); rebuild(); });
    box.appendChild(b);
  }
}
function renderMethods() {
  const box = $("methods");
  box.innerHTML = "";
  for (const sp of SPACES) {
    const b = chip(sp.name, [METHOD_COL[sp.id]], () => {
      const on = state.methods.includes(sp.id);
      if (on && state.methods.length === 1) return toast("1つは残してください");
      state.methods = on ? state.methods.filter((x) => x !== sp.id) : SPACES.map((s) => s.id).filter((x) => x === sp.id || state.methods.includes(x));
      syncInputs(); rebuild();
    });
    b.dataset.m = sp.id; b.title = sp.note;
    box.appendChild(b);
  }
}
// 明るさスライダー(名前 / range / 値 / 個別↺)。対数で 0.1〜10 倍
function renderKRows() {
  $("krows").innerHTML = ["a", "b", "c"].map((n) => `<div class="row" data-k="${n}">
    <span class="slabel" title="${n.toUpperCase()} の明るさ(SDRの白=1)">${n.toUpperCase()} の明るさ</span>
    <input type="range" min="-1" max="1" step="0.01" />
    <span class="sval"></span><button class="rs" title="1倍に戻す">↺</button></div>`).join("");
  document.querySelectorAll("#krows .row").forEach((row) => {
    const n = row.dataset.k;
    row.querySelector("input").addEventListener("input", (e) => {
      state.k[n] = Math.round(10 ** Number(e.target.value) * 100) / 100;
      if (n === "c") state.cAuto = false;
      syncInputs(); update();
    });
    row.querySelector(".rs").addEventListener("click", () => { state.k[n] = K_DEFAULT; syncInputs(); update(); });
  });
}

function syncInputs() {
  if (state.cAuto) {
    state.c = autoHex(state.a, state.b, state.cArc);
    state.k.c = Math.round(((state.k.a + state.k.b) / 2) * 100) / 100;
  }
  document.querySelectorAll("#carc button").forEach((b) => b.classList.toggle("on", state.cAuto && b.dataset.arc === state.cArc));
  for (const n of ["a", "b", "c"]) {
    const el = $("c" + n);
    el.style.background = cssColor(rgbToXYZ(state.gamut, hexToRgb(state[n])));
    el.classList.toggle("editing", picking === n);
  }
  syncPicker();
  $("use3").checked = state.use3; $("c3row").hidden = !state.use3;
  for (const [id, key] of [["gamut", "gamut"], ["device", "device"], ["gm", "gm"], ["tm", "tm"], ["env", "env"], ["cvd", "cvd"], ["scr", "scr"], ["il", "il"]])
    document.querySelectorAll(`#${id} button`).forEach((b) => b.classList.toggle("on", b.dataset.v === state[key]));
  document.querySelectorAll("#methods .chip").forEach((b) => b.classList.toggle("off", !state.methods.includes(b.dataset.m)));
  document.querySelectorAll("#krows .row").forEach((row) => {
    const k = state.k[row.dataset.k];
    row.querySelector("input").value = Math.log10(k);
    row.querySelector(".sval").textContent = `×${k.toFixed(2)} ${Math.round(k * 203)}nit`;
    row.querySelector(".rs").classList.toggle("show", k !== K_DEFAULT);
  });
  $("screeninfo").textContent =
    `色域 ${screen.p3 ? "P3以上" : "sRGB"} / ${screen.hdr ? "HDR対応" : "SDR"}` +
    (screen.hdr ? (screen.gpu ? "(WebGPUで1を超える明るさを出せる)" : "(WebGPUのHDR出力が使えないのでSDRで再現)") : "") +
    "。この画面より広い色・明るい色は、画面側で切られて見える。";
}
// ---- 照明と条件等色の表 ----
// 行: A/B/C を「絵の具で塗った」と「印刷した」(どちらも D65 でその色に合わせたもの)+ 墨だけの灰色 vs CMYの灰色
function renderMeta() {
  const rows = [];
  for (const n of state.use3 ? ["a", "b", "c"] : ["a", "b"]) {
    const x = rgbToXYZ(state.gamut, hexToRgb(state[n]));
    rows.push({ name: n.toUpperCase(), r1: paintReflectance(x), r2: printGamut().model.spectrum(toCMYK(x).cmyk) });
  }
  const g = metamericGrays();
  rows.push({ name: "灰色 墨/CMY", r1: g.rk, r2: g.rcmy, gray: true });
  const head = `<tr><th></th>${ILLUMINANTS.map((il) => `<th class="${il.id === state.il ? "cur" : ""}">${il.name.replace("(近似)", "")}</th>`).join("")}</tr>`;
  const body = rows.map((r) => {
    const cells = ILLUMINANTS.map((il) => {
      const p = reflToXYZ(r.r1, il.id), q = reflToXYZ(r.r2, il.id);
      const a = xyzToOklab(p), b = xyzToOklab(q), d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      return `<td class="${il.id === state.il ? "cur" : ""}"><div class="mpair"><i style="background:${cssColor(p)}"></i><i style="background:${cssColor(q)}"></i></div><span class="mde ${d >= 0.02 ? "big" : ""}">${d.toFixed(3)}</span></td>`;
    }).join("");
    return `<tr><td class="rowh">${r.gray ? "灰色<br><small>墨だけ / CMY</small>" : r.name + "<br><small>塗る / 刷る</small>"}</td>${cells}</tr>`;
  }).join("");
  $("metatable").innerHTML = `<table class="mtab">${head}${body}</table>`;
  renderCri();
}

// 演色性: いまの照明の Ra・R9 と、試験色14色を「基準の光(上)/この照明(下)」で並べる
const criCache = new Map();
function renderCri() {
  const il = ILLUM[state.il];
  let r = criCache.get(il.id);
  if (!r) { r = cri(il.spd); criCache.set(il.id, r); }
  const ref = r.T < 5000 ? planck(r.T) : daylight(r.T);
  const cells = TCS.map((t, i) => `<div title="${TCS_NAMES[i]}"><div class="sw2"><i style="background:${cssColor(reflUnderSpd(t, ref))}"></i><i style="background:${cssColor(reflUnderSpd(t, il.spd))}"></i></div><span class="${r.R[i] < 80 ? "low" : ""}">R${i + 1} ${Math.round(r.R[i])}</span></div>`).join("");
  $("cri").innerHTML = `<div class="crihead">演色性(${il.name}): <b>Ra ${r.Ra.toFixed(0)}</b> ・ R9(あざやかな赤) ${r.R[8].toFixed(0)} ・ 色温度 ${Math.round(r.T)}K(基準=${r.T < 5000 ? "黒体" : "CIE昼光"})</div><div class="crigrid">${cells}</div>`;
}

// ---- 段差(ビット深度)----
const bd = { src: "kA", bits: 8, enc: "gamma", dither: false, dark: false };
function renderBd() {
  const dev = DEVICE[state.device];
  const g = dev.gamut || state.gamut;
  const A = colorXYZ("a"), B = colorXYZ("b");
  const t0 = 0, t1 = bd.dark ? 0.25 : 1; // 暗い所を拡大 = 前から 1/4 だけ
  const at = (t) => (bd.src === "kA" ? A.map((v) => v * t) : mixPath(state.methods[0], [A, B], t, state.gamut));
  const cv = $("bdStrip");
  const w = Math.max(2, Math.round(cv.clientWidth * devicePixelRatio)), h = Math.max(1, Math.round(cv.clientHeight * devicePixelRatio));
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  const cont = Array.from({ length: w }, (_, x) => at(t0 + ((t1 - t0) * x) / (w - 1)));
  const opt = { gamut: g, enc: bd.enc, bits: bd.bits };
  const qline = cont.map((x) => quantize(x, opt));
  // 帯: ディザありはピクセルごとにノイズを変える
  const ctx = cv.getContext("2d", screen.p3 ? { colorSpace: "display-p3" } : undefined);
  const img = screen.p3 ? ctx.createImageData(w, h, { colorSpace: "display-p3" }) : ctx.createImageData(w, h);
  const scale = sdrScale();
  // ディザありは、目が細かい粒を平均して見るので、列ごとに縦に平均した光の量を「見える色」とする
  const seen = bd.dither ? cont.map(() => [0, 0, 0]) : qline;
  for (let x = 0; x < w; x++) {
    const col = bd.dither ? null : toScreenRgb(qline[x], scale).map((v) => Math.round(v * 255));
    for (let y = 0; y < h; y++) {
      let c = col;
      if (!c) {
        const q = quantize(cont[x], { ...opt, noise: [0, 1, 2].map((ch) => tri(x, y, ch)) });
        q.forEach((v, k) => (seen[x][k] += v / h));
        c = toScreenRgb(q, scale).map((v) => Math.round(v * 255));
      }
      const k = (y * w + x) * 4;
      img.data[k] = c[0]; img.data[k + 1] = c[1]; img.data[k + 2] = c[2]; img.data[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // グラフ: L*(丸める前=灰、丸めた後=色)
  const gv = $("bdGraph");
  const gw = Math.max(2, Math.round(gv.clientWidth * devicePixelRatio)), gh = Math.max(1, Math.round(gv.clientHeight * devicePixelRatio));
  if (gv.width !== gw || gv.height !== gh) { gv.width = gw; gv.height = gh; }
  const gg = gv.getContext("2d");
  gg.clearRect(0, 0, gw, gh);
  const Lc = cont.map((x) => xyzToLab(x)[0]), Lq = seen.map((x) => xyzToLab(x)[0]);
  const lo = Math.min(...Lc, ...Lq), hi = Math.max(...Lc, ...Lq, lo + 1e-3);
  const pad = 6 * devicePixelRatio;
  const Y = (L) => gh - pad - ((L - lo) / (hi - lo)) * (gh - 2 * pad);
  const plot = (arr, color, lw) => { gg.strokeStyle = color; gg.lineWidth = lw * devicePixelRatio; gg.beginPath(); arr.forEach((L, i) => { const x = (i / (arr.length - 1)) * gw; i ? gg.lineTo(x, Y(L)) : gg.moveTo(x, Y(L)); }); gg.stroke(); };
  plot(Lc, "#777", 1);
  if (bd.bits) plot(Lq, "#ffd166", 1.5);
  gg.fillStyle = "#9ea3b0"; gg.font = `${10 * devicePixelRatio}px system-ui`;
  gg.fillText(`L* ${hi.toFixed(1)}`, 4 * devicePixelRatio, 12 * devicePixelRatio); gg.fillText(`L* ${lo.toFixed(1)}`, 4 * devicePixelRatio, gh - 4 * devicePixelRatio);
  const st = steps(bd.dither ? seen : qline);
  $("bdStat").innerHTML = !bd.bits ? "連続(丸めない)" : bd.dither ? `ディザ: 粒を平均した見え方で 最大 ΔE*ab <b>${st.maxStep.toFixed(2)}</b>・見えやすい段 <b>${st.visible}</b>` : `段 ${st.n}・最大 ΔE*ab <b>${st.maxStep.toFixed(2)}</b>・見えやすい段 <b>${st.visible}</b>`;
  $("bdStrip").dataset.visible = st.visible;
  document.querySelectorAll("#bdSrc button").forEach((b) => b.classList.toggle("on", b.dataset.v === bd.src));
  document.querySelectorAll("#bdBits button").forEach((b) => b.classList.toggle("on", Number(b.dataset.v) === bd.bits));
  document.querySelectorAll("#bdEnc button").forEach((b) => b.classList.toggle("on", b.dataset.v === bd.enc));
  document.querySelectorAll("#bdOpt button").forEach((b) => b.classList.toggle("on", !!bd[b.dataset.v]));
}
{
  const mk = (box, items, f) => items.forEach(([v, name]) => {
    const b = document.createElement("button"); b.textContent = name; b.dataset.v = v;
    b.addEventListener("click", () => { f(v); renderBd(); }); $(box).appendChild(b);
  });
  mk("bdSrc", [["kA", "黒→A"], ["AB", "A→B(1番目の混ぜ方)"]], (v) => (bd.src = v));
  mk("bdBits", BITS.map((b) => [b, b ? `${b}bit` : "連続"]), (v) => (bd.bits = Number(v)));
  mk("bdEnc", ENCODINGS.map((e) => [e.id, e.name]), (v) => (bd.enc = v));
  mk("bdOpt", [["dither", "ディザ"], ["dark", "暗い所を拡大"]], (v) => (bd[v] = !bd[v]));
}

// ---- まわりで変わる(同時対比)----
// 対象=A/B/C、背景のペア=黒と白/補色と同系(明るさは対象と同じ=色みの対比だけ)/B と C
const sc = { target: "a", bg: "bw", side: 0, link: false, m: [0, 0, 0] };
const GRAY = linToXYZ("srgb", [0.2, 0.2, 0.2]); // Y=0.2 = CAM16 の標準の背景 Yb=20
function scBackgrounds(t) {
  const { L, h } = oklch(t);
  if (sc.bg === "bw") return [linToXYZ("srgb", [0.012, 0.012, 0.012]), linToXYZ("srgb", [0.9, 0.9, 0.9])];
  if (sc.bg === "comp") return [chromaReduce(oklchToXYZ(L, 0.13, h + 180), "srgb"), chromaReduce(oklchToXYZ(L, 0.13, h), "srgb")];
  return [colorXYZ("b"), colorXYZ("c")].map((x) => clipTo(x, "srgb"));
}
function renderSc() {
  const t = clipTo(rgbToXYZ(state.gamut, hexToRgb(state[sc.target])), "srgb");
  const [bgL, bgR] = scBackgrounds(t);
  $("scL").style.background = cssColor(bgL); $("scR").style.background = cssColor(bgR);
  $("scL").firstElementChild.style.background = $("scR").firstElementChild.style.background = cssColor(t);
  $("scBridge").hidden = !sc.link; $("scBridge").style.background = cssColor(t);
  $("scLink").classList.toggle("on", sc.link);
  // CAM16: 背景の明るさ Yb ごとの明度 J と、灰色(Yb=20)の上で同じ明るさに見える色
  const Yb = (x) => Math.max(1, x[1] * 100);
  const J = [bgL, bgR].map((b) => cam16(t.map((v) => v * 100), undefined, 64, Yb(b)).J);
  const pred = [bgL, bgR].map((b) => matchLightness(t, Yb(b), 20));
  const dLpred = pred.map((p) => xyzToOklab(p)[0] - xyzToOklab(t)[0]);
  $("scPred").textContent = `CAM16の明るさ J: 左 ${J[0].toFixed(1)} / 右 ${J[1].toFixed(1)}(差 ${(J[0] - J[1]).toFixed(1)})`;
  // 自分の目で合わせる
  $("scGray").style.background = cssColor(GRAY);
  const lab = xyzToOklab(t).map((v, i) => v + sc.m[i]);
  $("scPatch").style.background = cssColor(clipTo(oklabToXYZ(lab), "srgb"));
  $("vmL").textContent = (sc.m[0] >= 0 ? "+" : "") + sc.m[0].toFixed(3);
  $("vmA").textContent = (sc.m[1] >= 0 ? "+" : "") + sc.m[1].toFixed(3);
  $("vmB").textContent = (sc.m[2] >= 0 ? "+" : "") + sc.m[2].toFixed(3);
  $("scSideName").textContent = sc.side ? "右" : "左";
  const p = dLpred[sc.side];
  $("scResult").innerHTML = `あなたの目: 明るさ <b>${sc.m[0] >= 0 ? "+" : ""}${sc.m[0].toFixed(3)}</b>・赤⇔緑 <b>${sc.m[1] >= 0 ? "+" : ""}${sc.m[1].toFixed(3)}</b>・黄⇔青 <b>${sc.m[2] >= 0 ? "+" : ""}${sc.m[2].toFixed(3)}</b>(Oklab)/ CAM16 の予測: 明るさ ${p >= 0 ? "+" : ""}${p.toFixed(3)}・色み 0(扱わない)`;
  document.querySelectorAll("#scT button").forEach((b) => b.classList.toggle("on", b.dataset.v === sc.target));
  document.querySelectorAll("#scBg button").forEach((b) => b.classList.toggle("on", b.dataset.v === sc.bg));
  document.querySelectorAll("#scSide button").forEach((b) => b.classList.toggle("on", Number(b.dataset.v) === sc.side));
}
{
  const mk = (box, items, f) => items.forEach(([v, name]) => {
    const b = document.createElement("button"); b.textContent = name; b.dataset.v = v;
    b.addEventListener("click", () => { f(v); renderSc(); }); $(box).appendChild(b);
  });
  const resetM = () => { sc.m = [0, 0, 0]; ["mL", "mA", "mB"].forEach((id) => ($(id).value = 0)); };
  mk("scT", [["a", "A"], ["b", "B"], ["c", "C"]], (v) => { sc.target = v; resetM(); });
  mk("scBg", [["bw", "黒と白"], ["comp", "補色と同系"], ["bc", "BとC"]], (v) => { sc.bg = v; resetM(); });
  mk("scSide", [[0, "左"], [1, "右"]], (v) => { sc.side = Number(v); resetM(); });
  $("scLink").addEventListener("click", () => { sc.link = !sc.link; renderSc(); });
  ["mL", "mA", "mB"].forEach((id, i) => $(id).addEventListener("input", (e) => { sc.m[i] = Number(e.target.value); renderSc(); }));
}

function update() {
  setIlluminant(state.il);
  writeHash();
  renderBands();
  renderCube();
  renderMeta();
  renderBd();
  renderSc();
}
// 方式の数や画面の出し方が変わったら帯を作り直す(WebGPU と 2D の canvas は使い回せない)
let builtKey = "";
function rebuild() {
  const key = state.methods.join(",") + "|" + useHdr();
  if (key !== builtKey) { buildBands(); builtKey = key; }
  renderPresets();
  update();
}

// ---- 自前の色ピッカー(Oklch。作業色域の外は色相を保って端に寄せる)----
let picking = null; // 調整中の色 "a" | "b" | "c" | null
const pick = { L: 0.5, C: 0.1, h: 0, clipped: false };
function syncPicker() {
  $("picker").hidden = !picking;
  if (!picking) return;
  const set = (id, v) => { if (document.activeElement !== $(id)) $(id).value = v; };
  set("pL", pick.L); set("pC", pick.C); set("pH", pick.h);
  $("vL").textContent = pick.L.toFixed(3); $("vC").textContent = pick.C.toFixed(3); $("vH").textContent = `${pick.h.toFixed(0)}°`;
  if (document.activeElement !== $("pHex")) $("pHex").value = state[picking];
  $("pNote").textContent = pick.clipped ? "色域の端に寄せた" : "";
  // スライダーの帯: その軸だけ動かした色(作業色域に収めて、この画面の色で)
  const grad = (f) => `linear-gradient(90deg, ${Array.from({ length: 13 }, (_, i) => cssColor(chromaReduce(f(i / 12), state.gamut))).join(", ")})`;
  $("pL").style.background = grad((t) => oklchToXYZ(t, pick.C, pick.h));
  $("pC").style.background = grad((t) => oklchToXYZ(pick.L, t * 0.5, pick.h));
  $("pH").style.background = grad((t) => oklchToXYZ(pick.L, pick.C, t * 360));
}
function loadPick(n) {
  const { L, C, h } = oklch(rgbToXYZ(state.gamut, hexToRgb(state[n])));
  Object.assign(pick, { L, C, h: C < 1e-4 ? pick.h : h, clipped: false });
}
function applyPick() {
  const x = oklchToXYZ(pick.L, pick.C, pick.h);
  pick.clipped = !inGamut(state.gamut, x);
  state[picking] = rgbToHex(xyzToRgb(state.gamut, chromaReduce(x, state.gamut)));
  if (picking === "c") state.cAuto = false;
  syncInputs(); update();
}
for (const n of ["a", "b", "c"]) $("c" + n).addEventListener("click", () => {
  picking = picking === n ? null : n;
  if (picking) loadPick(n);
  syncInputs();
});
for (const [id, k] of [["pL", "L"], ["pC", "C"], ["pH", "h"]]) $(id).addEventListener("input", (e) => { pick[k] = Number(e.target.value); applyPick(); });
$("pHex").addEventListener("change", (e) => {
  const v = e.target.value.trim().replace(/^#?/, "#").toLowerCase();
  if (!/^#[0-9a-f]{6}$/.test(v)) return toast("色コードは #rrggbb の形で");
  state[picking] = v; loadPick(picking);
  if (picking === "c") state.cAuto = false;
  syncInputs(); update();
});
document.querySelectorAll("#carc button").forEach((b) =>
  b.addEventListener("click", () => {
    state.cAuto = true; state.cArc = b.dataset.arc; syncInputs(); update();
    toast(`3色目を自動で(${b.textContent})`);
  })
);
$("use3").addEventListener("change", (e) => { state.use3 = e.target.checked; syncInputs(); update(); });
$("swap").addEventListener("click", () => { [state.a, state.b] = [state.b, state.a]; [state.k.a, state.k.b] = [state.k.b, state.k.a]; syncInputs(); update(); });
$("reset").addEventListener("click", () => { applyPreset({ ...state.preset, mode: undefined }); toast(`「${state.preset.name}」の色に戻しました`); });
$("fav").addEventListener("click", () => {
  const def = state.preset.name === "URL" ? "おきにいり" : state.preset.name;
  const name = prompt("名前をつけて保存", def);
  if (name === null) return;
  const all = loadFavs();
  const mode = Object.fromEntries(Object.keys(MODE_DEFAULTS).map((k) => [k, structuredClone(state[k])]));
  all.push({ name: name.trim() || def, a: state.a, b: state.b, c: state.use3 && !state.cAuto ? state.c : undefined, use3: state.use3, arc: state.cArc, k: { ...state.k }, mode });
  localStorage.setItem(FAV_KEY, JSON.stringify(all));
  renderFavs(); toast("保存しました");
});
$("shot").addEventListener("click", () => {
  const W = 960, BH = 50, vs = activeVariants(), RH = 28 + vs.length * (BH + 22);
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = 64 + state.methods.length * RH;
  const g = cv.getContext("2d");
  const scale = sdrScale();
  g.fillStyle = "#16171b"; g.fillRect(0, 0, cv.width, cv.height);
  g.fillStyle = "#e8e8ea"; g.font = "20px system-ui";
  g.fillText(`いろまぜラボ  ${state.a} → ${state.use3 ? state.c + " → " : ""}${state.b}`, 16, 28);
  g.font = "14px system-ui"; g.fillStyle = "#9ea3b0";
  g.fillText($("pipeinfo").textContent + "(PNGはsRGB)", 16, 50);
  state.methods.forEach((id, k) => {
    const y0 = 64 + k * RH;
    g.fillStyle = "#e8e8ea"; g.font = "bold 16px system-ui";
    g.fillText(SPACE[id].name, 16, y0 + 18);
    vs.forEach((v, j) => {
      const y = y0 + 26 + j * (BH + 22);
      const d = rowData(id, v.cols());
      g.fillStyle = "#c8cad0"; g.font = "13px system-ui";
      g.fillText(`中間色${v.label}   真ん中C=${d.midC.toFixed(3)}  最小C=${d.min.toFixed(3)}`, 16, y + 13);
      for (let x = 0; x < W - 32; x++) {
        const c = d.seen[Math.round((x / (W - 33)) * N)].map((q) => q * scale);
        g.fillStyle = rgbToHex(xyzToRgb("srgb", clipTo(c, "srgb"))); g.fillRect(16 + x, y + 18, 1, BH);
      }
    });
  });
  const a = document.createElement("a");
  a.href = cv.toDataURL("image/png");
  a.download = `iromaze-lab-${state.a.slice(1)}-${state.b.slice(1)}.png`;
  document.body.appendChild(a); a.click(); a.remove();
});

segment("gamut", Object.values(GAMUTS), "gamut", () => picking && loadPick(picking)); // 色コードは色域ごとの読みなので L・C・h を読み直す
segment("gm", GAMUT_MAPS, "gm");
segment("tm", TONE_MAPS, "tm");
segment("env", ENVS, "env");
segment("il", ILLUMINANTS, "il");
segment("scr", [{ id: "auto", name: "この画面の力で", note: "P3・HDRに対応していればそのまま出す" }, { id: "sdr", name: "SDRで再現", note: "HDRでも、上限を白にして暗く縮めて見せる" }], "scr");
segment("device", DEVICES, "device");
segment("cvd", CVDS, "cvd");
renderMethods();
renderKRows();
readHash();
renderFavs();
syncInputs();
rebuild();
addEventListener("hashchange", () => { readHash(); syncInputs(); rebuild(); });
new ResizeObserver(() => { renderBands(); renderCube(); }).observe($("bands"));
initHdr().then((ok) => { if (ok) { syncInputs(); rebuild(); } });
