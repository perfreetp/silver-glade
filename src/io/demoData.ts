/**
 * 示例数据生成器
 *
 * 生成一座典型的高密度机房：3 排 × 8 列 = 24 个机柜（可按需放大到 200），
 * 每排机柜交替冷热通道；局部叠加几个"热点"，让等值面带点看头。
 *
 * 输出长表 CSV，字段与导入解析器约定一致。
 */

import { FACE_COLS, FACE_ROWS } from "../model/types";

export interface DemoOptions {
  rows?: number;
  cols?: number;
  seed?: number;
}

/** 确定性伪随机（mulberry32），保证每次示例一致 */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateDemoCsv(opts: DemoOptions = {}): string {
  const rows = opts.rows ?? 3;
  const cols = opts.cols ?? 8;
  const rand = rng(opts.seed ?? 20261123);

  const total = rows * cols;
  if (total > 200) {
    throw new Error("示例机房最大 200 个机柜");
  }

  // 给每个机柜一组系数：基础负载、热点强度、位置
  const load = Array.from({ length: total }, () => 0.35 + rand() * 0.45);
  const hotSpots: { r: number; c: number; power: number; radius: number }[] = [];
  const hotCount = Math.max(2, Math.round(total / 14));
  for (let i = 0; i < hotCount; i++) {
    hotSpots.push({
      r: rand() * (rows - 1),
      c: rand() * (cols - 1),
      power: 4 + rand() * 9,
      radius: 1.2 + rand() * 1.8,
    });
  }

  const lines: string[] = ["rack_id,row,col,facing,face,x,y,temp"];

  for (let r = 0; r < rows; r++) {
    // 偶数排进风朝 +Z，奇数排进风朝 -Z —— 形成相邻排面对面的冷通道
    const facing = r % 2 === 0 ? "+Z" : "-Z";
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      const id = `R${String(r + 1).padStart(2, "0")}-${String(c + 1).padStart(2, "0")}`;

      for (const face of ["intake", "exhaust"] as const) {
        let base = face === "intake" ? 22.5 : 34.5;
        base += load[idx] * (face === "intake" ? 4.5 : 11.0);

        for (const hs of hotSpots) {
          const dr = r - hs.r;
          const dc = c - hs.c;
          const dist = Math.sqrt(dr * dr + dc * dc);
          const falloff = Math.exp(-(dist * dist) / (hs.radius * hs.radius));
          base += hs.power * falloff * (face === "exhaust" ? 1.0 : 0.22);
        }

        for (let y = 0; y < FACE_ROWS; y++) {
          for (let x = 0; x < FACE_COLS; x++) {
            // 纵向温度梯度：机柜顶部更热
            const vFrac = y / (FACE_ROWS - 1);
            const hFrac = x / (FACE_COLS - 1);
            let t = base;
            t += vFrac * (face === "exhaust" ? 5.5 : 2.2);
            // 中段略高：模拟风道中部的回流
            t += Math.sin(hFrac * Math.PI) * 1.1;
            // 随机噪声
            t += (rand() - 0.5) * 1.4;
            // 少量缺失值，检验插值补全
            const missing = rand() < 0.012;
            lines.push(
              [id, r, c, facing, face, x, y, missing ? "" : t.toFixed(2)].join(",")
            );
          }
        }
      }
    }
  }

  return lines.join("\n");
}
