// /src/main.js
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshSurfaceSampler } from 'three/addons/math/MeshSurfaceSampler.js';

/* ---------- base ---------- */
const heroSection = document.getElementById('heroSection');
const nextSection = document.querySelector('.jewel-hero-panel');
const canvas = document.querySelector('.webgl');

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: true
});
renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor(0x000000, 1);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(
  30,
  window.innerWidth / window.innerHeight,
  0.1,
  100
);
camera.position.set(0, 0, 50);
camera.lookAt(0, 0, 0);
scene.add(camera);

// --- mouse → world position (intersezione con piano alla profondità del modello) ---
const raycaster = new THREE.Raycaster();
const mouseNDC = new THREE.Vector2();
const mouseWorld = new THREE.Vector3();
const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0); // piano z=0
const tmpWorldPos = new THREE.Vector3();
const smoothMouseWorld = new THREE.Vector3(9999, 9999, 9999); // segue piano piano il mouse
let hasMouseWorld = false; // sappiamo se abbiamo una posizione valida "agganciata"

// MOBILE: posizione automatica della calamita
const autoMouseWorld = new THREE.Vector3();

// luci sobrie
scene.add(new THREE.AmbientLight(0xffffff, 0.15));
const key = new THREE.DirectionalLight(0xffffff, 0.9);
key.position.set(2, 5, 2);
scene.add(key);
const fill = new THREE.DirectionalLight(0xffffff, 0.3);
fill.position.set(-3, 1, 1);
scene.add(fill);

/* ---------- controlli look ---------- */
// Consideriamo "mobile" TUTTO fino a 1024px (iPad orizzontale incluso)
const IS_MOBILE = window.innerWidth <= 1024;
const COUNT_DESKTOP = 250_000;
const COUNT_MOBILE  = 120_000;

const P = {
  uTime: { value: 0 },
  uProgress: { value: 0 }, // 0..1 dallo scroll sull'intera sticky
  uColor: { value: new THREE.Color('#DD9451') },
  uPointSize: { value: 0.05 },
  uNoiseAmp: { value: 0 },
  uNormalPush: { value: 0.9 },
  uWind: { value: new THREE.Vector3(0.55, 1.1, 0.0) },

  // idle motion sempre attiva
  uIdleAmp: { value: 0.4 },
  uIdleFreq: { value: 0.6 },

  // calamita mouse in spazio mondo
  uMouseWorld: { value: new THREE.Vector3(9999, 9999, 9999) },
  uMouseStrength: { value: 0.44 },
  uMouseRadius: { value: -0.2 }
};

if (IS_MOBILE) {
  // raggio e forza un filo più ampi → effetto sempre visibile
  P.uMouseRadius.value = -0.2;
  P.uMouseStrength.value = 0.55;
}

/* ---------- shader: sabbia granulare ---------- */
const particlesVert = /* glsl */`
precision highp float;

attribute float aSeed;
attribute float aSize;

varying float vLife;
varying float vShade;

uniform float uTime;
uniform float uProgress;
uniform float uPointSize;
uniform float uNoiseAmp;
uniform float uNormalPush;
uniform vec3  uWind;
uniform float uIdleAmp;
uniform float uIdleFreq;
uniform vec3  uMouseWorld;
uniform float uMouseStrength;
uniform float uMouseRadius;

float hash(vec3 p){
  return fract(sin(dot(p, vec3(127.1,311.7,74.7))) * 43758.5453123);
}
float noise(vec3 p){
  vec3 i=floor(p), f=fract(p);
  float n=mix(mix(mix(hash(i+vec3(0,0,0)),hash(i+vec3(1,0,0)),f.x),
                 mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
              mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),
                 mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);
  return n;
}
float fbm(vec3 p){
  float v=0., a=0.5;
  for(int i=0;i<4;i++){
    v+=a*noise(p);
    p*=2.;
    a*=0.5;
  }
  return v;
}
float halfLambert(vec3 n, vec3 l){
  return max(dot(n,l)*0.5+0.5, 0.0);
}

void main(){
  // dissolvenza temporale per granello
  float t = clamp((uProgress - aSeed) * 1.8, 0.0, 1.0);
  vLife = t;

  // shading volumetrico
  vec3 nrm = normalize(normal);
  vec3 lightDir = normalize(vec3(0.35, 0.85, 0.4));
  vShade = pow(halfLambert(nrm, lightDir), 1.12);

  // sfoglia + vento legati alla dissolvenza
  vec3 pushN = nrm * (uNormalPush * t * t);
  float n = fbm(position * 1.15 + vec3(uTime*0.55, uTime*0.41, aSeed*10.0));
  vec3 swirl = (uWind + vec3(n-0.5, n-0.5, n-0.5)) * (uNoiseAmp * t);

  // idle motion sempre (anche t=0)
  float i1 = fbm(position * 0.9 + vec3(uTime*uIdleFreq, 0.0, aSeed*5.0));
  float i2 = fbm(position * 0.9 + vec3(0.0, uTime*uIdleFreq, aSeed*7.0));
  float i3 = fbm(position * 0.9 + vec3(aSeed*3.0, uTime*uIdleFreq*0.8, 0.0));
  vec3 idle = vec3(i1-0.5, i2-0.5, i3-0.5) *
              (uIdleAmp * (0.4 + 0.6 * (0.3 + 0.7 * t)));

  vec3 displaced = position + pushN + swirl + idle;

  // attrazione mouse in spazio mondo
  vec3 wp = (modelMatrix * vec4(displaced, 1.0)).xyz;
  vec3 toMouse = uMouseWorld - wp;
  float dist = length(toMouse);
  float infl = uMouseStrength * exp(-(dist*dist) / (uMouseRadius*uMouseRadius));
  vec3 attract = (dist > 1e-5) ? (toMouse / dist) * infl : vec3(0.0);
  wp -= attract;

  // proiezione
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mv;

  // size
  gl_PointSize = (uPointSize * aSize) * (140.0 / -mv.z) * (0.7 + t * 0.5);
}
`;

const particlesFrag = /* glsl */`
precision highp float;

uniform vec3 uColor;
varying float vLife;
varying float vShade;

void main(){
  vec2 uv = gl_PointCoord * 2.0 - 1.0;
  float d = dot(uv, uv);
  float circle = smoothstep(1.0, 0.82, d);

  float grain = fract(sin(dot(uv, vec2(12.9898,78.233)) + vLife*43758.5453));
  float shade = mix(0.78, 1.12, vShade);

  vec3 col = uColor * shade * (0.96 + 0.04 * grain);
  float alpha = circle;

  if(alpha < 0.6) discard;
  gl_FragColor = vec4(col, 1.0);
}
`;

const particlesMat = new THREE.ShaderMaterial({
  uniforms: P,
  vertexShader: particlesVert,
  fragmentShader: particlesFrag,
  transparent: true,
  depthTest: true,
  depthWrite: false,
  blending: THREE.NormalBlending,
  dithering: true
});

/* ---------- helpers ---------- */
function fitAndCenter(obj) {
  const box = new THREE.Box3().setFromObject(obj);
  const size = new THREE.Vector3();
  box.getSize(size);
  const center = new THREE.Vector3();
  box.getCenter(center);

  obj.position.sub(center);
  const maxDim = Math.max(size.x, size.y, size.z);
  if (maxDim > 0) obj.scale.setScalar(2.6 / maxDim);
}

function buildParticlesFromMesh(mesh, count) {
  const sampler = new MeshSurfaceSampler(mesh).build();
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  const sizes = new Float32Array(count);

  const p = new THREE.Vector3();
  const n = new THREE.Vector3();

  for (let i = 0; i < count; i++) {
    sampler.sample(p, n);
    const i3 = i * 3;
    positions[i3 + 0] = p.x;
    positions[i3 + 1] = p.y;
    positions[i3 + 2] = p.z;
    normals[i3 + 0] = n.x;
    normals[i3 + 1] = n.y;
    normals[i3 + 2] = n.z;
    seeds[i] = Math.random();
    sizes[i] = 0.85 + Math.random() * 0.30;
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  g.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

  return new THREE.Points(g, particlesMat);
}

const logoEl = document.querySelector('.center-logo');
function applyLogoProgress(p) {
  const s = 1 + 1.2 * p; // 1.0 → 2.2
  if (logoEl) {
    logoEl.style.setProperty('--logoScale', s);
    const op = 1 - THREE.MathUtils.smoothstep(p, 0.20, 0.65);
    logoEl.style.opacity = op.toFixed(3);
  }
}

/* ---------- carica GLB e crea particelle ---------- */
const gltfLoader = new GLTFLoader();
let particlePoints = null;
const pivot = new THREE.Group();
scene.add(pivot);

canvas.style.pointerEvents = 'auto';

// mouse → world
function updateMouseWorld(clientX, clientY){
  // coord normalizzate [-1,1]
  mouseNDC.x =  (clientX / window.innerWidth)  * 2 - 1;
  mouseNDC.y = -(clientY / window.innerHeight) * 2 + 1;

  // sposta il piano alla profondità del modello (pivot)
  pivot.getWorldPosition(tmpWorldPos);
  plane.constant = -tmpWorldPos.z;

  raycaster.setFromCamera(mouseNDC, camera);
  if (raycaster.ray.intersectPlane(plane, mouseWorld)) {
    // la prima volta: snap diretto, niente "warm-up"
    if (!hasMouseWorld) {
      hasMouseWorld = true;
      smoothMouseWorld.copy(mouseWorld);
      P.uMouseWorld.value.copy(mouseWorld);
    }
  }
}

// DESKTOP: interazione reale con mouse/touchpad
if (!IS_MOBILE) {
  window.addEventListener('mousemove', (e) => {
    updateMouseWorld(e.clientX, e.clientY);
  }, { passive: true });

  // opzionale: se vuoi tenere anche il touch su tablet non-mobile
  window.addEventListener('touchmove', (e) => {
    const t = e.touches[0];
    if (t) updateMouseWorld(t.clientX, t.clientY);
  }, { passive: true });
}

// su mobile niente mouseleave specifico perché la calamita è automatica
canvas.addEventListener('mouseleave', () => {
  hasMouseWorld = false; // dimentica la posizione: al prossimo ingresso faremo di nuovo lo "snap"
  mouseWorld.set(9999, 9999, 9999);
  smoothMouseWorld.set(9999, 9999, 9999);
  P.uMouseWorld.value.set(9999, 9999, 9999);
});

// posizione/rotazione modello nella scena
const MODEL_OFFSET = new THREE.Vector3(0, 0, 0);
const MODEL_ROT = { x: 0, y: Math.PI, z: 3.13 };

function addFromMesh(mesh) {
  const count = IS_MOBILE ? COUNT_MOBILE : COUNT_DESKTOP;
  particlePoints = buildParticlesFromMesh(mesh, count);
  fitAndCenter(particlePoints);

  pivot.clear();
  pivot.add(particlePoints);

  pivot.position.copy(MODEL_OFFSET);
  pivot.rotation.set(MODEL_ROT.x, MODEL_ROT.y, MODEL_ROT.z);
}

gltfLoader.load(
  'public/models/object.glb',
  (res) => {
    let srcMesh = null;
    res.scene.traverse(o => {
      if (o.isMesh && !srcMesh) srcMesh = o;
    });

    if (!srcMesh) {
      console.warn('Nessuna mesh nel GLB, uso torus.');
      addFromMesh(new THREE.Mesh(
        new THREE.TorusKnotGeometry(1, 0.35, 220, 32)
      ));
    } else {
      srcMesh.updateMatrixWorld(true);
      const meshClone = new THREE.Mesh(
        srcMesh.geometry.clone(),
        new THREE.MeshBasicMaterial()
      );
      meshClone.applyMatrix4(srcMesh.matrixWorld);
      addFromMesh(meshClone);
    }
  },
  undefined,
  (err) => {
    console.error('GLB load error', err);
    addFromMesh(new THREE.Mesh(
      new THREE.TorusKnotGeometry(1, 0.35, 220, 32)
    ));
  }
);

/* ---------- progress continuo sull’intera sticky ---------- */
function computeProgress() {
  const startY = heroSection.offsetTop;
  const endY = startY + heroSection.offsetHeight - window.innerHeight;
  const y = Math.min(Math.max(window.scrollY, startY), endY);
  return (y - startY) / (endY - startY);
}

function onScroll() {
  const p = computeProgress(); // 0..1
  P.uProgress.value = p;
  applyLogoProgress(p);

  if (nextSection) {
    // Gioiello 1 entra tra il 60% e il 100% dell'animazione
    const t = THREE.MathUtils.clamp((p - 0.60) / (1.0 - 0.60), 0, 1);

    nextSection.style.opacity = t.toFixed(3);
    const translateY = 30 * (1 - t); // da 30vh a 0vh
    nextSection.style.transform = `translate(-50%, ${translateY}vh)`;
    nextSection.style.pointerEvents = t > 0.01 ? 'auto' : 'none';
  }
}

window.addEventListener('scroll', onScroll, { passive: true });
onScroll();

/* ---------- parallax leggero camera ---------- */
const mouse = { x: 0, y: 0 };

function onMove(x, y) {
  mouse.x = x / window.innerWidth - 0.5;
  mouse.y = y / window.innerHeight - 0.5;
}

// DESKTOP: parallax controllato dal cursore
if (!IS_MOBILE) {
  window.addEventListener('mousemove', (e) => {
    onMove(e.clientX, e.clientY);
  }, { passive: true });

  window.addEventListener('touchmove', (e) => {
    const t = e.touches[0];
    if (t) onMove(t.clientX, t.clientY);
  }, { passive: true });
}

// su mobile nessun onMove -> camera rimane "centrata", solo animazione di scroll

/* ---------- resize ---------- */
window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});

/* ---------- refresh ---------- */
// Forza la pagina a tornare sempre all'inizio quando viene ricaricata
window.addEventListener("beforeunload", () => {
  window.scrollTo(0, 0);
});

/* ---------- loop ---------- */
const clock = new THREE.Clock();

function tick() {
  P.uTime.value = clock.getElapsedTime();

  // --- calamita / "bolla" ---
  if (IS_MOBILE) {
    // MOBILE: movimento automatico intorno al modello
    const t = P.uTime.value * 0.35;  // velocità dell'orbita
    pivot.getWorldPosition(tmpWorldPos);

    // piccolo percorso lissajous attorno al pivot
    const radiusX = 0.7;
    const radiusY = 1;

    autoMouseWorld.set(
      tmpWorldPos.x + Math.cos(t) * radiusX,
      tmpWorldPos.y + Math.sin(t * 0.8) * radiusY,
      tmpWorldPos.z
    );

    // smoothing morbido
    smoothMouseWorld.lerp(autoMouseWorld, 0.08);
    P.uMouseWorld.value.copy(smoothMouseWorld);
  } else {
    // DESKTOP: come prima, segue il cursore
    if (hasMouseWorld) {
      smoothMouseWorld.lerp(mouseWorld, 0.08);
      P.uMouseWorld.value.copy(smoothMouseWorld);
    } else {
      // nessun mouse "attivo" → tieni la calamita lontana
      P.uMouseWorld.value.set(9999, 9999, 9999);
    }
  }

  // camera dinamica
  const tx = mouse.x * 0.55;
  const ty = -mouse.y * 0.38 + 0.4;
  camera.position.x += (tx - camera.position.x) * 0.06;
  camera.position.y += (ty - camera.position.y) * 0.06;
  const targetZ = 6 - P.uProgress.value * 10;
  camera.position.z += (targetZ - camera.position.z) * 0.06;

  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}

tick();
