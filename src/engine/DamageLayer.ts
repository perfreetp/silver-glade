import earcut from "earcut";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { CreateLineSystem } from "@babylonjs/core/Meshes/Builders/linesBuilder";
import type { LinesMesh } from "@babylonjs/core/Meshes/linesMesh";
import type { Scene } from "@babylonjs/core/scene";
import type { RoofSurface } from "./ReferenceLines";
import {
  type DamageGrade,
  type DamagePatchData,
  GRADE_META,
} from "../types";
import { effectiveGrade } from "../store";

interface RefinedVertex {
  x: number;
  z: number;
  point: Vector3; // 已贴合屋面的世界坐标
  normal: Vector3; // 平滑法线
}

/**
 * 残损图层：所有面片合并为单个 Mesh（千面片仍为 1 次绘制调用）。
 * - 轮廓沿屋面曲率投影贴合（边细分 + 三角形中点递归细分）
 * - 沿平滑法线整体抬升，面片间微小级差防止互相穿插共面闪烁
 * - 顶点色分档着色，等级调整只重写颜色缓冲
 */
export class DamageLayer {
  private mesh: Mesh | null = null;
  private outlines: LinesMesh;
  private outlinePolylines: Vector3[][] = [];
  private material: StandardMaterial;
  /** 与顶点缓冲一一对应的颜色（重建几何时同步生成） */
  private vertexColors: Color4[] = [];
  /** 每个面片占用的连续顶点数（几何按面片顺序写入） */
  private vertexCountPerPatch: number[] = [];
  private vertexCount = 0;
  private triangleCount = 0;
  private nextId = 1;

  constructor(
    private readonly scene: Scene,
    private readonly surface: RoofSurface,
    private getLift: () => number,
    private getOpacity: () => number
  ) {
    this.material = new StandardMaterial("damage-layer-mat", scene);
    this.material.backFaceCulling = false;
    this.material.emissiveColor = new Color3(1, 1, 1);
    this.material.disableLighting = true;
    this.material.alpha = 0.55;
    // 深度预通道：先写深度再做半透明混合，解决面片穿插时的排序错误
    this.material.needDepthPrePass = true;
    this.material.alphaMode = 2; // Engine.ALPHA_COMBINE

    this.outlines = CreateLineSystem(
      "damage-outlines",
      { lines: [], updatable: true },
      scene
    );
    this.outlines.color = new Color3(0.15, 0.15, 0.15);
    this.outlines.alpha = 0.9;
    this.outlines.isPickable = false;
    // 线框在面片之后绘制，避免与抬升面片互相闪烁
    this.outlines.renderingGroupId = 1;
    this.outlines.alwaysSelectAsActiveMesh = true;
  }

  // ---------- 面片数据管理 ----------

  createPatch(rawOutline: Vector3[], severity: number): DamagePatchData {
    const projected = this.projectOutline(rawOutline);
    const patch: DamagePatchData = {
      id: this.nextId++,
      name: `残损区 ${this.nextId - 1}`,
      outline: projected.map((v) => [v.x, v.y, v.z] as [
        number,
        number,
        number
      ]),
      severity: Math.min(1, Math.max(0, severity)),
      manualGrade: null,
      area: polygonAreaXZ(projected.map((v) => [v.x, v.z])),
    };
    return patch;
  }

  /** 轮廓边按步长细分后逐点投影，保证沿曲率贴合 */
  private projectOutline(raw: Vector3[]): Vector3[] {
    const result: Vector3[] = [];
    const n = raw.length;
    for (let i = 0; i < n; i++) {
      const a = raw[i];
      const b = raw[(i + 1) % n];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const steps = Math.max(1, Math.ceil(len / 0.35));
      for (let s = 0; s < steps; s++) {
        const t = s / steps;
        const x = a.x + (b.x - a.x) * t;
        const z = a.z + (b.z - a.z) * t;
        const r = this.surface.project(x, z);
        if (r.hit) result.push(r.point.clone());
      }
    }
    if (result.length < 3) {
      throw new Error("残损轮廓投影到屋面的有效点不足 3 个");
    }
    return result;
  }

  // ---------- 几何重建 ----------

  /** 全量重建（几何 + 颜色），返回耗时毫秒 */
  rebuild(patches: DamagePatchData[]): number {
    const t0 = performance.now();
    const positions: number[] = [];
    const colors: Color4[] = [];
    this.vertexCountPerPatch = [];
    this.outlinePolylines = [];

    patches.forEach((patch, pIdx) => {
      const ring = patch.outline.map(
        (p) => new Vector3(p[0], p[1], p[2])
      );
      const verts = this.triangulatePatch(ring);
      if (verts.length === 0) {
        this.vertexCountPerPatch.push(0);
        return;
      }
      this.vertexCountPerPatch.push(verts.length);

      const grade = effectiveGrade(patch);
      const meta = GRADE_META[grade - 1];
      const base = new Color3(meta.color[0], meta.color[1], meta.color[2]);
      // 面片间微小抬升级差，消除穿插面片共面闪烁（每面片 1.5mm，可忽略）
      const patchLiftBias = pIdx * 0.0015;

      for (const v of verts) {
        const lift = this.getLift() + patchLiftBias;
        positions.push(
          v.point.x + v.normal.x * lift,
          v.point.y + v.normal.y * lift,
          v.point.z + v.normal.z * lift
        );
        colors.push(new Color4(base.r, base.g, base.b, 1));
      }

      // 轮廓线：投影点 + 轻微法线偏移
      const outlineLine = ring.map((p) => {
        const r = this.surface.project(p.x, p.z);
        const lift = this.getLift() + patchLiftBias + 0.004;
        return r.point.add(r.normal.scale(lift));
      });
      this.outlinePolylines.push(outlineLine);
    });

    // earcut 已给出三角形索引流，顶点按三角形顺序排列，索引即顺序号
    const indices: number[] = [];
    for (let i = 0; i < positions.length / 3; i++) indices.push(i);

    this.vertexColors = colors;
    this.vertexCount = positions.length / 3;
    this.triangleCount = indices.length / 3;
    if (this.vertexCount === 0) {
      // 空图层：回收网格，避免向 GPU 上传空缓冲
      this.mesh?.dispose();
      this.mesh = null;
      this.updateOutlines();
      return performance.now() - t0;
    }
    this.applyGeometry(positions, indices, colors);
    this.updateOutlines();
    return performance.now() - t0;
  }

  /** 仅重写颜色缓冲（拖动档位 / 调整等级时调用，毫秒级 O(n)） */
  rebuildColors(patches: DamagePatchData[]): number {
    const t0 = performance.now();
    if (!this.mesh || this.vertexCount === 0) return 0;
    const colors: Color4[] = new Array(this.vertexCount);
    let cursor = 0;
    for (let p = 0; p < patches.length; p++) {
      const count = this.vertexCountPerPatch[p] ?? 0;
      const meta = GRADE_META[effectiveGrade(patches[p]) - 1];
      const c4 = new Color4(meta.color[0], meta.color[1], meta.color[2], 1);
      for (let i = 0; i < count; i++) colors[cursor++] = c4;
    }
    this.vertexColors = colors;
    this.mesh.updateVerticesData(VertexBuffer.ColorKind, colorFlat(colors));
    return performance.now() - t0;
  }

  /** earcut 平面三角化 + 三角形递归中点细分贴合曲率 */
  private triangulatePatch(ring: Vector3[]): RefinedVertex[] {
    const flat: number[] = [];
    for (const p of ring) flat.push(p.x, p.z);
    // earcut 对顺/逆时针输入均兼容
    const triIndices = earcut(flat, [], 2);
    if (triIndices.length === 0) return [];

    const baseVerts: RefinedVertex[] = ring.map((p) => {
      const r = this.surface.project(p.x, p.z);
      return { x: p.x, z: p.z, point: r.point.clone(), normal: r.normal.clone() };
    });

    const out: RefinedVertex[] = [];
    const edgeCache = new Map<string, RefinedVertex>();
    const edgeKey = (a: number, b: number) =>
      a < b ? `${a}|${b}` : `${b}|${a}`;
    const midIndices = new Map<string, number>();
    const getMidIndex = (i: number, j: number): number => {
      const key = edgeKey(i, j);
      let idx = midIndices.get(key);
      if (idx === undefined) {
        const m = this.midVertex(
          baseVerts[i],
          baseVerts[j],
          edgeCache,
          key
        );
        idx = baseVerts.length;
        baseVerts.push(m);
        midIndices.set(key, idx);
      }
      return idx;
    };

    const refine2 = (ia: number, ib: number, ic: number, depth: number) => {
      const a = baseVerts[ia];
      const b = baseVerts[ib];
      const c = baseVerts[ic];
      const lab = edgeLen(a, b);
      const lbc = edgeLen(b, c);
      const lca = edgeLen(c, a);
      if (depth >= 3 || Math.max(lab, lbc, lca) < 0.6) {
        out.push(a, b, c);
        return;
      }
      if (lab >= lbc && lab >= lca) {
        const im = getMidIndex(ia, ib);
        refine2(ia, im, ic, depth + 1);
        refine2(im, ib, ic, depth + 1);
      } else if (lbc >= lca) {
        const im = getMidIndex(ib, ic);
        refine2(ia, ib, im, depth + 1);
        refine2(ia, im, ic, depth + 1);
      } else {
        const im = getMidIndex(ic, ia);
        refine2(ia, ib, im, depth + 1);
        refine2(ib, ic, im, depth + 1);
      }
    };

    for (let k = 0; k < triIndices.length; k += 3) {
      refine2(
        triIndices[k],
        triIndices[k + 1],
        triIndices[k + 2],
        0
      );
    }
    return out;
  }

  private midVertex(
    a: RefinedVertex,
    b: RefinedVertex,
    cache: Map<string, RefinedVertex>,
    key: string
  ): RefinedVertex {
    const cached = cache.get(key);
    if (cached) return cached;
    const x = (a.x + b.x) / 2;
    const z = (a.z + b.z) / 2;
    const r = this.surface.project(x, z);
    const v: RefinedVertex = {
      x,
      z,
      point: r.point.clone(),
      normal: r.normal.clone(),
    };
    cache.set(key, v);
    return v;
  }

  private applyGeometry(
    positions: number[],
    indices: number[],
    colors: Color4[]
  ) {
    const vertexData = new VertexData();
    vertexData.positions = positions;
    vertexData.indices = indices;
    vertexData.colors = colorFlat(colors);
    if (this.mesh) {
      this.mesh.updateVerticesData(VertexBuffer.PositionKind, positions);
      this.mesh.updateVerticesData(VertexBuffer.ColorKind, colorFlat(colors));
      this.mesh.updateIndices(indices);
      this.mesh.createNormals(true);
      this.mesh.refreshBoundingInfo();
    } else {
      this.mesh = new Mesh("damage-layer", this.scene);
      vertexData.applyToMesh(this.mesh, true);
      this.mesh.material = this.material;
      this.mesh.isPickable = false;
      this.mesh.alwaysSelectAsActiveMesh = true;
      this.mesh.hasVertexAlpha = true;
    }
  }

  private updateOutlines() {
    // 每次重建而非 instance 更新：instance 模式不重建索引且缓冲容量固定，
    // 轮廓增长后会被截断
    this.outlines.dispose();
    this.outlines = CreateLineSystem(
      "damage-outlines",
      { lines: this.outlinePolylines, updatable: true },
      this.scene
    );
    this.outlines.color = new Color3(0.15, 0.15, 0.15);
    this.outlines.alpha = 0.9;
    this.outlines.isPickable = false;
    this.outlines.renderingGroupId = 1;
    this.outlines.alwaysSelectAsActiveMesh = true;
  }

  // ---------- 渲染参数 ----------

  setOpacity(value: number) {
    this.material.alpha = value;
  }

  setDepthPrePass(enabled: boolean) {
    this.material.needDepthPrePass = enabled;
  }

  setDoubleSided(enabled: boolean) {
    this.material.backFaceCulling = !enabled;
  }

  setWireframe(enabled: boolean) {
    this.material.wireframe = enabled;
  }

  setOutlinesVisible(v: boolean) {
    this.outlines.setEnabled(v);
  }

  get layerTriangleCount(): number {
    return this.triangleCount;
  }

  dispose() {
    this.mesh?.dispose();
    this.outlines.dispose();
    this.material.dispose();
  }
}

// ---------- 工具函数 ----------

function colorFlat(colors: Color4[]): number[] {
  const flat: number[] = new Array(colors.length * 4);
  for (let i = 0; i < colors.length; i++) {
    flat[i * 4] = colors[i].r;
    flat[i * 4 + 1] = colors[i].g;
    flat[i * 4 + 2] = colors[i].b;
    flat[i * 4 + 3] = colors[i].a;
  }
  return flat;
}

function edgeLen(a: RefinedVertex, b: RefinedVertex): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** XZ 平面多边形面积（平方米） */
function polygonAreaXZ(points: [number, number][]): number {
  let sum = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    sum += points[i][0] * points[j][1] - points[j][0] * points[i][1];
  }
  return Math.abs(sum) / 2;
}
