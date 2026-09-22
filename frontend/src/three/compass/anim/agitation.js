/**
 * Theo doi "do khuay dong" cua tung vanh trong che do tuong tac.
 *
 * Y tuong: bui khong phai la ham cua DO NGHIENG ma la ham cua CHUYEN DONG.
 * Vanh dung yen thi sach; vua keo la bung bui ra; buong tay thi dam bui con lai
 * tiep tuc tan rong ra roi mo dan het - giong rung mot vat de lau ngay.
 *
 * Moi vanh giu hai so:
 *   level  - bat len tuc thi theo toc do goc, tat cham theo hang so thoi gian
 *            (quyet dinh do dam cua bui)
 *   spread - luon TANG khi con bui, khong bao gio giat nguoc lai
 *            (quyet dinh bui da bay xa vi tri goc bao nhieu)
 *
 * Nho tach lam hai ma luc buong tay dam bui van tiep tuc no ra trong khi mo di,
 * thay vi bi hut nguoc ve vanh.
 */
import * as THREE from 'three';
import { AGITATION } from '../config.js';

const _q = new THREE.Quaternion();

class LayerAgitation {
  constructor() {
    this.prev = new THREE.Quaternion();
    this.hasPrev = false;
    this.level = 0;
    this.spread = 0;
  }
}

export class AgitationState {
  constructor(ids) {
    this.ids = ids;
    this.layers = {};
    for (const id of ids) this.layers[id] = new LayerAgitation();
  }

  /**
   * @param {number} dt giay
   * @param {import('./poses.js').PoseState} poses
   */
  update(dt, poses) {
    const step = Math.max(1e-4, dt);
    const release = Math.exp(-step / AGITATION.releaseSeconds);

    for (const id of this.ids) {
      const a = this.layers[id];
      _q.copy(poses.inputQuaternion(id));

      let speed = 0;
      if (a.hasPrev) {
        // goc giua hai huong lien tiep; dot am va duong la cung mot huong
        const dot = Math.min(1, Math.abs(a.prev.dot(_q)));
        speed = (2 * Math.acos(dot)) / step; // rad/giay
      }
      a.prev.copy(_q);
      a.hasPrev = true;

      const target = Math.min(1, speed / AGITATION.speedForFull);
      // bat tuc thi, tat cham
      a.level = Math.max(a.level * release, target);

      if (a.level > AGITATION.deadZone || a.spread > 0) {
        // bui da bay ra thi cu tiep tuc tan rong, ke ca khi da buong tay
        a.spread = Math.min(1, a.spread
          + step * AGITATION.expandRate * (AGITATION.idleExpand + a.level));
      }
      // het bui roi thi am tham dat lai, luc nay do mo da ve 0 nen khong thay
      if (a.level < AGITATION.deadZone && a.spread >= 1) a.spread = 0;
      if (a.level < AGITATION.deadZone * 0.2) {
        a.level = 0;
        if (a.spread > 0 && a.spread >= 1) a.spread = 0;
      }
    }
  }

  /** Do dam cua bui toa ra tu mot vanh, 0..1 */
  level(id) {
    return this.layers[id].level;
  }

  /** Bui cua vanh do da tan xa bao nhieu, 0..1 */
  spread(id) {
    return this.layers[id].spread;
  }

  max() {
    let m = 0;
    for (const id of this.ids) m = Math.max(m, this.layers[id].level);
    return m;
  }

  /** Net mo bot mot chut trong luc vanh dang toa bui */
  strokeOpacity(id) {
    return 1 - AGITATION.strokeFade * this.layers[id].level;
  }

  /** Dat lai het, dung khi chuyen che do */
  reset() {
    for (const id of this.ids) {
      const a = this.layers[id];
      a.level = 0;
      a.spread = 0;
      a.hasPrev = false;
    }
  }
}
