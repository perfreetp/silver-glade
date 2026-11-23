/**
 * 三维场景：地形（贴图 + 高程）、光照、相机控制、地面拾取。
 *
 * 坐标约定：地图坐标 (x, y) 单位为米，x 向东，y 向北；
 * three.js 中使用 X=x、Z=-y、Y=高程，使屏幕上“北”朝向后上方。
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Georef } from '../core/types.ts';
import { demToCanvas, elevationAt, sampleRaster, slopeAt, aspectAt } from '../core/raster.ts';
import type { ElevationGrid, RasterImage } from '../core/types.ts';
import { clamp } from '../core/util.ts';

export interface SceneOptions {
  exaggeration: number;
}

export interface TerrainData {
  georef: Georef;
  imagery: RasterImage | null;
  dem: ElevationGrid | null;
}

export class SceneEngine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly root = new THREE.Group();
  readonly boundaryGroup = new THREE.Group();
  readonly markerGroup = new THREE.Group();

  private terrain: THREE.Mesh | null = null;
  private roadGrid: THREE.GridHelper | null = null;
  private sun: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private fill: THREE.DirectionalLight;
  private raycaster = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private disposed = false;

  data: TerrainData = {
    georef: { minX: 0, minY: 0, maxX: 1000, maxY: 750, crs: 'local', lon0: 0, lat0: 0 },
    imagery: null,
    dem: null,
  };
  exaggeration = 1.35;
  private dirty = true;
  /** 地形网格的地面单元尺寸（米），贴地要素需据此抬高以避免穿插 */
  terrainCell = 8;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#0b1116');
    this.scene.fog = new THREE.FogExp2('#0b1116', 0.00016);

    this.camera = new THREE.PerspectiveCamera(48, 1, 0.5, 40000);
    this.camera.position.set(-700, 900, 1200);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.075;
    this.controls.maxPolarAngle = Math.PI * 0.487;
    this.controls.minDistance = 40;
    this.controls.maxDistance = 9000;
    this.controls.zoomSpeed = 0.85;
    this.controls.rotateSpeed = 0.7;
    this.controls.screenSpacePanning = false;
    this.controls.target.set(0, 0, 0);

    this.scene.add(this.root);
    this.root.add(this.boundaryGroup);
    this.root.add(this.markerGroup);

    this.hemi = new THREE.HemisphereLight('#eaf2ff', '#4a3a28', 1.75);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight('#fff8ee', 1.85);
    this.sun.castShadow = false;
    this.scene.add(this.sun);
    const fill = new THREE.DirectionalLight('#c6d8e6', 0.55);
    this.scene.add(fill);
    this.fill = fill;
    this.updateSun();

    this.resize();
    window.addEventListener('resize', this.resize);
  }

  /** 空项目时显示一块低对比度的“图纸”地面，避免视口全黑 */
  setEmptyState(empty: boolean): void {
    if (this.terrain) {
      const mat = this.terrain.material as THREE.MeshStandardMaterial;
      mat.color.set(empty ? 0x39434c : 0xffffff);
      mat.transparent = false;
      mat.opacity = 1;
      mat.needsUpdate = true;
      this.invalidate();
    }
  }

  /** 依据地形范围放置平行光，保证光照方向与地形尺度匹配 */
  private updateSun(): void {
    const g = this.data.georef;
    const span = Math.max(g.maxX - g.minX, g.maxY - g.minY);
    const midElev = this.data.dem ? (this.data.dem.minElev + this.data.dem.maxElev) / 2 : 0;
    const base = this.mapToWorld((g.minX + g.maxX) / 2, (g.minY + g.maxY) / 2, midElev, 0);
    this.sun.position.set(base.x - span * 1.1, base.y + span * 1.5, base.z + span * 0.85);
    this.sun.target.position.copy(base);
    this.sun.target.updateMatrixWorld();
    this.fill.position.set(base.x + span * 0.9, base.y + span * 0.5, base.z - span);
    this.fill.target.position.copy(base);
    this.fill.target.updateMatrixWorld();
    if (!this.sun.target.parent) this.scene.add(this.sun.target);
    if (!this.fill.target.parent) this.scene.add(this.fill.target);
  }

  /** 地图坐标 → three 世界坐标 */
  mapToWorld(x: number, y: number, elev = 0, lift = 0): THREE.Vector3 {
    const { minX, minY, maxX, maxY } = this.data.georef;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    return new THREE.Vector3(x - cx, elev * this.exaggeration + lift, -(y - cy));
  }

  /** 世界坐标（地面平面） → 地图坐标 */
  worldToMap(p: THREE.Vector3): { x: number; y: number } {
    const { minX, minY, maxX, maxY } = this.data.georef;
    return { x: p.x + (minX + maxX) / 2, y: -(p.z) + (minY + maxY) / 2 };
  }

  elevationAt(x: number, y: number): number {
    return elevationAt(this.data.dem, this.data.georef, x, y);
  }

  slopeAt(x: number, y: number): number {
    return slopeAt(this.data.dem, this.data.georef, x, y);
  }

  aspectAt(x: number, y: number): number {
    return aspectAt(this.data.dem, this.data.georef, x, y);
  }

  /** 重建地形网格 */
  setTerrain(data: TerrainData): void {
    this.data = data;
    const { georef, dem, imagery } = data;
    const spanX = georef.maxX - georef.minX;
    const spanY = georef.maxY - georef.minY;

    // 网格分辨率：不超过 ~220k 顶点
    const aspect = spanX / Math.max(1e-6, spanY);
    const targetVerts = 150000;
    let segX = Math.round(Math.sqrt(targetVerts * aspect));
    let segY = Math.round(targetVerts / Math.max(1, segX));
    if (dem) {
      segX = Math.min(segX, Math.max(24, Math.round(dem.width * 1.0)));
      segY = Math.min(segY, Math.max(24, Math.round(dem.height * 1.0)));
    }
    segX = clamp(segX, 24, 420);
    segY = clamp(segY, 24, 420);

    const geo = new THREE.PlaneGeometry(spanX, spanY, segX, segY);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const { minX, minY, maxX, maxY } = georef;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const exag = this.exaggeration;
    for (let i = 0; i < pos.count; i++) {
      const wx = pos.getX(i);
      const wz = pos.getZ(i);
      const mapX = wx + cx;
      const mapY = -wz + cy;
      const h = elevationAt(dem, georef, mapX, mapY) * exag;
      pos.setY(i, h);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();

    // 纹理
    if (this.terrain) {
      this.root.remove(this.terrain);
      this.terrain.geometry.dispose();
      const mat = this.terrain.material as THREE.MeshStandardMaterial;
      mat.map?.dispose();
      mat.dispose();
    }
    let map: THREE.Texture | null = null;
    if (imagery) {
      map = this.textureFromRaster(imagery);
    } else if (dem) {
      const canvas = demToCanvas(dem, 768);
      map = new THREE.CanvasTexture(canvas);
      map.colorSpace = THREE.SRGBColorSpace;
    }
    const material = new THREE.MeshStandardMaterial({
      map,
      color: map ? 0xffffff : 0x6b7a63,
      roughness: 0.88,
      metalness: 0.0,
      flatShading: false,
    });
    this.terrainCell = Math.max(spanX / segX, spanY / segY);
    const mesh = new THREE.Mesh(geo, material);
    mesh.receiveShadow = false;
    mesh.frustumCulled = true;
    this.terrain = mesh;
    this.root.add(mesh);
    this.setEmptyState(!imagery);
    this.invalidate();

    // 北向指示底座与网格
    if (this.roadGrid) {
      this.root.remove(this.roadGrid);
      this.roadGrid.dispose();
    }
    const gridSize = Math.max(spanX, spanY) * 1.9;
    const grid = new THREE.GridHelper(gridSize, 24, 0x2a3b45, 0x1b262c);
    grid.position.y = (dem?.minElev ?? 0) * exag - 6;
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.55;
    this.roadGrid = grid;
    this.root.add(grid);

    this.updateSun();
    this.frameTerrain();
    this.invalidate();
  }

  private textureFromRaster(img: RasterImage): THREE.Texture {
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const data = new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);
      ctx.putImageData(data, 0, 0);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    return tex;
  }

  setImageryVisible(visible: boolean): void {
    if (!this.terrain) return;
    const mat = this.terrain.material as THREE.MeshStandardMaterial;
    if (visible && this.data.imagery) {
      mat.map?.dispose();
      mat.map = this.textureFromRaster(this.data.imagery);
      mat.color.set(0xffffff);
    } else {
      mat.map?.dispose();
      mat.map = null;
      mat.color.set(0x6b7a63);
    }
    mat.needsUpdate = true;
    this.invalidate();
    this.invalidate();
  }

  setExaggeration(exag: number): void {
    this.exaggeration = exag;
    this.setTerrain(this.data);
  }

  /** 俯视并框住整个地形 */
  frameTerrain(padding = 0.66): void {
    const { georef } = this.data;
    const cx = (georef.minX + georef.maxX) / 2;
    const cy = (georef.minY + georef.maxY) / 2;
    const span = Math.max(georef.maxX - georef.minX, georef.maxY - georef.minY);
    const center = this.mapToWorld(cx, cy, this.data.dem ? (this.data.dem.minElev + this.data.dem.maxElev) / 2 : 0, 0);
    this.controls.target.copy(center);
    const dist = (span / Math.tan((this.camera.fov * Math.PI) / 360)) * padding;
    const pitch = 0.95; // 与竖直方向夹角，约 54° 俯视
    const azim = -0.36;
    this.camera.position.set(
      center.x + Math.sin(pitch) * Math.sin(azim) * dist,
      center.y + Math.cos(pitch) * dist,
      center.z + Math.sin(pitch) * Math.cos(azim) * dist,
    );
    this.controls.maxDistance = span * 9;
    this.controls.update();
    this.invalidate();
  }

  /** 屏幕坐标 → 地图坐标（先与地形求交，失败则与地面平面求交） */
  pickMap(clientX: number, clientY: number): { x: number; y: number; elevation: number; hitTerrain: boolean } | null {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    if (this.terrain) {
      const hits = this.raycaster.intersectObject(this.terrain, false);
      if (hits.length > 0) {
        const map = this.worldToMap(hits[0].point);
        return { ...map, elevation: hits[0].point.y / this.exaggeration, hitTerrain: true };
      }
    }
    const p = new THREE.Vector3();
    this.plane.constant = 0;
    if (this.raycaster.ray.intersectPlane(this.plane, p)) {
      const map = this.worldToMap(p);
      return { ...map, elevation: elevationAt(this.data.dem, this.data.georef, map.x, map.y), hitTerrain: false };
    }
    return null;
  }

  /** 世界坐标下的点是否在地形范围内 */
  inBounds(x: number, y: number): boolean {
    const g = this.data.georef;
    return x >= g.minX && x <= g.maxX && y >= g.minY && y <= g.maxY;
  }

  /** 某一地图位置的影像颜色（用于探针面板） */
  sampleColor(x: number, y: number): [number, number, number] | null {
    const img = this.data.imagery;
    if (!img) return null;
    const g = this.data.georef;
    const u = (x - g.minX) / Math.max(1e-6, g.maxX - g.minX);
    const v = (g.maxY - y) / Math.max(1e-6, g.maxY - g.minY);
    return sampleRaster(img, u, v);
  }

  resize = (): void => {
    const parent = this.canvas.parentElement;
    const w = parent?.clientWidth || window.innerWidth;
    const h = parent?.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  };

  /** 是否需要重绘：相机在动或场景被标脏时才渲染，避免空闲时持续占满 GPU */
  render(force = false): boolean {
    if (this.disposed) return false;
    const changed = this.controls.update();
    if (!force && !changed && !this.dirty) return false;
    this.dirty = false;
    this.renderer.render(this.scene, this.camera);
    return true;
  }

  /** 标记场景需要重绘（重建几何、切换纹理等） */
  invalidate(): void {
    this.dirty = true;
  }

  dispose(): void {
    this.disposed = true;
    window.removeEventListener('resize', this.resize);
    this.controls.dispose();
    this.renderer.dispose();
  }
}
