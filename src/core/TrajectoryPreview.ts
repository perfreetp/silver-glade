import * as THREE from 'three';
import { GRAVITY, SNOW_LEVELS } from './constants';
import type { MachineConfig } from './types';
import { terrainHeight, windVector, yawToVector } from './mathUtils';
import type { SnowField } from './SnowField';

const STEP = 0.05;
const MAX_STEPS = 220;

/**
 * 炮口轨迹预览（联动重算第 1 处）。
 *
 * 与 ParticleSystem 使用同一套物理方程（重力 + 风拖拽趋风 + 俯仰/朝向初速度），
 * 确定性积分出一条弹道线，落到"地形 + 积雪"表面即终止。
 * 风向/风速/朝向/俯仰/雪量任一项变化都会触发对应机器的轨迹重建，
 * 落点圆环同时给出堆积预期位置。
 */
export class TrajectoryPreview {
  readonly group = new THREE.Group();
  private lines = new Map<number, THREE.Line>();
  private markers = new Map<number, THREE.Mesh>();

  constructor(private snowField: SnowField) {}

  setVisible(v: boolean): void {
    this.group.visible = v;
  }

  /** 全量重建（机器增删、风向批量变化时调用） */
  rebuild(machines: readonly MachineConfig[]): void {
    const alive = new Set<number>();
    for (const m of machines) {
      alive.add(m.id);
      this.rebuildOne(m);
    }
    for (const [id, line] of this.lines) {
      if (!alive.has(id)) {
        this.group.remove(line);
        line.geometry.dispose();
        this.lines.delete(id);
      }
    }
    for (const [id, marker] of this.markers) {
      if (!alive.has(id)) {
        this.group.remove(marker);
        marker.geometry.dispose();
        this.markers.delete(id);
      }
    }
  }

  /** 单台重算（参数变化时） */
  rebuildOne(m: MachineConfig): void {
    const points = this.integrate(m);

    let line = this.lines.get(m.id);
    if (!line) {
      const geo = new THREE.BufferGeometry();
      const mat = new THREE.LineDashedMaterial({
        color: 0x66d9ff,
        dashSize: 1.1,
        gapSize: 0.7,
        transparent: true,
        opacity: 0.85,
        depthTest: true,
      });
      line = new THREE.Line(geo, mat);
      this.lines.set(m.id, line);
      this.group.add(line);
    }
    line.geometry.dispose();
    line.geometry = new THREE.BufferGeometry().setFromPoints(points);
    line.computeLineDistances();

    const end = points[points.length - 1];
    let marker = this.markers.get(m.id);
    if (!marker) {
      marker = new THREE.Mesh(
        new THREE.RingGeometry(0.9, 1.35, 32),
        new THREE.MeshBasicMaterial({
          color: 0x66d9ff,
          transparent: true,
          opacity: 0.7,
          side: THREE.DoubleSide,
          depthTest: true,
        }),
      );
      marker.rotation.x = -Math.PI / 2;
      this.markers.set(m.id, marker);
      this.group.add(marker);
    }
    marker.position.copy(end);
    marker.position.y += 0.12;
  }

  private integrate(m: MachineConfig): THREE.Vector3[] {
    const spec = SNOW_LEVELS[m.level - 1];
    const yaw = yawToVector(m.yaw);
    const pitchRad = (m.pitch * Math.PI) / 180;
    const wind = windVector(m.wind);

    let x = m.x;
    let y = terrainHeight(m.x, m.z) + 2.4;
    let z = m.z;
    let vx = yaw.x * Math.cos(pitchRad) * spec.speed;
    let vy = Math.sin(pitchRad) * spec.speed;
    let vz = yaw.z * Math.cos(pitchRad) * spec.speed;

    const pts: THREE.Vector3[] = [new THREE.Vector3(x, y, z)];
    const k = 1 - Math.exp(-1.6 * STEP);

    for (let s = 0; s < MAX_STEPS; s++) {
      const tx = Math.sin(y * 1.7 + z * 0.6) * 0.9;
      const tz = Math.cos(x * 1.3 + y * 0.9) * 0.9;
      vx += (wind.x + tx - vx) * k;
      vz += (wind.z + tz - vz) * k;
      vy -= GRAVITY * STEP;
      x += vx * STEP;
      y += vy * STEP;
      z += vz * STEP;

      const ground = terrainHeight(x, z) + this.snowField.sampleDepth(x, z);
      pts.push(new THREE.Vector3(x, y, z));
      if (y <= ground) break;
    }
    return pts;
  }
}
