import * as THREE from 'three';
import type { MachineConfig } from '../core/types';
import { terrainHeight, yawToVector } from '../core/mathUtils';

/**
 * 造雪机 3D 表现（模块一视图层）。
 * 每台机器一个 Group：底座 + 支架 + 可旋转炮管 + 炮口辉光球。
 * 选中机描边发光；夜间炮口辉光增强，作为 Bloom 后期的高亮源。
 */
export class MachineView {
  readonly group = new THREE.Group();
  private views = new Map<number, MachineMesh>();
  private rayTargets: THREE.Object3D[] = [];

  /** 可被射线拾取的对象（底座/炮管），附带机器 id */
  pickables(): ReadonlyArray<THREE.Object3D> {
    return this.rayTargets;
  }

  sync(machines: readonly MachineConfig[], selectedId: number | null, night: boolean): void {
    const alive = new Set<number>();
    for (const cfg of machines) {
      alive.add(cfg.id);
      let v = this.views.get(cfg.id);
      if (!v) {
        v = this.build(cfg.id);
        this.views.set(cfg.id, v);
        this.group.add(v.root);
        this.rayTargets.push(v.base, v.barrel);
      }
      this.place(v, cfg);
      const selected = cfg.id === selectedId;
      v.outline.visible = selected;
      v.glowMat.opacity = night ? 0.75 : 0.4;
      v.glowMat.color.setHex(night ? 0x99e6ff : 0x88bbcc);
    }
    for (const [id, v] of this.views) {
      if (!alive.has(id)) {
        this.group.remove(v.root);
        this.rayTargets = this.rayTargets.filter((o) => o.userData.machineId !== id);
        this.dispose(v);
        this.views.delete(id);
      }
    }
  }

  private place(v: MachineMesh, cfg: MachineConfig): void {
    const y = terrainHeight(cfg.x, cfg.z);
    v.root.position.set(cfg.x, y, cfg.z);
    // 支架随坡面法线倾斜
    const e = 0.35;
    const n = new THREE.Vector3(
      terrainHeight(cfg.x - e, cfg.z) - terrainHeight(cfg.x + e, cfg.z),
      2 * e,
      terrainHeight(cfg.x, cfg.z - e) - terrainHeight(cfg.x, cfg.z + e),
    ).normalize();
    v.base.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);

    // 炮管：水平 yaw + 俯仰 pitch
    v.turret.rotation.set(0, 0, 0);
    v.barrelPivot.rotation.x = -(cfg.pitch * Math.PI) / 180;
    const yawRad = (cfg.yaw * Math.PI) / 180;
    // 模型炮管默认朝 -Z，旋转使 yaw=0 时指向 +Z
    v.turret.rotation.y = Math.PI - yawRad;
  }

  /** 炮口世界坐标（粒子发射位置与该点对齐） */
  muzzleWorld(cfg: MachineConfig, out = new THREE.Vector3()): THREE.Vector3 {
    const v = this.views.get(cfg.id);
    if (!v) return out.set(cfg.x, terrainHeight(cfg.x, cfg.z) + 2.4, cfg.z);
    v.lens.getWorldPosition(out);
    return out;
  }

  /** 朝向箭头（摆放模式下提示 yaw） */
  yawDirection(cfg: MachineConfig, out = new THREE.Vector3()): THREE.Vector3 {
    return yawToVector(cfg.yaw, out);
  }

  private build(id: number): MachineMesh {
    const root = new THREE.Group();

    const metal = new THREE.MeshStandardMaterial({ color: 0xd85d2a, roughness: 0.45, metalness: 0.35 });
    const darkMetal = new THREE.MeshStandardMaterial({ color: 0x3a4149, roughness: 0.5, metalness: 0.6 });

    // 底座（圆盘 + 三爪支腿简化为圆锥台）
    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.35, 0.5, 14), metal);
    base.position.y = 0.25;
    base.userData.machineId = id;

    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 1.5, 10), darkMetal);
    post.position.y = 1.15;

    const turret = new THREE.Group();
    turret.position.y = 1.95;

    const housing = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.75, 1.1), metal);
    const barrelPivot = new THREE.Group();
    // 炮管默认沿 -Z 伸出
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.24, 2.1, 10), darkMetal);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.z = -1.15;
    barrel.userData.machineId = id;

    // 炮口辉光球（Bloom 高亮源）
    const glowMat = new THREE.MeshBasicMaterial({
      color: 0x99e6ff,
      transparent: true,
      opacity: 0.7,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const lens = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 10), glowMat);
    lens.position.z = -2.2;

    // 选中描边：稍大的线框壳
    const outline = new THREE.Mesh(
      new THREE.CylinderGeometry(1.5, 1.7, 2.6, 14, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x66d9ff, wireframe: true, transparent: true, opacity: 0.55 }),
    );
    outline.position.y = 1.2;
    outline.visible = false;

    barrelPivot.add(barrel, lens);
    turret.add(housing, barrelPivot);
    root.add(base, post, turret, outline);

    return { root, base, barrel, turret, barrelPivot, lens, outline, glowMat };
  }

  private dispose(v: MachineMesh): void {
    v.root.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        const m = o.material;
        if (Array.isArray(m)) m.forEach((x) => x.dispose());
        else m.dispose();
      }
    });
  }
}

interface MachineMesh {
  root: THREE.Group;
  base: THREE.Mesh;
  barrel: THREE.Mesh;
  turret: THREE.Group;
  barrelPivot: THREE.Group;
  lens: THREE.Mesh;
  outline: THREE.Mesh;
  glowMat: THREE.MeshBasicMaterial;
}
