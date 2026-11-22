/**
 * 机房布局：把逻辑上的 (行, 列) 机柜网格铺到世界坐标。
 *
 * 单排机柜沿 +X 排列；不同排沿 +Z 依次排开，相邻两排之间留出通道。
 * 每排机柜的进风面朝向由该排内机柜的 facing 决定（同一排应一致）。
 */

import type { RoomConfig, Rack, RackBox, RoomLayout } from "../model/types";
import { DEFAULT_ROOM } from "../model/types";

export function buildRoomLayout(racks: Rack[], config: RoomConfig = DEFAULT_ROOM): RoomLayout {
  if (racks.length === 0) {
    return {
      config,
      boxes: [],
      boundsMin: [0, 0, 0],
      boundsMax: [config.rackWidth, config.rackHeight, config.rackDepth],
    };
  }

  const rows = new Set<number>();
  const cols = new Set<number>();
  for (const r of racks) {
    rows.add(r.row);
    cols.add(r.col);
  }
  const rowList = Array.from(rows).sort((a, b) => a - b);
  const colList = Array.from(cols).sort((a, b) => a - b);
  const colIndex = new Map(colList.map((c, i) => [c, i]));
  const rowIndex = new Map(rowList.map((r, i) => [r, i]));

  const rowPitch = config.rackDepth + config.aisleWidth;
  const colPitch = config.rackWidth + config.rackGap;

  const totalCols = colList.length;
  const totalRows = rowList.length;
  const spanX = totalCols * config.rackWidth + Math.max(0, totalCols - 1) * config.rackGap;
  const spanZ = totalRows * config.rackDepth + Math.max(0, totalRows - 1) * config.aisleWidth;
  const originX = -spanX / 2;
  const originZ = -spanZ / 2;

  const boxes: RackBox[] = racks.map((rack, index) => {
    const ci = colIndex.get(rack.col) ?? 0;
    const ri = rowIndex.get(rack.row) ?? 0;

    const x0 = originX + ci * colPitch;
    const x1 = x0 + config.rackWidth;
    const z0 = originZ + ri * rowPitch;
    const z1 = z0 + config.rackDepth;

    const min: [number, number, number] = [x0, 0, z0];
    const max: [number, number, number] = [x1, config.rackHeight, z1];
    return { rack, min, max, index };
  });

  let boundsMin: [number, number, number] = [Infinity, 0, Infinity];
  let boundsMax: [number, number, number] = [-Infinity, 0, -Infinity];
  for (const b of boxes) {
    boundsMin = [Math.min(boundsMin[0], b.min[0]), 0, Math.min(boundsMin[2], b.min[2])];
    boundsMax = [Math.max(boundsMax[0], b.max[0]), config.rackHeight, Math.max(boundsMax[2], b.max[2])];
  }
  // 机柜自身可能叠放，兜底
  if (!Number.isFinite(boundsMin[0]) || !Number.isFinite(boundsMin[2])) {
    boundsMin = [originX, 0, originZ];
    boundsMax = [originX + spanX, config.rackHeight, originZ + spanZ];
  }

  return { config, boxes, boundsMin, boundsMax };
}
