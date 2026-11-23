/** 核心逻辑冒烟测试(node 环境运行,不依赖 DOM) */
import { generateHeights } from '../src/noise';
import { heightAt } from '../src/terrain';
import { samplePlan, elevationAt, gradeSegments, formatChainage } from '../src/alignment';
import { store, derived, recomputeDerived, toPlainProject, applyProject } from '../src/store';

let failures = 0;
function check(name: string, cond: boolean): void {
  if (cond) {
    console.log(`  ok  ${name}`);
  } else {
    failures++;
    console.error(`FAIL  ${name}`);
  }
}

// 1. 地形生成与采样
const heights = generateHeights(128, 42, 40);
check('地形高度数组长度', heights.length === 128 * 128);
check('地形高度有限', heights.every((h) => Number.isFinite(h)));
const terrain = { size: 2000, res: 128, heights };
check('角点高度一致', Math.abs(heightAt(terrain, -1000, 1000) - heights[0]) < 1e-6);
check('中心高度有限', Number.isFinite(heightAt(terrain, 0, 0)));

// 2. 平面线形采样
const plan = [
  { x: -800, z: -600 },
  { x: -300, z: -200 },
  { x: 200, z: -300 },
  { x: 700, z: 500 },
];
const samples = samplePlan(plan, 5);
check('采样点数量', samples.length > 100);
const total = samples[samples.length - 1].s;
check('里程递增', samples.every((s, i) => i === 0 || s.s > samples[i - 1].s));
check('总长合理(直线距离~1900m,曲线应更长)', total > 1800 && total < 2600);
check('法向为单位向量', samples.every((s) => Math.abs(Math.hypot(s.nx, s.nz) - 1) < 1e-3));

// 3. 纵断面与坡度
const profile = [
  { s: 0, elev: 10 },
  { s: 1000, elev: 30 },
  { s: 2000, elev: 5 },
];
check('纵断面端点', elevationAt(profile, 0) === 10 && elevationAt(profile, 2000) === 5);
check('纵断面插值', Math.abs(elevationAt(profile, 500) - 20) < 1e-9);
check('纵断面外延', elevationAt(profile, -100) === 10 && elevationAt(profile, 9999) === 5);
const grades = gradeSegments(profile);
check('坡段数量', grades.length === 2);
check('坡度值', Math.abs(grades[0].grade - 2) < 1e-9 && Math.abs(grades[1].grade + 2.5) < 1e-9);
check('里程格式化', formatChainage(12500) === 'K12+500');

// 4. 默认工程派生数据
recomputeDerived();
check('默认工程有采样', derived.samples.length > 10);
check('轨面高程与采样对齐', derived.trackElev.length === derived.samples.length);
check('最大坡度为正', derived.maxGrade > 0);
check('存在挖填变化', derived.trackElev.some((e, i) => e > derived.terrainElev[i]) && derived.trackElev.some((e, i) => e < derived.terrainElev[i]));

// 5. 导出 -> 导入回环
const plain = toPlainProject();
const json = JSON.parse(JSON.stringify(plain));
const lenBefore = derived.totalLength;
applyProject(json);
check('导入后总长一致', Math.abs(derived.totalLength - lenBefore) < 1e-6);
check('导入后地形一致', store.terrain.heights.length === plain.terrain.heights.length);
check('导入后控制点一致', store.planPoints.length === plain.planPoints.length && store.profilePoints.length === plain.profilePoints.length);

// 6. 修改控制点触发重算(模拟拖动)
store.planPoints[1].x += 100;
recomputeDerived();
check('拖动后总长变化', Math.abs(derived.totalLength - lenBefore) > 1);

console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
