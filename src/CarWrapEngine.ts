import {
  ArcRotateCamera,
  Color3,
  CubeTexture,
  DirectionalLight,
  DynamicTexture,
  Engine,
  HemisphericLight,
  ImageProcessingConfiguration,
  Mesh,
  MeshBuilder,
  PBRMaterial,
  PointerEventTypes,
  Scene,
  SceneLoader,
  ShadowGenerator,
  StandardMaterial,
  Tools,
  Vector2,
  Vector3,
  VertexBuffer,
} from '@babylonjs/core';
import '@babylonjs/loaders';
import { WebGPUEngine } from '@babylonjs/core/Engines/webgpuEngine';
import type { PickingInfo } from '@babylonjs/core/Collisions/pickingInfo';
import { applyCylindricalUV, createDemoCar } from './demoCar';
import { getFilm } from './filmLibrary';
import type {
  FilmDef,
  SchemeData,
  StrokeDef,
  StrokePoint,
  ToolMode,
} from './types';

const TEX_SIZE = 2048;
const DEFAULT_FILM = 'M-02';
const SEAM_LIFT = 0.012;

function makeEnvFace(top: string, mid: string, bottom: string): string {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0, top);
  g.addColorStop(0.5, mid);
  g.addColorStop(1, bottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return c.toDataURL();
}

export class CarWrapEngine {
  readonly engine: Engine | WebGPUEngine;
  readonly scene: Scene;
  readonly camera: ArcRotateCamera;
  readonly isWebGPU: boolean;

  private canvas: HTMLCanvasElement;
  private body!: Mesh;
  private bodyMat!: PBRMaterial;
  private tex!: DynamicTexture;
  private maskCanvas: HTMLCanvasElement;
  private maskCtx: CanvasRenderingContext2D;
  private brushRing!: Mesh;
  private seamMat!: StandardMaterial;
  private shadowGen!: ShadowGenerator;
  private resizeHandler: () => void;

  // 车身拓扑
  private triCount = 0;
  private adjacency!: Int32Array;
  private centroidUV!: Float32Array;
  private regionOfTri!: Int32Array;

  // 交互/绘制状态
  mode: ToolMode = 'view';
  brushRadius = 0.05;
  seamWidth = 0.02;
  private strokes: StrokeDef[] = [];
  private regionColors = new Map<number, string>();
  private activeStroke: StrokePoint[] | null = null;
  private seamMeshes: Mesh[] = [];
  private modelName: string | null = null;

  private constructor(engine: Engine | WebGPUEngine, canvas: HTMLCanvasElement, isWebGPU: boolean) {
    this.engine = engine;
    this.canvas = canvas;
    this.isWebGPU = isWebGPU;
    const scene = new Scene(engine);
    this.scene = scene;

    // ---- 环境（程序化立方体贴图，无外部资源） ----
    const faces = [
      makeEnvFace('#cfe0f2', '#8fa5bd', '#3a4250'),
      makeEnvFace('#dfe9f5', '#9fb3c8', '#414a58'),
      makeEnvFace('#f2f5fa', '#c7d3e0', '#6a7686'),
      makeEnvFace('#2b3038', '#23272e', '#16181d'),
      makeEnvFace('#e8f0fa', '#a9bdd4', '#525d6c'),
      makeEnvFace('#d7e3f2', '#93a8c0', '#3e4756'),
    ];
    const env = new CubeTexture('', scene, null, false, faces);
    scene.environmentTexture = env;
    scene.imageProcessingConfiguration.toneMappingEnabled = true;
    scene.imageProcessingConfiguration.toneMappingType =
      ImageProcessingConfiguration.TONEMAPPING_ACES;
    scene.imageProcessingConfiguration.exposure = 1.05;

    // ---- 相机：旋转/缩放 ----
    const camera = new ArcRotateCamera('cam', -Math.PI / 2, Math.PI / 2.35, 6.2, Vector3.Zero(), scene);
    camera.attachControl(canvas, true);
    camera.wheelDeltaPercentage = 0.01;
    camera.lowerRadiusLimit = 1.4;
    camera.upperRadiusLimit = 16;
    camera.upperBetaLimit = Math.PI * 0.55;
    camera.minZ = 0.05;
    camera.panningSensibility = 0;
    this.camera = camera;

    // ---- 灯光 ----
    const hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), scene);
    hemi.intensity = 0.55;
    const dir = new DirectionalLight('dir', new Vector3(-0.45, -0.9, 0.35), scene);
    dir.position = new Vector3(6, 9, -5);
    dir.intensity = 1.4;
    this.shadowGen = new ShadowGenerator(1024, dir);
    this.shadowGen.useBlurExponentialShadowMap = true;
    this.shadowGen.blurKernel = 16;

    const ground = MeshBuilder.CreateGround('ground', { width: 40, height: 40 }, scene);
    const groundMat = new StandardMaterial('groundMat', scene);
    groundMat.diffuseColor = new Color3(0.16, 0.17, 0.19);
    ground.material = groundMat;
    ground.receiveShadows = true;

    // ---- 贴膜材质 + 车身纹理 ----
    this.bodyMat = new PBRMaterial('wrapMat', scene);
    this.bodyMat.roughness = 0.85;
    this.bodyMat.metallic = 0.05;
    this.bodyMat.environmentIntensity = 0.7;
    this.tex = new DynamicTexture('wrapTex', { width: TEX_SIZE, height: TEX_SIZE }, scene, false);
    this.bodyMat.albedoTexture = this.tex;

    this.maskCanvas = document.createElement('canvas');
    this.maskCanvas.width = this.maskCanvas.height = TEX_SIZE;
    this.maskCtx = this.maskCanvas.getContext('2d', { willReadFrequently: true })!;
    this.fillDisplayBase();

    this.seamMat = new StandardMaterial('seamMat', scene);
    this.seamMat.diffuseColor = new Color3(0.008, 0.008, 0.01);
    this.seamMat.emissiveColor = new Color3(0.03, 0.03, 0.035);

    // ---- 笔刷环 ----
    this.brushRing = MeshBuilder.CreateTorus(
      'brushRing',
      { diameter: this.brushRadius * 2, thickness: this.brushRadius * 0.12, tessellation: 48 },
      scene,
    );
    const ringMat = new StandardMaterial('ringMat', scene);
    ringMat.emissiveColor = new Color3(1, 1, 1);
    ringMat.alpha = 0.9;
    this.brushRing.material = ringMat;
    this.brushRing.isPickable = false;
    this.brushRing.setEnabled(false);

    // ---- 演示车身 ----
    const demo = createDemoCar(scene, this.bodyMat);
    this.body = demo.body;
    this.shadowGen.addShadowCaster(this.body);
    this.buildTopology();
    // 初始无笔画：整车作为一个连通分区，使填色工具可直接作用
    this.recomputeRegions();

    this.bindPointer();
    this.resizeHandler = () => engine.resize();
    window.addEventListener('resize', this.resizeHandler);
    engine.runRenderLoop(() => scene.render());
  }

  static async Create(canvas: HTMLCanvasElement): Promise<CarWrapEngine> {
    let engine: Engine | WebGPUEngine;
    let isWebGPU = false;

    // 显式验证 WebGPU 适配器：部分环境存在 navigator.gpu 但 requestAdapter 返回 null/undefined
    let webgpuUsable = false;
    try {
      if (typeof navigator !== 'undefined' && navigator.gpu) {
        const adapter = await Promise.race<GPUAdapter | null | undefined>([
          navigator.gpu.requestAdapter(),
          new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 3000)),
        ]);
        webgpuUsable = !!adapter;
      }
    } catch {
      webgpuUsable = false;
    }

    if (webgpuUsable) {
      try {
        const gpu = new WebGPUEngine(canvas, { antialias: true, stencil: true });
        await Promise.race([
          gpu.initAsync(),
          new Promise((_, reject) =>
            window.setTimeout(() => reject(new Error('WebGPU init timeout')), 8000),
          ),
        ]);
        engine = gpu;
        isWebGPU = true;
      } catch (e) {
        console.warn('[CarWrap] WebGPU 不可用，回退 WebGL:', (e as Error).message);
        engine = new Engine(canvas, true, { stencil: true }, true);
      }
    } else {
      engine = new Engine(canvas, true, { stencil: true }, true);
    }
    return new CarWrapEngine(engine, canvas, isWebGPU);
  }

  // ============================================================
  // 拓扑与分区
  // ============================================================

  private buildTopology(): void {
    const mesh = this.body;
    const indices = mesh.getIndices()!;
    const positions = mesh.getVerticesData(VertexBuffer.PositionKind)!;
    const uvs = mesh.getVerticesData(VertexBuffer.UVKind);
    this.triCount = indices.length / 3;

    // 三角面邻接表：用规范化字符串键，避免大索引下数值哈希碰撞导致拓扑断裂
    const edgeMap = new Map<string, number[]>();
    const edgeKey = (a: number, b: number) => (a < b ? `${a}_${b}` : `${b}_${a}`);
    for (let t = 0; t < this.triCount; t++) {
      const base = t * 3;
      const verts = [indices[base], indices[base + 1], indices[base + 2]];
      const edges: [number, number][] = [
        [verts[0], verts[1]],
        [verts[1], verts[2]],
        [verts[2], verts[0]],
      ];
      edges.forEach(([a, b], e) => {
        const k = edgeKey(a, b);
        const list = edgeMap.get(k);
        if (list) list.push(t * 3 + e);
        else edgeMap.set(k, [t * 3 + e]);
      });
    }
    this.adjacency = new Int32Array(this.triCount * 3).fill(-1);
    edgeMap.forEach((entries) => {
      if (entries.length < 2) return;
      const [slotA, slotB] = entries;
      this.adjacency[slotA] = (slotB / 3) | 0;
      this.adjacency[slotB] = (slotA / 3) | 0;
    });

    // 每三角面的 UV 质心
    this.centroidUV = new Float32Array(this.triCount * 2);
    for (let t = 0; t < this.triCount; t++) {
      const base = t * 3;
      let cu = 0;
      let cv = 0;
      for (let k = 0; k < 3; k++) {
        const vi = indices[base + k];
        if (uvs) {
          cu += uvs[vi * 2];
          cv += uvs[vi * 2 + 1];
        } else {
          cu += positions[vi * 3] / 3;
          cv += positions[vi * 3 + 1] / 3;
        }
      }
      this.centroidUV[t * 2] = cu / 3;
      this.centroidUV[t * 2 + 1] = cv / 3;
    }
    this.regionOfTri = new Int32Array(this.triCount).fill(-1);
  }

  /** 以笔画蒙版为屏障，对三角面做 BFS 重新分区 */
  private recomputeRegions(): Map<number, number> {
    const data = this.maskCtx.getImageData(0, 0, TEX_SIZE, TEX_SIZE).data;
    const blocked = (tri: number): boolean => {
      const cu = this.centroidUV[tri * 2];
      const cv = this.centroidUV[tri * 2 + 1];
      const px = Math.min(TEX_SIZE - 1, Math.max(0, (cu * TEX_SIZE) | 0));
      const py = Math.min(TEX_SIZE - 1, Math.max(0, ((1 - cv) * TEX_SIZE) | 0));
      const idx = (py * TEX_SIZE + px) * 4;
      return data[idx] !== 0 || data[idx + 1] !== 0;
    };

    const prev = this.regionOfTri;
    const next = new Int32Array(this.triCount).fill(-1);
    const newToOld = new Map<number, number>();
    const queue = new Int32Array(this.triCount);
    let region = 0;

    for (let start = 0; start < this.triCount; start++) {
      if (next[start] !== -1 || blocked(start)) continue;
      let head = 0;
      let tail = 0;
      queue[tail++] = start;
      next[start] = region;
      let oldId = -1;
      while (head < tail) {
        const t = queue[head++];
        if (oldId === -1 && prev[t] !== -1) oldId = prev[t];
        const ab = t * 3;
        for (let e = 0; e < 3; e++) {
          const n = this.adjacency[ab + e];
          if (n === -1 || next[n] !== -1 || blocked(n)) continue;
          next[n] = region;
          queue[tail++] = n;
        }
      }
      newToOld.set(region, oldId);
      region++;
    }
    this.regionOfTri = next;

    // 继承旧分区的膜色
    const inherited = new Map<number, string>();
    this.regionColors.forEach((filmId, oldRegion) => {
      newToOld.forEach((old, newId) => {
        if (old === oldRegion) inherited.set(newId, filmId);
      });
    });
    this.regionColors = inherited;
    return newToOld;
  }

  // ============================================================
  // 纹理绘制
  // ============================================================

  private fillDisplayBase(): void {
    const ctx = this.tex.getContext() as unknown as CanvasRenderingContext2D;
    const [r, g, b] = getFilm(DEFAULT_FILM).color;
    ctx.fillStyle = `rgb(${(r * 255) | 0},${(g * 255) | 0},${(b * 255) | 0})`;
    ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
    this.tex.update();
  }

  private uvToCanvas(u: number, v: number): [number, number] {
    return [u * TEX_SIZE, (1 - v) * TEX_SIZE];
  }

  private drawCanvasSegment(
    ctx: CanvasRenderingContext2D,
    a: StrokePoint,
    b: StrokePoint,
    style: string,
  ): void {
    const scale = (a.faceScale + b.faceScale) * 0.5;
    const wPx = Math.max(1, (this.brushRadius * 2 / Math.max(1e-6, scale)) * TEX_SIZE);
    const [ax, ay] = this.uvToCanvas(a.u, a.v);
    const [bx, by] = this.uvToCanvas(b.u, b.v);
    ctx.strokeStyle = style;
    ctx.lineWidth = wPx;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
  }

  private drawCanvasDot(ctx: CanvasRenderingContext2D, a: StrokePoint, style: string): void {
    const wPx = Math.max(1, (this.brushRadius * 2 / Math.max(1e-6, a.faceScale)) * TEX_SIZE);
    const [ax, ay] = this.uvToCanvas(a.u, a.v);
    ctx.fillStyle = style;
    ctx.beginPath();
    ctx.arc(ax, ay, wPx / 2, 0, Math.PI * 2);
    ctx.fill();
  }

  private maskStyle(strokeIndex: number): string {
    const id = strokeIndex + 1;
    return `rgb(${id & 255},${(id >> 8) & 255},0)`;
  }

  private redrawMask(): void {
    this.maskCtx.clearRect(0, 0, TEX_SIZE, TEX_SIZE);
    this.strokes.forEach((stroke, i) => {
      const style = this.maskStyle(i);
      const pts = stroke.points;
      if (stroke.solidBand) {
        this.drawSolidBand(this.maskCtx, stroke, style);
        return;
      }
      if (pts.length === 1) this.drawCanvasDot(this.maskCtx, pts[0], style);
      for (let k = 1; k < pts.length; k++) {
        this.drawCanvasSegment(this.maskCtx, pts[k - 1], pts[k], style);
      }
    });
  }

  /** 实心带：把闭合环绕笔画栅格化为覆盖整条 v 截面的无缝矩形带 */
  private drawSolidBand(ctx: CanvasRenderingContext2D, stroke: StrokeDef, style: string): void {
    const wPx = Math.max(2, (stroke.radius * 2 / Math.max(1e-6, stroke.points[0].faceScale)) * TEX_SIZE);
    ctx.fillStyle = style;
    // 每个采样点画一个略宽于间距的矩形，相邻矩形重叠确保无间隙
    for (const sp of stroke.points) {
      const [x, y] = this.uvToCanvas(sp.u, sp.v);
      ctx.fillRect(x - wPx, y - wPx, wPx * 2, wPx * 2);
    }
  }

  /** 重绘车身贴膜：先按分区洪填充色，再把边界线叠在最上层 */
  private redrawDisplay(): void {
    const ctx = this.tex.getContext() as unknown as CanvasRenderingContext2D;
    const [dr, dg, db] = getFilm(DEFAULT_FILM).color;
    const baseRgb = `${(dr * 255) | 0},${(dg * 255) | 0},${(db * 255) | 0}`;
    ctx.fillStyle = `rgb(${baseRgb})`;
    ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);

    // 每个有色分区取一个种子三角面，在画布上洪填（笔画像素天然构成屏障）
    const seeds = new Map<number, number>();
    for (let t = 0; t < this.triCount; t++) {
      const r = this.regionOfTri[t];
      if (r === -1) continue;
      if (!seeds.has(r) && this.regionColors.has(r)) seeds.set(r, t);
    }
    const total = TEX_SIZE * TEX_SIZE;
    seeds.forEach((tri, region) => {
      const film = getFilm(this.regionColors.get(region)!);
      const [fr, fg, fb] = film.color;
      const rep = `rgb(${(fr * 255) | 0},${(fg * 255) | 0},${(fb * 255) | 0})`;
      const cu = this.centroidUV[tri * 2];
      const cv = this.centroidUV[tri * 2 + 1];
      const sx = Math.min(TEX_SIZE - 1, Math.max(0, (cu * TEX_SIZE) | 0));
      const sy = Math.min(TEX_SIZE - 1, Math.max(0, ((1 - cv) * TEX_SIZE) | 0));
      this.floodFill(ctx, sx, sy, `rgb(${baseRgb})`, rep, total);
    });

    // 边界线（深色，贴在膜色之上）
    this.strokes.forEach((stroke) => {
      const pts = stroke.points;
      if (pts.length === 1) this.drawCanvasDot(ctx, pts[0], 'rgb(18,18,20)');
      for (let k = 1; k < pts.length; k++) {
        this.drawCanvasSegment(ctx, pts[k - 1], pts[k], 'rgb(18,18,20)');
      }
    });
    this.tex.update();
  }

  private floodFill(
    ctx: CanvasRenderingContext2D,
    sx: number,
    sy: number,
    target: string,
    replacement: string,
    total: number,
  ): void {
    if (target === replacement) return;
    const img = ctx.getImageData(0, 0, TEX_SIZE, TEX_SIZE);
    const d = img.data;
    const match = (i: number): boolean =>
      d[i] === this.rgbCache(target, 0) &&
      d[i + 1] === this.rgbCache(target, 1) &&
      d[i + 2] === this.rgbCache(target, 2);
    const [rr, gg, bb] = [
      this.rgbCache(replacement, 0),
      this.rgbCache(replacement, 1),
      this.rgbCache(replacement, 2),
    ];
    const stack = new Int32Array(total);
    let sp = 0;
    stack[sp++] = sy * TEX_SIZE + sx;
    while (sp > 0) {
      const pi = stack[--sp];
      const i = pi * 4;
      if (!match(i)) continue;
      d[i] = rr;
      d[i + 1] = gg;
      d[i + 2] = bb;
      if (pi >= TEX_SIZE) stack[sp++] = pi - TEX_SIZE;
      if (pi < total - TEX_SIZE) stack[sp++] = pi + TEX_SIZE;
      if (pi % TEX_SIZE !== 0) stack[sp++] = pi - 1;
      if (pi % TEX_SIZE !== TEX_SIZE - 1) stack[sp++] = pi + 1;
    }
    ctx.putImageData(img, 0, 0);
  }

  private rgbCacheValue: { s: string; v: number[] } | null = null;
  private rgbCache(s: string, channel: number): number {
    if (!this.rgbCacheValue || this.rgbCacheValue.s !== s) {
      const m = /rgb\((\d+),(\d+),(\d+)\)/.exec(s);
      this.rgbCacheValue = { s, v: m ? [+m[1], +m[2], +m[3]] : [0, 0, 0] };
    }
    return this.rgbCacheValue.v[channel];
  }

  // ============================================================
  // 拾取与笔刷
  // ============================================================

  private pickBody(): PickingInfo | null {
    const pi = this.scene.pick(this.scene.pointerX, this.scene.pointerY, (m) => m === this.body);
    return pi?.hit ? pi : null;
  }

  private toStrokePoint(pick: PickingInfo): StrokePoint {
    const mesh = pick.pickedMesh as Mesh;
    const wm = mesh.getWorldMatrix();
    const faceId = pick.faceId ?? 0;
    const indices = mesh.getIndices()!;
    const positions = mesh.getVerticesData(VertexBuffer.PositionKind)!;
    const uvs = mesh.getVerticesData(VertexBuffer.UVKind)!;
    const ids = [indices[faceId * 3], indices[faceId * 3 + 1], indices[faceId * 3 + 2]];

    let uvPerim = 0;
    let wPerim = 0;
    const uvPts: Vector2[] = [];
    const wPts: Vector3[] = [];
    for (const vi of ids) {
      uvPts.push(new Vector2(uvs[vi * 2], uvs[vi * 2 + 1]));
      const p = positions.slice(vi * 3, vi * 3 + 3);
      wPts.push(Vector3.TransformCoordinates(new Vector3(p[0], p[1], p[2]), wm));
    }
    for (let k = 0; k < 3; k++) {
      const k2 = (k + 1) % 3;
      uvPerim += Vector2.Distance(uvPts[k], uvPts[k2]);
      wPerim += Vector3.Distance(wPts[k], wPts[k2]);
    }

    const tc = pick.getTextureCoordinates()!;
    const normal = pick.getNormal(true) ?? new Vector3(0, 1, 0);
    const point = pick.pickedPoint ?? Vector3.Zero();
    return {
      p: [point.x, point.y, point.z],
      n: [normal.x, normal.y, normal.z],
      u: tc.x,
      v: tc.y,
      faceScale: wPerim / Math.max(1e-6, uvPerim),
    };
  }

  private updateBrushRing(pick: PickingInfo | null): void {
    if (this.mode !== 'paint' || !pick || !pick.pickedPoint || !pick.getNormal(true)) {
      this.brushRing.setEnabled(false);
      return;
    }
    this.brushRing.setEnabled(true);
    const n = pick.getNormal(true)!;
    this.brushRing.position.copyFrom(pick.pickedPoint);
    this.brushRing.lookAt(pick.pickedPoint.add(n));
    this.brushRing.scaling.setAll(this.brushRadius / 0.05);
  }

  private bindPointer(): void {
    this.scene.onPointerObservable.add((info) => {
      switch (info.type) {
        case PointerEventTypes.POINTERMOVE: {
          if (this.activeStroke) {
            const pick = this.pickBody();
            if (pick) this.extendStroke(pick);
          } else {
            this.updateBrushRing(this.pickBody());
          }
          break;
        }
        case PointerEventTypes.POINTERDOWN: {
          if (info.event.button !== 0) break;
          const pick = this.pickBody();
          if (!pick) break;
          if (this.mode === 'paint') {
            this.camera.detachControl();
            this.activeStroke = [this.toStrokePoint(pick)];
            this.strokePaintTo(this.activeStroke[0], this.activeStroke[0]);
          } else if (this.mode === 'fill') {
            this.fillAtPick(pick);
          }
          break;
        }
        case PointerEventTypes.POINTERUP: {
          if (this.activeStroke) {
            const pts = this.activeStroke;
            this.activeStroke = null;
            if (pts.length > 0) {
              this.strokes.push({ id: `s${this.strokes.length}_${pts.length}`, radius: this.brushRadius, points: pts });
              this.afterStrokeChanged();
            }
            if (this.mode === 'paint') this.camera.attachControl(this.canvas, true);
          }
          break;
        }
      }
    });
  }

  private strokePaintTo(a: StrokePoint, b: StrokePoint): void {
    const displayCtx = this.tex.getContext() as unknown as CanvasRenderingContext2D;
    const maskIndex = this.strokes.length; // 提交前的下一笔序号
    if (a === b) {
      this.drawCanvasDot(this.maskCtx, a, this.maskStyle(maskIndex));
      this.drawCanvasDot(displayCtx, a, 'rgb(18,18,20)');
    } else {
      this.drawCanvasSegment(this.maskCtx, a, b, this.maskStyle(maskIndex));
      this.drawCanvasSegment(displayCtx, a, b, 'rgb(18,18,20)');
    }
    this.tex.update();
  }

  private extendStroke(pick: PickingInfo): void {
    const sp = this.toStrokePoint(pick);
    const last = this.activeStroke![this.activeStroke!.length - 1];
    const dx = sp.p[0] - last.p[0];
    const dy = sp.p[1] - last.p[1];
    const dz = sp.p[2] - last.p[2];
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist < this.brushRadius * 0.4) return;
    this.activeStroke!.push(sp);
    this.strokePaintTo(last, sp);
    this.updateBrushRing(pick);
  }

  private fillAtPick(pick: PickingInfo): void {
    const faceId = pick.faceId ?? 0;
    const region = this.regionOfTri[faceId];
    if (region === -1 || !this.selectedFilm) return;
    this.regionColors.set(region, this.selectedFilm);
    this.redrawDisplay();
  }

  private selectedFilm: string | null = null;

  private afterStrokeChanged(): void {
    // 顺序关键：先把最新笔画栅格化进蒙版，再以蒙版为屏障重算分区，最后刷新外观与接缝
    this.redrawMask();
    this.recomputeRegions();
    this.redrawDisplay();
    this.rebuildSeams();
  }

  // ============================================================
  // 接缝管（沿曲面采样点、固定世界半径，跨越板件缝连续）
  // ============================================================

  private rebuildSeams(): void {
    this.seamMeshes.forEach((m) => m.dispose());
    this.seamMeshes = [];
    this.strokes.forEach((stroke) => {
      const pts = stroke.points;
      if (pts.length < 2) return;
      const path = pts.map((sp) => {
        const v = Vector3.FromArray(sp.p);
        const n = Vector3.FromArray(sp.n);
        return v.add(n.scale(SEAM_LIFT));
      });
      const tube = MeshBuilder.CreateTube(
        'seam',
        {
          path,
          radius: this.seamWidth / 2,
          tessellation: 10,
          cap: Mesh.CAP_ALL,
          updatable: false,
        },
        this.scene,
      );
      tube.material = this.seamMat;
      tube.isPickable = false;
      tube.convertToFlatShadedMesh();
      this.seamMeshes.push(tube);
    });
  }

  // ============================================================
  // 对外 API
  // ============================================================

  setMode(mode: ToolMode): void {
    this.mode = mode;
    if (mode !== 'paint') {
      this.brushRing.setEnabled(false);
      this.camera.attachControl(this.canvas, true);
    } else {
      this.camera.attachControl(this.canvas, true);
    }
  }

  setBrushRadius(r: number): void {
    this.brushRadius = r;
  }

  setSeamWidth(w: number): void {
    this.seamWidth = w;
    this.rebuildSeams();
  }

  setMaterialParams(roughness: number, metallic: number): void {
    this.bodyMat.roughness = roughness;
    this.bodyMat.metallic = metallic;
  }

  setSelectedFilm(filmId: string): void {
    this.selectedFilm = filmId;
  }

  undoStroke(): void {
    if (!this.strokes.length) return;
    this.strokes.pop();
    this.afterStrokeChanged();
  }

  clearAll(): void {
    this.strokes = [];
    this.regionColors.clear();
    this.maskCtx.clearRect(0, 0, TEX_SIZE, TEX_SIZE);
    this.recomputeRegions();
    this.redrawDisplay();
    this.rebuildSeams();
  }

  get strokeCount(): number {
    return this.strokes.length;
  }

  /**
   * 程序化沿曲面绘制一条分色边界（屏幕相对坐标序列）。
   * 逐点拾取车身，命中点沿曲面采样连成笔画；返回实际采样点数。
   * 供外部脚本/自动化测试复用，与鼠标绘制走完全相同的采样与提交路径。
   */
  drawStrokeAlongSurface(relativePoints: Array<{ x: number; y: number }>): number {
    const collected: StrokePoint[] = [];
    for (const { x, y } of relativePoints) {
      const pi = this.scene.pick(x, y, (m) => m === this.body);
      if (!pi?.hit) continue;
      const sp = this.toStrokePoint(pi);
      const last = collected[collected.length - 1];
      if (last) {
        const dx = sp.p[0] - last.p[0];
        const dy = sp.p[1] - last.p[1];
        const dz = sp.p[2] - last.p[2];
        if (Math.sqrt(dx * dx + dy * dy + dz * dz) < this.brushRadius * 0.4) continue;
      }
      collected.push(sp);
    }
    if (collected.length === 0) return 0;
    this.strokes.push({
      id: `s${this.strokes.length}_${collected.length}`,
      radius: this.brushRadius,
      points: collected,
    });
    this.afterStrokeChanged();
    return collected.length;
  }

  /** 程序化填色：对屏幕相对坐标命中的分区填充指定膜色，返回是否成功 */
  fillRegionAt(relativeX: number, relativeY: number, filmId: string): boolean {
    const pi = this.scene.pick(relativeX, relativeY, (m) => m === this.body);
    if (!pi?.hit) return false;
    const region = this.regionOfTri[pi.faceId ?? 0];
    if (region === -1) return false;
    this.regionColors.set(region, filmId);
    this.redrawDisplay();
    return true;
  }

  /** 当前分区总数 */
  get regionCount(): number {
    let max = -1;
    for (const r of this.regionOfTri) if (r > max) max = r;
    return max + 1;
  }

  /**
   * 构造一条沿车长方向某一截面、完整环绕车身一周的闭合分色边界。
   * 通过扫描所有三角面、收集 v 最接近目标值的面片上的真实 UV 点实现，
   * 保证在柱面 UV 的 u∈[0,1] 方向闭合，从而确定性地把一个壳体切成两段。
   * 返回生成的采样点数。
   */
  addFullWrapStroke(targetV: number): number {
    const indices = this.body.getIndices()!;
    const uvs = this.body.getVerticesData(VertexBuffer.UVKind)!;
    const positions = this.body.getVerticesData(VertexBuffer.PositionKind)!;
    const wm = this.body.getWorldMatrix();
    // 每个 u 桶取一个最接近 targetV 的顶点，形成绕整圈的连续序列
    const BUCKETS = 128;
    const chosen = new Map<number, { u: number; v: number; vi: number; dist: number }>();
    const vcount = positions.length / 3;
    for (let vi = 0; vi < vcount; vi++) {
      const u = uvs[vi * 2];
      const v = uvs[vi * 2 + 1];
      const dist = Math.abs(v - targetV);
      const bucket = Math.min(BUCKETS - 1, Math.max(0, Math.floor(u * BUCKETS)));
      const cur = chosen.get(bucket);
      if (!cur || dist < cur.dist) chosen.set(bucket, { u, v, vi, dist });
    }
    // 用插值补齐空 u 桶，保证环绕方向上采样连续无缺口
    type Hit = { u: number; v: number; vi: number; dist: number };
    const present: (Hit | undefined)[] = new Array(BUCKETS);
    for (let b = 0; b < BUCKETS; b++) {
      const hit = chosen.get(b);
      if (hit) { present[b] = hit; continue; }
      // 找前后最近的有效桶做插值
      let lo = b - 1;
      while (lo >= 0 && !chosen.has(lo)) lo--;
      let hi = b + 1;
      while (hi < BUCKETS && !chosen.has(hi)) hi++;
      const a = lo >= 0 ? chosen.get(lo) : undefined;
      const c = hi < BUCKETS ? chosen.get(hi) : undefined;
      if (a && c) {
        const t = (b - lo) / (hi - lo);
        present[b] = { u: (b + 0.5) / BUCKETS, v: a.v + (c.v - a.v) * t, vi: a.vi, dist: 0 };
      } else if (a || c) {
        present[b] = (a ?? c)!;
      }
    }
    const points: StrokePoint[] = [];
    // 估计典型世界/UV 尺度：用中位数避免跨 atan2 接缝的退化三角面拉偏
    const scales: number[] = [];
    for (let t = 0; t < this.triCount; t++) {
      const base = t * 3;
      const ids = [indices[base], indices[base + 1], indices[base + 2]];
      let uvPerim = 0;
      let wPerim = 0;
      const uvPts: Vector2[] = [];
      const wPts: Vector3[] = [];
      for (const vi of ids) {
        uvPts.push(new Vector2(uvs[vi * 2], uvs[vi * 2 + 1]));
        wPts.push(Vector3.TransformCoordinates(Vector3.FromArray(positions, vi * 3), wm));
      }
      for (let k = 0; k < 3; k++) {
        const k2 = (k + 1) % 3;
        uvPerim += Vector2.Distance(uvPts[k], uvPts[k2]);
        wPerim += Vector3.Distance(wPts[k], wPts[k2]);
      }
      // 跳过 UV 周长异常小的退化面（atan2 切割处）
      if (uvPerim > 0.05) scales.push(wPerim / uvPerim);
    }
    scales.sort((a, b) => a - b);
    const faceScale = scales.length ? scales[scales.length >> 1] : 0.02;
    for (let b = 0; b < BUCKETS; b++) {
      const hit = present[b];
      if (!hit) continue;
      const p = Vector3.TransformCoordinates(
        Vector3.FromArray(positions, hit.vi * 3),
        wm,
      );
      points.push({
        p: [p.x, p.y, p.z],
        n: [0, 1, 0],
        u: hit.u,
        v: targetV, // 统一 v，保证环带在 UV 上无缝闭合
        faceScale,
      });
    }
    if (points.length < 4) return 0;
    this.strokes.push({
      id: `s${this.strokes.length}_wrap${points.length}`,
      radius: this.brushRadius,
      points,
      solidBand: true,
    });
    this.afterStrokeChanged();
    return points.length;
  }

  /** 已填充膜色的分区数 */
  get filledRegionCount(): number {
    return this.regionColors.size;
  }

  getSchemeData(): SchemeData {
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      modelUri: this.modelName,
      brushRadius: this.brushRadius,
      seamWidth: this.seamWidth,
      materialParams: {
        roughness: this.bodyMat.roughness ?? 0,
        metallic: this.bodyMat.metallic ?? 0,
      },
      strokes: JSON.parse(JSON.stringify(this.strokes)) as StrokeDef[],
      regionColors: Object.fromEntries(
        [...this.regionColors.entries()].map(([r, f]) => [r, f]),
      ),
    };
  }

  restore(data: SchemeData): void {
    this.brushRadius = data.brushRadius;
    this.seamWidth = data.seamWidth;
    this.setMaterialParams(data.materialParams.roughness, data.materialParams.metallic);
    this.strokes = JSON.parse(JSON.stringify(data.strokes)) as StrokeDef[];
    this.regionColors = new Map(
      Object.entries(data.regionColors).map(([k, v]) => [Number(k), v]),
    );
    this.redrawMask();
    this.recomputeRegions();
    this.redrawDisplay();
    this.rebuildSeams();
  }

  async loadModel(file: File): Promise<void> {
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    if (!['glb', 'gltf', 'obj', 'stl'].includes(ext)) {
      throw new Error('支持的模型格式：.glb / .gltf / .obj / .stl');
    }
    const url = URL.createObjectURL(file);
    try {
      const result = await SceneLoader.ImportMeshAsync('', url, `.${ext}`, this.scene, null, `.${ext}`);
      const meshes = result.meshes.filter((m): m is Mesh => m instanceof Mesh && m.getTotalIndices() > 0);
      if (!meshes.length) throw new Error('模型中没有可绘制的网格');

      let merged: Mesh;
      if (meshes.length === 1) merged = meshes[0];
      else {
        const m = Mesh.MergeMeshes(meshes, true, true, undefined, false, false);
        if (!m) throw new Error('网格合并失败');
        merged = m;
      }
      merged.name = 'carBody';
      if (!merged.getVerticesData(VertexBuffer.UVKind)) applyCylindricalUV(merged);
      merged.material = this.bodyMat;
      merged.forceSharedVertices();

      // 归一化尺寸：最长边 3.8，底部贴地
      merged.refreshBoundingInfo();
      const bb = merged.getBoundingInfo().boundingBox;
      const dims = bb.maximumWorld.subtract(bb.minimumWorld);
      const maxDim = Math.max(dims.x, dims.y, dims.z);
      const s = 3.8 / Math.max(1e-6, maxDim);
      merged.scaling.setAll(s);
      merged.position.setAll(0);
      merged.refreshBoundingInfo();
      const bb2 = merged.getBoundingInfo().boundingBox;
      merged.position.y = -bb2.minimumWorld.y;
      merged.refreshBoundingInfo();

      // 替换旧车身
      this.shadowGen.removeShadowCaster(this.body);
      this.body.dispose();
      this.body = merged;
      this.shadowGen.addShadowCaster(this.body);
      this.modelName = file.name;

      this.strokes = [];
      this.regionColors.clear();
      this.maskCtx.clearRect(0, 0, TEX_SIZE, TEX_SIZE);
      this.buildTopology();
      this.recomputeRegions();
      this.redrawDisplay();
      this.rebuildSeams();
      this.camera.radius = 6.2;
      this.camera.target.setAll(0);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async captureThumbnail(width = 480, height = 300): Promise<string> {
    const data = await Tools.CreateScreenshotAsync(
      this.engine,
      this.camera,
      { width, height },
      'image/png',
    );
    return data as string;
  }

  dispose(): void {
    window.removeEventListener('resize', this.resizeHandler);
    this.scene.dispose();
    this.engine.dispose();
  }
}

export function filmToRgb(film: FilmDef): string {
  const [r, g, b] = film.color;
  return `rgb(${(r * 255) | 0},${(g * 255) | 0},${(b * 255) | 0})`;
}
