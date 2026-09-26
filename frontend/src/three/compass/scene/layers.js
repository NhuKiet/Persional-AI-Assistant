/**
 * Moi lop la mot Mesh(PlaneGeometry) dung texture cua lop do, additive blending,
 * kem 2 vanh torus mong o mep trong/ngoai de tao cam giac "co do day".
 * Tu the do PoseState quyet dinh (nguoi dung lai), khong con theo timeline.
 */
import * as THREE from 'three';
import { RIMS, COLORS, INK } from '../config.js';
import { makeLayerMaterial } from './layerMaterial.js';

const _m4 = new THREE.Matrix4();

/**
 * Hinh vanh khan phu dung phan co noi dung cua lop, kem UV phang (anh xa toa do
 * mat phang sang texture y het mot PlaneGeometry). Dung hinh nay thay cho mot
 * hinh vuong day giup bo qua phan goc trong suot - o 1080p, bon lop cong lai
 * tiet kiem khoang mot nua so diem anh phai to.
 */
function annulusGeometry(inner, outer, extent, segments = 128) {
  const geo = new THREE.RingGeometry(Math.max(0, inner), outer, segments, 1);
  const pos = geo.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = (pos.getX(i) / extent + 1) / 2;
    uv[i * 2 + 1] = (pos.getY(i) / extent + 1) / 2;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

export class LayerStack {
  constructor(layerTextures) {
    this.group = new THREE.Group();
    this.items = [];
    // dung tu danh sach lop thay vi ghi cung id: id nao thieu o day se ra
    // undefined, va pivot.visible = undefined la vanh bien mat khong bao loi
    this.visibleMask = Object.fromEntries(layerTextures.map((lt) => [lt.id, true]));
    /** lop dang duoc tro / dang keo, de to sang vien */
    this.hoveredId = null;
    this.activeId = null;

    this.materials = [];

    for (const lt of layerTextures) {
      const mat = makeLayerMaterial(lt.mask, lt.wash);
      this.materials.push(mat);

      // phan co noi dung + dem cho quang sang toa ra
      const pad = lt.extent - lt.layer.outer;
      const geo = lt.layer.inner <= 0.001
        ? new THREE.PlaneGeometry(lt.extent * 2, lt.extent * 2, 1, 1)
        : annulusGeometry(lt.layer.inner - pad, lt.extent, lt.extent);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.renderOrder = 10;

      const pivot = new THREE.Group();
      pivot.add(mesh);

      // vanh gia khoi o mep trong va mep ngoai
      const rims = [];
      if (RIMS.enabled) {
        const rimColor = new THREE.Color(COLORS.core);
        for (const r of [lt.layer.inner, lt.layer.outer]) {
          if (r <= 0.001) continue;
          const rg = new THREE.TorusGeometry(r, RIMS.tube, 6, RIMS.segments);
          const rm = new THREE.MeshBasicMaterial({
            color: rimColor,
            transparent: true,
            opacity: RIMS.opacity,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            depthTest: false,
            toneMapped: false,
          });
          const rmesh = new THREE.Mesh(rg, rm);
          rmesh.renderOrder = 11;
          pivot.add(rmesh);
          rims.push(rm);
        }
      }

      this.group.add(pivot);
      this.items.push({ id: lt.id, pivot, mesh, mat, rims, layer: lt.layer });
    }
  }

  byId(id) {
    return this.items.find((i) => i.id === id);
  }

  setLayerVisible(id, v) {
    this.visibleMask[id] = v;
  }

  /**
   * @param {import('../anim/poses.js').PoseState} poses
   * @param {(id:string)=>number} opacityFor do mo cua net, do timeline hoac
   *   do "do khuay dong" cua vanh quyet dinh
   */
  update(poses, opacityFor) {
    for (const it of this.items) {
      it.pivot.quaternion.copy(poses.quaternion(it.id));

      it.pivot.visible = this.visibleMask[it.id];

      let opacity = opacityFor(it.id);
      // vanh dang duoc tro hoac dang keo thi sang hon mot chut
      if (it.id === this.activeId) opacity *= 1.35;
      else if (it.id === this.hoveredId) opacity *= 1.18;
      it.mat.uniforms.uOpacity.value = Math.min(1.6, opacity);

      const rimBoost = it.id === this.activeId ? 3.2 : it.id === this.hoveredId ? 2.0 : 1;
      for (const rm of it.rims) rm.opacity = Math.min(1, RIMS.opacity * rimBoost);
    }
  }

  /** ma tran xoay 3x3 cua tung lop, dung cho shader hat */
  writeRotationMatrices(poses, arr /* THREE.Matrix3[] */) {
    for (let i = 0; i < this.items.length; i++) {
      _m4.makeRotationFromQuaternion(poses.quaternion(this.items[i].id));
      arr[i].setFromMatrix4(_m4);
    }
  }

  /** Doi bang mau cho ca bon vanh, ngay luc chay */
  setColors(theme) {
    for (const m of this.materials) {
      m.uniforms.uCoreColor.value.copy(theme.core);
      m.uniforms.uGlowColor.value.copy(theme.glow);
      m.uniforms.uWashColor.value.copy(theme.wash);
    }
    for (const it of this.items) {
      for (const rm of it.rims) rm.color.copy(theme.core);
    }
  }

  /** Chinh do sang cua mot loai net cho ca bon vanh, ngay luc chay */
  setInkGain(kind, value) {
    const name = { line: 'uLineGain', text: 'uTextGain', star: 'uStarGain', wash: 'uWashGain' }[kind];
    if (!name) return;
    INK[kind] = value;
    for (const m of this.materials) m.uniforms[name].value = value;
  }

  dispose() {
    for (const it of this.items) {
      it.mesh.geometry.dispose();
      for (const t of it.mat.userData.textures) t.dispose();
      it.mat.dispose();
    }
  }
}
