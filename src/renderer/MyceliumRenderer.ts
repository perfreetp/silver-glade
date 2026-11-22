import { WebGPURenderer } from 'three/webgpu';
import { WebGLRenderer } from 'three';
import {
  AdditiveBlending,
  CircleGeometry,
  Color,
  DataTexture,
  Group,
  MOUSE,
  Mesh,
  MeshBasicMaterial,
  NormalBlending,
  OrthographicCamera,
  RGBAFormat,
  RingGeometry,
  Scene,
  SRGBColorSpace,
  UnsignedByteType,
  Vector3,
  type WebGLRenderer as TWebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  CellType,
  LEVEL_ALPHAS,
  LEVEL_COLORS,
  LEVEL_THRESHOLDS,
  type InoculationPoint,
  type Snapshot,
} from '../sim/types';
import { decodeRLE } from '../sim/codec';

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`WebGPU 初始化超时（${ms} ms）`)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * 菌丝扩散渲染器（主模块）。
 *
 * 场景：菌包横截面环形基质（中心气孔 + 圆形外缘），正视 2.5D，可缩放/平移。
 * 渲染：浓度场量化为 5 级，每级一张半透明层，按级从低到高叠加；
 *       每层用独立 alpha 蒙版 DataTexture，NormalBlending + depthWrite=false，
 *       保证多层半透明菌丝按物理顺序正确合成。
 * 后端：优先 WebGPURenderer，不可用时回退 WebGLRenderer。
 */
export class MyceliumRenderer {
  private readonly container: HTMLElement;
  private renderer!: WebGPURenderer | TWebGLRenderer;
  private rendererKind: 'webgpu' | 'webgl' = 'webgpu';
  private readonly scene = new Scene();
  private readonly camera: OrthographicCamera;
  private controls!: OrbitControls;
  private readonly layerGroup = new Group();
  private layers: Mesh[] = [];
  private layerTextures: DataTexture[] = [];
  private markers: Group[] = [];
  private gridSize = 0;
  private outerR = 1;
  private holeR = 0.16;
  private cellType: Uint8Array = new Uint8Array(0);
  private decoded: Uint8Array = new Uint8Array(0);
  private levelMasks: Uint8Array[] = [];
  private raf = 0;
  private initialized = false;
  private resizeObserver: ResizeObserver;
  private pickCb: ((gx: number, gy: number) => void) | null = null;
  private holeMesh: Mesh | null = null;
  private rimMesh: Mesh | null = null;
  private domainDirty = false;
  private markersDirty = false;
  private lastSnapshot: Snapshot | null = null;
  private backendChangeCb: ((backend: string) => void) | null = null;

  /** 注册后端变更回调（WebGPU→WebGL 回退时触发）。 */
  onBackendChange(cb: (backend: string) => void): void {
    this.backendChangeCb = cb;
  }

  constructor(container: HTMLElement) {
    this.container = container;
    const w = Math.max(320, container.clientWidth);
    const h = Math.max(320, container.clientHeight);

    const aspect = w / h;
    const view = 1.15;
    this.camera = new OrthographicCamera(-view * aspect, view * aspect, view, -view, 0.1, 50);
    this.camera.position.set(0, 0, 3);
    this.camera.lookAt(0, 0, 0);

    this.scene.add(this.layerGroup);
    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(container);
    this.createRenderer('webgpu');
  }

  /** 创建指定后端的渲染器（回退时先拆除旧实例）。 */
  private createRenderer(kind: 'webgpu' | 'webgl'): void {
    const w = Math.max(320, this.container.clientWidth);
    const h = Math.max(320, this.container.clientHeight);
    if (this.renderer) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
      this.initialized = false;
      this.controls?.dispose();
      this.renderer.dispose();
      this.renderer.domElement.remove();
    }
    this.rendererKind = kind;
    if (kind === 'webgpu') {
      this.renderer = new WebGPURenderer({ antialias: true, alpha: false });
    } else {
      // preserveDrawingBuffer：保证画布可被 drawImage 读回（像素检测 / 截图导出）
      this.renderer = new WebGLRenderer({
        antialias: true,
        alpha: false,
        preserveDrawingBuffer: true,
      });
    }
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    this.renderer.setClearColor(0x101418, 1);
    this.container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableRotate = false;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.zoomSpeed = 0.9;
    this.controls.mouseButtons = {
      LEFT: null as never,
      MIDDLE: MOUSE.DOLLY,
      RIGHT: MOUSE.PAN,
    };
    this.bindPicking();
    this.backendChangeCb?.(this.backend);
  }

  get backend(): string {
    return this.rendererKind === 'webgpu' ? 'WebGPU' : 'WebGL（回退）';
  }

  /**
   * 初始化后端并启动渲染循环。
   * WebGPU 请求/初始化/首帧失败时自动回退到 WebGL，保证工具可用。
   */
  async init(): Promise<void> {
    const gpu = (navigator as Navigator & { gpu?: unknown }).gpu;
    if (this.rendererKind === 'webgpu' && !gpu) {
      this.createRenderer('webgl');
    }
    if (this.rendererKind === 'webgpu') {
      try {
        // 8 秒内未完成初始化视为该环境 WebGPU 不可用
        await withTimeout(this.webgpuInit(), 8000);
      } catch (err) {
        console.warn('WebGPU 初始化失败，回退到 WebGL：', err);
        this.createRenderer('webgl');
      }
    }
    if (this.domainDirty) {
      this.setupDomain(this.gridSize, this.holeR, this.cellType);
      if (this.lastSnapshot) this.renderSnapshot(this.lastSnapshot);
      if (this.markersDirty) this.renderMarkers(this.currentPoints);
      this.domainDirty = false;
      this.markersDirty = false;
    }
    this.initialized = true;
    this.animate();
  }

  private async webgpuInit(): Promise<void> {
    const renderer = this.renderer as WebGPURenderer;
    await renderer.init();
    // 首帧探测：部分无头/驱动环境 init 通过但实际建缓冲失败
    renderer.render(this.scene, this.camera);
  }

  private currentPoints: InoculationPoint[] = [];

  /**
   * 按格点规模构建场景几何与 5 张半透明层。
   * 菌包截面映射到 [-1,1] 平面，气孔半径按比例镂空。
   */
  setupDomain(gridSize: number, holeRatio: number, cellType: Uint8Array): void {
    if (!this.initialized) {
      // init 尚未完成（回退重建场景），标记为脏，init 后重建
      this.gridSize = gridSize;
      this.holeR = holeRatio;
      this.cellType = cellType;
      this.domainDirty = true;
      return;
    }
    this.gridSize = gridSize;
    this.cellType = cellType;
    this.domainDirty = false;
    this.outerR = (gridSize - 1) / 2 / ((gridSize - 1) / 2 - 1); // ≈1.0
    this.holeR = holeRatio * this.outerR;
    this.decoded = new Uint8Array(gridSize * gridSize);
    this.levelMasks = Array.from({ length: 5 }, () => new Uint8Array(gridSize * gridSize * 4));

    // 清空旧层
    for (const mesh of this.layers) {
      this.layerGroup.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as MeshBasicMaterial).dispose();
    }
    for (const tex of this.layerTextures) tex.dispose();
    this.layers = [];
    this.layerTextures = [];

    // 基质底盘（完整圆盘；中心气孔由上方圆盘盖住形成环）
    const baseDisk = new CircleGeometry(this.outerR, 192);
    // 深棕培养基纯色（径向质感由光照式的 rim 环与菌丝层叠加体现，避免 Canvas 纹理环境兼容问题）
    const baseMat = new MeshBasicMaterial({
      color: 0x5d4630,
      side: 2,
    });
    const baseMesh = new Mesh(baseDisk, baseMat);
    baseMesh.position.z = -0.02;
    this.layerGroup.add(baseMesh);
    this.layers.push(baseMesh);

    // 5 级菌丝半透明层：共用同一圆形几何，各持一张 alpha 蒙版纹理
    const disk = new CircleGeometry(this.outerR, 192);
    for (let k = 0; k < 5; k++) {
      const tex = new DataTexture(this.levelMasks[k]!, gridSize, gridSize, RGBAFormat, UnsignedByteType);
      tex.colorSpace = SRGBColorSpace;
      tex.needsUpdate = true;
      this.layerTextures.push(tex);

      const [r, g, b] = LEVEL_COLORS[k]!;
      const mat = new MeshBasicMaterial({
        map: tex,
        color: new Color(r / 255, g / 255, b / 255),
        transparent: true,
        opacity: 1,
        alphaMap: tex,
        blending: NormalBlending,
        depthWrite: false,
        side: 2,
      });
      // alphaMap 只采样绿通道；蒙版 RGB 三通道同值，颜色由 material.color 固定
      mat.map = null;
      mat.alphaMap = tex;
      const mesh = new Mesh(disk.clone(), mat);
      mesh.position.z = 0.01 * (k + 1);
      mesh.renderOrder = k + 1;
      this.layerGroup.add(mesh);
      this.layers.push(mesh);
    }

    // 中心气孔（深色圆盘 + 内环边）
    this.holeMesh?.geometry.dispose();
    const holeGeo = new CircleGeometry(this.holeR, 128);
    const holeMat = new MeshBasicMaterial({ color: 0x05070a, side: 2 });
    this.holeMesh = new Mesh(holeGeo, holeMat);
    this.holeMesh.position.z = 0.09;
    this.holeMesh.renderOrder = 10;
    this.layerGroup.add(this.holeMesh);

    // 外缘袋壁高亮环
    this.rimMesh?.geometry.dispose();
    const rimGeo = new RingGeometry(this.outerR * 0.985, this.outerR * 1.015, 192);
    const rimMat = new MeshBasicMaterial({
      color: 0x8fa3b5,
      transparent: true,
      opacity: 0.55,
      side: 2,
      depthWrite: false,
    });
    this.rimMesh = new Mesh(rimGeo, rimMat);
    this.rimMesh.position.z = 0.085;
    this.rimMesh.renderOrder = 9;
    this.layerGroup.add(this.rimMesh);
  }

  /** 培养基底盘为纯色材质；颗粒质感通过菌丝半透明层与外缘环体现。 */

  /** 渲染一帧快照：解码 RLE → 分级 → 更新 5 张蒙版纹理。 */
  renderSnapshot(snap: Snapshot): void {
    this.lastSnapshot = snap;
    if (this.gridSize === 0) return;
    decodeRLE(snap.bytes, this.decoded);
    const n = this.gridSize;

    for (let k = 0; k < 5; k++) {
      const [lo, hi] = LEVEL_THRESHOLDS[k]!;
      const mask = this.levelMasks[k]!;
      const alpha = LEVEL_ALPHAS[k]! * 255;
      for (let i = 0; i < n * n; i++) {
        const c = this.decoded[i]!;
        const inside = this.cellType[i] === CellType.Substrate;
        const on = inside && c >= lo && c < hi ? alpha : 0;
        const j = i * 4;
        mask[j] = on;
        mask[j + 1] = on;
        mask[j + 2] = on;
        mask[j + 3] = 255;
      }
      const tex = this.layerTextures[k]!;
      tex.needsUpdate = true;
    }
  }

  /** 更新接种点标记（红圈 + 编号）。 */
  renderMarkers(points: InoculationPoint[]): void {
    this.currentPoints = points;
    if (!this.initialized) {
      this.markersDirty = true;
      return;
    }
    for (const g of this.markers) {
      this.layerGroup.remove(g);
      g.traverse((o) => {
        if (o instanceof Mesh) {
          o.geometry.dispose();
          (o.material as MeshBasicMaterial).dispose();
        }
      });
    }
    this.markers = [];

    for (const pt of points) {
      const g = new Group();
      const ring = new RingGeometry(0.022, 0.034, 32);
      const mat = new MeshBasicMaterial({
        color: 0xff5a4a,
        side: 2,
        depthTest: false,
        depthWrite: false,
      });
      const m = new Mesh(ring, mat);
      m.position.z = 0.12;
      m.renderOrder = 20;
      g.add(m);

      const dot = new CircleGeometry(0.01, 20);
      const dotMat = new MeshBasicMaterial({
        color: 0xffd7d2,
        side: 2,
        depthTest: false,
        depthWrite: false,
        blending: AdditiveBlending,
      });
      const d = new Mesh(dot, dotMat);
      d.position.z = 0.121;
      d.renderOrder = 21;
      g.add(d);

      const [wx, wy] = this.gridToWorld(pt.x, pt.y);
      g.position.set(wx, wy, 0);
      this.layerGroup.add(g);
      this.markers.push(g);
    }
  }

  /** 格点坐标 → 世界坐标（截面映射到 [-1,1]，Y 翻转对齐屏幕）。 */
  gridToWorld(gx: number, gy: number): [number, number] {
    const half = (this.gridSize - 1) / 2;
    const scale = 1 / (half - 1);
    return [(gx - half) * scale, -(gy - half) * scale];
  }

  /** 世界坐标 → 格点坐标。 */
  worldToGrid(wx: number, wy: number): [number, number] {
    const half = (this.gridSize - 1) / 2;
    const scale = 1 / (half - 1);
    return [wx / scale + half, -wy / scale + half];
  }

  onPickInoculation(cb: (gx: number, gy: number) => void): void {
    this.pickCb = cb;
  }

  /** 左键点击截面 → 投射到 z=0 平面 → 格点坐标回调。 */
  private bindPicking(): void {
    const el = this.renderer.domElement;
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0 || !this.pickCb || this.gridSize === 0) return;
      const rect = el.getBoundingClientRect();
      const ndcX = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      const ndcY = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      const world = new Vector3(ndcX, ndcY, 0).unproject(this.camera);
      const [gx, gy] = this.worldToGrid(world.x, world.y);
      this.pickCb(gx, gy);
    });
  }

  private handleResize(): void {
    if (!this.renderer || !this.controls) return;
    const w = Math.max(320, this.container.clientWidth);
    const h = Math.max(320, this.container.clientHeight);
    const aspect = w / h;
    const view = 1.15;
    this.camera.left = -view * aspect;
    this.camera.right = view * aspect;
    this.camera.top = view;
    this.camera.bottom = -view;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  private animate = (): void => {
    this.raf = requestAnimationFrame(this.animate);
    try {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    } catch (err) {
      // WebGPU 驱动在运行期报错时，一次性回退到 WebGL
      if (this.rendererKind === 'webgpu') {
        console.warn('WebGPU 运行期渲染失败，回退到 WebGL：', err);
        cancelAnimationFrame(this.raf);
        this.domainDirty = true;
        this.markersDirty = true;
        this.createRenderer('webgl');
        void this.init();
      } else {
        throw err;
      }    }
  };

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    for (const mesh of this.layers) {
      mesh.geometry.dispose();
      (mesh.material as MeshBasicMaterial).dispose();
    }
    for (const tex of this.layerTextures) tex.dispose();
    this.holeMesh?.geometry.dispose();
    this.rimMesh?.geometry.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
