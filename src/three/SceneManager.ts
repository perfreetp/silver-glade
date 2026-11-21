import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FIXED_DT, PARTICLE, TERRAIN } from '../core/constants';
import type { EventBus } from '../core/EventBus';
import type { MachineManager } from '../core/MachineManager';
import type { SnowField } from '../core/SnowField';
import type { ParticleSystem } from '../core/ParticleSystem';
import type { TrajectoryPreview } from '../core/TrajectoryPreview';
import { MachineView } from './MachineView';
import { createTerrainMaterial, setNightMode, type TerrainMaterials } from '../core/terrainShaders';
import { clamp, terrainHeight, windVector, yawToVector } from '../core/mathUtils';
import type { SimStats } from '../core/types';

/** 线性 HDR -> ACES 色调映射 -> sRGB，作为后期链最后一个 pass */
const ToneMapShader = {
  uniforms: { tDiffuse: { value: null as THREE.Texture | null }, exposure: { value: 1.05 } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float exposure;
    varying vec2 vUv;
    vec3 aces(vec3 x) {
      const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
      return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
    }
    void main() {
      vec3 col = texture2D(tDiffuse, vUv).rgb * exposure;
      col = aces(col);
      col = pow(col, vec3(1.0 / 2.2));
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

/**
 * 3D 场景总控：渲染管线、昼夜灯光 + 辉光后期、拾取/拖拽交互、固定步长仿真循环。
 */
export class SceneManager {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private mats: TerrainMaterials;

  private hemi: THREE.HemisphereLight;
  private sun: THREE.DirectionalLight;
  private moon: THREE.DirectionalLight;
  private nightLamp: THREE.PointLight;

  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private dragId: number | null = null;
  private pointerDown = false;
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  private windArrows = new THREE.Group();
  private yawArrow: THREE.ArrowHelper;
  private windArrow: THREE.ArrowHelper;

  private accumulator = 0;
  private lastTime = 0;
  private raf = 0;
  private running = true;
  private night = false;
  private timeScale = 1;
  private statTimer = 0;
  private frameCount = 0;
  private fps = 60;
  private disposed = false;

  constructor(
    private container: HTMLElement,
    private bus: EventBus,
    private manager: MachineManager,
    private snowField: SnowField,
    private particles: ParticleSystem,
    private trajectory: TrajectoryPreview,
    private machineView: MachineView,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // 色调映射与 sRGB 转换由后期链末尾的 ToneMapShader 统一处理，渲染目标保持线性
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0xbcd8ee);
    this.scene.fog = new THREE.Fog(0xbcd8ee, 90, 230);

    this.camera = new THREE.PerspectiveCamera(55, container.clientWidth / container.clientHeight, 0.1, 600);
    this.camera.position.set(34, 24, 78);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, -6, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.minDistance = 12;
    this.controls.maxDistance = 220;

    // 灯光
    this.hemi = new THREE.HemisphereLight(0xdfefff, 0x5a6b54, 0.95);
    this.sun = new THREE.DirectionalLight(0xfff2d8, 2.0);
    this.sun.position.set(-38, 70, 30);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.left = -70;
    this.sun.shadow.camera.right = 70;
    this.sun.shadow.camera.top = 80;
    this.sun.shadow.camera.bottom = -80;
    this.sun.shadow.camera.far = 220;

    this.moon = new THREE.DirectionalLight(0x9db8ff, 0.55);
    this.moon.position.set(30, 55, -25);
    this.moon.visible = false;

    this.nightLamp = new THREE.PointLight(0x77ccff, 0, 42, 1.8);
    this.scene.add(this.hemi, this.sun, this.moon, this.nightLamp);

    // 地形
    this.mats = createTerrainMaterial(this.snowField.texture);
    const terrainGeo = new THREE.PlaneGeometry(TERRAIN.WIDTH, TERRAIN.LENGTH, TERRAIN.SEG_X, TERRAIN.SEG_Z);
    terrainGeo.rotateX(-Math.PI / 2);
    const terrain = new THREE.Mesh(terrainGeo, this.mats.terrain);
    terrain.receiveShadow = true;
    terrain.name = 'slope';
    this.scene.add(terrain);

    // 四周护栏杆（空间参照）
    this.addReferenceFrame();

    // 机器、粒子、轨迹挂点
    this.scene.add(this.machineView.group, this.particles.mesh, this.trajectory.group, this.windArrows);

    this.yawArrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(), 4.2, 0xffd166, 0.9, 0.55);
    this.windArrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(), 8, 0x66d9ff, 1.2, 0.7);
    this.scene.add(this.yawArrow, this.windArrow);

    // 后期：辉光 + 自定义 ACES 色调映射。
    // 不用内置 OutputPass —— 它在 bloom 合成后再次套用输出转换，夜间高亮会整体过曝。
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(container.clientWidth, container.clientHeight),
      0.08,
      0.5,
      0.72,
    );
    this.composer.addPass(this.bloom);
    this.composer.addPass(new ShaderPass(ToneMapShader));

    this.bindEvents();
    this.buildWindFieldArrows();
  }

  private addReferenceFrame(): void {
    const mat = new THREE.LineBasicMaterial({ color: 0x4a6075, transparent: true, opacity: 0.5 });
    const pts: THREE.Vector3[] = [];
    const halfW = TERRAIN.WIDTH / 2;
    const halfL = TERRAIN.LENGTH / 2;
    for (const x of [-halfW, halfW]) {
      for (let j = 0; j <= 24; j++) {
        const z = -halfL + (TERRAIN.LENGTH * j) / 24;
        pts.push(new THREE.Vector3(x, terrainHeight(x, z) + 0.25, z));
      }
    }
    this.scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat));
  }

  /** 风场箭头阵列（飘移预测叠加层） */
  private buildWindFieldArrows(): void {
    for (let ix = 0; ix < 6; ix++) {
      for (let iz = 0; iz < 9; iz++) {
        const x = -TERRAIN.WIDTH / 2 + 8 + ix * ((TERRAIN.WIDTH - 16) / 5);
        const z = -TERRAIN.LENGTH / 2 + 8 + iz * ((TERRAIN.LENGTH - 16) / 8);
        const arrow = new THREE.ArrowHelper(
          new THREE.Vector3(0, 0, 1),
          new THREE.Vector3(x, terrainHeight(x, z) + 1.2, z),
          4.5,
          0x66d9ff,
          0.7,
          0.4,
        );
        this.windArrows.add(arrow);
      }
    }
    this.windArrows.visible = false;
  }

  refreshWindField(): void {
    const sel = this.manager.selectedId != null ? this.manager.get(this.manager.selectedId) : this.manager.list()[0];
    if (!sel) return;
    const w = windVector(sel.wind);
    if (w.lengthSq() < 1e-6) w.set(0, 0, 1); // 风速为 0 时箭头保持上一次朝向，避免归一化出 NaN
    w.normalize();
    for (const child of this.windArrows.children) {
      const arrow = child as THREE.ArrowHelper;
      arrow.setDirection(w);
      const len = 2.5 + sel.wind.speed * 0.55;
      arrow.setLength(len, len * 0.18, len * 0.11);
    }
  }

  // ---------- 交互 ----------

  private bindEvents(): void {
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('pointerup', this.onPointerUp);
    el.addEventListener('dblclick', this.onDblClick);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('resize', this.onResize);
  }

  private setPointer(e: MouseEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }

  private pickMachine(): number | null {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects([...this.machineView.pickables()], false);
    return hits.length ? (hits[0].object.userData.machineId as number) : null;
  }

  private pickGround(): THREE.Vector3 | null {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.groundPlane, hit)) return null;
    hit.x = clamp(hit.x, -TERRAIN.WIDTH / 2 + 1, TERRAIN.WIDTH / 2 - 1);
    hit.z = clamp(hit.z, -TERRAIN.LENGTH / 2 + 1, TERRAIN.LENGTH / 2 - 1);
    hit.y = terrainHeight(hit.x, hit.z);
    return hit;
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    this.setPointer(e);
    const id = this.pickMachine();
    this.pointerDown = true;
    if (id != null) {
      this.dragId = id;
      this.controls.enabled = false;
      if (this.manager.selectedId !== id) {
        this.manager.select(id);
        this.bus.emit('machine:select', { id });
      }
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    this.setPointer(e);
    if (!this.pointerDown || this.dragId == null) {
      // 悬停光标
      this.renderer.domElement.style.cursor = this.pickMachine() != null ? 'grab' : 'default';
      return;
    }
    const p = this.pickGround();
    const cfg = this.manager.get(this.dragId);
    if (p && cfg) {
      this.manager.updateTransform(cfg.id, { x: p.x, z: p.z });
      this.bus.emit('machine:transform', { id: cfg.id, x: p.x, z: p.z, yaw: cfg.yaw, pitch: cfg.pitch });
    }
  };

  private onPointerUp = (): void => {
    this.pointerDown = false;
    this.dragId = null;
    this.controls.enabled = true;
  };

  private onDblClick = (e: MouseEvent): void => {
    this.setPointer(e);
    if (this.pickMachine() != null) return;
    const p = this.pickGround();
    if (p) this.bus.emit('machine:add', { x: p.x, z: p.z });
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    const id = this.manager.selectedId;
    if (id == null) return;
    const cfg = this.manager.get(id);
    if (!cfg) return;
    const step = e.shiftKey ? 5 : 2;
    let changed = false;
    if (e.code === 'KeyQ') { cfg.yaw = (cfg.yaw - step + 360) % 360; changed = true; }
    if (e.code === 'KeyE') { cfg.yaw = (cfg.yaw + step) % 360; changed = true; }
    if (e.code === 'KeyR') { cfg.pitch = clamp(cfg.pitch + 2, 5, 60); changed = true; }
    if (e.code === 'KeyF') { cfg.pitch = clamp(cfg.pitch - 2, 5, 60); changed = true; }
    if (changed) {
      this.bus.emit('machine:transform', { id, x: cfg.x, z: cfg.z, yaw: cfg.yaw, pitch: cfg.pitch });
      e.preventDefault();
    }
  };

  private onResize = (): void => {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
  };

  // ---------- 昼夜与后期 ----------

  setNight(night: boolean): void {
    this.night = night;
    setNightMode(this.mats, night);
    this.sun.visible = !night;
    this.moon.visible = night;
    this.hemi.intensity = night ? 0.28 : 0.95;
    this.hemi.color.setHex(night ? 0x334466 : 0xdfefff);
    this.bloom.strength = night ? 0.38 : 0.08;
    this.bloom.radius = night ? 0.55 : 0.4;
    this.bloom.threshold = night ? 0.7 : 0.82;
    const bg = night ? 0x0a1020 : 0xbcd8ee;
    (this.scene.background as THREE.Color).setHex(bg);
    this.scene.fog!.color.setHex(bg);
    this.nightLamp.intensity = night ? 26 : 0;
  }

  setTimeScale(scale: number): void {
    this.timeScale = scale;
  }

  setTrajectoriesVisible(v: boolean): void {
    this.trajectory.setVisible(v);
  }

  setForecastVisible(v: boolean): void {
    this.windArrows.visible = v;
    if (v) this.refreshWindField();
  }

  // ---------- 主循环 ----------

  start(): void {
    this.lastTime = performance.now();
    const loop = (now: number) => {
      if (this.disposed) return;
      this.raf = requestAnimationFrame(loop);
      const frameDt = Math.min(0.1, (now - this.lastTime) / 1000);
      this.lastTime = now;

      this.frameCount++;
      this.statTimer += frameDt;
      if (this.statTimer >= 0.5) {
        this.fps = this.frameCount / this.statTimer;
        this.frameCount = 0;
        this.statTimer = 0;
        this.publishStats();
      }

      if (this.running) {
        this.accumulator += frameDt * this.timeScale;
        let guard = 0;
        while (this.accumulator >= FIXED_DT && guard < 5) {
          this.particles.step(FIXED_DT, this.manager.list());
          this.accumulator -= FIXED_DT;
          guard++;
        }
        this.snowField.flush();
      }

      this.updateHelpers();
      this.controls.update();
      this.composer.render();
    };
    this.raf = requestAnimationFrame(loop);
  }

  private updateHelpers(): void {
    const sel = this.manager.selectedId != null ? this.manager.get(this.manager.selectedId) : undefined;
    if (sel) {
      const base = new THREE.Vector3(sel.x, terrainHeight(sel.x, sel.z) + 0.4, sel.z);
      this.yawArrow.position.copy(base);
      this.yawArrow.setDirection(yawToVector(sel.yaw));
      this.yawArrow.visible = true;

      const w = windVector(sel.wind);
      this.windArrow.position.copy(base).add(new THREE.Vector3(0, 1.2, 0));
      if (w.lengthSq() < 1e-6) w.set(0, 0, 1);
      this.windArrow.setDirection(w.normalize());
      this.windArrow.setLength(3 + sel.wind.speed * 0.7, 1.1, 0.65);
      this.windArrow.visible = true;

      if (this.night) {
        this.nightLamp.position.set(sel.x, terrainHeight(sel.x, sel.z) + 3.2, sel.z);
      }
    } else {
      this.yawArrow.visible = false;
      this.windArrow.visible = false;
    }
  }

  private publishStats(): void {
    const s = this.snowField.stats();
    const stats: SimStats = {
      fps: Math.round(this.fps),
      activeParticles: this.particles.active,
      capacity: PARTICLE.MAX_COUNT,
      machineCount: this.manager.count,
      coverage: s.coverage,
      avgDepth: s.avgDepth,
      running: this.running,
      night: this.night,
    };
    this.bus.emit('stats:update', stats);
  }

  setRunning(running: boolean): void {
    this.running = running;
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('keydown', this.onKeyDown);
    this.controls.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
