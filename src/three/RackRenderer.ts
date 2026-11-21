/**
 * 菌棒生长实例渲染器（主模块）
 *
 * 不变量：
 * - 几何 / InstancedMesh / 每实例属性只创建一次；
 * - 温湿度变化 → update() 只重写 instanceMatrix 与实例属性缓冲，不重建任何 GPU 资源；
 * - 视角切换 → 只做相机位姿补间，实例数据原样保留；
 * - 菌膜为半透明实例材质，depthTest 参与深度排序、depthWrite=false 避免自遮挡错误。
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { RackSimulation } from '../core/RackSimulation';
import { MORPH_FIELDS } from '../core/RackSimulation';
import {
  FRUITS_PER_STICK,
  MAX_CAP_RADIUS,
  STICK_LENGTH,
  STICK_RADIUS,
} from '../core/growth';
import { mulberry32 } from '../core/mathUtils';
import {
  createCapGeometry,
  createMembraneGeometry,
  createStemGeometry,
  createStickGeometry,
} from './geometries';
import {
  CAP_FRAGMENT,
  CAP_VERTEX,
  MEMBRANE_FRAGMENT,
  MEMBRANE_VERTEX,
  STEM_FRAGMENT,
  STEM_VERTEX,
  STICK_FRAGMENT,
  STICK_VERTEX,
} from './shaders';
import type { ViewMode } from '../types';
import { BOTTOM_CLEARANCE, LAYER_SPACING } from '../core/rackLayout';
import { capMorph } from '../core/growth';

interface CameraTween {
  fromPos: THREE.Vector3;
  toPos: THREE.Vector3;
  fromTarget: THREE.Vector3;
  toTarget: THREE.Vector3;
  start: number;
  duration: number;
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export class RackRenderer {
  private readonly container: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly resizeObserver: ResizeObserver;

  private readonly stickMesh: THREE.InstancedMesh;
  private readonly membraneMesh: THREE.InstancedMesh;
  private readonly capMesh: THREE.InstancedMesh;
  private readonly stemMesh: THREE.InstancedMesh;

  private readonly materials: THREE.ShaderMaterial[] = [];
  private readonly highlightUniform: { value: number };
  private readonly timeUniform: { value: number };

  /** 每棒 3 个出菇点的本地布局：[xOff, phi] × 3（由种子确定性生成） */
  private readonly fruitLocal: Float32Array;
  private readonly total: number;
  private readonly layerCount: number;

  private readonly dummy = new THREE.Object3D();
  private readonly tmpQuat = new THREE.Quaternion();
  private readonly tmpEuler = new THREE.Euler();
  private readonly tmpPos = new THREE.Vector3();
  private readonly tmpNormal = new THREE.Vector3();
  private readonly yawQuat = new THREE.Quaternion();
  private readonly worldQuat = new THREE.Quaternion();

  private view: ViewMode = 'side';
  private tween: CameraTween | null = null;
  private rafId = 0;
  private disposed = false;
  private sim: RackSimulation | null = null;

  constructor(container: HTMLElement, sim: RackSimulation) {
    this.container = container;
    this.sim = sim;
    this.total = sim.total;
    this.layerCount = sim.config.layers;

    // ── 渲染器 / 场景 / 相机 ──────────────────────────────────────────
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setClearColor(0x101418, 1);
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(
      50,
      container.clientWidth / Math.max(1, container.clientHeight),
      0.05,
      200,
    );

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.minDistance = 1;
    this.controls.maxDistance = 60;

    // 灯光只服务于层架等标准材质；实例菌棒用自定义着色器自带光照
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const dir = new THREE.DirectionalLight(0xffffff, 1.1);
    dir.position.set(6, 12, 8);
    this.scene.add(dir);

    // ── 共享 uniforms ─────────────────────────────────────────────────
    this.highlightUniform = { value: -1 };
    this.timeUniform = { value: 0 };

    // ── 实例化网格（数量按 ≥4000 棒设计，几何全程复用）────────────────
    this.stickMesh = this.buildStickMesh();
    this.membraneMesh = this.buildMembraneMesh();
    this.capMesh = this.buildCapMesh();
    this.stemMesh = this.buildStemMesh();
    this.scene.add(this.stickMesh, this.stemMesh, this.capMesh, this.membraneMesh);

    this.buildRackFrame();
    this.buildGround();

    // ── 出菇点本地布局（确定性，快照可还原）────────────────────────────
    this.fruitLocal = new Float32Array(this.total * FRUITS_PER_STICK * 2);
    for (let i = 0; i < this.total; i++) {
      const rng = mulberry32(sim.stickParams[i]!.fruitingSeed);
      for (let j = 0; j < FRUITS_PER_STICK; j++) {
        const o = (i * FRUITS_PER_STICK + j) * 2;
        this.fruitLocal[o] = (rng() - 0.5) * STICK_LENGTH * 0.78; // 沿棒轴向偏移
        this.fruitLocal[o + 1] = (rng() - 0.5) * (Math.PI * 0.78); // 朝上半圆的方位角
      }
    }

    // 首次写入实例数据
    this.update(sim);
    this.applyCameraPose('side', false);

    // ── 自适应尺寸 ────────────────────────────────────────────────────
    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(container);

    this.loop = this.loop.bind(this);
    this.rafId = requestAnimationFrame(this.loop);
  }

  // ── 网格构建（每个类只在构造时执行一次）──────────────────────────────

  private makeMaterial(vertex: string, fragment: string, extra: Record<string, unknown>): THREE.ShaderMaterial {
    const mat = new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms: {
        uHighlightLayer: this.highlightUniform,
        uTime: this.timeUniform,
      },
      ...extra,
    });
    this.materials.push(mat);
    return mat;
  }

  private layerAttribute(): THREE.InstancedBufferAttribute {
    const data = new Float32Array(this.total);
    const { columns, rows } = this.sim!.config;
    const perLayer = columns * rows;
    for (let l = 0; l < this.layerCount; l++) {
      data.fill(l, l * perLayer, (l + 1) * perLayer);
    }
    return new THREE.InstancedBufferAttribute(data, 1);
  }

  private buildStickMesh(): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(createStickGeometry(), this.makeMaterial(STICK_VERTEX, STICK_FRAGMENT, {}), this.total);
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.geometry.setAttribute('aLayer', this.layerAttribute());
    mesh.geometry.setAttribute('aCoverage', new THREE.InstancedBufferAttribute(new Float32Array(this.total), 1));
    mesh.geometry.setAttribute('aStage', new THREE.InstancedBufferAttribute(new Float32Array(this.total), 1));
    return mesh;
  }

  private buildMembraneMesh(): THREE.InstancedMesh {
    const mat = this.makeMaterial(MEMBRANE_VERTEX, MEMBRANE_FRAGMENT, {
      transparent: true,
      depthWrite: false, // 半透明膜不写深度，靠 depthTest 与不透明菌棒正确遮挡
      depthTest: true,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.InstancedMesh(createMembraneGeometry(), mat, this.total);
    mesh.frustumCulled = false;
    mesh.renderOrder = 10; // 不透明物之后进入透明渲染队列
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.geometry.setAttribute('aLayer', this.layerAttribute());
    mesh.geometry.setAttribute('aOpacity', new THREE.InstancedBufferAttribute(new Float32Array(this.total), 1));
    return mesh;
  }

  private buildCapMesh(): THREE.InstancedMesh {
    const count = this.total * FRUITS_PER_STICK;
    const mesh = new THREE.InstancedMesh(createCapGeometry(), this.makeMaterial(CAP_VERTEX, CAP_FRAGMENT, {}), count);
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.geometry.setAttribute('aLayer', this.fruitLayerAttribute());
    mesh.geometry.setAttribute('aStage', new THREE.InstancedBufferAttribute(new Float32Array(count), 1));
    mesh.geometry.setAttribute('aMorph', new THREE.InstancedBufferAttribute(new Float32Array(count), 1));
    return mesh;
  }

  private buildStemMesh(): THREE.InstancedMesh {
    const count = this.total * FRUITS_PER_STICK;
    const mesh = new THREE.InstancedMesh(createStemGeometry(), this.makeMaterial(STEM_VERTEX, STEM_FRAGMENT, {}), count);
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.geometry.setAttribute('aLayer', this.fruitLayerAttribute());
    mesh.geometry.setAttribute('aStage', new THREE.InstancedBufferAttribute(new Float32Array(count), 1));
    return mesh;
  }

  /** 子实体实例的层位属性：每棒 3 个实例共享该棒层位 */
  private fruitLayerAttribute(): THREE.InstancedBufferAttribute {
    const { columns, rows, layers } = this.sim!.config;
    const perLayer = columns * rows;
    const data = new Float32Array(this.total * FRUITS_PER_STICK);
    for (let l = 0; l < layers; l++) {
      for (let i = l * perLayer; i < (l + 1) * perLayer; i++) {
        data.fill(l, i * FRUITS_PER_STICK, (i + 1) * FRUITS_PER_STICK);
      }
    }
    return new THREE.InstancedBufferAttribute(data, 1);
  }

  // ── 层架 / 地面（静态，标准材质）──────────────────────────────────────

  private buildRackFrame(): void {
    const { width, depth, height } = this.sim!.layout;
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x3a4450, metalness: 0.65, roughness: 0.45 });
    const group = new THREE.Group();

    const postGeo = new THREE.BoxGeometry(0.06, height, 0.06);
    const hx = width / 2 + 0.08;
    const hz = depth / 2 + 0.06;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const post = new THREE.Mesh(postGeo, frameMat);
        post.position.set(sx * hx, height / 2, sz * hz);
        group.add(post);
      }
    }

    // 每层两根横梁承托菌棒
    const beamGeo = new THREE.BoxGeometry(width + 0.2, 0.04, 0.05);
    for (let l = 0; l < this.layerCount; l++) {
      const y = BOTTOM_CLEARANCE + l * LAYER_SPACING - STICK_RADIUS - 0.02;
      for (const sz of [-1, 1]) {
        const beam = new THREE.Mesh(beamGeo, frameMat);
        beam.position.set(0, y, sz * hz);
        group.add(beam);
      }
    }
    this.scene.add(group);
  }

  private buildGround(): void {
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x1a2027, roughness: 0.95, metalness: 0 });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.01;
    this.scene.add(ground);

    const grid = new THREE.GridHelper(40, 40, 0x2c3742, 0x1d252d);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.5;
    grid.position.y = 0;
    this.scene.add(grid);
  }

  // ── 数据更新：环境/时间变化后整架按生长曲线重算形态 ──────────────────

  update(sim: RackSimulation): void {
    this.sim = sim;
    const { sticks } = sim.layout;
    const morph = sim.morphology;

    const coverageAttr = this.stickMesh.geometry.getAttribute('aCoverage') as THREE.InstancedBufferAttribute;
    const stickStageAttr = this.stickMesh.geometry.getAttribute('aStage') as THREE.InstancedBufferAttribute;
    const opacityAttr = this.membraneMesh.geometry.getAttribute('aOpacity') as THREE.InstancedBufferAttribute;
    const capStageAttr = this.capMesh.geometry.getAttribute('aStage') as THREE.InstancedBufferAttribute;
    const capMorphAttr = this.capMesh.geometry.getAttribute('aMorph') as THREE.InstancedBufferAttribute;
    const stemStageAttr = this.stemMesh.geometry.getAttribute('aStage') as THREE.InstancedBufferAttribute;

    for (let i = 0; i < this.total; i++) {
      const o = i * MORPH_FIELDS;
      const stage = morph[o]!;
      const fruiting = morph[o + 2]!;
      const capRadius = morph[o + 3]!;
      const capThickness = morph[o + 4]!;
      const stemHeight = morph[o + 5]!;
      const opacity = morph[o + 6]!;
      const layout = sticks[i]!;

      coverageAttr.setX(i, morph[o + 1]!);
      stickStageAttr.setX(i, stage);
      opacityAttr.setX(i, opacity);

      // 菌棒体 / 菌膜：水平横放 + 手工偏航
      this.dummy.position.set(layout.x, layout.y, layout.z);
      this.dummy.rotation.set(0, layout.yaw, 0);
      this.dummy.scale.set(1, 1, 1);
      this.dummy.updateMatrix();
      this.stickMesh.setMatrixAt(i, this.dummy.matrix);
      this.membraneMesh.setMatrixAt(i, this.dummy.matrix);

      this.yawQuat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), layout.yaw);

      // 3 个出菇点：菌柄沿表面法线向上，菌盖坐在菌柄顶端
      for (let j = 0; j < FRUITS_PER_STICK; j++) {
        const fo = (i * FRUITS_PER_STICK + j) * 2;
        const xOff = this.fruitLocal[fo]!;
        const phi = this.fruitLocal[fo + 1]!;
        const cosP = Math.cos(phi);
        const sinP = Math.sin(phi);
        this.tmpNormal.set(0, cosP, sinP);
        this.tmpPos.set(xOff, STICK_RADIUS * cosP, STICK_RADIUS * sinP);

        // 世界坐标 = 棒中心 + 偏航旋转 · 本地位置
        this.tmpPos.applyQuaternion(this.yawQuat);
        this.tmpPos.add(this.dummy.position);
        this.worldQuat.copy(this.yawQuat);
        this.tmpEuler.set(phi, 0, 0);
        this.tmpQuat.setFromEuler(this.tmpEuler);
        this.worldQuat.multiply(this.tmpQuat);

        const ci = i * FRUITS_PER_STICK + j;
        capStageAttr.setX(ci, stage);
        capMorphAttr.setX(ci, capMorph(stage));
        stemStageAttr.setX(ci, stage);

        // 菌柄（未出菇时缩为 0，实例保留不重建）。
        // 几何半径约 1，实例缩放直接取目标世界半径；成熟菌柄略细。
        const stemR = 0.007 * (1 - 0.2 * fruiting);
        this.dummy.position.copy(this.tmpPos);
        this.dummy.quaternion.copy(this.worldQuat);
        this.dummy.scale.set(stemR, Math.max(stemHeight, 1e-5), stemR);
        this.dummy.updateMatrix();
        this.stemMesh.setMatrixAt(ci, this.dummy.matrix);

        // 菌盖：几何为单位穹顶（半径 1、高 1），x/z 缩放到盖半径、
        // y 缩放到盖厚（顶点着色器再按 aMorph 调整穹顶高低）。
        // 原基期保留一个极小纽扣点，避免零缩放矩阵。
        const capBase = this.tmpNormal.clone().applyQuaternion(this.yawQuat).multiplyScalar(stemHeight);
        this.dummy.position.copy(this.tmpPos).add(capBase);
        this.dummy.quaternion.copy(this.worldQuat);
        const r = Math.max(capRadius, MAX_CAP_RADIUS * 0.08 * smooth01(stage));
        this.dummy.scale.set(r, Math.max(capThickness, 1e-5), r);
        this.dummy.updateMatrix();
        this.capMesh.setMatrixAt(ci, this.dummy.matrix);
      }
    }

    // 统一上传缓冲
    this.stickMesh.instanceMatrix.needsUpdate = true;
    this.membraneMesh.instanceMatrix.needsUpdate = true;
    this.capMesh.instanceMatrix.needsUpdate = true;
    this.stemMesh.instanceMatrix.needsUpdate = true;
    for (const attr of [coverageAttr, stickStageAttr, opacityAttr, capStageAttr, capMorphAttr, stemStageAttr]) {
      attr.needsUpdate = true;
    }
  }

  // ── 视角切换：仅相机补间，实例数据不重建 ─────────────────────────────

  setView(view: ViewMode): void {
    if (view === this.view) return;
    this.view = view;
    this.applyCameraPose(view, true);
  }

  getView(): ViewMode {
    return this.view;
  }

  private applyCameraPose(view: ViewMode, animated: boolean): void {
    const sim = this.sim;
    if (!sim) return;
    const { width, depth, height } = sim.layout;
    const target = new THREE.Vector3(0, height * 0.45, 0);

    // 俯视必须重设 up：相机沿 +Y 俯视时默认 (0,1,0) up 与视线平行会退化，
    // 改用 +Z 作为画面上方（机架长度 X 横向铺开）。
    this.camera.up.set(0, view === 'top' ? 0 : 1, view === 'top' ? 1 : 0);

    let pos: THREE.Vector3;
    if (view === 'top') {
      // 距离取机架长宽的较大值，保证 50° FOV 下整架入镜
      const topDist = Math.max(width, depth) * 1.15 + 1;
      pos = new THREE.Vector3(0, topDist, 0.001);
    } else {
      const dist = Math.max(width, depth) * 1.45 + 2;
      pos = new THREE.Vector3(0, height * 0.75, dist);
    }

    if (!animated) {
      this.camera.position.copy(pos);
      this.controls.target.copy(target);
      this.controls.update();
      return;
    }

    this.controls.enabled = false;
    this.tween = {
      fromPos: this.camera.position.clone(),
      toPos: pos,
      fromTarget: this.controls.target.clone(),
      toTarget: target,
      start: performance.now(),
      duration: 700,
    };
  }

  /**
   * 快照载入 / 重置：替换模拟对象并复算出菇点布局。
   * InstancedMesh、几何、材质全部保留 — 实例数据原地重写，不做 GPU 资源重建。
   */
  bindSimulation(sim: RackSimulation): void {
    if (sim.total !== this.total) {
      throw new Error('载入快照的菇架规模（菌棒数量）与当前渲染器不一致');
    }
    this.sim = sim;
    for (let i = 0; i < this.total; i++) {
      const rng = mulberry32(sim.stickParams[i]!.fruitingSeed);
      for (let j = 0; j < FRUITS_PER_STICK; j++) {
        const o = (i * FRUITS_PER_STICK + j) * 2;
        this.fruitLocal[o] = (rng() - 0.5) * STICK_LENGTH * 0.78;
        this.fruitLocal[o + 1] = (rng() - 0.5) * (Math.PI * 0.78);
      }
    }
    this.update(sim);
  }

  /** 对比视图：高亮差异最大的层位（-1 取消高亮） */
  setHighlightLayer(layer: number): void {
    this.highlightUniform.value = layer;
  }

  // ── 渲染循环 / 尺寸 / 释放 ──────────────────────────────────────────

  private loop(): void {
    if (this.disposed) return;
    this.rafId = requestAnimationFrame(this.loop);
    this.timeUniform.value = performance.now() / 1000;

    if (this.tween) {
      const t = Math.min(1, (performance.now() - this.tween.start) / this.tween.duration);
      const k = easeInOutCubic(t);
      this.camera.position.lerpVectors(this.tween.fromPos, this.tween.toPos, k);
      this.controls.target.lerpVectors(this.tween.fromTarget, this.tween.toTarget, k);
      if (t >= 1) {
        this.tween = null;
        this.controls.enabled = true;
      }
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  private handleResize(): void {
    const w = this.container.clientWidth;
    const h = Math.max(1, this.container.clientHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    const geos = new Set<THREE.BufferGeometry>();
    this.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) geos.add(mesh.geometry);
    });
    geos.forEach((g) => g.dispose());
    this.materials.forEach((m) => m.dispose());
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

/** stage 极早期给菌盖一个几乎不可见的起点尺寸，避免 0 缩放矩阵 */
function smooth01(stage: number): number {
  const t = Math.min(1, Math.max(0, stage / 0.5));
  return t * t * (3 - 2 * t);
}
