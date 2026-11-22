import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { LedConfig, LensConfig } from '../types';
import {
  LED_BOARD_Z,
  LED_GRID_COLS,
  LED_GRID_ROWS,
  LED_SLOT_DX,
  LED_SLOT_DY,
  LENS_RADIUS,
} from '../optics/constants';
import { buildLens } from '../optics/lensGeometry';
import type { OpticsEngine } from '../optics/tracer';

export interface Scene3DHandlers {
  onSelectLed?: (index: number | null) => void;
}

/**
 * 灯腔 3D 场景。
 * 半透明叠加顺序（three.js 透明物体按 renderOrder 升序、同序按深度排序）：
 *   1. 灯腔罩壳（最靠后、先画，depthWrite=false）
 *   2. 灯板 / LED（不透明，正常写深度）
 *   3. 透镜（最后画，physical transmission，depthWrite=false）
 * 这样 LED 与灯腔透过透镜可见，且不会被后画的透明面错误遮挡。
 */
export class LampScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private raf = 0;
  private container: HTMLElement;
  private resizeObs: ResizeObserver;

  private ledGroup = new THREE.Group();
  private ledMeshes: THREE.Mesh[] = [];
  private lensMesh: THREE.Mesh | null = null;
  private lensBuilt: LensConfig | null = null;
  private rayLines: THREE.LineSegments | null = null;
  private handlers: Scene3DHandlers;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private engine: OpticsEngine | null = null;

  constructor(container: HTMLElement, handlers: Scene3DHandlers = {}) {
    this.container = container;
    this.handlers = handlers;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(
      42,
      container.clientWidth / Math.max(1, container.clientHeight),
      0.1,
      2000,
    );
    // 从透镜前方（+z 侧）看向灯腔，视线穿过透镜到达 LED 板
    this.camera.position.set(38, 22, 68);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    // 目标落在透镜与灯板之间，使透镜（z≈0）与 LED 板（z=-22）同框
    this.controls.target.set(0, 0, -8);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.minDistance = 30;
    this.controls.maxDistance = 260;

    this.scene.background = new THREE.Color(0x10141b);
    this.setupLights();
    this.buildCavity();
    this.scene.add(this.ledGroup);
    this.bindPicking();

    this.resizeObs = new ResizeObserver(() => this.handleResize());
    this.resizeObs.observe(container);

    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    };
    loop();
  }

  setOpticsEngine(engine: OpticsEngine) {
    this.engine = engine;
  }

  private setupLights() {
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(30, 40, -30);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x88bbff, 0.9);
    rim.position.set(-25, -10, 40);
    this.scene.add(rim);
  }

  /** 灯腔：底板 + 上下左右四块半透明围壁，前侧开口朝向透镜 */
  private buildCavity() {
    const cavityW = LED_GRID_COLS * LED_SLOT_DX + 16;
    const cavityH = LED_GRID_ROWS * LED_SLOT_DY + 12;
    const depth = 30;
    const centerZ = LED_BOARD_Z + depth / 2;

    const shellMat = new THREE.MeshPhysicalMaterial({
      color: 0x2a3550,
      transparent: true,
      opacity: 0.16,
      roughness: 0.25,
      metalness: 0,
      transmission: 0.25,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    shellMat.depthWrite = false;

    const boardMat = new THREE.MeshStandardMaterial({
      color: 0x3a4456,
      roughness: 0.35,
      metalness: 0.7,
    });

    // LED 基板：略小于灯腔口径，薄而靠后，避免在前方形成大面积黑面
    const boardW = LED_GRID_COLS * LED_SLOT_DX + 6;
    const boardH = LED_GRID_ROWS * LED_SLOT_DY + 4;
    const board = new THREE.Mesh(new THREE.BoxGeometry(boardW, boardH, 0.8), boardMat);
    board.position.set(0, 0, LED_BOARD_Z - 0.6);
    this.scene.add(board);

    const wallGeoV = new THREE.BoxGeometry(1.2, cavityH, depth);
    const wallGeoH = new THREE.BoxGeometry(cavityW, 1.2, depth);
    const makeWall = (geo: THREE.BufferGeometry, x: number, y: number) => {
      const m = new THREE.Mesh(geo, shellMat);
      m.position.set(x, y, centerZ);
      m.renderOrder = 1; // 最先绘制的透明层
      this.scene.add(m);
    };
    makeWall(wallGeoV, -cavityW / 2, 0);
    makeWall(wallGeoV, cavityW / 2, 0);
    makeWall(wallGeoH, 0, cavityH / 2);
    makeWall(wallGeoH, 0, -cavityH / 2);

    // 光轴参考线
    const axisGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, LED_BOARD_Z),
      new THREE.Vector3(0, 0, 36),
    ]);
    const axis = new THREE.Line(
      axisGeo,
      new THREE.LineDashedMaterial({ color: 0x4d6a8f, dashSize: 1.2, gapSize: 0.8 }),
    );
    axis.computeLineDistances();
    this.scene.add(axis);
  }

  /** 同步 LED 阵列（位置/角度/亮度/启用/选中） */
  syncLeds(leds: LedConfig[], selectedIndex: number | null) {
    // 数量不变则复用 mesh，仅更新属性
    while (this.ledMeshes.length < leds.length) {
      const geo = new THREE.BoxGeometry(3.4, 1.7, 0.9);
      const mesh = new THREE.Mesh(
        geo,
        new THREE.MeshStandardMaterial({ color: 0xdddddd, emissive: 0xffcc66, emissiveIntensity: 1 }),
      );
      mesh.userData.ledIndex = this.ledMeshes.length;
      this.ledMeshes.push(mesh);
      this.ledGroup.add(mesh);
    }
    leds.forEach((led, i) => {
      const mesh = this.ledMeshes[i];
      mesh.visible = led.enabled;
      mesh.position.set(led.x, led.y, LED_BOARD_Z + 0.2);
      mesh.rotation.set((led.tiltX * Math.PI) / 180, (led.tiltY * Math.PI) / 180, 0);
      const mat = mesh.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = 0.25 + led.brightness * 2.2;
      const selected = i === selectedIndex;
      mat.color.set(selected ? 0x66d9ef : 0xdddddd);
      mat.emissive.set(selected ? 0x88e5ff : 0xffcc66);
    });
  }

  /** 同步透镜几何（与 OpticsEngine 共享同一构造函数，保证所见即所追） */
  syncLens(lens: LensConfig) {
    if (
      this.lensBuilt &&
      this.lensBuilt.curvature === lens.curvature &&
      this.lensBuilt.thickness === lens.thickness &&
      this.lensBuilt.ior === lens.ior
    ) {
      return;
    }
    this.lensBuilt = { ...lens };
    const built = buildLens(lens);
    if (this.lensMesh) {
      this.scene.remove(this.lensMesh);
      this.lensMesh.geometry.dispose();
      (this.lensMesh.material as THREE.Material).dispose();
    }
    const mat = new THREE.MeshPhysicalMaterial({
      color: 0x9fc8ff,
      metalness: 0,
      roughness: 0.08,
      // 无环境贴图时纯 transmission 会近全透，降到 0.7 并配淡蓝底色保证透镜轮廓可读
      transmission: 0.7,
      thickness: built.effectiveThickness,
      ior: lens.ior,
      transparent: true,
      opacity: 0.92,
      side: THREE.FrontSide,
      clearcoat: 1,
      clearcoatRoughness: 0.06,
      emissive: 0x16263f,
      emissiveIntensity: 0.6,
    });
    mat.depthWrite = false;
    const mesh = new THREE.Mesh(built.geometry, mat);
    mesh.renderOrder = 3; // 灯腔(1) 之后绘制，LED 不透明物体由深度缓冲保证正确遮挡
    this.lensMesh = mesh;
    this.scene.add(mesh);
    this.ensureLensHolder(built.effectiveThickness);
  }

  /** 透镜固定环 + 镜筒，把透镜物理上连接到灯腔前口（仅可视化，不参与求交） */
  private lensHolder: THREE.Group | null = null;
  private ensureLensHolder(thickness: number) {
    if (this.lensHolder) {
      this.scene.remove(this.lensHolder);
      this.lensHolder.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
      });
    }
    const group = new THREE.Group();
    const holderMat = new THREE.MeshStandardMaterial({
      color: 0x222a36,
      metalness: 0.85,
      roughness: 0.35,
    });
    // 外环：套在透镜口径外
    const ring = new THREE.Mesh(new THREE.TorusGeometry(LENS_RADIUS + 1.6, 1.4, 16, 64), holderMat);
    ring.position.z = thickness / 2;
    group.add(ring);
    // 镜筒：从固定环向后延伸到灯板方向的短筒壁
    const barrelLen = 22;
    const barrel = new THREE.Mesh(
      new THREE.CylinderGeometry(LENS_RADIUS + 1.6, LENS_RADIUS + 1.6, barrelLen, 64, 1, true),
      new THREE.MeshStandardMaterial({
        color: 0x1a212c,
        metalness: 0.8,
        roughness: 0.4,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
      }),
    );
    // Cylinder 默认轴向为 Y，旋转使其沿 Z
    barrel.rotation.x = Math.PI / 2;
    barrel.position.z = thickness / 2 - barrelLen / 2;
    barrel.renderOrder = 2;
    group.add(barrel);
    this.lensHolder = group;
    this.scene.add(group);
  }

  /** 重绘选中 LED 的预览光路 */
  syncRayPreview(led: LedConfig | null, wallDistance: number) {
    if (this.rayLines) {
      this.scene.remove(this.rayLines);
      this.rayLines.geometry.dispose();
      (this.rayLines.material as THREE.Material).dispose();
      this.rayLines = null;
    }
    if (!led || !led.enabled || !this.engine) return;
    const paths = this.engine.tracePreviewPaths(led, 14, wallDistance);
    const pts: THREE.Vector3[] = [];
    for (const p of paths) {
      for (let i = 0; i < p.length - 1; i++) pts.push(p[i], p[i + 1]);
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    this.rayLines = new THREE.LineSegments(
      geo,
      new THREE.LineBasicMaterial({
        color: 0xffd27a,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
      }),
    );
    this.rayLines.renderOrder = 4;
    this.scene.add(this.rayLines);
  }

  private bindPicking() {
    const dom = this.renderer.domElement;
    let downX = 0;
    let downY = 0;
    dom.addEventListener('pointerdown', (e) => {
      downX = e.clientX;
      downY = e.clientY;
    });
    dom.addEventListener('pointerup', (e) => {
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 5) return; // 拖拽视角不触发拾取
      const rect = dom.getBoundingClientRect();
      this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      this.raycaster.setFromCamera(this.pointer, this.camera);
      const hits = this.raycaster.intersectObjects(this.ledMeshes.filter((m) => m.visible), false);
      const idx = hits.length ? (hits[0].object.userData.ledIndex as number) : null;
      this.handlers.onSelectLed?.(idx);
    });
  }

  private handleResize() {
    const w = this.container.clientWidth;
    const h = Math.max(1, this.container.clientHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.resizeObs.disconnect();
    this.controls.dispose();
    // 释放场景内全部几何与材质，避免模块反复切换时显存泄漏
    this.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose();
    });
    this.renderer.dispose();
    // 显式归还 WebGL 上下文，防止多视口创建后上下文数量超限
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}
