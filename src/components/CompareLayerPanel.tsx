/**
 * 批次对比面板：逐层列出两个批次的平均生长阶段差，
 * 高亮差异最大的层位（与 3D 视图中的呼吸高亮联动）。
 */
import type { LayerStat } from '../types';

interface CompareLayerPanelProps {
  statsA: LayerStat[];
  statsB: LayerStat[];
  maxDiffLayer: number;
}

export default function CompareLayerPanel({ statsA, statsB, maxDiffLayer }: CompareLayerPanelProps) {
  return (
    <section className="env-panel compare-panel">
      <header className="env-panel__title">层位差异（平均生长阶段）</header>
      <table className="diff-table">
        <thead>
          <tr>
            <th>层位</th>
            <th>
              <span className="dot dot--a" /> 批次 A
            </th>
            <th>
              <span className="dot dot--b" /> 批次 B
            </th>
            <th>差值</th>
          </tr>
        </thead>
        <tbody>
          {statsA.map((a, i) => {
            const b = statsB[i];
            if (!b) return null;
            const diff = a.avgStage - b.avgStage;
            const isMax = i === maxDiffLayer;
            return (
              <tr key={a.layer} className={isMax ? 'diff-table__row--max' : ''}>
                <td>第 {a.layer + 1} 层{isMax && <span className="hl-tag">差异最大</span>}</td>
                <td>{(a.avgStage * 100).toFixed(1)}%</td>
                <td>{(b.avgStage * 100).toFixed(1)}%</td>
                <td className={diff >= 0 ? 'diff-pos' : 'diff-neg'}>
                  {diff >= 0 ? '+' : ''}
                  {(diff * 100).toFixed(1)}%
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
