/**
 * Đoạn GLSL dùng chung. Mọi shader làm việc trong toạ độ khung tham chiếu 980×576
 * (y hướng xuống), đổi từ gl_FragCoord qua uScale/uOrigin.
 * (Bản gốc còn có bảng mép quạt FAN_EDGES của tấm công thức — không port.)
 */
import { Vector2, Vector4 } from 'three';
import { BH } from '../config.js';

export function commonUniforms() {
  return {
    uViewport: { value: new Vector2(1, 1) },
    uScale: { value: 1 },
    uOrigin: { value: new Vector2(0, 0) },
    uTime: { value: 0 },
    uLoop: { value: 10 },
    uFocus: { value: new Vector2(474, 305) },
    // tương tác: dời + phóng cả hệ hố đen (quanh F), thấu kính con trỏ, đồng hồ thật (nhấp nháy, grain)
    uShift: { value: new Vector2(0, 0) },
    uZoom: { value: 1 },
    uLens: { value: new Vector4(0, 0, 20, 5) },
    uLensOn: { value: 0 },
    uClock: { value: 0 },
    // lõi hố đen bản cuối: tâm bóng, bán kính vòng photon R (px khung tham chiếu, toạ độ hệ)
    uHoleCtr: { value: new Vector2(BH.center[0], BH.center[1]) },
    uHoleRad: { value: BH.R },
  };
}

export const COMMON = /* glsl */ `
uniform vec2 uViewport;
uniform float uScale;
uniform vec2 uOrigin;
uniform float uTime;
uniform float uLoop;
uniform vec2 uFocus;
uniform vec2 uShift;     // dời cả hệ hố đen (px tham chiếu)
uniform float uZoom;     // phóng cả hệ quanh F
uniform vec4 uLens;      // thấu kính con trỏ: x, y (px tham chiếu màn hình), bán kính Einstein, làm mềm
uniform float uLensOn;   // 0..1
uniform float uClock;    // đồng hồ thật, lặp theo LOOP_SEC
uniform vec2 uHoleCtr;   // tâm bóng hố đen (toạ độ hệ)
uniform float uHoleRad;  // R = bán kính vòng photon

#define TAU 6.28318530718
#define PI 3.14159265359

// toạ độ khung tham chiếu của fragment hiện tại
vec2 refPos() {
  vec2 fc = vec2(gl_FragCoord.x, uViewport.y - gl_FragCoord.y);
  return (fc - uOrigin) / uScale;
}

// toạ độ màn hình tham chiếu → toạ độ của hệ hố đen (sau khi kéo/phóng)
vec2 scenePos(vec2 p) { return uFocus + (p - uFocus - uShift) / uZoom; }

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
`;
