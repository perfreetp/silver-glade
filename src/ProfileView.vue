<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from 'vue';
import { store, derived } from './store';
import { elevationAt, formatChainage } from './alignment';

const cv = ref<HTMLCanvasElement | null>(null);
const PAD = { l: 60, r: 18, t: 30, b: 30 };
let dragIdx = -1;

function layout() {
  const c = cv.value!;
  const w = c.clientWidth;
  const h = c.clientHeight;
  const L = Math.max(derived.totalLength, 1);
  let mn = Infinity;
  let mx = -Infinity;
  for (const e of derived.trackElev) {
    if (e < mn) mn = e;
    if (e > mx) mx = e;
  }
  for (const e of derived.terrainElev) {
    if (e < mn) mn = e;
    if (e > mx) mx = e;
  }
  if (!isFinite(mn)) {
    mn = 0;
    mx = 1;
  }
  const pad = Math.max(4, (mx - mn) * 0.12);
  mn -= pad;
  mx += pad;
  const X = (s: number) => PAD.l + (s / L) * (w - PAD.l - PAD.r);
  const Y = (e: number) => PAD.t + (1 - (e - mn) / (mx - mn)) * (h - PAD.t - PAD.b);
  return { w, h, L, mn, mx, X, Y };
}

function niceStep(raw: number): number {
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / pow;
  return (n >= 5 ? 5 : n >= 2 ? 2 : 1) * pow;
}

function draw(): void {
  const c = cv.value;
  if (!c) return;
  const dpr = window.devicePixelRatio || 1;
  if (c.width !== Math.round(c.clientWidth * dpr) || c.height !== Math.round(c.clientHeight * dpr)) {
    c.width = Math.round(c.clientWidth * dpr);
    c.height = Math.round(c.clientHeight * dpr);
  }
  const ctx = c.getContext('2d');
  if (!ctx) return;
  const { w, h, L, mn, mx, X, Y } = layout();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#14181f';
  ctx.fillRect(0, 0, w, h);
  if (derived.samples.length < 2) return;

  // 高程网格与标注
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'right';
  ctx.lineWidth = 1;
  const step = niceStep((mx - mn) / 4);
  for (let e = Math.ceil(mn / step) * step; e <= mx; e += step) {
    const y = Y(e);
    ctx.beginPath();
    ctx.moveTo(PAD.l, y);
    ctx.lineTo(w - PAD.r, y);
    ctx.stroke();
    ctx.fillText(e.toFixed(0) + 'm', PAD.l - 6, y + 4);
  }
  // 里程标注
  ctx.textAlign = 'center';
  const kmStep = L > 6000 ? 2000 : L > 2500 ? 1000 : 500;
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  for (let s = 0; s <= L + 1; s += kmStep) {
    ctx.fillText(formatChainage(Math.min(s, L)), X(s), h - 10);
  }

  // 地形纵断面(灰褐色填充)
  const samples = derived.samples;
  ctx.beginPath();
  ctx.moveTo(X(samples[0].s), Y(derived.terrainElev[0]));
  for (let i = 1; i < samples.length; i++) ctx.lineTo(X(samples[i].s), Y(derived.terrainElev[i]));
  ctx.strokeStyle = 'rgba(170,150,115,0.9)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.lineTo(X(samples[samples.length - 1].s), h - PAD.b);
  ctx.lineTo(X(samples[0].s), h - PAD.b);
  ctx.closePath();
  ctx.fillStyle = 'rgba(170,150,115,0.18)';
  ctx.fill();

  // 线路纵断面(红色)
  ctx.beginPath();
  ctx.moveTo(X(samples[0].s), Y(derived.trackElev[0]));
  for (let i = 1; i < samples.length; i++) ctx.lineTo(X(samples[i].s), Y(derived.trackElev[i]));
  ctx.strokeStyle = '#ff5544';
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // 坡度变化点(竖向虚线)
  const pts = store.profilePoints;
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = 1;
  for (const p of pts) {
    ctx.beginPath();
    ctx.moveTo(X(p.s), PAD.t);
    ctx.lineTo(X(p.s), h - PAD.b);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // 各坡段坡度标注,最大坡度段高亮
  ctx.font = 'bold 12px sans-serif';
  ctx.textAlign = 'center';
  for (const g of derived.grades) {
    const mid = (g.s0 + g.s1) / 2;
    const e = elevationAt(pts, mid);
    const isMax = derived.maxGrade > 0 && Math.abs(Math.abs(g.grade) - derived.maxGrade) < 1e-9;
    ctx.fillStyle = isMax ? '#ffd54a' : 'rgba(255,255,255,0.8)';
    ctx.fillText(`${g.grade >= 0 ? '+' : ''}${g.grade.toFixed(2)}%`, X(mid), Y(e) - 12);
  }

  // 纵断面控制点(可拖动)
  for (let i = 0; i < pts.length; i++) {
    const x = X(pts[i].s);
    const y = Y(pts[i].elev);
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#ff5544';
    ctx.stroke();
  }

  // 标题信息
  ctx.textAlign = 'left';
  ctx.font = 'bold 13px sans-serif';
  ctx.fillStyle = '#ffd54a';
  ctx.fillText(`最大坡度 ${derived.maxGrade.toFixed(2)}%`, PAD.l + 8, PAD.t - 8);
  ctx.fillStyle = 'rgba(255,255,255,0.65)';
  ctx.fillText(`全长 ${(L / 1000).toFixed(2)} km`, PAD.l + 130, PAD.t - 8);
}

function localPos(e: PointerEvent): { x: number; y: number } {
  const r = cv.value!.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function onDown(e: PointerEvent): void {
  const { X, Y } = layout();
  const { x, y } = localPos(e);
  const pts = store.profilePoints;
  for (let i = 0; i < pts.length; i++) {
    if (Math.hypot(X(pts[i].s) - x, Y(pts[i].elev) - y) <= 12) {
      dragIdx = i;
      cv.value!.setPointerCapture(e.pointerId);
      return;
    }
  }
}

function onMove(e: PointerEvent): void {
  if (dragIdx < 0) return;
  const { L, mn, mx } = layout();
  const { x, y } = localPos(e);
  const c = cv.value!;
  const pts = store.profilePoints;
  const p = pts[dragIdx];
  const sRaw = ((x - PAD.l) / (c.clientWidth - PAD.l - PAD.r)) * L;
  const lo = dragIdx > 0 ? pts[dragIdx - 1].s + 5 : 0;
  const hi = dragIdx < pts.length - 1 ? pts[dragIdx + 1].s - 5 : L;
  p.s = Math.min(hi, Math.max(lo, sRaw));
  const hgt = c.clientHeight - PAD.t - PAD.b;
  const eRaw = mn + (1 - (y - PAD.t) / hgt) * (mx - mn);
  p.elev = Math.min(mx, Math.max(mn, eRaw));
}

function onUp(): void {
  dragIdx = -1;
}

watch(
  () => [derived.samples, derived.trackElev, derived.terrainElev, store.profilePoints],
  () => draw(),
  { deep: true, flush: 'post' }
);

onMounted(() => {
  draw();
  window.addEventListener('resize', draw);
});
onBeforeUnmount(() => {
  window.removeEventListener('resize', draw);
});
</script>

<template>
  <canvas
    ref="cv"
    class="profile-canvas"
    @pointerdown="onDown"
    @pointermove="onMove"
    @pointerup="onUp"
    @pointerleave="onUp"
  ></canvas>
</template>

<style scoped>
.profile-canvas {
  width: 100%;
  height: 100%;
  display: block;
  touch-action: none;
  cursor: crosshair;
}
</style>
