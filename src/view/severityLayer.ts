/**
 * 受损分级栅格：把分级场画到离屏 canvas，作为覆盖在边界内的贴地纹理。
 * 支持贴地（drape）与抬升（raised）两种显示：同一份纹理分别投到地形表面
 * 或一张抬升的“毯子”网格上。
 */
export class SeverityLayer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D | null;
  textureDirty = true;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 2;
    this.canvas.height = 2;
    this.ctx = this.canvas.getContext('2d');
  }

  /** 填充分级栅格（values 为 -1 表示边界外） */
  setGrid(width: number, height: number, samples: Float32Array, colorFor: (v: number) => [number, number, number] | null): void {
    if (width <= 0 || height <= 0) return;
    this.canvas.width = width;
    this.canvas.height = height;
    const ctx = this.ctx;
    if (!ctx) return;
    const img = ctx.createImageData(width, height);
    for (let i = 0; i < width * height; i++) {
      const v = samples[i];
      const o = i * 4;
      if (v < 0 || !Number.isFinite(v)) {
        img.data[o + 3] = 0;
        continue;
      }
      const c = colorFor(v);
      if (!c) {
        img.data[o + 3] = 0;
        continue;
      }
      img.data[o] = c[0];
      img.data[o + 1] = c[1];
      img.data[o + 2] = c[2];
      img.data[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    this.textureDirty = true;
  }
}
