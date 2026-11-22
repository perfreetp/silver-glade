import * as THREE from 'three';

/**
 * 体素风场粒子渲染器
 *
 * - 粒子在 CPU 上沿体素速度场推进 (三线性采样), 每帧记录一段拖尾
 * - 每个粒子由 N 个广告牌四边形组成一条带状拖尾
 * - 顶点着色器在视图空间展开广告牌; 片元用径向高斯 + 头尾渐隐
 * - depthTest 打开: 菇架 / 墙体会遮挡其后的拖尾段
 */

const VERTS_PER_POINT = 4;
const INDICES_PER_POINT = 6;

export interface ParticleSystemOptions {
  maxParticles: number;
  trailPoints?: number;
}

export class TrailParticles {
  readonly object: THREE.Mesh;
  readonly maxParticles: number;
  readonly trailPoints: number;
  readonly capacityPoints: number;

  private px: Float32Array;
  private py: Float32Array;
  private pz: Float32Array;
  private histX: Float32Array;
  private histY: Float32Array;
  private histZ: Float32Array;
  private head: Uint16Array;
  private age: Float32Array;
  private life: Float32Array;
  private spd: Float32Array;
  /** 自上次推入拖尾点以来走过的距离 */
  private trailDist: Float32Array;

  private posAttr: THREE.BufferAttribute;
  private alphaAttr: THREE.BufferAttribute;
  private sizeAttr: THREE.BufferAttribute;
  private colorAttr: THREE.BufferAttribute;
  private geometry: THREE.BufferGeometry;
  private material: THREE.ShaderMaterial;
  private positions: Float32Array;
  private alphas: Float32Array;
  private sizes: Float32Array;
  private colors: Float32Array;

  private seeds: { x: number; y: number; z: number }[] = [];
  private seedJitter = 0.05;
  /** 实际活跃的粒子数 (<= maxParticles), 由 UI 的"粒子数"滑杆控制 */
  activeCount = 0;
  /** 用于播种时"回溯"填充拖尾的采样函数 */
  private prefillSampler: ((x: number, y: number, z: number, out: Float32Array) => boolean) | null = null;

  constructor(private opts: ParticleSystemOptions) {
    this.maxParticles = opts.maxParticles;
    this.trailPoints = opts.trailPoints ?? 14;
    const M = this.maxParticles;
    const T = this.trailPoints;
    this.px = new Float32Array(M);
    this.py = new Float32Array(M);
    this.pz = new Float32Array(M);
    this.histX = new Float32Array(M * T);
    this.histY = new Float32Array(M * T);
    this.histZ = new Float32Array(M * T);
    this.head = new Uint16Array(M);
    this.age = new Float32Array(M);
    this.life = new Float32Array(M);
    this.spd = new Float32Array(M);
    this.trailDist = new Float32Array(M);

    this.capacityPoints = M * T;
    const V = this.capacityPoints * VERTS_PER_POINT;
    this.positions = new Float32Array(V * 3);
    this.alphas = new Float32Array(V);
    this.sizes = new Float32Array(V);
    this.colors = new Float32Array(this.capacityPoints * 3);

    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.positions, 3);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.alphaAttr = new THREE.BufferAttribute(this.alphas, 1);
    this.alphaAttr.setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr = new THREE.BufferAttribute(this.sizes, 1);
    this.sizeAttr.setUsage(THREE.DynamicDrawUsage);
    this.colorAttr = new THREE.BufferAttribute(this.colors, 3);
    this.colorAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('aAlpha', this.alphaAttr);
    geo.setAttribute('aSize', this.sizeAttr);
    geo.setAttribute('aColor', this.colorAttr);

    const corner = new Float32Array(V * 2);
    const along = new Float32Array(V);
    for (let p = 0; p < this.capacityPoints; p++) {
      const b = p * VERTS_PER_POINT;
      const t = (p % T) / Math.max(1, T - 1);
      corner[(b + 0) * 2] = -1;
      corner[(b + 0) * 2 + 1] = -1;
      corner[(b + 1) * 2] = 1;
      corner[(b + 1) * 2 + 1] = -1;
      corner[(b + 2) * 2] = -1;
      corner[(b + 2) * 2 + 1] = 1;
      corner[(b + 3) * 2] = 1;
      corner[(b + 3) * 2 + 1] = 1;
      for (let q = 0; q < 4; q++) along[b + q] = t;
    }
    geo.setAttribute('aCorner', new THREE.BufferAttribute(corner, 2));
    geo.setAttribute('aAlong', new THREE.BufferAttribute(along, 1));

    const I = this.capacityPoints * INDICES_PER_POINT;
    const idx = V > 65535 ? new Uint32Array(I) : new Uint16Array(I);
    let w = 0;
    for (let p = 0; p < this.capacityPoints; p++) {
      const b = p * VERTS_PER_POINT;
      idx[w++] = b;
      idx[w++] = b + 1;
      idx[w++] = b + 2;
      idx[w++] = b + 2;
      idx[w++] = b + 1;
      idx[w++] = b + 3;
    }
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.setDrawRange(0, 0);

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uPixelScale: { value: 1 },
        uOpacity: { value: 1 },
        uPointSize: { value: 0.036 },
      },
      vertexShader: /* glsl */ `
        attribute float aAlpha;
        attribute float aSize;
        attribute vec3 aColor;
        attribute vec2 aCorner;
        attribute float aAlong;
        uniform float uPixelScale;
        varying float vAlpha;
        varying vec3 vColor;
        varying vec2 vCorner;
        varying float vAlong;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          // aSize 为世界单位 (米) 的粒子直径
          float s = max(aSize, 0.002);
          // 远处略微放大, 保证可读性
          float distF = clamp(-mv.z / 16.0, 0.0, 1.0);
          mv.xy += aCorner * s * (1.0 + 0.6 * distF);
          gl_Position = projectionMatrix * mv;
          vAlpha = aAlpha;
          vColor = aColor;
          vCorner = aCorner;
          vAlong = aAlong;
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform float uOpacity;
        varying float vAlpha;
        varying vec3 vColor;
        varying vec2 vCorner;
        varying float vAlong;
        void main() {
          float r2 = dot(vCorner, vCorner);
          float radial = exp(-r2 * 2.2);
          // vAlong: 1 = 头部, 0 = 尾部
          float tail = smoothstep(0.0, 0.3, vAlong) * (0.3 + 0.7 * vAlong);
          float a = radial * tail * vAlpha * uOpacity;
          if (a < 0.003) discard;
          gl_FragColor = vec4(vColor * (0.55 + 0.75 * vAlong), a);
        }
      `,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
    });

    this.object = new THREE.Mesh(geo, this.material);
    this.object.frustumCulled = false;
    this.object.renderOrder = 10;
    this.geometry = geo;
  }

  setSeeds(seeds: { x: number; y: number; z: number }[], jitter = 0.05, active?: number) {
    this.seeds = seeds;
    this.seedJitter = jitter;
    if (active !== undefined) this.activeCount = Math.min(this.maxParticles, Math.max(0, active));
    this.reseed(0, this.activeCount || this.maxParticles);
  }

  /** 设置用于初始化拖尾的采样器 (让新播的粒子一出现就有完整拖尾) */
  setPrefillSampler(s: ((x: number, y: number, z: number, out: Float32Array) => boolean) | null) {
    this.prefillSampler = s;
  }

  reseed(from: number, to: number) {
    const T = this.trailPoints;
    const v = new Float32Array(3);
    const spacing = 0.05;
    for (let i = from; i < to; i++) {
      const s = this.seeds.length ? this.seeds[i % this.seeds.length] : { x: 2, y: 3, z: 4 };
      this.px[i] = s.x + (Math.random() - 0.5) * this.seedJitter;
      this.py[i] = s.y + (Math.random() - 0.5) * this.seedJitter;
      this.pz[i] = s.z + (Math.random() - 0.5) * this.seedJitter;
      this.age[i] = Math.random() * 2.0;
      this.life[i] = 2.4 + Math.random() * 3.4;
      this.head[i] = 0;
      this.spd[i] = 0;
      this.trailDist[i] = 0;

      // 沿逆流方向回溯, 生成一条初始拖尾
      let x = this.px[i],
        y = this.py[i],
        z = this.pz[i];
      const tmp: number[] = [];
      if (this.prefillSampler) {
        for (let t = 0; t < T - 1; t++) {
          if (!this.prefillSampler(x, y, z, v)) break;
          const sp = Math.hypot(v[0], v[1], v[2]);
          if (sp < 1e-4) break;
          const step = spacing / sp;
          x -= v[0] * step;
          y -= v[1] * step;
          z -= v[2] * step;
          tmp.push(x, y, z);
        }
      }
      // 环形缓冲: 从最旧到最新
      for (let t = 0; t < T; t++) {
        const k = i * T + t;
        this.histX[k] = this.px[i];
        this.histY[k] = this.py[i];
        this.histZ[k] = this.pz[i];
      }
      // 回溯点是逆着时间走的, 所以最远的点是尾巴
      const n = tmp.length / 3;
      for (let t = 0; t < n; t++) {
        // 把尾巴放在 slot 0 侧, 头部放在最新
        const slot = (this.head[i] + T - 1 - t + T) % T;
        const k = i * T + slot;
        this.histX[k] = tmp[t * 3];
        this.histY[k] = tmp[t * 3 + 1];
        this.histZ[k] = tmp[t * 3 + 2];
      }
    }
  }

  /**
   * 推进粒子并重建几何。
   * sampler(x,y,z,out) 返回 false 表示进入实体 (粒子重生)。
   * 拖尾按"走过的距离"记录 (每 ~5 cm 一个点), 因此不论快慢拖尾都是均匀的。
   */
  update(
    dt: number,
    sampler: (x: number, y: number, z: number, out: Float32Array) => boolean,
    colorize: (speed: number, x: number, y: number, z: number, out: [number, number, number]) => void,
    opts: { sizeScale?: number; opacity?: number; trailSpacing?: number } = {},
  ) {
    const M = this.maxParticles;
    const T = this.trailPoints;
    const v = new Float32Array(3);
    const steps = Math.min(3, Math.max(1, Math.ceil(Math.min(dt, 0.06) / 0.018)));
    const h = Math.min(dt, 0.06) / steps;
    const spacing = opts.trailSpacing ?? 0.05;
    const active = Math.min(M, this.activeCount || M);

    for (let i = 0; i < active; i++) {
      let x = this.px[i],
        y = this.py[i],
        z = this.pz[i];
      let alive = true;
      let sx = 0,
        sy = 0,
        sz = 0;
      for (let s = 0; s < steps; s++) {
        if (!sampler(x, y, z, v)) {
          alive = false;
          break;
        }
        // 速度过大时限制步长, 避免跨过菇架
        const sp = Math.hypot(v[0], v[1], v[2]);
        const maxStep = 0.055;
        let stepT = h;
        if (sp * stepT > maxStep) stepT = maxStep / sp;
        x += v[0] * stepT;
        y += v[1] * stepT;
        z += v[2] * stepT;
        sx += v[0];
        sy += v[1];
        sz += v[2];
      }
      this.age[i] += dt;
      if (!alive || this.age[i] > this.life[i]) {
        this.reseed(i, i + 1);
        this.age[i] = 0;
        this.spd[i] = 0;
        continue;
      }
      this.px[i] = x;
      this.py[i] = y;
      this.pz[i] = z;
      this.spd[i] = Math.hypot(sx, sy, sz) / steps;

      // 距离驱动的拖尾记录: 每走够 spacing 就推入一个新点
      const headSlot = this.head[i];
      const k = i * T + headSlot;
      this.trailDist[i] += this.spd[i] * dt;
      if (this.trailDist[i] >= spacing) {
        this.trailDist[i] = 0;
        this.histX[k] = x;
        this.histY[k] = y;
        this.histZ[k] = z;
        this.head[i] = (headSlot + 1) % T;
      } else {
        // 更新当前头部位置, 让拖尾贴着粒子
        const newest = (headSlot + T - 1) % T;
        const nk = i * T + newest;
        this.histX[nk] = x;
        this.histY[nk] = y;
        this.histZ[nk] = z;
      }
    }

    this.rebuild(colorize, opts);
  }

  private rebuild(
    colorize: (speed: number, x: number, y: number, z: number, out: [number, number, number]) => void,
    opts: { sizeScale?: number; opacity?: number },
  ) {
    const M = this.maxParticles;
    const T = this.trailPoints;
    const pos = this.positions;
    const alpha = this.alphas;
    const size = this.sizes;
    const col = this.colors;
    const rgb: [number, number, number] = [0, 0, 0];
    const baseSize = (this.material.uniforms.uPointSize as { value: number }).value * (opts.sizeScale ?? 1);
    // 活跃粒子数 (0 = 全部)
    const active = Math.min(M, this.activeCount || M);

    for (let i = 0; i < active; i++) {
      const headSlot = this.head[i];
      colorize(this.spd[i], this.px[i], this.py[i], this.pz[i], rgb);
      const lifeFade = Math.min(1, Math.min(this.age[i] / 0.2, (this.life[i] - this.age[i]) / 0.45));
      for (let t = 0; t < T; t++) {
        // t=0 是最新点 (头), 越往后越旧 -> 用作沿拖尾参数
        const slot = (headSlot + T - 1 - t + T) % T;
        const k = i * T + slot;
        const p = i * T + t;
        const vb = p * VERTS_PER_POINT;
        const x = this.histX[k],
          y = this.histY[k],
          z = this.histZ[k];
        // 头部最粗最亮
        const along = 1 - t / Math.max(1, T - 1);
        const sz = baseSize * (0.25 + 0.75 * along);
        for (let q = 0; q < VERTS_PER_POINT; q++) {
          const v3 = (vb + q) * 3;
          pos[v3] = x;
          pos[v3 + 1] = y;
          pos[v3 + 2] = z;
          alpha[vb + q] = lifeFade * (0.12 + 0.88 * along * along);
          size[vb + q] = sz;
        }
        const c3 = p * 3;
        col[c3] = rgb[0];
        col[c3 + 1] = rgb[1];
        col[c3 + 2] = rgb[2];
      }
    }
    this.posAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
    this.colorAttr.needsUpdate = true;
    this.geometry.setDrawRange(0, active * T * INDICES_PER_POINT);
    if (opts.opacity !== undefined) (this.material.uniforms.uOpacity as { value: number }).value = opts.opacity;
  }

  /** 视口高度 -> 透视尺度, 让粒子在世界单位下渲染 */
  setViewport(height: number, fovDeg: number) {
    const s = height / (2 * Math.tan((fovDeg * Math.PI) / 360));
    (this.material.uniforms.uPixelScale as { value: number }).value = 1 / s;
  }

  setVisible(v: boolean) {
    this.object.visible = v;
  }

  setOpacity(v: number) {
    (this.material.uniforms.uOpacity as { value: number }).value = v;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}
