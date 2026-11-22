<template>
  <div class="profile-analysis">
    <div class="toolbar">
      <span>沿航路垂直剖面(T+{{ String(store.frame).padStart(2, '0') }}h · 阈值档 {{ store.threshold + 1 }})</span>
      <button @click="recompute" :disabled="computing">{{ computing ? '计算中…' : '重新计算' }}</button>
      <button @click="doExportJSON" :disabled="!result">导出 JSON</button>
      <button @click="doExportCSV" :disabled="!result">导出 CSV</button>
    </div>

    <canvas ref="canvasRef" width="980" height="420" class="profile-canvas"></canvas>

    <table class="seg-table" v-if="result">
      <thead>
        <tr>
          <th>航段</th><th>长度 (km)</th><th>最低能见度 (km)</th><th>平均能见度 (km)</th>
          <th>MSA 最高 (m)</th><th>越障余度 (m)</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="seg in result.segments" :key="seg.index">
          <td>{{ seg.index + 1 }}</td>
          <td>{{ seg.lengthKm.toFixed(1) }}</td>
          <td :class="{ bad: seg.minVisKm < 1, warn: seg.minVisKm >= 1 && seg.minVisKm < 3 }">
            {{ seg.minVisKm.toFixed(2) }}
          </td>
          <td>{{ seg.meanVisKm.toFixed(2) }}</td>
          <td>{{ seg.msaMaxM.toFixed(0) }}</td>
          <td :class="{ bad: seg.clearanceM < 0 }">{{ seg.clearanceM.toFixed(0) }}</td>
        </tr>
      </tbody>
    </table>
    <p class="hint" v-if="result">
      色带为能见度(图例见剖面右上);红色虚线为最低安全高度 MSA(地形 +150 m,±2 km 取最大);蓝色带为当前飞行高度带;白色虚线为云底高度。
    </p>
  </div>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import { store } from '../store';
import { getFrameData } from '../data/frameStore';
import { computeProfile, PROFILE_MAX_ALT_KM, type ProfileResult } from '../analysis/profile';
import { exportProfileCSV, exportProfileJSON } from '../export/exporter';

const canvasRef = ref<HTMLCanvasElement | null>(null);
const result = ref<ProfileResult | null>(null);
const computing = ref(false);
let seq = 0;

// 能见度色带(km → RGB)
const STOPS: [number, [number, number, number]][] = [
  [0.2, [127, 29, 29]],
  [0.5, [220, 38, 38]],
  [1.0, [234, 88, 12]],
  [3.0, [245, 158, 11]],
  [5.0, [132, 204, 22]],
  [8.0, [34, 197, 94]],
  [12.0, [14, 165, 233]],
];

function visColor(v: number): [number, number, number] {
  if (v <= STOPS[0][0]) return STOPS[0][1];
  for (let i = 1; i < STOPS.length; i++) {
    if (v <= STOPS[i][0]) {
      const [v0, c0] = STOPS[i - 1];
      const [v1, c1] = STOPS[i];
      const t = (v - v0) / (v1 - v0);
      return [
        Math.round(c0[0] + (c1[0] - c0[0]) * t),
        Math.round(c0[1] + (c1[1] - c0[1]) * t),
        Math.round(c0[2] + (c1[2] - c0[2]) * t),
      ];
    }
  }
  return STOPS[STOPS.length - 1][1];
}

async function recompute(): Promise<void> {
  const mySeq = ++seq;
  computing.value = true;
  try {
    const data = await getFrameData(store.frame);
    if (mySeq !== seq) return;
    result.value = computeProfile(
      data,
      store.route.points,
      store.route.bandMin,
      store.route.bandMax,
    );
    await nextTick();
    draw();
  } finally {
    if (mySeq === seq) computing.value = false;
  }
}

function draw(): void {
  const r = result.value;
  const cv = canvasRef.value;
  if (!r || !cv) return;
  const ctx = cv.getContext('2d')!;
  const W = cv.width, H = cv.height;
  ctx.fillStyle = '#0b1220';
  ctx.fillRect(0, 0, W, H);

  const ml = 52, mr = 14, mt = 34, mb = 38;
  const pw = W - ml - mr, ph = H - mt - mb;
  const nS = r.distances.length, nL = r.levelsKm.length;
  const maxAlt = PROFILE_MAX_ALT_KM;
  const L = r.totalLengthKm;
  const xOf = (d: number) => ml + (d / L) * pw;
  const yOf = (alt: number) => mt + (1 - alt / maxAlt) * ph;

  // 能见度场(离屏 nS×nL 放大绘制)
  const off = document.createElement('canvas');
  off.width = nS;
  off.height = nL;
  const octx = off.getContext('2d')!;
  const img = octx.createImageData(nS, nL);
  for (let i = 0; i < nS; i++) {
    for (let j = 0; j < nL; j++) {
      const v = r.vis[i * nL + j];
      const px = ((nL - 1 - j) * nS + i) * 4;
      const col: [number, number, number] = v < 0 ? [23, 30, 44] : visColor(v);
      img.data[px] = col[0];
      img.data[px + 1] = col[1];
      img.data[px + 2] = col[2];
      img.data[px + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(off, ml, mt, pw, ph);

  // 飞行高度带
  const bandLo = r.bandMinM / 1000, bandHi = r.bandMaxM / 1000;
  ctx.fillStyle = 'rgba(56, 189, 248, 0.16)';
  ctx.fillRect(ml, yOf(bandHi), pw, yOf(bandLo) - yOf(bandHi));
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.8)';
  ctx.setLineDash([6, 4]);
  ctx.strokeRect(ml, yOf(bandHi), pw, yOf(bandLo) - yOf(bandHi));
  ctx.setLineDash([]);

  // 地形线
  ctx.strokeStyle = '#a16207';
  ctx.lineWidth = 2;
  ctx.beginPath();
  r.samples.forEach((s, i) => {
    const x = xOf(s.d), y = yOf(s.terrainKm);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // MSA 线
  ctx.strokeStyle = '#ef4444';
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 5]);
  ctx.beginPath();
  r.samples.forEach((s, i) => {
    const x = xOf(s.d), y = yOf(s.msaKm);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.setLineDash([]);

  // 云底线
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([3, 4]);
  ctx.beginPath();
  let started = false;
  r.samples.forEach((s) => {
    if (s.cloudBaseKm === null) { started = false; return; }
    const x = xOf(s.d), y = yOf(s.cloudBaseKm);
    if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.setLineDash([]);

  // 航段分隔线 + 标注
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.5)';
  ctx.fillStyle = '#cbd5e1';
  ctx.font = '12px sans-serif';
  ctx.textAlign = 'center';
  for (const seg of r.segments) {
    if (seg.index > 0) {
      const x = xOf(seg.startD);
      ctx.beginPath();
      ctx.moveTo(x, mt);
      ctx.lineTo(x, mt + ph);
      ctx.stroke();
    }
    ctx.fillText(`航段${seg.index + 1}`, xOf((seg.startD + seg.endD) / 2), mt - 18);
  }

  // 坐标轴
  ctx.strokeStyle = '#475569';
  ctx.strokeRect(ml, mt, pw, ph);
  ctx.fillStyle = '#94a3b8';
  ctx.font = '11px sans-serif';
  for (let d = 0; d <= L; d += 10) {
    ctx.fillText(`${d}`, xOf(d), mt + ph + 16);
  }
  ctx.fillText('距离 (km)', ml + pw / 2, H - 6);
  ctx.textAlign = 'right';
  for (let a = 0; a <= maxAlt; a += 1) {
    ctx.fillText(`${a}`, ml - 6, yOf(a) + 4);
  }
  ctx.save();
  ctx.translate(12, mt + ph / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.fillText('高度 (km)', 0, 0);
  ctx.restore();

  // 图例
  ctx.textAlign = 'left';
  const lgX = ml + pw - 210, lgY = mt + 8;
  ctx.fillStyle = 'rgba(11,18,32,0.75)';
  ctx.fillRect(lgX - 8, lgY - 6, 212, 24);
  const labels = ['<0.5', '1', '3', '5', '8', '>12 km'];
  const cols = [0.3, 1, 3, 5, 8, 12].map(visColor);
  cols.forEach((c, i) => {
    ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
    ctx.fillRect(lgX + i * 34, lgY, 22, 10);
    ctx.fillStyle = '#e2e8f0';
    ctx.fillText(labels[i], lgX + i * 34, lgY + 22);
  });
}

function doExportJSON(): void {
  if (!result.value) return;
  exportProfileJSON(result.value, {
    frame: store.frame,
    threshold: store.thresholds[store.threshold],
    route: store.route,
  });
}

function doExportCSV(): void {
  if (!result.value) return;
  exportProfileCSV(result.value, {
    frame: store.frame,
    threshold: store.thresholds[store.threshold],
    route: store.route,
  });
}

// 进入模块或关键参数变化时自动重算
watch(
  [() => store.module, () => store.frame, () => store.route, () => store.threshold],
  () => {
    if (store.module === 'profile') void recompute();
  },
  { deep: true, immediate: true },
);
</script>
