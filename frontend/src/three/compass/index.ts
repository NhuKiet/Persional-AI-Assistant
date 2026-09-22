/** Cảnh 3D "La bàn thiên văn" cho trang chủ — bốn vành đồng tâm (chòm sao,
 *  lịch ngoài, 12 tháng, lõi Bắc Đẩu) vẽ bằng nét sáng trên nền tối, kèm bụi
 *  sao / khói bung ra theo chuyển động, bloom và một lớp vignette + grain.
 *
 *  Đây là lớp vỏ có kiểu thay cho `main.js` của project gốc: nó dựng cảnh, gắn
 *  điều khiển và chạy vòng lặp render, bỏ hẳn bảng điều khiển, lịch âm và chế
 *  độ phát animation. Xem [README.md](README.md) để biết file nào là vendor.
 *
 *  Hình dạng handle cố ý trùng với `createAtomReactor` (../atomReactor.ts) nên
 *  LandingPage đổi qua lại giữa hai cảnh chỉ bằng một dòng import. */
import * as THREE from "three";
import "@fontsource/noto-serif-sc/chinese-simplified-400.css";
import "@fontsource/noto-serif-sc/latin-400.css";

import { CAMERA, LAYERS, DUST, BLOOM, AUTO_SPIN } from "./config.js";
import { drawAllLayers } from "./textures/drawLayers.js";
import { LayerStack } from "./scene/layers.js";
import { StarField, SmokeField } from "./scene/particles.js";
import { buildComposer } from "./scene/post.js";
import { Controls } from "./scene/controls.js";
import { PoseState } from "./anim/poses.js";
import { AgitationState } from "./anim/agitation.js";
import { resolveTheme } from "./theme.js";

/** Bảng màu dùng cho trang chủ. Nền và mép vignette KHÔNG lấy từ bảng màu này
 *  — chúng do `backgroundColor` quyết định để khớp màu card của trang chủ. */
const THEME_ID = "luc";

/** Tư thế ban đầu của bốn vành, chọn trong `PRESETS` của config.js:
 *  `phang` (mọi vành trùng nhau, nhìn thẳng) · `nghieng` (tách lớp nhẹ, vẫn
 *  đọc được chữ Hán) · `cau` (các vành cắt nhau như armillary sphere) ·
 *  `det` (dẹt thành elip rất mảnh). Đổi một dòng này là đổi dáng trang chủ. */
const PRESET = "nghieng";

/** Mép khung tối hơn nền bao nhiêu (nhân vào từng kênh RGB). Bảng màu gốc
 *  dùng một màu vignette riêng; ở đây nền là màu của app nên suy ra cho khớp. */
const VIGNETTE_DARKEN = 0.45;

/** Bố cục theo bề rộng canvas (không phải viewport — canvas nằm trong card).
 *  `discFraction` = đường kính đĩa / cạnh NGẮN của canvas; `offsetX` = đẩy tâm
 *  đĩa sang phải, tính theo bề rộng canvas.
 *
 *  Các mốc bám theo breakpoint của landing.css, không phải mốc thiết bị quen
 *  thuộc: DƯỚI 721px canvas tụt xuống thành một dải riêng ở đáy card còn chữ
 *  nằm hẳn phía trên nó, nên đĩa để to và đúng tâm. TỪ 721px trở lên, khối
 *  chữ hero nằm đè lên canvas ở nửa trái — nét la bàn sáng và dày hơn lõi kim
 *  loại của cảnh cũ nhiều, chữ đặt lên là mất đọc — nên đĩa phải vừa nhỏ lại
 *  vừa dạt sang phải để chừa nửa trái làm nền trơn. Khoảng 721–1023px chật
 *  nhất: chữ gần như full-width nên đĩa co nhiều nhất ở đó. */
const LAYOUT = {
  wide:    { minWidth: 1280, discFraction: 0.74, offsetX: 0.17 },
  desktop: { minWidth: 1024, discFraction: 0.74, offsetX: 0.16 },
  tablet:  { minWidth: 721,  discFraction: 0.62, offsetX: 0.22 },
  mobile:  { minWidth: 0,    discFraction: 0.86, offsetX: 0 },
};

export interface CompassHandle {
  setBackgroundColor(hex: number): void;
  dispose(): void;
}

export interface CompassOptions {
  backgroundColor: number;
  onFail?: (err: unknown) => void;
}

/** Nạp font chữ Hán trước khi vẽ texture — canvas vẽ chữ bằng font đang có tại
 *  thời điểm gọi, nạp sau thì texture đã nướng xong với font dự phòng rồi. */
async function ensureFonts() {
  try {
    await document.fonts.load('400 64px "Noto Serif SC"',
      "正月二十八宿立春角亢氐房心尾箕子星紀寅析木");
    await document.fonts.ready;
  } catch (e) {
    console.warn("[compass] không nạp được Noto Serif SC, dùng serif hệ thống", e);
  }
}

export function createCompass(canvas: HTMLCanvasElement, opts: CompassOptions): CompassHandle {
  const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let disposed = false;
  let rafId = 0;
  let backgroundHex = opts.backgroundColor;

  let renderer: THREE.WebGLRenderer | null = null;
  let scene: THREE.Scene | null = null;
  let camera: THREE.PerspectiveCamera | null = null;
  let post: ReturnType<typeof buildComposer> | null = null;
  let stack: LayerStack | null = null;
  let stars: StarField | null = null;
  let smoke: SmokeField | null = null;
  let controls: Controls | null = null;
  let poses: PoseState | null = null;
  let agit: AgitationState | null = null;
  let resizeObserver: ResizeObserver | null = null;

  const rotArr = [new THREE.Matrix3(), new THREE.Matrix3(), new THREE.Matrix3(), new THREE.Matrix3()];

  /* Kích thước render = hộp CSS của chính canvas, không phải viewport: canvas
   * nằm trong card bo góc và ở mobile chỉ cao 62svh, lấy window.innerHeight sẽ
   * méo tỉ lệ. Chặn sàn ở 1 để WebGL không nhận framebuffer zero-size lúc
   * canvas chưa layout xong. */
  function getRenderSize() {
    return {
      width: Math.max(1, canvas.clientWidth || window.innerWidth),
      height: Math.max(1, canvas.clientHeight || window.innerHeight),
    };
  }

  /** FOV tính lại mỗi lần đổi kích thước sao cho ở khoảng cách mặc định, đĩa
   *  chiếm `discFraction` của cạnh NGẮN. Nhờ vậy khung dọc (điện thoại) không
   *  cắt mất hai bên đĩa. Phóng to / thu nhỏ vẫn là việc của khoảng cách
   *  camera (OrbitControls), không đụng tới FOV. */
  function fovFor(aspect: number, discFraction: number) {
    const halfShort = 1 / discFraction;
    const halfH = aspect >= 1 ? halfShort : halfShort / aspect;
    return 2 * Math.atan(halfH / CAMERA.distance) * (180 / Math.PI);
  }

  function layoutFor(width: number) {
    if (width >= LAYOUT.wide.minWidth) return LAYOUT.wide;
    if (width >= LAYOUT.desktop.minWidth) return LAYOUT.desktop;
    if (width >= LAYOUT.tablet.minWidth) return LAYOUT.tablet;
    return LAYOUT.mobile;
  }

  function applyBackground() {
    if (!scene || !renderer || !post) return;
    const bg = new THREE.Color(backgroundHex);
    scene.background = bg;
    renderer.setClearColor(bg, 1);
    post.grade.uniforms.uEdge.value.copy(bg).multiplyScalar(VIGNETTE_DARKEN);
  }

  function applyTheme() {
    if (!stack || !stars || !smoke) return;
    const th = resolveTheme(THEME_ID);
    stack.setColors(th);
    stars.setColor(th.star);
    smoke.setColor(th.smoke);
    applyBackground();
  }

  function resize() {
    if (!renderer || !camera) return;
    const { width, height } = getRenderSize();
    const L = layoutFor(width);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.fov = fovFor(camera.aspect, L.discFraction);
    // Đẩy đĩa sang phải bằng cách lệch khung nhìn trong một khung ảo rộng hơn,
    // thay vì dời camera hay dời cảnh: tâm quay của OrbitControls vẫn đúng là
    // tâm đĩa (dời camera sẽ khiến kéo xoay quét đĩa văng đi), và view offset
    // nằm trong projectionMatrix nên raycast chọn vành vẫn trúng.
    const shift = L.offsetX * width;
    if (shift !== 0) camera.setViewOffset(width, height, -shift, 0, width, height);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
    post?.setSize(width, height);
    const bufH = renderer.domElement.height;
    stars?.setProjection(camera, bufH);
    smoke?.setProjection(camera, bufH);
  }

  function render(dt: number) {
    if (!renderer || !post || !stack || !poses || !agit || !controls || !stars || !smoke) return;

    poses.step(dt, AUTO_SPIN.enabled && !prefersReduced);
    agit.update(dt, poses);
    controls.update();

    stack.hoveredId = controls.hover?.id ?? null;
    stack.update(poses, (id: string) => agit!.strokeOpacity(id));
    stack.writeRotationMatrices(poses, rotArr);

    // Bụi chỉ bung ra theo CHUYỂN ĐỘNG do người dùng kéo; vành tự quay nền
    // không tính là "khuấy động" nên lúc đứng yên hai hệ hạt tắt hẳn.
    for (const [field, amount] of [[stars, DUST.star], [smoke, DUST.smoke]] as const) {
      const u = field.uniforms;
      u.uTime.value += dt;
      for (let i = 0; i < 4; i++) {
        const id = LAYERS[i].id;
        u.uRot.value[i].copy(rotArr[i]);
        u.uDisperse.value[i] = agit.spread(id);
        u.uLayerAlpha.value[i] = agit.level(id);
      }
      u.uRise.value = 1;
      u.uOpacity.value = (agit.max() > 0.012 ? 1 : 0) * (prefersReduced ? 0 : amount);
      field.points.visible = u.uOpacity.value > 0.002;
    }

    post.grade.uniforms.uTime.value += dt;
    post.composer.render();
  }

  let last = performance.now();
  function loop(now: number) {
    if (disposed) return;
    rafId = requestAnimationFrame(loop);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    render(dt);
  }

  async function init() {
    await ensureFonts();
    if (disposed) return;

    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(45, 1, CAMERA.near, CAMERA.far);
    camera.position.set(0, 0, CAMERA.distance);

    const layerTextures = drawAllLayers();
    if (disposed) return;

    poses = new PoseState(PRESET);
    agit = new AgitationState(LAYERS.map((l) => l.id));

    stack = new LayerStack(layerTextures);
    scene.add(stack.group);

    smoke = new SmokeField(layerTextures);
    stars = new StarField(layerTextures);
    scene.add(smoke.points);
    scene.add(stars.points);

    const size = getRenderSize();
    renderer.setSize(size.width, size.height, false);
    post = buildComposer(renderer, scene, camera, {
      width: renderer.domElement.width,
      height: renderer.domElement.height,
    });
    post.bloom.strength = BLOOM.strength;

    // pan-y: vuốt dọc vẫn cuộn được trang trên mobile, chỉ vuốt ngang mới rơi
    // vào OrbitControls — nếu không, canvas nuốt trọn thao tác cuộn.
    canvas.style.touchAction = "pan-y";
    controls = new Controls(camera, canvas, stack, poses);
    controls.resetCamera(CAMERA.distance);

    resize();
    applyTheme();

    resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);

    last = performance.now();
    rafId = requestAnimationFrame(loop);
  }

  init().catch((err) => {
    console.error("[compass] dựng cảnh thất bại", err);
    opts.onFail?.(err);
  });

  return {
    setBackgroundColor(hex: number) {
      backgroundHex = hex;
      applyBackground();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(rafId);
      resizeObserver?.disconnect();
      controls?.dispose();
      stack?.dispose();
      stars?.dispose();
      smoke?.dispose();
      if (post) {
        for (const pass of post.composer.passes) pass.dispose?.();
        post.composer.dispose();
      }
      // dispose() một mình chỉ trả lại tài nguyên GPU, KHÔNG trả lại context.
      // Trang chủ mount/unmount nhiều lần (StrictMode ở dev, điều hướng
      // router ở prod) mà trình duyệt chỉ cho khoảng 16 context WebGL sống
      // cùng lúc — không buông thì context cũ nhất bị giết, canvas trắng.
      renderer?.forceContextLoss();
      renderer?.dispose();
      resizeObserver = null;
      controls = null;
      stack = null;
      stars = null;
      smoke = null;
      post = null;
      renderer = null;
      scene = null;
      camera = null;
    },
  };
}
