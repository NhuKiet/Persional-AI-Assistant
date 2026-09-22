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

import { CAMERA, LAYERS, AUTO_SPIN, DEFAULT_PRESET, RINGS } from "./config.js";
import { drawAllLayers } from "./textures/drawLayers.js";
import { LayerStack } from "./scene/layers.js";
import { StarField, SmokeField } from "./scene/particles.js";
import { buildComposer } from "./scene/post.js";
import { Controls } from "./scene/controls.js";
import { PoseState } from "./anim/poses.js";
import { AgitationState } from "./anim/agitation.js";
import { CellHighlight, Needle, buildTopIndex } from "./scene/markers.js";
import { calendarFor } from "./astro/calendar.js";
import { BAND_BY_ID } from "./bands.js";
import { resolveTheme, DEFAULT_THEME } from "./theme.js";

/** Tư thế ban đầu của bốn vành: mặc định của project gốc (`nghieng` — tách
 *  lớp nhẹ, vẫn đọc được chữ Hán). Các lựa chọn khác trong `PRESETS` của
 *  config.js: `phang` (mọi vành trùng nhau), `cau` (các vành cắt nhau như
 *  armillary sphere), `det` (dẹt thành elip mảnh). */
const PRESET = DEFAULT_PRESET;

/** Bảng màu và các mức hiệu chỉnh, CHÉP LẠI ĐÚNG bộ mà người dùng đã dò trên
 *  bảng điều khiển của project gốc — không phải mặc định của config.js. Trang
 *  chủ không có bảng điều khiển nên đây là nơi duy nhất chỉnh được.
 *
 *  Tên các mức khớp nhãn trong bảng điều khiển gốc, kèm dải giá trị của nó:
 *  Sắc độ −180…180 · Đậm nhạt 0…2 · Nét vẽ/Chữ Hán/Chấm sao 0…4 ·
 *  Lớp phủ 0…2 · Hạt sao/Khói bụi 0…2.5 · Quầng sáng 0…1.5.
 *
 *  Lưu ý: bộ số này được dò trên NỀN ĐEN #171412 của project gốc, còn ở đây
 *  nền là card rêu ô liu sáng hơn nhiều, nên cùng một mức độ sáng sẽ đọc ra
 *  "cháy" hơn. Nếu thấy chói thì hạ `ink` xuống chứ đừng đổi nền — nền phải
 *  trùng --atom-bg của landing.css. */
const THEME_ID = DEFAULT_THEME;      // 'vang' — Vàng kem
const TUNING = {
  hueDeg: 20,                        // Sắc độ  (mặc định 0)
  sat: 2.0,                          // Đậm nhạt (mặc định 1)
  ink: {
    line: 4.0,                       // Nét vẽ   (mặc định 1)
    text: 4.0,                       // Chữ Hán  (mặc định 1)
    star: 4.0,                       // Chấm sao (mặc định 1)
    wash: 2.0,                       // Lớp phủ  (mặc định 1)
  },
  dust: {
    star: 2.20,                      // Hạt sao  (mặc định 1)
    smoke: 2.18,                     // Khói bụi (mặc định 1)
  },
  bloom: 0.28,                       // Quầng sáng — đúng bằng BLOOM.strength gốc
};

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

/** Vành nào được phép tự quay khi lớp lịch đang bật.
 *
 *  Bản gốc khoá CẢ BỐN vành theo vị trí Mặt Trời và tắt hẳn vành tự quay, vì
 *  ở chế độ lịch góc xoay mang nghĩa tuyệt đối. Nhưng chỉ L1 (tiết khí + 28 tú
 *  + kim Mặt Trăng) và L2 (12 tháng) mới mang dấu lịch; L0 (chòm sao) và L3
 *  (lõi Bắc Đẩu) thì không, nên để hai vành đó quay tiếp — trang chủ giữ được
 *  chuyển động nền, mà phần tra ngày vẫn đọc đúng. Vành sao quay trên mặt đĩa
 *  đứng yên cũng chính là cách một chiếc astrolabe thật hoạt động. */
const SPINNING_LAYERS = ["L0", "L3"] as const;

/** Bao lâu tính lại lịch một lần (ms). Kinh độ Mặt Trời nhích ~1°/ngày nên
 *  mười phút là thừa mịn; để lâu hơn thì tab mở qua đêm sẽ lệch ngày. */
const CALENDAR_REFRESH_MS = 10 * 60 * 1000;

/** Sau khi người dùng buông tay bao lâu thì các vành tự về nếp (giây), và tốc
 *  độ camera bò về chỗ cũ. Trang chủ không có nút "về mức chuẩn" như bản gốc,
 *  nên nếu không tự về thì một khách vãng lai kéo rối tung là nó nằm rối luôn
 *  cho tới khi tải lại trang. Nhấp đúp để về ngay, không phải chờ. */
const SETTLE_AFTER_SECONDS = 4;
const CAMERA_SETTLE_RATE = 1.8;

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
  // jsdom (vitest) không có document.fonts — không chặn, cũng không kêu ca:
  // mọi bài test dựng LandingPage đều đi qua đây.
  if (!document.fonts) return;
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

  // Lớp lịch: ô tiết khí / tháng / tú đang tra, kim Mặt Trăng (gắn vào vành
  // nên tự xoay theo khi kéo) và kim chỉ cố định ở đỉnh khung = vị trí Mặt Trời.
  let termHL: CellHighlight | null = null;
  let monthHL: CellHighlight | null = null;
  let lodgeHL: CellHighlight | null = null;
  let hoverHL: CellHighlight | null = null;
  let moonNeedle: Needle | null = null;
  let topIndex: THREE.Group | null = null;
  let calendarAt = 0;

  // Tự về nếp: mốc thời gian lần tương tác cuối, và vị trí camera ban đầu.
  let lastTouchAt = performance.now();
  let settling = false;
  const cameraHome = new THREE.Vector3(0, 0, CAMERA.distance);

  const ORIGIN = new THREE.Vector3(0, 0, 0);
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
    // resolveTheme nhận sắc độ theo VÒNG (−0.5…0.5), bảng điều khiển gốc thì
    // hiển thị theo độ — chia 360 đúng như uiHandlers.onHue() của main.js.
    const th = resolveTheme(THEME_ID, TUNING.hueDeg / 360, TUNING.sat);
    stack.setColors(th);
    stars.setColor(th.star);
    smoke.setColor(th.smoke);
    for (const kind of ["line", "text", "star", "wash"] as const) {
      stack.setInkGain(kind, TUNING.ink[kind]);
    }
    // Dấu lịch: ô tiết khí/tháng và kim chỉ đỉnh dùng màu `marker` (sáng hơn
    // lõi nét một chút), còn kim Mặt Trăng dùng `moon` — sắc độ đối nghịch,
    // cố ý tách hẳn khỏi màu đĩa để không lẫn vào nét.
    termHL?.setColor(th.marker);
    monthHL?.setColor(th.marker);
    hoverHL?.setColor(th.marker);
    lodgeHL?.setColor(th.moon);
    moonNeedle?.setColor(th.moon);
    if (topIndex) topIndex.userData.material.color.copy(th.marker);
    applyBackground();
  }

  /** Pivot của một vành. `LayerStack.byId` dùng Array.find nên TS suy ra kiểu
   *  có thể undefined; ở đây id luôn là một trong bốn vành đã dựng sẵn. */
  function pivotOf(id: string): THREE.Object3D {
    return stack!.byId(id)!.pivot;
  }

  function buildMarkers() {
    if (!scene || !stack) return;
    hoverHL = new CellHighlight(undefined, 0.30);
    termHL = new CellHighlight("#FFD98A", 0.26);
    monthHL = new CellHighlight("#FFD98A", 0.20);
    lodgeHL = new CellHighlight("#BFD8FF", 0.26);

    moonNeedle = new Needle("#BFD8FF", RINGS.C14 - 0.02, RINGS.lodgeOut + 0.012);
    pivotOf("L1").add(moonNeedle.mesh);

    topIndex = buildTopIndex(1.06);
    scene.add(topIndex);
  }

  /** Khoá vành lịch theo ngày giờ hiện tại và đặt lại các dấu tra cứu. */
  function applyCalendar() {
    if (!stack || !poses || !moonNeedle) return;
    const cal = calendarFor(new Date());
    calendarAt = performance.now();

    // Khoá spin tuyệt đối cho cả bốn vành rồi trả tự do lại cho hai vành không
    // mang dấu lịch — setCalendarSpin() của bản gốc không nhận từng vành riêng.
    poses.setCalendarSpin(cal.plateSpin);
    const layers = poses.layers as Record<string, { calendarSpin: number | null; autoSpin: number }>;
    for (const id of SPINNING_LAYERS) layers[id].calendarSpin = null;

    moonNeedle.setAngle(cal.moonTheta);
    termHL?.show(BAND_BY_ID.terms, cal.termIndex, pivotOf("L1"));
    monthHL?.show(BAND_BY_ID.months, cal.monthIndex, pivotOf("L2"));
    lodgeHL?.show(BAND_BY_ID.lodges, cal.lodgeIndex, pivotOf("L1"));
  }

  /** Người dùng vừa chạm vào cảnh — hoãn việc tự về nếp. */
  function touch() {
    lastTouchAt = performance.now();
    settling = false;
  }

  /** Đưa các vành về đúng tư thế ban đầu; camera bò về theo trong render(). */
  function settleNow() {
    if (!poses) return;
    poses.applyPreset(PRESET);
    settling = true;
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

    // step() chỉ biết bật/tắt tự quay cho CẢ BỐN vành, nên gọi với false rồi
    // tự cộng góc quay nền cho riêng hai vành không mang dấu lịch.
    poses.step(dt, false);
    if (AUTO_SPIN.enabled && !prefersReduced) {
      const layers = poses.layers as Record<string, { autoSpin: number }>;
      for (const id of SPINNING_LAYERS) {
        const speed = (AUTO_SPIN.speeds[id] ?? 0) * (Math.PI / 180);
        layers[id].autoSpin = (layers[id].autoSpin + speed * dt) % (Math.PI * 2);
      }
    }
    agit.update(dt, poses);

    // Buông tay đủ lâu thì các vành tự trở về tư thế ban đầu và camera bò về
    // chỗ cũ. OrbitControls đọc lại camera.position trong update() nên chỉnh
    // thẳng vị trí ở đây là hợp lệ, miễn là update() chạy ngay sau.
    const idle = (performance.now() - lastTouchAt) / 1000;
    if (!settling && idle > SETTLE_AFTER_SECONDS) settleNow();
    if (settling) {
      const k = 1 - Math.exp(-CAMERA_SETTLE_RATE * dt);
      camera!.position.lerp(cameraHome, k);
      controls.orbit.target.lerp(ORIGIN, k);
    }
    controls.update();

    if (performance.now() - calendarAt > CALENDAR_REFRESH_MS) applyCalendar();

    stack.hoveredId = controls.hover?.id ?? null;
    stack.update(poses, (id: string) => agit!.strokeOpacity(id));
    stack.writeRotationMatrices(poses, rotArr);

    // Bụi chỉ bung ra theo CHUYỂN ĐỘNG do người dùng kéo; vành tự quay nền
    // không tính là "khuấy động" nên lúc đứng yên hai hệ hạt tắt hẳn.
    for (const [field, amount] of [[stars, TUNING.dust.star], [smoke, TUNING.dust.smoke]] as const) {
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
    post.bloom.strength = TUNING.bloom;

    // pan-y: vuốt dọc vẫn cuộn được trang trên mobile, chỉ vuốt ngang mới rơi
    // vào OrbitControls — nếu không, canvas nuốt trọn thao tác cuộn.
    canvas.style.touchAction = "pan-y";
    controls = new Controls(camera, canvas, stack, poses, {
      onHover(hit: { id: string; band?: unknown; cellIndex: number } | null) {
        const band = hit?.band as { count?: number } | undefined;
        if (!hit || !band || hit.cellIndex < 0 || !band.count) hoverHL?.hide();
        else hoverHL?.show(band, hit.cellIndex, pivotOf(hit.id));
      },
      onGrab: touch,
      onDrag: touch,
      onRelease: touch,
    });
    controls.resetCamera(CAMERA.distance);
    canvas.addEventListener("pointerdown", touch);
    canvas.addEventListener("wheel", touch, { passive: true });
    canvas.addEventListener("dblclick", settleNow);

    buildMarkers();
    applyCalendar();

    resize();
    applyTheme();

    resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    lastTouchAt = performance.now();

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
      canvas.removeEventListener("pointerdown", touch);
      canvas.removeEventListener("wheel", touch);
      canvas.removeEventListener("dblclick", settleNow);
      controls?.dispose();
      for (const m of [termHL, monthHL, lodgeHL, hoverHL, moonNeedle]) m?.dispose();
      if (topIndex) {
        topIndex.userData.material.dispose();
        (topIndex.children[0] as THREE.Mesh).geometry.dispose();
      }
      stack?.dispose();
      stars?.dispose();
      smoke?.dispose();
      if (post) {
        for (const pass of post.composer.passes) pass.dispose?.();
        post.composer.dispose();
      }
      // KHÔNG gọi forceContextLoss() ở đây: thẻ <canvas> là của React, không
      // phải của renderer, và React dùng lại đúng node đó khi remount
      // (StrictMode ở dev, điều hướng router ở prod). Đã ép mất context thì
      // canvas đó chết hẳn, lần mount sau getContext() trả null và cảnh rơi
      // về quả cầu dự phòng. dispose() trả lại tài nguyên GPU là đủ; context
      // tự được thu hồi khi renderer không còn ai tham chiếu.
      renderer?.dispose();
      resizeObserver = null;
      termHL = monthHL = lodgeHL = hoverHL = null;
      moonNeedle = null;
      topIndex = null;
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
