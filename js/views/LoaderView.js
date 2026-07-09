window.App = window.App || {};

/* Boot loading screen — a vanilla port of the React Bits "FaultyTerminal" WebGL
   component (the app is a zero-build static SPA, so the JSX/OGL original can't run
   here — the shader is compiled with raw WebGL, the same way js/login-fx.js drives
   the login mesh gradient). A brand-tinted CRT terminal animates full-screen while
   the centered Quest HQ mark sits on top so it still reads as "loading".

   Mounts itself into #appLoader as soon as this script runs (placed right after the
   div in app.html); app.js calls App.hideAppLoader() once boot finishes.

   No external dependency: honors prefers-reduced-motion (single static frame, no
   loop) and falls back to a CSS gradient (.ldr-fallback) when WebGL is unavailable.
   Classes are prefixed `ldr-` so generic names can't clash with app styles. */
App.LoaderView = (function () {
  const MIN_MS = 1000;   // keep it on screen long enough to be seen
  const FINISH_MS = 400; // "loading complete" beat: ease the terminal to full
  const FADE_MS = 600;   // must match the #appLoader opacity transition
  const MAX_MS = 15000;  // safety: dismiss even if boot never signals

  // FaultyTerminal knobs. Tint is Quest HQ brand orange (#ED4E0D) as sRGB floats
  // — swap this one line to re-colour the whole effect. brightness is kept low so
  // the terminal reads as a backdrop behind the centered brand mark.
  const CFG = {
    scale: 1.5,
    gridMul: [2.0, 1.0],
    digitSize: 1.2,
    timeScale: 0.5,
    scanlineIntensity: 0.5,
    glitchAmount: 1.0,
    flickerAmount: 1.0,
    noiseAmp: 1.0,
    chromaticAberration: 0.0,
    dither: 0.0,
    curvature: 0.1,
    tint: [0.929, 0.306, 0.051], // #ED4E0D
    mouseReact: true,
    mouseStrength: 0.5,
    pageLoadAnimation: true,
    brightness: 0.6
  };

  // Fullscreen triangle. uv is derived from position so the fragment sees the same
  // 0..2 range OGL's Triangle would have produced (vUv = position*0.5 + 0.5).
  const VERT_SRC = [
    'attribute vec2 position;',
    'varying vec2 vUv;',
    'void main() {',
    '  vUv = position * 0.5 + 0.5;',
    '  gl_Position = vec4(position, 0.0, 1.0);',
    '}'
  ].join('\n');

  // Fragment shader ported verbatim from the React Bits FaultyTerminal component.
  const FRAG_SRC = `precision mediump float;

varying vec2 vUv;

uniform float iTime;
uniform vec3  iResolution;
uniform float uScale;

uniform vec2  uGridMul;
uniform float uDigitSize;
uniform float uScanlineIntensity;
uniform float uGlitchAmount;
uniform float uFlickerAmount;
uniform float uNoiseAmp;
uniform float uChromaticAberration;
uniform float uDither;
uniform float uCurvature;
uniform vec3  uTint;
uniform vec2  uMouse;
uniform float uMouseStrength;
uniform float uUseMouse;
uniform float uPageLoadProgress;
uniform float uUsePageLoadAnimation;
uniform float uBrightness;

float time;

float hash21(vec2 p){
  p = fract(p * 234.56);
  p += dot(p, p + 34.56);
  return fract(p.x * p.y);
}

float noise(vec2 p)
{
  return sin(p.x * 10.0) * sin(p.y * (3.0 + sin(time * 0.090909))) + 0.2;
}

mat2 rotate(float angle)
{
  float c = cos(angle);
  float s = sin(angle);
  return mat2(c, -s, s, c);
}

float fbm(vec2 p)
{
  p *= 1.1;
  float f = 0.0;
  float amp = 0.5 * uNoiseAmp;

  mat2 modify0 = rotate(time * 0.02);
  f += amp * noise(p);
  p = modify0 * p * 2.0;
  amp *= 0.454545;

  mat2 modify1 = rotate(time * 0.02);
  f += amp * noise(p);
  p = modify1 * p * 2.0;
  amp *= 0.454545;

  mat2 modify2 = rotate(time * 0.08);
  f += amp * noise(p);

  return f;
}

float pattern(vec2 p, out vec2 q, out vec2 r) {
  vec2 offset1 = vec2(1.0);
  vec2 offset0 = vec2(0.0);
  mat2 rot01 = rotate(0.1 * time);
  mat2 rot1 = rotate(0.1);

  q = vec2(fbm(p + offset1), fbm(rot01 * p + offset1));
  r = vec2(fbm(rot1 * q + offset0), fbm(q + offset0));
  return fbm(p + r);
}

float digit(vec2 p){
    vec2 grid = uGridMul * 15.0;
    vec2 s = floor(p * grid) / grid;
    p = p * grid;
    vec2 q, r;
    float intensity = pattern(s * 0.1, q, r) * 1.3 - 0.03;

    if(uUseMouse > 0.5){
        vec2 mouseWorld = uMouse * uScale;
        float distToMouse = distance(s, mouseWorld);
        float mouseInfluence = exp(-distToMouse * 8.0) * uMouseStrength * 10.0;
        intensity += mouseInfluence;

        float ripple = sin(distToMouse * 20.0 - iTime * 5.0) * 0.1 * mouseInfluence;
        intensity += ripple;
    }

    if(uUsePageLoadAnimation > 0.5){
        float cellRandom = fract(sin(dot(s, vec2(12.9898, 78.233))) * 43758.5453);
        float cellDelay = cellRandom * 0.8;
        float cellProgress = clamp((uPageLoadProgress - cellDelay) / 0.2, 0.0, 1.0);

        float fadeAlpha = smoothstep(0.0, 1.0, cellProgress);
        intensity *= fadeAlpha;
    }

    p = fract(p);
    p *= uDigitSize;

    float px5 = p.x * 5.0;
    float py5 = (1.0 - p.y) * 5.0;
    float x = fract(px5);
    float y = fract(py5);

    float i = floor(py5) - 2.0;
    float j = floor(px5) - 2.0;
    float n = i * i + j * j;
    float f = n * 0.0625;

    float isOn = step(0.1, intensity - f);
    float brightness = isOn * (0.2 + y * 0.8) * (0.75 + x * 0.25);

    return step(0.0, p.x) * step(p.x, 1.0) * step(0.0, p.y) * step(p.y, 1.0) * brightness;
}

float onOff(float a, float b, float c)
{
  return step(c, sin(iTime + a * cos(iTime * b))) * uFlickerAmount;
}

float displace(vec2 look)
{
    float y = look.y - mod(iTime * 0.25, 1.0);
    float window = 1.0 / (1.0 + 50.0 * y * y);
    return sin(look.y * 20.0 + iTime) * 0.0125 * onOff(4.0, 2.0, 0.8) * (1.0 + cos(iTime * 60.0)) * window;
}

vec3 getColor(vec2 p){

    float bar = step(mod(p.y + time * 20.0, 1.0), 0.2) * 0.4 + 1.0;
    bar *= uScanlineIntensity;

    float displacement = displace(p);
    p.x += displacement;

    if (uGlitchAmount != 1.0) {
      float extra = displacement * (uGlitchAmount - 1.0);
      p.x += extra;
    }

    float middle = digit(p);

    const float off = 0.002;
    float sum = digit(p + vec2(-off, -off)) + digit(p + vec2(0.0, -off)) + digit(p + vec2(off, -off)) +
                digit(p + vec2(-off, 0.0)) + digit(p + vec2(0.0, 0.0)) + digit(p + vec2(off, 0.0)) +
                digit(p + vec2(-off, off)) + digit(p + vec2(0.0, off)) + digit(p + vec2(off, off));

    vec3 baseColor = vec3(0.9) * middle + sum * 0.1 * vec3(1.0) * bar;
    return baseColor;
}

vec2 barrel(vec2 uv){
  vec2 c = uv * 2.0 - 1.0;
  float r2 = dot(c, c);
  c *= 1.0 + uCurvature * r2;
  return c * 0.5 + 0.5;
}

void main() {
    time = iTime * 0.333333;
    vec2 uv = vUv;

    if(uCurvature != 0.0){
      uv = barrel(uv);
    }

    vec2 p = uv * uScale;
    vec3 col = getColor(p);

    if(uChromaticAberration != 0.0){
      vec2 ca = vec2(uChromaticAberration) / iResolution.xy;
      col.r = getColor(p + ca).r;
      col.b = getColor(p - ca).b;
    }

    col *= uTint;
    col *= uBrightness;

    if(uDither > 0.0){
      float rnd = hash21(gl_FragCoord.xy);
      col += (rnd - 0.5) * (uDither * 0.003922);
    }

    gl_FragColor = vec4(col, 1.0);
}`;

  let mountAt = 0;
  let hiding = false;
  let stopped = false;
  let rafId = 0;
  let gl = null;
  let canvasEl = null;
  let rootEl = null;
  let onMouseMove = null;
  let resizeObs = null;
  let animating = false;   // true only while the WebGL render loop is running
  let finishing = false;   // hide() ramps the terminal to full before it fades
  let finishStart = 0;
  let progressAtFinish = 0;
  let curProgress = 0;     // latest page-load progress the loop rendered

  function build() {
    const root = document.getElementById('appLoader');
    if (!root || root.dataset.built) return;
    root.dataset.built = '1';
    root.innerHTML = ''; // drop the static first frame (app.html); the shader replaces it
    rootEl = root;
    mountAt = Date.now();

    const intro = document.createElement('section');
    intro.className = 'ldr-intro';

    const canvas = document.createElement('canvas');
    canvas.className = 'ldr-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    intro.appendChild(canvas);
    canvasEl = canvas;

    const brand = document.createElement('div');
    brand.className = 'ldr-brand';
    brand.innerHTML =
      '<div class="ldr-logo"><i class="ti ti-bolt"></i></div>' +
      '<div class="ldr-name">Quest HQ</div>' +
      '<div class="ldr-dots"><span></span><span></span><span></span></div>';
    intro.appendChild(brand);

    root.appendChild(intro);
    startTerminal(canvas, intro);

    // Safety net: never let the loader trap the app if boot silently fails.
    setTimeout(hide, MAX_MS);
  }

  function startTerminal(canvas, intro) {
    let reducedMotion = false;
    try {
      reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (e) {}

    function fallback() {
      if (intro) intro.classList.add('ldr-fallback');
      if (canvas) canvas.style.display = 'none';
    }

    try {
      gl = canvas.getContext('webgl', { antialias: false, alpha: false });
    } catch (e) {}
    if (!gl) return fallback();

    function compile(type, src) {
      const sh = gl.createShader(type);
      if (!sh) return null;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        gl.deleteShader(sh);
        return null;
      }
      return sh;
    }

    const vs = compile(gl.VERTEX_SHADER, VERT_SRC);
    const fs = compile(gl.FRAGMENT_SHADER, FRAG_SRC);
    if (!vs || !fs) return fallback();

    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return fallback();
    gl.useProgram(prog);
    gl.clearColor(0, 0, 0, 1);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const posLoc = gl.getAttribLocation(prog, 'position');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    const U = (name) => gl.getUniformLocation(prog, name);
    const uni = {
      iTime: U('iTime'),
      iResolution: U('iResolution'),
      uScale: U('uScale'),
      uGridMul: U('uGridMul'),
      uDigitSize: U('uDigitSize'),
      uScanlineIntensity: U('uScanlineIntensity'),
      uGlitchAmount: U('uGlitchAmount'),
      uFlickerAmount: U('uFlickerAmount'),
      uNoiseAmp: U('uNoiseAmp'),
      uChromaticAberration: U('uChromaticAberration'),
      uDither: U('uDither'),
      uCurvature: U('uCurvature'),
      uTint: U('uTint'),
      uMouse: U('uMouse'),
      uMouseStrength: U('uMouseStrength'),
      uUseMouse: U('uUseMouse'),
      uPageLoadProgress: U('uPageLoadProgress'),
      uUsePageLoadAnimation: U('uUsePageLoadAnimation'),
      uBrightness: U('uBrightness')
    };

    // Static uniforms — set once.
    gl.uniform1f(uni.uScale, CFG.scale);
    gl.uniform2f(uni.uGridMul, CFG.gridMul[0], CFG.gridMul[1]);
    gl.uniform1f(uni.uDigitSize, CFG.digitSize);
    gl.uniform1f(uni.uScanlineIntensity, CFG.scanlineIntensity);
    gl.uniform1f(uni.uGlitchAmount, CFG.glitchAmount);
    gl.uniform1f(uni.uFlickerAmount, CFG.flickerAmount);
    gl.uniform1f(uni.uNoiseAmp, CFG.noiseAmp);
    gl.uniform1f(uni.uChromaticAberration, CFG.chromaticAberration);
    gl.uniform1f(uni.uDither, CFG.dither);
    gl.uniform1f(uni.uCurvature, CFG.curvature);
    gl.uniform3f(uni.uTint, CFG.tint[0], CFG.tint[1], CFG.tint[2]);
    gl.uniform1f(uni.uMouseStrength, CFG.mouseStrength);
    gl.uniform1f(uni.uUseMouse, CFG.mouseReact && !reducedMotion ? 1 : 0);
    gl.uniform1f(uni.uUsePageLoadAnimation, CFG.pageLoadAnimation && !reducedMotion ? 1 : 0);
    gl.uniform1f(uni.uBrightness, CFG.brightness);

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
      const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
      gl.uniform3f(uni.iResolution, canvas.width, canvas.height, canvas.width / canvas.height);
    }

    // Mouse ripple: normalized coords over the loader, smoothed toward the target.
    const mouse = { x: 0.5, y: 0.5 };
    const smooth = { x: 0.5, y: 0.5 };
    if (CFG.mouseReact && !reducedMotion) {
      onMouseMove = (e) => {
        const rect = canvas.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        mouse.x = (e.clientX - rect.left) / rect.width;
        mouse.y = 1 - (e.clientY - rect.top) / rect.height;
      };
      rootEl.addEventListener('mousemove', onMouseMove);
    }

    const timeOffset = Math.random() * 100;

    if (reducedMotion) {
      // One static frame — a settled mid-animation composition, fully faded in.
      resize();
      gl.uniform1f(uni.uPageLoadProgress, 1);
      gl.uniform2f(uni.uMouse, 0.5, 0.5); // unused (uUseMouse=0) but keep it defined
      gl.uniform1f(uni.iTime, 30 * CFG.timeScale);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (window.ResizeObserver) {
        resizeObs = new ResizeObserver(() => {
          resize();
          gl.uniform1f(uni.iTime, 30 * CFG.timeScale);
          gl.clear(gl.COLOR_BUFFER_BIT);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
        });
        resizeObs.observe(canvas);
      }
      return;
    }

    if (window.ResizeObserver) {
      resizeObs = new ResizeObserver(resize);
      resizeObs.observe(canvas);
    } else {
      window.addEventListener('resize', resize);
    }
    resize();

    let loadStart = 0;
    const tick = (now) => {
      if (stopped) return;
      rafId = requestAnimationFrame(tick);

      let progress;
      if (finishing) {
        // Loading is done: ease the terminal up to its full, materialized state
        // and hold there, so it reads as "complete" before the overlay fades.
        const k = Math.min((now - finishStart) / FINISH_MS, 1);
        const eased = 1 - Math.pow(1 - k, 3); // easeOutCubic
        progress = progressAtFinish + (1 - progressAtFinish) * eased;
      } else if (CFG.pageLoadAnimation) {
        if (loadStart === 0) loadStart = now;
        progress = Math.min((now - loadStart) / 2000, 1);
      } else {
        progress = 1;
      }
      curProgress = progress;
      gl.uniform1f(uni.uPageLoadProgress, progress);

      gl.uniform1f(uni.iTime, (now * 0.001 + timeOffset) * CFG.timeScale);

      if (CFG.mouseReact) {
        smooth.x += (mouse.x - smooth.x) * 0.08;
        smooth.y += (mouse.y - smooth.y) * 0.08;
        gl.uniform2f(uni.uMouse, smooth.x, smooth.y);
      }

      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    animating = true;
    rafId = requestAnimationFrame(tick);
  }

  // Immediate teardown of the render loop + listeners (no DOM removal). Safe to call
  // from the role-gate / fatal-error paths before they replace document.body.
  function stop() {
    if (stopped) return;
    stopped = true;
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    if (resizeObs) { resizeObs.disconnect(); resizeObs = null; }
    if (onMouseMove && rootEl) { rootEl.removeEventListener('mousemove', onMouseMove); onMouseMove = null; }
    if (gl) {
      const ext = gl.getExtension('WEBGL_lose_context');
      if (ext) ext.loseContext();
      gl = null;
    }
  }

  // Graceful hide: enforce a minimum on-screen time, ease the terminal to its
  // full/complete state, then fade the overlay out. The render loop keeps running
  // through the fade and is only torn down afterwards — tearing the GL context
  // down first would blank the canvas to flat black (the hard-cut "flash").
  function hide() {
    if (hiding) return;
    hiding = true;
    const root = document.getElementById('appLoader');
    if (!root) { stop(); return; }
    const wait = Math.max(0, MIN_MS - (Date.now() - mountAt));
    const fadeThenRemove = () => {
      root.classList.add('is-hiding');
      setTimeout(() => {
        stop();
        if (root.parentNode) root.parentNode.removeChild(root);
      }, FADE_MS);
    };
    setTimeout(() => {
      if (animating && !stopped) {
        // Complete the terminal (ramp glyphs to full), hold, then fade.
        progressAtFinish = curProgress;
        finishStart = performance.now();
        finishing = true;
        setTimeout(fadeThenRemove, FINISH_MS);
      } else {
        // reduced-motion / no-WebGL fallback: already a full static frame.
        fadeThenRemove();
      }
    }, wait);
  }

  // Mount now — this script is placed immediately after #appLoader in app.html.
  build();

  return { hide, stop, build };
})();

App.hideAppLoader = function () { if (App.LoaderView) App.LoaderView.hide(); };
