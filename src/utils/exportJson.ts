import type { PaintParams, SavedScheme } from '../types';

const EXPORT_VERSION = 1;

export interface PaintExportDoc {
  format: 'car-paint-studio';
  version: number;
  exportedAt: string;
  schemeName: string;
  units: { thickness: 'micrometer'; ior: 'dimensionless' };
  layers: {
    electroCoat: PaintParams['electro'];
    primerBaseCoat: PaintParams['mid'];
    flakeCoat: PaintParams['flake'];
    clearCoat: PaintParams['clear'];
  };
}

export function buildExportDoc(scheme: SavedScheme): PaintExportDoc {
  return {
    format: 'car-paint-studio',
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    schemeName: scheme.name,
    units: { thickness: 'micrometer', ior: 'dimensionless' },
    layers: {
      electroCoat: structuredClone(scheme.params.electro),
      primerBaseCoat: structuredClone(scheme.params.mid),
      flakeCoat: structuredClone(scheme.params.flake),
      clearCoat: structuredClone(scheme.params.clear),
    },
  };
}

export function downloadJson(doc: PaintExportDoc): void {
  const blob = new Blob([JSON.stringify(doc, null, 2)], {
    type: 'application/json;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const safe = doc.schemeName.replace(/[\\/:*?"<>|\s]+/g, '_');
  a.href = url;
  a.download = `${safe || 'paint_scheme'}.paint.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
