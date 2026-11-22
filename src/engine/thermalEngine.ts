/**
 * 机柜热力分析渲染引擎
 *
 * 管线：
 *   1. field  compute —— 由机柜前后面的 36 个采样点铺出三维温度标量场
 *   2. mc     compute —— 在标量场上做移动立方体，输出三角形顶点流
 *   3. iso    顶点拉取渲染 —— 背面一趟 + 正面一趟，半透明叠加
 *   4. heatmap —— 进风/出风面温度色带（分段 LUT），不透明，写入深度
 *   5. rack    —— 机柜本体，不透明，写入深度
 *
 * 深度一致性：机柜本体与风面都在不透明通道写入深度，等值面在其后的
 * 透明通道做深度测试，因此包裹体被机柜正确遮挡、且能被机柜表面切开。
 *
 * 性能约定：
 *   - 阈值变化只重跑 mc，field 不重跑；所有 GPU 缓冲区首次创建后复用，
 *     拖动阈值不会触发任何缓冲区重新分配。
 *   - 等值面顶点上限 300,000；顶点绘制数量按 GPU 回读的实际数量动态收缩。
 */

import { WebGPUEngine } from "@babylonjs/core/Engines/webgpuEngine";
import "@babylonjs/core/Engines/WebGPU/Extensions/engine.computeShader";
import { Scene } from "@babylonjs/core/scene";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { ComputeShader } from "@babylonjs/core/Compute/computeShader";
import { StorageBuffer } from "@babylonjs/core/Buffers/storageBuffer";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { ShaderLanguage } from "@babylonjs/core/Materials/shaderLanguage";
import { ShaderStore } from "@babylonjs/core/Engines/shaderStore";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { Constants } from "@babylonjs/core/Engines/constants";
import type { Texture } from "@babylonjs/core/Materials/Textures/texture";

import {
  FIELD_COMPUTE,
  MC_COMPUTE,
  WRAPPER_VERTEX,
  WRAPPER_FRAGMENT,
  HEATMAP_VERTEX,
  HEATMAP_FRAGMENT,
  RACK_VERTEX,
  RACK_FRAGMENT,
  FLOOR_VERTEX,
  FLOOR_FRAGMENT,
  GRID_IDX,
  FIELD_IDX,
  MC_IDX,
  VERTEX_FLOATS,
} from "../shaders";
import { FACE_COLS, FACE_ROWS, TEMP_MAX, TEMP_MIN, type RackBox, type RoomLayout } from "../model/types";
import {
  buildAccelGrid,
  computeFaceFrames,
  packRackInfos,
  planFieldGrid,
  FALLOFF,
  type FieldGrid,
  type FaceFrame,
} from "./fieldGrid";
import { MC_TRICOUNT, MC_TRITABLE } from "./mcTables";
import { createLutTexture, getPalette, type PaletteId } from "./palette";

export const MAX_ISO_VERTS = 300_000;
const RW = Constants.BUFFER_CREATIONFLAG_READWRITE;

export interface RenderStats {
  fps: number;
  frameMs: number;
  isoVerts: number;
  isoReady: boolean;
  lastIsoMs: number;
  voxels: number;
  racks: number;
}

export interface EngineCallbacks {
  onStats?: (stats: RenderStats) => void;
  onSelect?: (rackIndex: number | null) => void;
  onReady?: () => void;
  onError?: (message: string) => void;
}

const WGSL_STORE = ShaderStore.ShadersStoreWGSL;

function registerShader(name: string, code: string): void {
  WGSL_STORE[name] = code;
}

let shadersRegistered = false;
function ensureShadersRegistered(): void {
  if (shadersRegistered) return;
  shadersRegistered = true;
  registerShader("thermalFieldComputeShader", FIELD_COMPUTE);
  registerShader("thermalMcComputeShader", MC_COMPUTE);
  registerShader("thermalWrapperVertexShader", WRAPPER_VERTEX);
  registerShader("thermalWrapperFragmentShader", WRAPPER_FRAGMENT);
  registerShader("thermalHeatmapVertexShader", HEATMAP_VERTEX);
  registerShader("thermalHeatmapFragmentShader", HEATMAP_FRAGMENT);
  registerShader("thermalRackVertexShader", RACK_VERTEX);
  registerShader("thermalRackFragmentShader", RACK_FRAGMENT);
  registerShader("thermalFloorVertexShader", FLOOR_VERTEX);
  registerShader("thermalFloorFragmentShader", FLOOR_FRAGMENT);
}

export class ThermalEngine {
  private engine: WebGPUEngine;
  private scene!: Scene;
  private camera!: ArcRotateCamera;

  private layout: RoomLayout | null = null;
  private fieldGrid: FieldGrid | null = null;
  private faceFrames: FaceFrame[] = [];

  /* ---- GPU 资源：创建一次，全程复用 ---- */
  private fieldCompute: ComputeShader | null = null;
  private mcCompute: ComputeShader | null = null;

  private gParamBuf: StorageBuffer | null = null;
  private fParamBuf: StorageBuffer | null = null;
  private mcParamBuf: StorageBuffer | null = null;
  private rackInfoBuf: StorageBuffer | null = null;
  private sampleBuf: StorageBuffer | null = null;
  private accelStartBuf: StorageBuffer | null = null;
  private accelItemBuf: StorageBuffer | null = null;
  private fieldBuf: StorageBuffer | null = null;
  private triTableBuf: StorageBuffer | null = null;
  private triCountBuf: StorageBuffer | null = null;
  private vertBuf: StorageBuffer | null = null;
  private counterBuf: StorageBuffer | null = null;

  private isoBackMesh: Mesh | null = null;
  private isoFrontMesh: Mesh | null = null;
  private isoBackMat: ShaderMaterial | null = null;
  private isoFrontMat: ShaderMaterial | null = null;
  private heatmapMesh: Mesh | null = null;
  private heatmapMat: ShaderMaterial | null = null;
  private rackMesh: Mesh | null = null;
  private rackMat: ShaderMaterial | null = null;
  private floorMesh: Mesh | null = null;
  private floorMat: ShaderMaterial | null = null;

  private lutTex: Texture | null = null;

  /* ---- 状态 ---- */
  private threshold = 38;
  private opacity = 0.38;
  private showIso = true;
  private showHeatmap = true;
  private selectedRack: number | null = null;

  private fieldDirty = true;
  private isoDirty = false;
  private fieldReady = false;

  private lastIsoMs = 0;
  private lastIsoVerts = 0;
  private drawVerts = 0;

  private frameCount = 0;
  private lastStatsAt = 0;
  private pendingReadback = false;
  private lastReadbackAt = 0;

  private ready = false;
  private callbacks: EngineCallbacks;
  private resizeObserver: ResizeObserver | null = null;
  private observers: { remove(): void }[] = [];
  private disposed = false;

  constructor(private canvas: HTMLCanvasElement, callbacks: EngineCallbacks = {}) {
    this.callbacks = callbacks;
    this.engine = new WebGPUEngine(canvas, { antialias: true, stencil: false });
  }

  /** 场景必须在 engine.initAsync() 之后创建：Babylon 的 capability 表此时才填好。 */
  private createScene(): void {
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.031, 0.039, 0.055, 1);
    this.scene.autoClear = true;

    this.camera = new ArcRotateCamera(
      "camera",
      -Math.PI / 2.35,
      Math.PI / 3.05,
      14,
      new Vector3(0, 1.0, 0),
      this.scene
    );
    this.camera.lowerRadiusLimit = 0.8;
    this.camera.upperRadiusLimit = 140;
    this.camera.wheelDeltaPercentage = 0.012;
    this.camera.panningSensibility = 42;
    this.camera.minZ = 0.04;
    this.camera.maxZ = 500;
    this.camera.allowUpsideDown = false;
    this.camera.upperBetaLimit = Math.PI / 2 - 0.015;
  }

  /* ------------------------------------------------------------------ */
  /*  初始化                                                             */
  /* ------------------------------------------------------------------ */

  async init(): Promise<void> {
    await this.engine.initAsync();
    ensureShadersRegistered();
    this.createScene();
    this.setPalette("thermal");

    this.engine.runRenderLoop(() => {
      if (!this.disposed) this.scene.render();
    });

    this.camera.attachControl(this.canvas, true);
    this.setupInteraction();
    this.buildFloor();

    this.observers.push(
      this.scene.onBeforeRenderObservable.add(() => this.beforeRender()),
      this.scene.onAfterRenderObservable.add(() => this.afterRender())
    );

    this.resizeObserver = new ResizeObserver(() => this.engine.resize());
    this.resizeObserver.observe(this.canvas.parentElement ?? this.canvas);
    this.engine.resize();

    this.ready = true;
    this.callbacks.onReady?.();
  }

  get isReady(): boolean {
    return this.ready;
  }

  private setupInteraction(): void {
    let down: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY };
    };
    const onUp = (e: PointerEvent) => {
      if (!down) return;
      const moved = (e.clientX - down.x) ** 2 + (e.clientY - down.y) ** 2;
      down = null;
      if (moved > 36 || !this.rackMesh) return;

      const rect = this.canvas.getBoundingClientRect();
      const pick = this.scene.pick(
        e.clientX - rect.left,
        e.clientY - rect.top,
        (m) => m === this.rackMesh
      );
      if (pick?.hit && pick.pickedPoint) {
        this.setSelectedRack(this.rackIndexAt(pick.pickedPoint));
      } else {
        this.setSelectedRack(null);
      }
    };
    this.canvas.addEventListener("pointerdown", onDown);
    this.canvas.addEventListener("pointerup", onUp);
    this.interactionCleanup = () => {
      this.canvas.removeEventListener("pointerdown", onDown);
      this.canvas.removeEventListener("pointerup", onUp);
    };
  }

  private interactionCleanup: (() => void) | null = null;

  private rackIndexAt(point: Vector3): number | null {
    if (!this.layout) return null;
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < this.layout.boxes.length; i++) {
      const b = this.layout.boxes[i];
      const dx = Math.max(0, Math.abs(point.x - (b.min[0] + b.max[0]) / 2) - (b.max[0] - b.min[0]) / 2);
      const dy = Math.max(0, Math.abs(point.y - (b.min[1] + b.max[1]) / 2) - (b.max[1] - b.min[1]) / 2);
      const dz = Math.max(0, Math.abs(point.z - (b.min[2] + b.max[2]) / 2) - (b.max[2] - b.min[2]) / 2);
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best >= 0 ? best : null;
  }

  private beforeRender(): void {
    if (!this.ready || !this.fieldReady) return;

    // 阈值变化 → 只重跑移动立方体，缓冲区不重建
    if (this.isoDirty && this.mcCompute && this.mcParamBuf && this.fieldGrid) {
      this.isoDirty = false;
      const t0 = performance.now();
      this.counterBuf?.update(new Uint32Array([0, 0, 0, 0]));

      const g = this.fieldGrid;
      const mp = this.mcParamBuf;
      const p = new Float32Array(MC_IDX.LEN);
      p[MC_IDX.THRESHOLD] = this.threshold;
      p[MC_IDX.MAX_VERTS] = MAX_ISO_VERTS;
      p[MC_IDX.DIM_X] = g.dim[0];
      p[MC_IDX.DIM_Y] = g.dim[1];
      p[MC_IDX.DIM_Z] = g.dim[2];
      p[MC_IDX.CELL_SIZE] = g.cellSize;
      p[MC_IDX.ORIGIN_X] = g.origin[0];
      p[MC_IDX.ORIGIN_Y] = g.origin[1];
      p[MC_IDX.ORIGIN_Z] = g.origin[2];
      mp.update(p);

      const ok = this.mcCompute.dispatch(
        Math.ceil((g.dim[0] - 1) / 4),
        Math.ceil((g.dim[1] - 1) / 4),
        Math.ceil((g.dim[2] - 1) / 4)
      );
      if (ok) {
        this.lastIsoMs = performance.now() - t0;
        this.requestCountReadback();
      } else {
        this.isoDirty = true; // 管线未就绪，下一帧重试
      }
    }
  }

  private afterRender(): void {
    const now = performance.now();
    this.frameCount++;
    if (this.lastStatsAt === 0) this.lastStatsAt = now;
    const dt = now - this.lastStatsAt;
    if (dt >= 400) {
      const fps = (this.frameCount * 1000) / dt;
      const g = this.fieldGrid;
      this.callbacks.onStats?.({
        fps,
        frameMs: dt / this.frameCount,
        isoVerts: this.lastIsoVerts,
        isoReady: this.fieldReady,
        lastIsoMs: this.lastIsoMs,
        voxels: g ? g.dim[0] * g.dim[1] * g.dim[2] : 0,
        racks: this.layout?.boxes.length ?? 0,
      });
      this.frameCount = 0;
      this.lastStatsAt = now;
    }
  }

  /* ------------------------------------------------------------------ */
  /*  数据装载                                                           */
  /* ------------------------------------------------------------------ */

  async setLayout(layout: RoomLayout): Promise<void> {
    this.layout = layout;
    this.fieldReady = false;
    this.fieldGrid = planFieldGrid(layout);
    this.faceFrames = computeFaceFrames(layout);

    this.disposeFieldResources();
    this.allocFieldResources(layout, this.fieldGrid);
    this.buildRackMesh(layout);
    this.buildHeatmapMesh(layout);
    this.frameCamera(layout);
    this.setSelectedRack(null);

    await this.runFieldCompute();
    this.isoDirty = true;
  }

  private allocFieldResources(layout: RoomLayout, grid: FieldGrid): void {
    const nRacks = layout.boxes.length;
    const faceCount = FACE_COLS * FACE_ROWS;

    this.gParamBuf = new StorageBuffer(this.engine, GRID_IDX.LEN * 4, RW);
    this.fParamBuf = new StorageBuffer(this.engine, FIELD_IDX.LEN * 4, RW);
    this.mcParamBuf = new StorageBuffer(this.engine, MC_IDX.LEN * 4, RW);

    const gp = new Float32Array(GRID_IDX.LEN);
    gp[GRID_IDX.DIM_X] = grid.dim[0];
    gp[GRID_IDX.DIM_Y] = grid.dim[1];
    gp[GRID_IDX.DIM_Z] = grid.dim[2];
    gp[GRID_IDX.CELL_SIZE] = grid.cellSize;
    gp[GRID_IDX.ORIGIN_X] = grid.origin[0];
    gp[GRID_IDX.ORIGIN_Y] = grid.origin[1];
    gp[GRID_IDX.ORIGIN_Z] = grid.origin[2];
    gp[GRID_IDX.AMBIENT] = grid.ambient;
    this.gParamBuf.update(gp);

    // 每柜 12 个 vec4f = 48 个 float（角点 8 + 法线 2 + 包围盒 2）
    this.rackInfoBuf = new StorageBuffer(this.engine, Math.max(192, nRacks * 48 * 4), RW);
    this.rackInfoBuf.update(packRackInfos(layout, this.faceFrames));

    this.sampleBuf = new StorageBuffer(this.engine, Math.max(16, nRacks * faceCount * 2 * 4), RW);
    const samples = new Float32Array(Math.max(4, nRacks * faceCount * 2));
    for (let i = 0; i < nRacks; i++) {
      const r = layout.boxes[i].rack;
      samples.set(r.intake.values.subarray(0, faceCount), i * faceCount * 2);
      samples.set(r.exhaust.values.subarray(0, faceCount), i * faceCount * 2 + faceCount);
    }
    this.sampleBuf.update(samples);

    const accel = buildAccelGrid(layout, grid);
    this.accelStartBuf = new StorageBuffer(this.engine, accel.start.byteLength, RW);
    this.accelStartBuf.update(accel.start);
    const items = accel.items.length > 0 ? accel.items : new Uint32Array([0]);
    this.accelItemBuf = new StorageBuffer(this.engine, Math.max(4, items.byteLength), RW);
    this.accelItemBuf.update(items);

    const fp = new Float32Array(FIELD_IDX.LEN);
    fp[FIELD_IDX.N_RACKS] = nRacks;
    fp[FIELD_IDX.COLS] = FACE_COLS;
    fp[FIELD_IDX.ROWS] = FACE_ROWS;
    fp[FIELD_IDX.FALLOFF] = FALLOFF;
    fp[FIELD_IDX.CELLS_X] = grid.accelDim[0];
    fp[FIELD_IDX.CELLS_Y] = grid.accelDim[1];
    fp[FIELD_IDX.CELLS_Z] = grid.accelDim[2];
    fp[FIELD_IDX.CELL_MIN_X] = grid.accelOrigin[0];
    fp[FIELD_IDX.CELL_MIN_Y] = grid.accelOrigin[1];
    fp[FIELD_IDX.CELL_MIN_Z] = grid.accelOrigin[2];
    fp[FIELD_IDX.CELL_SIZE] = grid.accelCellSize;
    this.fParamBuf.update(fp);

    const voxels = grid.dim[0] * grid.dim[1] * grid.dim[2];
    this.fieldBuf = new StorageBuffer(this.engine, voxels * 4, RW);
    this.fieldBuf.clear();

    this.triTableBuf = new StorageBuffer(this.engine, MC_TRITABLE.byteLength, RW);
    this.triTableBuf.update(MC_TRITABLE);
    this.triCountBuf = new StorageBuffer(this.engine, MC_TRICOUNT.byteLength, RW);
    this.triCountBuf.update(MC_TRICOUNT);

    this.vertBuf = new StorageBuffer(this.engine, MAX_ISO_VERTS * VERTEX_FLOATS * 4, RW);
    this.vertBuf.clear();
    this.counterBuf = new StorageBuffer(this.engine, 16, RW);
    this.counterBuf.update(new Uint32Array([0, 0, 0, 0]));

    this.fieldCompute = new ComputeShader(
      "thermalField",
      this.engine,
      { computeSource: FIELD_COMPUTE },
      {
        bindingsMapping: {
          racks: { group: 0, binding: 0 },
          samples: { group: 0, binding: 1 },
          gparams: { group: 0, binding: 2 },
          fparams: { group: 0, binding: 3 },
          cellStart: { group: 0, binding: 4 },
          cellItems: { group: 0, binding: 5 },
          fieldOut: { group: 0, binding: 6 },
        },
      }
    );
    this.fieldCompute.setStorageBuffer("racks", this.rackInfoBuf);
    this.fieldCompute.setStorageBuffer("samples", this.sampleBuf);
    this.fieldCompute.setStorageBuffer("gparams", this.gParamBuf);
    this.fieldCompute.setStorageBuffer("fparams", this.fParamBuf);
    this.fieldCompute.setStorageBuffer("cellStart", this.accelStartBuf);
    this.fieldCompute.setStorageBuffer("cellItems", this.accelItemBuf);
    this.fieldCompute.setStorageBuffer("fieldOut", this.fieldBuf);
    this.fieldCompute.onError = (e) =>
      this.callbacks.onError?.(`温度场着色器错误：${String(e).slice(0, 400)}`);

    this.mcCompute = new ComputeShader(
      "thermalMc",
      this.engine,
      { computeSource: MC_COMPUTE },
      {
        bindingsMapping: {
          fieldData: { group: 0, binding: 0 },
          triTable: { group: 0, binding: 1 },
          triCount: { group: 0, binding: 2 },
          verts: { group: 0, binding: 3 },
          counters: { group: 0, binding: 4 },
          mparams: { group: 0, binding: 5 },
        },
      }
    );
    this.mcCompute.setStorageBuffer("fieldData", this.fieldBuf);
    this.mcCompute.setStorageBuffer("triTable", this.triTableBuf);
    this.mcCompute.setStorageBuffer("triCount", this.triCountBuf);
    this.mcCompute.setStorageBuffer("verts", this.vertBuf);
    this.mcCompute.setStorageBuffer("counters", this.counterBuf);
    this.mcCompute.setStorageBuffer("mparams", this.mcParamBuf);
    this.mcCompute.onError = (e) =>
      this.callbacks.onError?.(`等值面着色器错误：${String(e).slice(0, 400)}`);

    this.rebuildIsoMeshes();
  }

  async runFieldCompute(): Promise<void> {
    if (!this.fieldCompute || !this.fieldGrid) return;
    const g = this.fieldGrid;
    try {
      await this.fieldCompute.dispatchWhenReady(
        Math.ceil(g.dim[0] / 4),
        Math.ceil(g.dim[1] / 4),
        Math.ceil(g.dim[2] / 4)
      );
      this.fieldDirty = false;
      this.fieldReady = true;
      this.isoDirty = true;
    } catch (e) {
      this.callbacks.onError?.(`温度场计算失败：${(e as Error).message ?? e}`);
    }
  }

  private requestCountReadback(): void {
    const now = performance.now();
    if (this.pendingReadback || !this.counterBuf) return;
    if (now - this.lastReadbackAt < 90) return; // 拖动阈值时限制回读频率
    this.pendingReadback = true;
    this.lastReadbackAt = now;
    this.counterBuf
      .read(0, 8)
      .then((raw) => {
        const u8 = toAlignedBytes(raw);
        const u = new Uint32Array(u8.buffer.slice(u8.byteOffset, u8.byteOffset + 8));
        const count = Math.min(u[1], MAX_ISO_VERTS);
        this.lastIsoVerts = count;
        this.applyDrawCount(count);
      })
      .catch(() => {})
      .finally(() => {
        this.pendingReadback = false;
      });
  }

  /** 按实际顶点数收缩绘制范围 —— 只改 subMesh 计数，不触碰缓冲区 */
  private applyDrawCount(count: number): void {
    const n = Math.max(0, Math.min(MAX_ISO_VERTS, Math.floor(count / 3) * 3));
    if (n === this.drawVerts) return;
    this.drawVerts = n;
    for (const m of [this.isoBackMesh, this.isoFrontMesh]) {
      if (!m || !m.subMeshes[0]) continue;
      m.subMeshes[0].verticesStart = 0;
      m.subMeshes[0].verticesCount = Math.max(3, n);
      m.refreshBoundingInfo();
    }
  }

  /* ------------------------------------------------------------------ */
  /*  网格                                                               */
  /* ------------------------------------------------------------------ */

  private rebuildIsoMeshes(): void {
    for (const m of [this.isoBackMesh, this.isoFrontMesh]) m?.dispose();
    this.isoBackMesh = null;
    this.isoFrontMesh = null;
    this.isoBackMat = null;
    this.isoFrontMat = null;
    this.drawVerts = 0;

    if (!this.vertBuf || !this.counterBuf) return;

    const make = (name: string, passFront: number, alphaIndex: number) => {
      const mat = new ShaderMaterial(
        name + "Mat",
        this.scene,
        { vertex: "thermalWrapper", fragment: "thermalWrapper" },
        {
          attributes: [],
          uniforms: ["worldViewProjection", "cameraPosition", "opacity", "tempRange", "passFront"],
          samplers: ["lut"],
          storageBuffers: ["verts", "counters"],
          needAlphaBlending: true,
          shaderLanguage: ShaderLanguage.WGSL,
        }
      );
      mat.setStorageBuffer("verts", this.vertBuf!);
      mat.setStorageBuffer("counters", this.counterBuf!);
      if (this.lutTex) mat.setTexture("lut", this.lutTex);
      mat.setFloat("passFront", passFront);
      mat.setFloat("opacity", this.opacity);
      mat.setVector2("tempRange", { x: TEMP_MIN, y: TEMP_MAX } as never);
      mat.backFaceCulling = false;
      mat.disableDepthWrite = true;

      const mesh = new Mesh(name, this.scene);
      const vd = new VertexData();
      vd.positions = [0, 0, 0];
      vd.applyToMesh(mesh, false);
      mesh.isUnIndexed = true;
      mesh.material = mat;
      mesh.alwaysSelectAsActiveMesh = true;
      mesh.refreshBoundingInfo();
      mesh.subMeshes[0].verticesStart = 0;
      mesh.subMeshes[0].verticesCount = MAX_ISO_VERTS;
      mesh.alphaIndex = alphaIndex;
      mesh.isPickable = false;
      // 顶点来自 GPU 存储缓冲，CPU 侧只有一个占位点；给一个足够大的包围盒，
      // 供透明通道的排序与视锥判断使用（不参与裁剪，见 alwaysSelectAsActiveMesh）。
      mesh.buildBoundingInfo(new Vector3(-500, -500, -500), new Vector3(500, 500, 500));
      mesh.subMeshes[0].refreshBoundingInfo();
      return { mesh, mat };
    };

    const back = make("thermalIsoBack", 0, 10);
    const front = make("thermalIsoFront", 1, 11);
    this.isoBackMesh = back.mesh;
    this.isoFrontMesh = front.mesh;
    this.isoBackMat = back.mat;
    this.isoFrontMat = front.mat;
    this.applyIsoVisibility();
  }

  private applyIsoVisibility(): void {
    this.isoBackMesh?.setEnabled(this.showIso);
    this.isoFrontMesh?.setEnabled(this.showIso);
  }

  private buildRackMesh(layout: RoomLayout): void {
    this.rackMesh?.dispose();
    this.rackMat?.dispose();
    this.rackMat = null;

    const positions: number[] = [];
    const normals: number[] = [];
    const metas: number[] = [];
    const indices: number[] = [];

    type Corner = [number, number, number];
    const faceDefs: { n: Corner; get: (b: RackBox) => Corner[] }[] = [
      { n: [0, 0, 1], get: (b) => [[b.min[0], b.min[1], b.max[2]], [b.max[0], b.min[1], b.max[2]], [b.max[0], b.max[1], b.max[2]], [b.min[0], b.max[1], b.max[2]]] },
      { n: [0, 0, -1], get: (b) => [[b.max[0], b.min[1], b.min[2]], [b.min[0], b.min[1], b.min[2]], [b.min[0], b.max[1], b.min[2]], [b.max[0], b.max[1], b.min[2]]] },
      { n: [1, 0, 0], get: (b) => [[b.max[0], b.min[1], b.max[2]], [b.max[0], b.min[1], b.min[2]], [b.max[0], b.max[1], b.min[2]], [b.max[0], b.max[1], b.max[2]]] },
      { n: [-1, 0, 0], get: (b) => [[b.min[0], b.min[1], b.min[2]], [b.min[0], b.min[1], b.max[2]], [b.min[0], b.max[1], b.max[2]], [b.min[0], b.max[1], b.min[2]]] },
      { n: [0, 1, 0], get: (b) => [[b.min[0], b.max[1], b.max[2]], [b.max[0], b.max[1], b.max[2]], [b.max[0], b.max[1], b.min[2]], [b.min[0], b.max[1], b.min[2]]] },
      { n: [0, -1, 0], get: (b) => [[b.min[0], b.min[1], b.min[2]], [b.max[0], b.min[1], b.min[2]], [b.max[0], b.min[1], b.max[2]], [b.min[0], b.min[1], b.max[2]]] },
    ];

    layout.boxes.forEach((box, idx) => {
      for (const f of faceDefs) {
        const base = positions.length / 3;
        for (const c of f.get(box)) {
          positions.push(c[0], c[1], c[2]);
          normals.push(f.n[0], f.n[1], f.n[2]);
          metas.push(idx, 0);
        }
        indexQuad(indices, base);
      }
    });

    const mesh = new Mesh("thermalRacks", this.scene);
    const vd = new VertexData();
    vd.positions = positions;
    vd.normals = normals;
    vd.indices = indices;
    vd.applyToMesh(mesh, false);
    mesh.setVerticesData("rackmeta", new Float32Array(metas), false, 2);
    mesh.refreshBoundingInfo();

    const mat = new ShaderMaterial(
      "thermalRackMat",
      this.scene,
      { vertex: "thermalRack", fragment: "thermalRack" },
      {
        attributes: ["position", "normal", "rackmeta"],
        uniforms: ["worldViewProjection", "cameraPosition", "selection"],
        shaderLanguage: ShaderLanguage.WGSL,
      }
    );
    mat.setVector4("selection", { x: -1, y: 0, z: 0, w: 0 } as never);
    mat.backFaceCulling = true;

    mesh.material = mat;
    mesh.isPickable = true;
    this.rackMesh = mesh;
    this.rackMat = mat;
  }

  private buildHeatmapMesh(layout: RoomLayout): void {
    this.heatmapMesh?.dispose();
    this.heatmapMat?.dispose();
    this.heatmapMat = null;

    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const metas: number[] = [];
    const indices: number[] = [];
    const uv4: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]];

    layout.boxes.forEach((box, idx) => {
      const ff = this.faceFrames[idx];
      const faces = [
        { corners: ff.intakeCorners, normal: ff.intakeNormal, kind: 0 },
        { corners: ff.exhaustCorners, normal: ff.exhaustNormal, kind: 1 },
      ];
      for (const f of faces) {
        const base = positions.length / 3;
        f.corners.forEach((c, i) => {
          positions.push(c[0], c[1], c[2]);
          normals.push(f.normal[0], f.normal[1], f.normal[2]);
          uvs.push(uv4[i][0], uv4[i][1]);
          metas.push(idx, f.kind);
        });
        indexQuad(indices, base);
      }
    });

    const mesh = new Mesh("thermalHeatmap", this.scene);
    const vd = new VertexData();
    vd.positions = positions;
    vd.normals = normals;
    vd.uvs = uvs;
    vd.indices = indices;
    vd.applyToMesh(mesh, false);
    mesh.setVerticesData("rackmeta", new Float32Array(metas), false, 2);
    mesh.refreshBoundingInfo();

    const mat = new ShaderMaterial(
      "thermalHeatmapMat",
      this.scene,
      { vertex: "thermalHeatmap", fragment: "thermalHeatmap" },
      {
        attributes: ["position", "normal", "uv", "rackmeta"],
        uniforms: ["worldViewProjection", "faceDims", "tempRange", "highlight"],
        samplers: ["lut"],
        storageBuffers: ["samples"],
        shaderLanguage: ShaderLanguage.WGSL,
      }
    );
    if (this.sampleBuf) mat.setStorageBuffer("samples", this.sampleBuf);
    if (this.lutTex) mat.setTexture("lut", this.lutTex);
    mat.setVector4("faceDims", { x: FACE_COLS, y: FACE_ROWS, z: 0, w: 0 } as never);
    mat.setVector2("tempRange", { x: TEMP_MIN, y: TEMP_MAX } as never);
    mat.setVector2("highlight", { x: -1, y: 0 } as never);
    mat.backFaceCulling = false;

    mesh.material = mat;
    mesh.isPickable = false;
    mesh.setEnabled(this.showHeatmap);
    this.heatmapMesh = mesh;
    this.heatmapMat = mat;
  }

  private buildFloor(): void {
    this.floorMesh?.dispose();
    const size = 80;
    const mesh = new Mesh("thermalFloor", this.scene);
    const vd = new VertexData();
    vd.positions = [-size, -0.004, -size, size, -0.004, -size, size, -0.004, size, -size, -0.004, size];
    vd.indices = [0, 1, 2, 0, 2, 3];
    vd.applyToMesh(mesh, false);

    const mat = new ShaderMaterial(
      "thermalFloorMat",
      this.scene,
      { vertex: "thermalFloor", fragment: "thermalFloor" },
      {
        attributes: ["position"],
        uniforms: ["worldViewProjection", "center", "extent"],
        needAlphaBlending: true,
        shaderLanguage: ShaderLanguage.WGSL,
      }
    );
    mat.backFaceCulling = false;
    mat.setVector2("center", { x: 0, y: 0 } as never);
    mat.setVector2("extent", { x: size * 0.8, y: size * 0.8 } as never);
    mesh.material = mat;
    mesh.isPickable = false;
    mesh.alphaIndex = 0;
    this.floorMesh = mesh;
    this.floorMat = mat;
  }

  private frameCamera(layout: RoomLayout): void {
    const { boundsMin: min, boundsMax: max } = layout;
    const cx = (min[0] + max[0]) / 2;
    const cz = (min[2] + max[2]) / 2;
    const cy = (min[1] + max[1]) / 2;
    const dx = Math.max(max[0] - min[0], 1.5);
    const dy = Math.max(max[1] - min[1], 1.5);
    const dz = Math.max(max[2] - min[2], 1.5);
    const span = Math.max(dx, dz, dy);
    const diagonal = Math.sqrt(dx * dx + dy * dy + dz * dz);
    this.camera.setTarget(new Vector3(cx, cy * 0.6, cz));
    // 让整个机房落在视野内：斜对角线长度 × 1.15，同时兼顾窄长布局
    this.camera.radius = Math.max(3.2, diagonal * 1.25, span * 1.35);
    this.camera.lowerRadiusLimit = Math.max(0.5, span * 0.06);
    this.camera.upperRadiusLimit = Math.max(40, span * 10);
    this.camera.alpha = -Math.PI / 2.35;
    this.camera.beta = Math.PI / 3.05;

    if (this.floorMat) {
      this.floorMat.setVector2("center", { x: cx, y: cz } as never);
      const ext = Math.max(span * 0.85, 14);
      this.floorMat.setVector2("extent", { x: ext, y: ext } as never);
    }
  }

  /* ------------------------------------------------------------------ */
  /*  对外控制                                                           */
  /* ------------------------------------------------------------------ */

  setThreshold(value: number): void {
    const v = Math.min(TEMP_MAX, Math.max(TEMP_MIN, value));
    if (Math.abs(v - this.threshold) < 1e-4) return;
    this.threshold = v;
    if (this.fieldReady) this.isoDirty = true;
  }

  getThreshold(): number {
    return this.threshold;
  }

  setOpacity(value: number): void {
    this.opacity = Math.min(0.9, Math.max(0.05, value));
    this.isoBackMat?.setFloat("opacity", this.opacity);
    this.isoFrontMat?.setFloat("opacity", this.opacity);
  }

  setShowIso(v: boolean): void {
    this.showIso = v;
    this.applyIsoVisibility();
  }

  setShowHeatmap(v: boolean): void {
    this.showHeatmap = v;
    this.heatmapMesh?.setEnabled(v);
  }

  setPalette(id: PaletteId): void {
    const old = this.lutTex;
    this.lutTex = createLutTexture(this.scene, getPalette(id));
    this.isoBackMat?.setTexture("lut", this.lutTex);
    this.isoFrontMat?.setTexture("lut", this.lutTex);
    this.heatmapMat?.setTexture("lut", this.lutTex);
    old?.dispose();
  }

  setSelectedRack(index: number | null): void {
    this.selectedRack = index;
    this.rackMat?.setVector4("selection", {
      x: index ?? -1,
      y: index === null ? 0 : 1,
      z: 0,
      w: 0,
    } as never);
    this.heatmapMat?.setVector2("highlight", {
      x: index ?? -1,
      y: index === null ? 0 : 1,
    } as never);
    this.callbacks.onSelect?.(index);
  }

  getSelectedRack(): number | null {
    return this.selectedRack;
  }

  /** 读取当前等值面顶点（Float32，8 floats/顶点：pos3 normal3 temp pad） */
  async readIsoVertices(): Promise<Float32Array> {
    if (!this.counterBuf || !this.vertBuf) return new Float32Array(0);
    const cntRaw = toAlignedBytes(await this.counterBuf.read(0, 8, undefined, true));
    const cnt = new Uint32Array(cntRaw.buffer, 0, 2);
    const vcount = Math.min(cnt[1], MAX_ISO_VERTS);
    this.lastIsoVerts = vcount;
    if (vcount === 0) return new Float32Array(0);
    const bytes = vcount * VERTEX_FLOATS * 4;
    const raw = toAlignedBytes(await this.vertBuf.read(0, bytes, undefined, true));
    return new Float32Array(raw.buffer, 0, bytes / 4);
  }

  async readField(): Promise<{
    data: Float32Array;
    dim: [number, number, number];
    origin: [number, number, number];
    cellSize: number;
  }> {
    if (!this.fieldBuf || !this.fieldGrid) {
      return { data: new Float32Array(0), dim: [0, 0, 0], origin: [0, 0, 0], cellSize: 0 };
    }
    const g = this.fieldGrid;
    const bytes = g.dim[0] * g.dim[1] * g.dim[2] * 4;
    const raw = toAlignedBytes(await this.fieldBuf.read(0, bytes, undefined, true));
    return {
      data: new Float32Array(raw.buffer, 0, bytes / 4),
      dim: [g.dim[0], g.dim[1], g.dim[2]],
      origin: [...g.origin],
      cellSize: g.cellSize,
    };
  }

  getFieldGrid(): FieldGrid | null {
    return this.fieldGrid;
  }

  getLayout(): RoomLayout | null {
    return this.layout;
  }

  getFaceFrames(): FaceFrame[] {
    return this.faceFrames;
  }

  getRackStats(index: number): {
    intakeMin: number;
    intakeMax: number;
    intakeAvg: number;
    exhaustMin: number;
    exhaustMax: number;
    exhaustAvg: number;
    deltaT: number;
  } | null {
    const box = this.layout?.boxes[index];
    if (!box) return null;
    const stat = (a: Float32Array) => {
      let mn = Infinity;
      let mx = -Infinity;
      let sum = 0;
      let n = 0;
      for (let i = 0; i < a.length; i++) {
        const v = a[i];
        if (!Number.isFinite(v)) continue;
        mn = Math.min(mn, v);
        mx = Math.max(mx, v);
        sum += v;
        n++;
      }
      return { mn: n ? mn : 0, mx: n ? mx : 0, avg: n ? sum / n : 0 };
    };
    const i = stat(box.rack.intake.values);
    const e = stat(box.rack.exhaust.values);
    return {
      intakeMin: i.mn,
      intakeMax: i.mx,
      intakeAvg: i.avg,
      exhaustMin: e.mn,
      exhaustMax: e.mx,
      exhaustAvg: e.avg,
      deltaT: e.avg - i.avg,
    };
  }

  resetCamera(): void {
    if (this.layout) this.frameCamera(this.layout);
  }

  getCameraState(): { alpha: number; beta: number; radius: number } {
    return {
      alpha: this.camera.alpha,
      beta: this.camera.beta,
      radius: this.camera.radius,
    };
  }

  setCameraPreset(preset: "iso" | "front" | "top"): void {
    if (preset === "top") {
      this.camera.alpha = -Math.PI / 2;
      this.camera.beta = 0.02;
    } else if (preset === "front") {
      this.camera.alpha = -Math.PI / 2;
      this.camera.beta = Math.PI / 2.4;
    } else {
      this.camera.alpha = -Math.PI / 2.35;
      this.camera.beta = Math.PI / 3.05;
    }
  }

  /* ------------------------------------------------------------------ */
  /*  清理                                                               */
  /* ------------------------------------------------------------------ */

  private disposeFieldResources(): void {
    this.fieldCompute = null;
    this.mcCompute = null;
    const list = [
      this.gParamBuf,
      this.fParamBuf,
      this.mcParamBuf,
      this.rackInfoBuf,
      this.sampleBuf,
      this.accelStartBuf,
      this.accelItemBuf,
      this.fieldBuf,
      this.triTableBuf,
      this.triCountBuf,
      this.vertBuf,
      this.counterBuf,
    ];
    for (const b of list) b?.dispose();
    this.gParamBuf = null;
    this.fParamBuf = null;
    this.mcParamBuf = null;
    this.rackInfoBuf = null;
    this.sampleBuf = null;
    this.accelStartBuf = null;
    this.accelItemBuf = null;
    this.fieldBuf = null;
    this.triTableBuf = null;
    this.triCountBuf = null;
    this.vertBuf = null;
    this.counterBuf = null;
  }

  dispose(): void {
    this.disposed = true;
    this.resizeObserver?.disconnect();
    this.interactionCleanup?.();
    for (const o of this.observers) o.remove();
    this.observers = [];
    this.disposeFieldResources();
    this.isoBackMesh?.dispose();
    this.isoFrontMesh?.dispose();
    this.isoBackMat?.dispose();
    this.isoFrontMat?.dispose();
    this.heatmapMesh?.dispose();
    this.heatmapMat?.dispose();
    this.rackMesh?.dispose();
    this.rackMat?.dispose();
    this.floorMesh?.dispose();
    this.floorMat?.dispose();
    this.lutTex?.dispose();
    this.scene.dispose();
    this.engine.dispose();
  }
}

/**
 * 四边形拆成两个三角形。
 *
 * 输入的四个角点是"从外侧看逆时针"排列的；Babylon 的正面约定是顺时针，
 * 因此这里按 (0,2,1) / (0,3,2) 输出，避免看到盒子内壁。
 */
/** 把 GPU 回读的数据复制到一个 4 字节对齐的新缓冲区，便于按 Float32/Uint32 访问。 */
function toAlignedBytes(raw: unknown): Uint8Array {
  const u8 = raw as Uint8Array;
  if (u8.byteOffset % 4 === 0 && u8.buffer.byteLength >= u8.byteLength && u8.byteOffset === 0) {
    return u8;
  }
  const out = new Uint8Array(u8.byteLength);
  out.set(u8);
  return out;
}

function indexQuad(indices: number[], base: number): void {
  indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
}
