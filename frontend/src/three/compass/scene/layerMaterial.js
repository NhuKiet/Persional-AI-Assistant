/**
 * Vat lieu cua mot vanh.
 *
 * Texture "mask" mang ba loai net trong ba kenh mau (R net ve, G chu Han,
 * B cham sao), texture "wash" mang lop phu am. Shader tron lai theo he so
 * rieng cho tung kenh, nen do sang cua chu va cua cham sao chinh duoc NGAY LUC
 * CHAY - keo thanh truot la thay doi, khong phai ve lai texture 2048x2048.
 *
 * Mau sac suy ra tu cuong do: cho thap la mau quang am, cho cao chuyen dan sang
 * trang kem, dung nhu mot bong den - de he so len cao thi net chay trang.
 */
import * as THREE from 'three';
import { COLORS, INK } from '../config.js';

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
precision highp float;

uniform sampler2D uMask;
uniform sampler2D uWash;
uniform vec3  uCoreColor;
uniform vec3  uGlowColor;
uniform vec3  uWashColor;
uniform float uLineGain;
uniform float uTextGain;
uniform float uStarGain;
uniform float uWashGain;
uniform float uOpacity;
uniform float uHotKnee;   // cuong do bat dau chuyen sang mau loi
uniform float uHotFull;   // cuong do da thanh mau loi hoan toan

varying vec2 vUv;

void main() {
  vec3 m = texture2D(uMask, vUv).rgb;
  float ink = m.r * uLineGain + m.g * uTextGain + m.b * uStarGain;
  if (ink <= 0.0005 && uWashGain <= 0.0) discard;

  // mau di tu quang am -> trang kem theo cuong do
  vec3 col = mix(uGlowColor, uCoreColor, smoothstep(uHotKnee, uHotFull, ink)) * ink;

  col += uWashColor * texture2D(uWash, vUv).a * uWashGain;

  gl_FragColor = vec4(col, uOpacity);
}
`;

/**
 * @param {HTMLCanvasElement} maskCanvas
 * @param {HTMLCanvasElement} washCanvas
 */
export function makeLayerMaterial(maskCanvas, washCanvas) {
  const mask = new THREE.CanvasTexture(maskCanvas);
  mask.colorSpace = THREE.SRGBColorSpace;
  mask.anisotropy = 8;
  mask.minFilter = THREE.LinearMipmapLinearFilter;
  mask.magFilter = THREE.LinearFilter;

  const wash = new THREE.CanvasTexture(washCanvas);
  wash.colorSpace = THREE.SRGBColorSpace;
  wash.minFilter = THREE.LinearMipmapLinearFilter;
  wash.magFilter = THREE.LinearFilter;

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uMask: { value: mask },
      uWash: { value: wash },
      uCoreColor: { value: new THREE.Color(COLORS.core) },
      uGlowColor: { value: new THREE.Color(COLORS.glow) },
      uWashColor: { value: new THREE.Color(COLORS.innerWash) },
      uLineGain: { value: INK.line },
      uTextGain: { value: INK.text },
      uStarGain: { value: INK.star },
      uWashGain: { value: INK.wash },
      uOpacity: { value: 1 },
      uHotKnee: { value: INK.hotKnee },
      uHotFull: { value: INK.hotFull },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
  });

  material.userData.textures = [mask, wash];
  return material;
}
