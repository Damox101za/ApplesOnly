'use strict';
// Animated "painted" background: slow, domain-warped noise in a few theme
// colours, drawn by a tiny WebGL shader. No dependencies.
//
// Usage: AnimatedBackground.mount(canvas, { scale, fps }). The canvas should
// fill a positioned parent. AnimatedBackground.setEnabled(false) switches every
// instance off (and back on) without a reload. Colours come from the CSS variables --hero-a/-b/-c on
// that parent, so the light/dark themes restyle it automatically.
//
// It stays cheap: it renders at half resolution (the image is soft anyway),
// caps at 30fps, and stops drawing when scrolled out of view, when the tab is
// hidden, or when the user prefers reduced motion (then it paints one still
// frame). Without WebGL the parent gets .hero-static and CSS paints a gradient.
(function () {
  const VERT = 'attribute vec2 a_pos; void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }';

  const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 u_res;
uniform float u_time;
uniform vec3 u_bg;
uniform vec3 u_c1;
uniform vec3 u_c2;
uniform vec3 u_c3;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p *= 2.02;
    a *= 0.5;
  }
  return v;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  vec2 p = (uv - 0.5) * vec2(u_res.x / u_res.y, 1.0) * 1.7;
  float t = u_time * 0.07;

  vec2 q = vec2(fbm(p + vec2(0.0, t)), fbm(p + vec2(5.2, 1.3) - t));
  vec2 r = vec2(fbm(p + 3.0 * q + vec2(1.7, 9.2) + 0.6 * t),
                fbm(p + 3.0 * q + vec2(8.3, 2.8) - 0.5 * t));
  float f = fbm(p + 3.0 * r);

  vec3 col = mix(u_bg, u_c1, smoothstep(0.15, 0.7, f));
  col = mix(col, u_c2, smoothstep(0.3, 0.95, length(q)));
  col = mix(col, u_c3, smoothstep(0.45, 1.0, r.x) * 0.85);
  // Ease back to the card colour toward the bottom so the hero blends in.
  col = mix(col, u_bg, smoothstep(0.55, 1.0, 1.0 - uv.y) * 0.45);
  gl_FragColor = vec4(col, 1.0);
}`;

  const STILL_TIME = 14.0; // a pleasant frame for reduced motion / paused states
  const DEFAULT_FPS = 30;
  const DEFAULT_SCALE = 0.5;

  // Global switch, shared by every instance. <html data-bg="off"> means off.
  let enabled = document.documentElement.dataset.bg !== 'off';
  const instances = [];

  function parseColor(css, fallback) {
    let m = /rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/.exec(css);
    if (m) return [m[1] / 255, m[2] / 255, m[3] / 255];
    m = /color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(css);
    if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
    return fallback;
  }

  // Resolve a CSS variable to rgb by letting the browser compute `color`.
  function readColor(host, varName, fallback) {
    const probe = document.createElement('span');
    probe.style.cssText = `position:absolute;visibility:hidden;color:var(${varName})`;
    host.appendChild(probe);
    const value = getComputedStyle(probe).color;
    probe.remove();
    return parseColor(value, fallback);
  }

  function readPalette(host) {
    return {
      bg: readColor(host, '--card', [1, 1, 1]),
      c1: readColor(host, '--hero-a', [0.78, 0.82, 1]),
      c2: readColor(host, '--hero-b', [0.65, 0.95, 0.99]),
      c3: readColor(host, '--hero-c', [0.98, 0.81, 0.91]),
    };
  }

  function compile(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(log || 'shader compile failed');
    }
    return shader;
  }

  function mount(canvas, options = {}) {
    const SCALE = options.scale || DEFAULT_SCALE;
    const FPS = options.fps || DEFAULT_FPS;
    const host = canvas.parentElement;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

    let gl = null;
    let program = null;
    let uniforms = null;
    let palette = null;
    let rafId = 0;
    let lastFrame = 0;
    let visible = true;
    let active = enabled;
    let ready = false;

    function fallBack() {
      host.classList.add('hero-static');
    }

    function setup() {
      gl = canvas.getContext('webgl', {
        alpha: false,
        antialias: false,
        depth: false,
        stencil: false,
        powerPreference: 'low-power',
        preserveDrawingBuffer: true,
      });
      if (!gl) return false;
      try {
        const vs = compile(gl, gl.VERTEX_SHADER, VERT);
        const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
        program = gl.createProgram();
        gl.attachShader(program, vs);
        gl.attachShader(program, fs);
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('link failed');
      } catch (err) {
        console.warn('AnimatedBackground disabled:', err.message);
        return false;
      }
      gl.useProgram(program);
      // One oversized triangle covers the whole viewport.
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(program, 'a_pos');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      uniforms = {
        res: gl.getUniformLocation(program, 'u_res'),
        time: gl.getUniformLocation(program, 'u_time'),
        bg: gl.getUniformLocation(program, 'u_bg'),
        c1: gl.getUniformLocation(program, 'u_c1'),
        c2: gl.getUniformLocation(program, 'u_c2'),
        c3: gl.getUniformLocation(program, 'u_c3'),
      };
      palette = readPalette(host);
      return true;
    }

    // The GL context is only created once the background is actually wanted.
    function init() {
      if (ready) return true;
      if (!setup()) {
        fallBack();
        return false;
      }
      ready = true;
      return true;
    }

    function resize() {
      const rect = host.getBoundingClientRect();
      const w = Math.max(1, Math.round(rect.width * SCALE));
      const h = Math.max(1, Math.round(rect.height * SCALE));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
    }

    function draw(seconds) {
      if (!active || !ready || gl.isContextLost()) return;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(uniforms.res, canvas.width, canvas.height);
      gl.uniform1f(uniforms.time, seconds);
      gl.uniform3fv(uniforms.bg, palette.bg);
      gl.uniform3fv(uniforms.c1, palette.c1);
      gl.uniform3fv(uniforms.c2, palette.c2);
      gl.uniform3fv(uniforms.c3, palette.c3);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    function frame(now) {
      rafId = requestAnimationFrame(frame);
      if (now - lastFrame < 1000 / FPS) return;
      lastFrame = now;
      draw(now / 1000);
    }

    function stopLoop() {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
    }

    // Run only while it can actually be seen and motion is welcome.
    function sync() {
      if (!active || !ready) {
        stopLoop();
        return;
      }
      if (visible) resize(); // the host may have been hidden (0x0) or resized meanwhile
      const shouldRun = visible && !document.hidden && !reduceMotion.matches;
      if (shouldRun && !rafId) {
        rafId = requestAnimationFrame(frame);
      } else if (!shouldRun) {
        stopLoop();
        draw(STILL_TIME);
      }
    }

    function refreshColors() {
      if (!active || !ready) return;
      palette = readPalette(host);
      if (!rafId) draw(STILL_TIME);
    }

    function enable() {
      active = true;
      if (!init()) return;
      resize();
      draw(STILL_TIME);
      sync();
    }

    function disable() {
      active = false;
      stopLoop();
    }

    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      stopLoop();
    });
    canvas.addEventListener('webglcontextrestored', () => {
      ready = false;
      if (active && init()) {
        resize();
        sync();
      }
    });

    new ResizeObserver(() => {
      if (!active || !ready) return;
      resize();
      if (!rafId) draw(STILL_TIME);
    }).observe(host);
    new IntersectionObserver((entries) => {
      visible = entries[entries.length - 1].isIntersecting;
      sync();
    }).observe(host);
    window.addEventListener('resize', () => {
      if (!active || !ready) return;
      resize();
      if (!rafId) draw(STILL_TIME);
    });
    document.addEventListener('visibilitychange', sync);
    reduceMotion.addEventListener('change', sync);

    // Re-read the palette when the theme flips (toggle button or system).
    new MutationObserver(refreshColors).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    darkQuery.addEventListener('change', refreshColors);

    const handle = { canvas, enable, disable };
    instances.push(handle);
    if (active && init()) {
      resize();
      draw(STILL_TIME);
      sync();
    }
    return handle;
  }

  function setEnabled(on) {
    enabled = Boolean(on);
    instances.forEach((i) => (enabled ? i.enable() : i.disable()));
  }

  window.AnimatedBackground = { mount, setEnabled };
})();
