import { describe, it, expect } from "vitest";
import { buildRoomLayout } from "../../src/model/layout";
import { computeFaceFrames, packRackInfos, planFieldGrid, buildAccelGrid, FALLOFF } from "../../src/engine/fieldGrid";
import { DEFAULT_ROOM, type Rack, type FacingDir } from "../../src/model/types";

function makeRack(id: string, row: number, col: number, facing: FacingDir, t = 30): Rack {
  return {
    id,
    row,
    col,
    facing,
    intake: { cols: 6, rows: 6, values: new Float32Array(36).fill(t) },
    exhaust: { cols: 6, rows: 6, values: new Float32Array(36).fill(t + 10) },
  };
}

describe("机房布局", () => {
  it("单机柜占据正确的包围盒尺寸", () => {
    const layout = buildRoomLayout([makeRack("R1", 0, 0, "+Z")], DEFAULT_ROOM);
    expect(layout.boxes).toHaveLength(1);
    const b = layout.boxes[0];
    const w = b.max[0] - b.min[0];
    const d = b.max[2] - b.min[2];
    const h = b.max[1] - b.min[1];
    expect(w).toBeCloseTo(DEFAULT_ROOM.rackWidth, 6);
    expect(d).toBeCloseTo(DEFAULT_ROOM.rackDepth, 6);
    expect(h).toBeCloseTo(DEFAULT_ROOM.rackHeight, 6);
    expect(b.min[1]).toBe(0);
  });

  it("同一排沿 X 排列，不同排沿 Z 分开并留出通道", () => {
    const racks = [
      makeRack("A", 0, 0, "+Z"),
      makeRack("B", 0, 1, "+Z"),
      makeRack("C", 1, 0, "-Z"),
    ];
    const layout = buildRoomLayout(racks, DEFAULT_ROOM);
    const [a, b, c] = layout.boxes;
    // 同排：X 递增，Z 相同
    expect(b.min[0]).toBeGreaterThan(a.min[0]);
    expect(b.min[0] - a.max[0]).toBeCloseTo(DEFAULT_ROOM.rackGap, 6);
    expect(b.min[2]).toBeCloseTo(a.min[2], 6);
    // 相邻排：Z 间距 = 深度 + 通道
    expect(c.min[2] - b.max[2]).toBeCloseTo(DEFAULT_ROOM.aisleWidth, 6);
  });

  it("行列不连续时也能紧凑排布", () => {
    const racks = [
      makeRack("A", 0, 0, "+Z"),
      makeRack("B", 0, 5, "+Z"),
      makeRack("C", 3, 0, "+Z"),
    ];
    const layout = buildRoomLayout(racks, DEFAULT_ROOM);
    expect(layout.boxes).toHaveLength(3);
    const xs = new Set(layout.boxes.map((b) => b.min[0].toFixed(3)));
    expect(xs.size).toBe(2);
  });

  it("整体包围盒覆盖所有机柜", () => {
    const racks = [makeRack("A", 0, 0, "+Z"), makeRack("B", 1, 2, "-Z")];
    const layout = buildRoomLayout(racks, DEFAULT_ROOM);
    for (const b of layout.boxes) {
      for (let k = 0; k < 3; k++) {
        expect(b.min[k]).toBeGreaterThanOrEqual(layout.boundsMin[k] - 1e-6);
        expect(b.max[k]).toBeLessThanOrEqual(layout.boundsMax[k] + 1e-6);
      }
    }
  });
});

describe("风面框架", () => {
  it("进风面法线与朝向一致，出风面法线相反", () => {
    const layout = buildRoomLayout([makeRack("A", 0, 0, "+Z")], DEFAULT_ROOM);
    const [ff] = computeFaceFrames(layout);
    // 朝向 +Z 表示进风面朝 +Z，出风面朝反方向
    expect(ff.intakeNormal[2]).toBeCloseTo(1, 5);
    expect(ff.exhaustNormal[2]).toBeCloseTo(-1, 5);
    expect(ff.intakeNormal[0]).toBeCloseTo(0, 5);
  });

  it("四个角点构成与机柜面等宽等高的矩形", () => {
    const layout = buildRoomLayout([makeRack("A", 0, 0, "+Z")], DEFAULT_ROOM);
    const [ff] = computeFaceFrames(layout);
    const c = ff.intakeCorners;
    expect(c).toHaveLength(4);
    const w = Math.abs(c[1][0] - c[0][0]);
    const h = Math.abs(c[3][1] - c[0][1]);
    expect(w).toBeCloseTo(DEFAULT_ROOM.rackWidth, 5);
    expect(h).toBeCloseTo(DEFAULT_ROOM.rackHeight - 0.008, 4);
    // 角点顺序：(0,0) (1,0) (1,1) (0,1)
    expect(c[2][1]).toBeGreaterThan(c[0][1]);
    expect(c[1][0]).toBeGreaterThan(c[0][0]);
  });

  it("+-X 朝向的面宽度沿 Z 轴", () => {
    const layout = buildRoomLayout([makeRack("A", 0, 0, "+X")], DEFAULT_ROOM);
    const [ff] = computeFaceFrames(layout);
    const w = Math.abs(ff.intakeCorners[1][2] - ff.intakeCorners[0][2]);
    expect(w).toBeCloseTo(DEFAULT_ROOM.rackDepth, 5);
    expect(Math.abs(ff.intakeNormal[0])).toBeCloseTo(1, 5);
  });

  it("packRackInfos 每柜 64 个 float，且包围盒正确", () => {
    const layout = buildRoomLayout([makeRack("A", 0, 0, "+Z"), makeRack("B", 0, 1, "+Z")], DEFAULT_ROOM);
    const ff = computeFaceFrames(layout);
    const packed = packRackInfos(layout, ff);
    // 每柜 = 12 个 vec4 = 48 个 float：8 个角点(32) + 2 个法线(8) + bmin(4) + bmax(4)
    expect(packed.length).toBe(2 * 48);
    const base = 48;
    expect(packed[base + 40]).toBeCloseTo(layout.boxes[1].min[0], 5);
    expect(packed[base + 41]).toBeCloseTo(layout.boxes[1].min[1], 5);
    expect(packed[base + 42]).toBeCloseTo(layout.boxes[1].min[2], 5);
    expect(packed[base + 44]).toBeCloseTo(layout.boxes[1].max[0], 5);
  });
});

describe("体素网格规划", () => {
  it("单元尺寸与体素总量遵守上限", () => {
    const racks: Rack[] = [];
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 40; c++) racks.push(makeRack(`R${r}-${c}`, r, c, r % 2 ? "-Z" : "+Z"));
    }
    const layout = buildRoomLayout(racks, DEFAULT_ROOM);
    const grid = planFieldGrid(layout);
    const total = grid.dim[0] * grid.dim[1] * grid.dim[2];
    expect(total).toBeLessThanOrEqual(820_000);
    expect(grid.cellSize).toBeGreaterThan(0);
    expect(grid.ambient).toBeLessThan(30);
  });

  it("小机房使用较细的体素", () => {
    const layout = buildRoomLayout([makeRack("A", 0, 0, "+Z")], DEFAULT_ROOM);
    const grid = planFieldGrid(layout);
    expect(grid.cellSize).toBeLessThanOrEqual(0.1);
    expect(grid.dim[0]).toBeGreaterThan(10);
  });

  it("场范围足以容纳所有机柜及衰减带", () => {
    const layout = buildRoomLayout([makeRack("A", 0, 0, "+Z"), makeRack("B", 1, 1, "-Z")], DEFAULT_ROOM);
    const grid = planFieldGrid(layout);
    expect(grid.origin[0]).toBeLessThan(layout.boundsMin[0]);
    expect(grid.max[0]).toBeGreaterThan(layout.boundsMax[0]);
  });
});

describe("空间加速格", () => {
  it("每个机柜都至少被放入一个格子", () => {
    const racks: Rack[] = [];
    for (let c = 0; c < 6; c++) racks.push(makeRack(`R${c}`, 0, c, "+Z"));
    const layout = buildRoomLayout(racks, DEFAULT_ROOM);
    const grid = planFieldGrid(layout);
    const accel = buildAccelGrid(layout, grid);
    const found = new Set(accel.items);
    for (let i = 0; i < racks.length; i++) expect(found.has(i)).toBe(true);
  });

  it("前缀和单调不减", () => {
    const racks = [makeRack("A", 0, 0, "+Z"), makeRack("B", 0, 2, "+Z")];
    const layout = buildRoomLayout(racks, DEFAULT_ROOM);
    const grid = planFieldGrid(layout);
    const accel = buildAccelGrid(layout, grid);
    for (let i = 1; i < accel.start.length; i++) {
      expect(accel.start[i]).toBeGreaterThanOrEqual(accel.start[i - 1]);
    }
    expect(accel.start[accel.start.length - 1]).toBe(accel.items.length);
  });

  it("机柜只被放进影响半径覆盖的格子", () => {
    const layout = buildRoomLayout([makeRack("A", 0, 0, "+Z")], DEFAULT_ROOM);
    const grid = planFieldGrid(layout);
    const accel = buildAccelGrid(layout, grid);
    expect(accel.items.length).toBeGreaterThan(0);
    // 影响半径 = FALLOFF*5，格子边长与之相当 => 一个机柜占少量格子
    expect(accel.items.length).toBeLessThan(400);
    expect(FALLOFF).toBeGreaterThan(0.1);
  });
});
