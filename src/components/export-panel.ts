import { BaseComponent, panelCss } from './base';
import type { Snapshot, SimParams } from '../sim/types';
import type { InoculationPoint } from '../sim/types';
import { decodeRLE } from '../sim/codec';

/**
 * 生长记录导出：把各时刻的浓度分布写成文件。
 *  - JSON：完整回放记录（元数据 + 全部帧 RLE 字节），可再次导入；
 *  - CSV：展开为逐帧浓度矩阵（0~255），便于外部分析；
 *  - PNG 序列：每帧一张 N×N 灰度图，打包思路逐帧下载。
 */
export class ExportPanel extends BaseComponent {
  private snapshots: Snapshot[] = [];
  private params: SimParams | null = null;
  private points: InoculationPoint[] = [];

  constructor() {
    super();
    this.setHTML(
      `
      <h2>生长记录导出</h2>
      <label>导出格式</label>
      <select id="format">
        <option value="json">JSON 回放记录（含元数据，可重新导入）</option>
        <option value="csv">CSV 浓度矩阵（逐帧展开，文件较大）</option>
        <option value="png">PNG 灰度图序列（逐帧下载）</option>
      </select>
      <div class="row" style="margin-top:10px">
        <button class="primary" id="export" style="flex:1">导出浓度分布</button>
        <button id="import-btn" style="flex:1">导入 JSON</button>
      </div>
      <input type="file" id="import-file" accept=".json,application/json" hidden />
      <div class="hint" id="size-hint"></div>
      `,
      panelCss,
    );
  }

  connectedCallback(): void {
    this.$('#export').addEventListener('click', () => this.doExport());
    this.$('#import-btn').addEventListener('click', () => this.$<HTMLInputElement>('#import-file').click());
    this.$<HTMLInputElement>('#import-file').addEventListener('change', (e) => this.doImport(e));
  }

  setData(snapshots: Snapshot[], params: SimParams, points: InoculationPoint[]): void {
    this.snapshots = snapshots;
    this.params = params;
    this.points = points;
    const bytes = snapshots.reduce((s, f) => s + f.bytes.length, 0);
    this.$('#size-hint').textContent =
      snapshots.length > 0
        ? `${snapshots.length} 帧 · RLE 压缩后约 ${(bytes / 1024).toFixed(1)} KiB`
        : '尚无模拟结果，请先运行蔓延模拟。';
    this.$<HTMLButtonElement>('#export').disabled = snapshots.length === 0;
  }

  private doExport(): void {
    if (this.snapshots.length === 0 || !this.params) return;
    const fmt = this.$<HTMLSelectElement>('#format').value;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const baseName = `mycelium-${this.params.gridSize}x${this.params.gridSize}-${stamp}`;
    if (fmt === 'json') this.exportJson(baseName);
    else if (fmt === 'csv') this.exportCsv(baseName);
    else this.exportPngSequence(baseName);
  }

  private exportJson(name: string): void {
    const record = {
      format: 'mycelium-spread/1',
      exportedAt: new Date().toISOString(),
      params: this.params,
      inoculationPoints: this.points,
      frames: this.snapshots.map((s) => ({
        step: s.step,
        timeHours: s.timeHours,
        encoding: 'rle-uint8',
        bytesBase64: bytesToBase64(s.bytes),
      })),
    };
    const blob = new Blob([JSON.stringify(record)], { type: 'application/json' });
    downloadBlob(blob, `${name}.json`);
  }

  private exportCsv(name: string): void {
    const n = this.params!.gridSize;
    const decoded = new Uint8Array(n * n);
    const parts: string[] = [];
    parts.push(`# mycelium concentration export, grid=${n}, frames=${this.snapshots.length}`);
    parts.push(`# frame,step,timeHours,row,col,concentration(0-255)`);
    for (const snap of this.snapshots) {
      decodeRLE(snap.bytes, decoded);
      // 稀疏写法：只输出非零格，控制文件体积
      for (let y = 0; y < n; y++) {
        const rowBase = y * n;
        for (let x = 0; x < n; x++) {
          const v = decoded[rowBase + x]!;
          if (v > 0) parts.push(`${snap.step},${snap.step},${snap.timeHours},${y},${x},${v}`);
        }
      }
    }
    const blob = new Blob([parts.join('\n')], { type: 'text/csv;charset=utf-8' });
    downloadBlob(blob, `${name}.csv`);
  }

  private async exportPngSequence(name: string): Promise<void> {
    const n = this.params!.gridSize;
    const decoded = new Uint8Array(n * n);
    for (let f = 0; f < this.snapshots.length; f++) {
      decodeRLE(this.snapshots[f]!.bytes, decoded);
      const rgba = new Uint8ClampedArray(n * n * 4);
      for (let i = 0; i < n * n; i++) {
        const v = decoded[i]!;
        const j = i * 4;
        rgba[j] = v;
        rgba[j + 1] = v;
        rgba[j + 2] = v;
        rgba[j + 3] = 255;
      }
      const image = new ImageData(rgba, n, n);
      const canvas = document.createElement('canvas');
      canvas.width = n;
      canvas.height = n;
      canvas.getContext('2d')!.putImageData(image, 0, 0);
      const blob = await canvasToBlob(canvas);
      const idx = String(f).padStart(4, '0');
      downloadBlob(blob, `${name}-frame${idx}.png`);
      // 避免浏览器拦截多文件下载，帧间让出
      await new Promise((r) => setTimeout(r, 120));
    }
  }

  private doImport(e: Event): void {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const record = JSON.parse(String(reader.result)) as {
          format: string;
          params: SimParams;
          inoculationPoints: InoculationPoint[];
          frames: Array<{ step: number; timeHours: number; bytesBase64: string }>;
        };
        if (record.format !== 'mycelium-spread/1') throw new Error('文件格式不识别');
        const snapshots: Snapshot[] = record.frames.map((fr) => ({
          step: fr.step,
          timeHours: fr.timeHours,
          bytes: base64ToBytes(fr.bytesBase64),
        }));
        this.dispatchEvent(
          new CustomEvent('import-record', {
            detail: { snapshots, params: record.params, points: record.inoculationPoints },
            bubbles: true,
            composed: true,
          }),
        );
      } catch (err) {
        alert(`导入失败：${err instanceof Error ? err.message : String(err)}`);
      } finally {
        input.value = '';
      }
    };
    reader.readAsText(file);
  }
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('canvas 导出失败'))), 'image/png');
  });
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
