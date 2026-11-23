import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";

interface Tri {
  a: Vector3;
  b: Vector3;
  c: Vector3;
  /** 平滑法线（顶点法线面积加权平均） */
  na: Vector3;
  nb: Vector3;
  nc: Vector3;
  /** 包围盒（XZ） */
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface ProjectionResult {
  point: Vector3;
  normal: Vector3;
  hit: boolean;
}

/**
 * 通用屋面投影器：把 XZ 平面上的点沿竖直方向投影到任意三角网格表面。
 * 用 XZ 均匀网格做三角形粗筛，支撑上千残损轮廓点的高频贴合。
 */
export class MeshProjector {
  private tris: Tri[] = [];
  private grid = new Map<number, Tri[]>();
  private readonly cell = 0.5;
  private nx = 0;
  private nz = 0;
  private minX = 0;
  private minZ = 0;

  constructor(private readonly mesh: AbstractMesh) {
    this.build();
  }

  private cellKey(ix: number, iz: number): number {
    return ix * 1000003 + iz;
  }

  private build() {
    const positions = this.mesh.getVerticesData(
      VertexBuffer.PositionKind
    );
    const normals = this.mesh.getVerticesData(VertexBuffer.NormalKind);
    const indices = this.mesh.getIndices();
    if (!positions || !indices) {
      throw new Error("屋面网格缺少位置或索引数据");
    }
    const world = this.mesh.getWorldMatrix();
    const toWorld = (v: Vector3) => Vector3.TransformCoordinates(v, world);

    // 顶点平滑法线（面积加权）
    const vertCount = positions.length / 3;
    const smooth: Vector3[] = new Array(vertCount);
    for (let i = 0; i < vertCount; i++) smooth[i] = Vector3.Zero();
    const p: Vector3[] = new Array(vertCount);
    for (let i = 0; i < vertCount; i++) {
      p[i] = toWorld(
        new Vector3(
          positions[i * 3],
          positions[i * 3 + 1],
          positions[i * 3 + 2]
        )
      );
    }

    let bMinX = Infinity;
    let bMaxX = -Infinity;
    let bMinZ = Infinity;
    let bMaxZ = -Infinity;

    for (let k = 0; k < indices.length; k += 3) {
      const i0 = indices[k];
      const i1 = indices[k + 1];
      const i2 = indices[k + 2];
      const a = p[i0];
      const b = p[i1];
      const c = p[i2];
      const faceN = Vector3.Cross(
        b.subtract(a),
        c.subtract(a)
      );
      // 面积加权累加到各顶点
      smooth[i0].addInPlace(faceN);
      smooth[i1].addInPlace(faceN);
      smooth[i2].addInPlace(faceN);

      const tri: Tri = {
        a,
        b,
        c,
        na: Vector3.Zero(),
        nb: Vector3.Zero(),
        nc: Vector3.Zero(),
        minX: Math.min(a.x, b.x, c.x),
        maxX: Math.max(a.x, b.x, c.x),
        minZ: Math.min(a.z, b.z, c.z),
        maxZ: Math.max(a.z, b.z, c.z),
      };
      this.tris.push(tri);
      bMinX = Math.min(bMinX, tri.minX);
      bMaxX = Math.max(bMaxX, tri.maxX);
      bMinZ = Math.min(bMinZ, tri.minZ);
      bMaxZ = Math.max(bMaxZ, tri.maxZ);
    }
    for (let i = 0; i < vertCount; i++) smooth[i].normalize();

    // 若网格缺法线，平滑法线即作为顶点法线
    const getNormal = (i: number): Vector3 => {
      if (normals) {
        const n = new Vector3(
          normals[i * 3],
          normals[i * 3 + 1],
          normals[i * 3 + 2]
        );
        const wn = Vector3.TransformNormal(n, world);
        if (wn.lengthSquared() > 1e-8) return wn.normalize();
      }
      return smooth[i];
    };
    for (let k = 0; k < this.tris.length; k++) {
      const i0 = indices[k * 3];
      const i1 = indices[k * 3 + 1];
      const i2 = indices[k * 3 + 2];
      this.tris[k].na = getNormal(i0);
      this.tris[k].nb = getNormal(i1);
      this.tris[k].nc = getNormal(i2);
    }

    this.minX = bMinX;
    this.minZ = bMinZ;
    this.nx = Math.max(1, Math.ceil((bMaxX - bMinX) / this.cell));
    this.nz = Math.max(1, Math.ceil((bMaxZ - bMinZ) / this.cell));

    // 三角形注册到与其 XZ 包围盒重叠的所有格子
    for (const tri of this.tris) {
      const ix0 = this.clampIx(
        Math.floor((tri.minX - bMinX) / this.cell)
      );
      const ix1 = this.clampIx(
        Math.floor((tri.maxX - bMinX) / this.cell)
      );
      const iz0 = this.clampIz(
        Math.floor((tri.minZ - bMinZ) / this.cell)
      );
      const iz1 = this.clampIz(
        Math.floor((tri.maxZ - bMinZ) / this.cell)
      );
      for (let ix = ix0; ix <= ix1; ix++) {
        for (let iz = iz0; iz <= iz1; iz++) {
          const key = this.cellKey(ix, iz);
          let list = this.grid.get(key);
          if (!list) {
            list = [];
            this.grid.set(key, list);
          }
          list.push(tri);
        }
      }
    }
  }

  private clampIx(v: number): number {
    return Math.max(0, Math.min(this.nx - 1, v));
  }
  private clampIz(v: number): number {
    return Math.max(0, Math.min(this.nz - 1, v));
  }

  get triangleCount(): number {
    return this.tris.length;
  }

  /** 竖直投影：与三角形求交，取 Y 最大的交点（朝上屋面） */
  project(x: number, z: number): ProjectionResult {
    const ix = this.clampIx(Math.floor((x - this.minX) / this.cell));
    const iz = this.clampIz(Math.floor((z - this.minZ) / this.cell));
    const candidates = this.grid.get(this.cellKey(ix, iz));
    if (!candidates) {
      return { point: new Vector3(x, 0, z), normal: Vector3.Up(), hit: false };
    }
    let bestY = -Infinity;
    let best: { tri: Tri; w0: number; w1: number; w2: number } | null = null;

    for (const tri of candidates) {
      if (
        x < tri.minX ||
        x > tri.maxX ||
        z < tri.minZ ||
        z > tri.maxZ
      ) {
        continue;
      }
      const hit = intersectVertical(tri, x, z);
      if (hit && hit.y > bestY) {
        bestY = hit.y;
        best = { tri, ...hit.weights };
      }
    }
    if (!best) {
      return { point: new Vector3(x, 0, z), normal: Vector3.Up(), hit: false };
    }
    const { tri, w0, w1, w2 } = best;
    const point = new Vector3(
      x,
      bestY,
      z
    );
    const normal = tri.na
      .scale(w0)
      .add(tri.nb.scale(w1))
      .add(tri.nc.scale(w2))
      .normalize();
    return { point, normal, hit: true };
  }
}

/** 竖直线 (x, *, z) 与三角形求交，返回交点 Y 与重心坐标 */
function intersectVertical(
  tri: Tri,
  x: number,
  z: number
): { y: number; weights: { w0: number; w1: number; w2: number } } | null {
  const { a, b, c } = tri;
  // 重心坐标（2D，XZ 平面）
  const denom =
    (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
  if (Math.abs(denom) < 1e-12) return null;
  const w0 =
    ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / denom;
  const w1 =
    ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / denom;
  const w2 = 1 - w0 - w1;
  const eps = -1e-6;
  if (w0 < eps || w1 < eps || w2 < eps) return null;
  const y = w0 * a.y + w1 * b.y + w2 * c.y;
  return { y, weights: { w0, w1, w2 } };
}
