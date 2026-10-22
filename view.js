// 色の空間の図。4つの見方: RGB立方体(作業色域)/ Oklab(色立体)/ xy色度図 / u'v'色度図。
// 色立体は奥ほど薄く・細く描き、前後を並べ替えてから描く。色度図は馬蹄形の中を色で塗る。
import { GAMUTS, linToXYZ, xyzToLin, xyzToRgb, xyzToOklab, oklabToXYZ, xyzToXy, xyzToUv, xyToUv, uvToXy, LOCUS, inLocus, clipTo, rgbToHex } from "./color.js";

export const MODES = [
  { id: "rgb", name: "RGB立方体" },
  { id: "oklab", name: "Oklab" },
  { id: "xy", name: "xy色度図" },
  { id: "uv", name: "u'v'色度図" },
];
const VIEWS = {
  tilt: { name: "ななめ", yaw: -0.7, pitch: 0.42 },
  top: { name: "上から", yaw: 0, pitch: -Math.PI / 2 },
  side: { name: "横から", yaw: 0, pitch: 0 },
};
export const view = { mode: "xy", yaw: VIEWS.tilt.yaw, pitch: VIEWS.tilt.pitch, zoom: 1, panX: 0, panY: 0, focus: null };
export const VIEW_PRESETS = Object.entries(VIEWS).map(([id, v]) => ({ id, name: v.name }));
export function setPreset(id) {
  Object.assign(view, { yaw: VIEWS[id].yaw, pitch: VIEWS[id].pitch, zoom: 1, panX: 0, panY: 0 });
}
const is2D = () => view.mode === "xy" || view.mode === "uv";

// ---- 3D: 座標 ----
// RGB立方体は灰色の軸(黒→白)が縦になるよう回す(上から見ると色相の六角形)
const S2 = Math.SQRT2, S3 = Math.sqrt(3), S6 = Math.sqrt(6);
function toSpace(xyz, g) {
  if (view.mode === "rgb") {
    const [r, gg, b] = xyzToRgb(g, xyz).map((v) => v - 0.5);
    return [(r - gg) / S2, (r + gg + b) / S3, (r + gg - 2 * b) / S6];
  }
  const [L, a, bb] = xyzToOklab(xyz);
  return [a * 2.2, L - 0.5, -bb * 2.2];
}
function project([x, y, z], w, h) {
  const cy = Math.cos(view.yaw), sy = Math.sin(view.yaw), cp = Math.cos(view.pitch), sp = Math.sin(view.pitch);
  const x1 = x * cy + z * sy, z1 = -x * sy + z * cy;
  const y1 = y * cp - z1 * sp, z2 = y * sp + z1 * cp;
  const s = Math.min(w, h) * 0.5 * view.zoom * (3 / (3 + z2));
  return [w / 2 + x1 * s, h / 2 - y1 * s, z2];
}

// ---- 2D: 色度図の座標 ----
const chroma = (xyz) => (view.mode === "xy" ? xyzToXy(xyz) : xyzToUv(xyz));
const fromXy = (xy) => (view.mode === "xy" ? xy : xyToUv(xy));
const RANGE = { xy: [-0.02, 0.8, -0.02, 0.9], uv: [-0.02, 0.66, -0.02, 0.62] };
function map2D([u, v], w, h) {
  const [x0, x1, y0, y1] = RANGE[view.mode];
  const pad = 28 * devicePixelRatio;
  const s = Math.min((w - pad * 1.5) / (x1 - x0), (h - pad * 1.5) / (y1 - y0)) * view.zoom;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  return [w / 2 + pad * 0.4 + (u - cx) * s + view.panX, h / 2 - pad * 0.4 - (v - cy) * s + view.panY, 0];
}
function unmap2D(px, py, w, h) {
  const [x0, x1, y0, y1] = RANGE[view.mode];
  const pad = 28 * devicePixelRatio;
  const s = Math.min((w - pad * 1.5) / (x1 - x0), (h - pad * 1.5) / (y1 - y0)) * view.zoom;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  return [(px - w / 2 - pad * 0.4 - view.panX) / s + cx, -(py - h / 2 + pad * 0.4 - view.panY) / s + cy];
}

// 馬蹄形の中の塗り(明るさは各色の最大まで上げる)。大きさ・見方・画面の色域が同じなら使い回す
let fillCache = { key: "", img: null };
function locusFill(w, h, p3) {
  const key = [w, h, view.mode, view.zoom, view.panX, view.panY, p3].join("|");
  if (fillCache.key === key) return fillCache.img;
  const step = Math.max(1, Math.round(2 * devicePixelRatio));
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d", p3 ? { colorSpace: "display-p3" } : undefined);
  const img = p3 ? g.createImageData(w, h, { colorSpace: "display-p3" }) : g.createImageData(w, h);
  const gm = p3 ? "p3" : "srgb";
  for (let py = 0; py < h; py += step) for (let px = 0; px < w; px += step) {
    const q = unmap2D(px + step / 2, py + step / 2, w, h);
    const xy = view.mode === "xy" ? q : uvToXy(q);
    if (xy[1] <= 0.001 || !inLocus(xy)) continue;
    const XYZ = [xy[0] / xy[1], 1, (1 - xy[0] - xy[1]) / xy[1]];
    const lin = xyzToLin(gm, XYZ).map((v) => Math.max(0, v));
    const m = Math.max(...lin);
    const rgb = lin.map((v) => Math.round(GAMUTS[gm].enc(v / m) * 255));
    for (let dy = 0; dy < step && py + dy < h; dy++) for (let dx = 0; dx < step && px + dx < w; dx++) {
      const k = ((py + dy) * w + px + dx) * 4;
      img.data[k] = rgb[0]; img.data[k + 1] = rgb[1]; img.data[k + 2] = rgb[2]; img.data[k + 3] = 200;
    }
  }
  g.putImageData(img, 0, 0);
  fillCache = { key, img: c };
  return c;
}

const dotCol = (xyz) => rgbToHex(xyzToRgb("srgb", clipTo(xyz, "srgb")));
// RGB色域の外形: 3D=立方体の12辺、2D=原色の三角形
export const rgbOutline = (g) => ({ edges: gamutEdges(g), ring: [[1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 0, 0]].map((v) => linToXYZ(g, v)) });
// スペクトル軌跡を Catmull-Rom で 2nm 相当まで細かくした xy の列(弓をなめらかに)
const LOCUS_SMOOTH = (() => {
  const P = LOCUS.map(([, x, y]) => [x, y]), out = [];
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(P.length - 1, i + 2)];
    for (let k = 0; k < 5; k++) {
      const t = k / 5, t2 = t * t, t3 = t2 * t;
      out.push([0, 1].map((d) => 0.5 * (2 * p1[d] + (-p0[d] + p2[d]) * t + (2 * p0[d] - 5 * p1[d] + 4 * p2[d] - p3[d]) * t2 + (-p0[d] + 3 * p1[d] - 3 * p2[d] + p3[d]) * t3)));
    }
  }
  out.push(P.at(-1));
  return out;
})();
function gamutEdges(g) {
  const edges = [];
  for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) {
    const a = [i & 1, (i >> 1) & 1, (i >> 2) & 1], b = [j & 1, (j >> 1) & 1, (j >> 2) & 1];
    if (a.reduce((s, v, k) => s + Math.abs(v - b[k]), 0) !== 1) continue;
    edges.push(Array.from({ length: 33 }, (_, t) => linToXYZ(g, a.map((v, k) => v + (b[k] - v) * (t / 32)))));
  }
  return edges;
}
const CORNER_LABEL = ["黒", "赤", "緑", "黄", "青", "マゼンタ", "シアン", "白"];

// scene = { gamut, dev: { edges, ring } | null(作業色域と同じなら null), layers: [{ alpha, paths: [{ id, color, pts }] }], ends: [xyz], p3 }
export function renderView(cv, scene) {
  const w = Math.round(cv.clientWidth * devicePixelRatio), h = Math.round(cv.clientHeight * devicePixelRatio);
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  const g = cv.getContext("2d");
  g.clearRect(0, 0, w, h);
  const dpr = devicePixelRatio;
  const P = is2D()
    ? (xyz) => { const c = chroma(xyz); return c ? map2D(c, w, h) : null; }
    : (xyz) => project(toSpace(xyz, scene.gamut), w, h);

  // 描くものを「線分」と「点」に分けて集め、3Dは奥から順に描く
  const segs = [], dots = [], labels = [];
  const line = (pts, color, { width = 1, dash = null, alpha = 1 } = {}) => {
    const q = pts.map(P);
    for (let i = 0; i < q.length - 1; i++) if (q[i] && q[i + 1]) segs.push({ a: q[i], b: q[i + 1], z: (q[i][2] + q[i + 1][2]) / 2, color, width, dash, alpha });
  };
  const dot = (xyz, color, r, alpha = 1) => { const q = P(xyz); if (q) dots.push({ p: q, z: q[2], color, r, alpha }); };

  if (is2D()) {
    // 馬蹄形の塗りは弓の形で切り抜く(縁のギザギザを出さない)
    const loc = LOCUS_SMOOTH.map((xy) => map2D(fromXy(xy), w, h));
    const locPath = () => { g.beginPath(); loc.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); };
    g.save(); locPath(); g.clip(); g.drawImage(locusFill(w, h, scene.p3), 0, 0); g.restore();
    // 目盛り
    g.strokeStyle = "#ffffff14"; g.fillStyle = "#8a8f9c"; g.lineWidth = dpr; g.font = `${10 * dpr}px system-ui`;
    for (let t = 0; t <= 0.8; t += 0.1) {
      const [x] = map2D([t, 0], w, h), [, y] = map2D([0, t], w, h);
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.moveTo(0, y); g.lineTo(w, y); g.stroke();
      g.fillText(t.toFixed(1), x + 2 * dpr, h - 4 * dpr); g.fillText(t.toFixed(1), 2 * dpr, y - 2 * dpr);
    }
    // 弓(スペクトル軌跡)+紫の直線+波長
    g.strokeStyle = "#ddd"; g.lineWidth = 1.5 * dpr; g.lineJoin = "round"; locPath(); g.stroke();
    // 波長の目盛り(弓の外側へ)
    const [cx, cy] = map2D(fromXy([0.3127, 0.329]), w, h);
    for (const [l, x, y] of LOCUS) if ([460, 480, 500, 520, 540, 560, 580, 600, 620, 700].includes(l)) {
      const [px, py] = map2D(fromXy([x, y]), w, h);
      const d = Math.hypot(px - cx, py - cy) || 1, ux = (px - cx) / d, uy = (py - cy) / d;
      g.strokeStyle = "#ddd"; g.beginPath(); g.moveTo(px, py); g.lineTo(px + ux * 5 * dpr, py + uy * 5 * dpr); g.stroke();
      labels.push({ p: [px + ux * 6 * dpr, py + uy * 6 * dpr], text: `${l}`, color: "#cfd3dc", small: true, dir: [ux, uy] });
    }
    // 色域の三角形(作業=白、デバイス=橙の破線)
    line(rgbOutline(scene.gamut).ring, "#ffffff", { width: 1.5 });
    if (scene.dev) line(scene.dev.ring, "#ff9a3d", { width: 1.5, dash: [5, 4] });
    labels.push({ p: P(linToXYZ("srgb", [1, 1, 1])), text: "白(D65)", color: "#fff", small: true });
  } else {
    for (const e of gamutEdges(scene.gamut)) line(e, "#8b90a0", { width: 1 });
    if (scene.dev) for (const e of scene.dev.edges) line(e, "#ff9a3d", { width: 1, dash: [4, 3] });
    line([[0, 0, 0], linToXYZ(scene.gamut, [1, 1, 1])], "#bbb", { dash: [3, 3] });
    for (let i = 0; i < 8; i++) {
      const c = linToXYZ(scene.gamut, [i & 1, (i >> 1) & 1, (i >> 2) & 1]);
      dot(c, i ? dotCol(c) : "#000", 4.5);
      labels.push({ p: P(c), text: CORNER_LABEL[i], color: "#c8cad0", small: true });
    }
    if (view.mode === "oklab") {
      // a・b の軸(L=0.5 の高さ)と端の名前
      for (const [from, to, tf, tt] of [[[0.5, -0.3, 0], [0.5, 0.3, 0], "緑み −a", "+a 赤み"], [[0.5, 0, -0.3], [0.5, 0, 0.3], "青み −b", "+b 黄み"]]) {
        line([oklabToXYZ(from), oklabToXYZ(to)], "#6b7080", { dash: [2, 3] });
        labels.push({ p: P(oklabToXYZ(from)), text: tf, color: "#9ea3b0", small: true }, { p: P(oklabToXYZ(to)), text: tt, color: "#9ea3b0", small: true });
      }
    }
  }
  // 混色の経路(注目中の方式以外は薄く)
  for (const layer of scene.layers) for (const p of layer.paths) {
    const dim = view.focus && view.focus !== p.id ? 0.15 : 1;
    line(p.pts, "#000", { width: 4, alpha: 0.55 * layer.alpha * dim });
    line(p.pts, p.color, { width: 2.2, alpha: layer.alpha * dim });
    const mid = p.pts[Math.floor(p.pts.length / 2)];
    dot(mid, dotCol(mid), 5, layer.alpha * dim);
  }
  // A・B・C は先に置く(重なったら色名や波長のほうをずらす/出さない)
  scene.ends.forEach((c, i) => { dot(c, dotCol(c), 7); labels.unshift({ p: P(c), text: "ABC"[i], color: "#fff", bold: true, badge: dotCol(c) }); });

  // 奥行き: z が大きいほど奥。奥ほど薄く細く
  const zs = [...segs.map((s) => s.z), ...dots.map((d) => d.z)];
  const zmin = Math.min(...zs), zmax = Math.max(...zs);
  const cue = (z) => (is2D() || zmax - zmin < 1e-6 ? 1 : 1 - 0.6 * ((z - zmin) / (zmax - zmin)));
  const items = [...segs.map((s) => ({ ...s, t: "s" })), ...dots.map((d) => ({ ...d, t: "d" }))];
  if (!is2D()) items.sort((a, b) => b.z - a.z);
  for (const it of items) {
    const k = cue(it.z);
    g.globalAlpha = it.alpha * (0.35 + 0.65 * k);
    if (it.t === "s") {
      g.strokeStyle = it.color; g.lineWidth = it.width * dpr * (0.6 + 0.4 * k);
      g.setLineDash(it.dash ? it.dash.map((d) => d * dpr) : []);
      g.beginPath(); g.moveTo(it.a[0], it.a[1]); g.lineTo(it.b[0], it.b[1]); g.stroke();
    } else {
      g.setLineDash([]);
      g.fillStyle = it.color; g.beginPath(); g.arc(it.p[0], it.p[1], it.r * dpr * (0.7 + 0.3 * k), 0, Math.PI * 2); g.fill();
      g.strokeStyle = "#000a"; g.lineWidth = dpr; g.stroke();
    }
  }
  g.globalAlpha = 1; g.setLineDash([]);
  placeLabels(g, labels.filter((l) => l.p), w, h, dots.filter((d) => d.r >= 7).map((d) => d.p));
  if (!is2D() && view.mode === "oklab") {
    g.font = `${10 * dpr}px system-ui`; g.fillStyle = "#8a8f9c";
    g.fillText("縦=明るさL / 横=色み(a,b)", 8 * dpr, h - 8 * dpr);
  }
}

// ラベルの置き場所を決める: 点の周り8方向(dir があればその向きを優先)を順に試し、
// 先に置いたラベル・大きな点(A/B/C)と重ならない所に置く。どこも空かなければ出さない
function placeLabels(g, labels, w, h, avoidPts) {
  const dpr = devicePixelRatio, placed = [];
  for (const p of avoidPts) placed.push([p[0] - 8 * dpr, p[1] - 8 * dpr, p[0] + 8 * dpr, p[1] + 8 * dpr]);
  const hit = (r) => placed.some((q) => r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1]);
  for (const l of labels) {
    const size = (l.small ? 10 : 12) * dpr;
    g.font = `${l.bold ? "bold " : ""}${size}px system-ui`;
    const tw = g.measureText(l.text).width + (l.badge ? 8 * dpr : 0), th = size + (l.badge ? 4 * dpr : 0);
    const gap = (l.badge ? 10 : 5) * dpr;
    let dirs = [[1, -1], [1, 1], [-1, -1], [-1, 1], [1, 0], [-1, 0], [0, -1], [0, 1]];
    if (l.dir) dirs = [l.dir.map((v) => (Math.abs(v) < 0.38 ? 0 : Math.sign(v))), ...dirs];
    let rect = null;
    for (const [dx, dy] of dirs) {
      const x = dx > 0 ? l.p[0] + gap : dx < 0 ? l.p[0] - gap - tw : l.p[0] - tw / 2;
      const y = dy > 0 ? l.p[1] + gap : dy < 0 ? l.p[1] - gap - th : l.p[1] - th / 2;
      const r = [x, y, x + tw, y + th];
      if (r[0] < 0 || r[1] < 0 || r[2] > w || r[3] > h || hit(r)) continue;
      rect = r;
      break;
    }
    if (!rect) continue;
    placed.push(rect);
    if (l.badge) {
      // A/B/C は色の枠つきの札にする(色名ラベルと見分けやすく)
      g.fillStyle = "#000d"; g.beginPath(); g.roundRect(rect[0], rect[1], rect[2] - rect[0], rect[3] - rect[1], 4 * dpr); g.fill();
      g.strokeStyle = l.badge; g.lineWidth = 1.5 * dpr; g.stroke();
      g.fillStyle = l.color; g.textBaseline = "middle"; g.fillText(l.text, rect[0] + 4 * dpr, (rect[1] + rect[3]) / 2);
    } else {
      g.textBaseline = "top"; g.lineWidth = 3 * dpr; g.strokeStyle = "#000c";
      g.strokeText(l.text, rect[0], rect[1]); g.fillStyle = l.color; g.fillText(l.text, rect[0], rect[1]);
    }
  }
  g.textBaseline = "alphabetic";
}

// ドラッグ=回転(色度図は移動)、ホイール・ピンチ=拡大
export function bindView(cv, redraw) {
  const pts = new Map();
  let pinch = 0;
  cv.addEventListener("pointerdown", (e) => { pts.set(e.pointerId, [e.clientX, e.clientY]); cv.setPointerCapture(e.pointerId); });
  cv.addEventListener("pointermove", (e) => {
    if (!pts.has(e.pointerId)) return;
    const [px, py] = pts.get(e.pointerId);
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (pinch) view.zoom = Math.min(6, Math.max(0.4, view.zoom * (d / pinch)));
      pinch = d;
    } else if (is2D()) {
      view.panX += (e.clientX - px) * devicePixelRatio; view.panY += (e.clientY - py) * devicePixelRatio;
    } else {
      view.yaw += (e.clientX - px) * 0.01;
      view.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, view.pitch + (e.clientY - py) * 0.01));
    }
    redraw();
  });
  const up = (e) => { pts.delete(e.pointerId); pinch = 0; };
  cv.addEventListener("pointerup", up);
  cv.addEventListener("pointercancel", up);
  cv.addEventListener("wheel", (e) => { e.preventDefault(); view.zoom = Math.min(6, Math.max(0.4, view.zoom * Math.exp(-e.deltaY * 0.0015))); redraw(); }, { passive: false });
}
