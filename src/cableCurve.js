// 线缆曲线：正交折线 -> 弯曲半径圆角 / 样条平滑 -> 弧长等距重采样
import * as THREE from 'three';

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _u1 = new THREE.Vector3();
const _u2 = new THREE.Vector3();
const _bis = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _e1 = new THREE.Vector3();
const _e2 = new THREE.Vector3();
const _rad = new THREE.Vector3();

// 构建圆角描述符：直线段 + 圆弧段，携带累计弧长
// waypoints: THREE.Vector3[]；bendR: 目标弯曲半径
export function buildFilletDescriptors(waypoints, bendR) {
  const pts = waypoints;
  const segs = []; // { type:'line', a, b } | { type:'arc', center, e1, e2, r, a0, a1 }
  if (pts.length < 2) return { segs, totalLength: 0 };

  let cursor = pts[0].clone();
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = pts[i - 1], pi = pts[i], next = pts[i + 1];
    _u1.subVectors(pi, prev);
    _u2.subVectors(next, pi);
    const l1 = _u1.length(), l2 = _u2.length();
    if (l1 < 1e-9 || l2 < 1e-9) continue;
    _u1.divideScalar(l1);
    _u2.divideScalar(l2);
    const cosT = THREE.MathUtils.clamp(_u1.dot(_u2), -0.999999, 0.999999);
    const theta = Math.acos(cosT);                 // 转角
    if (theta < 1e-4) continue;                    // 共线，无需圆角

    // 切线长 d = r·tan(θ/2)，受相邻段长度约束
    let d = bendR * Math.tan(theta / 2);
    const maxD = Math.min(l1, l2) * 0.49;
    let rEff = bendR;
    if (d > maxD) { d = maxD; rEff = d / Math.tan(theta / 2); }

    const t1 = _v1.copy(pi).addScaledVector(_u1, -d);   // 入切点
    const t2 = _v2.copy(pi).addScaledVector(_u2, d);    // 出切点

    // 直线段：cursor -> t1
    if (cursor.distanceToSquared(t1) > 1e-12) {
      segs.push({ type: 'line', a: cursor.clone(), b: t1.clone() });
    }

    // 圆心：在 -u1 与 u2 的内角平分线上，L = r/cos(θ/2)
    _bis.subVectors(_u2, _u1).normalize();
    const center = pi.clone().addScaledVector(_bis, rEff / Math.cos(theta / 2));
    _axis.crossVectors(_u1, _u2);
    if (_axis.lengthSq() < 1e-12) {
      // 近乎折返：任取垂直轴
      _axis.set(1, 0, 0).cross(_u1);
      if (_axis.lengthSq() < 1e-9) _axis.set(0, 1, 0).cross(_u1);
    }
    _axis.normalize();
    _e1.subVectors(t1, center).divideScalar(rEff);            // 起始径向
    _e2.crossVectors(_axis, _e1).normalize();                // 扫掠方向基向量
    segs.push({
      type: 'arc', center: center.clone(),
      e1: _e1.clone(), e2: _e2.clone(),
      r: rEff, a0: 0, a1: theta,
    });

    cursor = t2.clone();
  }
  // 末段直线
  const last = pts[pts.length - 1];
  if (cursor.distanceToSquared(last) > 1e-12) {
    segs.push({ type: 'line', a: cursor.clone(), b: last.clone() });
  }

  let total = 0;
  for (const s of segs) {
    s.len = s.type === 'line' ? s.a.distanceTo(s.b) : s.r * (s.a1 - s.a0);
    s.cumStart = total;
    total += s.len;
  }
  return { segs, totalLength: total, bendRadiusUsed: bendR };
}

// 按描述符在弧长 s 处取点
function pointAtDistance(segs, totalLength, s, out) {
  if (s <= 0) return out.copy(segs[0].type === 'line' ? segs[0].a : segs[0].center);
  if (s >= totalLength) {
    const last = segs[segs.length - 1];
    return out.copy(last.type === 'line' ? last.b : pointArc(last, last.a1, out));
  }
  for (const seg of segs) {
    if (s <= seg.cumStart + seg.len) {
      const local = (s - seg.cumStart) / seg.len;
      if (seg.type === 'line') {
        return out.lerpVectors(seg.a, seg.b, local);
      }
      const a = seg.a0 + (seg.a1 - seg.a0) * local;
      return pointArc(seg, a, out);
    }
  }
}

function pointArc(seg, a, out) {
  const ca = Math.cos(a), sa = Math.sin(a);
  return out.copy(seg.center)
    .addScaledVector(seg.e1, seg.r * ca)
    .addScaledVector(seg.e2, seg.r * sa);
}

// 圆角模式：等距重采样为 N 段（N+1 点）
export function resampleFillet(desc, segments) {
  const points = new Array(segments + 1);
  const out = new THREE.Vector3();
  for (let i = 0; i <= segments; i++) {
    const s = (i / segments) * desc.totalLength;
    points[i] = pointAtDistance(desc.segs, desc.totalLength, s, out).clone();
  }
  return points;
}

// 样条模式：以圆角切点/弧中点为控制多边形，向心 Catmull-Rom 后按弧长等距取点
export function resampleSpline(waypoints, bendR, segments) {
  if (waypoints.length === 2) {
    const points = new Array(segments + 1);
    for (let i = 0; i <= segments; i++) {
      points[i] = waypoints[0].clone().lerp(waypoints[1], i / segments);
    }
    return points;
  }
  const desc = buildFilletDescriptors(waypoints, bendR);
  const controls = [];
  controls.push(waypoints[0].clone());
  for (const seg of desc.segs) {
    if (seg.type === 'line') {
      controls.push(seg.b.clone());
    } else {
      // 弧上取三个控制点，保证样条贴合圆角形状
      controls.push(pointArc(seg, seg.a0, new THREE.Vector3()));
      controls.push(pointArc(seg, (seg.a0 + seg.a1) / 2, new THREE.Vector3()));
      controls.push(pointArc(seg, seg.a1, new THREE.Vector3()));
    }
  }
  // 去重相邻重复点
  const dedup = [];
  for (const p of controls) {
    if (!dedup.length || dedup[dedup.length - 1].distanceToSquared(p) > 1e-12) dedup.push(p);
  }
  const curve = new THREE.CatmullRomCurve3(dedup, false, 'centripetal', 0.5);
  return curve.getSpacedPoints(segments);
}

// 估算曲线最小弯曲半径：相邻三点外接圆半径 M = abc/(4A)
export function estimateMinRadius(points) {
  let minR = Infinity;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const ab = new THREE.Vector3(), bc = new THREE.Vector3();
  for (let i = 1; i < points.length - 1; i++) {
    a.copy(points[i - 1]); b.copy(points[i]); c.copy(points[i + 1]);
    const la = ab.subVectors(b, a).length();
    const lb = bc.subVectors(c, b).length();
    const lc = a.distanceTo(c);
    const cross = _rad.crossVectors(ab, bc).length();
    if (cross < 1e-12) continue;
    const area = cross / 2;
    const r = (la * lb * lc) / (4 * area);
    if (r < minR) minR = r;
  }
  return minR === Infinity ? null : minR;
}

// 折线/采样点总长度
export function polylineLength(points) {
  let len = 0;
  for (let i = 1; i < points.length; i++) len += points[i - 1].distanceTo(points[i]);
  return len;
}
