import {
  ArcRotateCamera,
  Color3,
  Color4,
  DirectionalLight,
  DynamicTexture,
  Engine,
  HemisphericLight,
  Mesh,
  MeshBuilder,
  PointerDragBehavior,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
  VertexBuffer,
  VertexData,
  WebGPUEngine,
} from '@babylonjs/core';
import type { LinesMesh } from '@babylonjs/core';
import { watch } from 'vue';
import { store, derived } from './store';
import { heightAt } from './terrain';
import { formatChainage } from './alignment';

/** 填方(轨面高于地形)— 橙色 */
const FILL_COLOR = { r: 0.93, g: 0.55, b: 0.16 };
/** 挖方(轨面低于地形)— 蓝色 */
const CUT_COLOR = { r: 0.16, g: 0.6, b: 0.95 };

/** 地形基础色:按高度在低地绿 / 坡地褐 / 高地灰之间渐变 */
function baseColor(h: number): { r: number; g: number; b: number } {
  const stops = [
    { h: -45, r: 0.32, g: 0.5, b: 0.28 },
    { h: 0, r: 0.45, g: 0.48, b: 0.3 },
    { h: 25, r: 0.55, g: 0.48, b: 0.36 },
    { h: 45, r: 0.72, g: 0.7, b: 0.66 },
  ];
  if (h <= stops[0].h) return stops[0];
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    if (h <= b.h) {
      const t = (h - a.h) / (b.h - a.h);
      return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t };
    }
  }
  return stops[stops.length - 1];
}

export async function initScene(canvas: HTMLCanvasElement): Promise<void> {
  // 优先 WebGPU,不支持时回退 WebGL2
  let engine: Engine | WebGPUEngine;
  if (await WebGPUEngine.IsSupportedAsync) {
    const gpu = new WebGPUEngine(canvas, { antialias: true });
    await gpu.initAsync();
    engine = gpu;
    derived.engineType = 'WebGPU';
  } else {
    engine = new Engine(canvas, true);
    derived.engineType = 'WebGL2';
  }

  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.55, 0.72, 0.9, 1);

  const camera = new ArcRotateCamera('cam', -Math.PI / 2.4, Math.PI / 3.4, 2800, new Vector3(0, 0, 0), scene);
  camera.attachControl(canvas, true);
  camera.lowerRadiusLimit = 80;
  camera.upperRadiusLimit = 6000;
  camera.upperBetaLimit = Math.PI / 2.05;
  camera.wheelPrecision = 3;

  const hemi = new HemisphericLight('hemi', new Vector3(0.2, 1, 0.1), scene);
  hemi.intensity = 0.85;
  const dir = new DirectionalLight('dir', new Vector3(-0.4, -1, 0.3), scene);
  dir.intensity = 0.75;

  // ---------- 材质 ----------
  const terrainMat = new StandardMaterial('terrainMat', scene);
  terrainMat.specularColor = Color3.Black();

  const bedMat = new StandardMaterial('bedMat', scene);
  bedMat.diffuseColor = new Color3(0.5, 0.47, 0.44);
  bedMat.specularColor = Color3.Black();

  const railMat = new StandardMaterial('railMat', scene);
  railMat.diffuseColor = new Color3(0.25, 0.25, 0.28);
  railMat.specularColor = new Color3(0.4, 0.4, 0.4);

  const cpMat = new StandardMaterial('cpMat', scene);
  cpMat.emissiveColor = new Color3(1, 0.55, 0.1);
  cpMat.disableLighting = true;

  const postMat = new StandardMaterial('postMat', scene);
  postMat.diffuseColor = new Color3(0.9, 0.9, 0.9);
  postMat.specularColor = Color3.Black();

  // ---------- 地形 ----------
  let terrainMesh: Mesh | null = null;
  let terrainColors: Float32Array = new Float32Array(0);

  function buildTerrain(): void {
    const t = store.terrain;
    if (terrainMesh) {
      terrainMesh.dispose();
      terrainMesh = null;
    }
    const { size, res, heights } = t;
    const positions: number[] = new Array(res * res * 3);
    const indices: number[] = [];
    for (let r = 0; r < res; r++) {
      for (let c = 0; c < res; c++) {
        const i = r * res + c;
        positions[i * 3] = -size / 2 + (c / (res - 1)) * size;
        positions[i * 3 + 1] = heights[i];
        positions[i * 3 + 2] = size / 2 - (r / (res - 1)) * size;
      }
    }
    for (let r = 0; r < res - 1; r++) {
      for (let c = 0; c < res - 1; c++) {
        const i0 = r * res + c;
        const i1 = i0 + 1;
        const i2 = i0 + res;
        const i3 = i2 + 1;
        indices.push(i0, i1, i2, i1, i3, i2);
      }
    }
    const normals: number[] = [];
    VertexData.ComputeNormals(positions, indices, normals);
    terrainColors = new Float32Array(res * res * 4);
    const vd = new VertexData();
    vd.positions = positions;
    vd.indices = indices;
    vd.normals = normals;
    vd.colors = terrainColors;
    const mesh = new Mesh('terrain', scene);
    vd.applyToMesh(mesh, true);
    mesh.material = terrainMat;
    mesh.isPickable = false;
    terrainMesh = mesh;
    mesh.setEnabled(store.showTerrain);
    updateTerrainColors();
  }

  /** 挖填方着色:走廊带内按轨面与地形高差染橙(填)/蓝(挖) */
  function updateTerrainColors(): void {
    if (!terrainMesh) return;
    const t = store.terrain;
    const { size, res, heights } = t;
    const samples = derived.samples;
    const te = derived.trackElev;
    const halfBed = store.bedWidth / 2;
    for (let i = 0; i < heights.length; i++) {
      const c = i % res;
      const r = Math.floor(i / res);
      const x = -size / 2 + (c / (res - 1)) * size;
      const z = size / 2 - (r / (res - 1)) * size;
      const h = heights[i];
      let col = baseColor(h);
      if (samples.length > 1) {
        let bd = Infinity;
        let bi = -1;
        for (let j = 0; j < samples.length; j++) {
          const dx = samples[j].x - x;
          const dz = samples[j].z - z;
          const d = dx * dx + dz * dz;
          if (d < bd) {
            bd = d;
            bi = j;
          }
        }
        const diff = te[bi] - h; // >0 填方 <0 挖方
        // 影响宽度:道床半宽 + 边坡(1:1.5)展开,限 30m
        const corridor = halfBed + Math.min(30, Math.abs(diff) * 1.5) + 1;
        if (Math.sqrt(bd) <= corridor) {
          col = diff >= 0 ? FILL_COLOR : CUT_COLOR;
        }
      }
      terrainColors[i * 4] = col.r;
      terrainColors[i * 4 + 1] = col.g;
      terrainColors[i * 4 + 2] = col.b;
      terrainColors[i * 4 + 3] = 1;
    }
    terrainMesh.updateVerticesData(VertexBuffer.ColorKind, terrainColors);
  }

  let colorTimer = 0;
  function scheduleTerrainColors(): void {
    clearTimeout(colorTimer);
    colorTimer = window.setTimeout(updateTerrainColors, 120);
  }

  // ---------- 轨道 ----------
  const trackNode = new TransformNode('track', scene);
  let bedMesh: Mesh | null = null;
  let railMeshes: Mesh[] = [];
  let centerLine: LinesMesh | null = null;
  const milepostNode = new TransformNode('mileposts', scene);
  milepostNode.parent = trackNode;

  function disposeTrackMeshes(): void {
    if (bedMesh) {
      bedMesh.dispose();
      bedMesh = null;
    }
    for (const m of railMeshes) m.dispose();
    railMeshes = [];
    if (centerLine) {
      centerLine.dispose();
      centerLine = null;
    }
  }

  function rebuildTrack(): void {
    disposeTrackMeshes();
    const samples = derived.samples;
    const te = derived.trackElev;
    if (samples.length < 2) return;
    const half = store.bedWidth / 2;

    // 道床断面:中心线向两侧加宽成带状面
    const left: Vector3[] = [];
    const right: Vector3[] = [];
    for (let i = 0; i < samples.length; i++) {
      const sm = samples[i];
      const y = te[i] + 0.3;
      left.push(new Vector3(sm.x + sm.nx * half, y, sm.z + sm.nz * half));
      right.push(new Vector3(sm.x - sm.nx * half, y, sm.z - sm.nz * half));
    }
    bedMesh = MeshBuilder.CreateRibbon('bed', { pathArray: [left, right], sideOrientation: Mesh.DOUBLESIDE }, scene);
    bedMesh.material = bedMat;
    bedMesh.parent = trackNode;

    // 两条钢轨
    for (const side of [1, -1]) {
      const pts = samples.map(
        (sm, i) => new Vector3(sm.x + sm.nx * 0.75 * side, te[i] + 0.55, sm.z + sm.nz * 0.75 * side)
      );
      const rail = MeshBuilder.CreateTube('rail', { path: pts, radius: 0.12, tessellation: 6 }, scene);
      rail.material = railMat;
      rail.parent = trackNode;
      railMeshes.push(rail);
    }

    // 中心线
    const cpts = samples.map((sm, i) => new Vector3(sm.x, te[i] + 0.4, sm.z));
    centerLine = MeshBuilder.CreateLines('center', { points: cpts }, scene);
    centerLine.color = new Color3(1, 0.25, 0.2);
    centerLine.parent = trackNode;

    rebuildMileposts();
  }

  function makeLabel(text: string): Mesh {
    const tex = new DynamicTexture('lblTex', { width: 256, height: 64 }, scene, false);
    tex.hasAlpha = true;
    tex.drawText(text, null, null, 'bold 40px sans-serif', '#ffffff', 'transparent', true, true);
    const mat = new StandardMaterial('lblMat', scene);
    mat.diffuseTexture = tex;
    mat.emissiveTexture = tex;
    mat.opacityTexture = tex;
    mat.disableLighting = true;
    const plane = MeshBuilder.CreatePlane('lbl', { width: 14, height: 3.5 }, scene);
    plane.material = mat;
    plane.billboardMode = Mesh.BILLBOARDMODE_ALL;
    return plane;
  }

  function rebuildMileposts(): void {
    for (const m of milepostNode.getChildMeshes()) {
      if (m.name === 'lbl' && m.material) {
        const mat = m.material as StandardMaterial;
        mat.diffuseTexture?.dispose();
        mat.dispose();
      }
      m.dispose();
    }
    const samples = derived.samples;
    const te = derived.trackElev;
    const total = derived.totalLength;
    if (samples.length < 2 || total <= 0) return;
    const interval = Math.max(50, store.milepostInterval);
    for (let s = 0; s <= total + 1; s += interval) {
      const sc = Math.min(s, total);
      const idx = Math.round((sc / total) * (samples.length - 1));
      const sm = samples[idx];
      const y = te[idx];
      const post = MeshBuilder.CreateCylinder('post', { height: 8, diameter: 0.8 }, scene);
      post.material = postMat;
      post.position = new Vector3(sm.x, y + 4, sm.z);
      post.parent = milepostNode;
      const label = makeLabel(formatChainage(sc));
      label.position = new Vector3(sm.x, y + 10.5, sm.z);
      label.parent = milepostNode;
    }
  }

  // ---------- 平面控制点(可拖动) ----------
  const cpNode = new TransformNode('controlPoints', scene);
  const cpMeshes: Mesh[] = [];

  function rebuildControlPoints(): void {
    while (cpMeshes.length > store.planPoints.length) {
      cpMeshes.pop()!.dispose();
    }
    while (cpMeshes.length < store.planPoints.length) {
      const idx = cpMeshes.length;
      const m = MeshBuilder.CreateSphere('cp', { diameter: 9, segments: 8 }, scene);
      m.material = cpMat;
      m.parent = cpNode;
      const drag = new PointerDragBehavior({ dragPlaneNormal: new Vector3(0, 1, 0) });
      drag.onDragObservable.add(() => {
        const p = store.planPoints[idx];
        if (!p) return;
        p.x = m.position.x;
        p.z = m.position.z;
      });
      m.addBehavior(drag);
      cpMeshes.push(m);
    }
    store.planPoints.forEach((p, i) => {
      cpMeshes[i].position.set(p.x, heightAt(store.terrain, p.x, p.z) + 5, p.z);
    });
  }

  // ---------- 数据变化 -> 场景重建 ----------
  watch(
    () => store.terrain,
    () => {
      buildTerrain();
      rebuildControlPoints();
    }
  );
  watch(
    () => [derived.samples, store.bedWidth],
    () => {
      rebuildTrack();
      scheduleTerrainColors();
    }
  );
  watch(
    () => derived.samples,
    () => rebuildControlPoints()
  );
  watch(
    () => store.milepostInterval,
    () => rebuildMileposts()
  );
  watch(
    () => store.showTerrain,
    (v) => terrainMesh?.setEnabled(v)
  );
  watch(
    () => store.showTrack,
    (v) => {
      trackNode.setEnabled(v);
      cpNode.setEnabled(v);
    }
  );

  // 初始构建
  buildTerrain();
  rebuildTrack();
  rebuildControlPoints();
  trackNode.setEnabled(store.showTrack);
  cpNode.setEnabled(store.showTrack);

  engine.runRenderLoop(() => scene.render());
  window.addEventListener('resize', () => engine.resize());
}
