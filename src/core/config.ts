/** 场景与栅格常量、菇架几何、喷头方向计算 */

export const ROOM = { width: 22, depth: 14, height: 4 };

/** 地面湿度栅格分辨率 */
export const GRID_W = 176;
export const GRID_H = 112;

/** 菇架：三条沿 X 走向的架子，每条 4 层 */
export const RACKS = {
  rows: [-4.4, 0, 4.4], // 架体中心 z 坐标
  length: 16, // 沿 x 长度
  width: 1.7, // 沿 z 宽度
  layers: [0.5, 1.2, 1.9, 2.6], // 各层板面高度
  board: 0.07, // 层板厚度
};

export const NOZZLE_HEIGHT = 3.15;

export interface BoxSpec {
  min: [number, number, number];
  max: [number, number, number];
}

/** 菇架层板的 AABB 列表（遮挡体） */
export function rackBoxes(): BoxSpec[] {
  const boxes: BoxSpec[] = [];
  for (const z of RACKS.rows) {
    for (const y of RACKS.layers) {
      boxes.push({
        min: [-RACKS.length / 2, y - RACKS.board / 2, z - RACKS.width / 2],
        max: [RACKS.length / 2, y + RACKS.board / 2, z + RACKS.width / 2],
      });
    }
  }
  return boxes;
}

/**
 * 喷头方向：tilt 为相对竖直向下（-Y）的偏角（度），azimuth 为绕 Y 轴方位角（度）。
 * azimuth = 0 时偏向 +Z。
 */
export function nozzleDir(n: { tilt: number; azimuth: number }) {
  const t = (n.tilt * Math.PI) / 180;
  const a = (n.azimuth * Math.PI) / 180;
  return {
    x: Math.sin(t) * Math.sin(a),
    y: -Math.cos(t),
    z: Math.sin(t) * Math.cos(a),
  };
}
