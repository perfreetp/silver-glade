import type { DamageLayerFile, DamagePatchData } from "./types";
import { effectiveGrade, gradeDistribution, store, totalArea } from "./store";
import { GRADE_META } from "./types";

/** 触发浏览器下载 */
export function downloadTextFile(
  filename: string,
  content: string,
  mime: string
): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function timestamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(
    d.getHours()
  )}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** 导出残损图层文件（JSON，可回导恢复） */
export function exportLayerJson(service: {
  exportLayerFile(): DamageLayerFile;
}): string {
  const data = service.exportLayerFile();
  const name = `残损图层-${timestamp()}.json`;
  downloadTextFile(name, JSON.stringify(data, null, 2), "application/json");
  return name;
}

/** 导出等级分布清单（CSV，UTF-8 BOM 便于 Excel 打开） */
export function exportGradeCsv(): string {
  const rows: string[] = [];
  rows.push("残损等级分布清单");
  rows.push(`导出时间,${new Date().toLocaleString()}`);
  rows.push(`屋面,${store.roofName}`);
  rows.push(
    `阈值,等级1 < ${store.thresholds[0].toFixed(2)},等级2 < ${store.thresholds[1].toFixed(2)},等级3 < 0.85,等级4 ≥ 0.85`
  );
  rows.push("");
  rows.push("等级,名称,面片数,面积合计(㎡),面积占比(%)");
  const total = totalArea.value || 1;
  for (const r of gradeDistribution.value) {
    rows.push(
      [
        r.grade,
        r.name,
        r.count,
        r.area.toFixed(3),
        ((r.area / total) * 100).toFixed(1),
      ].join(",")
    );
  }
  rows.push(["合计", "", store.patches.length, totalArea.value.toFixed(3), "100.0"].join(","));
  rows.push("");
  rows.push("面片明细");
  rows.push("序号,面片名称,严重度,生效等级,等级名称,手动指定,面积(㎡)");
  store.patches.forEach((p: DamagePatchData, i: number) => {
    const g = effectiveGrade(p);
    rows.push(
      [
        i + 1,
        csvEscape(p.name),
        p.severity.toFixed(3),
        g,
        GRADE_META[g - 1].name,
        p.manualGrade ?? "自动",
        p.area.toFixed(3),
      ].join(",")
    );
  });
  const name = `等级分布清单-${timestamp()}.csv`;
  downloadTextFile(name, "﻿" + rows.join("\r\n"), "text/csv;charset=utf-8");
  return name;
}

function csvEscape(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
