// 碰撞检测：线缆采样段 vs 机柜 AABB（slab 法），返回穿模段索引集合与穿透长度
import * as THREE from 'three';

// 单段线段 vs AABB，盒体按 padding 膨胀（取线缆半径，保守判定）
// 标准 slab 算法
export function segmentIntersectsBox(p1, p2, box, padding) {
  const minX = box.min.x - padding, maxX = box.max.x + padding;
  const minY = box.min.y - padding, maxY = box.max.y + padding;
  const minZ = box.min.z - padding, maxZ = box.max.z + padding;

  // 端点在盒内直接命中
  if (
    p1.x > minX && p1.x < maxX && p1.y > minY && p1.y < maxY && p1.z > minZ && p1.z < maxZ
  ) return true;
  if (
    p2.x > minX && p2.x < maxX && p2.y > minY && p2.y < maxY && p2.z > minZ && p2.z < maxZ
  ) return true;

  const dx = p2.x - p1.x, dy = p2.y - p1.y, dz = p2.z - p1.z;
  let tmin = 0, tmax = 1;

  const axes = [
    [p1.x, dx, minX, maxX],
    [p1.y, dy, minY, maxY],
    [p1.z, dz, minZ, maxZ],
  ];
  for (const [o, d, lo, hi] of axes) {
    if (d === 0) {
      if (o <= lo || o >= hi) return false;
      continue;
    }
    let t1 = (lo - o) / d;
    let t2 = (hi - o) / d;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return false;
  }
  return tmax >= 0 && tmin <= 1;
}

// 对整条线缆采样点逐段检测
// 返回 { hitSegments: Set, hitLength, perBox: Map<cabinetId, len> }
export function detectCollisions(points, aabbs, radius) {
  const hitSegments = new Set();
  const perBox = new Map();
  let hitLength = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i], p2 = points[i + 1];
    for (const box of aabbs) {
      if (segmentIntersectsBox(p1, p2, box, radius)) {
        hitSegments.add(i);
        const segLen = p1.distanceTo(p2);
        hitLength += segLen;
        perBox.set(box.cabinetId, (perBox.get(box.cabinetId) || 0) + segLen);
        break; // 该段已命中，不再检查其余盒体
      }
    }
  }
  return { hitSegments, hitLength, perBox };
}

// 批量检测（仅用于初次批量建线后的统计）
export function detectAll(cables, aabbs) {
  for (const cable of cables) {
    cable.collision = detectCollisions(cable.samplePoints, aabbs, cable.radius);
  }
}
