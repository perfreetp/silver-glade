// 数据管线冒烟测试:generateFrame → assembleChunks → sampleDensity → computeProfile
import { generateFrame, assembleChunks, generateChunk, CHUNK_COUNT, densityToVisibility } from '../src/data/weatherSim';
import { computeProfile, routeCloudBase } from '../src/analysis/profile';

const frame = 6;
const { data, chunks } = await generateFrame(frame);
console.log('frame bytes:', data.length, 'chunks:', chunks.length);

// 分块拼装一致性:重新逐块生成再拼装,应与整帧一致
const chunks2 = [];
for (let cy = 0; cy < 3; cy++)
  for (let cz = 0; cz < 4; cz++)
    for (let cx = 0; cx < 4; cx++) chunks2.push(generateChunk(frame, cx, cy, cz));
const data2 = assembleChunks(chunks2);
let mismatch = 0;
for (let i = 0; i < data.length; i++) if (data[i] !== data2[i]) mismatch++;
console.log('assemble mismatch:', mismatch);

// 密度分布
let min = 255, max = 0, nonzero = 0;
for (const v of data) { if (v < min) min = v; if (v > max) max = v; if (v > 0) nonzero++; }
console.log('density min/max/nonzero%:', min, max, ((nonzero / data.length) * 100).toFixed(1));

// 剖面
const route = { points: [{ x: 8, z: 10 }, { x: 30, z: 26 }, { x: 52, z: 48 }], bandMin: 600, bandMax: 2500 };
const prof = computeProfile(data, route.points, route.bandMin, route.bandMax);
console.log('profile samples:', prof.samples.length, 'segments:', prof.segments.length, 'totalKm:', prof.totalLengthKm.toFixed(1));
for (const s of prof.segments) {
  console.log(`  seg${s.index + 1}: len=${s.lengthKm.toFixed(1)}km minVis=${s.minVisKm.toFixed(2)}km meanVis=${s.meanVisKm.toFixed(2)}km msaMax=${s.msaMaxM.toFixed(0)}m clearance=${s.clearanceM.toFixed(0)}m`);
}
const visVals = prof.samples.map((s) => s.minVisKm);
console.log('minVis range:', Math.min(...visVals).toFixed(2), '-', Math.max(...visVals).toFixed(2));
const cb = routeCloudBase(data, route.points, 0.4);
console.log('cloudBase along route:', cb ? `min=${(cb.min * 1000).toFixed(0)}m mean=${(cb.mean * 1000).toFixed(0)}m` : 'none');
console.log('vis of d=0.5:', densityToVisibility(0.5).toFixed(2), 'km');
console.log('OK');
