import * as THREE from 'three';

export const DEG2RAD = Math.PI / 180;

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** 折射：Snell 定律。入射方向 I 与法线 N 均为单位向量，eta = n1/n2；全反射时返回 null */
export function refract(I: THREE.Vector3, N: THREE.Vector3, eta: number): THREE.Vector3 | null {
  const cosi = -I.dot(N);
  let n = N;
  let cosThetaI = cosi;
  if (cosi < 0) {
    // 光线从背面击中表面，翻转法线
    n = N.clone().negate();
    cosThetaI = -cosi;
  }
  const sin2ThetaT = eta * eta * (1 - cosThetaI * cosThetaI);
  if (sin2ThetaT > 1) return null; // 全反射
  const cosThetaT = Math.sqrt(1 - sin2ThetaT);
  return n
    .clone()
    .multiplyScalar(eta * cosThetaI - cosThetaT)
    .addScaledVector(I, eta)
    .normalize();
}

/** 生成可复现的伪随机序列（mulberry32），保证拖动过程中采样图案稳定、不闪烁 */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 单位球面内均匀方向（锥形采样），axis 为单位轴，halfAngleRad 为半锥角 */
export function sampleCone(
  rng: () => number,
  axis: THREE.Vector3,
  halfAngleRad: number,
  out: THREE.Vector3,
): THREE.Vector3 {
  const cosHalf = Math.cos(halfAngleRad);
  const cosTheta = 1 - rng() * (1 - cosHalf);
  const sinTheta = Math.sqrt(Math.max(0, 1 - cosTheta * cosTheta));
  const phi = 2 * Math.PI * rng();
  // 相对 axis 的局部坐标
  const lx = sinTheta * Math.cos(phi);
  const ly = sinTheta * Math.sin(phi);
  const lz = cosTheta;

  const ref = Math.abs(axis.z) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
  const t1 = new THREE.Vector3().crossVectors(axis, ref).normalize();
  const t2 = new THREE.Vector3().crossVectors(axis, t1).normalize();
  out
    .copy(axis)
    .multiplyScalar(lz)
    .addScaledVector(t1, lx)
    .addScaledVector(t2, ly)
    .normalize();
  return out;
}
