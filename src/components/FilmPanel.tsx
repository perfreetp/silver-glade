import { FILM_LIBRARY, FINISH_LABEL } from '../filmLibrary';
import type { FilmFinish } from '../types';

interface Props {
  selectedId: string | null;
  onSelect: (id: string) => void;
}

const GROUPS: FilmFinish[] = ['matte', 'gloss', 'metallic'];

export function FilmPanel({ selectedId, onSelect }: Props) {
  return (
    <aside className="panel panel-left">
      <h2>膜色库</h2>
      {GROUPS.map((finish) => (
        <section key={finish} className="film-group">
          <h3>
            <span className={`finish-dot finish-${finish}`} />
            {FINISH_LABEL[finish]}
          </h3>
          <div className="film-grid">
            {FILM_LIBRARY.filter((f) => f.finish === finish).map((film) => (
              <button
                key={film.id}
                className={`film-chip ${selectedId === film.id ? 'selected' : ''}`}
                title={`${film.id} ${film.name}`}
                onClick={() => onSelect(film.id)}
              >
                <span
                  className="film-swatch"
                  style={{
                    background: `rgb(${film.color.map((c) => (c * 255) | 0).join(',')})`,
                  }}
                />
                <span className="film-meta">
                  <span className="film-id">{film.id}</span>
                  <span className="film-name">{film.name}</span>
                </span>
              </button>
            ))}
          </div>
        </section>
      ))}
      <p className="panel-hint">选中膜色后，切换到「填色」工具点击车身色块。</p>
    </aside>
  );
}
