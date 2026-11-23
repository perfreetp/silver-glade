/**
 * 边界可视化：贴地 / 抬升两种模式、受损分级纹理、边界线、顶点手柄。
 *
 * 贴地模式：把边界顶点按坡度自适应加密后投影到地形表面，再重新三角化，
 * 使填充面随地势起伏；抬升模式：同一三角网整体平移到固定高度，便于看清走向。
 */

import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import type { Ring, Vec2, ViewSettings } from '../core/types.ts';
import type { Kernel, PolyGroup } from '../core/kernel.ts';
import { groupRings } from '../core/model.ts';
import { densifyRingSlopeAdaptive, signedArea } from '../core/geom.ts';
import type { SceneEngine } from './scene.ts';
import type { SeverityLayer } from './severityLayer.ts';
import { refineTriangles } from './refine.ts';
import { severityColorFromValue } from '../core/theme.ts';

export interface BoundaryBuildInput {
  rings: Ring[];
  view: ViewSettings;
  /** 交互中的低精度构建（拖动顶点时用，松手后再出高精度） */
  preview?: boolean;
  layer: SeverityLayer | null;
  /** 分级栅格的覆盖范围 */
  gridBounds: { minX: number; minY: number; maxX: number; maxY: number } | null;
  selectedRing: number | null;
  selectedVertex: { ring: number; vertex: number } | null;
  /** 编辑模式才显示顶点手柄 */
  editable: boolean;
}

export interface BuiltBoundary {
  vertexCount: number;
  drapeVertexCount: number;
  triangleCount: number;
  /** 贴地网格是否因预算上限未完全细分 */
  truncated: boolean;
  /** 是否是拖动中的低精度预览 */
  preview: boolean;
}

const SEVERITY_OPACITY = 0.95;

export class BoundaryView {
  readonly group = new THREE.Group();
  private fillMesh: THREE.Mesh | null = null;
  private fillGeometry: THREE.BufferGeometry | null = null;
  private fillMaterial: THREE.Material | null = null;
  private lines: Line2[] = [];
  private lineMaterials: LineMaterial[] = [];
  private handleMesh: THREE.Points | null = null;
  private handleRingMesh: THREE.Points | null = null;
  private outlineGroup = new THREE.Group();
  private lastBuild: BuiltBoundary = { vertexCount: 0, drapeVertexCount: 0, triangleCount: 0, truncated: false, preview: false };

  constructor(private readonly scene: SceneEngine) {
    this.group.add(this.outlineGroup);
    scene.boundaryGroup.add(this.group);
  }

  /** 每次重建后返回可用信息 */
  get stats(): BuiltBoundary {
    return this.lastBuild;
  }

  clear(): void {
    this.disposeFill();
    this.clearLines();
    this.clearHandles();
    this.lastBuild = { vertexCount: 0, drapeVertexCount: 0, triangleCount: 0, truncated: false, preview: false };
  }

  private disposeFill(): void {
    if (this.fillMesh) {
      this.group.remove(this.fillMesh);
      this.fillGeometry?.dispose();
      this.fillMaterial?.dispose();
      this.fillMesh = null;
      this.fillGeometry = null;
      this.fillMaterial = null;
    }
  }

  private clearLines(): void {
    for (const line of this.lines) {
      this.outlineGroup.remove(line);
      line.geometry.dispose();
    }
    for (const m of this.lineMaterials) m.dispose();
    this.lines = [];
    this.lineMaterials = [];
  }

  private clearHandles(): void {
    for (const m of [this.handleMesh, this.handleRingMesh]) {
      if (!m) continue;
      this.group.remove(m);
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    this.handleMesh = null;
    this.handleRingMesh = null;
  }

  build(kernel: Kernel, input: BoundaryBuildInput): BuiltBoundary {
    this.clear();
    const { rings, view, layer, gridBounds, editable, preview } = input;
    if (rings.length === 0) return this.lastBuild;

    const groups = groupRings(rings);
    if (groups.length === 0) return this.lastBuild;

    const georef = this.scene.data.georef;
    const exag = this.scene.exaggeration;
    // 贴地偏移随地形网格分辨率自适应：地形三角面越粗，越需要抬高
    const drapeLift = Math.max(2, this.scene.terrainCell * 1.35);
    // 抬升高度：全场地形高点之上再加 lift（统一一处计算，填充/线/手柄共用）
    const dem = this.scene.data.dem;
    const raisedY = (dem ? dem.maxElev * exag : 0) + view.lift * 2.4 + 6;

    // 1) 构建填充网格：先按边界加密后三角化，再对三角形细分，
    //    使贴地模式下填充面足够细以贴合地形起伏（抬升模式保持原三角网）。
    const { minX, minY, maxX, maxY } = georef;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const spanMin = Math.min(maxX - minX, maxY - minY);
    const fullLimit = Math.max(3, Math.min(7, spanMin / 200));
    const edgeLimit = view.mode === 'drape' ? (preview ? fullLimit * 4 : fullLimit * 1.25) : 16;
    const maxTris = preview ? 4000 : 110000;
    const baseGroups: PolyGroup[] = groups.map((g) => ({
      outer: densifyRingSlopeAdaptive(g.outer, edgeLimit * 1.5, edgeLimit * 0.7, (x, y) => this.scene.slopeAt(x, y), 2.2, 9000),
      holes: g.holes.map((h) => densifyRingSlopeAdaptive(h, edgeLimit * 1.5, edgeLimit * 0.7, (x, y) => this.scene.slopeAt(x, y), 2.2, 4000)),
    }));
    const mesh = kernel.triangulate(baseGroups);
    const refined: { positions: Vec2[]; indices: number[]; truncated: boolean } =
      view.mode === 'drape'
        ? refineTriangles(mesh, { maxEdge: edgeLimit, maxDepth: preview ? 2 : 7, maxTriangles: maxTris })
        : { positions: mesh.positions, indices: mesh.indices, truncated: false };
    if (refined.positions.length === 0) return this.lastBuild;

    const positions = new Float32Array(refined.positions.length * 3);
    const uv = new Float32Array(refined.positions.length * 2);
    const gb = gridBounds ?? { minX, minY, maxX, maxY };
    const gbW = Math.max(1e-6, gb.maxX - gb.minX);
    const gbH = Math.max(1e-6, gb.maxY - gb.minY);
    const yRaised = raisedY;
    for (let i = 0; i < refined.positions.length; i++) {
      const p = refined.positions[i];
      positions[i * 3] = p.x - cx;
      positions[i * 3 + 1] = view.mode === 'drape' ? this.scene.elevationAt(p.x, p.y) * exag + drapeLift : yRaised;
      positions[i * 3 + 2] = -(p.y - cy);
      uv[i * 2] = (p.x - gb.minX) / gbW;
      uv[i * 2 + 1] = (p.y - gb.minY) / gbH;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(refined.indices);
    geo.computeVertexNormals();
    const drapeVertexCount = refined.positions.length;
    const triangleCount = refined.indices.length / 3;

    // 纹理：优先使用分级图层；否则使用单色渐变
    let map: THREE.Texture | null = null;
    if (layer) {
      const tex = new THREE.CanvasTexture(layer.canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.flipY = false;
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.needsUpdate = true;
      map = tex;
    }
    const material = map
      ? new THREE.MeshBasicMaterial({
          map,
          // 分级色是读图依据，不参与雾化与色调映射，保证颜色可复核
          fog: false,
          toneMapped: false,
          transparent: true,
          opacity: SEVERITY_OPACITY,
          // 填充面的绕向已保证法线朝上，用单面渲染可省一半填充开销
          side: THREE.FrontSide,
          depthWrite: false,
          depthTest: true,
        })
      : new THREE.MeshBasicMaterial({
          fog: false,
          toneMapped: false,
          color: 0xef6b2d,
          transparent: true,
          opacity: 0.42,
          side: THREE.DoubleSide,
          depthWrite: false,
        });
    const fill = new THREE.Mesh(geo, material);
    fill.renderOrder = 2;
    this.fillGeometry = geo;
    this.fillMaterial = material;
    this.fillMesh = fill;
    this.group.add(fill);

    // 3) 边界线（贴地形或抬升），使用粗线保证远距离可见
    const lineHeight = (x: number, y: number) =>
      view.mode === 'drape'
        ? this.scene.elevationAt(x, y) * exag + drapeLift * 2
        : raisedY + 1;
    for (let r = 0; r < rings.length; r++) {
      const ring = rings[r];
      const isSelected = input.selectedRing === r;
      const color = isSelected ? new THREE.Color('#ffcf6b') : ring.role === 'hole' ? new THREE.Color('#5ec8e8') : new THREE.Color('#ff6b35');
      const line = this.makeOutline(ring.vertices, lineHeight, color, isSelected ? 4.2 : 2.8);
      this.lines.push(line);
      this.outlineGroup.add(line);
    }

    this.lastBuild = {
      vertexCount: rings.reduce((s, r) => s + r.vertices.length, 0),
      drapeVertexCount,
      triangleCount,
      truncated: refined.truncated === true,
      preview: preview === true,
    };

    // 4) 顶点手柄
    if (editable) this.buildHandles(rings, input.selectedVertex, view);
    return this.lastBuild;
  }

  private makeOutline(ring: Vec2[], heightAt: (x: number, y: number) => number, color: THREE.Color, width: number): Line2 {
    const pts: number[] = [];
    const n = ring.length;
    for (let i = 0; i <= n; i++) {
      const p = ring[i % n];
      const w = this.scene.mapToWorld(p.x, p.y, 0, 0);
      // mapToWorld 已带入 xz，高度单独给
      pts.push(w.x, heightAt(p.x, p.y), w.z);
    }
    const geo = new LineGeometry();
    geo.setPositions(pts);
    const mat = new LineMaterial({
      color: color.getHex(),
      linewidth: width,
      worldUnits: false,
      transparent: true,
      opacity: 1,
      depthTest: true,
    });
    const size = this.scene.renderer.getSize(new THREE.Vector2());
    mat.resolution.set(size.x, size.y);
    const line = new Line2(geo, mat);
    line.computeLineDistances();
    line.renderOrder = 4;
    this.lineMaterials.push(mat);
    return line;
  }

  private buildHandles(
    rings: Ring[],
    selected: { ring: number; vertex: number } | null,
    view: ViewSettings,
  ): void {
    const dem = this.scene.data.dem;
    const exag = this.scene.exaggeration;
    const groundY = (x: number, y: number) =>
      view.mode === 'drape'
        ? this.scene.elevationAt(x, y) * exag + Math.max(2, this.scene.terrainCell * 1.35) * 2.2
        : (dem ? dem.maxElev : 0) * exag + view.lift + 3;
    const pts: number[] = [];
    let selPos: THREE.Vector3 | null = null;
    for (let r = 0; r < rings.length; r++) {
      for (let v = 0; v < rings[r].vertices.length; v++) {
        const p = rings[r].vertices[v];
        const w = this.scene.mapToWorld(p.x, p.y, 0, 0);
        const y = groundY(p.x, p.y);
        if (selected && selected.ring === r && selected.vertex === v) selPos = new THREE.Vector3(w.x, y, w.z);
        else pts.push(w.x, y, w.z);
      }
    }
    if (pts.length > 0) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3));
      const mat = new THREE.PointsMaterial({
        size: 5.5,
        sizeAttenuation: false,
        color: 0xf6f1e4,
        transparent: true,
        opacity: 0.92,
        depthTest: false,
        toneMapped: false,
      });
      const inst = new THREE.Points(geo, mat);
      inst.renderOrder = 6;
      inst.frustumCulled = false;
      this.handleMesh = inst;
      this.group.add(inst);
    }
    if (selPos) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([selPos.x, selPos.y, selPos.z]), 3));
      const mat = new THREE.PointsMaterial({
        size: 11,
        sizeAttenuation: false,
        color: 0xffcf6b,
        depthTest: false,
        toneMapped: false,
      });
      const inst = new THREE.Points(geo, mat);
      inst.renderOrder = 7;
      inst.frustumCulled = false;
      this.handleRingMesh = inst;
      this.group.add(inst);
    }
  }

  updateResolution(w: number, h: number): void {
    for (const m of this.lineMaterials) m.resolution.set(w, h);
  }

  /** 用于点击拾取：返回填充网格 */
  get pickTarget(): THREE.Object3D | null {
    return this.fillMesh;
  }

  /** 生成受损色带预览（在图例中使用） */
  static colorAt(value: number, thresholds: readonly number[]): string {
    return severityColorFromValue(value, thresholds);
  }

  /** 面积符号：用于调试 */
  static ringArea(ring: readonly Vec2[]): number {
    return Math.abs(signedArea(ring));
  }
}
