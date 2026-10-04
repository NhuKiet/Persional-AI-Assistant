/**
 * Lớp hố đen (hoden_final/DAC_TA_LOI_HO_DEN_BAN_CUOI.md, mục 6): ray-march tia sáng bẻ cong Schwarzschild (RK4 trên
 * d²x/dλ² = −1.5·h²·x/|x|⁵) qua một đĩa khí dày phát xạ + hấp thụ, có nhiễu fbm uốn lượn (domain warp) và cụm bụi.
 * Mã tham chiếu: hoden_final/tools/volrender.py (mô hình), tone.py (tone + bảng màu).
 *
 * Các lượt:
 *   1. march  → (L0 = 1 − e^(−exposure·I), sợi mờ ngoài, bầu trời còn lọt qua) ở BH.resScale độ phân giải
 *   2. quầng σ = 0.6R, bloom σ = 0.08R và 0.4R (Gauss tách 2 chiều)
 *   3. ghép: L^0.85 → LUT (amber / silver) + sợi mờ + vòng photon mảnh (độ phân giải đầy đủ), blend "screen"
 * Ở chế độ so ảnh (?ref_frame=1) toạ độ là px canvas 665×361, không nghiêng, nền (31,32,34).
 */
import {
  Mesh, PlaneGeometry, ShaderMaterial, Scene, WebGLRenderTarget, HalfFloatType, LinearFilter, RGBAFormat,
  Data3DTexture, DataTexture, RepeatWrapping, ClampToEdgeWrapping, UnsignedByteType, Vector2, Vector3, Vector4,
  CustomBlending, AddEquation, OneFactor, OneMinusSrcColorFactor, ZeroFactor,
} from 'three';
import { BH, LUT_AMBER, LUT_SILVER, LOOP_SEC } from '../config.js';
import { COMMON } from '../glsl/common.js';

const VERT = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function noise3D(w, h, d, seed) {
  const r = rng(seed);
  const data = new Uint8Array(w * h * d * 4);
  for (let i = 0; i < data.length; i++) data[i] = Math.floor(r() * 256);
  const t = new Data3DTexture(data, w, h, d);
  t.format = RGBAFormat;
  t.type = UnsignedByteType;
  t.minFilter = LinearFilter;
  t.magFilter = LinearFilter;
  t.wrapS = t.wrapT = t.wrapR = RepeatWrapping;
  t.unpackAlignment = 1;
  t.needsUpdate = true;
  return t;
}

/** bảng màu 256×1 từ các mốc (độ sáng → RGB), nội suy tuyến tính như np.interp */
function lutTexture(lut) {
  const data = new Uint8Array(256 * 4);
  for (let l = 0; l < 256; l++) {
    let j = 0;
    while (j < lut.length - 2 && lut[j + 1][0] < l) j++;
    const [l0, c0] = lut[j];
    const [l1, c1] = lut[Math.min(j + 1, lut.length - 1)];
    const f = l1 > l0 ? Math.min(1, Math.max(0, (l - l0) / (l1 - l0))) : 0;
    for (let k = 0; k < 3; k++) data[l * 4 + k] = Math.round(c0[k] + (c1[k] - c0[k]) * f);
    data[l * 4 + 3] = 255;
  }
  const t = new DataTexture(data, 256, 1, RGBAFormat, UnsignedByteType);
  t.minFilter = LinearFilter;
  t.magFilter = LinearFilter;
  t.wrapS = t.wrapT = ClampToEdgeWrapping;
  t.needsUpdate = true;
  return t;
}

const MARCH = /* glsl */ `
precision highp float;
precision highp sampler3D;
${COMMON}
uniform sampler3D uNA;       // fbm: 4 quãng tám ở 4 kênh; trục y = góc quanh đĩa, tuần hoàn 16 ô
uniform sampler3D uNB;       // r: cụm/bụi, g: warp; trục y tuần hoàn 8 ô
uniform vec3 uNASize;
uniform vec3 uNBSize;
uniform vec2 uBHC;           // tâm bóng (px khung tham chiếu; chế độ so ảnh: px canvas)
uniform float uBHR;          // R (px)
uniform float uBHTilt;       // rad
uniform float uPix;          // tan(góc bóng) / R
uniform vec3 uCam;
uniform vec3 uFwd;
uniform vec3 uUp;
uniform float uD;
uniform vec4 uDisk1;         // r_in, r_out, r_fade, q_emis
uniform vec4 uDisk2;         // S_floor, hz0, hz, contrast
uniform vec4 uDisk3;         // clump_amp, underside_gain, kappa, kappa_dust
uniform vec4 uDisk4;         // dust_thresh, wisp_r0, wisp_amp, warp_amp
uniform vec4 uDisk5;         // k_lnr, số ô góc, k_z, clump_k
uniform vec4 uTone;          // exposure, wisp_gain, Ω0 (rad/s), 1 = làm mờ chỗ nối quạt
uniform vec3 uFadeK;         // dải trước: k bắt đầu mờ, k còn a, a
uniform vec3 uArcFadeK;      // chân phải cung trên: góc φ còn a, góc φ đủ sáng, a
uniform vec2 uArcFadeV;      // v: không / hẳn dùng hệ số của cung
uniform float uRefMode;
uniform float uBHTime;       // giây trong vòng lặp
uniform float uBHSurge;      // nhấn giữ: sáng hơn
uniform float uXfade;        // giây trộn chéo cuối vòng lặp
uniform vec2 uBox;           // |k|, |v| tối đa (×R) còn cần ray-march
uniform float uStepIn;       // bước trong lớp đĩa đặc (r_s)
varying vec2 vUv;

#define MAX_STEPS ${BH.maxSteps}

vec4 nA(vec3 c) {             // nội suy mượt (f²(3−2f)) bằng lấy mẫu tuyến tính của phần cứng
  vec3 i = floor(c); vec3 f = fract(c); f = f * f * (3.0 - 2.0 * f);
  return texture(uNA, (i + f + 0.5) / uNASize);
}
vec4 nB(vec3 c) {
  vec3 i = floor(c); vec3 f = fract(c); f = f * f * (3.0 - 2.0 * f);
  return texture(uNB, (i + f + 0.5) / uNBSize);
}

// Nửa sau đĩa quanh φ = 90° bị thấu kính kéo thành cả cung trên (và vòng dưới): cung 120° chỉ ứng với ~±3.5° góc
// của đĩa. Vân thường (16 ô/vòng) gần như đều trong khoảng đó nên đĩa quay mà cung trông đứng yên. Thêm một quãng
// vân mịn theo góc (uFar.x ô/vòng) chỉ ở nửa sau, quay chậm riêng (uFar.z × tốc độ đĩa) để cung có vân chạy rõ.
uniform vec4 uFar;           // số ô/vòng, trọng số, hệ số tốc độ, dấu quay khi nhìn mặt dưới (vòng dưới)
uniform float uFarUnder;     // hệ số trọng số khi nhìn mặt dưới
uniform float uBandWarp;     // độ uốn miền của kết cấu dải trước (ô)
uniform vec4 uBand;          // dải trước: ô / r_s dọc dải (x của đĩa), ô / R theo v của điểm ảnh, độ mạnh, tốc độ trôi (r_s / giây)
float farOct(float lnr, float phiRot, float zs) {
  float u = phiRot / TAU;
  return nA(vec3(lnr * uDisk5.x * 0.5 + 211.0, u * uFar.x, zs * uDisk5.z + 9.0)).r;
}

// vân + cụm ở một pha quay; trả (fbm, cụm)
vec2 texPhase(float lnr, float phiRot, float zs) {
  float u = phiRot / TAU;                               // 1 vòng = 1
  float wn = nB(vec3(lnr * 5.0 + 17.0, u * 8.0, zs * 0.7 + 3.0)).g;
  float lw = lnr + uDisk4.w * (wn - 0.5);
  float x = lw * uDisk5.x;
  float y = u * uDisk5.y;
  float z = zs * uDisk5.z;
  float s = nA(vec3(x, y, z)).r
          + 0.55 * nA(vec3(2.0 * x + 31.0, 2.0 * y, 2.0 * z + 5.0)).g
          + 0.3025 * nA(vec3(4.0 * x + 67.0, 4.0 * y, 4.0 * z + 11.0)).b
          + 0.166375 * nA(vec3(8.0 * x + 101.0, 8.0 * y, 8.0 * z + 7.0)).a;
  s /= 2.018875;
  float cl = nB(vec3(lnr * uDisk5.w, u * 8.0, zs)).r;
  return vec2(s, cl);
}

vec3 acc(vec3 x, float h2) {
  float r2 = dot(x, x);
  return -1.5 * h2 * x / (r2 * r2 * sqrt(r2));
}

void main() {
  vec2 p = uRefMode > 0.5 ? refPos() : scenePos(refPos());
  vec2 d = p - uBHC;
  float c = cos(uBHTilt), s = sin(uBHTilt);
  float k = dot(d, vec2(c, -s)) / uBHR;     // dọc trục dải (phải +)
  float v = dot(d, vec2(s, c)) / uBHR;      // vuông góc (xuống +)
  vec3 dir = normalize(uFwd + (k * uBHR * uPix) * vec3(1.0, 0.0, 0.0) + (-v * uBHR * uPix) * uUp);
  // ngoài hộp bao của đĩa + cung + vòng dưới (theo R): tia chỉ thấy trời, khỏi ray-march
  if (abs(v) > uBox.y || abs(k) > uBox.x) { gl_FragColor = vec4(0.0, 0.0, 1.0, 1.0); return; }

  vec3 pos = uCam;
  vec3 vel = dir;
  vec3 hc = cross(pos, vel);
  float h2 = dot(hc, hc);
  float I = 0.0, Iw = 0.0, T = 1.0;
  float captured = 0.0;
  float rIn = uDisk1.x, rOut = uDisk1.y, rFade = uDisk1.z;
  float t1 = uBHTime, t2 = uBHTime - uLoop;
  // trộn chéo chỉ trong uXfade giây cuối vòng lặp (vẫn liền khít ở 10 s → 0 s). Trộn suốt vòng (trọng số t/10) làm
  // độ sáng đổi liên tục cỡ ngang chuyển động thật → optical flow giữa 2 khung gần nhau bị nhiễu hướng
  float w = smoothstep(uLoop - uXfade, uLoop, uBHTime);
  float wa = 1.0 - w;
  float wn = inversesqrt(wa * wa + w * w);
  float om = uTone.z;
  float vLow = smoothstep(0.55, 0.85, v);   // điểm ảnh dưới bóng (vòng dưới)
  // Dải trước = nửa trước của đĩa nhìn gần như ngang: tia đi là là qua đĩa trên một quãng dài (r và z đều đổi dọc tia)
  // nên mọi vân 3 chiều bị trung bình hoá — dải trơn, không thấy quay. Hai toạ độ KHÔNG đổi dọc tia là vị trí dọc dải (k)
  // và v của điểm ảnh, nên kết cấu của dải trước lấy theo (k, v): cụm sáng / vệt dài dọc dải, trôi dọc dải cùng chiều
  // quay của nửa trước. Cung trên và vòng dưới là ảnh của nửa SAU nên không đổi. 3 quãng tám, mỗi quãng lặp nguyên lần
  // trên trục tuần hoàn của texture và trôi nguyên số ô mỗi 10 s (vòng lặp liền). Tính một lần cho mỗi điểm ảnh (tính
  // trong vòng lặp ray-march thì lớp hố đen chậm gấp đôi).
  float bandTex = 0.0;
  if (uBand.z > 0.0) {
    float xs = (k * 2.598 + sign(om) * uBand.w * uBHTime) * uBand.x;   // R = 2.598 r_s
    float by = v * uBand.y;
    // uốn miền (nhiễu thô) để các ô không thẳng hàng theo lưới — không thì thấy rõ từng ô vuông
    vec2 wv = nB(vec3(v * 2.5 + 11.0, xs * 0.5, 4.5)).rg - 0.5;
    by += uBandWarp * wv.x;
    xs += uBandWarp * wv.y;
    float fb = nA(vec3(by + 301.0, xs, 2.5)).r
             + 0.6 * nA(vec3(2.0 * by + 57.0, 2.0 * xs, 8.5)).g
             + 0.3 * nA(vec3(4.0 * by + 131.0, 4.0 * xs, 5.5)).b;
    bandTex = 4.0 * (fb / 1.9 - 0.5);
  }

  for (int i = 0; i < MAX_STEPS; i++) {
    float r = length(pos);
    float rc = length(pos.xy);
    float sig = uDisk2.y + uDisk2.z * rc;
    float zlim = 4.2 * sig + 0.05;
    bool zone = rc < rOut + 0.6 && rc > rIn - 0.6 && abs(pos.z) < zlim;
    float dl = clamp(0.06 * r, 0.02, 1.2);
    if (zone) {
      float vz = exp(-0.5 * (pos.z / sig) * (pos.z / sig));
      dl = min(dl, mix(0.22, uStepIn, smoothstep(0.01, 0.3, vz)));
    } else if (rc < rOut + 1.5 && pos.z * vel.z < 0.0) {
      // đang tiến vào lớp đĩa: không bước qua nó
      dl = min(dl, max((abs(pos.z) - zlim) / max(abs(vel.z), 1e-4) + 0.02, 0.04));
    }
    vec3 k1x = vel, k1v = acc(pos, h2);
    vec3 k2x = vel + 0.5 * dl * k1v, k2v = acc(pos + 0.5 * dl * k1x, h2);
    vec3 k3x = vel + 0.5 * dl * k2v, k3v = acc(pos + 0.5 * dl * k2x, h2);
    vec3 k4x = vel + dl * k3v, k4v = acc(pos + dl * k3x, h2);
    vec3 xn = pos + dl / 6.0 * (k1x + 2.0 * k2x + 2.0 * k3x + k4x);
    vec3 vn = vel + dl / 6.0 * (k1v + 2.0 * k2v + 2.0 * k3v + k4v);
    if (zone) {
      vec3 xm = 0.5 * (pos + xn);
      float rr = length(xm.xy) + 1e-6;
      float sg = uDisk2.y + uDisk2.z * rr;
      float zs = xm.z / sg;
      float vert = exp(-0.5 * zs * zs);
      float rad = clamp((rr - rIn) / 0.5, 0.0, 1.0) * clamp((rOut - rr) / rFade, 0.0, 1.0);
      if (rad * vert > 1e-4) {
        float phi = atan(xm.y, xm.x);
        float lnr = log(rr);
        // mặt dưới đĩa (chỉ thấy qua ảnh phụ = vòng dưới): theo vật lý ảnh phụ lật nên chạy sang trái; đặc tả muốn
        // sang phải như cung trên → đảo chiều quay của cả vân khi tia nhìn mặt dưới (uFar.w = −1; đặt 1 = vật lý)
        // vòng dưới còn có ảnh bậc cao (tia vòng quanh hố rồi chạm mặt trên) → đảo cả theo vị trí điểm ảnh (dưới bóng)
        float flipW = vn.z > 0.0 ? 1.0 : vLow;
        float spin0 = om * pow(rr, -1.5);
        float spin = spin0 * (flipW > 0.5 ? uFar.w : 1.0);   // chiều trội (dùng cho pha trộn chéo và vân mịn)
        vec2 n = texPhase(lnr, phi + spin * t1, zs);
        if (flipW > 0.001 && flipW < 0.999) {
          // vùng chuyển tiếp: trộn 2 chiều quay theo flipW cho khỏi đường nối
          vec2 nOther = texPhase(lnr, phi + (flipW > 0.5 ? spin0 : spin0 * uFar.w) * t1, zs);
          n = mix(nOther, n, flipW > 0.5 ? flipW : 1.0 - flipW);
        }
        // mặt dưới (vòng dưới) toàn vòng mảnh đồng tâm → vân chạy phải đậm hơn mới thấy được chuyển động
        float farW = uFar.y * smoothstep(0.15, 0.6, sin(phi)) * (vn.z > 0.0 ? uFarUnder : 1.0);
        float spinF = spin * uFar.z;
        float nf = farW > 0.0 ? farOct(lnr, phi + spinF * t1, zs) : 0.5;
        if (w > 0.001) {
          vec2 n2 = texPhase(lnr, phi + spin * t2, zs);
          // trộn chéo 2 pha, giữ độ tương phản (không mờ đi ở giữa vòng lặp)
          n = 0.5 + ((n - 0.5) * wa + (n2 - 0.5) * w) * wn;
          if (farW > 0.0) nf = 0.5 + ((nf - 0.5) * wa + (farOct(lnr, phi + spinF * t2, zs) - 0.5) * w) * wn;
        }
        n.x = mix(n.x, 0.5 + (n.x - 0.5) * 0.6 + (nf - 0.5) * 0.9, farW);
        float streak = clamp(0.5 + (n.x - 0.5) * uDisk2.w, 0.05, 1.6);
        float clumpmod = 1.0 - uDisk3.x + uDisk3.x * 2.0 * n.y;
        // kết cấu của dải trước (tính sẵn một lần cho mỗi điểm ảnh, xem bandTex): chỉ nhân vào phát xạ của nửa trước
        clumpmod *= clamp(1.0 + uBand.z * smoothstep(0.05, 0.45, -sin(phi)) * bandTex, 0.12, 2.6);
        float dust = clamp((n.y - uDisk4.x) / (1.0 - uDisk4.x), 0.0, 1.0);
        float rho = rad * vert * (0.75 + 0.25 * clumpmod);
        float tex = streak * clumpmod;
        float side = vn.z <= 0.0 ? 1.0 : uDisk3.y;
        float S = (pow(max(rr, rIn) / rIn, -uDisk1.w) + uDisk2.x) * side * tex;
        float emis = uDisk3.z * rho * S;
        float wisp = uDisk4.z * rho * tex * tex * clamp((rr - uDisk4.y) / 2.0, 0.0, 1.0) * clamp((rOut - rr) / 3.0, 0.0, 1.0);
        float kap = uDisk3.z * rho + uDisk3.w * rad * vert * dust;
        I += T * emis * dl;
        Iw += T * wisp * dl;
        T *= exp(-kap * dl);
      }
    }
    pos = xn;
    vel = vn;
    float rn = length(xn);
    if (rn < 1.02) { captured = 1.0; break; }
    if (rn > uD * 1.3 && dot(xn, vn) > 0.0) break;
    if (T < 1e-3) break;
  }
  float ex = uTone.x * (1.0 + 0.35 * uBHSurge);
  float L0 = 1.0 - exp(-ex * I);
  float W0 = 1.0 - exp(-ex * uTone.y * Iw);
  // chỗ nối với quạt (chỉ trong khung video): dải trước nhường chỗ cho sợi quạt, cung trên tan dần
  if (uTone.w > 0.5) {
    float fb = mix(1.0, uFadeK.z, smoothstep(uFadeK.x, uFadeK.y, k));
    // chân phải của cung trên mờ theo góc quanh C (độ; 90 = đỉnh): dưới uArcFadeK.x còn uArcFadeK.z, từ uArcFadeK.y đủ sáng
    float fa = k > 0.0 ? mix(uArcFadeK.z, 1.0, smoothstep(uArcFadeK.x, uArcFadeK.y, degrees(atan(-v, k)))) : 1.0;
    float f = mix(fb, fa, smoothstep(uArcFadeV.x, uArcFadeV.y, v));
    L0 *= f;
    W0 *= f;
  }
  gl_FragColor = vec4(L0, W0, T * (1.0 - captured), 1.0);
}
`;

// Gauss tách 2 chiều, σ tính bằng px của target; 25 mẫu trải ±3σ
const BLUR = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uDir;       // (1/w, 0) hoặc (0, 1/h)
uniform float uSigma;    // px
varying vec2 vUv;
void main() {
  float st = max(1.0, uSigma * 3.0 / 12.0);
  float acc = 0.0, ws = 0.0;
  for (int i = -12; i <= 12; i++) {
    float x = float(i) * st;
    float wgt = exp(-0.5 * x * x / max(uSigma * uSigma, 1e-4));
    acc += wgt * texture2D(tSrc, vUv + uDir * x).r;
    ws += wgt;
  }
  gl_FragColor = vec4(acc / ws, 0.0, 0.0, 1.0);
}
`;

// L_mới = L + a·blur(L): cộng lượt blur (kênh r của tBlur) vào L (kênh r của tBase); giữ kênh g, b của tBase
const ADD = /* glsl */ `
uniform sampler2D tBase;
uniform sampler2D tBlur;
uniform float uAmp;
varying vec2 vUv;
void main() {
  vec4 b = texture2D(tBase, vUv);
  gl_FragColor = vec4(b.r + uAmp * texture2D(tBlur, vUv).r, b.g, b.b, 1.0);
}
`;

const COMPOSE = /* glsl */ `
${COMMON}
uniform sampler2D tL1;       // L sau quầng + bloom hẹp (r), sợi mờ (g), bầu trời lọt qua (b)
uniform sampler2D tBlurC;    // blur(L1, 0.4R)
uniform sampler2D tLut;
uniform float uBloomC;
uniform float uGamma;
uniform vec3 uWispRGB;
uniform vec2 uBHC;
uniform float uBHR;
uniform float uBHTilt;
uniform vec2 uRing;          // σ (×R), độ sáng cộng thêm (0–1)
uniform vec4 uRingLow;       // nửa dưới: độ sáng cộng thêm, v bắt đầu, v đủ, nửa bề rộng (×R) của vành được vẽ lại
uniform vec2 uBlack;         // điểm đen của quầng (chỉ trong khung video): L dưới x → đen, trên y → giữ nguyên
uniform float uRefMode;
uniform float uRefPx;       // px khung so ảnh / px bộ đệm
uniform vec3 uBg;
varying vec2 vUv;
// (LOD 0, không cần đạo hàm: gọi được ở chỗ nào cũng không sinh điểm ảnh rác ở mép vùng)
float Lat(vec2 uv) { return texture2DLodEXT(tL1, uv, 0.0).r + uBloomC * texture2DLodEXT(tBlurC, uv, 0.0).r; }
void main() {
  vec4 a = texture2D(tL1, vUv);
  float L = a.r + uBloomC * texture2D(tBlurC, vUv).r;
  // vòng photon mảnh ở độ phân giải đầy đủ
  // chế độ so ảnh: px canvas (khung 665×361), không qua biến đổi khung tham chiếu của cảnh
  vec2 p = uRefMode > 0.5 ? vec2(gl_FragCoord.x, uViewport.y - gl_FragCoord.y) * uRefPx : scenePos(refPos());
  vec2 d = p - uBHC;
  float rl = max(length(d), 1e-3);
  float rho = rl / uBHR;
  float dr = (rho - 1.0) / uRing.x;
  float v = dot(d, vec2(sin(uBHTilt), cos(uBHTilt))) / uBHR;
  // Nửa dưới: vòng photon của lượt ray-march mảnh hơn một điểm ảnh của lượt đó nên bị lấy mẫu thành CHUỖI HẠT rời. Thay
  // cả vành ρ = 1 ± uRingLow.w bằng nội suy theo bán kính giữa hai mép vành (xoá chuỗi hạt), rồi vẽ lại vòng bằng công
  // thức (mặt cắt Gauss) như nửa trên. Dịch chuyển trong toạ độ cảnh → uv qua đạo hàm của p.
  mat2 Ji = inverse(mat2(dFdx(p), dFdy(p)));
  float low = smoothstep(uRingLow.y, uRingLow.z, v);
  float wl = low * (1.0 - smoothstep(uRingLow.w, 1.6 * uRingLow.w, abs(rho - 1.0)));
  float e = 1.6 * uRingLow.w;
  vec2 un = (Ji * (d / rl)) / uViewport;                   // uv trên mỗi px cảnh dọc theo bán kính
  float rc = clamp(rho, 1.0 - e, 1.0 + e);                 // (ngoài vành: hai mẫu trùng mép gần nhất, wl = 0)
  float Lin = Lat(vUv + un * ((1.0 - e) - rc) * uBHR);
  float Lout = Lat(vUv + un * ((1.0 + e) - rc) * uBHR);
  L = mix(L, mix(Lin, Lout, (rc - (1.0 - e)) / (2.0 * e)), wl);
  L += exp(-0.5 * dr * dr) * (uRing.y * (1.0 - smoothstep(-0.1, 0.25, v)) + uRingLow.x * low);
  L = pow(clamp(L, 0.0, 1.0), uGamma);
  vec3 rgb = texture2D(tLut, vec2(L * (255.0 / 256.0) + 0.5 / 256.0, 0.5)).rgb;
  rgb += a.g * uWispRGB * 0.6;
  if (uRefMode > 0.5) rgb = max(rgb, uBg * a.b);
  // Bảng màu đo trên ảnh tham chiếu có nền xám (L thấp → xám xanh), nên quầng mờ của lớp hố đen thành một vầng xám trên
  // nền trời đen của khung video. Trong khung video kéo phần L rất thấp về đen (quầng trong lòng bóng có L cao hơn, giữ nguyên).
  else rgb *= smoothstep(uBlack.x, uBlack.y, L);
  gl_FragColor = vec4(min(rgb, vec3(1.0)), 1.0);
}
`;

export function createBlackHole(uniforms, opts = {}) {
  const refMode = !!opts.refMode;
  const rf = BH.refFrame;
  const nA = noise3D(128, 16, 16, 7);
  const nB = noise3D(32, 8, 8, 11);
  const luts = { amber: lutTexture(LUT_AMBER), silver: lutTexture(LUT_SILVER) };

  // camera (volrender.py): nghiêng i, cách D; góc bóng chính xác cho camera ở khoảng cách hữu hạn
  const D = BH.camDist;
  const e = ((90 - BH.incl) * Math.PI) / 180;
  const cam = new Vector3(0, -D * Math.cos(e), D * Math.sin(e));
  const fwd = cam.clone().multiplyScalar(-1).normalize();
  const right = new Vector3(1, 0, 0);
  const up = new Vector3().crossVectors(right, fwd).normalize();
  const bc = 1.5 * Math.sqrt(3);
  const alpha = Math.asin((bc / D) * Math.sqrt(1 - 1 / D));

  const C = refMode ? new Vector2(rf.cx, rf.cy) : new Vector2(...BH.center);
  const R = refMode ? rf.R : BH.R;
  const tilt = refMode ? 0 : (BH.tiltDeg * Math.PI) / 180;
  const bhU = {
    uBHC: { value: C.clone() },
    uBHR: { value: R },
    uBHTilt: { value: tilt },
    uRefMode: { value: refMode ? 1 : 0 },
  };

  // khung nhìn riêng của các target độ phân giải thấp
  const own = { uViewport: { value: new Vector2(2, 2) }, uScale: { value: 1 }, uOrigin: { value: new Vector2(0, 0) } };
  const marchMat = new ShaderMaterial({
    uniforms: {
      ...uniforms,
      ...own,
      ...bhU,
      uNA: { value: nA },
      uNB: { value: nB },
      uNASize: { value: new Vector3(128, 16, 16) },
      uNBSize: { value: new Vector3(32, 8, 8) },
      uPix: { value: Math.tan(alpha) / R },
      uCam: { value: cam },
      uFwd: { value: fwd },
      uUp: { value: up },
      uD: { value: D },
      uDisk1: { value: new Vector4(BH.rIn, BH.rOut, BH.rFade, BH.qEmis) },
      uDisk2: { value: new Vector4(BH.sFloor, BH.hz0, BH.hz, BH.contrast) },
      uDisk3: { value: new Vector4(BH.clumpAmp, BH.undersideGain, BH.kappa, BH.kappaDust) },
      uDisk4: { value: new Vector4(BH.dustThresh, BH.wispR0, BH.wispAmp, BH.warpAmp) },
      uDisk5: { value: new Vector4(BH.kLnr, BH.kPhiCells, BH.kZ, BH.clumpK) },
      uTone: { value: new Vector4(BH.exposure, BH.wispGain, (BH.omega0Deg * Math.PI) / 180, refMode ? 0 : 1) },
      uFadeK: { value: new Vector3(...BH.fadeK) },
      uArcFadeK: { value: new Vector3(...BH.arcFadeK) },
      uArcFadeV: { value: new Vector2(...BH.arcFadeV) },
      uBHTime: { value: 0 },
      uBHSurge: { value: 0 },
      uXfade: { value: BH.xfadeSec },
      uBox: { value: new Vector2(...BH.box) },
      uStepIn: { value: BH.stepIn },
      uFar: { value: new Vector4(BH.far.cells, BH.far.weight, BH.far.speed, BH.far.underSign) },
      uFarUnder: { value: BH.far.underWeight },
      uBand: { value: new Vector4(BH.band.perRs, BH.band.perR, BH.band.amp, BH.band.speed) },
      uBandWarp: { value: BH.band.warp },
    },
    vertexShader: VERT,
    fragmentShader: MARCH,
    depthTest: false,
    depthWrite: false,
  });

  const rtOpts = { type: HalfFloatType, format: RGBAFormat, magFilter: LinearFilter, minFilter: LinearFilter, depthBuffer: false };
  const rtM = new WebGLRenderTarget(2, 2, rtOpts);   // march
  const rtT = new WebGLRenderTarget(2, 2, rtOpts);   // tạm (blur ngang)
  const rtG = new WebGLRenderTarget(2, 2, rtOpts);   // blur
  const rtH = new WebGLRenderTarget(2, 2, rtOpts);   // L + quầng
  const rtL1 = new WebGLRenderTarget(2, 2, rtOpts);  // + bloom hẹp
  const rtC = new WebGLRenderTarget(2, 2, rtOpts);   // blur rộng của L1

  const blurMat = new ShaderMaterial({
    uniforms: { tSrc: { value: null }, uDir: { value: new Vector2() }, uSigma: { value: 1 } },
    vertexShader: VERT, fragmentShader: BLUR, depthTest: false, depthWrite: false,
  });
  const addMat = new ShaderMaterial({
    uniforms: { tBase: { value: null }, tBlur: { value: null }, uAmp: { value: 0 } },
    vertexShader: VERT, fragmentShader: ADD, depthTest: false, depthWrite: false,
  });
  const quad = new Mesh(new PlaneGeometry(2, 2), marchMat);
  quad.frustumCulled = false;
  const scene = new Scene();
  scene.add(quad);

  const composeMat = new ShaderMaterial({
    uniforms: {
      ...uniforms,
      ...bhU,
      tL1: { value: rtL1.texture },
      tBlurC: { value: rtC.texture },
      tLut: { value: luts[BH.palette] || luts.amber },
      uBloomC: { value: BH.bloom[1][1] },
      uGamma: { value: BH.gamma },
      uWispRGB: { value: new Vector3(...BH.wispRGB.map((c) => c / 255)) },
      uRing: { value: new Vector2(BH.ring.widthR / 2.3548, BH.ring.gain) },
      uRingLow: { value: new Vector4(BH.ring.lowGain, BH.ring.lowV[0], BH.ring.lowV[1], BH.ring.lowBand) },
      uBlack: { value: new Vector2(...BH.black) },
      uBg: { value: new Vector3(...rf.bg.map((c) => c / 255)) },
      uRefPx: { value: 1 },
    },
    vertexShader: VERT,
    fragmentShader: COMPOSE,
    // screen: out = bh + nền·(1 − bh)
    blending: CustomBlending,
    blendEquation: AddEquation,
    blendSrc: OneFactor,
    blendDst: OneMinusSrcColorFactor,
    blendSrcAlpha: ZeroFactor,
    blendDstAlpha: OneFactor,
    depthTest: false,
    depthWrite: false,
    transparent: true,
  });
  const comp = new Mesh(new PlaneGeometry(2, 2), composeMat);
  comp.frustumCulled = false;
  comp.renderOrder = 3;

  let pxPerRef = 1; // px của target / px tham chiếu
  const size = new Vector2(2, 2);

  function pass(renderer, camera, mat, target) {
    quad.material = mat;
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
  }
  function blur(renderer, camera, src, sigmaPx, out) {
    blurMat.uniforms.tSrc.value = src.texture;
    blurMat.uniforms.uSigma.value = sigmaPx;
    blurMat.uniforms.uDir.value.set(1 / size.x, 0);
    pass(renderer, camera, blurMat, rtT);
    blurMat.uniforms.tSrc.value = rtT.texture;
    blurMat.uniforms.uDir.value.set(0, 1 / size.y);
    pass(renderer, camera, blurMat, out);
  }
  function addBlur(renderer, camera, base, blurred, amp, out) {
    addMat.uniforms.tBase.value = base.texture;
    addMat.uniforms.tBlur.value = blurred.texture;
    addMat.uniforms.uAmp.value = amp;
    pass(renderer, camera, addMat, out);
  }

  return {
    object: comp,
    material: marchMat,
    composeMaterial: composeMat,
    C, R,
    /** L của lớp hố đen (sau quầng + bloom hẹp; blur rộng) cho tấm công thức tra màu / độ sáng của hố đen tại từng điểm ảnh */
    targets: { l1: rtL1.texture, blurC: rtC.texture },
    /** bảng màu hiện tại (texture 256×1): tấm công thức dùng chung để sợi nóng lên cùng tông với hố */
    get lut() { return composeMat.uniforms.tLut.value; },
    setPalette(name) { composeMat.uniforms.tLut.value = luts[name] || luts.amber; },
    /** W,H: bộ đệm vẽ đầy đủ; scale/ox/oy: khung tham chiếu → px; k: tỉ lệ phân giải của lượt march */
    setSize(W, H, scale, ox, oy, k) {
      const w = Math.max(2, Math.round(W * k));
      const h = Math.max(2, Math.round(H * k));
      size.set(w, h);
      for (const t of [rtM, rtT, rtG, rtH, rtL1, rtC]) t.setSize(w, h);
      own.uViewport.value.set(w, h);
      own.uScale.value = scale * (h / H);
      own.uOrigin.value.set(ox * (w / W), oy * (h / H));
      pxPerRef = own.uScale.value;
      composeMat.uniforms.uRefPx.value = rf.W / W;
    },
    setTime(t, surge = 0) {
      marchMat.uniforms.uBHTime.value = ((t % LOOP_SEC) + LOOP_SEC) % LOOP_SEC;
      marchMat.uniforms.uBHSurge.value = surge;
    },
    render(renderer, camera) {
      if (!comp.visible) return;
      const prev = renderer.getRenderTarget();
      const Rpx = R * pxPerRef;
      pass(renderer, camera, marchMat, rtM);
      // quầng σ = 0.6R: L += 0.6·blur(L)
      blur(renderer, camera, rtM, BH.hazeSigmaR * Rpx, rtG);
      addBlur(renderer, camera, rtM, rtG, BH.haze, rtH);
      // bloom hẹp σ = 0.08R
      blur(renderer, camera, rtH, BH.bloom[0][0] * Rpx, rtG);
      addBlur(renderer, camera, rtH, rtG, BH.bloom[0][1], rtL1);
      // bloom rộng σ = 0.4R (cộng ở lượt ghép)
      blur(renderer, camera, rtL1, BH.bloom[1][0] * Rpx, rtC);
      quad.material = marchMat;
      renderer.setRenderTarget(prev);
    },
  };
}
