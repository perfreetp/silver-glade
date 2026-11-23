// 序列帧导出:时间轴逐帧渲染 -> PNG 序列 -> ZIP
import JSZip from 'jszip';
import { FRAME_COUNT } from './defaults.js';
import { downloadBlob } from './persistence.js';

function pixelsToPngBlob(pixels, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const img = new ImageData(
    new Uint8ClampedArray(pixels.buffer, pixels.byteOffset, width * height * 4),
    width,
    height
  );
  ctx.putImageData(img, 0, 0);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

/**
 * @param {VolumeEngine} engine
 * @param {object} opts { width, height, onProgress(done, total) }
 */
export async function exportSequence(engine, { width, height, onProgress } = {}) {
  const w = width || engine.width || 960;
  const h = height || engine.height || 540;
  const zip = new JSZip();
  const folder = zip.folder('volsmoke_sequence');

  for (let f = 0; f < FRAME_COUNT; f++) {
    const pixels = await engine.renderFrameToPixels(f, w, h);
    const blob = await pixelsToPngBlob(pixels, w, h);
    folder.file(`frame_${String(f).padStart(3, '0')}.png`, blob);
    if (onProgress) onProgress(f + 1, FRAME_COUNT);
  }

  // 附带一份元数据,方便回溯参数
  folder.file('project.json', JSON.stringify(engine.serialize(), null, 2));

  const blob = await zip.generateAsync({ type: 'blob' });
  downloadBlob(blob, 'volsmoke_sequence.zip');
  engine.restoreFrame();
}
