// 机柜布局：生成机柜网格、端口（InstancedMesh）、机柜 AABB 包围盒
import * as THREE from 'three';
import { CABINET, PORT } from './config.js';

export class RoomLayout {
  constructor(scene) {
    this.scene = scene;
    this.cabinets = [];
    this.ports = [];            // { id, cabinetId, col, row, position, normal, instanceId }
    this.aabbs = [];            // THREE.Box3 列表
    this.portById = new Map();
    this._buildCabinets();
    this._buildPorts();
  }

  _buildCabinets() {
    const geo = new THREE.BoxGeometry(CABINET.width, CABINET.height, CABINET.depth);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x2b3a4a, metalness: 0.55, roughness: 0.45,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, CABINET.rows * CABINET.perRow);
    const m = new THREE.Matrix4();
    let n = 0;
    for (let r = 0; r < CABINET.rows; r++) {
      for (let k = 0; k < CABINET.perRow; k++) {
        const x = CABINET.rowX[r];
        const z = CABINET.zStart + k * CABINET.zSpacing;
        const y = CABINET.height / 2;
        m.makeTranslation(x, y, z);
        mesh.setMatrixAt(n, m);
        const id = `C${String(r + 1).padStart(2, '0')}-${String(k + 1).padStart(2, '0')}`;
        this.cabinets.push({ id, x, y, z });
        // 包围盒
        const box = new THREE.Box3(
          new THREE.Vector3(x - CABINET.width / 2, 0, z - CABINET.depth / 2),
          new THREE.Vector3(x + CABINET.width / 2, CABINET.height, z + CABINET.depth / 2),
        );
        box.cabinetId = id;
        this.aabbs.push(box);
        n++;
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.userData.kind = 'cabinet';
    this.scene.add(mesh);
    this.cabinetMesh = mesh;

    // 包围盒辅助线（可切换显隐）
    this._boxLines = this._buildBoxLines();
    this._boxLines.visible = false;
    this.scene.add(this._boxLines);
  }

  _buildBoxLines() {
    const pts = [];
    for (const b of this.aabbs) {
      const { min, max } = b;
      const corners = [
        [min.x, min.y, min.z], [max.x, min.y, min.z],
        [max.x, max.y, min.z], [min.x, max.y, min.z],
        [min.x, min.y, max.z], [max.x, min.y, max.z],
        [max.x, max.y, max.z], [min.x, max.y, max.z],
      ];
      const edges = [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
      for (const [a, c] of edges) {
        pts.push(corners[a], corners[c]);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts.flat(), 3));
    const mat = new THREE.LineBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: 0.85 });
    return new THREE.LineSegments(geo, mat);
  }

  setBoxesVisible(v) {
    this._boxLines.visible = v;
  }

  _buildPorts() {
    // 端口位于机柜正面（朝向机房中心的一侧）
    const geo = new THREE.BoxGeometry(PORT.size, PORT.size, PORT.size);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x546e7a, metalness: 0.3, roughness: 0.6,
    });
    const total = this.cabinets.length * PORT.cols * PORT.rows;
    const mesh = new THREE.InstancedMesh(geo, mat, total);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3(1, 1, 1);
    let n = 0;
    for (const cab of this.cabinets) {
      // 行 0 (x 小) 朝 +x，行 1 (x 大) 朝 -x
      const row = CABINET.rowX.indexOf(cab.x);
      const normal = new THREE.Vector3(row === 0 ? 1 : -1, 0, 0);
      const faceX = cab.x + normal.x * (CABINET.width / 2 + PORT.protrude);
      for (let pr = 0; pr < PORT.rows; pr++) {
        for (let pc = 0; pc < PORT.cols; pc++) {
          const z = cab.z - ((PORT.cols - 1) * PORT.pitchZ) / 2 + pc * PORT.pitchZ;
          const y = PORT.ys[pr];
          const pos = new THREE.Vector3(faceX, y, z);
          m.compose(pos, q, s);
          mesh.setMatrixAt(n, m);
          const id = `${cab.id}:P${String(pr + 1)}-${String(pc + 1).padStart(2, '0')}`;
          this.ports.push({
            id, cabinetId: cab.id, col: pc, row: pr,
            position: pos, normal, instanceId: n,
          });
          this.portById.set(id, this.ports[this.ports.length - 1]);
          n++;
        }
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.userData.kind = 'port';
    this.scene.add(mesh);
    this.portMesh = mesh;
    this._baseColor = new THREE.Color(0x546e7a);
    this._hoverColor = new THREE.Color(0xffd54f);
    this._selectedColor = new THREE.Color(0xff8f00);
    this._usedColor = new THREE.Color(0x26a69a);
    this.colorStates = new Array(total).fill('base');
  }

  // 端口状态着色：base / hover / selected / used
  setPortState(instanceId, state) {
    if (this.colorStates[instanceId] === state) return;
    this.colorStates[instanceId] = state;
    const colorMap = {
      base: this._baseColor, hover: this._hoverColor,
      selected: this._selectedColor, used: this._usedColor,
    };
    this.portMesh.setColorAt(instanceId, colorMap[state]);
    this.portMesh.instanceColor.needsUpdate = true;
  }

  markUsedPorts(ids) {
    const used = new Set(ids);
    for (const p of this.ports) {
      if (used.has(p.id)) this.setPortState(p.instanceId, 'used');
      else if (this.colorStates[p.instanceId] === 'used') this.setPortState(p.instanceId, 'base');
    }
  }
}
