import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer, RenderPass, EffectPass, BloomEffect, SMAAEffect, VignetteEffect, BlendFunction, ToneMappingEffect, ToneMappingMode } from 'postprocessing';
import { buildRoomShell } from './scene';
import { buildRacks, type RackMeshes } from './racks';
import { FanRenderer } from './fans';
import { TrailParticles } from './particles';
import { SliceRenderer, type SliceMode } from './slice';
import { createSampler, type VelocitySampler } from './sampler';
import { BAND_COLORS, colorBand, GRID_FINE, ROOM, type Solution } from '../solver/field';
import { fanAirDir, fanWorldPosition } from '../model/fans';
import type { Fan } from '../model/room';
import { worldToWall } from '../model/fans';

export interface ViewerEvents {
  /** 拖动中 (节流), 传入新的墙面局部坐标 */
  onFanDragMove?: (id: string, u: number, v: number) => void;
  onFanDragEnd?: (id: string) => void;
}

export interface ViewSettings {
  showParticles: boolean;
  showSlice: boolean;
  showArrows: boolean;
  particleOpacity: number;
  sliceOpacity: number;
  particleBudget: number;
  trailLength: number;
  particleSize: number;
  colorizeBy: 'speed' | 'age';
}

const MAX_PARTICLES = 24000;

export class Viewer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private composer: EffectComposer;
  private bloom: BloomEffect;
  private shell: ReturnType<typeof buildRoomShell>;
  private racks: RackMeshes | null = null;
  private fanRenderer = new FanRenderer();
  private particles: TrailParticles;
  private slice: SliceRenderer;

  private solution: Solution | null = null;
  private sampler: VelocitySampler | null = null;
  private fans: Fan[] = [];
  private events: ViewerEvents = {};

  private lastT = performance.now();
  private raf = 0;
  private dragging: { id: string; wallNormal: THREE.Vector3; plane: THREE.Plane } | null = null;
  private hovered: string | null = null;
  private lastDragEmit = 0;
  private disposed = false;

  settings: ViewSettings & { showRacks?: boolean } = {
    showParticles: true,
    showSlice: true,
    showArrows: true,
    particleOpacity: 0.9,
    sliceOpacity: 0.9,
    particleBudget: 12000,
    trailLength: 14,
    particleSize: 1.0,
    colorizeBy: 'speed',
    showRacks: true,
  };

  private sliceMode: SliceMode = 'horizontal';
  private slicePos = 2.0;

  private colorCache: THREE.Color[] = BAND_COLORS.map((c) => new THREE.Color(c));
  private ageColorLow = new THREE.Color('#2ac8a2');
  private ageColorHigh = new THREE.Color('#c22a6a');

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      alpha: false,
    });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x080c12);
    this.scene.fog = new THREE.Fog(0x080c12, 26, 46);

    this.camera = new THREE.PerspectiveCamera(46, 1, 0.05, 200);
    this.camera.position.set(-2.6, 8.6, 12.4);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(ROOM.lx * 0.46, ROOM.ly * 0.36, ROOM.lz * 0.5);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 2.0;
    this.controls.maxDistance = 42;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.update();

    // 灯光
    const hemi = new THREE.HemisphereLight(0xa8c8ee, 0x2a3644, 1.35);
    this.scene.add(hemi);
    this.scene.add(new THREE.AmbientLight(0x4a5d72, 0.85));
    const key = new THREE.DirectionalLight(0xffffff, 1.5);
    key.position.set(3.2, 12, 9.5);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -12;
    key.shadow.camera.right = 16;
    key.shadow.camera.top = 14;
    key.shadow.camera.bottom = -6;
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 40;
    key.shadow.bias = -0.0008;
    key.shadow.radius = 3;
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x88b8ff, 1.05);
    rim.position.set(-9, 6, -7);
    this.scene.add(rim);
    const fill = new THREE.DirectionalLight(0xc9dcff, 0.55);
    fill.position.set(6, 3, -12);
    this.scene.add(fill);

    this.shell = buildRoomShell();
    this.scene.add(this.shell.group);
    this.scene.add(this.fanRenderer.group);

    this.particles = new TrailParticles({ maxParticles: MAX_PARTICLES, trailPoints: 14 });
    this.scene.add(this.particles.object);

    this.slice = new SliceRenderer(GRID_FINE);
    this.scene.add(this.slice.group);

    // 后处理
    this.composer = new EffectComposer(this.renderer, {
      frameBufferType: THREE.HalfFloatType,
      multisampling: 0,
    });
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new BloomEffect({
      intensity: 0.5,
      luminanceThreshold: 0.45,
      luminanceSmoothing: 0.25,
      mipmapBlur: true,
      blendFunction: BlendFunction.ADD,
    });
    const tone = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC, resolution: 256 });
    const smaa = new SMAAEffect();
    const vignette = new VignetteEffect({ offset: 0.32, darkness: 0.55 });
    this.composer.addPass(new EffectPass(this.camera, this.bloom, tone, smaa, vignette));

    this.particles.setViewport(container.clientHeight || 800, this.camera.fov);

    this.resize();
    this.setupInteraction();
    if (import.meta.env.DEV) (window as unknown as { __viewer: Viewer }).__viewer = this;
    this.loop();
  }

  setEvents(e: ViewerEvents) {
    this.events = e;
  }

  /** 更新风机列表 (不重算风场) */
  setFans(fans: Fan[]) {
    this.fans = fans;
    this.fanRenderer.sync(fans);
  }

  /** 新解算结果 */
  setSolution(sol: Solution, opts: { reseed?: boolean } = {}) {
    const first = !this.solution;
    this.solution = sol;
    this.sampler = createSampler(sol);
    // 菇架网格随工况重建 (厚度可能不同)
    if (this.racks) {
      this.scene.remove(this.racks.group);
      this.racks.dispose();
    }
    this.racks = buildRacks(sol.boxes);
    this.racks.group.visible = this.settings.showRacks !== false;
    this.scene.add(this.racks.group);

    this.particles.setPrefillSampler(this.sampler.sample);
    // 拖动风机时不要重新播种, 让粒子从当前状态平滑跟随新流场
    if (first || opts.reseed !== false) {
      this.particles.setSeeds(this.seedPoints(sol), 0.07, this.settings.particleBudget);
    } else {
      // 保持当前活跃数, 但让新预算立即生效
      this.particles.activeCount = this.settings.particleBudget;
    }
    this.slice.rebuild(sol, this.sliceMode, this.slicePos);
    this.slice.setVisible(this.settings.showSlice);
    this.slice.setArrowsVisible(this.settings.showArrows && this.settings.showSlice);
    this.particles.setVisible(this.settings.showParticles);
  }

  private seedPoints(sol: Solution) {
    const pts: { x: number; y: number; z: number }[] = [];
    const budget = this.settings.particleBudget;
    // 种子: 进风口前方一簇 (占 30%) + 全场均匀 (70%), 让整个房间都有拖尾
    const supplies = this.fans.filter((f) => f.kind === 'supply' && f.airflow > 0 && f.radius > 0.02);
    if (supplies.length) {
      const n = Math.ceil(budget * 0.14);
      for (let i = 0; i < n; i++) {
        const fan = supplies[i % supplies.length];
        const p = fanWorldPosition(fan);
        const d = fanAirDir(fan);
        const r = fan.radius * 1.1 * Math.sqrt(Math.random());
        const a = Math.random() * Math.PI * 2;
        const ux = Math.abs(d.y) > 0.9 ? 1 : -d.z;
        const uz = Math.abs(d.y) > 0.9 ? 0 : d.x;
        const ln = Math.hypot(ux, uz) || 1;
        const t1 = (ux / ln) * Math.cos(a) * r;
        const t2 = (uz / ln) * Math.cos(a) * r;
        // 沿流向拉开 0~1.4 m, 避免全部挤在风口
        const dist = 0.15 + Math.random() * 1.25;
        pts.push({
          x: p.x + d.x * dist + t1,
          y: p.y + d.y * dist + Math.sin(a) * r * 0.7,
          z: p.z + d.z * dist + t2,
        });
      }
    }
    // 房间内均匀撒点, 只在流体体素上
    if (this.sampler) {
      const target = Math.max(0, budget - pts.length);
      let tries = 0;
      let placed = 0;
      while (placed < target && tries < target * 40) {
        tries++;
        const x = 0.15 + Math.random() * (ROOM.lx - 0.3);
        const y = 0.15 + Math.random() * (ROOM.ly - 0.3);
        const z = 0.15 + Math.random() * (ROOM.lz - 0.3);
        if (this.sampler.isFluid(x, y, z)) {
          pts.push({ x, y, z });
          placed++;
        }
      }
    }
    void sol;
    return pts;
  }

  setSlice(mode: SliceMode, position: number) {
    this.sliceMode = mode;
    this.slicePos = position;
    if (this.solution) this.slice.rebuild(this.solution, mode, position);
  }

  setSettings(s: Partial<ViewSettings>) {
    const prevBudget = this.settings.particleBudget;
    Object.assign(this.settings, s);
    this.slice.setVisible(this.settings.showSlice);
    this.slice.setArrowsVisible(this.settings.showArrows && this.settings.showSlice);
    this.slice.setOpacity(this.settings.sliceOpacity);
    this.particles.setVisible(this.settings.showParticles);
    this.particles.setOpacity(this.settings.particleOpacity);
    if (this.racks) this.racks.group.visible = this.settings.showRacks !== false;
    // 只在粒子预算变化时重新播种 (其它滑块不应让流线重置)
    if (this.solution && this.settings.particleBudget !== prevBudget) {
      this.particles.setSeeds(this.seedPoints(this.solution), 0.07, this.settings.particleBudget);
    }
  }

  resetCamera() {
    this.camera.position.set(-2.6, 8.6, 12.4);
    this.controls.target.set(ROOM.lx * 0.46, ROOM.ly * 0.36, ROOM.lz * 0.5);
    this.controls.update();
  }

  setCameraPreset(preset: 'iso' | 'front' | 'top' | 'side') {
    const t = new THREE.Vector3(ROOM.lx * 0.46, ROOM.ly * 0.38, ROOM.lz * 0.5);
    // 俯视时相机 up 取 -Z, 让房间长度方向在屏幕上水平
    this.camera.up.set(0, 1, 0);
    if (preset === 'iso') this.camera.position.set(-2.6, 8.6, 12.4);
    if (preset === 'front') this.camera.position.set(ROOM.lx / 2, ROOM.ly * 0.5, 18.5);
    if (preset === 'top') {
      this.camera.position.set(ROOM.lx / 2, 18, ROOM.lz / 2 + 0.001);
      this.camera.up.set(0, 0, -1);
    }
    if (preset === 'side') this.camera.position.set(-10.5, 4.2, ROOM.lz / 2);
    this.controls.target.copy(t);
    this.controls.update();
    this.camera.updateProjectionMatrix();
  }

  // ---------------- 交互: 拖动风机 ----------------

  private setupInteraction() {
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);
  }

  private raycastFan(ev: PointerEvent): string | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((ev.clientX - rect.left) / rect.width) * 2 - 1,
      -((ev.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const targets = this.fanRenderer.allVisuals().map((v) => v.hit);
    const hits = ray.intersectObjects(targets, false);
    return hits.length ? (hits[0].object.userData.fanId as string) : null;
  }

  private onPointerDown = (ev: PointerEvent) => {
    if (ev.button !== 0) return;
    const id = this.raycastFan(ev);
    if (!id) return;
    const fan = this.fans.find((f) => f.id === id);
    if (!fan) return;
    ev.preventDefault();
    ev.stopPropagation();
    this.controls.enabled = false;
    this.dragging = { id, wallNormal: new THREE.Vector3(), plane: new THREE.Plane() };
    this.updateDragPlane(fan, ev);
    this.renderer.domElement.style.cursor = 'grabbing';
  };

  private updateDragPlane(fan: Fan, ev: PointerEvent) {
    const pos = fanWorldPosition(fan);
    const normal = new THREE.Vector3(
      fan.wall === 'west' ? 1 : fan.wall === 'east' ? -1 : 0,
      fan.wall === 'ceiling' ? -1 : 0,
      fan.wall === 'south' ? 1 : fan.wall === 'north' ? -1 : 0,
    );
    // 与墙面平行、过风机当前点的平面
    this.dragging!.plane.setFromNormalAndCoplanarPoint(normal, new THREE.Vector3(pos.x, pos.y, pos.z));
    this.dragging!.wallNormal.copy(normal);
    void ev;
  }

  private onPointerMove = (ev: PointerEvent) => {
    if (this.dragging) {
      const fan = this.fans.find((f) => f.id === this.dragging!.id);
      if (!fan) return;
      const rect = this.renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((ev.clientX - rect.left) / rect.width) * 2 - 1,
        -((ev.clientY - rect.top) / rect.height) * 2 + 1,
      );
      const ray = new THREE.Raycaster();
      ray.setFromCamera(ndc, this.camera);
      const pt = new THREE.Vector3();
      if (!ray.ray.intersectPlane(this.dragging.plane, pt)) return;
      const now = performance.now();
      if (now - this.lastDragEmit > 55) {
        this.lastDragEmit = now;
        // 世界坐标 -> 墙面局部坐标 (u, v)
        const { u, v } = worldToWall(fan.wall, { x: pt.x, y: pt.y, z: pt.z });
        this.events.onFanDragMove?.(fan.id, u, v);
      }
      return;
    }
    const id = this.raycastFan(ev);
    if (id !== this.hovered) {
      this.hovered = id;
      this.renderer.domElement.style.cursor = id ? 'grab' : 'default';
    }
  };

  private onPointerUp = () => {
    if (this.dragging) {
      const id = this.dragging.id;
      this.dragging = null;
      this.controls.enabled = true;
      this.renderer.domElement.style.cursor = 'default';
      this.events.onFanDragEnd?.(id);
    }
  };

  // ---------------- 渲染循环 ----------------

  private resize = () => {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.particles.setViewport(h, this.camera.fov);
  };

  private resizeObserver = new ResizeObserver(() => this.resize());

  observe() {
    this.resizeObserver.observe(this.container);
  }

  private frameCount = 0;
  private fpsAcc = 0;
  private fpsTime = 0;
  fps = 0;

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastT) / 1000);
    this.lastT = now;
    this.controls.update();

    if (this.solution && this.sampler && this.settings.showParticles) {
      const sol = this.solution;
      const stops = sol.colorStops;
      const byAge = this.settings.colorizeBy === 'age';
      const sampler = this.sampler;
      const low = this.ageColorLow;
      const high = this.ageColorHigh;
      const colorize = (speed: number, x: number, y: number, z: number, out: [number, number, number]) => {
        let t: number;
        if (byAge) t = sampler.ageAt(x, y, z);
        else t = Math.min(1, speed / Math.max(0.05, sol.scaleMax));
        if (byAge) {
          out[0] = low.r + (high.r - low.r) * t;
          out[1] = low.g + (high.g - low.g) * t;
          out[2] = low.b + (high.b - low.b) * t;
        } else {
          const c = this.colorCache[colorBand(speed, stops)];
          out[0] = c.r;
          out[1] = c.g;
          out[2] = c.b;
        }
      };
      this.particles.update(dt, sampler.sample, colorize, {
        sizeScale: this.settings.particleSize,
        opacity: this.settings.particleOpacity,
      });
    }

    this.composer.render(dt);

    this.frameCount++;
    this.fpsTime += dt;
    if (this.fpsTime > 0.5) {
      this.fps = this.frameCount / this.fpsTime;
      this.frameCount = 0;
      this.fpsTime = 0;
    }
  };

  getStats() {
    return {
      fps: this.fps,
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
    };
  }

  /** 调试用: 风机圆盘在屏幕上的坐标 (CSS 像素) */
  fanScreenPos(id: string): { x: number; y: number } | null {
    const vis = this.fanRenderer.getVisual(id);
    if (!vis) return null;
    const v = vis.disc.position.clone().project(this.camera);
    const rect = this.renderer.domElement.getBoundingClientRect();
    return {
      x: rect.left + ((v.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - v.y) / 2) * rect.height,
    };
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerUp);
    this.particles.dispose();
    this.slice.dispose();
    this.fanRenderer.dispose();
    if (this.racks) this.racks.dispose();
    this.shell.dispose();
    this.composer.dispose();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
