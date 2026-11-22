import { BaseComponent } from './base';

/**
 * 截面视图容器：承载 three.js 画布与图例。
 * 实际渲染器由主程序挂载到 #canvas-host。
 */
export class MyceliumView extends BaseComponent {
  constructor() {
    super();
    this.setHTML(
      `
      <div class="wrap">
        <div id="canvas-host" class="host"></div>
        <div class="legend">
          <span class="legend-title">浓度分级</span>
          <i class="sw l0"></i><em>无</em>
          <i class="sw l1"></i><em>1 级</em>
          <i class="sw l2"></i><em>2 级</em>
          <i class="sw l3"></i><em>3 级</em>
          <i class="sw l4"></i><em>4 级</em>
          <i class="sw l5"></i><em>5 级</em>
        </div>
        <div class="badge" id="domain-badge">未初始化</div>
      </div>
      `,
      `
      :host { display:block; height:100%; }
      .wrap { position:relative; height:100%; min-height:480px; border-radius:10px;
              overflow:hidden; border:1px solid #262e38; background:#101418; }
      .host { position:absolute; inset:0; }
      .host canvas { display:block; }
      .legend {
        position:absolute; left:12px; bottom:12px; display:flex; align-items:center; gap:6px;
        background:rgba(13,17,22,0.82); border:1px solid #262e38; border-radius:8px;
        padding:7px 10px; font-style:normal; font-size:11.5px; color:#9fb0bf;
      }
      .legend-title { margin-right:6px; color:#c8d6e4; font-weight:600; }
      .sw { width:16px; height:16px; border-radius:3px; display:inline-block; border:1px solid rgba(255,255,255,0.12); }
      .l0 { background:#5d4630; }
      .l1 { background:rgba(214,201,178,0.42); }
      .l2 { background:rgba(228,219,200,0.55); }
      .l3 { background:rgba(240,235,222,0.68); }
      .l4 { background:rgba(249,247,239,0.82); }
      .l5 { background:rgba(255,255,250,0.96); }
      em { font-style:normal; margin-right:6px; }
      .badge {
        position:absolute; right:12px; top:12px; background:rgba(13,17,22,0.82);
        border:1px solid #262e38; border-radius:8px; padding:6px 10px;
        font-size:11.5px; color:#9fb0bf; font-variant-numeric:tabular-nums;
      }
      `,
    );
  }

  get host(): HTMLElement {
    return this.$('#canvas-host');
  }

  setBadge(text: string): void {
    this.$('#domain-badge').textContent = text;
  }
}
