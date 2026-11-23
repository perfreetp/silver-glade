import { WebGPUEngine } from "@babylonjs/core/Engines/webgpuEngine";
import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder";
import { CreateLines } from "@babylonjs/core/Meshes/Builders/linesBuilder";
import type { LinesMesh } from "@babylonjs/core/Meshes/linesMesh";
import { PointerEventTypes } from "@babylonjs/core/Events/pointerEvents";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import {
  SceneLoader,
} from "@babylonjs/core/Loading/sceneLoader";
import "@babylonjs/loaders/glTF";
import "@babylonjs/loaders/OBJ/objFileLoader";
import "@babylonjs/loaders/STL/stlFileLoader";

import { ProceduralRoof } from "./ProceduralRoof";
import { MeshProjector } from "./MeshProjector";
import { buildReferenceLines, type RoofSurface } from "./ReferenceLines";
import { DamageLayer } from "./DamageLayer";
import { store, setStatus } from "../store";
import {
  type DamageLayerFile,
  type DamagePatchData,
  type RoofStats,
} from "../types";

type EngineImpl = WebGPUEngine | Engine;

/** 引擎与场景总编排：四个模块的运行时宿主 */
export class BabylonService {
  private engine!: EngineImpl;
  private scene!: Scene;
  private camera!: ArcRotateCamera;
  private roof!: Mesh;
  private surface!: RoofSurface;
  private layer!: DamageLayer;
  private ridgeLines!: Mesh;
  private slopeLines!: Mesh;
  private procedural: ProceduralRoof | null = null;
  private projector: MeshProjector | null = null;
  private drawing = false;
  private currentStroke: Vector3[] = [];
  private strokePreview: LinesMesh | null = null;
  private frameSamples: number[] = [];
  private lastFrameTime = 0;
  private rafLoop = false;

  constructor(private readonly canvas: HTMLCanvasElement) {}

  // ---------- 启动 ----------

  async init(): Promise<void> {
    const supportsWebGPU =
      typeof navigator !== "undefined" &&
      (await WebGPUEngine.IsSupportedAsync);
    if (supportsWebGPU) {
      const engine = new WebGPUEngine(this.canvas, {
        antialias: true,
        adaptToDeviceRatio: true,
      });
      await engine.initAsync();
      this.engine = engine;
      store.engineType = "WebGPU";
    } else {
      this.engine = new Engine(this.canvas, true, {
        antialias: true,
        adaptToDeviceRatio: true,
      });
      store.engineType = "WebGL2";
    }

    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.11, 0.13, 0.16, 1);
    this.camera = new ArcRotateCamera(
      "camera",
      -Math.PI / 2,
      Math.PI / 3.2,
      26,
      Vector3.Zero(),
      this.scene
    );
    this.camera.attachControl(this.canvas, true);
    this.camera.wheelPrecision = 8;
    this.camera.lowerRadiusLimit = 4;
    this.camera.upperRadiusLimit = 90;
    this.camera.pinchPrecision = 50;

    const light = new HemisphericLight(
      "light",
      new Vector3(0, 1, 0.2),
      this.scene
    );
    light.intensity = 1.05;
    this.scene.ambientColor = new Color3(0.35, 0.35, 0.38);

    // 地面网格，辅助尺度感
    const ground = CreateGround(
      "ground",
      { width: 60, height: 60, subdivisions: 2, updatable: false },
      this.scene
    );
    const gmat = new StandardMaterial("ground-mat", this.scene);
    gmat.wireframe = true;
    gmat.emissiveColor = new Color3(0.22, 0.25, 0.28);
    gmat.disableLighting = true;
    ground.material = gmat;
    ground.position.y = -0.02;
    ground.isPickable = false;

    this.layer = new DamageLayer(
      this.scene,
      // 占位 surface，加载屋面后替换
      this.placeholderSurface(),
      () => store.lift,
      () => store.opacity
    );

    this.loadProceduralRoof();
    this.bindPointerEvents();
    this.startRenderLoop();
    // 测试钩子（仅在 window.__exposeScene 预设时挂载，生产环境无副作用）
    if ((window as unknown as { __exposeScene?: boolean }).__exposeScene) {
      (window as unknown as { __scene: Scene }).__scene = this.scene;
    }
    store.ready = true;
    setStatus(
      `初始化完成（${store.engineType}），默认加载程序化举折屋面`
    );
  }

  private placeholderSurface(): RoofSurface {
    return {
      project: () => ({
        point: Vector3.Zero(),
        normal: Vector3.Up(),
        hit: false,
      }),
      bounds: { minX: -10, maxX: 10, minZ: -6, maxZ: 6 },
      ridgeSpacing: 0.5,
    };
  }

  // ---------- 模块一：屋面网格加载 ----------

  loadProceduralRoof(): void {
    const roof = new ProceduralRoof();
    this.procedural = roof;
    this.projector = null;
    const mesh = roof.buildMesh(this.scene, "procedural-roof");
    this.activateRoof(mesh, roof.stats(mesh));
    this.surface = {
      project: (x, z) => {
        if (!roof.contains(x, z)) {
          return { point: new Vector3(x, 0, z), normal: Vector3.Up(), hit: false };
        }
        return {
          point: new Vector3(x, roof.heightAt(x, z), z),
          normal: roof.normalAt(x, z),
          hit: true,
        };
      },
      bounds: {
        minX: -roof.width / 2,
        maxX: roof.width / 2,
        minZ: -roof.depth / 2,
        maxZ: roof.depth / 2,
      },
      ridgeSpacing: roof.ridgeSpacing,
    };
    this.applyRoofMaterial(mesh, true);
    this.rebuildReferences();
    this.frameCameraTo(mesh);
    this.replaceLayerSurface();
    store.roofStats = roof.stats(mesh);
    store.roofName = "程序化举折屋面";
  }

  async importRoof(file: File): Promise<void> {
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!["glb", "gltf", "obj", "stl"].includes(ext)) {
      throw new Error("仅支持 .glb / .gltf / .obj / .stl 屋面模型");
    }
    setStatus(`正在导入屋面模型：${file.name}`);
    const objectUrl = URL.createObjectURL(file);
    let container;
    try {
      container = await SceneLoader.ImportMeshAsync(
        "",
        objectUrl,
        "",
        this.scene,
        undefined,
        "." + ext
      );
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
    const meshes = container.meshes.filter(
      (m) => m.getTotalIndices() > 0
    ) as Mesh[];
    if (meshes.length === 0) {
      throw new Error("模型中未找到可用的三角网格");
    }
    // 合并为单一屋面网格，统一投影与统计
    const merged = Mesh.MergeMeshes(meshes, true, true, undefined, false, true);
    if (!merged) throw new Error("屋面网格合并失败");
    merged.name = "imported-roof";
    this.normalizeScale(merged);

    // 先建投影器，坡度统计依赖它
    this.procedural = null;
    this.projector = new MeshProjector(merged);
    this.activateRoof(merged, this.computeImportedStats(merged));

    const bd = merged.getBoundingInfo().boundingBox;
    this.surface = {
      project: (x, z) => this.projector!.project(x, z),
      bounds: {
        minX: bd.minimumWorld.x,
        maxX: bd.maximumWorld.x,
        minZ: bd.minimumWorld.z,
        maxZ: bd.maximumWorld.z,
      },
      ridgeSpacing: this.estimateRidgeSpacing(merged),
    };
    this.applyRoofMaterial(merged, false);
    this.rebuildReferences();
    this.frameCameraTo(merged);
    this.replaceLayerSurface();
    store.roofName = file.name;
    setStatus(`屋面导入成功：${file.name}（${meshes.length} 个网格已合并）`);
  }

  private activateRoof(mesh: Mesh, stats: RoofStats) {
    if (this.roof) {
      // 先释放旧屋面的材质与纹理，再释放网格
      const oldMat = this.roof.material;
      const diffuseTex =
        oldMat instanceof StandardMaterial ? oldMat.diffuseTexture : null;
      this.roof.dispose();
      oldMat?.dispose();
      diffuseTex?.dispose();
    }
    this.roof = mesh;
    this.roof.isPickable = true;
    store.roofStats = stats;
    // 屋面更换后残损轮廓不再贴合，清空图层
    if (store.patches.length > 0) {
      store.patches.splice(0, store.patches.length);
      store.selectedPatchId = null;
      this.layer.rebuild(store.patches);
      this.syncPerf(0, 0);
    }
  }

  private normalizeScale(mesh: Mesh) {
    mesh.refreshBoundingInfo();
    const size = mesh.getBoundingInfo().boundingBox.extendSize.scale(2);
    const maxDim = Math.max(size.x, size.z, size.y);
    if (maxDim > 0 && Math.abs(maxDim - 20) > 0.5) {
      const s = 20 / maxDim;
      mesh.scaling.scaleInPlace(s);
      mesh.refreshBoundingInfo();
    }
    // 平移使包围盒 XZ 中心归零、最低点贴 y=0
    const bd = mesh.getBoundingInfo().boundingBox;
    mesh.position.x -= (bd.minimumWorld.x + bd.maximumWorld.x) / 2;
    mesh.position.z -= (bd.minimumWorld.z + bd.maximumWorld.z) / 2;
    mesh.position.y -= bd.minimumWorld.y;
    mesh.refreshBoundingInfo();
  }

  private computeImportedStats(mesh: Mesh): RoofStats {
    const bd = mesh.getBoundingInfo().boundingBox;
    const min = bd.minimumWorld;
    const max = bd.maximumWorld;
    // 用投影器抽样估算坡度
    let sum = 0;
    let maxSlope = 0;
    let n = 0;
    const step = 0.6;
    for (let x = min.x + 0.3; x < max.x; x += step) {
      for (let z = min.z + 0.3; z < max.z; z += step) {
        const c = this.projector?.project(x, z);
        const fx = this.projector?.project(x + step, z);
        const fz = this.projector?.project(x, z + step);
        if (c?.hit && fx?.hit && fz?.hit) {
          const dydx = (fx.point.y - c.point.y) / step;
          const dydz = (fz.point.y - c.point.y) / step;
          const slope =
            (Math.atan(Math.hypot(dydx, dydz)) * 180) / Math.PI;
          sum += slope;
          maxSlope = Math.max(maxSlope, slope);
          n++;
        }
      }
    }
    return {
      triangleCount: mesh.getTotalIndices() / 3,
      vertexCount: mesh.getTotalVertices(),
      min: [min.x, min.y, min.z],
      max: [max.x, max.y, max.z],
      size: [max.x - min.x, max.y - min.y, max.z - min.z],
      avgSlopeDeg: n ? sum / n : 0,
      maxSlopeDeg: maxSlope,
    };
  }

  private estimateRidgeSpacing(mesh: Mesh): number {
    // 导入模型无显式垄向元数据时，取 X 向尺寸的 1/40 作为默认垄距
    void mesh;
    const size = store.roofStats?.size[0] ?? 20;
    return Math.max(0.25, size / 40);
  }

  private applyRoofMaterial(mesh: Mesh, procedural: boolean) {
    const mat = new StandardMaterial(
      procedural ? "roof-mat-procedural" : "roof-mat-imported",
      this.scene
    );
    if (procedural) {
      // 瓦垄质感：程序化条纹纹理
      const tex = new Texture(
        this.makeTileTextureDataUrl(),
        this.scene,
        false,
        false,
        Texture.LINEAR_LINEAR
      );
      tex.uScale = 10;
      tex.vScale = 6;
      mat.diffuseTexture = tex;
      mat.specularColor = new Color3(0.08, 0.08, 0.08);
    } else {
      mat.diffuseColor = new Color3(0.62, 0.52, 0.42);
      mat.specularColor = new Color3(0.05, 0.05, 0.05);
    }
    mesh.material = mat;
    // 屋面本身写深度，残损层的深度预通道与之配合
  }

  private makeTileTextureDataUrl(): string {
    const c = document.createElement("canvas");
    c.width = 128;
    c.height = 128;
    const ctx = c.getContext("2d")!;
    const grad = ctx.createLinearGradient(0, 0, 128, 0);
    grad.addColorStop(0, "#7d6a52");
    grad.addColorStop(0.5, "#9a8468");
    grad.addColorStop(1, "#7d6a52");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
    ctx.strokeStyle = "rgba(40,30,22,0.55)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, 128);
    ctx.moveTo(128, 0);
    ctx.lineTo(128, 128);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,240,220,0.18)";
    ctx.lineWidth = 1;
    for (let y = 16; y < 128; y += 32) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(128, y);
      ctx.stroke();
    }
    return c.toDataURL();
  }

  private rebuildReferences() {
    this.ridgeLines?.dispose();
    this.slopeLines?.dispose();
    const refs = buildReferenceLines(this.scene, this.surface);
    this.ridgeLines = refs.ridgeLines;
    this.slopeLines = refs.slopeLines;
    this.ridgeLines.setEnabled(store.refLinesVisible);
    this.slopeLines.setEnabled(store.refLinesVisible);
  }

  private replaceLayerSurface() {
    // DamageLayer 的 surface 为构造期注入，这里重建实例以保持状态干净
    const patches = [...store.patches];
    this.layer.dispose();
    this.layer = new DamageLayer(
      this.scene,
      this.surface,
      () => store.lift,
      () => store.opacity
    );
    this.layer.setOpacity(store.opacity);
    this.layer.setDepthPrePass(store.depthPrePass);
    this.layer.setDoubleSided(store.doubleSided);
    this.layer.setWireframe(store.wireframe);
    this.layer.setOutlinesVisible(true);
    if (patches.length > 0) {
      const ms = this.layer.rebuild(patches);
      this.syncPerf(ms, store.perf.projectMs);
    }
  }

  private frameCameraTo(mesh: Mesh) {
    mesh.refreshBoundingInfo();
    const center = mesh.getBoundingInfo().boundingBox.center;
    const radius =
      mesh.getBoundingInfo().boundingBox.extendSize.length() * 2.4 + 4;
    this.camera.target = center.clone();
    this.camera.radius = Math.min(80, Math.max(12, radius));
  }

  // ---------- 模块二：残损面片贴合（绘制交互） ----------

  private bindPointerEvents() {
    this.scene.onPointerObservable.add((info) => {
      if (!store.drawMode) return;
      if (info.type === PointerEventTypes.POINTERDOWN) {
        if (info.event.button !== 0) return;
        this.drawing = true;
        this.currentStroke = [];
        this.camera.detachControl();
        this.appendStrokePoint();
      } else if (
        info.type === PointerEventTypes.POINTERMOVE &&
        this.drawing
      ) {
        this.appendStrokePoint();
      } else if (
        info.type === PointerEventTypes.POINTERUP &&
        this.drawing
      ) {
        this.drawing = false;
        this.camera.attachControl(this.canvas, true);
        this.finishStroke();
      }
    });
  }

  private appendStrokePoint() {
    const pick = this.scene.pick(
      this.scene.pointerX,
      this.scene.pointerY,
      (m) => m === this.roof
    );
    if (!pick?.hit || !pick.pickedPoint) return;
    const last = this.currentStroke[this.currentStroke.length - 1];
    const p = pick.pickedPoint;
    if (!last || Vector3.DistanceSquared(last, p) > 0.09) {
      this.currentStroke.push(p.clone());
      this.updateStrokePreview();
    }
  }

  private updateStrokePreview() {
    if (this.currentStroke.length < 2) return;
    const preview = this.strokePreview;
    preview?.dispose();
    this.strokePreview = CreateLines(
      "stroke-preview",
      { points: this.currentStroke, updatable: false },
      this.scene
    );
    this.strokePreview.color = new Color3(1, 1, 1);
    this.strokePreview.isPickable = false;
  }

  private finishStroke() {
    this.strokePreview?.dispose();
    this.strokePreview = null;
    if (this.currentStroke.length < 3) {
      setStatus("轮廓点不足 3 个，已取消本次绘制");
      this.currentStroke = [];
      return;
    }
    const t0 = performance.now();
    try {
      const patch = this.layer.createPatch(
        this.currentStroke,
        store.defaultSeverity
      );
      store.patches.push(patch);
      store.selectedPatchId = patch.id;
      const rebuildMs = this.layer.rebuild(store.patches);
      const projectMs = performance.now() - t0;
      this.syncPerf(rebuildMs, projectMs);
      setStatus(
        `已生成残损面片「${patch.name}」，面积 ${patch.area.toFixed(2)} ㎡`
      );
    } catch (e) {
      setStatus(`面片生成失败：${(e as Error).message}`);
    }
    this.currentStroke = [];
  }

  /** 压力测试：批量生成上千随机残损面片 */
  generateStressPatches(count: number) {
    store.busy = true;
    setTimeout(() => {
      const t0 = performance.now();
      const b = this.surface.bounds;
      const margin = 0.8;
      let made = 0;
      let guard = 0;
      while (made < count && guard < count * 6) {
        guard++;
        const cx = rand(b.minX + margin, b.maxX - margin);
        const cz = rand(b.minZ + margin, b.maxZ - margin);
        const r = rand(0.25, 0.9);
        const verts = 5 + Math.floor(rand(0, 4));
        const outline: Vector3[] = [];
        let valid = true;
        for (let i = 0; i < verts; i++) {
          const ang = (i / verts) * Math.PI * 2;
          const rr = r * rand(0.7, 1.25);
          const x = cx + Math.cos(ang) * rr;
          const z = cz + Math.sin(ang) * rr;
          const pr = this.surface.project(x, z);
          if (!pr.hit) {
            valid = false;
            break;
          }
          outline.push(pr.point.clone());
        }
        if (!valid) continue;
        try {
          const patch = this.layer.createPatch(
            outline,
            rand(0.05, 1)
          );
          store.patches.push(patch);
          made++;
        } catch {
          // 跳过退化轮廓
        }
      }
      const rebuildMs = this.layer.rebuild(store.patches);
      const total = performance.now() - t0;
      this.syncPerf(rebuildMs, total);
      store.busy = false;
      setStatus(`压力测试：生成 ${made} 个残损面片，总耗时 ${total.toFixed(1)} ms`);
    }, 30);
  }

  // ---------- 模块三/四：渲染参数与等级 ----------

  rebuildLayerGeometry() {
    const ms = this.layer.rebuild(store.patches);
    this.syncPerf(ms, store.perf.projectMs);
  }

  rebuildLayerColors() {
    const ms = this.layer.rebuildColors(store.patches);
    this.syncPerf(ms, store.perf.projectMs);
  }

  applyLift() {
    this.rebuildLayerGeometry();
  }

  applyOpacity() {
    this.layer.setOpacity(store.opacity);
  }

  applyDepthPrePass() {
    this.layer.setDepthPrePass(store.depthPrePass);
  }

  applyDoubleSided() {
    this.layer.setDoubleSided(store.doubleSided);
  }

  applyWireframe() {
    this.layer.setWireframe(store.wireframe);
  }

  applyRefLines() {
    this.ridgeLines?.setEnabled(store.refLinesVisible);
    this.slopeLines?.setEnabled(store.refLinesVisible);
  }

  setDrawMode(on: boolean) {
    store.drawMode = on;
    this.canvas.style.cursor = on ? "crosshair" : "";
    if (!on && this.strokePreview) {
      this.strokePreview.dispose();
      this.strokePreview = null;
      this.drawing = false;
      this.currentStroke = [];
    }
  }

  deleteSelected() {
    if (store.selectedPatchId == null) return;
    const idx = store.patches.findIndex(
      (p) => p.id === store.selectedPatchId
    );
    if (idx >= 0) {
      store.patches.splice(idx, 1);
      store.selectedPatchId = null;
      this.rebuildLayerGeometry();
    }
  }

  clearAll() {
    store.patches.splice(0, store.patches.length);
    store.selectedPatchId = null;
    this.rebuildLayerGeometry();
  }

  setManualGrade(patchId: number, grade: number | null) {
    const patch = store.patches.find((p) => p.id === patchId);
    if (!patch) return;
    patch.manualGrade = grade as DamagePatchData["manualGrade"];
    this.rebuildLayerColors();
  }

  // ---------- 导入 / 导出 ----------

  exportLayerFile(): DamageLayerFile {
    return {
      format: "roof-damage-layer",
      version: 1,
      exportedAt: new Date().toISOString(),
      lift: store.lift,
      opacity: store.opacity,
      thresholds: [...store.thresholds] as [number, number],
      coordinateSystem: "world",
      patches: JSON.parse(JSON.stringify(store.patches)),
    };
  }

  async importLayerFile(file: File) {
    const text = await file.text();
    const data = JSON.parse(text) as DamageLayerFile;
    if (data.format !== "roof-damage-layer") {
      throw new Error("图层文件格式不匹配");
    }
    store.patches.splice(0, store.patches.length, ...data.patches);
    store.lift = data.lift;
    store.opacity = data.opacity;
    store.thresholds = [...data.thresholds] as [number, number];
    this.layer.setOpacity(store.opacity);
    const ms = this.layer.rebuild(store.patches);
    this.syncPerf(ms, 0);
    setStatus(`已导入图层：${data.patches.length} 个残损面片`);
  }

  // ---------- 性能读数 ----------

  private syncPerf(rebuildMs: number, projectMs: number) {
    store.perf.patchCount = store.patches.length;
    store.perf.layerTriangles = this.layer.layerTriangleCount;
    store.perf.rebuildMs = rebuildMs;
    if (projectMs > 0) store.perf.projectMs = projectMs;
  }

  private startRenderLoop() {
    if (this.rafLoop) return;
    this.rafLoop = true;
    this.lastFrameTime = performance.now();
    this.engine.runRenderLoop(() => {
      const now = performance.now();
      const dt = now - this.lastFrameTime;
      this.lastFrameTime = now;
      this.frameSamples.push(dt);
      if (this.frameSamples.length > 60) this.frameSamples.shift();
      this.scene.render();
      // 每 15 帧刷新一次 HUD 读数
      if (this.frameSamples.length % 15 === 0) {
        const avg =
          this.frameSamples.reduce((a, b) => a + b, 0) /
          this.frameSamples.length;
        store.perf.frameMs = avg;
        store.perf.fps = avg > 0 ? 1000 / avg : 0;
        store.perf.drawCalls =
          (this.engine as unknown as { _drawCalls?: { current: number } })
            ._drawCalls?.current ?? 0;
      }
    });
  }

  dispose() {
    this.engine.stopRenderLoop();
    this.scene.dispose();
    this.engine.dispose();
    this.rafLoop = false;
  }
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}
