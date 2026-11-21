import { WORLD_SIZE } from './constants';

/**
 雪道地形：确定性的多频正弦叠加 + 中部主雪道沟槽。
 纯函数 heightAt(x,z)，供网格生成、路径拾取、贴地测距与标注共用，
 保证各处拿到的地表高度完全一致。
 */
export function heightAt(x: number, z: number): number {
  const half = WORLD_SIZE / 2;

  // 大尺度山势：沿 z 方向整体下滑
  let h = -0.085 * z;

  // 多频起伏（确定性，无随机数，分区加载也能无缝拼接）
  h += 2.6 * Math.sin(x * 0.022 + 1.7) * Math.cos(z * 0.018 - 0.4);
  h += 1.15 * Math.sin(x * 0.051 + z * 0.037 + 2.1);
  h += 0.45 * Math.cos(x * 0.11 - z * 0.087 + 0.6);
  h += 0.18 * Math.sin(x * 0.23 + z * 0.19);

  // 中部主雪道：平缓走廊（|x| 较小处压平），两侧隆起形成雪道岸坡
  const corridor = Math.exp(-(x * x) / (2 * 34 * 34));
  const bank = 1 - corridor;
  h = h * (0.35 + 0.65 * bank) + 3.2 * bank * bank;

  // 雪道入口平台与底端缓冲坡
  const topFlat = 1 / (1 + Math.exp((z - half * 0.72) * 0.12));
  const botFlat = 1 / (1 + Math.exp(-(z + half * 0.78) * 0.1));
  h *= topFlat * botFlat + 0.15;

  return h;
}

/** 数值梯度求地表法线（用于贴地标注朝向与碰撞检测） */
export function normalAt(x: number, z: number, out = { x: 0, y: 1, z: 0 }) {
  const e = 0.35;
  const hL = heightAt(x - e, z);
  const hR = heightAt(x + e, z);
  const hD = heightAt(x, z - e);
  const hU = heightAt(x, z + e);
  let nx = hL - hR;
  let ny = 2 * e;
  let nz = hD - hU;
  const inv = 1 / Math.hypot(nx, ny, nz);
  nx *= inv;
  ny *= inv;
  nz *= inv;
  out.x = nx;
  out.y = ny;
  out.z = nz;
  return out;
}
