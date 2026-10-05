/** Nền "hố đen + sao" cho các trang làm việc (chat, research, PDF, công thức).
 *
 *  Lớp vỏ có kiểu thay cho `main.js` của project gốc `ho-den`: dựng hai lớp
 *  (sao nền, lõi hố đen ray-march), chạy vòng lặp render và neo tâm hố vào một
 *  điểm trên canvas. Bỏ hẳn tấm công thức, bảng điều khiển, kéo / giữ / lăn
 *  chuột và chuỗi hậu kỳ (bloom / grain) — đây là NỀN nằm sau giao diện kính,
 *  không phải cảnh để chơi. Tương tác duy nhất còn giữ là thấu kính hấp dẫn
 *  quanh con trỏ (cả khung hình — hố, đĩa, sao — bị bẻ cong quanh nó), bật / tắt
 *  được bằng setLens. Xem [README.md](README.md) để biết file nào là vendor.
 *
 *  Chi phí: lượt ray-march là phần nặng (240 bước RK4 mỗi điểm ảnh trong hộp
 *  bao quanh hố). Vì là nền nên chạy tối đa 30 khung/giây, dừng khi tab ẩn, và
 *  lúc khởi động đo thời gian GPU thật của vài khung để hạ độ phân giải của
 *  lượt ray-march cho vừa ngân sách (máy chỉ có GPU tích hợp là chuyện thường:
 *  trình duyệt hay chọn nó dù đã xin `high-performance`). */
import * as THREE from "three";

import { BH, LENS, LOOP_SEC, MIN_VISIBLE_W, REF_H } from "./config.js";
import { commonUniforms } from "./glsl/common.js";
import { createStars } from "./layers/stars.js";
import { createBlackHole } from "./layers/blackhole.js";

/** Trần devicePixelRatio. Sao chỉ là các chấm Gauss và lõi hố đen đã tự tính ở
 *  độ phân giải thấp hơn, nên vượt 1.5 chỉ tốn fill-rate mà không nét thêm. */
const MAX_DPR = 1.5;

/** Khoảng cách tối thiểu giữa hai khung (ms) — trần 30 khung/giây. Vân đĩa trôi
 *  chỉ ~5 px/giây nên 30 hay 60 khung nhìn như nhau, mà GPU nhàn gấp đôi. */
const FRAME_MS = 1000 / 30 - 2;

/** Các bậc chất lượng của lượt ray-march (nhân vào tỉ lệ phân giải). Chỉ hạ,
 *  không nâng lại: nền nhấp nháy đổi độ nét qua lại còn khó chịu hơn hơi mềm. */
const QUALITY_STEPS = [1, 0.75, 0.55, 0.4, 0.3];
/** Ngân sách GPU cho một khung nền (ms). Ở 30 khung/giây, 12 ms nghĩa là nền
 *  chiếm khoảng một phần ba GPU, phần còn lại cho giao diện kính (backdrop-filter
 *  cũng tốn GPU) và cuộn. */
const BUDGET_MS = 12;
/** Mỗi lần đo: bỏ khung đầu (biên dịch shader / cấp lại render target), lấy
 *  trung vị của số khung này. */
const CALIBRATION_FRAMES = 3;

export interface BlackHoleHandle {
  /** Đặt tâm bóng hố đen vào điểm (x, y), tính bằng px CSS từ góc trên-trái
   *  canvas, và cho cỡ hố co giãn theo một khung w × h (px CSS) — thường là vùng
   *  nội dung, hẹp hơn canvas vì canvas còn phủ cả phía sau sidebar. */
  setAnchor(x: number, y: number, w: number, h: number): void;
  /** Bật / tắt thấu kính quanh con trỏ vẽ ngay trong canvas (chỉ bẻ cong nền).
   *  Mặc định tắt. Trình duyệt nào bẻ cong được cả giao diện bằng bộ lọc SVG thì
   *  dùng cách đó thay cho cái này — xem useCursorLens trong BlackHoleBackdrop. */
  setLens(on: boolean): void;
  dispose(): void;
}

export interface BlackHoleOptions {
  onFail?: (err: unknown) => void;
}

export function createBlackHoleBackdrop(canvas: HTMLCanvasElement, opts: BlackHoleOptions = {}): BlackHoleHandle {
  const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: "high-performance" });
  } catch (err) {
    opts.onFail?.(err);
    return { setAnchor() {}, setLens() {}, dispose() {} };
  }
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace; // shader xuất thẳng giá trị hiển thị 0–1
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setClearColor(0x000000, 1);

  const uniforms = commonUniforms();
  uniforms.uLoop.value = LOOP_SEC;

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const stars = createStars(uniforms);
  const core = createBlackHole(uniforms);
  // Bản gốc làm mờ dải trước / chân phải cung trên để nhường chỗ cho quạt công
  // thức; ở đây không có tấm công thức nên hố đen hiện nguyên vẹn.
  core.material.uniforms.uTone.value.w = 0;
  scene.add(stars.object, core.object);

  let disposed = false;
  let rafId = 0;
  let quality = 0;
  // tâm hố theo tỉ lệ canvas cho tới khi phía gọi đặt neo thật
  let anchor: [number, number, number, number] | null = null;
  let dirty = true;
  let sizeKey = "";

  function layout() {
    const w = Math.max(1, canvas.clientWidth);
    const h = Math.max(1, canvas.clientHeight);
    // đổi kích thước canvas là đổi số điểm ảnh phải ray-march → đo lại (dời neo thì không)
    if (sizeKey !== `${w}x${h}`) { sizeKey = `${w}x${h}`; startCalibration(); }
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    const W = Math.round(w * dpr);
    const H = Math.round(h * dpr);
    // cỡ hố theo KHUNG NEO chứ không theo canvas: khung hẹp (sidebar mở, cửa sổ
    // nhỏ) thì bề ngang quyết định, khung rộng thì bề cao quyết định
    const [ax, ay, fw, fh] = anchor ?? [w / 2, h / 2, w, h];
    const scale = Math.min(fh / REF_H, fw / MIN_VISIBLE_W) * dpr;
    const ox = ax * dpr - BH.center[0] * scale;
    const oy = ay * dpr - BH.center[1] * scale;
    uniforms.uViewport.value.set(W, H);
    warpTarget.setSize(W, H);
    uniforms.uScale.value = scale;
    uniforms.uOrigin.value.set(ox, oy);
    // BH.resScale độ phân giải canvas, nhưng không dưới ~576 dòng (khung nhỏ:
    // vòng photon và vòng dưới mảnh) — rồi nhân bậc chất lượng hiện tại
    const k = Math.min(1, Math.max(BH.resScale, (BH.resRefMul * scale * REF_H) / H) * QUALITY_STEPS[quality]);
    core.setSize(W, H, scale, ox, oy, k);
    dirty = true;
  }

  // Thấu kính con trỏ: cảnh vẽ vào một render target rồi lượt cuối lấy mẫu lại
  // với phương trình thấu kính β = θ − θE²·θ / (|θ|² + mềm²) — điểm ảnh ở θ nhìn
  // thấy nguồn ở β. Chỉ chạy khi thấu kính đang bật; tắt thì vẽ thẳng ra canvas.
  const warpTarget = new THREE.WebGLRenderTarget(2, 2, { depthBuffer: false });
  const warpMaterial = new THREE.ShaderMaterial({
    uniforms: {
      tScene: { value: warpTarget.texture },
      uViewport: uniforms.uViewport,
      uLensPx: { value: new THREE.Vector2() },            // con trỏ, px bộ đệm, y hướng xuống
      uLensShape: { value: new THREE.Vector3(1, 1, 0) },   // bán kính Einstein, làm mềm (px bộ đệm), 0..1
    },
    vertexShader: "void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }",
    fragmentShader: /* glsl */ `
      uniform sampler2D tScene;
      uniform vec2 uViewport;
      uniform vec2 uLensPx;
      uniform vec3 uLensShape;
      void main() {
        vec2 p = vec2(gl_FragCoord.x, uViewport.y - gl_FragCoord.y);
        vec2 d = p - uLensPx;
        vec2 src = p - uLensShape.x * uLensShape.x * uLensShape.z * d / (dot(d, d) + uLensShape.y * uLensShape.y);
        gl_FragColor = texture2D(tScene, vec2(src.x, uViewport.y - src.y) / uViewport);
      }
    `,
    depthTest: false,
    depthWrite: false,
  });
  const warpQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), warpMaterial);
  warpQuad.frustumCulled = false;
  const warpScene = new THREE.Scene();
  warpScene.add(warpQuad);

  function renderFrame(seconds: number) {
    const t = ((seconds % LOOP_SEC) + LOOP_SEC) % LOOP_SEC;
    uniforms.uTime.value = t;
    uniforms.uClock.value = t;
    core.setTime(t, 0);
    core.render(renderer, camera);
    if (warpMaterial.uniforms.uLensShape.value.z > 0) {
      renderer.setRenderTarget(warpTarget);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      renderer.render(warpScene, camera);
    } else {
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
    }
    dirty = false;
  }

  let lastRender = -Infinity;

  // Con trỏ. Canvas nằm sau giao diện và không nhận chuột (pointer-events:
  // none), nên nghe trên window.
  let lensEnabled = false;
  let pointer: [number, number] | null = null;
  let lensOn = 0;
  const onPointerMove = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    pointer = [e.clientX - r.left, e.clientY - r.top];
  };
  const onPointerGone = () => { pointer = null; };
  if (!prefersReduced) {
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onPointerGone);
    window.addEventListener("blur", onPointerGone);
  }
  function updateLens(dt: number) {
    const want = lensEnabled && pointer ? 1 : 0;
    lensOn += (want - lensOn) * (1 - Math.exp(-dt / LENS.easeSec));
    if (lensOn < 1e-3 && !want) lensOn = 0;
    const dpr = renderer.getPixelRatio();
    const s = uniforms.uScale.value;
    if (pointer) warpMaterial.uniforms.uLensPx.value.set(pointer[0] * dpr, pointer[1] * dpr);
    warpMaterial.uniforms.uLensShape.value.set(LENS.radius * s, LENS.soft * s, lensOn);
  }

  /** Đo thời gian GPU thật của một khung: readPixels 1 điểm ảnh buộc trình
   *  duyệt chờ GPU vẽ xong. (Không đo bằng nhịp rAF — tab nền hay khung nhúng
   *  bị trình duyệt bóp rAF sẽ trông y như máy chậm.) Chỉ đo vài khung sau khi
   *  dựng / đổi kích thước rồi thôi, vì readPixels đồng bộ làm khựng luồng chính. */
  const pixel = new Uint8Array(4);
  let samples: number[] | null = null;
  let skipSample = true;
  function calibrate(seconds: number) {
    const gl = renderer.getContext();
    const t0 = performance.now();
    renderFrame(seconds);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    const ms = performance.now() - t0;
    if (skipSample) { skipSample = false; return; }
    samples!.push(ms);
    if (samples!.length < CALIBRATION_FRAMES) return;
    const median = samples!.sort((a, b) => a - b)[CALIBRATION_FRAMES >> 1];
    canvas.dataset.frameMs = median.toFixed(1);
    canvas.dataset.quality = String(QUALITY_STEPS[quality]);
    if (median > BUDGET_MS && quality < QUALITY_STEPS.length - 1) {
      quality++;
      layout();
      startCalibration();
    } else samples = null;
  }
  function startCalibration() {
    if (prefersReduced) return; // chỉ vẽ một khung tĩnh, không cần đo
    samples = [];
    skipSample = true;
  }

  function loop(now: number) {
    if (disposed) return;
    rafId = requestAnimationFrame(loop);
    if (document.hidden) return;
    if (prefersReduced) {
      if (dirty) renderFrame(0);
      return;
    }
    if (now - lastRender < FRAME_MS) return;
    updateLens(Math.min(0.1, (now - lastRender) / 1000));
    lastRender = now;
    if (samples) calibrate(now / 1000);
    else renderFrame(now / 1000);
  }

  const resizeObserver = new ResizeObserver(layout);
  resizeObserver.observe(canvas);

  try {
    layout();
    renderFrame(0); // biên dịch shader + khung đầu trước khi phía gọi cho canvas hiện
  } catch (err) {
    opts.onFail?.(err);
  }
  rafId = requestAnimationFrame(loop);

  return {
    setAnchor(x, y, w, h) {
      const next: [number, number, number, number] = [x, y, Math.max(1, w), Math.max(1, h)];
      if (anchor && next.every((v, i) => Math.abs(anchor![i] - v) < 0.5)) return;
      anchor = next;
      layout();
    },
    setLens(on) { lensEnabled = on; },
    dispose() {
      disposed = true;
      window.removeEventListener("pointermove", onPointerMove);
      document.documentElement.removeEventListener("pointerleave", onPointerGone);
      window.removeEventListener("blur", onPointerGone);
      cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      stars.object.geometry.dispose();
      stars.material.dispose();
      core.material.dispose();
      core.composeMaterial.dispose();
      warpTarget.dispose();
      warpMaterial.dispose();
      warpQuad.geometry.dispose();
      renderer.dispose();
    },
  };
}
