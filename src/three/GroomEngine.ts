import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast, type MeshBVH } from 'three-mesh-bvh';
import {
  TERRAIN_SEGMENTS,
  VERTEX_BUDGET_PER_FRAME,
  WORLD_SIZE,
  ZONE_GRID,
  ZONE_SIZE,
  ZONE_COLORS,
  BLADE_SPECS,
  SNOW_SPECS,
  PATH_SAMPLE_STEP,
} from './constants';
import { heightAt, normalAt } from './terrain';
import { GroomDeform } from './groomDeform';
import { createTerrainMaterials, type TerrainMaterialHandles } from './terrainMaterial';
import { resamplePath } from './path';
import { useGroomStore } from '../store';
import type {
  Annotation,
  BladeAngle,
  MeasureResult,
  PathControlPoint,
  SnowCondition,
  ToolMode,
  ZoneId,
} from '../types';

// three-mesh-bvh 注入 Mesh 的射线加速能力
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const HALF = WORLD_SIZE / 2;
const PILE_POOL = 900;
const REFIT_INTERVAL_MS = 180;

interface Pile {
  x: number;
  y: number;
  z: number;
  scale: number;
}

export class GroomEngine {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private raycaster = new THREE.Raycaster();
  private pointerNdc = new THREE.Vector2();

  terrain!: THREE.Mesh;
  private fogLayer!: THREE.Mesh;
  private materials: TerrainMaterialHandles;
  deform!: GroomDeform;
  private bvh!: MeshBVH;

  private zoneGroup = new THREE.Group();
  private zoneCells = new Map<string, THREE.Mesh>();

  private pathGroup = new THREE.Group();
  private vehicle!: THREE.Group;
  private bladeMesh!: THREE.Mesh;
  private piles!: THREE.InstancedMesh;
  private pileData: Pile[] = [];
  private dummy = new THREE.Object3D();

  private measureGroup = new THREE.Group();
  private annotationGroup = new THREE.Group();

  private samples: ReturnType<typeof resamplePath> = [];
  private playhead = 0;
  /** 跨帧累积的样本推进余量（小数部分不丢失，保证任意帧率下速度一致） */
  private sampleCarry = 0;
  private playing = false;
  private speed = 14;
  private blade: BladeAngle = 'medium';
  private snow: SnowCondition = 'dry';
  private activeZones = new Set<ZoneId>();
  private toolMode: ToolMode = 'path';

  private raf = 0;
  private lastT = 0;
  private lastRefit = 0;
  private fpsAcc = 0;
  private fpsFrames = 0;
  private onFps?: (fps: number) => void;
  private onProgress?: (percent: number, piles: number) => void;
  private onRefit?: () => void;
  private disposed = false;

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(52, container.clientWidth / container.clientHeight, 0.5, 2000);
    this.camera.position.set(70, 95, 120);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.48;
    this.controls.minDistance = 20;
    this.controls.maxDistance = 420;
    this.controls.target.set(0, -6, 0);

    this.scene.background = new THREE.Color(0xdfe8f1);
    const hemi = new THREE.HemisphereLight(0xffffff, 0xb8c8d6, 0.9);
    const sun = new THREE.DirectionalLight(0xfff6e8, 1.4);
    sun.position.set(-90, 140, 60);
    this.scene.add(hemi, sun);

    this.materials = createTerrainMaterials();
    this.buildTerrain();
    this.buildZones();
    this.buildVehicle();
    this.buildPiles();
    this.scene.add(this.pathGroup, this.measureGroup, this.annotationGroup);

    this.bindPointer();
    window.addEventListener('resize', this.handleResize);

    this.lastT = performance.now();
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  // ---------- 场景构建 ----------

  private buildTerrain() {
    const seg = TERRAIN_SEGMENTS;
    const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const baseY = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const y = heightAt(x, z);
      pos.setY(i, y);
      baseY[i] = y;
    }
    this.deform = new GroomDeform(baseY);

    geo.setAttribute('aGroomed', new THREE.BufferAttribute(new Float32Array(pos.count), 1));
    const guv = new Float32Array(pos.count * 2);
    geo.setAttribute('aGuv', new THREE.BufferAttribute(guv, 2));
    geo.computeVertexNormals();
    geo.computeBoundsTree({ maxDepth: 40 });
    this.bvh = geo.boundsTree as unknown as MeshBVH;

    this.terrain = new THREE.Mesh(geo, this.materials.material);
    this.terrain.renderOrder = 0;
    this.scene.add(this.terrain);

    // 雾层：同一几何、半透明材质，不写深度，由深度测试保证遮挡正确
    this.fogLayer = new THREE.Mesh(geo, this.materials.fogMaterial);
    this.fogLayer.renderOrder = 2;
    this.scene.add(this.fogLayer);
  }

  private buildZones() {
    const cell = ZONE_SIZE;
    const geo = new THREE.PlaneGeometry(cell * 0.96, cell * 0.96);
    geo.rotateX(-Math.PI / 2);
    for (let ix = 0; ix < ZONE_GRID; ix++) {
      for (let iz = 0; iz < ZONE_GRID; iz++) {
        const cx = -HALF + cell * (ix + 0.5);
        const cz = -HALF + cell * (iz + 0.5);
        const mat = new THREE.MeshBasicMaterial({
          color: ZONE_COLORS[iz * ZONE_GRID + ix],
          transparent: true,
          opacity: 0.22,
          depthWrite: false,
        });
        const m = new THREE.Mesh(geo, mat);
        m.position.set(cx, heightAt(cx, cz) + 0.35, cz);
        m.renderOrder = 1;
        m.userData.zone = { ix, iz };
        this.zoneGroup.add(m);
        this.zoneCells.set(`${ix}:${iz}`, m);
      }
    }
    // 分区边界线
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k <= ZONE_GRID; k++) {
      const t = -HALF + k * cell;
      pts.push(new THREE.Vector3(-HALF, 0.5, t), new THREE.Vector3(HALF, 0.5, t));
      pts.push(new THREE.Vector3(t, 0.5, -HALF), new THREE.Vector3(t, 0.5, HALF));
    }
    const lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
    const lines = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ color: 0x4a7aa6, transparent: true, opacity: 0.5 }));
    this.zoneGroup.add(lines);
    this.scene.add(this.zoneGroup);
  }

  private buildVehicle() {
    this.vehicle = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xd84b2a, roughness: 0.55, metalness: 0.15 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x2c3540, roughness: 0.8 });

    const body = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.5, 5.2), bodyMat);
    body.position.y = 1.6;
    const cab = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.4, 2.4), new THREE.MeshStandardMaterial({ color: 0xf0f3f6, roughness: 0.4 }));
    cab.position.set(0, 2.9, -0.4);
    const treadGeo = new THREE.BoxGeometry(0.7, 0.9, 5.6);
    const treadL = new THREE.Mesh(treadGeo, darkMat);
    treadL.position.set(-1.9, 0.7, 0);
    const treadR = treadL.clone();
    treadR.position.x = 1.9;

    // 压雪刀头：宽度随档位变化
    this.bladeMesh = new THREE.Mesh(
      new THREE.BoxGeometry(BLADE_SPECS.medium.width, 0.5, 0.8),
      new THREE.MeshStandardMaterial({ color: 0x5a6b7d, roughness: 0.45, metalness: 0.5 })
    );
    this.bladeMesh.position.set(0, 0.35, 3.1);

    this.vehicle.add(body, cab, treadL, treadR, this.bladeMesh);
    this.vehicle.visible = false;
    this.scene.add(this.vehicle);
  }

  private buildPiles() {
    // 残雪堆积：实例化雪球池，沿刀头两侧碎雪带投放，湿雪保持率更高
    const geo = new THREE.IcosahedronGeometry(0.55, 1);
    const mat = new THREE.MeshStandardMaterial({ color: 0xeef4fa, roughness: 0.95 });
    this.piles = new THREE.InstancedMesh(geo, mat, PILE_POOL);
    this.piles.count = 0;
    this.piles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.piles.frustumCulled = false;
    this.scene.add(this.piles);
  }

  // ---------- 对外配置 ----------

  setCallbacks(cb: { onFps?: (n: number) => void; onProgress?: (p: number, piles: number) => void; onRefit?: () => void }) {
    this.onFps = cb.onFps;
    this.onProgress = cb.onProgress;
    this.onRefit = cb.onRefit;
  }

  setToolMode(m: ToolMode) {
    this.toolMode = m;
    this.renderer.domElement.style.cursor = m === 'none' ? 'default' : 'crosshair';
  }

  setActiveZones(zones: Set<ZoneId>) {
    this.activeZones = zones;
    for (const [key, mesh] of this.zoneCells) {
      const z = mesh.userData.zone as ZoneId;
      const on = this.isZoneActive(z);
      const mat = mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = on ? 0.22 : 0.05;
      mat.color.set(on ? ZONE_COLORS[z.iz * ZONE_GRID + z.ix] : 0x9aa8b5);
    }
  }

  private isZoneActive(z: ZoneId): boolean {
    for (const q of this.activeZones) if (q.ix === z.ix && q.iz === z.iz) return true;
    return false;
  }

  setBlade(b: BladeAngle) {
    this.blade = b;
    this.bladeMesh.scale.x = BLADE_SPECS[b].width / BLADE_SPECS.medium.width;
  }

  setSnow(s: SnowCondition) {
    this.snow = s;
  }

  setSpeed(v: number) {
    this.speed = v;
  }

  setFogVisible(v: boolean) {
    this.materials.setFogVisible(v);
  }

  setCorduroyVisible(v: boolean) {
    this.materials.setCorduroyVisible(v);
  }

  setWireframe(v: boolean) {
    this.materials.setWireframe(v);
  }

  // ---------- 路径 ----------

  setPath(controlPoints: PathControlPoint[]) {
    this.samples = resamplePath(controlPoints);
    this.playhead = 0;
    this.sampleCarry = 0;
    this.rebuildPathVisual(controlPoints);
    this.updateVehicle();
  }

  private rebuildPathVisual(controlPoints: PathControlPoint[]) {
    this.pathGroup.clear();
    if (this.samples.length === 0) return;

    // 路径主线：Line 对退化/共线点更健壮（TubeGeometry 在共线点上会抛异常）
    const linePts = this.samples.map((s) => new THREE.Vector3(s.x, heightAt(s.x, s.z) + 0.6, s.z));
    const lineGeo = new THREE.BufferGeometry().setFromPoints(linePts);
    const line = new THREE.Line(
      lineGeo,
      new THREE.LineBasicMaterial({ color: 0x2f7ed8, transparent: true, opacity: 0.9 })
    );
    this.pathGroup.add(line);

    const cpGeo = new THREE.SphereGeometry(0.9, 12, 12);
    const cpMat = new THREE.MeshBasicMaterial({ color: 0x1b4f8a });
    for (const p of controlPoints) {
      const m = new THREE.Mesh(cpGeo, cpMat);
      m.position.set(p.x, heightAt(p.x, p.z) + 0.9, p.z);
      this.pathGroup.add(m);
    }
  }

  // ---------- 播放控制 ----------

  play() {
    if (this.samples.length === 0) return;
    if (this.playhead >= this.samples.length) {
      this.playhead = 0;
      this.sampleCarry = 0;
    }
    this.playing = true;
    this.vehicle.visible = true;
  }

  pause() {
    this.playing = false;
  }

  /**
   * 确定性单步推进（固定 dt，不依赖渲染帧率）。
   * 供任务复压校验与自动化测试使用；返回是否已到达路径终点。
   */
  stepGroom(dt: number): boolean {
    if (this.samples.length === 0) return true;
    this.vehicle.visible = true;
    this.advanceGroom(dt);
    this.flushDeformation(performance.now());
    useGroomStore.getState().setPlayhead(this.playhead);
    return this.playhead >= this.samples.length;
  }

  stop() {
    this.playing = false;
    this.playhead = 0;
    this.sampleCarry = 0;
    this.updateVehicle();
  }

  /** 全量复位刀纹（重置任务） */
  resetDeformation() {
    const geo = this.terrain.geometry;
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const nrm = geo.attributes.normal as THREE.BufferAttribute;
    this.deform.resetAll(pos.array as Float32Array, nrm.array as Float32Array);
    pos.needsUpdate = true;
    nrm.needsUpdate = true;
    this.bvh.refit();
    this.playhead = 0;
    this.sampleCarry = 0;
    this.playing = false;
    this.vehicle.visible = false;
    this.pileData = [];
    this.piles.count = 0;
    this.clearGroomedAttributes();
    this.onProgress?.(0, 0);
  }

  private clearGroomedAttributes() {
    const geo = this.terrain.geometry;
    const g = geo.attributes.aGroomed as THREE.BufferAttribute;
    (g.array as Float32Array).fill(0);
    g.needsUpdate = true;
  }

  // ---------- 主循环 ----------

  private loop(now: number) {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, (now - this.lastT) / 1000);
    this.lastT = now;

    if (this.playing) this.advanceGroom(dt);
    this.flushDeformation(now);

    this.controls.update();
    this.renderer.render(this.scene, this.camera);

    this.fpsAcc += dt;
    this.fpsFrames++;
    if (this.fpsAcc >= 0.5) {
      this.onFps?.(Math.round(this.fpsFrames / this.fpsAcc));
      this.fpsAcc = 0;
      this.fpsFrames = 0;
    }
  }

  /** 按速度推进压雪机，逐样本标记刀纹覆盖区 */
  private advanceGroom(dt: number) {
    // 速度（米/秒）/ 样本间距 = 每秒应推进的样本数；余量跨帧累积
    this.sampleCarry += (this.speed / PATH_SAMPLE_STEP) * dt;
    while (this.sampleCarry >= 1 && this.playhead < this.samples.length) {
      const s = this.samples[this.playhead];
      this.deform.markSample(s, this.blade, this.snow, this.activeZones, ZONE_GRID);
      this.stampGroomed();
      this.maybeSpawnPile(s);
      this.playhead++;
      this.sampleCarry -= 1;
    }

    if (this.playhead >= this.samples.length) {
      this.playing = false;
      this.onProgress?.(100, this.pileData.length);
    } else {
      this.reportProgress();
    }
    this.updateVehicle();
  }

  /** 作业进度按路径完成度计（压雪是沿路径的窄带作业，顶点占比不代表进度） */
  private reportProgress() {
    const pct = this.samples.length ? (this.playhead / this.samples.length) * 100 : 0;
    this.onProgress?.(Math.round(pct * 10) / 10, this.pileData.length);
  }

  /**
   * 把本帧新压顶点写入 aGroomed 与刀纹 UV。
   * UV 在行进坐标系中度量：v 取弧长相位 -> 拐弯处棱纹随方向旋转且连续。
   */
  private stampGroomed() {
    const geo = this.terrain.geometry;
    const gAttr = geo.attributes.aGroomed as THREE.BufferAttribute;
    const guvAttr = geo.attributes.aGuv as THREE.BufferAttribute;
    const d = this.deform;
    for (const idx of d.dirty) {
      if (d.state[idx] === 0) continue;
      gAttr.setX(idx, 1);
      const spacing = d.vSpacing[idx];
      const halfW = d.vHalfW[idx];
      const gu = d.lat[idx] / (halfW * 2) + 0.5;
      const gv = (d.phase[idx] % spacing) / spacing;
      guvAttr.setXY(idx, gu, gv);
    }
    gAttr.needsUpdate = true;
    guvAttr.needsUpdate = true;
  }

  /** 沿刀头两侧投放残雪堆，湿雪保持率更高、堆更大 */
  private maybeSpawnPile(s: { x: number; z: number; hx: number; hz: number; s: number }) {
    if (this.pileData.length >= PILE_POOL) return;
    const retention = SNOW_SPECS[this.snow].pileRetention;
    // 干雪约 35% 样本产堆，湿雪约 60%
    const chance = 0.35 * retention + 0.25;
    const hash = Math.sin(s.s * 71.3) * 43758.5;
    if (hash - Math.floor(hash) > chance) return;

    const spec = BLADE_SPECS[this.blade];
    const side = hash - Math.floor(hash) > 0.5 ? 1 : -1;
    const px = s.x + -s.hz * side * (spec.width / 2 + 0.5);
    const pz = s.z + s.hx * side * (spec.width / 2 + 0.5);
    const py = heightAt(px, pz) + 0.25;
    const scale = (0.5 + 0.5 * retention) * (0.7 + (hash - Math.floor(hash)) * 0.6);
    this.pileData.push({ x: px, y: py, z: pz, scale });

    this.dummy.position.set(px, py, pz);
    this.dummy.scale.setScalar(scale);
    this.dummy.rotation.set(0, s.s, 0);
    this.dummy.updateMatrix();
    const i = this.piles.count;
    this.piles.setMatrixAt(i, this.dummy.matrix);
    this.piles.count = i + 1;
    this.piles.instanceMatrix.needsUpdate = true;
  }

  /** 每帧按顶点预算消费脏队列，节流触发 BVH 局部 refit */
  private flushDeformation(now: number) {
    if (this.deform.dirty.size === 0) {
      // 队列清空但仍有三角形未 refit（最后一批），补一次局部刷新
      if (this.deform.dirtyTris.size > 0 && now - this.lastRefit > 40) {
        this.bvh.refit(this.deform.takeDirtyTris());
        this.onRefit?.();
        this.lastRefit = now;
      }
      return;
    }
    const geo = this.terrain.geometry;
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const nrm = geo.attributes.normal as THREE.BufferAttribute;

    this.deform.flushBudget(pos.array as Float32Array, nrm.array as Float32Array, VERTEX_BUDGET_PER_FRAME);
    pos.needsUpdate = true;
    nrm.needsUpdate = true;

    // 局部刷新 BVH：只 refit 受影响三角形，节流到 REFIT_INTERVAL_MS
    if (now - this.lastRefit > REFIT_INTERVAL_MS) {
      const tris = this.deform.takeDirtyTris();
      if (tris.size > 0) {
        this.bvh.refit(tris);
        this.onRefit?.();
      }
      this.lastRefit = now;
      this.reportProgress();
    }
  }

  private updateVehicle() {
    if (this.samples.length === 0) {
      this.vehicle.visible = false;
      return;
    }
    const idx = Math.min(this.playhead, this.samples.length - 1);
    const s = this.samples[idx];
    this.vehicle.visible = true;
    this.vehicle.position.set(s.x, heightAt(s.x, s.z), s.z);
    // 朝向行进方向（局部 +z 为刀头方向）
    this.vehicle.rotation.y = Math.atan2(s.hx, s.hz);
  }

  // ---------- 拾取：路径绘制 / 测距 / 贴地标注 ----------

  private bindPointer() {
    // 捕获阶段处理拾取；合成/非可信事件（自动化测试）阻止冒泡到 OrbitControls，
    // 避免其对不存在的指针调用 setPointerCapture 抛错；真实鼠标 isTrusted=true 不受影响
    this.renderer.domElement.addEventListener('pointerdown', this.handlePointer, true);
  }

  private pickTerrain(clientX: number, clientY: number): THREE.Vector3 | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    const hit = this.raycaster.intersectObject(this.terrain, false)[0];
    return hit ? hit.point.clone() : null;
  }

  onPickPath?: (x: number, z: number) => void;
  onPickMeasure?: (a: THREE.Vector3, b: THREE.Vector3, result: MeasureResult) => void;
  onPickAnnotation?: (a: Annotation) => void;

  private measureA: THREE.Vector3 | null = null;

  private handlePointer = (e: PointerEvent) => {
    if (e.button !== 0) return;
    if (!e.isTrusted) e.stopPropagation();
    const p = this.pickTerrain(e.clientX, e.clientY);
    if (!p) return;
    const z: ZoneId = {
      ix: Math.min(ZONE_GRID - 1, Math.max(0, Math.floor((p.x + HALF) / ZONE_SIZE))),
      iz: Math.min(ZONE_GRID - 1, Math.max(0, Math.floor((p.z + HALF) / ZONE_SIZE))),
    };

    if (this.toolMode === 'path') {
      if (!this.isZoneActive(z)) return;
      this.onPickPath?.(p.x, p.z);
    } else if (this.toolMode === 'measure') {
      if (!this.measureA) {
        this.measureA = p;
      } else {
        const result = this.computeMeasure(this.measureA, p);
        this.onPickMeasure?.(this.measureA, p, result);
        this.measureA = null;
      }
    } else if (this.toolMode === 'annotate') {
      this.onPickAnnotation?.({ id: '', x: p.x, y: p.y, z: p.z, text: '新标注' });
    }
  };

  /** 直线 + 贴地采样距离 + 高差 */
  private computeMeasure(a: THREE.Vector3, b: THREE.Vector3): MeasureResult {
    const straight = a.distanceTo(b);
    const steps = Math.max(8, Math.ceil(straight / 1.2));
    let ground = 0;
    let prev = heightAt(a.x, a.z);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = a.x + (b.x - a.x) * t;
      const z = a.z + (b.z - a.z) * t;
      const h = heightAt(x, z);
      ground += Math.hypot(straight / steps, h - prev);
      prev = h;
    }
    return { straight, ground, drop: heightAt(a.x, a.z) - heightAt(b.x, b.z) };
  }

  showMeasure(a: THREE.Vector3 | null, b: THREE.Vector3 | null) {
    this.measureGroup.clear();
    if (!a || !b) return;
    const geo = new THREE.BufferGeometry().setFromPoints([a.clone().add(new THREE.Vector3(0, 1, 0)), b.clone().add(new THREE.Vector3(0, 1, 0))]);
    this.measureGroup.add(new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xe8a13a })));
    const sph = new THREE.SphereGeometry(0.8, 10, 10);
    const mat = new THREE.MeshBasicMaterial({ color: 0xe8a13a });
    const m1 = new THREE.Mesh(sph, mat);
    m1.position.copy(a).y += 1;
    const m2 = m1.clone();
    m2.position.copy(b).y += 1;
    this.measureGroup.add(m1, m2);
  }

  showAnnotations(list: Annotation[]) {
    this.annotationGroup.clear();
    for (const a of list) {
      const sprite = this.makeLabelSprite(a.text);
      sprite.position.set(a.x, a.y + 2.2, a.z);
      this.annotationGroup.add(sprite);
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.08, 0.08, 2, 6),
        new THREE.MeshBasicMaterial({ color: 0x445566 })
      );
      pole.position.set(a.x, a.y + 1, a.z);
      this.annotationGroup.add(pole);
    }
  }

  private makeLabelSprite(text: string): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 80;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'rgba(30,45,60,0.82)';
    ctx.roundRect(4, 8, 248, 64, 12);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 30px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text.slice(0, 10), 128, 40);
    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: tex, depthTest: true, depthWrite: false });
    const sp = new THREE.Sprite(mat);
    sp.scale.set(10, 3.2, 1);
    sp.renderOrder = 3;
    return sp;
  }

  // ---------- 生命周期 ----------

  private handleResize = () => {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.handleResize);
    this.renderer.domElement.removeEventListener('pointerdown', this.handlePointer, true);
    this.controls.dispose();
    this.terrain.geometry.disposeBoundsTree?.();
    this.materials.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

export { normalAt };
