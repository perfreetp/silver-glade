// 剖面结果导出:JSON(完整剖面采样点 + 能见度)+ CSV(按航段汇总/采样点表)

import type { ProfileResult } from '../analysis/profile';
import type { RoutePoint } from '../store';

export interface ExportMeta {
  frame: number;
  threshold: number;
  route: { points: RoutePoint[]; bandMin: number; bandMax: number };
}

function download(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

const round = (v: number | null, n = 3) => (v === null ? null : Number(v.toFixed(n)));

export function exportProfileJSON(result: ProfileResult, meta: ExportMeta): void {
  // 采样点按航段分组,保留全局索引以取回能见度廓线
  const bySegment = new Map<number, { s: (typeof result.samples)[number]; gi: number }[]>();
  result.samples.forEach((s, gi) => {
    if (!bySegment.has(s.segment)) bySegment.set(s.segment, []);
    bySegment.get(s.segment)!.push({ s, gi });
  });
  const payload = {
    meta: {
      tool: '低空航路气象体积渲染',
      exportedAt: new Date().toISOString(),
      frame: meta.frame,
      timeLabel: `T+${meta.frame}h`,
      densityThreshold: meta.threshold,
      route: meta.route,
      totalLengthKm: round(result.totalLengthKm),
      profileLevelsM: result.levelsKm.map((l) => Math.round(l * 1000)),
    },
    segments: result.segments.map((seg) => ({
      index: seg.index,
      from: seg.from,
      to: seg.to,
      lengthKm: round(seg.lengthKm),
      minVisibilityKm: round(seg.minVisKm),
      meanVisibilityKm: round(seg.meanVisKm),
      msaMaxM: Math.round(seg.msaMaxM),
      clearanceM: Math.round(seg.clearanceM),
      samples: (bySegment.get(seg.index) ?? []).map(({ s, gi }) => ({
        distanceKm: round(s.d),
        x: round(s.x),
        z: round(s.z),
        terrainM: Math.round(s.terrainKm * 1000),
        msaM: Math.round(s.msaKm * 1000),
        cloudBaseM: s.cloudBaseKm === null ? null : Math.round(s.cloudBaseKm * 1000),
        minVisibilityKm: round(s.minVisKm),
        bandMeanVisibilityKm: round(s.bandMeanVisKm),
        // 该采样点整列能见度廓线,对应 meta.profileLevelsM
        visibilityProfileKm: Array.from({ length: result.levelsKm.length }, (_, j) => {
          const v = result.vis[gi * result.levelsKm.length + j];
          return v < 0 ? null : round(v, 2);
        }),
      })),
    })),
  };
  download(
    `route-profile-f${String(meta.frame).padStart(2, '0')}.json`,
    JSON.stringify(payload, null, 2),
    'application/json',
  );
}

export function exportProfileCSV(result: ProfileResult, meta: ExportMeta): void {
  const lines: string[] = [
    'segment,distance_km,x_km,z_km,terrain_m,msa_m,cloud_base_m,min_visibility_km,band_mean_visibility_km',
  ];
  for (const s of result.samples) {
    lines.push(
      [
        s.segment + 1,
        s.d.toFixed(3),
        s.x.toFixed(3),
        s.z.toFixed(3),
        Math.round(s.terrainKm * 1000),
        Math.round(s.msaKm * 1000),
        s.cloudBaseKm === null ? '' : Math.round(s.cloudBaseKm * 1000),
        s.minVisKm.toFixed(2),
        s.bandMeanVisKm.toFixed(2),
      ].join(','),
    );
  }
  lines.push('');
  lines.push('segment,length_km,min_visibility_km,mean_visibility_km,msa_max_m,clearance_m');
  for (const seg of result.segments) {
    lines.push(
      [
        seg.index + 1,
        seg.lengthKm.toFixed(2),
        seg.minVisKm.toFixed(2),
        seg.meanVisKm.toFixed(2),
        Math.round(seg.msaMaxM),
        Math.round(seg.clearanceM),
      ].join(','),
    );
  }
  download(
    `route-profile-f${String(meta.frame).padStart(2, '0')}.csv`,
    lines.join('\n'),
    'text/csv;charset=utf-8',
  );
}
