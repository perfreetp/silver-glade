// 主入口：场景装配、拾取交互、Worker 搜索流程、四个模块的面板联动
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ROOM, GRID, CABLE, VARIANTS } from './config.js';
import { PathGrid } from './grid.js';
import { RoomLayout } from './room.js';
import { CableStore } from './cableStore.js';
import { CableLayer } from './cableLayer.js';
import { WaypointEditor } from './waypointEditor.js';
import { PathWorkerClient } from './workerClient.js';
import { exportCablePaths, exportLengthList } from './exporter.js';

// ---------- 场景 ----------
const canvas = document.getElementById('viewport');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
renderer.shadowMap.enabled = false;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x060a0f);

const camera = new THREE.PerspectiveCamera(55, canvas.clientWidth / canvas.clientHeight, 0.1, 200);
camera.position.set(14, 11, 16);

const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true;
orbit.dampingFactor = 0.08;
orbit.minDistance = 3;
orbit.maxDistance = 60;
orbit.maxPolarAngle = Math.PI * 0.495;

scene.add(new THREE.AmbientLight(0xffffff, 0.55));
const dir = new THREE.DirectionalLight(0xffffff, 1.1);
dir.position.set(10, 18, 8);
scene.add(dir);
const fill = new THREE.DirectionalLight(0x88aaff, 0.35);
fill.position.set(-12, 8, -10);
scene.add(fill);

// 地面与参考网格
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(ROOM.maxX - ROOM.minX, ROOM.maxZ - ROOM.minZ),
  new THREE.MeshStandardMaterial({ color: 0x101a24, roughness: 0.9 }),
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = 0.001;
scene.add(floor);
const gridHelper = new THREE.GridHelper(
  Math.max(ROOM.maxX - ROOM.minX, ROOM.maxZ - ROOM.minZ), 40, 0x2a4a66, 0x1a2c3e,
);
gridHelper.position.y = 0.005;
scene.add(gridHelper);

// 机房边框
{
  const boxGeo = new THREE.BoxGeometry(
    ROOM.maxX - ROOM.minX, ROOM.maxY - ROOM.minY, ROOM.maxZ - ROOM.minZ,
  );
  const edges = new THREE.EdgesGeometry(boxGeo);
  const frame = new THREE.LineSegments(
    edges, new THREE.LineBasicMaterial({ color: 0x335577, transparent: true, opacity: 0.7 }),
  );
  frame.position.set(
    (ROOM.minX + ROOM.maxX) / 2, ROOM.minY + (ROOM.maxY - ROOM.minY) / 2, (ROOM.minZ + ROOM.maxZ) / 2,
  );
  scene.add(frame);
}

// ---------- 领域对象 ----------
const room = new RoomLayout(scene);
const pathGrid = new PathGrid();
pathGrid.buildOccupancy(room.aabbs);
const store = new CableStore(room.aabbs);
const cableLayer = new CableLayer(scene, store);
const editor = new WaypointEditor(camera, renderer.domElement, orbit, store, cableLayer);
scene.add(editor.group);
scene.add(editor.object);

const worker = new PathWorkerClient(new URL('./workers/pathWorker.js', import.meta.url));

// ---------- DOM 快捷方式 ----------
const $ = (id) => document.getElementById(id);
const els = {
  valA: $('val-a'), valB: $('val-b'), slotA: $('slot-a'), slotB: $('slot-b'),
  btnSearch: $('btn-search'), chkBoxes: $('chk-boxes'), chkGrid: $('chk-grid'),
  batchCount: $('batch-count'), btnBatch: $('btn-batch'),
  batchProgress: $('batch-progress'), batchBar: $('batch-bar'),
  variantList: $('variant-list'), chkSnap: $('chk-snap'), selMode: $('sel-mode'),
  rngBend: $('rng-bend'), valBend: $('val-bend'),
  rngRadius: $('rng-radius'), valRadius: $('val-radius'), selColor: $('sel-color'),
  viewCount: $('view-count'), tooltip: $('tooltip'),
  cableInfo: $('cable-info'), selCableColor: $('sel-cable-color'),
  rngCableRadius: $('rng-cable-radius'), valCableRadius: $('val-cable-radius'),
  chkWp: $('chk-wp'),
  statCount: $('stat-count'), statTotal: $('stat-total'),
  statCollision: $('stat-collision'), statHitLen: $('stat-hitlen'),
  tableBody: document.querySelector('#length-table tbody'),
  btnJson: $('btn-export-json'), btnCsv: $('btn-export-csv'), btnClear: $('btn-clear'),
};

// 颜色下拉
for (let i = 0; i < CABLE.palette.length; i++) {
  const hex = CABLE.palette[i];
  const label = `颜色 ${i + 1}`;
  els.selColor.add(new Option(label, i));
  els.selCableColor.add(new Option(label, i));
}

// ---------- 端口选择状态 ----------
let portA = null, portB = null;

function refreshPortSlots() {
  els.valA.textContent = portA ? portA.id : '未选择';
  els.valB.textContent = portB ? portB.id : '未选择';
  els.slotA.classList.toggle('active', !!portA);
  els.slotB.classList.toggle('active', !!portB);
  els.btnSearch.disabled = !(portA && portB);
}

function isPortUsed(portId) {
  return store.cables.some((c) => c.portA.id === portId || c.portB.id === portId);
}

function handlePortClick(port) {
  if (portA && port.instanceId === portA.instanceId) {
    room.setPortState(port.instanceId, isPortUsed(port.id) ? 'used' : 'base');
    portA = null;
  } else if (portB && port.instanceId === portB.instanceId) {
    room.setPortState(port.instanceId, isPortUsed(port.id) ? 'used' : 'base');
    portB = null;
  } else if (!portA) {
    portA = port;
    room.setPortState(port.instanceId, 'selected');
  } else if (!portB) {
    portB = port;
    room.setPortState(port.instanceId, 'selected');
  } else {
    // 两个槽都满：替换 B
    room.setPortState(portB.instanceId, isPortUsed(portB.id) ? 'used' : 'base');
    portB = port;
    room.setPortState(port.instanceId, 'selected');
  }
  refreshPortSlots();
}

// ---------- Worker 搜索 ----------
function workerData(startPort, endPort) {
  // 为每个方案计算必经航点的网格单元（高度走廊 + 机房中部 x，强制绕行通道差异化）
  const variants = VARIANTS.map((v) => {
    if (v.waypointY === null) return { ...v, waypointCells: [] };
    const midZ = (startPort.position.z + endPort.position.z) / 2;
    const wp1 = { x: 0, y: v.waypointY, z: startPort.position.z };
    const wp2 = { x: 0, y: v.waypointY, z: midZ };
    const wp3 = { x: 0, y: v.waypointY, z: endPort.position.z };
    return {
      ...v,
      waypointCells: [wp1, wp2, wp3].map((p) => pathGrid.worldToIndex(p)),
    };
  });
  return {
    payload: {
      nx: pathGrid.nx, ny: pathGrid.ny, nz: pathGrid.nz,
      occ: pathGrid.occ,
      start: pathGrid.worldToIndex(startPort.position),
      goal: pathGrid.worldToIndex(endPort.position),
      cell: pathGrid.cell,
      maxIter: GRID.maxIterations,
      roomMaxY: ROOM.maxY,
    },
    variants,
  };
}

async function searchPair(startPort, endPort) {
  const { payload, variants } = workerData(startPort, endPort);
  const results = await worker.search(payload, variants);
  return results.map((r) => {
    if (r.error || !r.path) {
      return { key: r.key, error: r.error || '未找到路径', iterations: r.iterations || 0, waypoints: null };
    }
    // 单单元退化（起终点同格）：直接用真实端口坐标直连
    const waypoints = r.degenerate
      ? [{ ...startPort.position }, { ...endPort.position }]
      : pathGrid.cellPathToWaypoints(r.path);
    return { key: r.key, error: null, iterations: r.iterations || 0, waypoints };
  });
}

async function onSearchClick() {
  if (!portA || !portB) return;
  els.btnSearch.disabled = true;
  els.btnSearch.textContent = '搜索中…';
  try {
    const candidates = await searchPair(portA, portB);
    const cable = store.addCable(portA, portB, candidates);
    store.select(cable.id);
    room.markUsedPorts([portA.id, portB.id]);
    cableLayer.updateAll();
    syncSelectionUI();
  } catch (err) {
    els.variantList.className = 'variant-list';
    els.variantList.innerHTML = `<div class="hint" style="color:#ff6b6b">搜索失败：${err.message}</div>`;
  } finally {
    els.btnSearch.disabled = false;
    els.btnSearch.textContent = '搜索避障路径（3 条候选）';
  }
}
els.btnSearch.addEventListener('click', onSearchClick);

// ---------- 批量生成 ----------
async function onBatchClick() {
  const n = Math.min(Number(els.batchCount.value) || 300, CABLE.maxCount);
  els.btnBatch.disabled = true;
  els.btnSearch.disabled = true;
  els.batchProgress.hidden = false;
  els.batchBar.style.width = '0%';
  const pairs = buildRandomPairs(n);
  const usedIds = new Set();
  let done = 0, okCount = 0, failCount = 0;
  for (const [a, b] of pairs) {
    try {
      const candidates = await searchPair(a, b);
      if (candidates.some((c) => c.waypoints)) {
        store.addCable(a, b, candidates);
        usedIds.add(a.id); usedIds.add(b.id);
        okCount++;
      } else {
        failCount++;
      }
    } catch {
      failCount++; // 单条失败不阻断批量
    }
    done++;
    if (done % 10 === 0 || done === pairs.length) {
      els.batchBar.style.width = `${(done / pairs.length) * 100}%`;
      // 让出主线程刷新 UI
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  room.markUsedPorts([...usedIds]);
  cableLayer.updateAll();
  syncSelectionUI();
  updateStatsAndTable();
  els.btnBatch.disabled = false;
  els.btnSearch.disabled = !(portA && portB);
  setTimeout(() => { els.batchProgress.hidden = true; }, 600);
  if (failCount > 0) console.warn(`批量建线完成：成功 ${okCount}，失败 ${failCount}`);
}
els.btnBatch.addEventListener('click', onBatchClick);

// 生成不重复的随机端口对（先洗牌保证高配对成功率，再循环取用）
function buildRandomPairs(n) {
  const ports = room.ports;
  const seen = new Set();
  const pairs = [];
  let guard = 0;
  const maxGuard = n * 200;
  while (pairs.length < n && guard < maxGuard) {
    guard++;
    const i = Math.floor(Math.random() * ports.length);
    const j = Math.floor(Math.random() * ports.length);
    if (i === j) continue;
    const key = i < j ? `${i}|${j}` : `${j}|${i}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push([ports[i], ports[j]]);
  }
  // 随机采样耗尽时，用洗牌后的全量端口两两配对兜底（640 端口可支撑 320 对）
  if (pairs.length < n) {
    const shuffled = ports.map((p, i) => i).sort(() => Math.random() - 0.5);
    for (let k = 0; k + 1 < shuffled.length && pairs.length < n; k += 2) {
      const i = shuffled[k], j = shuffled[k + 1];
      const key = i < j ? `${i}|${j}` : `${j}|${i}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push([ports[i], ports[j]]);
    }
  }
  return pairs.slice(0, n);
}

// ---------- 视口拾取 ----------
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let downX = 0, downY = 0;

function setPointer(e) {
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
}

canvas.addEventListener('pointerdown', (e) => {
  downX = e.clientX; downY = e.clientY;
});

canvas.addEventListener('pointerup', (e) => {
  if (Math.hypot(e.clientX - downX, e.clientY - downY) > 5) return; // 拖动视角不算点击
  setPointer(e);
  // 控制点优先
  if (editor.group.visible && editor.handles.length) {
    const hitH = raycaster.intersectObject(editor.handleMesh, false);
    if (hitH.length) {
      editor.beginDrag(hitH[0].instanceId);
      return;
    }
  }
  const hitPort = raycaster.intersectObject(room.portMesh, false);
  if (hitPort.length) {
    const port = room.ports[hitPort[0].instanceId];
    handlePortClick(port);
    return;
  }
  const hitCable = raycaster.intersectObject(cableLayer.mesh, false);
  if (hitCable.length) {
    const id = cableLayer.ownerOf(hitCable[0].instanceId);
    if (id) selectCable(id);
  }
});

canvas.addEventListener('pointermove', (e) => {
  setPointer(e);
  const hitPort = raycaster.intersectObject(room.portMesh, false);
  if (hitPort.length) {
    const port = room.ports[hitPort[0].instanceId];
    canvas.style.cursor = 'pointer';
    els.tooltip.hidden = false;
    els.tooltip.textContent = port.id;
    els.tooltip.style.left = `${e.offsetX + 14}px`;
    els.tooltip.style.top = `${e.offsetY + 12}px`;
    if (hoverPort !== port) {
      if (hoverPort && room.colorStates[hoverPort.instanceId] === 'base') {
        room.setPortState(hoverPort.instanceId, 'base');
      }
      hoverPort = port;
      if (room.colorStates[port.instanceId] === 'base') room.setPortState(port.instanceId, 'hover');
    }
  } else {
    if (hoverPort && room.colorStates[hoverPort.instanceId] === 'hover') {
      room.setPortState(hoverPort.instanceId, 'base');
    }
    hoverPort = null;
    els.tooltip.hidden = true;
    canvas.style.cursor = 'default';
  }
});
let hoverPort = null;

// 控制点：双击插入，右键删除
canvas.addEventListener('dblclick', (e) => {
  if (!editor.group.visible) return;
  setPointer(e);
  const hit = raycaster.intersectObject(editor.handleMesh, false);
  if (hit.length) editor.insertAfter(hit[0].instanceId);
});
canvas.addEventListener('contextmenu', (e) => {
  if (!editor.group.visible) return;
  setPointer(e);
  const hit = raycaster.intersectObject(editor.handleMesh, false);
  if (hit.length) {
    e.preventDefault();
    editor.removeAt(hit[0].instanceId);
  }
});

// ---------- 选中与面板同步 ----------
function selectCable(id) {
  store.select(id);
  syncSelectionUI();
}

function syncSelectionUI() {
  const c = store.selected;
  cableLayer.refreshColors();
  if (c && els.chkWp.checked) {
    editor.show(c);
  } else {
    editor.clear();
    editor.group.visible = false;
  }
  renderCableInfo(c);
  renderVariantList(c);
  renderTableSelection();
  if (c) {
    els.rngCableRadius.value = c.radius;
    els.valCableRadius.textContent = `${c.radius.toFixed(3)} m`;
    els.selCableColor.value = String(c.colorIndex);
    els.selMode.value = c.mode;
    els.rngBend.value = c.bendRadius;
    els.valBend.textContent = c.bendRadius.toFixed(2);
  }
}

function renderCableInfo(c) {
  if (!c) {
    els.cableInfo.className = 'cable-info empty';
    els.cableInfo.textContent = '未选中线缆（点击视口中的线缆）';
    return;
  }
  const hit = c.collision;
  const status = hit.hitSegments.size
    ? `<span class="collision-warn">穿模 ${hit.hitSegments.size} 段 / ${hit.hitLength.toFixed(2)} m</span>`
    : '<span class="collision-ok">无碰撞</span>';
  els.cableInfo.className = 'cable-info';
  els.cableInfo.innerHTML = `
    <div class="kv"><span>编号</span><b>${c.id}${c.manual ? '（手动调整）' : ''}</b></div>
    <div class="kv"><span>端口</span><b>${c.portA.id} → ${c.portB.id}</b></div>
    <div class="kv"><span>方案</span><b>${store.variantName(c.variantKey)}</b></div>
    <div class="kv"><span>长度</span><b>${c.length.toFixed(3)} m</b></div>
    <div class="kv"><span>最小弯曲半径</span><b>${c.minRadius !== null ? c.minRadius.toFixed(3) + ' m' : '—'}</b></div>
    <div class="kv"><span>碰撞检测</span>${status}</div>`;
}

function renderVariantList(c) {
  if (!c) {
    els.variantList.className = 'variant-list empty';
    els.variantList.textContent = '请先选择两个端口并搜索';
    return;
  }
  els.variantList.className = 'variant-list';
  els.variantList.innerHTML = '';
  for (const v of c.candidates) {
    const div = document.createElement('div');
    const ok = !!v.waypoints;
    div.className = `variant-item ${ok ? '' : 'failed'} ${v.key === c.variantKey ? 'active' : ''}`;
    const name = VARIANTS.find((x) => x.key === v.key).name;
    div.innerHTML = ok
      ? `<span class="v-name">${name}</span><span class="v-meta">${waypointLen(v.waypoints).toFixed(2)} m · ${v.waypoints.length} 控制点</span>`
      : `<span class="v-name">${name}</span><span class="v-meta">${v.error || '不可达'}</span>`;
    if (ok) div.addEventListener('click', () => {
      store.switchVariant(c.id, v.key);
      cableLayer.updateCable(store.selected);
      syncSelectionUI();
      updateStatsAndTable();
    });
    els.variantList.appendChild(div);
  }
}

function waypointLen(wps) {
  let len = 0;
  for (let i = 1; i < wps.length; i++) {
    len += Math.hypot(wps[i].x - wps[i - 1].x, wps[i].y - wps[i - 1].y, wps[i].z - wps[i - 1].z);
  }
  return len;
}

// ---------- 统计与长度清单 ----------
function updateStatsAndTable() {
  const stats = store.collisionStats();
  els.statCount.textContent = store.cables.length;
  els.statTotal.textContent = `${store.totalLength().toFixed(2)} m`;
  els.statCollision.textContent = stats.cableCount;
  els.statHitLen.textContent = `${stats.hitLength.toFixed(2)} m`;
  els.viewCount.textContent = `线缆 ${store.cables.length} 条 · 总长 ${store.totalLength().toFixed(1)} m`;

  const rows = store.cables.map((c) => {
    const tr = document.createElement('tr');
    tr.dataset.id = c.id;
    if (c.id === store.selectedId) tr.classList.add('selected');
    const hit = c.collision.hitSegments.size;
    tr.innerHTML = `
      <td>${c.id}</td><td>${c.portA.id}</td><td>${c.portB.id}</td>
      <td>${store.variantName(c.variantKey).split(' · ')[0]}</td>
      <td>${c.length.toFixed(3)}</td>
      <td class="${hit ? 'hit' : 'ok'}">${hit ? `${hit} 段` : '无'}</td>`;
    tr.addEventListener('click', () => selectCable(c.id));
    return tr;
  });
  els.tableBody.replaceChildren(...rows);
}

function renderTableSelection() {
  for (const tr of els.tableBody.querySelectorAll('tr')) {
    tr.classList.toggle('selected', tr.dataset.id === store.selectedId);
  }
}

// ---------- store 事件：拖动等局部更新 ----------
store.on((evt) => {
  if (evt.type === 'cableChanged') {
    cableLayer.updateCable(evt.cable);
    renderCableInfo(store.selected);
    updateStatsAndTable();
  } else if (evt.type === 'cableAdded' || evt.type === 'cableRemoved' || evt.type === 'cleared') {
    cableLayer.updateAll();
    updateStatsAndTable();
  } else if (evt.type === 'globalChanged') {
    cableLayer.updateAll();
    updateStatsAndTable();
  }
});

// ---------- 控件事件 ----------
els.chkBoxes.addEventListener('change', () => room.setBoxesVisible(els.chkBoxes.checked));
els.chkGrid.addEventListener('change', () => { gridHelper.visible = els.chkGrid.checked; });
els.chkSnap.addEventListener('change', () => editor.setSnap(els.chkSnap.checked));
els.chkWp.addEventListener('change', () => syncSelectionUI());

els.selMode.addEventListener('change', () => {
  store.globalMode = els.selMode.value;   // 后续新建线缆沿用
  const c = store.selected;
  if (c) store.setMode(c.id, els.selMode.value);
});
els.rngBend.addEventListener('input', () => {
  const r = Number(els.rngBend.value);
  els.valBend.textContent = r.toFixed(2);
  store.globalBend = r;                    // 后续新建线缆沿用
  const c = store.selected;
  if (c) store.setBendRadius(c.id, r);
});
els.rngRadius.addEventListener('input', () => {
  els.valRadius.textContent = Number(els.rngRadius.value).toFixed(3);
  store.setGlobalRadius(Number(els.rngRadius.value));
});
els.selColor.addEventListener('change', () => {
  const idx = Number(els.selColor.value);
  for (const c of store.cables) c.colorIndex = idx;
  cableLayer.refreshColors();
});
els.selCableColor.addEventListener('change', () => {
  const c = store.selected;
  if (c) store.setColorIndex(c.id, Number(els.selCableColor.value));
});
els.rngCableRadius.addEventListener('input', () => {
  const c = store.selected;
  if (!c) return;
  els.valCableRadius.textContent = `${Number(els.rngCableRadius.value).toFixed(3)} m`;
  store.setCableRadius(c.id, Number(els.rngCableRadius.value));
});

els.btnJson.addEventListener('click', () => {
  if (!store.cables.length) return alert('暂无线缆可导出');
  exportCablePaths(store);
});
els.btnCsv.addEventListener('click', () => {
  if (!store.cables.length) return alert('暂无线缆可导出');
  exportLengthList(store);
});
els.btnClear.addEventListener('click', () => {
  if (!store.cables.length) return;
  if (!confirm(`确认清空全部 ${store.cables.length} 条线缆？`)) return;
  store.clear();
  portA = portB = null;
  room.markUsedPorts([]);
  refreshPortSlots();
  syncSelectionUI();
});

// ---------- 尺寸与渲染循环 ----------
window.addEventListener('resize', () => {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
});

function animate() {
  requestAnimationFrame(animate);
  orbit.update();
  renderer.render(scene, camera);
}
animate();
updateStatsAndTable();
refreshPortSlots();
