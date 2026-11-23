import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { CreateLineSystem } from "@babylonjs/core/Meshes/Builders/linesBuilder";
import type { LinesMesh } from "@babylonjs/core/Meshes/linesMesh";
import type { Scene } from "@babylonjs/core/scene";

/** 屋面表面统一抽象：程序化屋面与导入网格共用 */
export interface RoofSurface {
  project(x: number, z: number): {
    point: Vector3;
    normal: Vector3;
    hit: boolean;
  };
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  ridgeSpacing: number;
}

const RIDGE_COLOR = new Color3(1.0, 0.78, 0.35); // 垄向线：暖黄
const SLOPE_COLOR = new Color3(0.45, 0.78, 1.0); // 坡度线：冷蓝

/**
 * 按坡度与垄向生成两套参考线：
 * - 垄向线：沿坡向（Z）延伸、对齐瓦垄 X 周期
 * - 坡度线：进深方向上的等距横线（等 u 线），用于判读坡度分区
 */
export function buildReferenceLines(
  scene: Scene,
  surface: RoofSurface
): { ridgeLines: LinesMesh; slopeLines: LinesMesh } {
  const { minX, maxX, minZ, maxZ } = surface.bounds;
  const sampleStep = 0.5;

  // ---- 垄向线：固定 X，沿 Z 采样 ----
  const ridgePolylines: Vector3[][] = [];
  const startX =
    Math.ceil(minX / surface.ridgeSpacing) * surface.ridgeSpacing;
  for (let x = startX; x <= maxX; x += surface.ridgeSpacing) {
    const line: Vector3[] = [];
    for (let z = minZ; z <= maxZ + 1e-6; z += sampleStep) {
      const r = surface.project(x, z);
      if (r.hit) {
        line.push(r.point.clone());
      } else if (line.length > 1) {
        ridgePolylines.push(line);
        line.length = 0;
      }
    }
    if (line.length > 1) ridgePolylines.push(line);
  }
  const ridgeLines = CreateLineSystem(
    "ref-ridge-lines",
    { lines: ridgePolylines, updatable: false },
    scene
  );
  ridgeLines.color = RIDGE_COLOR;
  ridgeLines.alpha = 0.55;
  ridgeLines.isPickable = false;

  // ---- 坡度线：固定 Z（等 u），沿 X 采样 ----
  const slopePolylines: Vector3[][] = [];
  const stations = 13;
  for (let i = 0; i < stations; i++) {
    const z = minZ + ((maxZ - minZ) * i) / (stations - 1);
    const line: Vector3[] = [];
    for (let x = minX; x <= maxX + 1e-6; x += sampleStep) {
      const r = surface.project(x, z);
      if (r.hit) {
        line.push(r.point.clone());
      } else if (line.length > 1) {
        slopePolylines.push(line);
        line.length = 0;
      }
    }
    if (line.length > 1) slopePolylines.push(line);
  }
  const slopeLines = CreateLineSystem(
    "ref-slope-lines",
    { lines: slopePolylines, updatable: false },
    scene
  );
  slopeLines.color = SLOPE_COLOR;
  slopeLines.alpha = 0.45;
  slopeLines.isPickable = false;

  return { ridgeLines, slopeLines };
}
