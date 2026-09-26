/**
 * Tim xem con tro dang o tren vanh nao, o nao.
 *
 * Moi lop la mot mat phang rieng trong khong gian; ban tia vao tung mat phang,
 * doi diem cham ve he toa do cuc BE MAT cua lop do, roi tra ve dai + chi so o.
 * Lop nao co diem cham nam trong vanh khan cua no va gan camera nhat thi thang.
 */
import * as THREE from 'three';
import { bandAt, cellIndexAt, cellLabel } from '../bands.js';

const _plane = new THREE.Plane();
const _normal = new THREE.Vector3();
const _hit = new THREE.Vector3();
const _local = new THREE.Vector3();
const _inv = new THREE.Matrix4();

/**
 * @param {THREE.Raycaster} raycaster da setFromCamera()
 * @param {{id:string, pivot:THREE.Object3D, layer:object}[]} items
 * @returns {null|{id, r, theta, band, cellIndex, label, point}}
 */
export function pickLayer(raycaster, items) {
  let best = null;

  for (const it of items) {
    if (!it.pivot.visible) continue;
    it.pivot.updateWorldMatrix(true, false);

    // mat phang cua lop trong khong gian the gioi
    _normal.set(0, 0, 1).applyQuaternion(it.pivot.getWorldQuaternion(new THREE.Quaternion()));
    _plane.setFromNormalAndCoplanarPoint(_normal, it.pivot.getWorldPosition(new THREE.Vector3()));

    if (!raycaster.ray.intersectPlane(_plane, _hit)) continue;

    _inv.copy(it.pivot.matrixWorld).invert();
    _local.copy(_hit).applyMatrix4(_inv);

    const r = Math.hypot(_local.x, _local.y);
    // Le 0.03 ngoai mep chi danh cho vanh ngoai cung (bat duoc ca quang sang).
    // Vanh ben trong ma cung duoc le nay thi no lan sang dai cua vanh ke ben va
    // cuop thao tac keo cua vanh do moi khi mat phang cua no gan camera hon.
    const slack = it.layer.outer >= 0.999 ? 0.03 : 0;
    if (r < it.layer.inner - 1e-4 || r > it.layer.outer + slack) continue;

    const dist = raycaster.ray.origin.distanceTo(_hit);
    if (best && dist >= best.dist) continue;

    // he toa do canvas co truc y huong xuong, nen goc doi dau
    const theta = Math.atan2(-_local.y, _local.x);
    best = { id: it.id, r, theta, dist, point: _hit.clone() };
  }

  if (!best) return null;

  const band = bandAt(best.r, best.id);
  if (!band) return null;
  const cellIndex = cellIndexAt(band, best.theta);
  return {
    ...best,
    band,
    cellIndex,
    label: cellIndex >= 0 ? cellLabel(band, cellIndex) : null,
  };
}
