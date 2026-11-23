/** 项目默认值、序列化、GeoJSON 导出。 */

import type { ElevationGrid, Georef, Project, RasterImage, Vec2 } from './types.ts';
import { id as newId, safeFilename } from './util.ts';
import { groupRings } from './model.ts';
import type { SeveritySummary } from './severity.ts';
import { signedArea } from './geom.ts';

export const STORAGE_KEY = 'burntrace.project.v1';
export const PROJECT_VERSION = 1;

export function defaultProject(name = '未命名火烧迹地'): Project {
  const georef: Georef = { minX: 0, minY: 0, maxX: 1000, maxY: 750, crs: 'local', lon0: 0, lat0: 0 };
  return {
    version: PROJECT_VERSION,
    id: newId('proj'),
    name,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    georef,
    imagery: null,
    dem: null,
    referenceColor: { r: 88, g: 116, b: 66 },
    detect: { threshold: 0.36, minArea: 120, smoothing: 1.2 },
    severity: { thresholds: [0.22, 0.4, 0.58, 0.76] },
    boundary: [],
    view: { mode: 'drape', lift: 55, showImagery: true, exaggeration: 1.35 },
  };
}

const WGS84_A = 111320;
const WGS84_B = 110540;

export function mapToLonLat(georef: Georef, x: number, y: number): [number, number] {
  if (georef.crs !== 'wgs84') return [x, y];
  const lat = georef.lat0 + y / WGS84_B;
  const lon = georef.lon0 + x / (WGS84_A * Math.cos((georef.lat0 * Math.PI) / 180));
  return [Number(lon.toFixed(7)), Number(lat.toFixed(7))];
}

export function lonLatToMap(georef: Georef, lon: number, lat: number): Vec2 {
  if (georef.crs !== 'wgs84') return { x: lon, y: lat };
  const x = (lon - georef.lon0) * WGS84_A * Math.cos((georef.lat0 * Math.PI) / 180);
  const y = (lat - georef.lat0) * WGS84_B;
  return { x, y };
}

function ringCoords(georef: Georef, ring: readonly Vec2[], closed: boolean): number[][] {
  const coords = ring.map((p) => mapToLonLat(georef, p.x, p.y));
  if (closed && coords.length > 0) coords.push([...coords[0]]);
  return coords;
}

export interface ExportOptions {
  includeSeverity: boolean;
  precision: number;
}

/** 导出 GeoJSON：边界多边形（含孔洞）+ 中心点 + 分级统计 */
export function boundaryToGeoJSON(
  project: Project,
  summary: SeveritySummary | null,
  opts: ExportOptions = { includeSeverity: true, precision: 7 },
): string {
  const groups = groupRings(project.boundary);
  const geom =
    groups.length <= 1
      ? {
          type: 'Polygon',
          coordinates:
            groups.length === 0
              ? []
              : [ringCoords(project.georef, groups[0].outer, true), ...groups[0].holes.map((h) => ringCoords(project.georef, h, true))],
        }
      : {
          type: 'MultiPolygon',
          coordinates: groups.map((g) => [ringCoords(project.georef, g.outer, true), ...g.holes.map((h) => ringCoords(project.georef, h, true))]),
        };

  const area = groups.reduce(
    (s, g) => s + Math.abs(signedArea(g.outer)) - g.holes.reduce((x, h) => x + Math.abs(signedArea(h)), 0),
    0,
  );
  let perimeter = 0;
  for (const g of groups) {
    perimeter += ringLength(g.outer);
    for (const h of g.holes) perimeter += ringLength(h);
  }

  const features: unknown[] = [
    {
      type: 'Feature',
      id: 'burn-boundary',
      geometry: geom,
      properties: {
        name: project.name,
        role: '火烧迹地边界',
        area_m2: Number(area.toFixed(2)),
        area_ha: Number((area / 1e4).toFixed(4)),
        perimeter_m: Number(perimeter.toFixed(2)),
        ring_count: groups.length,
        hole_count: groups.reduce((s, g) => s + g.holes.length, 0),
        vertex_count: groups.reduce(
          (s, g) => s + g.outer.length + g.holes.reduce((x, h) => x + h.length, 0),
          0,
        ),
        detect: {
          threshold: project.detect.threshold,
          min_area_m2: project.detect.minArea,
          smoothing_m: project.detect.smoothing,
        },
        reference_color: `rgb(${project.referenceColor.r}, ${project.referenceColor.g}, ${project.referenceColor.b})`,
        ...(opts.includeSeverity && summary
          ? {
              severity: {
                thresholds: project.severity.thresholds,
                mean_index: Number(summary.meanIndex.toFixed(4)),
                mean_class: Number(summary.meanClass.toFixed(2)),
                classes: summary.bins.map((b) => ({
                  label: b.label,
                  class: b.index,
                  area_m2: Number(b.area.toFixed(2)),
                  fraction: Number(b.fraction.toFixed(4)),
                  mean_index: Number(b.meanIndex.toFixed(4)),
                })),
              },
            }
          : {}),
        generated_at: new Date(project.updatedAt).toISOString(),
        generator: 'BurnTrace 烬迹',
      },
    },
  ];

  return JSON.stringify(
    {
      type: 'FeatureCollection',
      name: project.name,
      crs: project.georef.crs === 'wgs84' ? { type: 'name', properties: { name: 'urn:ogc:def:crs:OGC:1.3:CRS84' } } : undefined,
      features,
    },
    (k, v) => {
      if (typeof v !== 'number' || !Number.isFinite(v)) return v;
      // coordinates 数组里的数字按更高精度保留，其余属性按显示精度取整
      const digits = k === '' || !Number.isInteger(k) ? Math.max(6, opts.precision) : opts.precision;
      return Number(v.toFixed(digits));
    },
    2,
  );
}

function ringLength(ring: readonly Vec2[]): number {
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    s += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return s;
}

export function exportFilename(project: Project, ext: string): string {
  return safeFilename(project.name, ext);
}

/* ------------------------------------------------------------------ */
/* 本地存储序列化                                                       */
/* ------------------------------------------------------------------ */

interface StoredProject {
  version: number;
  project: Omit<Project, 'imagery' | 'dem'>;
  imagery: { name: string; url: string } | null;
  dem: { name: string; width: number; height: number; minElev: number; maxElev: number; q: string } | null;
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

export interface SerializeResult {
  json: string;
  bytes: number;
}

/** 影像缩到最长边 maxDim 的 JPEG，控制 localStorage 体积 */
export async function serializeProject(project: Project, maxDim = 900): Promise<SerializeResult> {
  const { imagery, dem, ...rest } = project;
  let storedImagery: StoredProject['imagery'] = null;
  if (imagery) {
    storedImagery = { name: imagery.name, url: await rasterToDataUrl(imagery, maxDim) };
  }
  let storedDem: StoredProject['dem'] = null;
  if (dem) {
    const q = new Int16Array(dem.heights.length);
    for (let i = 0; i < dem.heights.length; i++) q[i] = Math.round(dem.heights[i] * 10);
    const bytes = new Uint8Array(q.buffer);
    storedDem = {
      name: dem.name,
      width: dem.width,
      height: dem.height,
      minElev: dem.minElev,
      maxElev: dem.maxElev,
      q: bytesToBase64(bytes),
    };
  }
  const payload: StoredProject = { version: PROJECT_VERSION, project: rest, imagery: storedImagery, dem: storedDem };
  const json = JSON.stringify(payload);
  return { json, bytes: new Blob([json]).size };
}

function rasterToDataUrl(img: RasterImage, maxDim: number): Promise<string> {
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const w = Math.max(2, Math.round(img.width * scale));
  const h = Math.max(2, Math.round(img.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.resolve('');
  const data = new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);
  ctx.putImageData(data, 0, 0);
  if (w === img.width && h === img.height) return Promise.resolve(canvas.toDataURL('image/jpeg', 0.86));
  const small = document.createElement('canvas');
  small.width = w;
  small.height = h;
  const sctx = small.getContext('2d');
  if (!sctx) return Promise.resolve('');
  sctx.imageSmoothingQuality = 'high';
  sctx.drawImage(canvas, 0, 0, w, h);
  return Promise.resolve(small.toDataURL('image/jpeg', 0.86));
}

async function dataUrlToRaster(name: string, url: string): Promise<RasterImage> {
  const res = await fetch(url);
  const blob = await res.blob();
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('无法解码本地影像');
  ctx.drawImage(bitmap, 0, 0);
  const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  const w = bitmap.width;
  const h = bitmap.height;
  bitmap.close?.();
  return { name, width: w, height: h, data: data.data };
}

export async function deserializeProject(json: string): Promise<Project> {
  const stored = JSON.parse(json) as StoredProject;
  const project: Project = {
    ...defaultProject(),
    ...(stored.project as Omit<Project, 'imagery' | 'dem'>),
    imagery: null,
    dem: null,
  };
  if (stored.imagery?.url) {
    try {
      project.imagery = await dataUrlToRaster(stored.imagery.name, stored.imagery.url);
    } catch (err) {
      console.warn('影像恢复失败', err);
    }
  }
  if (stored.dem) {
    const bytes = base64ToBytes(stored.dem.q);
    const q = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
    const heights = new Float32Array(q.length);
    for (let i = 0; i < q.length; i++) heights[i] = q[i] / 10;
    const dem: ElevationGrid = {
      name: stored.dem.name,
      width: stored.dem.width,
      height: stored.dem.height,
      heights,
      minElev: stored.dem.minElev,
      maxElev: stored.dem.maxElev,
    };
    project.dem = dem;
  }
  return project;
}
