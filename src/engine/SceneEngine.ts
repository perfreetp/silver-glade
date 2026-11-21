import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { buildCar, type CarBuild } from '../wheel/carBuilder';
import { buildWheel } from '../wheel/wheelGenerator';
import { buildSectionGroup, disposeSectionGroup } from '../wheel/section';
import { initBVH, measureWheelClearance } from '../wheel/clearance';
import {
  BODY_HALF_WIDTH,
  WHEEL_POSITIONS,
  tireOuterRadius,
} from '../constants';
import type { ClearanceMap, WheelConfig, WheelId } from '../types';
import { WHEEL_IDS } from '../types';
import { DEFAULT_CONFIG } from '../constants';
import { setClearance, setMeasuring } from '../store';

interface WheelSlot {
  slot: THREE.Group;
  current: WheelConfig;
  dispose: (() => void) | null;
}

const BG_COLOR = 0x0f141b;

/** three.js 场景引擎：固定车身、四车轮装配、聚焦截面、警示环与间隙重算调度 */
export class SceneEngine {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private car: CarBuild;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private downPos = { x: 0, y: 0 };

  private slots = new Map<WheelId, WheelSlot>();
  private selected: WheelId = 'FL';
  private focused = false;
  private section: THREE.Group | null = null;

  private marker: THREE.Mesh;
  private gapMarkers = new Map<WheelId, THREE.Mesh>();
  private ringMaterials = new Map<WheelId, THREE.MeshStandardMaterial>();

  private clearanceDirty = false;
  private raf = 0;
  private resizeObserver: ResizeObserver;
  private pickHandler: ((id: WheelId) => void) | null = null;
  private tween: {
    fromPos: THREE.Vector3;
    toPos: THREE.Vector3;
    fromTarget: THREE.Vector3;
    toTarget: THREE.Vector3;
    t: number;
    dur: number;
  } | null = null;
  private clock = new THREE.Clock();

  constructor(container: HTMLElement) {
    this.container = container;
    initBVH();

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(BG_COLOR);
    this.scene.fog = new THREE.Fog(BG_COLOR, 9, 24);

    this.camera = new THREE.PerspectiveCamera(
      45,
      container.clientWidth / container.clientHeight,
      0.05,
      100,
    );
    this.camera.position.set(3.6, 2.1, 4.4);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.target.set(0, 0.55, 0);
    this.controls.maxPolarAngle = Math.PI * 0.55;
    this.controls.minDistance = 0.6;
    this.controls.maxDistance = 12;
    this.controls.addEventListener('start', () => {
      this.tween = null; // 用户拖动时取消相机过渡
    });

    this.setupLights();
    this.setupGround();

    this.car = buildCar();
    this.scene.add(this.car.group);
    // 构建轮拱内表面 BVH（间隙检测基准）
    (this.car.archMesh.geometry as unknown as { computeBoundsTree: () => void }).computeBoundsTree();

    // 四个轮位的空槽（初始配置，随后由 store 同步覆盖）
    for (const id of WHEEL_IDS) {
      const slot = new THREE.Group();
      const p = WHEEL_POSITIONS[id];
      slot.position.set(p.x, p.y, p.z);
      this.scene.add(slot);
      this.slots.set(id, { slot, current: { ...DEFAULT_CONFIG }, dispose: null });

      const ringMat = (this.car.fenderRings[id].material as THREE.MeshStandardMaterial).clone();
      this.car.fenderRings[id].material = ringMat;
      this.ringMaterials.set(id, ringMat);

      const gapMarker = new THREE.Mesh(
        new THREE.SphereGeometry(0.014, 16, 12),
        new THREE.MeshBasicMaterial({ color: 0x22c55e }),
      );
      gapMarker.visible = false;
      this.scene.add(gapMarker);
      this.gapMarkers.set(id, gapMarker);
    }

    // 当前选中轮位的高亮标记
    this.marker = new THREE.Mesh(
      new THREE.TorusGeometry(0.05, 0.006, 8, 32),
      new THREE.MeshBasicMaterial({ color: 0x38bdf8 }),
    );
    this.marker.rotation.x = Math.PI / 2;
    this.scene.add(this.marker);
    this.updateMarker();

    // 初始装配
    for (const id of WHEEL_IDS) this.rebuildWheel(id);

    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(container);
    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.addEventListener('pointerup', this.onPointerUp);

    this.scheduleClearance();
    this.animate();
  }

  onPick(cb: (id: WheelId) => void): void {
    this.pickHandler = cb;
  }

  private setupLights(): void {
    this.scene.add(new THREE.HemisphereLight(0xbfd6ff, 0x2a2f38, 1.1));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(4, 6, 3);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x8fb4ff, 0.8);
    fill.position.set(-5, 3, -4);
    this.scene.add(fill);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.25));
  }

  private setupGround(): void {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(30, 30),
      new THREE.MeshStandardMaterial({ color: 0x171d26, roughness: 0.95, metalness: 0.05 }),
    );
    ground.rotation.x = -Math.PI / 2;
    this.scene.add(ground);
    const grid = new THREE.GridHelper(30, 30, 0x2c3744, 0x1f2833);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.5;
    this.scene.add(grid);
  }

  /** 轮位世界中心（偏距沿车轴方向作用） */
  private wheelCenter(id: WheelId, cfg: WheelConfig): THREE.Vector3 {
    const base = WHEEL_POSITIONS[id];
    const sign = base.z >= 0 ? 1 : -1;
    return new THREE.Vector3(base.x, base.y, base.z + sign * cfg.offset);
  }

  /** 设置某轮位配置：重新生成参数化轮毂并立即装配，随后调度四轮间隙重算 */
  setConfig(id: WheelId, cfg: WheelConfig): void {
    const entry = this.slots.get(id)!;
    entry.current = cfg;
    entry.slot.position.copy(this.wheelCenter(id, cfg));
    this.rebuildWheel(id);
    if (this.focused && this.selected === id) this.refreshSection();
    this.scheduleClearance();
  }

  private rebuildWheel(id: WheelId): void {
    const entry = this.slots.get(id)!;
    // 清空旧轮毂
    while (entry.slot.children.length) entry.slot.remove(entry.slot.children[0]);
    entry.dispose?.();
    const { group, dispose } = buildWheel(entry.current);
    entry.slot.add(group);
    entry.dispose = dispose;
  }

  setSelected(id: WheelId): void {
    this.selected = id;
    this.updateMarker();
    if (this.focused) this.refreshSection();
  }

  private updateMarker(): void {
    const entry = this.slots.get(this.selected)!;
    this.marker.position.set(
      entry.slot.position.x,
      entry.slot.position.y + 0.02,
      entry.slot.position.z,
    );
    this.marker.visible = !this.focused;
  }

  /** 切换单轮聚焦 / 整车视角 */
  setFocus(focused: boolean): void {
    this.focused = focused;
    this.updateMarker();
    if (focused) {
      this.refreshSection();
      const c = this.slots.get(this.selected)!.slot.position;
      const sideSign = c.z >= 0 ? 1 : -1;
      this.tweenCamera(
        new THREE.Vector3(c.x + 0.4, c.y + 0.22, c.z + 1.15 * sideSign),
        c.clone(),
      );
    } else {
      this.removeSection();
      this.tweenCamera(new THREE.Vector3(3.6, 2.1, 4.4), new THREE.Vector3(0, 0.55, 0));
    }
    for (const [id, m] of this.gapMarkers) m.visible = focused ? id === this.selected : true;
  }

  private refreshSection(): void {
    this.removeSection();
    const entry = this.slots.get(this.selected)!;
    const radius = tireOuterRadius(entry.current.rimDiameter);
    this.section = buildSectionGroup(entry.slot.position.clone(), radius);
    this.scene.add(this.section);
  }

  private removeSection(): void {
    if (!this.section) return;
    this.scene.remove(this.section);
    disposeSectionGroup(this.section);
    this.section = null;
  }

  private tweenCamera(toPos: THREE.Vector3, toTarget: THREE.Vector3, dur = 0.45): void {
    this.tween = {
      fromPos: this.camera.position.clone(),
      toPos,
      fromTarget: this.controls.target.clone(),
      toTarget,
      t: 0,
      dur,
    };
  }

  private scheduleClearance(): void {
    this.clearanceDirty = true;
  }

  /** 四个轮位全部重算（BVH 射线检测，逐帧调度一次执行） */
  private runClearance(): void {
    setMeasuring(true);
    const results = {} as ClearanceMap;
    for (const id of WHEEL_IDS) {
      const entry = this.slots.get(id)!;
      const center = entry.slot.position.clone();
      const tireRadius = tireOuterRadius(entry.current.rimDiameter);
      results[id] = measureWheelClearance({ id, archMesh: this.car.archMesh, center, tireRadius });
      setClearance(id, results[id]);
    }
    this.updateWarnings(results);
    setMeasuring(false);
  }

  /** 根据检测结果更新翼子板警示环与最小间隙标记点 */
  private updateWarnings(results: ClearanceMap): void {
    for (const id of WHEEL_IDS) {
      const r = results[id];
      const mat = this.ringMaterials.get(id)!;
      if (r.status === 'collision') {
        mat.color.set(0xef4444);
        mat.emissive.set(0x7f1d1d);
        mat.emissiveIntensity = 0.9;
      } else if (r.status === 'warn') {
        mat.color.set(0xf59e0b);
        mat.emissive.set(0x78350f);
        mat.emissiveIntensity = 0.5;
      } else {
        mat.color.set(0x20242a);
        mat.emissive.set(0x000000);
        mat.emissiveIntensity = 0;
      }

      const marker = this.gapMarkers.get(id)!;
      if (r.point) {
        marker.position.set(...r.point);
        (marker.material as THREE.MeshBasicMaterial).color.set(
          r.status === 'collision' ? 0xef4444 : r.status === 'warn' ? 0xf59e0b : 0x22c55e,
        );
        marker.visible = this.focused ? id === this.selected : true;
      } else {
        marker.visible = false;
      }
    }
  }

  private onPointerDown = (e: PointerEvent): void => {
    this.downPos = { x: e.clientX, y: e.clientY };
  };

  private onPointerUp = (e: PointerEvent): void => {
    const moved = Math.hypot(e.clientX - this.downPos.x, e.clientY - this.downPos.y);
    if (moved > 5) return; // 拖动旋转不触发拾取
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const groups = WHEEL_IDS.map((id) => this.slots.get(id)!.slot);
    const hits = this.raycaster.intersectObjects(groups, true);
    if (hits.length) {
      let obj: THREE.Object3D | null = hits[0].object;
      while (obj && !groups.includes(obj as THREE.Group)) obj = obj.parent;
      if (obj) {
        const id = WHEEL_IDS.find((w) => this.slots.get(w)!.slot === obj);
        if (id && this.pickHandler) this.pickHandler(id);
      }
    }
  };

  private handleResize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w === 0 || h === 0) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  private animate = (): void => {
    this.raf = requestAnimationFrame(this.animate);
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const elapsed = this.clock.elapsedTime;

    if (this.tween) {
      this.tween.t += dt;
      const k = Math.min(this.tween.t / this.tween.dur, 1);
      const ease = 1 - Math.pow(1 - k, 3);
      this.camera.position.lerpVectors(this.tween.fromPos, this.tween.toPos, ease);
      this.controls.target.lerpVectors(this.tween.fromTarget, this.tween.toTarget, ease);
      if (k >= 1) this.tween = null;
    }

    // 越界警示环脉冲
    for (const id of WHEEL_IDS) {
      const ring = this.car.fenderRings[id];
      const mat = this.ringMaterials.get(id)!;
      if (mat.emissiveIntensity > 0.6) {
        ring.scale.setScalar(1 + 0.035 * Math.sin(elapsed * 7));
      } else {
        ring.scale.setScalar(1);
      }
    }

    if (this.clearanceDirty) {
      this.clearanceDirty = false;
      this.runClearance();
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    this.renderer.domElement.removeEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.removeEventListener('pointerup', this.onPointerUp);
    this.controls.dispose();
    this.removeSection();
    for (const entry of this.slots.values()) entry.dispose?.();
    (this.car.archMesh.geometry as unknown as { disposeBoundsTree?: () => void }).disposeBoundsTree?.();
    this.car.dispose();
    for (const m of this.gapMarkers.values()) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    this.marker.geometry.dispose();
    (this.marker.material as THREE.Material).dispose();
    for (const mat of this.ringMaterials.values()) mat.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

export { BODY_HALF_WIDTH };
