import { zipSync, strToU8 } from 'fflate';
import { BAND_COLORS, BAND_NAMES, colorBand, GRID_FINE, type Solution } from '../solver/field';
import { ROOM } from '../model/room';
import type { Fan } from '../model/room';

export interface ExportMeta {
  fans: Fan[];
  sliceMode: string;
  slicePosition: number;
  exportedAt: string;
}

/** 把 6 档色带画成 PNG 用的像素图 */
function bandColorOf(speed: number, stops: number[]): [number, number, number] {
  const hex = BAND_COLORS[colorBand(speed, stops)];
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

/** 切片 -> PNG 像素数据 (RGBA) */
export function sliceToRGBA(
  sol: Solution,
  mode: 'horizontal' | 'vertical-x' | 'vertical-z',
  position: number,
): { width: number; height: number; data: Uint8Array; solidMask: Uint8Array } {
  const h = sol.fine.h;
  const nx = sol.fine.nx,
    ny = sol.fine.ny,
    nz = sol.fine.nz;
  const solid = sol.solidFine;
  const spd = sol.speed;
  const stops = sol.colorStops;

  let width = nx,
    height = nz;
  if (mode === 'vertical-x') (width = nx), (height = ny);
  if (mode === 'vertical-z') (width = nz), (height = ny);
  const data = new Uint8Array(width * height * 4);
  const mask = new Uint8Array(width * height);
  const index = Math.round(position / h - 0.5);

  const put = (px: number, py: number, c: number) => {
    // py=0 为底部, 输出图像 row 0 为顶部
    const row = height - 1 - py;
    const o = (row * width + px) * 4;
    if (solid[c]) {
      data[o] = 18;
      data[o + 1] = 24;
      data[o + 2] = 32;
      data[o + 3] = 255;
      mask[row * width + px] = 1;
      return;
    }
    const [r, g, b] = bandColorOf(spd[c], stops);
    data[o] = r;
    data[o + 1] = g;
    data[o + 2] = b;
    data[o + 3] = 255;
  };

  if (mode === 'horizontal') {
    const k = Math.min(nz - 1, Math.max(0, index));
    for (let zz = 0; zz < nz; zz++) for (let xx = 0; xx < nx; xx++) put(xx, zz, xx + nx * (zz + nz * k));
  } else if (mode === 'vertical-x') {
    const k = Math.min(nz - 1, Math.max(0, index));
    for (let yy = 0; yy < ny; yy++) for (let xx = 0; xx < nx; xx++) put(xx, yy, xx + nx * (k + nz * yy));
  } else {
    const i = Math.min(nx - 1, Math.max(0, index));
    for (let yy = 0; yy < ny; yy++) for (let zz = 0; zz < nz; zz++) put(zz, yy, i + nx * (zz + nz * yy));
  }
  return { width, height, data, solidMask: mask };
}

/** RGBA -> 未压缩 PNG (手写, 无依赖) */
export function encodePNG(width: number, height: number, rgba: Uint8Array): Uint8Array {
  const crcTable = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  const crc32 = (buf: Uint8Array, start = 0, end = buf.length) => {
    let c = 0xffffffff;
    for (let i = start; i < end; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };

  // 原始扫描线: 每行前加 filter byte 0
  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const compressed = zlibStore(raw);

  const chunks: Uint8Array[] = [];
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  chunks.push(sig);

  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  chunks.push(pngChunk('IHDR', ihdr));
  chunks.push(pngChunk('IDAT', compressed));
  chunks.push(pngChunk('IEND', new Uint8Array(0)));

  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;

  function pngChunk(type: string, data: Uint8Array): Uint8Array {
    const len = data.length;
    const buf = new Uint8Array(12 + len);
    const view = new DataView(buf.buffer);
    view.setUint32(0, len);
    buf[4] = type.charCodeAt(0);
    buf[5] = type.charCodeAt(1);
    buf[6] = type.charCodeAt(2);
    buf[7] = type.charCodeAt(3);
    buf.set(data, 8);
    view.setUint32(8 + len, crc32(buf, 4, 8 + len));
    return buf;
  }
}

/** 用 zlib 的 "stored" 块压缩 (无压缩但格式合法) */
function zlibStore(data: Uint8Array): Uint8Array {
  const blocks = Math.ceil(data.length / 65535) || 1;
  const out = new Uint8Array(2 + blocks * 5 + data.length + 4);
  let o = 0;
  out[o++] = 0x78;
  out[o++] = 0x01;
  let off = 0;
  for (let i = 0; i < blocks; i++) {
    const len = Math.min(65535, data.length - off);
    out[o++] = i === blocks - 1 ? 1 : 0; // BFINAL
    out[o++] = len & 0xff;
    out[o++] = (len >> 8) & 0xff;
    out[o++] = ~len & 0xff;
    out[o++] = (~len >> 8) & 0xff;
    out.set(data.subarray(off, off + len), o);
    o += len;
    off += len;
  }
  // adler32
  let a = 1,
    b = 0;
  for (let i = 0; i < data.length; i++) {
    a = (a + data[i]) % 65521;
    b = (b + a) % 65521;
  }
  const adler = ((b << 16) | a) >>> 0;
  out[o++] = (adler >> 24) & 0xff;
  out[o++] = (adler >> 16) & 0xff;
  out[o++] = (adler >> 8) & 0xff;
  out[o++] = adler & 0xff;
  return out.subarray(0, o);
}

/** 色带图例 (PNG 用的小图) */
export function legendRGBA(stops: number[], width = 480, height = 56): Uint8Array {
  const data = new Uint8Array(width * height * 4);
  const barW = Math.floor(width / 6);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const b = Math.min(5, Math.floor(x / barW));
      const hex = BAND_COLORS[b];
      const o = (y * width + x) * 4;
      data[o] = parseInt(hex.slice(1, 3), 16);
      data[o + 1] = parseInt(hex.slice(3, 5), 16);
      data[o + 2] = parseInt(hex.slice(5, 7), 16);
      data[o + 3] = 255;
    }
  return data;
}

/** 双击下载 */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export interface ExportOptions {
  voxelJson: boolean;
  slicePng: boolean;
  downsample: number; // 1 = 全分辨率; 2 = 一半边长
  includeAge: boolean;
}

/**
 * 打包导出:
 *  - voxel-field.json : 体素速度 (降采样), 6 档色带断点, 风机参数, 统计
 *  - slice-horizontal.png / slice-vertical-x.png / slice-vertical-z.png
 *  - legend.png
 *  - README.txt
 */
export function exportFieldZip(sol: Solution, meta: ExportMeta, opts: ExportOptions): Blob {
  const files: Record<string, Uint8Array> = {};
  const ds = Math.max(1, Math.round(opts.downsample));
  const nx = sol.fine.nx,
    ny = sol.fine.ny,
    nz = sol.fine.nz;

  if (opts.voxelJson) {
    const sx = Math.max(1, Math.floor(nx / ds));
    const sy = Math.max(1, Math.floor(ny / ds));
    const sz = Math.max(1, Math.floor(nz / ds));
    const vel = sol.velocity;
    const solid = sol.solidFine;
    // 平铺的 Int16 (mm/s) 编码以控制体积; 顺序 x + sx*(z + sz*y)
    const speeds = new Int16Array(sx * sy * sz);
    const vx = new Int16Array(sx * sy * sz);
    const vy = new Int16Array(sx * sy * sz);
    const vz = new Int16Array(sx * sy * sz);
    const fluid = new Uint8Array(sx * sy * sz);
    for (let y = 0; y < sy; y++)
      for (let z = 0; z < sz; z++)
        for (let x = 0; x < sx; x++) {
          const cx = Math.min(nx - 1, x * ds + Math.floor(ds / 2));
          const cy = Math.min(ny - 1, y * ds + Math.floor(ds / 2));
          const cz = Math.min(nz - 1, z * ds + Math.floor(ds / 2));
          const c = cx + nx * (cz + nz * cy);
          const o = x + sx * (z + sz * y);
          if (solid[c]) continue;
          fluid[o] = 1;
          vx[o] = Math.round(vel[3 * c] * 1000);
          vy[o] = Math.round(vel[3 * c + 1] * 1000);
          vz[o] = Math.round(vel[3 * c + 2] * 1000);
          speeds[o] = Math.round(sol.speed[c] * 1000);
        }
    const header = {
      format: 'mushroom-barn-voxel-field',
      version: 1,
      coordinateSystem: {
        origin: [0, 0, 0],
        axes: '+X length, +Y height, +Z depth',
        unit: 'm',
      },
      room: { lx: ROOM.lx, ly: ROOM.ly, lz: ROOM.lz },
      fineGrid: { nx, ny, nz, h: sol.fine.h, voxelCount: nx * ny * nz },
      exportGrid: {
        nx: sx,
        ny: sy,
        nz: sz,
        h: sol.fine.h * ds,
        voxelCount: sx * sy * sz,
        downsample: ds,
        indexOrder: 'x + nx*(z + nz*y)',
      },
      colorStops: sol.colorStops,
      bands: BAND_NAMES.map((n, i) => ({
        name: n,
        color: BAND_COLORS[i],
        min: sol.colorStops[i],
        max: sol.colorStops[i + 1],
      })),
      fans: meta.fans.map((f) => ({
        id: f.id,
        name: f.name,
        kind: f.kind,
        wall: f.wall,
        u: f.u,
        v: f.v,
        radius: f.radius,
        airflow: f.airflow,
        tilt: f.tilt,
        pitch: f.pitch,
      })),
      stats: {
        ...sol.stats,
        fluidVoxels: sol.stats.fluidVoxels,
        scaleMax: sol.scaleMax,
      },
      encoding: {
        fluids: '0/1 mask, x + nx*(z + nz*y)',
        speed_mm_s: 'INT16 little-endian',
        velocity_mm_s: { x: 'INT16', y: 'INT16', z: 'INT16' },
        optionalAge: opts.includeAge ? 'age_0_1 INT16 (x/10000)' : undefined,
        binaryFiles: ['fluid.u8', 'speed.i16', 'vx.i16', 'vy.i16', 'vz.i16'],
      },
      exportedAt: meta.exportedAt,
    };
    files['voxel-field.json'] = strToU8(JSON.stringify(header, null, 2));
    files['fluid.u8'] = new Uint8Array(fluid.buffer);
    files['speed.i16'] = new Uint8Array(speeds.buffer);
    files['vx.i16'] = new Uint8Array(vx.buffer);
    files['vy.i16'] = new Uint8Array(vy.buffer);
    files['vz.i16'] = new Uint8Array(vz.buffer);
    if (opts.includeAge) {
      const age = new Int16Array(sx * sy * sz);
      for (let y = 0; y < sy; y++)
        for (let z = 0; z < sz; z++)
          for (let x = 0; x < sx; x++) {
            const cx = Math.min(nx - 1, x * ds + Math.floor(ds / 2));
            const cy = Math.min(ny - 1, y * ds + Math.floor(ds / 2));
            const cz = Math.min(nz - 1, z * ds + Math.floor(ds / 2));
            const c = cx + nx * (cz + nz * cy);
            age[x + sx * (z + sz * y)] = Math.round(sol.age[c] * 10000);
          }
      files['age.i16'] = new Uint8Array(age.buffer);
    }
  }

  if (opts.slicePng) {
    const modes: ('horizontal' | 'vertical-x' | 'vertical-z')[] = ['horizontal', 'vertical-x', 'vertical-z'];
    for (const m of modes) {
      const pos = m === 'horizontal' ? meta.slicePosition : m === 'vertical-x' ? 4.0 : 6.4;
      // 以当前剖面为准
      const usePos = m === meta.sliceMode ? meta.slicePosition : pos;
      const slice = sliceToRGBA(sol, m, usePos);
      const png = encodePNG(slice.width, slice.height, slice.data);
      const name = `slice-${m}.png`;
      files[name] = png;
      const meta2 = {
        mode: m,
        position: usePos,
        width: slice.width,
        height: slice.height,
        colorStops: sol.colorStops,
      };
      files[`slice-${m}.json`] = strToU8(JSON.stringify(meta2, null, 2));
    }
    const legend = encodePNG(480, 56, legendRGBA(sol.colorStops));
    files['legend.png'] = legend;
  }

  const readme = [
    '菇房通风气流场导出',
    `导出时间: ${meta.exportedAt}`,
    '',
    `细网格: ${nx} x ${ny} x ${nz} = ${(nx * ny * nz).toLocaleString('en-US')} 体素 (边长 ${sol.fine.h} m)`,
    `房间: ${ROOM.lx} x ${ROOM.ly} x ${ROOM.lz} m`,
    `速度色带 (6 档, m/s): ${sol.colorStops.map((s) => s.toFixed(3)).join(' / ')}`,
    '',
    '文件说明:',
    '  voxel-field.json  体素场元数据 (网格、色带、风机、统计)',
    '  fluid.u8          流体掩码, 1 = 空气',
    '  speed.i16         体素风速 (mm/s)',
    '  vx/vy/vz.i16      体素速度分量 (mm/s)',
    '  age.i16           空气龄相对值 (0..10000)',
    '  slice-*.png       三个剖面的速度色带图',
    '  legend.png        6 档色带图例',
  ].join('\n');
  files['README.txt'] = strToU8(readme);

  const zipped = zipSync(files, { level: 6 });
  return new Blob([zipped as BlobPart], { type: 'application/zip' });
}

/** 只导出当前剖面 PNG */
export function exportSlicePNG(sol: Solution, mode: 'horizontal' | 'vertical-x' | 'vertical-z', position: number): Blob {
  const s = sliceToRGBA(sol, mode, position);
  const png = encodePNG(s.width, s.height, s.data);
  return new Blob([png as BlobPart], { type: 'image/png' });
}

/** 只导出体素场数据 (JSON + 二进制) */
export function exportVoxelData(sol: Solution, meta: ExportMeta): Blob {
  return exportFieldZip(sol, meta, { voxelJson: true, slicePng: false, downsample: 1, includeAge: true });
}

export const EXPORT_GRID_COUNT = GRID_FINE.nx * GRID_FINE.ny * GRID_FINE.nz;
