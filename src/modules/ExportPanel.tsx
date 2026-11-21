import { useRef, useState } from 'react';
import { useGroomStore } from '../store';
import { buildTaskFile, downloadTaskFile, importTaskFile, taskSummary } from './exportTask';

/** 模块四：任务导出（含路径点与刀头档位，供次日复压） */
export function ExportPanel() {
  const controlPoints = useGroomStore((s) => s.controlPoints);
  const [msg, setMsg] = useState<string>('');
  const [err, setErr] = useState<string>('');
  const fileRef = useRef<HTMLInputElement>(null);

  const preview = JSON.stringify(buildTaskFile(), null, 2);

  const onImport = async (file: File | undefined) => {
    if (!file) return;
    setErr('');
    setMsg('');
    try {
      const task = await importTaskFile(file);
      setMsg(`已载入 ${task.controlPoints.length} 个路径点，可直接开始复压`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '导入失败');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <section className="panel">
      <header className="panel-head">
        <span className="step-no">4</span>
        <h2>任务导出 · 次日复压</h2>
      </header>
      <p className="panel-desc">
        导出 JSON 包含全部路径控制点、刀头角度档位、雪质档位、作业速度及标注测距数据，
        次日导入即可沿原路径复压。
      </p>

      <div className="card">
        <div className="kv"><span>任务摘要</span><b>{taskSummary()}</b></div>
      </div>

      <div className="row gap">
        <button className="btn primary" disabled={controlPoints.length < 2} onClick={downloadTaskFile}>
          ⤓ 导出任务 JSON
        </button>
        <button className="btn" onClick={() => fileRef.current?.click()}>
          ⤒ 导入昨日任务
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => onImport(e.target.files?.[0])}
        />
      </div>

      {msg && <p className="msg-ok">{msg}</p>}
      {err && <p className="msg-err">{err}</p>}

      <details className="json-details">
        <summary>查看导出内容</summary>
        <pre className="json-preview">{preview}</pre>
      </details>
    </section>
  );
}
