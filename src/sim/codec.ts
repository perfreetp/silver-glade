/**
 * 浓度场 RLE 压缩。
 *
 * 菌丝浓度在空间上高度平滑（径向扩散），游程编码压缩比高，
 * 使得大规模格点（如 2048²）下上百帧快照也能放进内存。
 *
 * 编码格式：[value, runLength, value, runLength, ...]
 *  - value: 1 字节浓度（0~255）
 *  - runLength: 1 字节，游程长度 1~255；超过 255 的同值游程拆成多段
 */

export function encodeRLE(src: Uint8Array): Uint8Array {
  const out: number[] = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const value = src[i]!;
    let run = 1;
    while (i + run < n && src[i + run] === value && run < 255) run++;
    out.push(value, run);
    i += run;
  }
  return Uint8Array.from(out);
}

export function decodeRLE(bytes: Uint8Array, out: Uint8Array): void {
  let p = 0;
  let w = 0;
  const n = bytes.length;
  while (p < n) {
    const value = bytes[p]!;
    const run = bytes[p + 1]!;
    out.fill(value, w, w + run);
    w += run;
    p += 2;
  }
  if (w !== out.length) {
    throw new Error(`RLE 解码长度不匹配：${w} / ${out.length}`);
  }
}

/** 把 Float32 浓度场量化为 Uint8 并做 RLE 压缩 */
export function snapshotFloat32(field: Float32Array, maxValue: number): Uint8Array {
  const q = new Uint8Array(field.length);
  const scale = 255 / maxValue;
  for (let i = 0; i < field.length; i++) {
    const v = Math.round(field[i]! * scale);
    q[i] = v <= 0 ? 0 : v >= 255 ? 255 : v;
  }
  return encodeRLE(q);
}
