import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { BloomEffect, EffectComposer, EffectPass, RenderPass } from 'postprocessing';
import { watch } from 'vue';
import { ROOM, RACKS, rackBoxes, nozzleDir } from '../core/config';
import { store } from '../core/store';
import { HumidityField } from '../core/humidity';
import { makeGroundMaterial } from './groundMaterial';
import { NozzleVisual } from './NozzleVisual';

const TOP_VIEW = { pos: new THREE.Vector3(0, 17.5, 0.02), tg: new THREE.Vector3(0, 0, 0) };
const SIDE_VIEW = { pos: new THREE.Vector3(0, 2.6, 16), tg: new THREE.Vector3(0, 1.3, 0) };

interface DragState {
  type: 'move' | 'dir' | 'spread';
  id: number;
  plane: THREE.Plane;
}

export class SceneManager {
  private canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private composer: EffectComposer;
  private field: HumidityField;
  private humTex: THREE.DataTexture;
  private occTex: THREE.DataTexture;
  private groundMat: THREE.ShaderMaterial;
  private visuals = new Map<number, NozzleVisual>();
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private drag: DragState | null = null;
  private downPos: { x: number; y: number } | null = null;
  private clock = new THREE.Clock();
  private viewAnim: {
    t: number;
    fp: THREE.Vector3; tp: THREE.Vector3;
    ft: THREE.Vector3; tt: THREE.Vector3;
  } | null = null;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.scene.background = new THREE.Color(0x0b0e14);
    this.scene.fog = new THREE.Fog(0x0b0e14, 28, 65);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 120);
    this.camera.position.copy(TOP_VIEW.pos);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.copy(TOP_VIEW.tg);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.maxDistance = 45;

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const dl = new THREE.DirectionalLight(0xffffff, 1.1);
    dl.position.set(6, 12, 4);
    this.scene.add(dl);

    // ---- 菇架（层板为遮挡体） ----
    const boxes = rackBoxes();
    const boardMat = new THREE.MeshStandardMaterial({ color: 0x8a7f6a, roughness: 0.9 });
    for (const b of boxes) {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]),
        boardMat,
      );
      m.position.set(
        (b.min[0] + b.max[0]) / 2,
        (b.min[1] + b.max[1]) / 2,
        (b.min[2] + b.max[2]) / 2,
      );
      this.scene.add(m);
    }
    // 架体立柱（仅装饰）
    const postMat = new THREE.MeshStandardMaterial({ color: 0x5c5546, roughness: 0.8 });
    const topLayer = RACKS.layers[RACKS.layers.length - 1];
    for (const z of RACKS.rows) {
      for (const x of [-RACKS.length / 2, RACKS.length / 2]) {
        for (const dz of [-RACKS.width / 2, RACKS.width / 2]) {
          const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, topLayer, 0.08), postMat);
          post.position.set(x, topLayer / 2, z + dz);
          this.scene.add(post);
        }
      }
    }

    // ---- 湿度场与地面 ----
    this.field = new HumidityField(boxes);
    this.field.occlusionEnabled = store.showOcclusion;

    this.humTex = new THREE.DataTexture(this.field.total, this.field.w, this.field.h, THREE.RedFormat, THREE.FloatType);
    this.occTex = new THREE.DataTexture(this.field.occl, this.field.w, this.field.h, THREE.RedFormat, THREE.UnsignedByteType);
    this.occTex.unpackAlignment = 1;
    const gl = this.renderer.getContext();
    const floatLinear = !!gl.getExtension('OES_texture_float_linear');
    this.humTex.magFilter = floatLinear ? THREE.LinearFilter : THREE.NearestFilter;
    this.humTex.minFilter = floatLinear ? THREE.LinearFilter : THREE.NearestFilter;
    this.occTex.magFilter = THREE.LinearFilter;
    this.occTex.minFilter = THREE.LinearFilter;

    this.groundMat = makeGroundMaterial(this.humTex, this.occTex);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.width, ROOM.depth), this.groundMat);
    ground.rotation.x = -Math.PI / 2;
    this.scene.add(ground);

    // ---- 后处理：Bloom 让雾锥叠加区域亮度累加发光 ----
    this.composer = new EffectComposer(this.renderer, { multisampling: 4 });
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    const bloom = new BloomEffect({
      mipmapBlur: true,
      luminanceThreshold: 0.22,
      luminanceSmoothing: 0.35,
      intensity: 1.5,
    });
    this.composer.addPass(new EffectPass(this.camera, bloom));

    // ---- 事件 ----
    canvas.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);

    // ---- 状态监听 ----
    watch(() => store.nozzles.length, () => this.rebuildVisuals());
    watch(() => store.view, () => this.applyView());
    watch(() => store.showOcclusion, (v) => {
      this.field.occlusionEnabled = v;
      this.groundMat.uniforms.uShowOcc.value = v ? 1 : 0;
      this.recalcAll();
    });
    watch(() => store.threshold, (v) => {
      this.groundMat.uniforms.uThreshold.value = v;
      this.refreshGlobalStats();
    });
    watch(() => store.selectedId, () => this.applySelection());

    this.rebuildVisuals();
    this.loop();
  }

  setSize(w: number, h: number) {
    if (w === 0 || h === 0) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.composer.setSize(w, h);
  }

  // ---------- 喷头可视对象 ----------

  private rebuildVisuals() {
    const ids = new Set(store.nozzles.map((n) => n.id));
    for (const [id, v] of this.visuals) {
      if (!ids.has(id)) {
        this.scene.remove(v.group);
        v.dispose();
        this.visuals.delete(id);
      }
    }
    for (const n of store.nozzles) {
      let v = this.visuals.get(n.id);
      if (!v) {
        v = new NozzleVisual(n);
        v.setLayerLinesVisible(store.view === 'side');
        this.visuals.set(n.id, v);
        this.scene.add(v.group);
      }
      v.sync(n);
    }
    this.recalcAll();
    this.applySelection();
  }

  private recalcAll() {
    store.stats = this.field.recomputeAll(store.nozzles);
    this.humTex.needsUpdate = true;
    this.occTex.needsUpdate = true;
    this.refreshGlobalStats();
  }

  /** 增量更新：只重算该喷头的覆盖贡献（拖动时调用） */
  updateNozzle(id: number) {
    const n = store.nozzles.find((x) => x.id === id);
    if (!n) return;
    this.visuals.get(id)?.sync(n);
    store.stats = this.field.updateNozzle(n, store.nozzles);
    this.humTex.needsUpdate = true;
    this.occTex.needsUpdate = true;
    this.refreshGlobalStats();
  }

  private refreshGlobalStats() {
    const g = this.field.globalStats(store.threshold);
    store.coverage = g.coverage;
    store.saturated = g.saturated;
  }

  private applySelection() {
    const sel = store.selectedId;
    for (const [id, v] of this.visuals) {
      v.setDimmed(sel >= 0 && id !== sel);
      v.setSelected(id === sel);
    }
  }

  private applyView(immediate = false) {
    const v = store.view === 'top' ? TOP_VIEW : SIDE_VIEW;
    const showLines = store.view === 'side';
    for (const vis of this.visuals.values()) vis.setLayerLinesVisible(showLines);
    // 重新 sync 以刷新交线可见性
    for (const n of store.nozzles) this.visuals.get(n.id)?.sync(n);
    if (immediate) {
      this.camera.position.copy(v.pos);
      this.controls.target.copy(v.tg);
      return;
    }
    this.viewAnim = {
      t: 0,
      fp: this.camera.position.clone(), tp: v.pos.clone(),
      ft: this.controls.target.clone(), tt: v.tg.clone(),
    };
  }

  // ---------- 交互 ----------

  private setPointer(e: PointerEvent) {
    const r = this.canvas.getBoundingClientRect();
    this.pointer.set(
      ((e.clientX - r.left) / r.width) * 2 - 1,
      -((e.clientY - r.top) / r.height) * 2 + 1,
    );
  }

  private pick(e: PointerEvent): { type: 'move' | 'dir' | 'spread'; id: number } | null {
    this.setPointer(e);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const meshes: THREE.Object3D[] = [];
    for (const v of this.visuals.values()) v.pickables(meshes);
    const hits = this.raycaster.intersectObjects(meshes, false).filter((h) => h.object.visible);
    if (!hits.length) return null;
    // 手柄优先于本体（距离接近时）
    const first = hits[0];
    const handle = hits.find(
      (h) => h.object.userData.drag !== 'move' && h.distance - first.distance < 0.6,
    );
    const chosen = handle ?? first;
    return { type: chosen.object.userData.drag, id: chosen.object.userData.nozzleId };
  }

  private onDown = (e: PointerEvent) => {
    this.downPos = { x: e.clientX, y: e.clientY };
    const p = this.pick(e);
    if (!p) return;
    const n = store.nozzles.find((x) => x.id === p.id);
    if (!n) return;
    this.controls.enabled = false;
    let plane: THREE.Plane;
    if (p.type === 'move') {
      plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -n.y);
    } else {
      const nrm = new THREE.Vector3();
      this.camera.getWorldDirection(nrm);
      plane = new THREE.Plane().setFromNormalAndCoplanarPoint(nrm, new THREE.Vector3(n.x, n.y, n.z));
    }
    this.drag = { type: p.type, id: p.id, plane };
    store.selectedId = p.id;
    this.canvas.style.cursor = 'grabbing';
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  };

  private onMove = (e: PointerEvent) => {
    if (!this.drag) {
      this.canvas.style.cursor = this.pick(e) ? 'grab' : '';
      return;
    }
    this.setPointer(e);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const pt = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.drag.plane, pt)) return;
    const n = store.nozzles.find((x) => x.id === this.drag!.id);
    if (!n) return;

    if (this.drag.type === 'move') {
      n.x = THREE.MathUtils.clamp(pt.x, -ROOM.width / 2 + 0.3, ROOM.width / 2 - 0.3);
      n.z = THREE.MathUtils.clamp(pt.z, -ROOM.depth / 2 + 0.3, ROOM.depth / 2 - 0.3);
    } else if (this.drag.type === 'dir') {
      const v = pt.sub(new THREE.Vector3(n.x, n.y, n.z));
      if (v.length() > 0.25) {
        v.normalize();
        const tilt = Math.min(Math.acos(THREE.MathUtils.clamp(-v.y, -1, 1)), THREE.MathUtils.degToRad(60));
        n.tilt = THREE.MathUtils.radToDeg(tilt);
        n.azimuth = THREE.MathUtils.radToDeg(Math.atan2(v.x, v.z));
      }
    } else {
      const d = nozzleDir(n);
      const v = pt.sub(new THREE.Vector3(n.x, n.y, n.z));
      if (v.length() > 0.2) {
        const ang = v.angleTo(new THREE.Vector3(d.x, d.y, d.z));
        n.spread = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(ang), 8, 55);
      }
    }
    this.updateNozzle(n.id);
  };

  private onUp = (e: PointerEvent) => {
    this.canvas.style.cursor = '';
    if (this.drag) {
      this.drag = null;
      this.controls.enabled = true;
    } else if (this.downPos && Math.hypot(e.clientX - this.downPos.x, e.clientY - this.downPos.y) < 5) {
      store.selectedId = -1; // 点击空白处取消选中
    }
    this.downPos = null;
  };

  // ---------- 导出 ----------

  exportJSON() {
    const data = {
      exportedAt: new Date().toISOString(),
      room: ROOM,
      threshold: store.threshold,
      occlusionEnabled: store.showOcclusion,
      nozzles: store.nozzles.map((n) => ({ ...n })),
      grid: {
        width: this.field.w,
        height: this.field.h,
        origin: [-ROOM.width / 2, -ROOM.depth / 2],
        cellSize: [ROOM.width / this.field.w, ROOM.depth / this.field.h],
        humidity: Array.from(this.field.total, (v) => Math.round(v * 1000) / 1000),
      },
    };
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'spray-coverage.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // ---------- 主循环 ----------

  private loop = () => {
    if (this.disposed) return;
    requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 0.1);
    const t = this.clock.elapsedTime;
    this.groundMat.uniforms.uTime.value = t;
    for (const v of this.visuals.values()) v.tick(t);

    if (this.viewAnim) {
      const a = this.viewAnim;
      a.t = Math.min(1, a.t + dt * 1.6);
      const s = a.t * a.t * (3 - 2 * a.t);
      this.camera.position.lerpVectors(a.fp, a.tp, s);
      this.controls.target.lerpVectors(a.ft, a.tt, s);
      if (a.t >= 1) this.viewAnim = null;
    }

    this.controls.update();
    this.composer.render();
  };

  dispose() {
    this.disposed = true;
    this.canvas.removeEventListener('pointerdown', this.onDown);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    for (const v of this.visuals.values()) v.dispose();
    this.composer.dispose();
    this.renderer.dispose();
  }
}
