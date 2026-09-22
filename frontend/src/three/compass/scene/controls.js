/**
 * Dieu khien chuot / cham:
 *   - keo tren MOT VANH   -> xoay rieng vanh do
 *   - keo ngoai dia hoac giu Alt / chuot phai -> xoay camera quanh tam
 *   - lan chuot            -> phong to thu nho
 *   - Shift + keo tren vanh -> xoay vanh quanh phap tuyen cua no
 *
 * Vanh duoc xoay quanh truc PHAI / TREN cua camera, nen huong keo luon khop voi
 * huong nhin du camera dang o dau.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { INTERACTION } from '../config.js';
import { pickLayer } from './picking.js';

const DEG = Math.PI / 180;

export class Controls {
  /**
   * @param {THREE.Camera} camera
   * @param {HTMLElement} dom
   * @param {import('./layers.js').LayerStack} stack
   * @param {import('../anim/poses.js').PoseState} poses
   */
  constructor(camera, dom, stack, poses, handlers = {}) {
    this.camera = camera;
    this.dom = dom;
    this.stack = stack;
    this.poses = poses;
    this.handlers = handlers;
    this.enabled = true;
    /** true = moi thao tac keo deu xoay camera */
    this.orbitOnly = false;

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.lastClient = new THREE.Vector2();
    this.dragging = null; // { id, sx, sy, shift }
    this.hover = null;

    this.orbit = new OrbitControls(camera, dom);
    this.orbit.enablePan = false;
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = INTERACTION.orbitDamping;
    this.orbit.minDistance = INTERACTION.minDistance;
    this.orbit.maxDistance = INTERACTION.maxDistance;
    this.orbit.rotateSpeed = 0.75;
    this.orbit.zoomSpeed = 0.9;
    this.orbit.target.set(0, 0, 0);

    this._onDown = this.onPointerDown.bind(this);
    this._onMove = this.onPointerMove.bind(this);
    this._onUp = this.onPointerUp.bind(this);
    this._onLeave = this.onPointerLeave.bind(this);

    dom.addEventListener('pointerdown', this._onDown);
    window.addEventListener('pointermove', this._onMove);
    window.addEventListener('pointerup', this._onUp);
    dom.addEventListener('pointerleave', this._onLeave);
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  dispose() {
    this.dom.removeEventListener('pointerdown', this._onDown);
    window.removeEventListener('pointermove', this._onMove);
    window.removeEventListener('pointerup', this._onUp);
    this.dom.removeEventListener('pointerleave', this._onLeave);
    this.orbit.dispose();
  }

  updatePointer(e) {
    const r = this.dom.getBoundingClientRect();
    this.pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    this.pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    this.lastClient.set(e.clientX, e.clientY);
  }

  pick(e) {
    this.updatePointer(e);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return pickLayer(this.raycaster, this.stack.items);
  }

  onPointerDown(e) {
    if (!this.enabled) return;
    const wantOrbit = this.orbitOnly || e.button === 2 || e.altKey;
    const hit = wantOrbit ? null : this.pick(e);

    if (hit) {
      this.dragging = { id: hit.id, shift: e.shiftKey, moved: false };
      this.stack.activeId = hit.id;
      this.orbit.enabled = false;
      this.dom.style.cursor = 'grabbing';
      this.handlers.onGrab?.(hit);
    } else {
      this.orbit.enabled = true;
    }
  }

  onPointerMove(e) {
    if (!this.enabled) return;

    if (this.dragging) {
      const dx = e.clientX - this.lastClient.x;
      const dy = e.clientY - this.lastClient.y;
      this.lastClient.set(e.clientX, e.clientY);
      if (dx || dy) this.dragging.moved = true;

      if (this.dragging.shift || e.shiftKey) {
        this.poses.addSpin(this.dragging.id, dx * INTERACTION.spinDegPerPx * DEG);
      } else {
        // truc phai / tren cua camera trong khong gian the gioi
        const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
        const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
        this.poses.rotateAboutWorldAxis(this.dragging.id, up, dx * INTERACTION.dragDegPerPx * DEG);
        this.poses.rotateAboutWorldAxis(this.dragging.id, right, dy * INTERACTION.dragDegPerPx * DEG);
      }
      this.handlers.onDrag?.(this.dragging.id);
      return;
    }

    const hit = this.pick(e);
    const id = hit ? hit.id : null;
    this.stack.hoveredId = id;
    this.dom.style.cursor = id ? 'grab' : 'default';
    this.hover = hit;
    this.handlers.onHover?.(hit, e);
  }

  onPointerUp() {
    if (this.dragging) {
      this.handlers.onRelease?.(this.dragging.id, this.dragging.moved);
      this.dragging = null;
      this.stack.activeId = null;
      this.dom.style.cursor = this.hover ? 'grab' : 'default';
    }
    this.orbit.enabled = true;
  }

  onPointerLeave() {
    if (this.dragging) return;
    this.stack.hoveredId = null;
    this.hover = null;
    this.handlers.onHover?.(null);
  }

  /** Dua camera ve vi tri ban dau */
  resetCamera(distance) {
    this.camera.position.set(0, 0, distance);
    this.orbit.target.set(0, 0, 0);
    this.orbit.update();
  }

  update() {
    this.orbit.update();
  }
}
