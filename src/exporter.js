// 导出：线缆路径点集 JSON 与长度清单 CSV
function download(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function exportCablePaths(store) {
  const data = {
    meta: {
      generatedAt: new Date().toISOString(),
      cableCount: store.cables.length,
      totalLengthMeters: Number(store.totalLength().toFixed(3)),
      curveMode: store.globalMode,
      bendRadiusMeters: store.globalBend,
    },
    cables: store.cables.map((c) => ({
      id: c.id,
      portA: c.portA.id,
      portB: c.portB.id,
      variant: c.variantKey,
      variantName: store.variantName(c.variantKey),
      manuallyAdjusted: c.manual,
      radiusMeters: c.radius,
      bendRadiusMeters: c.bendRadius,
      lengthMeters: Number(c.length.toFixed(4)),
      minBendRadiusMeters: c.minRadius !== null ? Number(c.minRadius.toFixed(4)) : null,
      collision: {
        segmentCount: c.collision.hitSegments.size,
        penetrationLengthMeters: Number(c.collision.hitLength.toFixed(4)),
        cabinetsHit: [...c.collision.perBox.keys()],
        hitSegmentIndices: [...c.collision.hitSegments].map(Number),
      },
      waypoints: c.waypoints.map((p) => [Number(p.x.toFixed(4)), Number(p.y.toFixed(4)), Number(p.z.toFixed(4))]),
      sampledPoints: c.samplePoints.map((p) => [
        Number(p.x.toFixed(4)), Number(p.y.toFixed(4)), Number(p.z.toFixed(4)),
      ]),
      hitSegmentIndices: [...c.collision.hitSegments],
    })),
  };
  download(`cable_paths_${stamp()}.json`, JSON.stringify(data, null, 2), 'application/json');
}

export function exportLengthList(store) {
  const head = ['线缆编号', '端口A', '端口B', '路径方案', '是否手动调整', '线径(m)', '长度(m)', '最小弯曲半径(m)', '碰撞段数', '穿透长度(m)', '碰撞机柜'];
  const rows = store.cables.map((c) => [
    c.id,
    c.portA.id,
    c.portB.id,
    store.variantName(c.variantKey),
    c.manual ? '是' : '否',
    c.radius.toFixed(3),
    c.length.toFixed(3),
    c.minRadius !== null ? c.minRadius.toFixed(3) : '',
    c.collision.hitSegments.size,
    c.collision.hitLength.toFixed(3),
    [...c.collision.perBox.keys()].join('|'),
  ]);
  const csv = [head, ...rows]
    .map((r) => r.map((cell) => {
      const s = String(cell).replace(/"/g, '""');
      return /[",\n]/.test(s) ? `"${s}"` : s;
    }).join(','))
    .join('\r\n');
  // 加 BOM 保证 Excel 正确识别中文
  download(`cable_lengths_${stamp()}.csv`, '﻿' + csv, 'text/csv;charset=utf-8');
}
