/* Login-page-only visuals. Self-contained: no App/config dependencies, so it
 * works even before env.json resolves. Two responsibilities:
 *   1. The animated WebGL mesh-gradient panel (+ palette shuffle button).
 *      Honors prefers-reduced-motion (single static frame, no loop) and falls
 *      back to a CSS gradient (.mesh-fallback) when WebGL is unavailable.
 *   2. The password reveal (eye) toggle on the sign-in form.
 */
(function () {
  'use strict';

  /* ---------- password reveal ---------- */
  var revealBtn = document.getElementById('pwReveal');
  var pwInput = document.getElementById('pwPassword');
  if (revealBtn && pwInput) {
    revealBtn.addEventListener('click', function () {
      var show = pwInput.type === 'password';
      pwInput.type = show ? 'text' : 'password';
      revealBtn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      revealBtn.setAttribute('aria-pressed', show ? 'true' : 'false');
      var icon = revealBtn.querySelector('i');
      if (icon) icon.className = show ? 'ti ti-eye-off' : 'ti ti-eye';
      pwInput.focus({ preventScroll: true });
    });
  }

  /* ---------- mesh gradient panel ---------- */
  var canvas = document.getElementById('meshCanvas');
  if (!canvas) return;
  var panel = canvas.parentElement;
  var nameEl = document.getElementById('meshPaletteName');
  var shuffleBtn = document.getElementById('meshShuffle');

  // Four-stop palettes (linear-ish RGB floats). Ember first: brand-warm default.
  var PALETTES = [
    { name: 'Ember',  colors: [[0.10, 0.04, 0.04], [0.62, 0.26, 0.10], [0.45, 0.10, 0.10], [0.10, 0.05, 0.05]] },
    { name: 'Sunset', colors: [[0.10, 0.05, 0.10], [0.62, 0.22, 0.28], [0.50, 0.38, 0.20], [0.18, 0.05, 0.12]] },
    { name: 'Slate',  colors: [[0.04, 0.04, 0.07], [0.13, 0.13, 0.17], [0.22, 0.22, 0.30], [0.06, 0.06, 0.10]] },
    { name: 'Forest', colors: [[0.04, 0.09, 0.07], [0.08, 0.32, 0.26], [0.10, 0.20, 0.32], [0.05, 0.11, 0.10]] },
    { name: 'Aurora', colors: [[0.05, 0.08, 0.16], [0.10, 0.32, 0.48], [0.42, 0.20, 0.58], [0.06, 0.10, 0.18]] },
    { name: 'Plum',   colors: [[0.10, 0.05, 0.14], [0.50, 0.16, 0.50], [0.26, 0.10, 0.42], [0.08, 0.04, 0.12]] }
  ];

  var VERT_SRC =
    'attribute vec2 a_position;' +
    'void main() { gl_Position = vec4(a_position, 0.0, 1.0); }';

  var FRAG_SRC = [
    'precision mediump float;',
    'uniform vec2 u_resolution;',
    'uniform float u_time;',
    'uniform vec3 u_c0;',
    'uniform vec3 u_c1;',
    'uniform vec3 u_c2;',
    'uniform vec3 u_c3;',
    'void main() {',
    '  vec2 uv = gl_FragCoord.xy / u_resolution;',
    '  uv.y = 1.0 - uv.y;',
    '  float t = u_time * 0.00015;',
    '  vec2 p0 = vec2(0.30 + sin(t * 0.70) * 0.25, 0.25 + cos(t * 0.60) * 0.20);',
    '  vec2 p1 = vec2(0.75 + cos(t * 0.50) * 0.20, 0.70 + sin(t * 0.80) * 0.20);',
    '  vec2 p2 = vec2(0.50 + sin(t * 0.40 + 1.0) * 0.30, 0.50 + cos(t * 0.70) * 0.25);',
    '  vec2 p3 = vec2(0.20 + cos(t * 0.55) * 0.20, 0.85 + sin(t * 0.45) * 0.15);',
    '  float r = 0.55;',
    '  float d0 = pow(1.0 - smoothstep(0.0, r, distance(uv, p0)), 1.4);',
    '  float d1 = pow(1.0 - smoothstep(0.0, r, distance(uv, p1)), 1.4);',
    '  float d2 = pow(1.0 - smoothstep(0.0, r, distance(uv, p2)), 1.4);',
    '  float d3 = pow(1.0 - smoothstep(0.0, r, distance(uv, p3)), 1.4);',
    '  float total = d0 + d1 + d2 + d3 + 0.0001;',
    '  vec3 col = (u_c0 * d0 + u_c1 * d1 + u_c2 * d2 + u_c3 * d3) / total;',
    '  float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);',
    '  col += (n - 0.5) * 0.025;',
    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  var paletteIndex = 0;
  var target = PALETTES[0].colors;
  // Deep copy so easing mutates its own state, never the palette table.
  var current = target.map(function (c) { return c.slice(); });

  var reducedMotion = false;
  try {
    reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (e) {}

  function fallback() {
    if (panel) panel.classList.add('mesh-fallback');
    canvas.style.display = 'none';
  }

  var gl = null;
  try {
    gl = canvas.getContext('webgl', { antialias: false, alpha: false });
  } catch (e) {}
  if (!gl) return fallback();

  function compile(type, src) {
    var sh = gl.createShader(type);
    if (!sh) return null;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      gl.deleteShader(sh);
      return null;
    }
    return sh;
  }

  var vs = compile(gl.VERTEX_SHADER, VERT_SRC);
  var fs = compile(gl.FRAGMENT_SHADER, FRAG_SRC);
  if (!vs || !fs) return fallback();

  var prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return fallback();
  gl.useProgram(prog);

  var buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    gl.STATIC_DRAW
  );
  var posLoc = gl.getAttribLocation(prog, 'a_position');
  gl.enableVertexAttribArray(posLoc);
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

  var uRes = gl.getUniformLocation(prog, 'u_resolution');
  var uTime = gl.getUniformLocation(prog, 'u_time');
  var uC = [
    gl.getUniformLocation(prog, 'u_c0'),
    gl.getUniformLocation(prog, 'u_c1'),
    gl.getUniformLocation(prog, 'u_c2'),
    gl.getUniformLocation(prog, 'u_c3')
  ];

  function resize() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
    var h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
    }
  }

  function draw(t) {
    resize();
    gl.uniform2f(uRes, canvas.width, canvas.height);
    gl.uniform1f(uTime, t);
    for (var i = 0; i < 4; i++) {
      gl.uniform3f(uC[i], current[i][0], current[i][1], current[i][2]);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  // Back-date the clock so the first paint lands mid-animation — the t=0
  // composition parks most blobs off in one corner.
  var start = performance.now() - 90000;

  var STATIC_T = 90000; // same mid-animation frame as the seeded clock

  if (reducedMotion) {
    // One static frame; shuffle snaps to the new palette without animating.
    draw(STATIC_T);
    if (window.ResizeObserver) {
      new ResizeObserver(function () { draw(STATIC_T); }).observe(canvas);
    }
  } else {
    if (window.ResizeObserver) {
      new ResizeObserver(resize).observe(canvas);
    } else {
      window.addEventListener('resize', resize);
    }
    var tick = function (now) {
      // Ease current palette toward target (~600ms feel).
      var k = 0.06;
      for (var i = 0; i < 4; i++) {
        for (var j = 0; j < 3; j++) {
          current[i][j] += (target[i][j] - current[i][j]) * k;
        }
      }
      draw(now - start);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  if (shuffleBtn) {
    shuffleBtn.addEventListener('click', function () {
      var next = paletteIndex;
      while (next === paletteIndex) {
        next = Math.floor(Math.random() * PALETTES.length);
      }
      paletteIndex = next;
      target = PALETTES[next].colors;
      if (nameEl) nameEl.textContent = PALETTES[next].name;
      if (reducedMotion) {
        current = target.map(function (c) { return c.slice(); });
        draw(STATIC_T);
      }
    });
  }
})();
