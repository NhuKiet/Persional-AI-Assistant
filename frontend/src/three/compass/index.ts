/** Cảnh 3D "La bàn thiên văn" cho trang chủ — sáu vành đồng tâm (chòm sao,
 *  28 tú, 24 tiết khí, thước độ, 12 tháng, lõi Bắc Đẩu) vẽ bằng nét sáng trên
 *  nền tối, kèm bụi sao / khói bung ra theo chuyển động, bloom và một lớp
 *  vignette + grain. Bản gốc có bốn vành; ba vành giữa là vành "lịch ngoài"
 *  của bản gốc được tách ra — xem LAYERS trong config.js.
 *
 *  Đây là lớp vỏ có kiểu thay cho `main.js` của project gốc: nó dựng cảnh, gắn
 *  điều khiển, chạy vòng lặp render và khoá lớp lịch vào ngày hôm nay; bỏ hẳn
 *  bảng điều khiển và chế độ phát animation 14 giây.
 *  Xem [README.md](README.md) để biết file nào là vendor.
 *
 *  Hình dạng handle cố ý trùng với `createAtomReactor` (../atomReactor.ts) nên
 *  LandingPage đổi qua lại giữa hai cảnh chỉ bằng một dòng import. */
import * as THREE from "three";
import "@fontsource/noto-serif-sc/chinese-simplified-400.css";
import "@fontsource/noto-serif-sc/latin-400.css";

import { CAMERA, LAYERS, AUTO_SPIN, RINGS } from "./config.js";
import { drawAllLayers } from "./textures/drawLayers.js";
import { LayerStack } from "./scene/layers.js";
import { StarField, SmokeField } from "./scene/particles.js";
import { buildComposer } from "./scene/post.js";
import { Controls } from "./scene/controls.js";
import { PoseState } from "./anim/poses.js";
import { AgitationState } from "./anim/agitation.js";
import { CellHighlight, Needle } from "./scene/markers.js";
import { calendarFor } from "./astro/calendar.js";
import { BAND_BY_ID, cellLabel } from "./bands.js";
import { resolveTheme, DEFAULT_THEME } from "./theme.js";

/** Tư thế ban đầu của các vành — và cũng là tư thế các vành tự về sau khi
 *  người dùng buông tay (settleNow). `phang`: mọi vành nằm trên một mặt phẳng,
 *  nhìn thẳng, đọc được trọn chữ Hán quanh đĩa; các vành vẫn tự quay ngược
 *  chiều nhau trong mặt phẳng đó. Người dùng chọn kiểu này thay cho mặc định
 *  của project gốc (DEFAULT_PRESET = `nghieng`, các vành nghiêng lệch nhau).
 *  Các lựa chọn khác trong `PRESETS` của config.js: `nghieng`, `cau` (các vành
 *  cắt nhau như armillary sphere), `det` (dẹt thành elip mảnh). */
const PRESET = "phang";

/** Bảng màu và các mức hiệu chỉnh, CHÉP LẠI ĐÚNG bộ mà người dùng đã dò trên
 *  bảng điều khiển của project gốc — không phải mặc định của config.js. Trang
 *  chủ không có bảng điều khiển nên đây là nơi duy nhất chỉnh được.
 *
 *  Tên các mức khớp nhãn trong bảng điều khiển gốc, kèm dải giá trị của nó:
 *  Sắc độ −180…180 · Đậm nhạt 0…2 · Nét vẽ/Chữ Hán/Chấm sao 0…4 ·
 *  Lớp phủ 0…2 · Hạt sao/Khói bụi 0…2.5 · Quầng sáng 0…1.5.
 *
 *  Lưu ý: bộ số này được dò trên NỀN ĐEN #171412 của project gốc. Nền khung la
 *  bàn giờ là xám khói #2a2629 (bảng "Ember Mist"), sáng hơn nền gốc một chút
 *  nên nét có thể đọc ra hơi đậm hơn lúc dò. Nếu thấy chói thì hạ
 *  `ink` xuống chứ đừng đổi nền — nền phải trùng --atom-bg của landing.css. */
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

  /** Độ đậm của các ô sáng tra cứu. Bản gốc để 0.20–0.30 vì nét ở mức chuẩn
   *  1.0; ở đây nét kịch 4.0 nên ô mờ chìm nghỉm trong chính nền nét. Nâng
   *  lên khoảng gấp đôi là đọc được mà chưa thành mảng bệt — không nâng theo
   *  đúng tỉ lệ 4× của nét, vì ô là hình quạt ĐẶC cộng thêm (additive), đậm
   *  gấp bốn thì nó nuốt luôn chữ Hán nằm dưới. */
  highlight: {
    term: 0.55,                      // ô tiết khí (vành L1b)
    month: 0.45,                     // ô tháng kiến (vành L2)
    lodge: 0.55,                     // ô 28 tú Mặt Trăng đang ở (vành L1a)
    hover: 0.60,                     // ô dưới con trỏ
  },
};

/** Mép khung tối hơn nền bao nhiêu (nhân vào từng kênh RGB). Bảng màu gốc
 *  dùng một màu vignette riêng; ở đây nền là màu của app nên suy ra cho khớp. */
const VIGNETTE_DARKEN = 0.45;

/** Đường kính đĩa / cạnh NGẮN của canvas. La bàn có khung riêng ở khu dưới
 *  trang chủ, không chữ nào đè lên, nên đĩa luôn đúng tâm ở mọi khổ. (Khi còn
 *  làm nền toàn trang, đĩa phải co nhỏ và dạt sang phải bằng setViewOffset để
 *  chừa chỗ cho khối chữ hero — xem lịch sử git nếu cần dựng lại kiểu đó.) */
const DISC_FRACTION = 0.86;

/** Kim Mặt Trời: một kim bán kính vắt ngang vành 24 tiết khí (L1b), cùng kiểu
 *  với kim Mặt Trăng trên vành 28 tú.
 *
 *  Bản gốc ghim kim này CỐ ĐỊNH ở đỉnh khung rồi xoay cả đĩa sao cho vị trí
 *  Mặt Trời trồi lên đúng dưới nó — nghĩa là muốn giữ kim đứng yên thì mặt
 *  đĩa phải đứng yên, và mọi vành mất luôn chuyển động nền. Ở đây làm ngược
 *  lại: gắn kim vào chính vành tiết khí và xoay nó tới góc của Mặt Trời, nên
 *  kim bám đúng ô tiết khí hiện tại dù vành xoay tới đâu.
 *
 *  Trước khi tách vành, kim là một tam giác ở 0.84R, ngay ngoài mép vành lịch
 *  cũ. Giờ vành tiết khí chỉ rộng 0.600–0.667R và tự nghiêng riêng: tam giác
 *  treo ở 0.84R sẽ lơ lửng trên hai vành khác đang quay theo nhịp khác, nhìn
 *  như rơi ra khỏi vành của nó — nên thu vào nằm ngay trên vành. */
const SUN_NEEDLE = { rIn: RINGS.C11 - 0.012, rOut: RINGS.C13a + 0.012 };

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

/** Số liệu lịch để trang chủ in thành chữ. Mỗi mục là cặp [chữ Hán, tiếng
 *  Việt] đúng như nhãn vẽ trên vành, để dòng đọc số và mặt đĩa luôn khớp nhau. */
export interface CompassReadout {
  date: Date;
  /** kinh độ hoàng đạo của Mặt Trời, độ */
  sunLon: number;
  term: [string, string];
  month: [string, string];
  /** tú Mặt Trăng đang ở; phần "· Huyền Vũ" đã tách ra `lodgeQuadrant` */
  lodge: [string, string];
  lodgeQuadrant: string;
  phaseName: string;
  /** tỉ lệ diện tích sáng, 0…1 */
  illumination: number;
  /** tuổi trăng, ngày kể từ sóc */
  moonAge: number;
}

export interface CompassOptions {
  backgroundColor: number;
  onFail?: (err: unknown) => void;
  /** Gọi mỗi lần lịch được tính lại (lúc dựng cảnh, rồi mỗi CALENDAR_REFRESH_MS). */
  onCalendar?: (readout: CompassReadout) => void;
}

/** `cellLabel` trả về ["牛", "Ngưu · Huyền Vũ"] — tách tên tú khỏi tên cung. */
function splitLabel(raw: [string, string] | null): { pair: [string, string]; rest: string } {
  const [han, vi] = raw ?? ["", ""];
  const [name, ...rest] = vi.split(" · ");
  return { pair: [han, name], rest: rest.join(" · ") };
}

function toReadout(cal: ReturnType<typeof calendarFor>): CompassReadout {
  const lodge = splitLabel(cellLabel(BAND_BY_ID.lodges, cal.lodgeIndex));
  return {
    date: cal.date,
    sunLon: cal.sunLon,
    term: splitLabel(cellLabel(BAND_BY_ID.terms, cal.termIndex)).pair,
    month: splitLabel(cellLabel(BAND_BY_ID.months, cal.monthIndex)).pair,
    lodge: lodge.pair,
    lodgeQuadrant: lodge.rest,
    phaseName: cal.phaseName,
    illumination: cal.phase.illumination,
    moonAge: cal.phase.age,
  };
}

/** Số liệu lịch cho một thời điểm — thuần tính toán, KHÔNG cần WebGL. Trang
 *  chủ gọi thẳng hàm này cho thẻ lịch, thay vì chờ `onCalendar`: nhờ vậy thẻ
 *  có dữ liệu ngay lúc dựng trang (cảnh 3D phải nạp font và nướng texture mất
 *  một hai giây, thẻ hiện muộn là đẩy lệch cả bố cục), và vẫn có dữ liệu trên
 *  máy không dựng được cảnh 3D. Cùng nguồn nhãn với mặt đĩa nên luôn khớp. */
export function readCalendar(date: Date = new Date()): CompassReadout {
  return toReadout(calendarFor(date));
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
  let visibilityObserver: IntersectionObserver | null = null;
  let onScreen = true;

  // Lớp lịch: ô tiết khí / tháng / tú đang tra, kim Mặt Trời và kim Mặt Trăng
  // (gắn vào vành của mình nên tự xoay theo khi vành quay hay bị kéo).
  let termHL: CellHighlight | null = null;
  let monthHL: CellHighlight | null = null;
  let lodgeHL: CellHighlight | null = null;
  let hoverHL: CellHighlight | null = null;
  let moonNeedle: Needle | null = null;
  let sunNeedle: Needle | null = null;
  let calendarAt = 0;

  // Tự về nếp: mốc thời gian lần tương tác cuối, và vị trí camera ban đầu.
  let lastTouchAt = performance.now();
  let settling = false;
  const cameraHome = new THREE.Vector3(0, 0, CAMERA.distance);

  const ORIGIN = new THREE.Vector3(0, 0, 0);
  const rotArr = LAYERS.map(() => new THREE.Matrix3());

  /* Kích thước render = hộp CSS của chính canvas, không phải viewport: canvas
   * nằm trong một khung riêng giữa trang, lấy window.innerHeight sẽ méo tỉ lệ.
   * Chặn sàn ở 1 để WebGL không nhận framebuffer zero-size lúc canvas chưa
   * layout xong. */
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
    sunNeedle?.setColor(th.marker);
    applyBackground();
  }

  /** Pivot của một vành. `LayerStack.byId` dùng Array.find nên TS suy ra kiểu
   *  có thể undefined; ở đây id luôn là một trong các vành đã dựng sẵn. */
  function pivotOf(id: string): THREE.Object3D {
    return stack!.byId(id)!.pivot;
  }

  function buildMarkers() {
    if (!scene || !stack) return;
    hoverHL = new CellHighlight(undefined, TUNING.highlight.hover);
    termHL = new CellHighlight("#FFD98A", TUNING.highlight.term);
    monthHL = new CellHighlight("#FFD98A", TUNING.highlight.month);
    lodgeHL = new CellHighlight("#BFD8FF", TUNING.highlight.lodge);

    // Gắn vào pivot của vành, không phải vào scene: kim phải nghiêng và xoay
    // y hệt vành mà nó đang chỉ vào.
    moonNeedle = new Needle("#BFD8FF", RINGS.C14 - 0.02, RINGS.lodgeOut + 0.012);
    pivotOf("L1a").add(moonNeedle.mesh);

    sunNeedle = new Needle("#FFD98A", SUN_NEEDLE.rIn, SUN_NEEDLE.rOut);
    pivotOf("L1b").add(sunNeedle.mesh);
  }

  /** Khoá vành lịch theo ngày giờ hiện tại và đặt lại các dấu tra cứu. */
  function applyCalendar() {
    if (!stack || !poses || !moonNeedle || !sunNeedle) return;
    const cal = calendarFor(new Date());
    calendarAt = performance.now();

    // KHÔNG gọi poses.setCalendarSpin(): không vành nào bị khoá, tất cả cùng
    // tự quay. Các dấu lịch đều gắn vào pivot của vành nên chúng xoay theo và
    // vẫn chỉ đúng ô của mình.
    //
    // `plateSpin = π/2 + θ` với θ là góc canvas của Mặt Trời trên vành tiết khí
    // (spinToTop trong astro/calendar.js — góc bản gốc xoay đĩa đi để đưa Mặt
    // Trời lên đỉnh), nên θ = plateSpin − π/2. Kiểm lại được: nếu vành đang ở
    // spin = plateSpin (đúng trạng thái khoá của bản gốc) thì kim chỉ thẳng
    // lên đỉnh khung — khớp y hệt hành vi cũ.
    sunNeedle.setAngle(cal.plateSpin - Math.PI / 2);

    moonNeedle.setAngle(cal.moonTheta);

    opts.onCalendar?.(toReadout(cal));
    termHL?.show(BAND_BY_ID.terms, cal.termIndex, pivotOf("L1b"));
    monthHL?.show(BAND_BY_ID.months, cal.monthIndex, pivotOf("L2"));
    lodgeHL?.show(BAND_BY_ID.lodges, cal.lodgeIndex, pivotOf("L1a"));
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
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.fov = fovFor(camera.aspect, DISC_FRACTION);
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
      for (let i = 0; i < LAYERS.length; i++) {
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
    // Đĩa đã cuộn khỏi màn hình: bỏ qua cả cập nhật lẫn vẽ. La bàn giờ nằm ở
    // khu dưới trang chủ, phần lớn thời gian người xem đang đọc phía trên nó.
    if (!onScreen) return;
    render(dt);
  }

  /** Trang chủ cuộn dọc và la bàn nằm giữa trang: để OrbitControls nuốt mọi
   *  cú lăn chuột thì người đang cuộn trang sẽ bị "kẹt" ngay khi con trỏ lướt
   *  qua đĩa — trang đứng im, đĩa phóng to. Chỉ phóng khi giữ Ctrl/⌘ (chụm hai
   *  ngón trên trackpad cũng phát ra wheel kèm ctrlKey, nên vẫn chụm được).
   *  Chặn ở pha capture của window để sự kiện không tới được canvas; không
   *  preventDefault nên trang vẫn cuộn như thường. */
  function onWheelCapture(e: WheelEvent) {
    if (e.target === canvas && !e.ctrlKey && !e.metaKey) e.stopPropagation();
  }
  window.addEventListener("wheel", onWheelCapture, { capture: true, passive: true });

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
    if (typeof IntersectionObserver !== "undefined") {
      visibilityObserver = new IntersectionObserver(([entry]) => { onScreen = entry.isIntersecting; });
      visibilityObserver.observe(canvas);
    }
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
      visibilityObserver?.disconnect();
      window.removeEventListener("wheel", onWheelCapture, { capture: true });
      canvas.removeEventListener("pointerdown", touch);
      canvas.removeEventListener("wheel", touch);
      canvas.removeEventListener("dblclick", settleNow);
      controls?.dispose();
      for (const m of [termHL, monthHL, lodgeHL, hoverHL, moonNeedle, sunNeedle]) m?.dispose();
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
      visibilityObserver = null;
      termHL = monthHL = lodgeHL = hoverHL = null;
      moonNeedle = sunNeedle = null;
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
