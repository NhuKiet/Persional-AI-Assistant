/**
 * Trang thai tu the cua 4 vanh, do NGUOI DUNG lai (khong con timeline co dinh).
 *
 * Moi lop giu hai phan tach roi:
 *   tilt  - huong cua mat phang vanh, luu bang quaternion. Keo chuot se quay
 *           quanh truc PHAI / TREN cua camera, nen thao tac dung cam du camera
 *           dang o goc nao. Euler angles khong lam duoc viec nay.
 *   spin  - goc xoay quanh phap tuyen cua chinh vanh, luu bang so thuc de che do
 *           lich co the dat gia tri tuyet doi.
 * Quaternion cuoi cung = tilt * Rz(spin).
 *
 * Moi lop con co tu the "muc tieu" va tu the "hien tai"; hien tai chay ve muc
 * tieu voi giam chan nen keo chuot muot va chuyen preset la chuyen dong lien tuc.
 */
import * as THREE from 'three';
import { PRESETS, INTERACTION, LAYERS, AUTO_SPIN } from '../config.js';

const DEG = Math.PI / 180;
const AZ = new THREE.Vector3(0, 0, 1);
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _qc = new THREE.Quaternion();
const _n = new THREE.Vector3();

/** [tiltX, tiltY, roll] (do) -> quaternion Rz(roll)·Ry(tiltY)·Rx(tiltX) */
function tiltQuatFrom(tiltXDeg, tiltYDeg, rollDeg, out = new THREE.Quaternion()) {
  _qa.setFromAxisAngle(new THREE.Vector3(1, 0, 0), tiltXDeg * DEG);
  _qb.setFromAxisAngle(new THREE.Vector3(0, 1, 0), tiltYDeg * DEG);
  _qc.setFromAxisAngle(AZ, rollDeg * DEG);
  return out.copy(_qc).multiply(_qb).multiply(_qa);
}

class LayerPose {
  constructor(id) {
    this.id = id;
    this.tiltTarget = new THREE.Quaternion();
    this.tilt = new THREE.Quaternion();
    this.spinTarget = 0;
    this.spin = 0;
    /** spin do che do lich ap dat; null = nguoi dung tu do */
    this.calendarSpin = null;
    /** goc quay nen, cong don theo thoi gian, khong tinh la thao tac cua nguoi dung */
    this.autoSpin = 0;
    this.out = new THREE.Quaternion();
    this.outInput = new THREE.Quaternion();
  }

  /** Huong de VE: gom ca goc quay nen */
  quaternion() {
    _qa.setFromAxisAngle(AZ, this.spin + this.autoSpin);
    return this.out.copy(this.tilt).multiply(_qa);
  }

  /**
   * Huong chi do NGUOI DUNG dat ra, bo qua goc quay nen. Phan do "khuay dong"
   * doc cai nay, nho vay vanh tu quay deu khong bi coi la dang bi keo.
   */
  inputQuaternion() {
    _qa.setFromAxisAngle(AZ, this.spin);
    return this.outInput.copy(this.tilt).multiply(_qa);
  }

  /** Goc giua phap tuyen vanh va truc nhin, 0 = nam phang */
  tiltAngle() {
    _n.set(0, 0, 1).applyQuaternion(this.tilt);
    return Math.acos(Math.min(1, Math.abs(_n.z)));
  }
}

export class PoseState {
  constructor(presetName) {
    this.layers = {};
    this.order = LAYERS.map((l) => l.id);
    for (const id of this.order) this.layers[id] = new LayerPose(id);
    this.presetName = null;
    this.applyPreset(presetName, true);
  }

  /** @param {boolean} immediate bo qua giam chan, dat thang vao vi tri */
  applyPreset(name, immediate = false) {
    const preset = PRESETS[name];
    if (!preset) return;
    this.presetName = name;
    for (const id of this.order) {
      const [tx, ty, roll, spin] = preset.pose[id];
      const L = this.layers[id];
      tiltQuatFrom(tx, ty, roll, L.tiltTarget);
      L.spinTarget = (L.calendarSpin ?? spin * DEG);
      if (immediate) {
        L.tilt.copy(L.tiltTarget);
        L.spin = L.spinTarget;
      }
    }
  }

  /** Dua mot lop ve mat phang (giu nguyen spin cua che do lich neu dang bat) */
  resetLayer(id) {
    const L = this.layers[id];
    if (!L) return;
    L.tiltTarget.identity();
    L.spinTarget = L.calendarSpin ?? 0;
    this.presetName = null;
  }

  resetAll() {
    for (const id of this.order) this.resetLayer(id);
    this.presetName = 'phang';
  }

  /**
   * Keo mot vanh: quay quanh mot truc trong khong gian the gioi (thuong la truc
   * phai / tren cua camera), nhan TRUOC nen doc lap voi huong hien tai cua vanh.
   */
  rotateAboutWorldAxis(id, axis, angle) {
    const L = this.layers[id];
    if (!L) return;
    _qa.setFromAxisAngle(axis, angle);
    L.tiltTarget.premultiply(_qa).normalize();
    this.presetName = null;
  }

  /** Xoay quanh phap tuyen cua chinh vanh */
  addSpin(id, angle) {
    const L = this.layers[id];
    if (!L || L.calendarSpin !== null) return;
    L.spinTarget += angle;
    this.presetName = null;
  }

  /** Che do lich: ap spin cho tat ca cac vanh (null = tat, tra lai cho nguoi dung) */
  setCalendarSpin(spin) {
    for (const id of this.order) {
      const L = this.layers[id];
      L.calendarSpin = spin;
      if (spin !== null) {
        // chon vong quay ngan nhat de vanh khong quay nhieu vong
        const k = Math.round((L.spin - spin) / (Math.PI * 2));
        L.spinTarget = spin + k * Math.PI * 2;
      }
    }
  }

  get calendarLocked() {
    return this.layers[this.order[0]].calendarSpin !== null;
  }

  /**
   * Ghi thang mot tu the tu timeline (bo qua giam chan) - dung cho che do
   * "Phat animation" de khung hinh tai giay t luon giong het nhau.
   * @param {{tiltX,tiltY,roll,spin}} pose goc tinh bang DO
   */
  setFromTimeline(id, pose) {
    const L = this.layers[id];
    if (!L) return;
    tiltQuatFrom(pose.tiltX, pose.tiltY, pose.roll, L.tiltTarget);
    L.tilt.copy(L.tiltTarget);
    L.spinTarget = pose.spin * DEG;
    L.spin = L.spinTarget;
    this.presetName = null;
  }

  /**
   * Tien mot buoc giam chan; goi moi khung hinh.
   * @param {boolean} autoSpin co chay goc quay nen khong (tat o che do lich va
   *   che do phat animation vi hai che do do dat spin theo gia tri tuyet doi)
   */
  step(dt, autoSpin = false) {
    const k = 1 - Math.pow(1 - INTERACTION.poseDamping, Math.max(0.1, dt * 60));
    for (const id of this.order) {
      const L = this.layers[id];
      L.tilt.slerp(L.tiltTarget, k);
      L.spin += (L.spinTarget - L.spin) * k;
      if (autoSpin) {
        L.autoSpin = (L.autoSpin + (AUTO_SPIN.speeds[id] ?? 0) * DEG * dt) % (Math.PI * 2);
      }
    }
  }

  quaternion(id) {
    return this.layers[id].quaternion();
  }

  inputQuaternion(id) {
    return this.layers[id].inputQuaternion();
  }

  /** Dua goc quay nen ve 0, dung khi chuyen sang che do lich / animation */
  clearAutoSpin() {
    for (const id of this.order) this.layers[id].autoSpin = 0;
  }

}
