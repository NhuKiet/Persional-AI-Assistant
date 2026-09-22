/**
 * Cac dau hieu ve chong len mat dia:
 *   - o dang tro chuot sang len (mot hinh quat vanh khan)
 *   - o ung voi tiet khi / thang / tu hien tai khi bat che do lich
 *   - kim Mat Trang tren vanh 28 tu
 *   - kim chi co dinh o dinh khung (vi tri Mat Troi)
 *
 * Cac dau hieu thuoc ve mot vanh se duoc gan vao pivot cua vanh do, nen chung
 * tu dong xoay theo khi nguoi dung keo vanh - khong can tinh lai goc.
 */
import * as THREE from 'three';
import { MARKERS } from '../config.js';
import { cellStartAngle } from '../bands.js';

/** Doi goc canvas -> goc the gioi (truc y cua canvas huong xuong) */
const worldAngle = (thetaCanvas) => -thetaCanvas;

function sectorMaterial(color, opacity) {
  return new THREE.MeshBasicMaterial({
    color: new THREE.Color(color),
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}

/** Mot hinh quat vanh khan bam vao dung mot o */
export class CellHighlight {
  constructor(color = MARKERS.highlightColor, opacity = MARKERS.highlightAlpha) {
    this.material = sectorMaterial(color, opacity);
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
    this.mesh.renderOrder = 12;
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    this.key = null;
  }

  /** @param {object} band @param {number} i @param {THREE.Object3D} pivot */
  show(band, i, pivot) {
    const key = `${band.id}:${i}`;
    if (this.key !== key || this.mesh.parent !== pivot) {
      const step = (Math.PI * 2) / band.count;
      const start = worldAngle(cellStartAngle(band, i)) - step; // y lat dau => tru mot buoc
      const rIn = band.drawIn ?? band.rIn;
      const rOut = band.drawOut ?? band.rOut;
      const pad = Math.max(0.006, (rOut - rIn) * 0.12);
      this.mesh.geometry.dispose();
      this.mesh.geometry = new THREE.RingGeometry(
        Math.max(0.001, rIn - pad), rOut + pad, 48, 1, start, step,
      );
      if (pivot && this.mesh.parent !== pivot) pivot.add(this.mesh);
      this.key = key;
    }
    this.mesh.visible = true;
  }

  hide() {
    this.mesh.visible = false;
  }

  setColor(color) {
    this.material.color.copy(color);
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

/** Kim chi theo phuong ban kinh, gan vao mot vanh */
export class Needle {
  constructor(color, rIn, rOut, width = MARKERS.needleWidth) {
    this.rIn = rIn;
    this.rOut = rOut;
    const geo = new THREE.PlaneGeometry(rOut - rIn, width);
    geo.translate((rIn + rOut) / 2, 0, 0); // goc quay o tam dia
    this.material = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color),
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.renderOrder = 13;
    this.mesh.frustumCulled = false;

    // dau kim: mot cham sang
    const head = new THREE.Mesh(
      new THREE.CircleGeometry(width * 2.2, 16),
      this.material,
    );
    head.position.x = rOut;
    head.renderOrder = 13;
    this.mesh.add(head);
  }

  setColor(color) {
    this.material.color.copy(color);
  }

  /** @param {number} thetaCanvas goc canvas (radian) */
  setAngle(thetaCanvas) {
    this.mesh.rotation.z = worldAngle(thetaCanvas);
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

/** Kim chi co dinh o dinh khung, khong xoay theo vanh nao */
export function buildTopIndex(radius = 1.05) {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(MARKERS.indexColor),
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });

  const shape = new THREE.Shape();
  const w = 0.028;
  const h = 0.075;
  shape.moveTo(0, radius - h);
  shape.lineTo(-w, radius + h * 0.35);
  shape.lineTo(w, radius + h * 0.35);
  shape.closePath();

  const tri = new THREE.Mesh(new THREE.ShapeGeometry(shape), mat);
  tri.renderOrder = 14;
  tri.frustumCulled = false;
  g.add(tri);
  g.userData.material = mat;
  return g;
}
