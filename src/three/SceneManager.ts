// 三维场景管理:地形、航路高亮、体积云、后处理链

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  EffectComposer,
  RenderPass,
  EffectPass,
  BloomEffect,
  VignetteEffect,
} from 'postprocessing';
import { createVolumeMesh, type VolumeMesh } from './VolumeRenderer';
import { VolumetricFogEffect } from './effects/VolumetricFogEffect';
import { ColorMappingEffect } from './effects/ColorMappingEffect';
import { terrainHeight } from '../data/noise';
import { NX, NY, NZ, WORLD_X, WORLD_Y, WORLD_Z } from '../data/weatherSim';
import type { RoutePoint } from '../store';

export class SceneManager {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private composer: EffectComposer;
  private fogEffect: VolumetricFogEffect;
  private colorEffect: ColorMappingEffect;
  private effectPass: EffectPass;
  private volume: VolumeMesh;
  private terrain: THREE.Mesh;
  private routeGroup = new THREE.Group();
  private resizeObserver: ResizeObserver;
  private raf = 0;
  private invViewProj = new THREE.Matrix4();
  private disposed = false;

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setClearColor(0x16222f);
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x16222f);

    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 500);
    this.camera.position.set(78, 42, 78);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(WORLD_X / 2, 2, WORLD_Z / 2);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.52;

    // 灯光
    const dir = new THREE.DirectionalLight(0xfff2e0, 1.6);
    dir.position.set(40, 60, 25);
    this.scene.add(dir);
    this.scene.add(new THREE.HemisphereLight(0x9db8d9, 0x3a4a3a, 0.9));

    // 地形
    this.terrain = this.buildTerrain();
    this.scene.add(this.terrain);

    // 航路
    this.scene.add(this.routeGroup);

    // 体积云
    this.volume = createVolumeMesh();
    this.scene.add(this.volume.mesh);

    // 后处理:体积雾 + 色彩映射 + 泛光 + 暗角
    this.composer = new EffectComposer(this.renderer, {
      frameBufferType: THREE.HalfFloatType,
    });
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.fogEffect = new VolumetricFogEffect();
    this.colorEffect = new ColorMappingEffect();
    const bloom = new BloomEffect({ intensity: 0.55, luminanceThreshold: 0.62, luminanceSmoothing: 0.2, mipmapBlur: true });
    const vignette = new VignetteEffect({ offset: 0.28, darkness: 0.55 });
    this.effectPass = new EffectPass(this.camera, this.fogEffect, this.colorEffect, bloom, vignette);
    this.composer.addPass(this.effectPass);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.animate();
  }

  private buildTerrain(): THREE.Mesh {
    const seg = 120;
    const geo = new THREE.PlaneGeometry(WORLD_X, WORLD_Z, seg, seg);
    geo.rotateX(-Math.PI / 2);
    geo.translate(WORLD_X / 2, 0, WORLD_Z / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const h = terrainHeight(x, z);
      pos.setY(i, h);
      const t = h / 1.6;
      if (t < 0.35) c.setRGB(0.23, 0.36, 0.24).lerp(new THREE.Color(0.35, 0.42, 0.26), t / 0.35);
      else if (t < 0.7) c.setRGB(0.35, 0.42, 0.26).lerp(new THREE.Color(0.45, 0.4, 0.34), (t - 0.35) / 0.35);
      else c.setRGB(0.45, 0.4, 0.34).lerp(new THREE.Color(0.72, 0.72, 0.74), (t - 0.7) / 0.3);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
    return new THREE.Mesh(geo, mat);
  }

  /** 重建航路高亮:航段幕帘(高度带)+ 航路点标杆 + 中线 */
  updateRoute(points: RoutePoint[], bandMinM: number, bandMaxM: number): void {
    this.routeGroup.children.forEach((ch) => {
      const m = ch as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else if (mat) mat.dispose();
    });
    this.routeGroup.clear();
    if (points.length < 2) return;

    const y0 = bandMinM / 1000;
    const y1 = bandMaxM / 1000;
    const yMid = (y0 + y1) / 2;

    // 高度带幕帘
    const curtainMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8, transparent: true, opacity: 0.22,
      side: THREE.DoubleSide, depthWrite: false,
    });
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], b = points[i + 1];
      const g = new THREE.BufferGeometry();
      const v = new Float32Array([
        a.x, y0, a.z, b.x, y0, b.z, b.x, y1, b.z,
        a.x, y0, a.z, b.x, y1, b.z, a.x, y1, a.z,
      ]);
      g.setAttribute('position', new THREE.BufferAttribute(v, 3));
      const mesh = new THREE.Mesh(g, curtainMat);
      mesh.renderOrder = 5;
      this.routeGroup.add(mesh);
    }

    // 中线
    const lineGeo = new THREE.BufferGeometry().setFromPoints(
      points.map((p) => new THREE.Vector3(p.x, yMid, p.z)),
    );
    const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0x7dd3fc }));
    line.renderOrder = 6;
    this.routeGroup.add(line);

    // 航路点标杆
    const poleMat = new THREE.MeshBasicMaterial({ color: 0xfbbf24 });
    const capMat = new THREE.MeshBasicMaterial({ color: 0xf59e0b });
    points.forEach((p, i) => {
      const ground = terrainHeight(p.x, p.z);
      const top = y1 + 0.4;
      const h = Math.max(0.1, top - ground);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, h, 8), poleMat);
      pole.position.set(p.x, ground + h / 2, p.z);
      this.routeGroup.add(pole);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(i === 0 || i === points.length - 1 ? 0.45 : 0.3, 16, 12), capMat);
      cap.position.set(p.x, top, p.z);
      this.routeGroup.add(cap);
    });
  }

  setVolumeData(data: Uint8Array): void {
    this.volume.setData(data, NX, NY, NZ);
  }

  setThreshold(v: number): void {
    this.volume.setThreshold(v);
  }

  setTerrainVisible(v: boolean): void {
    this.terrain.visible = v;
  }

  setRouteVisible(v: boolean): void {
    this.routeGroup.visible = v;
  }

  setFogEnabled(v: boolean): void {
    this.fogEffect.blendMode.opacity.value = v ? 1 : 0;
  }

  setColorMapEnabled(v: boolean): void {
    this.colorEffect.blendMode.opacity.value = v ? 1 : 0;
  }

  resize(): void {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
  }

  private animate = (): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.animate);
    this.controls.update();
    // 更新体积雾相机 uniforms
    this.camera.updateMatrixWorld();
    this.invViewProj.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse).invert();
    this.fogEffect.updateCamera(this.camera.position, this.invViewProj);
    this.composer.render();
  };

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.volume.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
