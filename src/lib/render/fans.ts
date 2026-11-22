import * as THREE from 'three';
import { fanAxisDir, fanFaceSpeed, fanWorldPosition, type Fan } from '../model/fans';
import { wallFrame, type Fan as FanModel } from '../model/room';
import { PALETTE } from './scene';

export interface FanVisual {
  fan: Fan;
  group: THREE.Group;
  disc: THREE.Mesh;
  ring: THREE.Mesh;
  arrow: THREE.Group;
  /** 用于拾取的不可见大一点的目标 */
  hit: THREE.Mesh;
}

/**
 * 风机可视化: 墙面圆盘 + 风向箭头。
 * 进风 = 蓝, 回风 = 橙; 箭头长度随风量, 朝向随 tilt/pitch。
 */
export class FanRenderer {
  readonly group: THREE.Group;
  private visuals = new Map<string, FanVisual>();
  private labelSprites = new Map<string, THREE.Sprite>();
  private disposables: (() => void)[] = [];

  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'fans';
  }

  private makeArrow() {
    const g = new THREE.Group();
    const shaftGeo = new THREE.CylinderGeometry(0.035, 0.035, 1, 8);
    const headGeo = new THREE.ConeGeometry(0.09, 0.22, 10);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xffffff,
      emissiveIntensity: 0.22,
      roughness: 0.4,
      metalness: 0.1,
    });
    const shaft = new THREE.Mesh(shaftGeo, mat);
    shaft.position.y = 0.5;
    const head = new THREE.Mesh(headGeo, mat);
    head.position.y = 1.0;
    g.add(shaft);
    g.add(head);
    this.disposables.push(() => {
      shaftGeo.dispose();
      headGeo.dispose();
      mat.dispose();
    });
    return g;
  }

  sync(fans: Fan[]) {
    const seen = new Set<string>();
    for (const fan of fans) {
      seen.add(fan.id);
      let vis = this.visuals.get(fan.id);
      if (!vis) {
        const group = new THREE.Group();
        group.name = `fan-${fan.id}`;
        // 圆盘: 略微凸出墙面
        const discGeo = new THREE.CircleGeometry(1, 48);
        const discMat = new THREE.MeshStandardMaterial({
          color: fan.kind === 'supply' ? PALETTE.fanSupply : PALETTE.fanExhaust,
          emissive: fan.kind === 'supply' ? PALETTE.fanSupply : PALETTE.fanExhaust,
          emissiveIntensity: 0.22,
          roughness: 0.35,
          metalness: 0.2,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.75,
        });
        const disc = new THREE.Mesh(discGeo, discMat);
        // 圆环
        const ringGeo = new THREE.RingGeometry(0.92, 1.0, 48);
        const ringMat = new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0.85,
          side: THREE.DoubleSide,
        });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.position.z = 0.002;
        disc.add(ring);
        // 拾取目标: 不可见, 略大
        const hitGeo = new THREE.CircleGeometry(1.35, 20);
        const hitMat = new THREE.MeshBasicMaterial({
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          colorWrite: false,
        });
        const hit = new THREE.Mesh(hitGeo, hitMat);
        hit.position.z = 0.02;
        hit.userData.fanId = fan.id;
        disc.add(hit);
        disc.userData.fanId = fan.id;
        group.add(disc);

        const arrow = this.makeArrow();
        group.add(arrow);

        this.group.add(group);
        vis = { fan, group, disc, ring, arrow, hit };
        this.visuals.set(fan.id, vis);
        this.disposables.push(() => {
          discGeo.dispose();
          discMat.dispose();
          ringGeo.dispose();
          ringMat.dispose();
          hitGeo.dispose();
          hitMat.dispose();
        });
      }
      vis.fan = fan;
      this.layout(vis);
    }
    // 移除已删除的风机
    for (const [id, vis] of this.visuals) {
      if (!seen.has(id)) {
        this.group.remove(vis.group);
        this.visuals.delete(id);
      }
    }
  }

  private layout(vis: FanVisual) {
    const fan = vis.fan;
    const f = wallFrame(fan.wall);
    const pos = fanWorldPosition(fan);
    const color = fan.kind === 'supply' ? PALETTE.fanSupply : PALETTE.fanExhaust;
    vis.disc.position.set(pos.x, pos.y, pos.z);

    // 圆盘朝向: 法向 = 墙面法向
    const n = new THREE.Vector3(f.normal.x, f.normal.y, f.normal.z);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    vis.disc.quaternion.copy(q);
    vis.disc.scale.setScalar(fan.radius);
    (vis.disc.material as THREE.MeshStandardMaterial).color.setHex(color);
    (vis.disc.material as THREE.MeshStandardMaterial).emissive.setHex(color);

    // 箭头: 从墙面指向室内, 长度随风量
    const dir = fanAxisDir(fan);
    const flowScale = Math.min(2.6, Math.max(0.55, Math.sqrt(fan.airflow / 3000) * 0.9));
    vis.arrow.position.set(pos.x, pos.y, pos.z);
    // 稍微离墙
    vis.arrow.position.add(n.clone().multiplyScalar(0.06));
    vis.arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dir.x, dir.y, dir.z));
    vis.arrow.scale.setScalar(flowScale);
    vis.arrow.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        const m = o.material as THREE.MeshStandardMaterial;
        m.color.setHex(color);
        m.emissive.setHex(color);
      }
    });
    // 回风机箭头反向 (吸入墙内)
    if (fan.kind === 'exhaust') {
      vis.arrow.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        new THREE.Vector3(-dir.x, -dir.y, -dir.z),
      );
    }
    // 面风速编码在圆盘光强上
    const faceSpeed = fanFaceSpeed(fan);
    (vis.disc.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.16 + Math.min(0.5, faceSpeed / 12);
  }

  getVisual(id: string) {
    return this.visuals.get(id);
  }

  allVisuals() {
    return [...this.visuals.values()];
  }

  dispose() {
    this.disposables.forEach((d) => d());
  }
}
