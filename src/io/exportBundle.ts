/**
 * 导出模块
 *
 * 打包成一个 .zip，包含：
 *   manifest.json      —— 场景元数据、阈值、坐标系说明
 *   isosurface.obj     —— 等值面网格（Wavefront OBJ，带顶点温度注释行）
 *   isosurface.ply     —— 同上，二进制 PLY（含温度属性，兼容 MeshLab / CloudCompare）
 *   field.bin          —— 三维温度标量场（Float32，X 快变）
 *   field.json         —— 标量场的维度/原点/单元尺寸
 *   racks.json         —— 机柜几何、朝向、每面采样温度
 *   preview.png        —— 当前视图截图（可选）
 *
 * 全部在浏览器内生成并触发下载，不上传任何数据。
 */

import { zip, strToU8 } from "fflate";
import type { RoomLayout } from "../model/types";
import type { FieldGrid } from "../engine/fieldGrid";

export interface ExportInput {
  layout: RoomLayout;
  grid: FieldGrid | null;
  threshold: number;
  isoVerts: Float32Array;
  field: {
    data: Float32Array;
    dim: [number, number, number];
    origin: [number, number, number];
    cellSize: number;
  };
  palette: string;
  preview?: string | null;
  camera?: { alpha: number; beta: number; radius: number };
}

const VERTEX_FLOATS = 8;

export function buildObj(verts: Float32Array, threshold: number): string {
  const n = Math.floor(verts.length / VERTEX_FLOATS);
  const out: string[] = [];
  out.push("# 机柜热力等值面 / Iso-surface of rack thermal field");
  out.push(`# threshold: ${threshold.toFixed(2)} C`);
  out.push(`# vertices: ${n}  triangles: ${Math.floor(n / 3)}`);
  out.push("# vertex layout: x y z nx ny nz temp");
  out.push("mtllib thermal.mtl");
  out.push("o isosurface");

  const buf: string[] = [];
  for (let i = 0; i < n; i++) {
    const o = i * VERTEX_FLOATS;
    const x = verts[o].toFixed(5);
    const y = verts[o + 1].toFixed(5);
    const z = verts[o + 2].toFixed(5);
    buf.push(`v ${x} ${y} ${z} ${verts[o + 6].toFixed(3)}`);
  }
  out.push(buf.join("\n"));
  buf.length = 0;

  for (let i = 0; i < n; i++) {
    const o = i * VERTEX_FLOATS;
    buf.push(`vn ${verts[o + 3].toFixed(4)} ${verts[o + 4].toFixed(4)} ${verts[o + 5].toFixed(4)}`);
  }
  out.push(buf.join("\n"));
  buf.length = 0;

  out.push("s 1");
  for (let t = 0; t + 2 < n; t += 3) {
    // OBJ 索引从 1 开始
    buf.push(`f ${t + 1}//${t + 1} ${t + 2}//${t + 2} ${t + 3}//${t + 3}`);
  }
  out.push(buf.join("\n"));
  return out.join("\n") + "\n";
}

/** 二进制小端 PLY，属性：x y z nx ny nz temp */
export function buildPly(verts: Float32Array, threshold: number): Uint8Array {
  const n = Math.floor(verts.length / VERTEX_FLOATS);
  const header = [
    "ply",
    "format binary_little_endian 1.0",
    "comment 机柜热力等值面",
    `comment threshold ${threshold.toFixed(3)}`,
    "element vertex " + n,
    "property float x",
    "property float y",
    "property float z",
    "property float nx",
    "property float ny",
    "property float nz",
    "property float temperature",
    "element face " + Math.floor(n / 3),
    "property list uchar int vertex_indices",
    "end_header",
    "",
  ].join("\n");

  const headerBytes = strToU8(header);
  const vertexBytes = n * 7 * 4;
  const triCount = Math.floor(n / 3);
  const faceBytes = triCount * 13; // uchar(1) + 3 × int32
  const total = headerBytes.length + vertexBytes + faceBytes;
  const buf = new ArrayBuffer(total);
  const u8 = new Uint8Array(buf);
  u8.set(headerBytes, 0);

  // 头部长度未必是 4 的倍数，因此不能用 Float32Array 直接覆盖；
  // 统一走 DataView 写入，避免对齐错误，也保证是小端。
  const dv = new DataView(buf);
  let o = headerBytes.length;
  for (let i = 0; i < n; i++) {
    const s = i * VERTEX_FLOATS;
    dv.setFloat32(o, verts[s], true);
    dv.setFloat32(o + 4, verts[s + 1], true);
    dv.setFloat32(o + 8, verts[s + 2], true);
    dv.setFloat32(o + 12, verts[s + 3], true);
    dv.setFloat32(o + 16, verts[s + 4], true);
    dv.setFloat32(o + 20, verts[s + 5], true);
    dv.setFloat32(o + 24, verts[s + 6], true);
    o += 28;
  }

  // 面：每个三角形先写一个 uchar(3)，再写 3 个 int32 顶点索引
  for (let t = 0; t < triCount; t++) {
    u8[o] = 3;
    dv.setInt32(o + 1, t * 3, true);
    dv.setInt32(o + 5, t * 3 + 1, true);
    dv.setInt32(o + 9, t * 3 + 2, true);
    o += 13;
  }
  return u8;
}

export function buildRacksJson(input: ExportInput): string {
  const racks = input.layout.boxes.map((b) => ({
    rack_id: b.rack.id,
    row: b.rack.row,
    col: b.rack.col,
    facing: b.rack.facing,
    bbox: { min: b.min, max: b.max },
    intake: gridToNested(b.rack.intake.values, b.rack.intake.cols, b.rack.intake.rows),
    exhaust: gridToNested(b.rack.exhaust.values, b.rack.exhaust.cols, b.rack.exhaust.rows),
  }));
  return JSON.stringify(
    {
      schema: "thermal-rack-export/1",
      unit: "celsius",
      coordinateSystem: "right-handed, +Y up, metres",
      faceGrid: "row-major [row][col], row 0 = top",
      racks,
    },
    null,
    2
  );
}

function gridToNested(values: Float32Array, cols: number, rows: number): number[][] {
  const out: number[][] = [];
  for (let r = 0; r < rows; r++) {
    const line: number[] = [];
    for (let c = 0; c < cols; c++) {
      const v = values[r * cols + c];
      line.push(Number.isFinite(v) ? Math.round(v * 100) / 100 : 0);
    }
    out.push(line);
  }
  return out;
}

export function buildManifest(input: ExportInput): string {
  return JSON.stringify(
    {
      schema: "thermal-rack-export/1",
      generatedAt: new Date().toISOString(),
      threshold: input.threshold,
      palette: input.palette,
      units: { length: "metre", temperature: "celsius" },
      racks: input.layout.boxes.length,
      isoVertices: Math.floor(input.isoVerts.length / VERTEX_FLOATS),
      isoTriangles: Math.floor(input.isoVerts.length / VERTEX_FLOATS / 3),
      field: input.grid
        ? {
            dim: input.grid.dim,
            origin: input.grid.origin,
            cellSize: input.grid.cellSize,
            ambient: input.grid.ambient,
          }
        : null,
      camera: input.camera ?? null,
      files: [
        "isosurface.obj",
        "isosurface.ply",
        "field.bin",
        "field.json",
        "racks.json",
        "preview.png",
      ],
    },
    null,
    2
  );
}

export function buildFieldJson(input: ExportInput): string {
  return JSON.stringify(
    {
      description: "三维温度标量场（℃），X 快变、Z 慢变",
      dim: input.field.dim,
      origin: input.field.origin,
      cellSize: input.field.cellSize,
      format: "float32, little-endian",
      indexOrder: "i = (z * dimY + y) * dimX + x",
    },
    null,
    2
  );
}

/** 生成 zip 字节流 */
export function buildZip(input: ExportInput): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const files: Record<string, Uint8Array> = {
      "manifest.json": strToU8(buildManifest(input)),
      "isosurface.obj": strToU8(buildObj(input.isoVerts, input.threshold)),
      "isosurface.ply": buildPly(input.isoVerts, input.threshold),
      "field.bin": new Uint8Array(input.field.data.buffer.slice(
        input.field.data.byteOffset,
        input.field.data.byteOffset + input.field.data.byteLength
      )),
      "field.json": strToU8(buildFieldJson(input)),
      "racks.json": strToU8(buildRacksJson(input)),
    };

    if (input.preview) {
      const b64 = input.preview.split(",")[1] ?? "";
      try {
        files["preview.png"] = base64ToBytes(b64);
      } catch {
        // 忽略截图失败
      }
    }

    zip(files, { level: 6 }, (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function triggerDownload(data: Uint8Array, filename: string): void {
  const blob = new Blob([data as unknown as BlobPart], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function exportFilename(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `thermal-rack-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.zip`;
}
