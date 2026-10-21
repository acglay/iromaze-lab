// 「この画面」への出し方。P3 対応なら display-p3 の 2D canvas、HDR 対応(+WebGPU)なら
// rgba16float + toneMapping:"extended" の WebGPU canvas に、SDRの白=1.0 で 1 を超える値をそのまま渡す。
import { xyzToLin, GAMUTS } from "./color.js";

export const screen = {
  p3: typeof matchMedia !== "undefined" && matchMedia("(color-gamut: p3)").matches,
  hdr: typeof matchMedia !== "undefined" && matchMedia("(dynamic-range: high)").matches,
  gpu: null, // HDR出力が使えると確定したら { device, pipeline }
};

export async function initHdr() {
  if (!screen.hdr || !navigator.gpu) return false;
  try {
    const adapter = await navigator.gpu.requestAdapter();
    const device = await adapter.requestDevice();
    const test = document.createElement("canvas").getContext("webgpu");
    test.configure({ device, format: "rgba16float", colorSpace: "display-p3", toneMapping: { mode: "extended" }, alphaMode: "opaque" });
    if (test.getConfiguration?.().toneMapping?.mode !== "extended") return false;
    const module = device.createShaderModule({
      code: `
@group(0) @binding(0) var tex: texture_2d<f32>;
@group(0) @binding(1) var<uniform> u: vec4f;
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  var p = array<vec2f, 3>(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3));
  return vec4f(p[i], 0, 1);
}
@fragment fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let n = textureDimensions(tex).x;
  let i = min(u32(round(pos.x / u.x * f32(n - 1u))), n - 1u);
  return vec4f(textureLoad(tex, vec2u(i, 0u), 0).rgb, 1.0);
}`,
    });
    const pipeline = device.createRenderPipeline({
      layout: "auto",
      vertex: { module, entryPoint: "vs" },
      fragment: { module, entryPoint: "fs", targets: [{ format: "rgba16float" }] },
      primitive: { topology: "triangle-list" },
    });
    screen.gpu = { device, pipeline };
    return true;
  } catch {
    return false;
  }
}

const sizeCanvas = (cv) => {
  const w = Math.max(2, Math.round(cv.clientWidth * devicePixelRatio));
  const h = Math.max(1, Math.round(cv.clientHeight * devicePixelRatio));
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  return [w, h];
};

// 画面の色域(p3 か srgb)の伝達関数つき値。scale = SDR画面でHDRを収めるための縮小率
export function toScreenRgb(xyz, scale = 1, clamp = true) {
  const g = screen.p3 ? "p3" : "srgb";
  return xyzToLin(g, xyz).map((v) => {
    const s = v * scale;
    return GAMUTS[g].enc(clamp ? Math.min(1, Math.max(0, s)) : Math.max(0, s));
  });
}
export const cssColor = (xyz, scale = 1) => {
  const [r, g, b] = toScreenRgb(xyz, scale);
  return screen.p3 ? `color(display-p3 ${r.toFixed(4)} ${g.toFixed(4)} ${b.toFixed(4)})` : `rgb(${(r * 255).toFixed(1)} ${(g * 255).toFixed(1)} ${(b * 255).toFixed(1)})`;
};

// 帯を1本描く。xyzs = 左から右への色(N+1個)
export function paintBand(cv, xyzs, { hdr, scale }) {
  if (hdr && screen.gpu) return paintGpu(cv, xyzs);
  const [w, h] = sizeCanvas(cv);
  const g = cv.getContext("2d", screen.p3 ? { colorSpace: "display-p3" } : undefined);
  const img = screen.p3 ? g.createImageData(w, h, { colorSpace: "display-p3" }) : g.createImageData(w, h);
  const cols = xyzs.map((x) => toScreenRgb(x, scale).map((v) => Math.round(v * 255)));
  const n = xyzs.length - 1;
  for (let x = 0; x < w; x++) {
    const c = cols[Math.round((x / (w - 1)) * n)];
    const tick = Math.abs(x - w / 2) < devicePixelRatio;
    for (let y = 0; y < h; y++) {
      const k = (y * w + x) * 4;
      const dark = tick && (y < h * 0.18 || y > h * 0.82);
      img.data[k] = dark ? 0 : c[0]; img.data[k + 1] = dark ? 0 : c[1]; img.data[k + 2] = dark ? 0 : c[2]; img.data[k + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
}

function paintGpu(cv, xyzs) {
  const { device, pipeline } = screen.gpu;
  const [w] = sizeCanvas(cv);
  if (!cv._gpu) {
    const ctx = cv.getContext("webgpu");
    ctx.configure({ device, format: "rgba16float", colorSpace: "display-p3", toneMapping: { mode: "extended" }, alphaMode: "opaque" });
    const ubuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    cv._gpu = { ctx, ubuf, tex: null, bind: null };
  }
  const st = cv._gpu;
  const n = xyzs.length;
  if (!st.tex || st.tex.width !== n) {
    st.tex = device.createTexture({ size: [n, 1], format: "rgba32float", usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    st.bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: st.tex.createView() }, { binding: 1, resource: { buffer: st.ubuf } }] });
  }
  const data = new Float32Array(n * 4);
  xyzs.forEach((x, i) => {
    const [r, g, b] = toScreenHdr(x);
    data.set([r, g, b, 1], i * 4);
  });
  device.queue.writeTexture({ texture: st.tex }, data, { bytesPerRow: n * 16 }, [n, 1]);
  device.queue.writeBuffer(st.ubuf, 0, new Float32Array([w, 0, 0, 0]));
  const enc = device.createCommandEncoder();
  const pass = enc.beginRenderPass({ colorAttachments: [{ view: st.ctx.getCurrentTexture().createView(), loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 1] }] });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, st.bind);
  pass.draw(3);
  pass.end();
  device.queue.submit([enc.finish()]);
}
// HDR用: display-p3 の伝達関数を 1 の外まで延長した値(1 = SDRの白)
const toScreenHdr = (xyz) => xyzToLin("p3", xyz).map((v) => GAMUTS.p3.enc(Math.max(0, v)));

// 帯の下の目印(div の背景グラデーション): 赤紫=出力デバイスの色域の外 / 黄=明るさの上限を超えた
export function paintFlags(el, flags) {
  const col = (f) => (f.outGamut && f.overPeak ? "#ff8a3d" : f.outGamut ? "#ff3df2" : f.overPeak ? "#ffd400" : "transparent");
  const n = flags.length - 1, stops = [];
  flags.forEach((f, i) => {
    const c = col(f);
    stops.push(`${c} ${((Math.max(0, i - 0.5) / n) * 100).toFixed(2)}%`, `${c} ${((Math.min(n, i + 0.5) / n) * 100).toFixed(2)}%`);
  });
  el.style.background = flags.some((f) => f.outGamut || f.overPeak) ? `linear-gradient(90deg, ${stops.join(", ")})` : "transparent";
}
