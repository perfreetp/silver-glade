import * as THREE from 'three';
import { GRAVITY, PARTICLE, SNOW_GRID, SNOW_LEVELS, TERRAIN } from './constants';
import type { MachineConfig } from './types';
import { terrainHeight, windVector, yawToVector } from './mathUtils';
import type { SnowField } from './SnowField';

/**
 * 雪粒粒子系统（模块三核心）。
 *
 * 性能策略（目标：2 万粒同屏 60fps）：
 * 1. SoA 结构的定长 Float32Array 预分配 20k 槽位，零 GC；自由链表回收死亡粒子；
 * 2. 渲染用 THREE.InstancedMesh（实例化绘制，单次 draw call）；
 * 3. 每帧只做一次 setMatrixAt 批量写入 + instanceMatrix.needsUpdate，颜色按密度网格批量调制；
 * 4. 密度网格（36×54）统计活跃粒子数，驱动实例颜色与尺寸 —— 高密度区域更白更大更不透明，
 *    与单粒 sprite 叠加共同"按密度合成体积感"。
 *
 * 联动：wind 直接读每台造雪机的最新参数，风向变化时发射初速、风加速度、
 * 炮口轨迹（TrajectoryPreview）、积雪落点全部在同一帧用新风场重算。
 */
export class ParticleSystem {
  readonly max = PARTICLE.MAX_COUNT;
  readonly mesh: THREE.InstancedMesh;

  private px = new Float32Array(this.max);
  private py = new Float32Array(this.max);
  private pz = new Float32Array(this.max);
  private vx = new Float32Array(this.max);
  private vy = new Float32Array(this.max);
  private vz = new Float32Array(this.max);
  private life = new Float32Array(this.max);
  private maxLife = new Float32Array(this.max);
  private alive = new Uint8Array(this.max);
  /** 每颗粒子归属的造雪机 id —— 各机风场独立，粒子按所属机器的风推进 */
  private owner = new Int16Array(this.max);
  private machineById = new Map<number, MachineConfig>();
  private freeSlots: number[] = [];
  private activeCount = 0;

  /** 每台造雪机的发射余量（小数累积，保证低帧率也不丢发射率） */
  private emitCarry = new Map<number, number>();

  private density = new Float32Array(PARTICLE.DENSITY_NX * PARTICLE.DENSITY_NZ);
  private dummy = new THREE.Object3D();
  private tmpColor = new THREE.Color();
  private wind = new THREE.Vector3();
  private dir = new THREE.Vector3();

  constructor(private snowField: SnowField) {
    const geo = new THREE.SphereGeometry(0.11, 6, 5);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.92,
      depthWrite: true, // 关键：写深度，与积雪层/地形按深度正确遮挡
      depthTest: true,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, this.max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = this.max;
    // 全部实例先缩到 0
    this.dummy.scale.setScalar(0);
    this.dummy.updateMatrix();
    for (let i = 0; i < this.max; i++) this.mesh.setMatrixAt(i, this.dummy.matrix);
    this.mesh.instanceMatrix.needsUpdate = true;

    for (let i = this.max - 1; i >= 0; i--) this.freeSlots.push(i);
  }

  get active(): number {
    return this.activeCount;
  }

  /**
   * 推进一个固定步长。
   * @param dt 固定时间步（秒）
   * @param machines 当前造雪机列表（参数随时可变，本帧即时生效）
   */
  step(dt: number, machines: readonly MachineConfig[]): void {
    this.machineById.clear();
    for (const m of machines) this.machineById.set(m.id, m);
    this.emit(dt, machines);
    this.integrate(dt);
    this.computeDensity();
    this.writeInstances();
  }

  private emit(dt: number, machines: readonly MachineConfig[]): void {
    for (const m of machines) {
      const spec = SNOW_LEVELS[m.level - 1];
      const carried = (this.emitCarry.get(m.id) ?? 0) + spec.rate * dt;
      let n = Math.floor(carried);
      this.emitCarry.set(m.id, carried - n);
      if (this.freeSlots.length < n) n = this.freeSlots.length;
      if (n === 0) continue;

      const baseY = terrainHeight(m.x, m.z) + 2.4; // 炮口高度
      yawToVector(m.yaw, this.dir);
      const pitchRad = (m.pitch * Math.PI) / 180;
      const cosPitch = Math.cos(pitchRad);
      const dx = this.dir.x * cosPitch;
      const dz = this.dir.z * cosPitch;
      const dy = Math.sin(pitchRad);

      for (let k = 0; k < n; k++) {
        const slot = this.freeSlots.pop()!;
        // 炮口散射锥
        const spread = 0.09;
        const sx = (Math.random() - 0.5) * spread;
        const sy = (Math.random() - 0.5) * spread;
        const sz = (Math.random() - 0.5) * spread;
        const jitter = 0.85 + Math.random() * 0.3;
        this.px[slot] = m.x;
        this.py[slot] = baseY;
        this.pz[slot] = m.z;
        this.vx[slot] = (dx + sx) * spec.speed * jitter;
        this.vy[slot] = (dy + sy) * spec.speed * jitter;
        this.vz[slot] = (dz + sz) * spec.speed * jitter;
        const l = PARTICLE.LIFE * (0.75 + Math.random() * 0.5);
        this.life[slot] = l;
        this.maxLife[slot] = l;
        this.owner[slot] = m.id;
        this.alive[slot] = 1;
        this.activeCount++;
      }
    }
  }

  private integrate(dt: number): void {
    // 风场随空间缓变（加一点湍流项），避免所有粒子轨迹完全重合
    for (let i = 0; i < this.max; i++) {
      if (!this.alive[i]) continue;
      const m = this.machineById.get(this.owner[i]);
      if (m) {
        windVector(m.wind, this.wind);
        const turb = 0.9;
        const tx = Math.sin(this.py[i] * 1.7 + this.pz[i] * 0.6) * turb;
        const tz = Math.cos(this.px[i] * 1.3 + this.py[i] * 0.9) * turb;
        // 风对轻雪粒的拖拽趋风（指数趋近风速）
        const k = 1 - Math.exp(-1.6 * dt);
        this.vx[i] += (this.wind.x + tx - this.vx[i]) * k;
        this.vz[i] += (this.wind.z + tz - this.vz[i]) * k;
      }
      this.vy[i] -= GRAVITY * dt;

      this.px[i] += this.vx[i] * dt;
      this.py[i] += this.vy[i] * dt;
      this.pz[i] += this.vz[i] * dt;
      this.life[i] -= dt;

      // 碰撞面 = 地形基岩 + 当前积雪厚度（雪粒落在雪面上，实现层间正确遮挡）
      const ground = terrainHeight(this.px[i], this.pz[i]) + this.snowField.sampleDepth(this.px[i], this.pz[i]);
      const expired = this.life[i] <= 0;
      const hit = this.py[i] <= ground;

      if (hit || expired) {
        if (hit && this.snowField.inBounds(this.px[i], this.pz[i])) {
          // 落地：动态雪粒转为静态积雪，按剩余速度微调溅射量
          const impact = Math.min(1, (this.vy[i] * this.vy[i]) / 120);
          this.snowField.deposit(this.px[i], this.pz[i], 0.55 + impact * 0.4);
        }
        this.kill(i);
      }
    }
  }

  // 粒子通过 owner 数组记住所属造雪机，积分时查 machineById ——
  // 风向在 UI 上改变后，MachineManager 中的配置立即变化，下一个固定步长
  // 所有在空粒子即用新风场推进，发射、飘移、堆积三处同帧联动。

  private computeDensity(): void {
    this.density.fill(0);
    const nx = PARTICLE.DENSITY_NX;
    const nz = PARTICLE.DENSITY_NZ;
    for (let i = 0; i < this.max; i++) {
      if (!this.alive[i]) continue;
      const gx = Math.min(nx - 1, Math.max(0, Math.floor((this.px[i] / TERRAIN.WIDTH + 0.5) * nx)));
      const gz = Math.min(nz - 1, Math.max(0, Math.floor((this.pz[i] / TERRAIN.LENGTH + 0.5) * nz)));
      this.density[gz * nx + gx]++;
    }
  }

  private writeInstances(): void {
    const nx = PARTICLE.DENSITY_NX;
    const nz = PARTICLE.DENSITY_NZ;
    for (let i = 0; i < this.max; i++) {
      if (!this.alive[i]) {
        this.dummy.scale.setScalar(0);
        this.dummy.updateMatrix();
        this.mesh.setMatrixAt(i, this.dummy.matrix);
        continue;
      }
      const gx = Math.min(nx - 1, Math.max(0, Math.floor((this.px[i] / TERRAIN.WIDTH + 0.5) * nx)));
      const gz = Math.min(nz - 1, Math.max(0, Math.floor((this.pz[i] / TERRAIN.LENGTH + 0.5) * nz)));
      const d = this.density[gz * nx + gx];
      // 密度合成：密集团簇更亮、略大，形成雪雾体积感
      const densityT = Math.min(1, d / 26);
      const fadeIn = Math.min(1, (this.maxLife[i] - this.life[i]) * 3 + 0.25);
      const scale = (0.75 + densityT * 0.9) * fadeIn;
      this.dummy.position.set(this.px[i], this.py[i], this.pz[i]);
      this.dummy.scale.setScalar(scale);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);

      // 冷白 -> 暖白微差，密度高时纯白
      this.tmpColor.setRGB(0.78 + densityT * 0.22, 0.84 + densityT * 0.16, 0.95 + densityT * 0.05);
      this.mesh.setColorAt(i, this.tmpColor);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  private kill(slot: number): void {
    this.alive[slot] = 0;
    this.activeCount--;
    this.freeSlots.push(slot);
  }

  reset(): void {
    for (let i = 0; i < this.max; i++) {
      if (this.alive[i]) this.kill(i);
    }
    this.emitCarry.clear();
  }

  /** 饱和度常量供其他模块引用 */
  static get MAX_SNOW_DEPTH(): number {
    return SNOW_GRID.MAX_DEPTH;
  }
}
