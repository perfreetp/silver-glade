export interface ExtractedPalette {
  /** 建议作为中涂层底色的主色（hex） */
  primary: string;
  /** 其余候选色（按占比排序，hex） */
  swatches: string[];
}

interface RGB {
  r: number;
  g: number;
  b: number;
  count: number;
}

function rgbToHex({ r, g, b }: RGB): string {
  const h = (v: number) => Math.round(v).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

/**
 * 从车漆照片提取底色：
 * 1. 缩放到 ≤160px，中心区域加权（边缘常含背景/反光）
 * 2. k-means（k=5，固定种子，确定性结果）聚出主色簇
 * 3. 过滤过暗（阴影）与过亮（高光）簇，取占比最大者为底色
 */
export async function extractPalette(file: File): Promise<ExtractedPalette> {
  const bitmap = await createImageBitmap(file);
  const target = 160;
  const scale = Math.min(1, target / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  const { data } = ctx.getImageData(0, 0, w, h);
  const samples: { r: number; g: number; b: number; w: number }[] = [];
  const cx = w / 2;
  const cy = h / 2;
  const maxD = Math.hypot(cx, cy);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const a = data[i + 3] / 255;
      if (a < 0.5) continue;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      // 中心加权权重 1.0 → 边缘 0.25
      const weight = (1.25 - Math.hypot(x - cx, y - cy) / maxD) * a;
      samples.push({ r, g, b, w: Math.max(0.25, weight) });
    }
  }

  if (samples.length === 0) {
    return { primary: '#888888', swatches: [] };
  }

  // 固定种子 k-means，k=5
  const k = 5;
  const seeds: RGB[] = [];
  for (let i = 0; i < k; i++) {
    const idx = Math.floor((i + 0.5) * (samples.length / k));
    const s = samples[Math.min(idx, samples.length - 1)];
    seeds.push({ r: s.r, g: s.g, b: s.b, count: 0 });
  }
  const centers = seeds.map((c) => ({ ...c }));
  const assign = new Array<number>(samples.length);

  for (let iter = 0; iter < 12; iter++) {
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < k; c++) {
        const dr = s.r - centers[c].r;
        const dg = s.g - centers[c].g;
        const db = s.b - centers[c].b;
        const d = dr * dr + dg * dg + db * db;
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      assign[i] = best;
    }
    const sums = centers.map(() => ({ r: 0, g: 0, b: 0, w: 0 }));
    for (let i = 0; i < samples.length; i++) {
      const c = assign[i];
      const s = samples[i];
      sums[c].r += s.r * s.w;
      sums[c].g += s.g * s.w;
      sums[c].b += s.b * s.w;
      sums[c].w += s.w;
    }
    for (let c = 0; c < k; c++) {
      if (sums[c].w > 0) {
        centers[c].r = sums[c].r / sums[c].w;
        centers[c].g = sums[c].g / sums[c].w;
        centers[c].b = sums[c].b / sums[c].w;
        centers[c].count = sums[c].w;
      }
    }
  }

  // 过滤极端高光/阴影簇：明度 <0.12 或 >0.93
  const valid = centers.filter((c) => {
    const lum = (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
    return lum >= 0.12 && lum <= 0.93 && c.count > 0;
  });
  const pool = valid.length > 0 ? valid : centers;
  const ranked = [...pool].sort((a, b) => b.count - a.count);

  const primary = rgbToHex(ranked[0]);
  const swatches = ranked.slice(1, 5).map(rgbToHex);
  return { primary, swatches };
}
