/**
 * Hau ky: UnrealBloomPass + mot pass vignette & grain nhe.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { BLOOM, GRADE, COLORS } from '../config.js';

export const VignetteGrainShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uStrength: { value: GRADE.vignetteStrength },
    uSoftness: { value: GRADE.vignetteSoftness },
    uGrain: { value: GRADE.grain },
    uWarmth: { value: GRADE.warmth },
    uEdge: { value: new THREE.Color(COLORS.vignette) },
    uAspect: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    precision highp float;
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uStrength;
    uniform float uSoftness;
    uniform float uGrain;
    uniform float uWarmth;
    uniform vec3  uEdge;
    uniform float uAspect;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }

    void main() {
      vec4 c = texture2D(tDiffuse, vUv);

      // vignette: sang am o giua, toi dan ra mep
      vec2 d = (vUv - 0.5) * vec2(uAspect, 1.0);
      float r = length(d) / 0.72;
      float v = 1.0 - uStrength * smoothstep(uSoftness, 1.35, r);
      c.rgb = mix(uEdge * 0.9, c.rgb, clamp(v, 0.0, 1.0));

      // keo ca khung ve phia nau am, cho quang bloom khoi bi xam
      c.rgb *= mix(vec3(1.0), vec3(1.05, 1.00, 0.86), uWarmth);

      // grain nhe
      float g = hash(vUv * vec2(1024.0, 1024.0) + fract(uTime) * 97.0) - 0.5;
      c.rgb += g * uGrain;

      gl_FragColor = vec4(c.rgb, 1.0);
    }
  `,
};

export function buildComposer(renderer, scene, camera, size) {
  const composer = new EffectComposer(renderer);
  composer.setSize(size.width, size.height);

  composer.addPass(new RenderPass(scene, camera));

  const bs = BLOOM.resolutionScale ?? 1;
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(size.width * bs, size.height * bs),
    BLOOM.strength,
    BLOOM.radius,
    BLOOM.threshold,
  );
  composer.addPass(bloom);

  composer.addPass(new OutputPass());

  const grade = new ShaderPass(VignetteGrainShader);
  grade.uniforms.uAspect.value = size.width / size.height;
  grade.renderToScreen = true;
  composer.addPass(grade);

  return {
    composer,
    bloom,
    grade,
    /** Doi kich thuoc; bloom luon chay o BLOOM.resolutionScale cua khung hinh */
    setSize(w, h) {
      composer.setSize(w, h);
      bloom.setSize(w * bs, h * bs);
      grade.uniforms.uAspect.value = w / h;
    },
  };
}
