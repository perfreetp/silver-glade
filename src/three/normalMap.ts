/**
 * 程序化生成刀纹法线贴图（CanvasTexture）。
 * 沟纹深度与边缘碎雪的高频细节由该法线贴图在片元层叠加，
 * 与顶点位移（低频沟形 + 棱纹起伏）配合表现最终刀纹。
 */
export function createCorduroyNormalMap(): HTMLCanvasElement {
  const w = 256;
  const h = 256;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  const data = img.data;

  // 确定性伪随机（碎雪颗粒）
  let seed = 1337;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // 横向棱纹：沿 v 方向周期变化的高度场
      const phase = (y / h) * Math.PI * 2 * 6;
      const ridge = Math.cos(phase);
      const groove = -0.35 * Math.max(0, -ridge);
      const height = ridge * 0.6 + groove;

      // 数值梯度 -> 法线
      const e = 1;
      const phaseR = ((y + e) / h) * Math.PI * 2 * 6;
      const phaseL = ((y - e) / h) * Math.PI * 2 * 6;
      let nx = (rand() - 0.5) * 0.5; // 碎雪颗粒微扰动
      let ny = 1.0;
      let nz = (Math.cos(phaseL) - Math.cos(phaseR)) * 0.9;
      const inv = 1 / Math.hypot(nx, ny, nz);
      nx *= inv;
      ny *= inv;
      nz *= inv;

      const i = (y * w + x) * 4;
      data[i] = Math.round((nx * 0.5 + 0.5) * 255);
      data[i + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      data[i + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      data[i + 3] = 255;
      void height;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}
