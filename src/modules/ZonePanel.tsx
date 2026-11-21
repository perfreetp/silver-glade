import { useGroomStore } from '../store';
import { ZONE_GRID, ZONE_SIZE, WORLD_SIZE } from '../three/constants';
import type { ZoneId } from '../types';

/** 模块一：雪道底图与分区选择 */
export function ZonePanel() {
  const activeZones = useGroomStore((s) => s.activeZones);
  const toggleZone = useGroomStore((s) => s.toggleZone);
  const setAllZones = useGroomStore((s) => s.setAllZones);

  const isOn = (z: ZoneId) => [...activeZones].some((q) => q.ix === z.ix && q.iz === z.iz);

  return (
    <section className="panel">
      <header className="panel-head">
        <span className="step-no">1</span>
        <h2>雪道底图 · 分区选择</h2>
      </header>
      <p className="panel-desc">
        雪面按 {ZONE_GRID}×{ZONE_GRID} 分区（每区 {ZONE_SIZE}m，全场 {WORLD_SIZE}m），
        仅启用分区内允许绘制路径与压雪作业。
      </p>
      <div className="zone-grid" role="grid">
        {Array.from({ length: ZONE_GRID }, (_, iz) =>
          Array.from({ length: ZONE_GRID }, (_, ix) => {
            const z = { ix, iz };
            const on = isOn(z);
            return (
              <button
                key={`${ix}-${iz}`}
                className={`zone-cell ${on ? 'on' : 'off'}`}
                onClick={() => toggleZone(z)}
                title={`分区 ${ix + 1}-${iz + 1}`}
              >
                {ix + 1}-{iz + 1}
              </button>
            );
          })
        )}
      </div>
      <div className="row gap">
        <button className="btn small" onClick={() => setAllZones(true)}>全部启用</button>
        <button className="btn small ghost" onClick={() => setAllZones(false)}>全部停用</button>
        <span className="muted">已启用 {activeZones.size} / {ZONE_GRID * ZONE_GRID}</span>
      </div>
    </section>
  );
}
