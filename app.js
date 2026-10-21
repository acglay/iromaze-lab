import { METHODS, mixPath, hexToRgb, rgbToHex, rgbToOklab, oklch } from "./color.js";

const PRESETS = [
  { name: "青×黄", a: "#0000ff", b: "#ffff00" },
  { name: "赤×シアン", a: "#ff0000", b: "#00ffff" },
  { name: "緑×マゼンタ", a: "#00ff00", b: "#ff00ff" },
  { name: "群青×山吹", a: "#1e3a8a", b: "#f2b01e" },
  { name: "赤×緑", a: "#e02020", b: "#20a040" },
  { name: "白×黒", a: "#ffffff", b: "#000000" },
  { name: "青×黄+緑で回り道", a: "#0000ff", b: "#ffff00", c: "#00c070" },
];
const DEFAULT = PRESETS[0];
const FAV_KEY = "iromaze-lab-favs-v1";
const PATH_COL = { rgb: "#ffffff", oklab: "#4fd1ff", paint: "#ffa94d" };
const PATH_DASH = { rgb: [], oklab: [7, 5], paint: [2, 4] };

const $ = (id) => document.getElementById(id);
const state = { a: DEFAULT.a, b: DEFAULT.b, c: "#00c070", use3: false, preset: DEFAULT, space: "rgb" };

// ---- hub(🏠だけ。進捗は持たない)----
{
  const m = location.hash.match(/#hub=([0-9a-f]+)/);
  if (m) {
    localStorage.setItem("hub-token", m[1]);
    history.replaceState(null, "", location.pathname + location.search);
  }
  if (localStorage.getItem("hub-token")) $("home").hidden = false;
}

// ---- URLハッシュ(#a=0000ff&b=ffff00&c=00c070) ----
function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  const hex = (v) => (v && /^[0-9a-f]{6}$/i.test(v) ? "#" + v.toLowerCase() : null);
  if (hex(p.get("a")) && hex(p.get("b"))) {
    state.a = hex(p.get("a"));
    state.b = hex(p.get("b"));
    state.use3 = !!hex(p.get("c"));
    if (state.use3) state.c = hex(p.get("c"));
    state.preset = { name: "URL", a: state.a, b: state.b, c: state.use3 ? state.c : undefined };
  }
}
function writeHash() {
  const h = `a=${state.a.slice(1)}&b=${state.b.slice(1)}` + (state.use3 ? `&c=${state.c.slice(1)}` : "");
  history.replaceState(null, "", "#" + h);
}

const cols = () => (state.use3 ? [state.a, state.b, state.c] : [state.a, state.b]).map(hexToRgb);

function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast.tid);
  toast.tid = setTimeout(() => t.classList.remove("show"), 1600);
}

// ---- 3本の帯 ----
const N = 96;
function samples(fn) {
  const c = cols();
  return Array.from({ length: N + 1 }, (_, i) => mixPath(fn, c, i / N));
}
function chromaStats(fn) {
  const c = cols();
  const mid = mixPath(fn, c, 0.5);
  const ends = (oklch(c[0]).C + oklch(c[1]).C) / 2;
  let min = Infinity, minT = 0;
  for (let i = 0; i <= N; i++) {
    const C = oklch(mixPath(fn, c, i / N)).C;
    if (C < min) { min = C; minT = i / N; }
  }
  return { mid, midC: oklch(mid).C, midL: oklch(mid).L, ends, min, minT };
}

function buildBands() {
  $("bands").innerHTML = METHODS.map(
    (m) => `<div class="band" data-m="${m.id}">
      <div class="bandhead"><b>${m.name}</b><small>${m.note}</small></div>
      <canvas></canvas>
      <div class="stats"><span class="sw"></span><span class="num txt"></span><span class="meter" title="真ん中の彩度 ÷ 両はしの平均彩度"><i></i></span><span class="num pct"></span></div>
    </div>`
  ).join("");
}

function drawBand(cv, fn) {
  const w = Math.max(1, Math.round(cv.clientWidth * devicePixelRatio));
  const h = Math.max(1, Math.round(cv.clientHeight * devicePixelRatio));
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  const g = cv.getContext("2d");
  const s = samples(fn);
  for (let x = 0; x < w; x++) {
    g.fillStyle = rgbToHex(s[Math.round((x / (w - 1)) * N)]);
    g.fillRect(x, 0, 1, h);
  }
  g.fillStyle = "#000a";
  g.fillRect(Math.round(w / 2) - 1, 0, 2, h * 0.18);
  g.fillRect(Math.round(w / 2) - 1, h * 0.82, 2, h * 0.18);
}

function renderBands() {
  for (const m of METHODS) {
    const el = document.querySelector(`.band[data-m="${m.id}"]`);
    drawBand(el.querySelector("canvas"), m.fn);
    const st = chromaStats(m.fn);
    const ratio = st.ends > 1e-4 ? st.midC / st.ends : 1;
    el.querySelector(".sw").style.background = rgbToHex(st.mid);
    el.querySelector(".txt").textContent =
      `真ん中 ${rgbToHex(st.mid)}  C=${st.midC.toFixed(3)}  L=${st.midL.toFixed(2)}` +
      (state.use3 ? `  最小C=${st.min.toFixed(3)}` : "");
    el.querySelector(".meter i").style.width = Math.min(100, ratio * 100) + "%";
    el.querySelector(".pct").textContent = st.ends > 1e-4 ? `あざやかさ ${Math.round(ratio * 100)}%` : "(両はし灰色)";
    el.dataset.midc = st.midC.toFixed(4);
  }
}

// ---- 3D図(Canvas 2D で回転投影)----
const view = { yaw: -0.7, pitch: 0.45 };
function project(p, w, h) {
  const [x, y, z] = p;
  const cy = Math.cos(view.yaw), sy = Math.sin(view.yaw), cp = Math.cos(view.pitch), sp = Math.sin(view.pitch);
  const x1 = x * cy + z * sy, z1 = -x * sy + z * cy;
  const y1 = y * cp - z1 * sp, z2 = y * sp + z1 * cp;
  const s = Math.min(w, h) * 0.55 * (3 / (3 + z2));
  return [w / 2 + x1 * s, h / 2 - y1 * s, z2];
}
// RGB: 赤=x, 青=z, 緑=y を -0.5..0.5 に。Oklab: a=x, L=y, b=-z
const toRgbSpace = (rgb) => [rgb[0] - 0.5, rgb[1] - 0.5, rgb[2] - 0.5];
const toLabSpace = (rgb) => {
  const [L, a, b] = rgbToOklab(rgb);
  return [a * 2.2, L - 0.5, -b * 2.2];
};

function renderCube() {
  const cv = $("cube");
  const w = Math.round(cv.clientWidth * devicePixelRatio), h = Math.round(cv.clientHeight * devicePixelRatio);
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  const g = cv.getContext("2d");
  g.clearRect(0, 0, w, h);
  g.lineWidth = devicePixelRatio;
  const P = (p) => project(p, w, h);
  const line = (a, b, color, dash = []) => {
    const [x1, y1] = P(a), [x2, y2] = P(b);
    g.strokeStyle = color; g.setLineDash(dash.map((d) => d * devicePixelRatio));
    g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
  };
  const dot = (p, color, r) => {
    const [x, y] = P(p);
    g.fillStyle = color; g.beginPath(); g.arc(x, y, r * devicePixelRatio, 0, Math.PI * 2); g.fill();
    g.strokeStyle = "#0008"; g.setLineDash([]); g.stroke();
  };
  const space = state.space === "rgb" ? toRgbSpace : toLabSpace;

  if (state.space === "rgb") {
    const corners = [];
    for (let i = 0; i < 8; i++) corners.push([i & 1, (i >> 1) & 1, (i >> 2) & 1]);
    for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) {
      const d = corners[i].reduce((s, v, k) => s + Math.abs(v - corners[j][k]), 0);
      if (d === 1) line(toRgbSpace(corners[i]), toRgbSpace(corners[j]), "#4a4d58");
    }
    line(toRgbSpace([0, 0, 0]), toRgbSpace([1, 1, 1]), "#999", [3, 3]);
    for (const c of corners) dot(toRgbSpace(c), rgbToHex(c), 4);
    $("cubehint").textContent = "灰色の点線=白と黒を結ぶ灰色の軸。補色を直線で結ぶと、ちょうどこの軸の真ん中(灰色)を突きぬける。ドラッグで回転。";
  } else {
    line([0, -0.5, 0], [0, 0.5, 0], "#999", [3, 3]);
    // sRGB の外周(6色相の輪郭)を L に沿って描く
    const rim = ["#ff0000", "#ffff00", "#00ff00", "#00ffff", "#0000ff", "#ff00ff", "#ff0000"].map(hexToRgb);
    for (let i = 0; i < 6; i++) for (let k = 0; k < 8; k++) {
      const a = rim[i].map((v, j) => v + (rim[i + 1][j] - v) * (k / 8));
      const b = rim[i].map((v, j) => v + (rim[i + 1][j] - v) * ((k + 1) / 8));
      line(toLabSpace(a), toLabSpace(b), "#4a4d58");
    }
    for (const c of rim.slice(0, 6)) dot(toLabSpace(c), rgbToHex(c), 4);
    dot(toLabSpace([1, 1, 1]), "#fff", 4);
    dot(toLabSpace([0, 0, 0]), "#000", 4);
    $("cubehint").textContent = "縦=明るさL、横の広がり=色み(a,b)。点線=灰色の軸、外の輪=あざやかな6色。中心に近いほど濁った色。";
  }
  for (const m of METHODS) {
    const s = samples(m.fn).filter((_, i) => i % 3 === 0 || i === N);
    for (let i = 0; i < s.length - 1; i++) line(space(s[i]), space(s[i + 1]), PATH_COL[m.id], PATH_DASH[m.id]);
    const mid = mixPath(m.fn, cols(), 0.5);
    dot(space(mid), rgbToHex(mid), 6);
  }
  for (const c of cols()) dot(space(c), rgbToHex(c), 7);
  // 凡例
  g.setLineDash([]);
  g.font = `${12 * devicePixelRatio}px system-ui`;
  METHODS.forEach((m, i) => {
    const y = (16 + i * 16) * devicePixelRatio;
    g.strokeStyle = PATH_COL[m.id]; g.setLineDash(PATH_DASH[m.id].map((d) => d * devicePixelRatio));
    g.beginPath(); g.moveTo(8 * devicePixelRatio, y - 4 * devicePixelRatio); g.lineTo(34 * devicePixelRatio, y - 4 * devicePixelRatio); g.stroke();
    g.fillStyle = "#ddd"; g.fillText(m.name, 40 * devicePixelRatio, y);
  });
}
{
  const cv = $("cube");
  let drag = null;
  cv.addEventListener("pointerdown", (e) => { drag = [e.clientX, e.clientY]; cv.setPointerCapture(e.pointerId); });
  cv.addEventListener("pointermove", (e) => {
    if (!drag) return;
    view.yaw += (e.clientX - drag[0]) * 0.01;
    view.pitch = Math.max(-1.5, Math.min(1.5, view.pitch + (e.clientY - drag[1]) * 0.01));
    drag = [e.clientX, e.clientY];
    renderCube();
  });
  cv.addEventListener("pointerup", () => (drag = null));
  document.querySelectorAll(".seg button").forEach((b) =>
    b.addEventListener("click", () => {
      state.space = b.dataset.space;
      document.querySelectorAll(".seg button").forEach((x) => x.classList.toggle("on", x === b));
      renderCube();
    })
  );
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
function applyPreset(p) {
  state.preset = p;
  state.a = p.a; state.b = p.b;
  state.use3 = !!p.c;
  if (p.c) state.c = p.c;
  syncInputs(); update();
}
function renderPresets() {
  const box = $("presets");
  box.innerHTML = "";
  for (const p of PRESETS) box.appendChild(chip(p.name, [p.a, p.b, p.c].filter(Boolean), () => applyPreset(p)));
}
const loadFavs = () => { try { return JSON.parse(localStorage.getItem(FAV_KEY)) || []; } catch { return []; } };
function renderFavs() {
  const box = $("favs");
  box.innerHTML = "";
  const favs = loadFavs();
  if (!favs.length) box.innerHTML = '<span class="hint">☆で今の組み合わせを保存</span>';
  favs.forEach((f, i) =>
    box.appendChild(chip(f.name, [f.a, f.b, f.c].filter(Boolean), () => applyPreset(f), () => {
      if (!confirm(`「${f.name}」を消しますか?`)) return;
      const all = loadFavs(); all.splice(i, 1);
      localStorage.setItem(FAV_KEY, JSON.stringify(all)); renderFavs();
    }))
  );
}
function syncInputs() {
  $("ca").value = state.a; $("cb").value = state.b; $("cc").value = state.c;
  $("use3").checked = state.use3; $("c3row").hidden = !state.use3;
}
function update() {
  writeHash();
  renderBands();
  renderCube();
}

$("ca").addEventListener("input", (e) => { state.a = e.target.value; update(); });
$("cb").addEventListener("input", (e) => { state.b = e.target.value; update(); });
$("cc").addEventListener("input", (e) => { state.c = e.target.value; update(); });
$("use3").addEventListener("change", (e) => { state.use3 = e.target.checked; syncInputs(); update(); });
$("swap").addEventListener("click", () => { [state.a, state.b] = [state.b, state.a]; syncInputs(); update(); });
$("reset").addEventListener("click", () => { applyPreset(state.preset); toast(`「${state.preset.name}」の色に戻しました`); });
$("fav").addEventListener("click", () => {
  const def = state.preset.name === "URL" ? "おきにいり" : state.preset.name;
  const name = prompt("名前をつけて保存", def);
  if (name === null) return;
  const all = loadFavs();
  all.push({ name: name.trim() || def, a: state.a, b: state.b, c: state.use3 ? state.c : undefined });
  localStorage.setItem(FAV_KEY, JSON.stringify(all));
  renderFavs(); toast("保存しました");
});
$("shot").addEventListener("click", () => {
  const W = 960, BH = 90, cv = document.createElement("canvas");
  cv.width = W; cv.height = 40 + METHODS.length * (BH + 46);
  const g = cv.getContext("2d");
  g.fillStyle = "#16171b"; g.fillRect(0, 0, cv.width, cv.height);
  g.fillStyle = "#e8e8ea"; g.font = "20px system-ui";
  g.fillText(`いろまぜラボ  ${state.a} → ${state.use3 ? state.c + " → " : ""}${state.b}`, 16, 28);
  METHODS.forEach((m, k) => {
    const y = 40 + k * (BH + 46);
    const s = samples(m.fn);
    for (let x = 0; x < W - 32; x++) { g.fillStyle = rgbToHex(s[Math.round((x / (W - 33)) * N)]); g.fillRect(16 + x, y + 26, 1, BH); }
    const st = chromaStats(m.fn);
    g.fillStyle = "#e8e8ea"; g.font = "16px system-ui";
    g.fillText(`${m.name}   真ん中 ${rgbToHex(st.mid)}  C=${st.midC.toFixed(3)}`, 16, y + 18);
  });
  const a = document.createElement("a");
  a.href = cv.toDataURL("image/png");
  a.download = `iromaze-lab-${state.a.slice(1)}-${state.b.slice(1)}.png`;
  document.body.appendChild(a); a.click(); a.remove();
});

readHash();
buildBands();
renderPresets();
renderFavs();
syncInputs();
update();
addEventListener("hashchange", () => { readHash(); syncInputs(); update(); });
new ResizeObserver(() => { renderBands(); renderCube(); }).observe($("bands"));
