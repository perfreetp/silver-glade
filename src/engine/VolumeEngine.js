// 渲染引擎:WebGPURenderer + 相机 + 视图管理 + 交互 + 重算调度
import {
  WebGPURenderer, PerspectiveCamera, Color, Vector3, Raycaster, Vector2,
  RenderTarget, RGBAFormat, UnsignedByteType, SRGBColorSpace,
} from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { VolumeView } from './VolumeView.js';
import { createSharedUniforms, lightDirFromAngles } from './graphs.js';
import { FRAME_COUNT, cloneSettings } from '../defaults.js';

export class VolumeEngine {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} project { settings, strokes }
   * @param {object} hooks { onStatus, onStrokesChange, onComputing }
   */
  constructor(canvas, project, hooks = {}) {
    this.canvas = canvas;
    this.hooks = hooks;
    this.settings = cloneSettings(project.settings);
    this._initialStrokes = project.strokes || [];
    this.shared = createSharedUniforms(this.settings);
    this.liveView = null;
    this.compareView = null;
    this.compareMode = false;
    this.playing = false;
    this.width = 1;
    this.height = 1;
    this._needsRender = true;
    this._disposed = false;
    this._listeners = {};
  }

  on(evt, cb) {
    (this._listeners[evt] ||= []).push(cb);
  }
  emit(evt, ...args) {
    for (const cb of this._listeners[evt] || []) cb(...args);
  }

  async init() {
    const renderer = new WebGPURenderer({ canvas: this.canvas, antialias: false });
    await renderer.init();
    if (!renderer.backend.isWebGPUBackend) {
      throw new Error('WebGPU 后端不可用(浏览器已回退到 WebGL,本工具需要 WebGPU)');
    }
    this.renderer = renderer;
    renderer.setClearColor(new Color(this.settings.render.bgColor));
    renderer.autoClear = true;

    this.camera = new PerspectiveCamera(50, 1, 0.05, 100);
    this.camera.position.set(2.4, 1.6, 2.4);
    this.camera.lookAt(0, 0, 0);

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.addEventListener('change', () => this.invalidate());

    // 主视图
    this.liveView = new VolumeView(this.shared, this.settings.resolution, this.settings.noise);
    this.liveView.strokes = this._initialStrokes || [];
    if (this.liveView.strokes.length) this.liveView.rebuildEditData();

    this._bindPointer();
    this._bindResize();

    // 初始计算
    await this.recompute(this.liveView, { light: true });

    // 渲染循环
    const loop = () => {
      if (this._disposed) return;
      requestAnimationFrame(loop);
      this.controls.update();
      if (this._needsRender) {
        this._needsRender = false;
        this.render();
      }
    };
    loop();
  }

  // ---------------- 重算调度 ----------------
  async recompute(view, { light = true } = {}) {
    view.uploadEditIfDirty();
    await this.renderer.computeAsync(view.densityCompute);
    if (light) await this.renderer.computeAsync(view.lightCompute);
    this.invalidate();
  }

  /** 合并调度:同一视图的重算请求串行执行并去重,避免拖动滑杆时任务堆积 */
  scheduleRecompute(view, { light = true } = {}) {
    view._wantDensity = true;
    view._wantLight = view._wantLight || light;
    this._pump(view);
  }

  scheduleLightRecompute(view) {
    view._wantLight = true;
    this._pump(view);
  }

  _pump(view) {
    if (view._running || (!view._wantDensity && !view._wantLight)) return;
    view._running = true;
    this.emit('computing', true);
    view._runPromise = (async () => {
      try {
        while (view._wantDensity || view._wantLight) {
          const doDensity = view._wantDensity;
          const doLight = view._wantLight;
          view._wantDensity = false;
          view._wantLight = false;
          if (doDensity) {
            view.uploadEditIfDirty();
            await this.renderer.computeAsync(view.densityCompute);
          }
          if (doLight) await this.renderer.computeAsync(view.lightCompute);
          this.invalidate();
        }
      } catch (err) {
        console.error('recompute failed', err);
        this.emit('error', String((err && err.message) || err));
      } finally {
        view._running = false;
        this.emit('computing', false);
      }
    })();
  }

  /** 等待视图排队的重算全部完成(重建/销毁前调用) */
  async settleView(view) {
    if (view._runPromise) await view._runPromise.catch(() => {});
  }

  eachView(fn) {
    fn(this.liveView);
    if (this.compareView) fn(this.compareView);
  }

  // ---------------- 设置应用 ----------------
  applyNoise(key, value) {
    this.settings.noise[key] = value;
    const u = this.liveView.noiseU;
    const map = {
      seed: 'uSeed', shellRadius: 'uShellRadius', expansion: 'uExpansion',
      shellThickness: 'uShellThickness', shellDensity: 'uShellDensity',
      coreDensity: 'uCoreDensity', coreFade: 'uCoreFade',
      turbScale: 'uTurbScale', turbStrength: 'uTurbStrength', turbFlow: 'uTurbFlow',
    };
    if (map[key]) u[map[key]].value = value;
    this.scheduleRecompute(this.liveView, { light: true });
  }

  applyRender(key, value) {
    this.settings.render[key] = value;
    const s = this.shared;
    if (key === 'steps') s.uSteps.value = value;
    else if (key === 'extinction') {
      s.uExtinction.value = value;
      this.eachView((v) => this.scheduleLightRecompute(v)); // 光照烘焙用到消光系数
    } else if (key === 'albedo') s.uAlbedo.value = value;
    else if (key === 'exposure') s.uExposure.value = value;
    else if (key === 'bgColor') {
      s.uBgColor.value.set(value);
      this.renderer.setClearColor(new Color(value));
    }
    this.invalidate();
  }

  applyLight(key, value) {
    this.settings.light[key] = value;
    const s = this.shared;
    const L = this.settings.light;
    if (key === 'azimuth' || key === 'elevation') {
      s.uLightDir.value.copy(lightDirFromAngles(L.azimuth, L.elevation));
      this.eachView((v) => this.scheduleLightRecompute(v));
    } else if (key === 'aoStrength') {
      s.uAoStrength.value = value;
      this.eachView((v) => this.scheduleLightRecompute(v));
    } else if (key === 'lightSteps') {
      s.uLightSteps.value = value;
      this.eachView((v) => this.scheduleLightRecompute(v));
    } else if (key === 'color') s.uLightColor.value.set(value);
    else if (key === 'intensity') s.uLightIntensity.value = value;
    else if (key === 'ambientColor') s.uAmbientColor.value.set(value);
    else if (key === 'ambientIntensity') s.uAmbientIntensity.value = value;
    else if (key === 'phaseG') s.uPhaseG.value = value;
    this.invalidate();
  }

  applyBrush(key, value) {
    this.settings.brush[key] = value;
  }

  setFrame(f) {
    this.settings.frame = f;
    this.shared.uTime.value = f / (FRAME_COUNT - 1);
    this.eachView((v) => this.scheduleRecompute(v, { light: true }));
  }

  async setResolution(n) {
    if (n === this.settings.resolution) return;
    this.settings.resolution = n;
    await this.settleView(this.liveView);
    const strokes = this.liveView.strokes;
    this.liveView.dispose();
    this.liveView = new VolumeView(this.shared, n, this.settings.noise);
    this.liveView.strokes = strokes;
    if (strokes.length) this.liveView.rebuildEditData();
    if (this.compareView) {
      await this.settleView(this.compareView);
      const snapStrokes = this.compareView.strokes;
      const snapNoise = this._snapshotNoise;
      this.compareView.dispose();
      this.compareView = new VolumeView(this.shared, n, snapNoise);
      this.compareView.strokes = snapStrokes;
      if (snapStrokes.length) this.compareView.rebuildEditData();
      await this.recompute(this.compareView, { light: true });
    }
    await this.recompute(this.liveView, { light: true });
  }

  // ---------------- 对比视图 ----------------
  async enterCompare() {
    if (this.compareMode) return;
    this.compareMode = true;
    this._snapshotNoise = cloneSettings({ noise: this.settings.noise }).noise;
    this.compareView = new VolumeView(this.shared, this.settings.resolution, this._snapshotNoise);
    this.compareView.strokes = JSON.parse(JSON.stringify(this.liveView.strokes));
    if (this.compareView.strokes.length) this.compareView.rebuildEditData();
    await this.recompute(this.compareView, { light: true });
    this.invalidate();
  }

  exitCompare() {
    if (!this.compareMode) return;
    this.compareMode = false;
    if (this.compareView) {
      const v = this.compareView;
      this.compareView = null;
      this.settleView(v).finally(() => v.dispose());
    }
    this.invalidate();
  }

  /** 把当前状态设为对比基准 */
  async resetCompareBaseline() {
    if (!this.compareMode) return;
    this.exitCompare();
    await this.enterCompare();
  }

  // ---------------- 笔刷 ----------------
  _bindPointer() {
    const canvas = this.canvas;
    this._raycaster = new Raycaster();
    this._painting = false;
    this._currentStroke = null;
    this._lastSplat = null;

    // 捕获阶段处理:命中体积盒则进入绘制并抢先禁用轨道控制,未命中则留给 OrbitControls 旋转
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const hit = this._pickBrushPoint(e);
      if (!hit) return;
      this.controls.enabled = false;
      this._painting = true;
      this._currentStroke = { splats: [] };
      this._lastSplat = null;
      canvas.setPointerCapture(e.pointerId);
      this._applyBrushAt(hit);
    }, true);
    canvas.addEventListener('pointermove', (e) => {
      const hit = this._pickBrushPoint(e);
      if (hit) {
        this.liveView.setBrushCursor(hit.point, this.settings.brush.radius * 2, true);
        this.invalidate();
      } else {
        this.liveView.setBrushCursor(null, 0, false);
        this.invalidate();
      }
      if (!this._painting || !hit) return;
      // 按间距插值撒点,避免拖动过快出现断点
      const minDist = this.settings.brush.radius * 0.8; // 世界单位
      if (!this._lastSplat) {
        this._applyBrushAt(hit);
      } else {
        const dist = hit.point.distanceTo(this._lastSplat);
        if (dist >= minDist) {
          const steps = Math.floor(dist / minDist);
          for (let i = 1; i <= steps; i++) {
            const p = this._lastSplat.clone().lerp(hit.point, i / steps);
            this._applyBrushAt({ point: p });
          }
        }
      }
    });
    const endStroke = (e) => {
      if (!this._painting) return;
      this._painting = false;
      this.controls.enabled = true;
      if (this._currentStroke && this._currentStroke.splats.length) {
        this.liveView.strokes.push(this._currentStroke);
        this.emit('strokes');
      }
      this._currentStroke = null;
    };
    canvas.addEventListener('pointerup', endStroke);
    canvas.addEventListener('pointercancel', endStroke);
    canvas.addEventListener('pointerleave', () => {
      this.liveView.setBrushCursor(null, 0, false);
      this.invalidate();
    });
    // 滚轮调整笔刷深度 (按住 Alt) ; 否则交给 OrbitControls 缩放
    canvas.addEventListener('wheel', (e) => {
      if (!e.altKey) return;
      e.preventDefault();
      const b = this.settings.brush;
      b.depth = Math.min(1, Math.max(0, b.depth + (e.deltaY > 0 ? 0.05 : -0.05)));
      this.emit('brushDepth', b.depth);
      const hit = this._pickBrushPoint(e);
      if (hit) {
        this.liveView.setBrushCursor(hit.point, b.radius * 2, true);
        this.invalidate();
      }
    }, { passive: false });
  }

  /** 由指针位置求笔刷三维落点 (仅在可编辑视图区域命中时返回) */
  _pickBrushPoint(e) {
    const rect = this.canvas.getBoundingClientRect();
    let x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    let vw = this.width;
    if (this.compareMode) {
      vw = this.width / 2;
      if (x < vw) return null; // 左侧为基准视图,不可编辑
      x -= vw;
    }
    const ndc = new Vector2((x / vw) * 2 - 1, -(y / this.height) * 2 + 1);
    // 相机 aspect 需与拾取视口一致
    const prevAspect = this.camera.aspect;
    this.camera.aspect = vw / this.height;
    this.camera.updateProjectionMatrix();
    this._raycaster.setFromCamera(ndc, this.camera);
    this.camera.aspect = prevAspect;
    this.camera.updateProjectionMatrix();

    const ro = this._raycaster.ray.origin;
    const rd = this._raycaster.ray.direction;
    const t = rayBox(ro, rd);
    if (!t) return null;
    const [tEnter, tExit] = t;
    const depth = this.settings.brush.depth;
    const point = ro.clone().addScaledVector(rd, tEnter + depth * (tExit - tEnter));
    return { point };
  }

  _applyBrushAt(hit) {
    const b = this.settings.brush;
    const uvw = hit.point.clone().multiplyScalar(0.5).addScalar(0.5); // [-1,1] -> [0,1]
    const strength = (b.mode === 'add' ? 1 : -1) * b.strength;
    this.liveView.splat(uvw.x, uvw.y, uvw.z, b.radius, strength);
    if (this._currentStroke) {
      this._currentStroke.splats.push([uvw.x, uvw.y, uvw.z, b.radius, strength]);
    }
    this._lastSplat = hit.point.clone();
    this.scheduleRecompute(this.liveView, { light: true });
  }

  undoStroke() {
    const v = this.liveView;
    if (!v.strokes.length) return;
    v.strokes.pop();
    v.rebuildEditData();
    this.scheduleRecompute(v, { light: true });
    this.emit('strokes');
  }

  clearStrokes() {
    const v = this.liveView;
    v.strokes = [];
    v.rebuildEditData();
    this.scheduleRecompute(v, { light: true });
    this.emit('strokes');
  }

  // ---------------- 渲染 ----------------
  invalidate() {
    this._needsRender = true;
  }

  _bindResize() {
    const ro = new ResizeObserver(() => {
      const parent = this.canvas.parentElement;
      if (!parent) return;
      const w = Math.max(1, parent.clientWidth);
      const h = Math.max(1, parent.clientHeight);
      this.width = w;
      this.height = h;
      this.renderer.setSize(w, h, false);
      this.invalidate();
    });
    ro.observe(this.canvas.parentElement);
    this._resizeObserver = ro;
  }

  render() {
    const r = this.renderer;
    if (this.compareMode && this.compareView) {
      const w = Math.floor(this.width / 2);
      const h = this.height;
      r.autoClear = false;
      r.clear();
      r.setScissorTest(true);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      r.setViewport(0, 0, w, h);
      r.setScissor(0, 0, w, h);
      r.render(this.compareView.scene, this.camera); // 左: 修改前
      r.setViewport(w, 0, this.width - w, h);
      r.setScissor(w, 0, this.width - w, h);
      r.render(this.liveView.scene, this.camera); // 右: 修改后
      r.setScissorTest(false);
      r.autoClear = true;
    } else {
      this.camera.aspect = this.width / this.height;
      this.camera.updateProjectionMatrix();
      r.render(this.liveView.scene, this.camera);
    }
  }

  // ---------------- 序列帧导出 ----------------
  /** 渲染指定帧到离屏目标并读回 RGBA 像素 */
  async renderFrameToPixels(frame, width, height) {
    if (!this._exportRT || this._exportRT.width !== width || this._exportRT.height !== height) {
      if (this._exportRT) this._exportRT.dispose();
      this._exportRT = new RenderTarget(width, height, {
        format: RGBAFormat,
        type: UnsignedByteType,
        colorSpace: SRGBColorSpace,
        depthBuffer: true,
      });
    }
    const rt = this._exportRT;
    this.shared.uTime.value = frame / (FRAME_COUNT - 1);
    const view = this.liveView;
    view.uploadEditIfDirty();
    await this.renderer.computeAsync(view.densityCompute);
    await this.renderer.computeAsync(view.lightCompute);

    const prevAspect = this.camera.aspect;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setRenderTarget(rt);
    this.renderer.render(view.scene, this.camera);
    this.renderer.setRenderTarget(null);
    this.camera.aspect = prevAspect;
    this.camera.updateProjectionMatrix();

    // WebGPU copyTextureToBuffer 按纹理原点(左上)返回,与 ImageData 行序一致,无需翻转
    const pixels = await this.renderer.readRenderTargetPixelsAsync(rt, 0, 0, width, height);
    this.invalidate();
    return pixels;
  }

  /** 导出结束后恢复时间轴 */
  restoreFrame() {
    this.shared.uTime.value = this.settings.frame / (FRAME_COUNT - 1);
    this.eachView((v) => this.scheduleRecompute(v, { light: true }));
  }

  // ---------------- 序列化 ----------------
  serialize() {
    return {
      version: 1,
      settings: cloneSettings(this.settings),
      strokes: JSON.parse(JSON.stringify(this.liveView.strokes)),
    };
  }

  async loadProject(project) {
    const s = project.settings;
    this.settings = cloneSettings(s);
    // 共享 uniform 全量同步
    const sh = this.shared;
    sh.uTime.value = s.frame / (FRAME_COUNT - 1);
    sh.uSteps.value = s.render.steps;
    sh.uExtinction.value = s.render.extinction;
    sh.uAlbedo.value = s.render.albedo;
    sh.uExposure.value = s.render.exposure;
    sh.uBgColor.value.set(s.render.bgColor);
    this.renderer.setClearColor(new Color(s.render.bgColor));
    sh.uLightDir.value.copy(lightDirFromAngles(s.light.azimuth, s.light.elevation));
    sh.uLightColor.value.set(s.light.color);
    sh.uLightIntensity.value = s.light.intensity;
    sh.uAmbientColor.value.set(s.light.ambientColor);
    sh.uAmbientIntensity.value = s.light.ambientIntensity;
    sh.uAoStrength.value = s.light.aoStrength;
    sh.uPhaseG.value = s.light.phaseG;
    sh.uLightSteps.value = s.light.lightSteps;

    // 退出对比
    if (this.compareMode) this.exitCompare();

    // 重建主视图
    await this.settleView(this.liveView);
    this.liveView.dispose();
    this.liveView = new VolumeView(this.shared, s.resolution, s.noise);
    this.liveView.strokes = project.strokes || [];
    if (this.liveView.strokes.length) this.liveView.rebuildEditData();
    await this.recompute(this.liveView, { light: true });
    this.emit('strokes');
  }

  dispose() {
    this._disposed = true;
    if (this._resizeObserver) this._resizeObserver.disconnect();
    if (this.controls) this.controls.dispose();
    if (this.liveView) this.liveView.dispose();
    if (this.compareView) this.compareView.dispose();
    if (this._exportRT) this._exportRT.dispose();
    if (this.renderer) this.renderer.dispose();
  }
}

// 射线与 [-1,1]^3 盒求交,返回 [tEnter, tExit]
function rayBox(ro, rd) {
  let tmin = -Infinity;
  let tmax = Infinity;
  for (const ax of ['x', 'y', 'z']) {
    const inv = 1 / rd[ax];
    let t0 = (-1 - ro[ax]) * inv;
    let t1 = (1 - ro[ax]) * inv;
    if (t0 > t1) [t0, t1] = [t1, t0];
    tmin = Math.max(tmin, t0);
    tmax = Math.min(tmax, t1);
  }
  if (tmax <= Math.max(tmin, 0)) return null;
  return [Math.max(tmin, 0), tmax];
}
