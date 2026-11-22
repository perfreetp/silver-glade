import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  EffectComposer,
  RenderPass,
  EffectPass,
  BloomEffect,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
  SMAAEffect,
} from 'postprocessing';
import {
  applyLightToUniforms,
  applyParamsToUniforms,
  createPaintMaterial,
  type PaintUniforms,
} from './paintShader';
import { createStudioEnv } from './environment';
import { createPaintMeshes, type SceneMeshes } from './geometry';
import type { DebugMode, LightState, PaintParams } from '../types';

export interface FrameMetrics {
  /** 渲染线程单帧耗时（毫秒，120 帧滑动窗口） */
  avgMs: number;
  p95Ms: number;
  maxMs: number;
  fps: number;
  /** 最近一秒内超过 20ms 的掉帧次数 */
  droppedLastSecond: number;
}

export interface ContributionResult {
  clearLum: number;
  baseLum: number;
}

interface ContributionCanvases {
  clear: HTMLCanvasElement | null;
  base: HTMLCanvasElement | null;
}

const PICK_RADIUS = 4.6;
const MARKER_RADIUS = 3.6;
const DEBUG_RT_SIZE = 192;
const METRICS_WINDOW = 120;

export class PaintEngine {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private composer: EffectComposer;
  private material: THREE.ShaderMaterial;
  private uniforms: PaintUniforms;
  private meshes: SceneMeshes;
  private lightMarker: THREE.Mesh;
  private pickSphere: THREE.Mesh;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private draggingLight = false;

  private debugRT1: THREE.WebGLRenderTarget;
  private debugRT2: THREE.WebGLRenderTarget;
  private contributionCanvases: ContributionCanvases = { clear: null, base: null };
  private lastContributionAt = 0;

  private clock = new THREE.Clock();
  private rafId = 0;
  private disposed = false;
  private resizeObserver: ResizeObserver;

  private frameSamples: number[] = [];
  private frameIntervals: number[] = [];
  private lastFrameAt = 0;
  private droppedWindow: { t: number; dropped: boolean }[] = [];
  private metricsCb: ((m: FrameMetrics) => void) | null = null;
  private contributionCb: ((c: ContributionResult) => void) | null = null;
  private lastMetricsEmit = 0;
  private lightCb: ((az: number, el: number) => void) | null = null;

  constructor(private container: HTMLElement) {
    const width = container.clientWidth;
    const height = container.clientHeight;

    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: 'high-performance',
      // 设计工具需要可靠截图/画布读取（贡献分析、导出截图）
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(width, height);
    this.renderer.toneMapping = THREE.NoToneMapping;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.touchAction = 'none';

    this.camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 100);
    this.camera.position.set(4.6, 2.5, 6.4);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0.8, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 2.6;
    this.controls.maxDistance = 11;
    this.controls.maxPolarAngle = Math.PI * 0.52;

    // 环境
    const env = createStudioEnv(this.renderer);
    this.scene.environment = env;

    // 车漆材质（三件试片共享同一实例 → 调参只写一次 uniform）
    this.material = createPaintMaterial();
    this.uniforms = this.material.uniforms as unknown as PaintUniforms;
    this.uniforms.uEnvMap.value = env;

    this.meshes = createPaintMeshes(this.material);
    this.scene.add(this.meshes.sphere, this.meshes.hood, this.meshes.door);

    this.addGround();

    // 光源方位标记球 + 隐形拾取球
    this.lightMarker = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 24, 16),
      new THREE.MeshBasicMaterial({ color: '#ffd9a0' }),
    );
    this.lightMarker.name = 'light-marker';
    this.scene.add(this.lightMarker);

    const markerRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.24, 0.012, 8, 40),
      new THREE.MeshBasicMaterial({ color: '#ffb35c', transparent: true, opacity: 0.85 }),
    );
    this.lightMarker.add(markerRing);

    this.pickSphere = new THREE.Mesh(
      new THREE.SphereGeometry(PICK_RADIUS, 24, 16),
      // colorWrite=false：可被射线拾取但完全不渲染（visible=false 会让 Raycaster 跳过）
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false }),
    );
    this.pickSphere.visible = true;
    this.scene.add(this.pickSphere);

    // 后处理：Bloom + ACES 电影级色调映射 + 暗角 + SMAA
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    const effectPass = new EffectPass(
      this.camera,
      new BloomEffect({
        intensity: 0.42,
        luminanceThreshold: 0.85,
        luminanceSmoothing: 0.22,
        mipmapBlur: true,
      }),
      new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC }),
      new VignetteEffect({ darkness: 0.3, offset: 0.34 }),
      new SMAAEffect(),
    );
    this.composer.addPass(effectPass);
    this.composer.setSize(width, height);

    // 离屏高光贡献分析目标：8bit 即可（回读与缩略图可视化），保证 readPixels 类型匹配
    const rtOpts: THREE.RenderTargetOptions = {
      type: THREE.UnsignedByteType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
    };
    this.debugRT1 = new THREE.WebGLRenderTarget(DEBUG_RT_SIZE, DEBUG_RT_SIZE, rtOpts);
    this.debugRT2 = new THREE.WebGLRenderTarget(DEBUG_RT_SIZE, DEBUG_RT_SIZE, rtOpts);

    this.bindPointerEvents();
    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(container);

    this.loop = this.loop.bind(this);
    this.rafId = requestAnimationFrame(this.loop);
  }

  private addGround(): void {
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(14, 72),
      new THREE.MeshStandardMaterial({
        color: '#23262c',
        roughness: 0.85,
        metalness: 0.05,
        envMap: this.scene.environment ?? undefined,
        envMapIntensity: 0.25,
      }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.62;
    this.scene.add(ground);

    // 程序化接触阴影斑
    const cv = document.createElement('canvas');
    cv.width = 256;
    cv.height = 256;
    const ctx = cv.getContext('2d')!;
    const grad = ctx.createRadialGradient(128, 128, 10, 128, 128, 128);
    grad.addColorStop(0, 'rgba(0,0,0,0.55)');
    grad.addColorStop(0.6, 'rgba(0,0,0,0.22)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 256);
    const blob = new THREE.Mesh(
      new THREE.PlaneGeometry(7.5, 5.5),
      new THREE.MeshBasicMaterial({
        map: new THREE.CanvasTexture(cv),
        transparent: true,
        depthWrite: false,
      }),
    );
    blob.rotation.x = -Math.PI / 2;
    blob.position.set(0, -0.615, 0.2);
    this.scene.add(blob);
  }

  // ───────────────────────── 公开 API ─────────────────────────
  setParams(params: PaintParams): void {
    applyParamsToUniforms(this.uniforms, params);
  }

  setLight(light: LightState): void {
    applyLightToUniforms(this.uniforms, light);
    const dir = this.uniforms.uLightDir.value;
    this.lightMarker.position.copy(dir).multiplyScalar(MARKER_RADIUS);
  }

  setDebugMode(mode: DebugMode): void {
    this.uniforms.uDebugMode.value = mode;
  }

  onLightChange(cb: (azimuth: number, elevation: number) => void): void {
    this.lightCb = cb;
  }

  onMetrics(cb: (m: FrameMetrics) => void): void {
    this.metricsCb = cb;
  }

  onContribution(cb: (c: ContributionResult) => void): void {
    this.contributionCb = cb;
  }

  setContributionCanvases(clear: HTMLCanvasElement | null, base: HTMLCanvasElement | null): void {
    this.contributionCanvases = { clear, base };
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.debugRT1.dispose();
    this.debugRT2.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.material.dispose();
    this.meshes.sphere.geometry.dispose();
    this.meshes.hood.geometry.dispose();
    this.meshes.door.geometry.dispose();
    this.renderer.domElement.remove();
  }

  // ───────────────────────── 光源拖拽 ─────────────────────────
  private bindPointerEvents(): void {
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
  }

  private updatePointer(e: PointerEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }

  private onPointerDown = (e: PointerEvent): void => {
    this.updatePointer(e);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hitMarker = this.raycaster.intersectObject(this.lightMarker, false).length > 0;
    const hitPick = this.raycaster.intersectObject(this.pickSphere, false);
    // 点击光源标记球，或按住 Shift 在光球范围内拖动，进入拖光模式
    if (hitMarker || (hitPick.length > 0 && e.shiftKey)) {
      this.draggingLight = true;
      this.controls.enabled = false;
      this.renderer.domElement.style.cursor = 'grabbing';
      if (hitPick.length > 0) this.applyLightFromPoint(hitPick[0].point);
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    this.updatePointer(e);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    if (this.draggingLight) {
      const hit = this.raycaster.intersectObject(this.pickSphere, false);
      if (hit.length > 0) this.applyLightFromPoint(hit[0].point);
      return;
    }
    // 悬停在光源球上时显示抓取光标
    const hoverMarker = this.raycaster.intersectObject(this.lightMarker, false).length > 0;
    if (hoverMarker) this.renderer.domElement.style.cursor = 'grab';
    else if (this.renderer.domElement.style.cursor === 'grab') {
      this.renderer.domElement.style.cursor = '';
    }
  };

  private onPointerUp = (): void => {
    if (!this.draggingLight) return;
    this.draggingLight = false;
    this.controls.enabled = true;
    this.renderer.domElement.style.cursor = '';
  };

  private applyLightFromPoint(point: THREE.Vector3): void {
    const dir = point.clone().normalize();
    const elevation = THREE.MathUtils.clamp(
      THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1))),
      5,
      75,
    );
    let azimuth = THREE.MathUtils.radToDeg(Math.atan2(dir.x, dir.z));
    if (azimuth < 0) azimuth += 360;
    this.lightCb?.(azimuth, elevation);
  }

  private handleResize(): void {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (width === 0 || height === 0) return;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.composer.setSize(width, height);
  }

  // ───────────────────────── 高光贡献离屏分析 ─────────────────────────
  private renderContribution(now: number): ContributionResult | null {
    if (now - this.lastContributionAt < 250) return null;
    this.lastContributionAt = now;

    const prevMode = this.uniforms.uDebugMode.value;
    const results: { lum: number }[] = [];
    const targets = [this.debugRT1, this.debugRT2];
    const modes: DebugMode[] = [1, 2];
    const canvases = [this.contributionCanvases.clear, this.contributionCanvases.base];

    for (let i = 0; i < 2; i++) {
      this.uniforms.uDebugMode.value = modes[i];
      this.renderer.setRenderTarget(targets[i]);
      this.renderer.render(this.scene, this.camera);
      const size = DEBUG_RT_SIZE;
      const buf = new Uint8Array(size * size * 4);
      this.renderer.readRenderTargetPixels(targets[i], 0, 0, size, size, buf);
      let sum = 0;
      const image = new ImageData(size, size);
      for (let p = 0; p < size * size; p++) {
        for (let ch = 0; ch < 3; ch++) {
          const v = buf[p * 4 + ch] / 255;
          sum += v;
          image.data[p * 4 + ch] = Math.min(255, Math.round(Math.pow(v, 1 / 2.2) * 255));
        }
        image.data[p * 4 + 3] = 255;
      }
      results.push({ lum: sum / (size * size * 3) });
      if (canvases[i]) this.blitImageData(canvases[i]!, image);
    }

    this.uniforms.uDebugMode.value = prevMode;
    this.renderer.setRenderTarget(null);

    return { clearLum: results[0].lum, baseLum: results[1].lum };
  }

  private blitImageData(cv: HTMLCanvasElement, image: ImageData): void {
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const tmp = document.createElement('canvas');
    tmp.width = image.width;
    tmp.height = image.height;
    tmp.getContext('2d')!.putImageData(image, 0, 0);
    // WebGL 原点在左下，2D canvas 在左上 → 垂直翻转
    ctx.save();
    ctx.scale(1, -1);
    ctx.drawImage(tmp, 0, -cv.height, cv.width, cv.height);
    ctx.restore();
  }

  // ───────────────────────── 主循环 ─────────────────────────
  private loop(): void {
    if (this.disposed) return;
    this.rafId = requestAnimationFrame(this.loop);

    const now = performance.now();
    const dt = this.clock.getDelta();
    this.uniforms.uTime.value += dt;

    this.controls.update();

    const t0 = performance.now();
    this.composer.render();
    const renderMs = performance.now() - t0;

    // 帧间隔（rAF 节奏）统计
    if (this.lastFrameAt > 0) {
      const interval = now - this.lastFrameAt;
      this.frameIntervals.push(interval);
      this.droppedWindow.push({ t: now, dropped: interval > 20 });
      if (this.frameIntervals.length > METRICS_WINDOW) this.frameIntervals.shift();
    }
    this.lastFrameAt = now;

    this.frameSamples.push(renderMs);
    if (this.frameSamples.length > METRICS_WINDOW) this.frameSamples.shift();
    this.droppedWindow = this.droppedWindow.filter((d) => now - d.t < 1000);

    // 2Hz 上报指标与贡献分析（无头/低端设备帧稀少时仍能稳定刷新）
    if (now - this.lastMetricsEmit > 500) {
      this.lastMetricsEmit = now;
      this.emitMetrics(now);
      const c = this.renderContribution(now);
      if (c) this.contributionCb?.(c);
    }
  }

  private emitMetrics(now: number): void {
    if (!this.metricsCb || this.frameSamples.length < 3) return;
    const sorted = [...this.frameSamples].sort((a, b) => a - b);
    const avg = sorted.reduce((s, v) => s + v, 0) / sorted.length;
    const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? sorted[sorted.length - 1];
    const max = sorted[sorted.length - 1];
    const avgInterval =
      this.frameIntervals.reduce((s, v) => s + v, 0) / Math.max(this.frameIntervals.length, 1);
    const fps = avgInterval > 0 ? 1000 / avgInterval : 60;
    const dropped = this.droppedWindow.filter((d) => d.dropped).length;
    this.metricsCb({
      avgMs: avg,
      p95Ms: p95,
      maxMs: max,
      fps,
      droppedLastSecond: dropped,
    });
    void now;
  }
}
