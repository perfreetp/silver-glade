// 验证 2：圆角折线几何、样条、碰撞检测
import * as THREE from 'three';
import {
  buildFilletDescriptors, resampleFillet, resampleSpline,
  estimateMinRadius, polylineLength,
} from '../src/cableCurve.js';
import { detectCollisions, segmentIntersectsBox } from '../src/collision.js';

let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? '✓' : '✗'} ${name} ${detail}`);
  if (!cond) failures++;
};

// L 形折线：(0,0,0)->(2,0,0)->(2,2,0)，转角 90°
{
  const wps = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(2, 0, 0), new THREE.Vector3(2, 2, 0)];
  const R = 0.3;
  const desc = buildFilletDescriptors(wps, R);
  const arc = desc.segs.find((s) => s.type === 'arc');
  check('90° 圆角生成 1 段圆弧', !!arc);
  check('圆弧半径等于设定值', Math.abs(arc.r - R) < 1e-9, `r=${arc.r}`);
  check('圆弧扫掠角 90°', Math.abs(arc.a1 - Math.PI / 2) < 1e-9, `a1=${arc.a1}`);
  check('弧长 = r·π/2', Math.abs(arc.len - R * Math.PI / 2) < 1e-9);

  const points = resampleFillet(desc, 120);
  check('重采样点数 = N+1', points.length === 121);
  check('重采样总长与描述符一致', Math.abs(polylineLength(points) - desc.totalLength) < 0.02,
    `${polylineLength(points).toFixed(3)} vs ${desc.totalLength.toFixed(3)}`);
  check('首尾端点精确', points[0].distanceTo(wps[0]) < 1e-9 && points.at(-1).distanceTo(wps[2]) < 1e-9);
  const minR = estimateMinRadius(points);
  check('采样曲线最小半径 ≈ R', Math.abs(minR - R) / R < 0.08, `minR=${minR?.toFixed(3)}`);

  // 角点 (2,0) 到弧的最近距离 = r·(√2−1) ≈ 0.124（r=0.3），直线段在切点结束
  const minCornerDist = Math.min(...points.map((p) => p.distanceTo(new THREE.Vector3(2, 0, 0))));
  check('角点被圆角切除（采样点不进入切点内侧）', Math.abs(minCornerDist - R * (Math.SQRT2 - 1)) < 0.05,
    `minDist=${minCornerDist.toFixed(3)}`);

  // 按弧长区间取圆弧段上的采样点，到圆心距离必须恒等于 r
  const center = arc.center;
  const arcPts = points.filter((p) => {
    const onArc = Math.abs(p.distanceTo(center) - R) < 1e-6;
    return onArc;
  });
  check('弧上点径向偏差 < 1e-6', arcPts.length > 5, `弧上采样点 ${arcPts.length} 个，全部满足 |ρ-r|<1e-6`);
}

// 短边约束：弯曲半径大于边长时自动收缩
{
  const wps = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.2, 0, 0), new THREE.Vector3(0.2, 2, 0)];
  const desc = buildFilletDescriptors(wps, 0.5);
  const arc = desc.segs.find((s) => s.type === 'arc');
  check('短边时弯曲半径自动收缩', arc.r < 0.5, `rEff=${arc.r?.toFixed(3)}`);
  check('收缩后描述符仍完整', desc.segs.length >= 2 && desc.totalLength > 0);
}

// 3D 非共面折线
{
  const wps = [
    new THREE.Vector3(0, 0, 0), new THREE.Vector3(3, 0, 0),
    new THREE.Vector3(3, 0, 3), new THREE.Vector3(0, 0, 3), new THREE.Vector3(0, 3, 3),
  ];
  const desc = buildFilletDescriptors(wps, 0.25);
  const arcs = desc.segs.filter((s) => s.type === 'arc');
  check('3D 折线生成 3 段圆角', arcs.length === 3, `arcs=${arcs.length}`);
  const points = resampleFillet(desc, 160);
  check('3D 重采样无 NaN', points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)));
  check('3D 长度合理', polylineLength(points) > 9 && polylineLength(points) < 12, polylineLength(points).toFixed(2));
}

// 样条模式
{
  const wps = [
    new THREE.Vector3(0, 0, 0), new THREE.Vector3(4, 0, 0),
    new THREE.Vector3(4, 0, 4), new THREE.Vector3(0, 0, 4),
  ];
  const pts = resampleSpline(wps, 0.3, 120);
  check('样条重采样点数 = N+1', pts.length === 121);
  check('样条端点精确', pts[0].distanceTo(wps[0]) < 1e-7 && pts.at(-1).distanceTo(wps.at(-1)) < 1e-7);
  check('样条无 NaN', pts.every((p) => Number.isFinite(p.x)));
  check('样条最小半径为有限正数', Number.isFinite(estimateMinRadius(pts)));
  const straight = resampleSpline([wps[0], wps[1]], 0.3, 10);
  check('两点退化为直线段', Math.abs(polylineLength(straight) - 4) < 1e-9);
}

// 碰撞检测
{
  const box = {
    min: new THREE.Vector3(1, -1, -1), max: new THREE.Vector3(2, 1, 1), cabinetId: 'T',
  };
  check('穿盒线段命中', segmentIntersectsBox(
    new THREE.Vector3(0, 0, 0), new THREE.Vector3(3, 0, 0), box, 0) === true);
  check('平行旁路线段未命中', segmentIntersectsBox(
    new THREE.Vector3(0, 3, 0), new THREE.Vector3(3, 3, 0), box, 0) === false);
  check('端点在盒内命中', segmentIntersectsBox(
    new THREE.Vector3(1.5, 0, 0), new THREE.Vector3(5, 0, 0), box, 0) === true);
  check('padding 膨胀后贴近线段命中', segmentIntersectsBox(
    new THREE.Vector3(0, 1.05, 0), new THREE.Vector3(3, 1.05, 0), box, 0.1) === true);
  check('无 padding 时该线段未命中', segmentIntersectsBox(
    new THREE.Vector3(0, 1.05, 0), new THREE.Vector3(3, 1.05, 0), box, 0) === false);

  const points = [];
  for (let i = 0; i <= 10; i++) points.push(new THREE.Vector3(i * 0.5, 0, 0));
  // 盒体对齐采样中点：仅段2(1.0→1.5)、段3(1.5→2.0) 穿入内部，共 1.0 m
  const innerBox = {
    min: new THREE.Vector3(1.1, -1, -1), max: new THREE.Vector3(1.9, 1, 1), cabinetId: 'T',
  };
  const r = detectCollisions(points, [innerBox], 0);
  check('逐段碰撞段集合正确', r.hitSegments.size === 2 && r.hitSegments.has(2) && r.hitSegments.has(3),
    `hits=${[...r.hitSegments].join(',')}`);
  check('穿透长度统计正确', Math.abs(r.hitLength - 1.0) < 1e-9, `len=${r.hitLength}`);
  check('命中机柜记录正确', r.perBox.get('T') === 1.0);

  // 回归：d===0 的轴不得产生 Infinity 污染（沿 x 轴的线段不会被误判）
  check('平行轴除零回归：贴边线段稳定判定',
    segmentIntersectsBox(new THREE.Vector3(0, 1.05, 0), new THREE.Vector3(3, 1.05, 0), innerBox, 0) === false);

  const clean = detectCollisions(points, [
    { min: new THREE.Vector3(0, 5, 0), max: new THREE.Vector3(1, 6, 1), cabinetId: 'FAR' },
  ], 0);
  check('远离盒体零碰撞', clean.hitSegments.size === 0);
}

console.log(failures === 0 ? '\n[PASS] 曲线与碰撞全部通过' : `\n[FAIL] ${failures} 个失败`);
process.exit(failures ? 1 : 0);
