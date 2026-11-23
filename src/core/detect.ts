/**
 * 火场边界提取：
 * 1) 以“未过火植被参考色”为基准，计算逐像元的颜色差异（过火指数）；
 * 2) 对指数场做平滑去噪；
 * 3) 用 marching squares 提取阈值等值线，得到原始边界轮廓；
 * 4) 交给 manifold-3d 做并集/分解，消除自交、合并碎片。
 */

import type { BurnField, Georef, RasterImage, Rgb, Vec2 } from './types.ts';
import type { Kernel, PolyGroup } from './kernel.ts';
import { clamp, luminance, smoothstep } from './util.ts';
import { signedArea } from './geom.ts';

export const FIELD_MAX_DIM = 768;

export interface FieldResult {
  field: BurnField;
  /** 原始过火指数（未平滑），同尺寸 */
  raw: Float32Array;
}

/** 计算过火指数场 */
export function computeBurnField(img: RasterImage, reference: Rgb, georef: Georef): FieldResult {
  const scale = Math.min(1, FIELD_MAX_DIM / Math.max(img.width, img.height));
  const w = Math.max(8, Math.round(img.width * scale));
  const h = Math.max(8, Math.round(img.height * scale));
  const raw = new Float32Array(w * h);
  const refLum = Math.max(12, luminance(reference.r, reference.g, reference.b));
  const refGreen = reference.g - (reference.r + reference.b) / 2;

  const sx = img.width / w;
  const sy = img.height / h;

  for (let y = 0; y < h; y++) {
    const py = clamp(Math.floor((y + 0.5) * sy), 0, img.height - 1);
    for (let x = 0; x < w; x++) {
      const px = clamp(Math.floor((x + 0.5) * sx), 0, img.width - 1);
      const o = (py * img.width + px) * 4;
      const r = img.data[o];
      const g = img.data[o + 1];
      const b = img.data[o + 2];
      const alpha = img.data[o + 3] / 255;
      if (alpha < 0.2) {
        raw[y * w + x] = 0;
        continue;
      }
      const lum = luminance(r, g, b);
      const green = g - (r + b) / 2;

      // 1) 变暗：火烧后反射率下降
      const darkness = clamp((refLum - lum) / Math.max(38, refLum * 0.72), 0, 1);
      // 2) 绿度下降：植被被烧毁
      const greenDrop = clamp((refGreen - green) / Math.max(26, Math.abs(refGreen) * 0.5 + 18), 0, 1);
      // 3) 色相偏移：向棕/灰/黑偏移
      const dR = r - reference.r;
      const dG = g - reference.g;
      const dB = b - reference.b;
      const chroma = clamp(Math.sqrt(dR * dR * 0.3 + dG * dG * 0.5 + dB * dB * 0.2) / 92, 0, 1);
      // 4) 低饱和（灰烬）：火烧后常呈低饱和暗色
      const maxc = Math.max(r, g, b);
      const minc = Math.min(r, g, b);
      const sat = maxc > 8 ? (maxc - minc) / maxc : 0;
      const ashGray = clamp((0.34 - sat) / 0.34, 0, 1) * clamp((refLum - lum) / 55 + 0.25, 0, 1);

      let s = 0.42 * darkness + 0.3 * greenDrop + 0.16 * chroma + 0.12 * ashGray;
      s = smoothstep(0.02, 0.72, s);
      raw[y * w + x] = clamp(s, 0, 1);
    }
  }

  const values = boxBlur(raw, w, h, 1);
  const georefOut: Georef = { ...georef };
  return { field: { width: w, height: h, values, georef: georefOut }, raw };
}

function boxBlur(src: Float32Array, w: number, h: number, radius: number): Float32Array {
  if (radius <= 0) return src.slice();
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const win = radius * 2 + 1;
  for (let y = 0; y < h; y++) {
    let sum = 0;
    for (let k = -radius; k <= radius; k++) sum += src[y * w + clamp(k, 0, w - 1)];
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = sum / win;
      sum -= src[y * w + clamp(x - radius, 0, w - 1)];
      sum += src[y * w + clamp(x + radius + 1, 0, w - 1)];
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let k = -radius; k <= radius; k++) sum += tmp[clamp(k, 0, h - 1) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / win;
      sum -= tmp[clamp(y - radius, 0, h - 1) * w + x];
      sum += tmp[clamp(y + radius + 1, 0, h - 1) * w + x];
    }
  }
  return out;
}

/** 估计未过火植被参考色：取影像四周边带中“绿度较高”像素的中位色 */
export function estimateReferenceColor(img: RasterImage): Rgb {
  const samples: number[][] = [];
  const band = Math.max(2, Math.floor(Math.min(img.width, img.height) * 0.12));
  for (let y = 0; y < img.height; y += 3) {
    for (let x = 0; x < img.width; x += 3) {
      const edge = x < band || y < band || x >= img.width - band || y >= img.height - band;
      if (!edge) continue;
      const o = (y * img.width + x) * 4;
      if (img.data[o + 3] < 200) continue;
      const r = img.data[o];
      const g = img.data[o + 1];
      const b = img.data[o + 2];
      samples.push([r, g, b, g - (r + b) / 2]);
    }
  }
  if (samples.length === 0) return { r: 92, g: 118, b: 68 };
  samples.sort((a, b) => a[3] - b[3]);
  const slice = samples.slice(Math.floor(samples.length * 0.55), Math.floor(samples.length * 0.95));
  const pick = slice.length > 0 ? slice : samples;
  const avg = [0, 0, 0];
  for (const s of pick) {
    avg[0] += s[0];
    avg[1] += s[1];
    avg[2] += s[2];
  }
  return {
    r: Math.round(avg[0] / pick.length),
    g: Math.round(avg[1] / pick.length),
    b: Math.round(avg[2] / pick.length),
  };
}

/** 点在指数场中的双线性取值 */
export function burnAtIndex(field: BurnField, x: number, y: number): number {
  const g = field.georef;
  const u = ((x - g.minX) / (g.maxX - g.minX || 1)) * (field.width - 1);
  const v = ((g.maxY - y) / (g.maxY - g.minY || 1)) * (field.height - 1);
  const x0 = clamp(Math.floor(u), 0, field.width - 1);
  const y0 = clamp(Math.floor(v), 0, field.height - 1);
  const x1 = Math.min(field.width - 1, x0 + 1);
  const y1 = Math.min(field.height - 1, y0 + 1);
  const tx = clamp(u - x0, 0, 1);
  const ty = clamp(v - y0, 0, 1);
  const v00 = field.values[y0 * field.width + x0];
  const v10 = field.values[y0 * field.width + x1];
  const v01 = field.values[y1 * field.width + x0];
  const v11 = field.values[y1 * field.width + x1];
  return (v00 * (1 - tx) + v10 * tx) * (1 - ty) + (v01 * (1 - tx) + v11 * tx) * ty;
}

/**
 * Marching squares：提取 value >= threshold 的区域边界，返回地图坐标中的闭合环。
 * 轮廓方向统一为“内部在行进方向左侧”，便于后续按 NonZero 规则规整。
 *
 * 影像边缘的迹地需要闭合边界：在指数场外围补一圈 0，
 * 这样贴边火场会沿影像边界闭合，而不会被丢弃。
 */
export function marchingSquares(field: BurnField, threshold: number): Vec2[][] {
  const { width: iw, height: ih, georef } = field;
  const cw0 = (georef.maxX - georef.minX) / (iw - 1 || 1);
  const ch0 = (georef.maxY - georef.minY) / (ih - 1 || 1);
  const w = iw + 2;
  const h = ih + 2;
  const values = new Float32Array(w * h);
  for (let y = 0; y < ih; y++) {
    values.set(field.values.subarray(y * iw, (y + 1) * iw), (y + 1) * w + 1);
  }
  const minX = georef.minX - cw0;
  const maxY = georef.maxY + ch0;
  const gx = { minX, minY: georef.minY - ch0, maxX: georef.maxX + cw0, maxY };
  const cw = (gx.maxX - gx.minX) / (w - 1 || 1);
  const ch = (gx.maxY - gx.minY) / (h - 1 || 1);
  const px = (x: number) => gx.minX + x * cw;
  const py = (y: number) => gx.maxY - y * ch;

  type Edge = string;
  const hEdge = (x: number, y: number): Edge => `h${x},${y}`;
  const vEdge = (x: number, y: number): Edge => `v${x},${y}`;

  const edgePoint = (edge: Edge): Vec2 => {
    const kind = edge[0];
    const [x, y] = edge.slice(1).split(',').map(Number);
    if (kind === 'h') {
      const a = values[y * w + x];
      const b = values[y * w + Math.min(w - 1, x + 1)];
      const t = Math.abs(b - a) < 1e-9 ? 0.5 : clamp((threshold - a) / (b - a), 0, 1);
      return { x: px(x + t), y: py(y) };
    }
    const a = values[y * w + x];
    const b = values[Math.min(h - 1, y + 1) * w + x];
    const t = Math.abs(b - a) < 1e-9 ? 0.5 : clamp((threshold - a) / (b - a), 0, 1);
    return { x: px(x), y: py(y + t) };
  };

  // 邻接表：edge -> 相连的 edge 列表
  const adj = new Map<Edge, Edge[]>();
  const link = (a: Edge, b: Edge) => {
    const la = adj.get(a);
    if (la) la.push(b);
    else adj.set(a, [b]);
    const lb = adj.get(b);
    if (lb) lb.push(a);
    else adj.set(b, [a]);
  };

  const inside = (x: number, y: number) => values[y * w + x] >= threshold;

  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const tl = inside(x, y) ? 8 : 0;
      const tr = inside(x + 1, y) ? 4 : 0;
      const br = inside(x + 1, y + 1) ? 2 : 0;
      const bl = inside(x, y + 1) ? 1 : 0;
      const code = tl | tr | br | bl;
      if (code === 0 || code === 15) continue;
      const T = hEdge(x, y);
      const R = vEdge(x + 1, y);
      const B = hEdge(x, y + 1);
      const L = vEdge(x, y);
      const centerInside = (values[y * w + x] + values[y * w + x + 1] + values[(y + 1) * w + x] + values[(y + 1) * w + x + 1]) / 4 >= threshold;
      switch (code) {
        case 1:
        case 14:
          link(L, B);
          break;
        case 2:
        case 13:
          link(B, R);
          break;
        case 3:
        case 12:
          link(L, R);
          break;
        case 4:
        case 11:
          link(T, R);
          break;
        case 6:
        case 9:
          link(T, B);
          break;
        case 7:
        case 8:
          link(T, L);
          break;
        case 5:
          if (centerInside) {
            link(T, L);
            link(B, R);
          } else {
            link(T, R);
            link(L, B);
          }
          break;
        case 10:
          if (centerInside) {
            link(T, R);
            link(L, B);
          } else {
            link(T, L);
            link(B, R);
          }
          break;
        default:
          break;
      }
    }
  }

  // 串联为闭合环
  const visited = new Set<string>();
  const loops: Vec2[][] = [];
  for (const start of adj.keys()) {
    if (visited.has(start)) continue;
    const loop: Edge[] = [];
    let current: Edge | undefined = start;
    let prev: Edge | undefined = undefined;
    const guard = Math.max(16, adj.size * 2);
    for (let i = 0; i < guard; i++) {
      if (current === undefined) break;
      visited.add(current);
      loop.push(current);
      const nexts: Edge[] = adj.get(current) ?? [];
      let nextEdge: Edge | undefined = nexts.find((e) => e !== prev && !visited.has(e));
      if (!nextEdge) {
        // 允许回到起点闭合
        if (nexts.some((e) => e === start) && loop.length > 2) {
          nextEdge = undefined;
          break;
        }
        nextEdge = nexts.find((e) => !visited.has(e));
      }
      prev = current;
      current = nextEdge;
      if (nextEdge === undefined) break;
      if (nextEdge === start) break;
    }
    if (loop.length >= 3) {
      let pts = loop.map(edgePoint);
      // 去除相邻重复点
      pts = pts.filter((p, i) => {
        const q = pts[(i + 1) % pts.length];
        return Math.hypot(p.x - q.x, p.y - q.y) > 1e-7;
      });
      if (pts.length >= 3) loops.push(orientLoop(pts));
    }
  }
  return loops;
}

/** 统一环方向：外环逆时针。等值线环本身不带嵌套信息，交给 kernel 的 decompose 处理 */
function orientLoop(ring: Vec2[]): Vec2[] {
  if (signedArea(ring) < 0) return [...ring].reverse();
  return ring;
}

export interface ExtractResult {
  /** 规整后的拓扑组 */
  groups: PolyGroup[];
  /** 原始（未规整）轮廓，用于“修边前”的可视对比 */
  rawLoops: Vec2[][];
  stats: {
    sourceArea: number;
    keptArea: number;
    fragments: number;
    keptGroups: number;
    selfIntersectionsBefore: number;
  };
}

/** 由指数场提取边界并调用 manifold 规整 */
export async function extractBoundary(
  kernel: Kernel,
  field: BurnField,
  opts: { threshold: number; minArea: number; smoothing: number },
): Promise<ExtractResult> {
  const rawLoops = marchingSquares(field, opts.threshold);
  const rawArea = rawLoops.reduce((s, r) => s + Math.abs(signedArea(r)), 0);
  if (rawLoops.length === 0) {
    return {
      groups: [],
      rawLoops: [],
      stats: { sourceArea: 0, keptArea: 0, fragments: 0, keptGroups: 0, selfIntersectionsBefore: 0 },
    };
  }
  // 布尔并集 + 分解（EvenOdd 对等值线输出天然正确）
  const merged = kernel.union(rawLoops, 'EvenOdd');
  const groupsAll = kernel.decompose(merged, 'EvenOdd');
  const before = countLoopsIntersections(rawLoops);

  const kept: PolyGroup[] = [];
  let fragments = 0;
  for (const g of groupsAll) {
    const netArea = polygonGroupArea(g);
    if (netArea < Math.max(0.25, opts.minArea)) {
      fragments++;
      continue;
    }
    let outer = g.outer;
    // 过小的孔洞多为噪声（未过火的斑块），按碎片阈值一并过滤
    let holes = g.holes.filter((h) => Math.abs(signedArea(h)) >= Math.max(1, opts.minArea * 0.5));
    if (opts.smoothing > 0) {
      const simplified = kernel.simplify([outer, ...holes], opts.smoothing, 'NonZero');
      const sub = kernel.decompose(simplified, 'NonZero');
      if (sub.length > 0) {
        outer = sub[0].outer;
        holes = sub.slice(0, 1).flatMap((s) => s.holes);
      }
    }
    if (outer.length >= 3) kept.push({ outer, holes });
  }
  const keptArea = kept.reduce((s, g) => s + polygonGroupArea(g), 0);
  return {
    groups: kept,
    rawLoops,
    stats: {
      sourceArea: rawArea,
      keptArea,
      fragments,
      keptGroups: kept.length,
      selfIntersectionsBefore: before,
    },
  };
}

export function polygonGroupArea(g: PolyGroup): number {
  return Math.abs(signedArea(g.outer)) - g.holes.reduce((s, h) => s + Math.abs(signedArea(h)), 0);
}

function countLoopsIntersections(loops: Vec2[][]): number {
  let total = 0;
  for (const loop of loops) {
    const n = loop.length;
    for (let i = 0; i < n; i++) {
      const a1 = loop[i];
      const a2 = loop[(i + 1) % n];
      for (let j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue;
        const b1 = loop[j];
        const b2 = loop[(j + 1) % n];
        if (Math.max(a1.x, a2.x) < Math.min(b1.x, b2.x) || Math.max(b1.x, b2.x) < Math.min(a1.x, a2.x)) continue;
        if (Math.max(a1.y, a2.y) < Math.min(b1.y, b2.y) || Math.max(b1.y, b2.y) < Math.min(a1.y, a2.y)) continue;
        const d1x = a2.x - a1.x;
        const d1y = a2.y - a1.y;
        const d2x = b2.x - b1.x;
        const d2y = b2.y - b1.y;
        const denom = d1x * d2y - d1y * d2x;
        if (Math.abs(denom) < 1e-12) continue;
        const t = ((b1.x - a1.x) * d2y - (b1.y - a1.y) * d2x) / denom;
        const u = ((b1.x - a1.x) * d1y - (b1.y - a1.y) * d1x) / denom;
        if (t > 1e-9 && t < 1 - 1e-9 && u > 1e-9 && u < 1 - 1e-9) total++;
      }
    }
  }
  return total;
}

/** 生成一张指数场预览（热力图），返回到 canvas */
export function fieldToCanvas(field: BurnField, ramp: [number, number, number][]): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = field.width;
  canvas.height = field.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const img = ctx.createImageData(field.width, field.height);
  for (let i = 0; i < field.values.length; i++) {
    const v = clamp(field.values[i], 0, 1);
    const x = v * (ramp.length - 1);
    const k = Math.min(ramp.length - 2, Math.floor(x));
    const f = x - k;
    const c0 = ramp[k];
    const c1 = ramp[k + 1];
    const o = i * 4;
    img.data[o] = c0[0] + (c1[0] - c0[0]) * f;
    img.data[o + 1] = c0[1] + (c1[1] - c0[1]) * f;
    img.data[o + 2] = c0[2] + (c1[2] - c0[2]) * f;
    img.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}
