import * as THREE from 'three';
import { BAND_COLORS, colorBand, type Solution } from '../solver/field';

export type SliceMode = 'horizontal' | 'vertical-x' | 'vertical-z';

export const SLICE_LABELS: Record<SliceMode, string> = {
  horizontal: '水平切面 (Y 高度)',
  'vertical-x': '纵切面 (沿 X, 固定 Z)',
  'vertical-z': '横切面 (沿 Z, 固定 X)',
};

const BAND_THREE = BAND_COLORS.map((c) => new THREE.Color(c));
const DARK = new THREE.Color(0x151c26);

/**
 * 剖面视图
 *
 * 每个切面生成一张贴图, 像素颜色 = 该体素速度所属的 6 档色带。
 * 另叠加按速度着色的方向箭头 (锥体), 箭头长度随速度增大。
 */
export class SliceRenderer {
  readonly group: THREE.Group;
  private mesh: THREE.Mesh;
  private border: THREE.LineSegments;
  private arrowGroup: THREE.Group;
  private arrowMesh: THREE.Mesh;
  private arrowMat: THREE.MeshBasicMaterial;
  private textures: Record<SliceMode, THREE.DataTexture>;
  private plane: THREE.PlaneGeometry;
  private mode: SliceMode = 'horizontal';
  private pos = 2.0;
  private showArrows = true;
  private opacity = 0.9;

  constructor(fine: { nx: number; ny: number; nz: number }) {
    this.group = new THREE.Group();
    this.group.name = 'slice';
    const mk = (w: number, h: number) => {
      const data = new Uint8Array(w * h * 4);
      const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
      t.minFilter = THREE.LinearFilter;
      t.magFilter = THREE.LinearFilter;
      t.generateMipmaps = false;
      t.colorSpace = THREE.SRGBColorSpace;
      t.needsUpdate = true;
      return t;
    };
    this.textures = {
      horizontal: mk(fine.nx, fine.nz),
      'vertical-x': mk(fine.nx, fine.ny),
      'vertical-z': mk(fine.nz, fine.ny),
    };

    this.plane = new THREE.PlaneGeometry(1, 1);
    const mat = new THREE.MeshBasicMaterial({
      map: this.textures.horizontal,
      transparent: true,
      opacity: this.opacity,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(this.plane, mat);
    this.mesh.renderOrder = 4;
    this.group.add(this.mesh);

    const eg = new THREE.EdgesGeometry(this.plane);
    const borderMat = new THREE.LineBasicMaterial({ color: 0xe8f6ff, transparent: true, opacity: 0.6 });
    this.border = new THREE.LineSegments(eg, borderMat);
    this.border.renderOrder = 6;
    this.mesh.add(this.border);

    this.arrowGroup = new THREE.Group();
    this.arrowGroup.name = 'slice-arrows';
    this.group.add(this.arrowGroup);
    this.arrowMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95 });
    const empty = new THREE.BufferGeometry();
    this.arrowMesh = new THREE.Mesh(empty, this.arrowMat);
    this.arrowMesh.frustumCulled = false;
    this.arrowMesh.renderOrder = 7;
    this.arrowGroup.add(this.arrowMesh);
  }

  setVisible(v: boolean) {
    this.group.visible = v;
  }
  get visible() {
    return this.group.visible;
  }
  setArrowsVisible(v: boolean) {
    this.showArrows = v;
    this.arrowGroup.visible = v;
  }
  get arrowsVisible() {
    return this.showArrows;
  }
  setOpacity(v: number) {
    this.opacity = v;
    (this.mesh.material as THREE.MeshBasicMaterial).opacity = v;
  }
  get sliceMode() {
    return this.mode;
  }
  get slicePosition() {
    return this.pos;
  }

  /** 重建切面贴图与箭头 */
  rebuild(sol: Solution, mode: SliceMode, position: number) {
    this.mode = mode;
    this.pos = position;
    const stops = sol.colorStops;
    const h = sol.fine.h;
    const nx = sol.fine.nx,
      ny = sol.fine.ny,
      nz = sol.fine.nz;
    const solid = sol.solidFine;
    const spd = sol.speed;
    const vel = sol.velocity;
    const L = sol.room;

    const tex = this.textures[mode];
    const data = tex.image.data as Uint8Array;

    let index = 0; // 切面所在的那个平面索引
    let normal = new THREE.Vector3(0, 1, 0);
    if (mode === 'horizontal') {
      index = Math.min(nz - 1, Math.max(0, Math.round(position / h - 0.5)));
      normal = new THREE.Vector3(0, 1, 0);
      for (let zz = 0; zz < nz; zz++) {
        for (let xx = 0; xx < nx; xx++) {
          const c = xx + nx * (zz + nz * index);
          const o = ((nz - 1 - zz) * nx + xx) * 4; // v 向上: 行 0 是 z 最大
          if (solid[c]) {
            data[o] = DARK.r * 255;
            data[o + 1] = DARK.g * 255;
            data[o + 2] = DARK.b * 255;
            data[o + 3] = 0;
          } else {
            const col = BAND_THREE[colorBand(spd[c], stops)];
            data[o] = col.r * 255;
            data[o + 1] = col.g * 255;
            data[o + 2] = col.b * 255;
            data[o + 3] = 255;
          }
        }
      }
      this.mesh.scale.set(L.lx, L.lz, 1);
      this.mesh.rotation.set(-Math.PI / 2, 0, 0);
      this.mesh.position.set(L.lx / 2, (index + 0.5) * h, L.lz / 2);
    } else if (mode === 'vertical-x') {
      index = Math.min(nz - 1, Math.max(0, Math.round(position / h - 0.5)));
      normal = new THREE.Vector3(0, 0, 1);
      // DataTexture 的第 0 行对应 v=0 (图像底部), 所以行号直接用 yy
      for (let yy = 0; yy < ny; yy++) {
        for (let xx = 0; xx < nx; xx++) {
          const c = xx + nx * (index + nz * yy);
          const o = (yy * nx + xx) * 4;
          if (solid[c]) {
            data[o + 3] = 0;
          } else {
            const col = BAND_THREE[colorBand(spd[c], stops)];
            data[o] = col.r * 255;
            data[o + 1] = col.g * 255;
            data[o + 2] = col.b * 255;
            data[o + 3] = 255;
          }
        }
      }
      this.mesh.scale.set(L.lx, L.ly, 1);
      this.mesh.rotation.set(0, 0, 0);
      this.mesh.position.set(L.lx / 2, L.ly / 2, (index + 0.5) * h);
    } else {
      index = Math.min(nx - 1, Math.max(0, Math.round(position / h - 0.5)));
      normal = new THREE.Vector3(1, 0, 0);
      for (let yy = 0; yy < ny; yy++) {
        for (let zz = 0; zz < nz; zz++) {
          const c = index + nx * (zz + nz * yy);
          const o = (yy * nz + zz) * 4;
          if (solid[c]) {
            data[o + 3] = 0;
          } else {
            const col = BAND_THREE[colorBand(spd[c], stops)];
            data[o] = col.r * 255;
            data[o + 1] = col.g * 255;
            data[o + 2] = col.b * 255;
            data[o + 3] = 255;
          }
        }
      }
      this.mesh.scale.set(L.lz, L.ly, 1);
      // -90°: 局部 +X -> 世界 +Z, 与纹理列顺序 (zz 递增) 一致
      this.mesh.rotation.set(0, -Math.PI / 2, 0);
      this.mesh.position.set((index + 0.5) * h, L.ly / 2, L.lz / 2);
    }
    tex.needsUpdate = true;
    (this.mesh.material as THREE.MeshBasicMaterial).map = tex;
    (this.mesh.material as THREE.MeshBasicMaterial).needsUpdate = true;

    this.buildArrows(sol, mode, index, normal);
  }

  /** 切面上的方向箭头: 合并成一个带顶点色的几何 */
  private buildArrows(sol: Solution, mode: SliceMode, index: number, normal: THREE.Vector3) {
    const h = sol.fine.h;
    const nx = sol.fine.nx,
      ny = sol.fine.ny,
      nz = sol.fine.nz;
    const solid = sol.solidFine;
    const vel = sol.velocity;
    const spd = sol.speed;
    // 箭头间距: 约 0.5 m
    const step = Math.max(3, Math.round(0.5 / h));
    const scaleMax = Math.max(0.05, sol.scaleMax);

    // 锥体模板 (7 边)
    const SEG = 7;
    const tmpGeo = new THREE.ConeGeometry(0.055, 1, SEG, 1, false);
    const pos = tmpGeo.attributes.position as THREE.BufferAttribute;
    const idx = tmpGeo.index!;
    const tri: number[] = [];
    for (let i = 0; i < idx.count; i++) tri.push(idx.getX(i));
    const basePos = new Float32Array(pos.array);
    tmpGeo.dispose();

    // 用实例化方式组装: 先收集样本
    const samples: { x: number; y: number; z: number; dx: number; dy: number; dz: number; speed: number }[] = [];
    const add = (xx: number, yy: number, zz: number, c: number) => {
      if (solid[c]) return;
      const vx = vel[3 * c],
        vy = vel[3 * c + 1],
        vz = vel[3 * c + 2];
      const s = spd[c];
      let dx = vx,
        dy = vy,
        dz = vz;
      // 与切面法向平行的分量投影到面内
      const dn = dx * normal.x + dy * normal.y + dz * normal.z;
      dx -= dn * normal.x;
      dy -= dn * normal.y;
      dz -= dn * normal.z;
      const m = Math.hypot(dx, dy, dz);
      if (m < 1e-3) {
        // 纯法向流 (例如正对风口): 在该点画一个小圆点, 表示"穿过切面"
        samples.push({ x: (xx + 0.5) * h, y: (yy + 0.5) * h, z: (zz + 0.5) * h, dx: 0, dy: 0, dz: 0, speed: -1 });
        return;
      }
      dx /= m;
      dy /= m;
      dz /= m;
      samples.push({ x: (xx + 0.5) * h, y: (yy + 0.5) * h, z: (zz + 0.5) * h, dx, dy, dz, speed: s });
    };

    if (mode === 'horizontal') {
      for (let zz = step; zz < nz - step; zz += step)
        for (let xx = step; xx < nx - step; xx += step) add(xx, index, zz, xx + nx * (zz + nz * index));
    } else if (mode === 'vertical-x') {
      for (let yy = step; yy < ny - step; yy += step)
        for (let xx = step; xx < nx - step; xx += step) add(xx, yy, index, xx + nx * (index + nz * yy));
    } else {
      for (let yy = step; yy < ny - step; yy += step)
        for (let zz = step; zz < nz - step; zz += step) add(index, yy, zz, index + nx * (zz + nz * yy));
    }

    const vCount = samples.length * basePos.length / 3;
    const positions = new Float32Array(vCount * 3);
    const colors = new Float32Array(vCount * 3);
    const indices = new Uint32Array(samples.length * tri.length);

    const up = new THREE.Vector3(0, 1, 0);
    const dirV = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const sc = new THREE.Vector3();
    const mtx = new THREE.Matrix4();
    const v = new THREE.Vector3();
    const col = new THREE.Color();

    for (let s = 0; s < samples.length; s++) {
      const smp = samples[s];
      const isDot = smp.speed < 0;
      if (isDot) {
        // 法向流 (穿过切面): 压扁成小圆点
        dirV.set(0, 1, 0);
        q.identity();
        sc.set(1.2, 0.16, 1.2);
      } else {
        dirV.set(smp.dx, smp.dy, smp.dz);
        q.setFromUnitVectors(up, dirV);
        const len = 0.1 + 0.38 * Math.min(1, smp.speed / scaleMax);
        sc.set(1, len, 1);
      }
      p.set(smp.x, smp.y, smp.z);
      mtx.compose(p, q, sc);
      const baseV = s * (basePos.length / 3);
      for (let k = 0; k < basePos.length / 3; k++) {
        v.set(basePos[k * 3], basePos[k * 3 + 1], basePos[k * 3 + 2]).applyMatrix4(mtx);
        positions[(baseV + k) * 3] = v.x;
        positions[(baseV + k) * 3 + 1] = v.y;
        positions[(baseV + k) * 3 + 2] = v.z;
      }
      col.copy(BAND_THREE[colorBand(isDot ? 0 : smp.speed, sol.colorStops)]);
      for (let k = 0; k < basePos.length / 3; k++) {
        colors[(baseV + k) * 3] = col.r;
        colors[(baseV + k) * 3 + 1] = col.g;
        colors[(baseV + k) * 3 + 2] = col.b;
      }
      for (let k = 0; k < tri.length; k++) indices[s * tri.length + k] = baseV + tri[k];
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    geo.computeVertexNormals();
    this.arrowMesh.geometry.dispose();
    this.arrowMesh.geometry = geo;
    this.arrowMesh.visible = this.showArrows;
  }

  dispose() {
    for (const t of Object.values(this.textures)) t.dispose();
    this.plane.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.border.geometry.dispose();
    (this.border.material as THREE.Material).dispose();
    this.arrowMesh.geometry.dispose();
    this.arrowMat.dispose();
  }
}
