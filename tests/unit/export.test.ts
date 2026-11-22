import { describe, it, expect } from "vitest";
import { buildObj, buildPly, buildRacksJson, buildManifest, type ExportInput } from "../../src/io/exportBundle";
import { buildRoomLayout } from "../../src/model/layout";
import { planFieldGrid } from "../../src/engine/fieldGrid";
import { DEFAULT_ROOM, type Rack } from "../../src/model/types";

function makeRack(id: string, row: number, col: number): Rack {
  return {
    id,
    row,
    col,
    facing: "+Z",
    intake: { cols: 6, rows: 6, values: new Float32Array(36).fill(24) },
    exhaust: { cols: 6, rows: 6, values: new Float32Array(36).fill(37) },
  };
}

/** 造 3 个三角形 = 9 个顶点 */
function makeVerts(): Float32Array {
  const v = new Float32Array(9 * 8);
  for (let i = 0; i < 9; i++) {
    const o = i * 8;
    v[o] = i * 0.5;
    v[o + 1] = 1;
    v[o + 2] = -1;
    v[o + 3] = 0;
    v[o + 4] = 1;
    v[o + 5] = 0;
    v[o + 6] = 40 + i;
    v[o + 7] = 0;
  }
  return v;
}

function makeInput(): ExportInput {
  const layout = buildRoomLayout([makeRack("R01", 0, 0), makeRack("R02", 0, 1)], DEFAULT_ROOM);
  const grid = planFieldGrid(layout);
  return {
    layout,
    grid,
    threshold: 42.5,
    isoVerts: makeVerts(),
    field: {
      data: new Float32Array(8 * 8 * 8).fill(25),
      dim: [8, 8, 8],
      origin: [-1, 0, -1],
      cellSize: 0.1,
    },
    palette: "thermal",
    preview: null,
  };
}

describe("OBJ 导出", () => {
  it("包含正确数量的 v / vn / f，并且索引从 1 开始", () => {
    const obj = buildObj(makeVerts(), 42.5);
    const lines = obj.split("\n");
    const vs = lines.filter((l) => l.startsWith("v "));
    const vns = lines.filter((l) => l.startsWith("vn "));
    const fs = lines.filter((l) => l.startsWith("f "));
    expect(vs).toHaveLength(9);
    expect(vns).toHaveLength(9);
    expect(fs).toHaveLength(3);
    expect(fs[0]).toBe("f 1//1 2//2 3//3");
    expect(fs[2]).toBe("f 7//7 8//8 9//9");
    // 第 4 分量是温度
    expect(vs[0].split(" ")[4]).toBe("40.000");
    expect(obj).toContain("threshold: 42.50 C");
  });

  it("顶点数为 0 时仍产出合法头部", () => {
    const obj = buildObj(new Float32Array(0), 30);
    expect(obj).toContain("vertices: 0");
    const faceLines = obj.split(String.fromCharCode(10)).filter((l) => l.startsWith("f "));
    expect(faceLines).toHaveLength(0);
  });
});

describe("PLY 导出", () => {
  it("二进制头部与体量匹配，面索引正确", () => {
    const verts = makeVerts();
    const ply = buildPly(verts, 42.5);
    const text = new TextDecoder("latin1").decode(ply.slice(0, 400));
    const idx = text.indexOf("end_header\n") + "end_header\n".length;
    expect(idx).toBeGreaterThan(0);
    const header = text.slice(0, idx);
    expect(header).toContain("format binary_little_endian 1.0");
    expect(header).toContain("element vertex 9");
    expect(header).toContain("element face 3");
    expect(header).toContain("property float temperature");

    const bodyLen = ply.byteLength - idx;
    expect(bodyLen).toBe(9 * 28 + 3 * 13);

    const dv = new DataView(ply.buffer, ply.byteOffset + idx);
    // 第一个顶点
    expect(dv.getFloat32(0, true)).toBeCloseTo(0, 4);
    expect(dv.getFloat32(4, true)).toBeCloseTo(1, 4);
    expect(dv.getFloat32(24, true)).toBeCloseTo(40, 4); // temperature
    // 第一个面
    const faceOff = 9 * 28;
    expect(ply[idx + faceOff]).toBe(3);
    expect(dv.getInt32(faceOff + 1, true)).toBe(0);
    expect(dv.getInt32(faceOff + 5, true)).toBe(1);
    expect(dv.getInt32(faceOff + 9, true)).toBe(2);
  });

  it("头部长度不是 4 的倍数时也不出错（中文注释）", () => {
    const ply = buildPly(makeVerts(), 42.5);
    const text = new TextDecoder("latin1").decode(ply.slice(0, 400));
    const idx = text.indexOf("end_header\n") + "end_header\n".length;
    // 中文注释让头部字节数变长；这里只验证能读出不越界的数值
    const dv = new DataView(ply.buffer, ply.byteOffset + idx);
    const last = 9 * 28 - 4;
    expect(dv.getFloat32(last, true)).toBeCloseTo(48, 3); // 最后一个顶点温度 40+8
  });
});

describe("racks.json / manifest.json", () => {
  it("包含机柜的几何与 6x6 温度", () => {
    const input = makeInput();
    const json = JSON.parse(buildRacksJson(input));
    expect(json.racks).toHaveLength(2);
    const r = json.racks[0];
    expect(r.rack_id).toBe("R01");
    expect(r.intake).toHaveLength(6);
    expect(r.intake[0]).toHaveLength(6);
    expect(r.intake[0][0]).toBe(24);
    expect(r.exhaust[0][0]).toBe(37);
    expect(r.bbox.min).toHaveLength(3);
    expect(json.unit).toBe("celsius");
  });

  it("manifest 记录阈值、顶点数与文件清单", () => {
    const input = makeInput();
    const m = JSON.parse(buildManifest(input));
    expect(m.threshold).toBe(42.5);
    expect(m.isoVertices).toBe(9);
    expect(m.isoTriangles).toBe(3);
    expect(m.racks).toBe(2);
    // manifest 记录的是体素网格规划结果，而非玩具字段的维度
    expect(m.field.dim).toEqual(input.grid!.dim);
    expect(m.field.dim.length).toBe(3);
    expect(m.files).toContain("isosurface.obj");
    expect(m.schema).toBe("thermal-rack-export/1");
  });
});
