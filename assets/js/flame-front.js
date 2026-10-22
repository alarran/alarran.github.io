/* Background animation: a premixed flame front wrinkled by the Darrieus–Landau /
   thermo-diffusive instability, modeled by the Kuramoto–Sivashinsky equation
   in its front-displacement form

     phi_t + phi_xx + phi_xxxx + (1/2) phi_x^2 = 0.

   We integrate the derivative u = phi_x (u_t + u u_x + u_xx + u_xxxx = 0) with a
   Fourier pseudo-spectral method and ETDRK4 time stepping (Kassam & Trefethen 2005),
   then recover phi = u_hat / (ik). The flame propagates down the screen; earlier
   positions of the front are drawn as fading isochrones drifting back into the
   burnt gas, so cusps point up and the rounded cells bulge toward the reactants. */
(function () {
  var canvas = document.createElement('canvas');
  var ctx = canvas.getContext('2d');
  if (!ctx) return;
  canvas.className = 'flame-bg';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.insertBefore(canvas, document.body.firstChild);

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  /* Same ink as the site's accents */
  var INK = '90, 95, 135';      /* #5a5f87 */

  var H_STEP = 0.1;           /* solver time step */
  var SIM_SPEED = 0.3;        /* KS time units per second of wall clock */
  var CAPTURE_EVERY = 6;      /* steps between stored isochrones */
  var SPACING = 32;           /* px between successive isochrones */
  var PX_PER_UNIT = 10;       /* horizontal px per KS length unit (cells are ~9 units wide) */
  var CONTENT_WIDTH = 1040;   /* matches .profile-container max-width */

  var W, H, dpr, N, Lx, k, E, E2, Q, f1, f2, f3;
  var v, phiPrev, phiCur, history, stepCount, simTime, accum, lastFrame, rafId;
  var amp, frontY;

  /* ─── FFT (in-place radix-2, complex) ─────────────────────────── */

  var fre, fim, rev;

  function fftInit(n) {
    fre = new Float64Array(n);
    fim = new Float64Array(n);
    rev = new Uint32Array(n);
    var bits = Math.log2(n);
    for (var i = 0; i < n; i++) {
      var r = 0;
      for (var b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      rev[i] = r;
    }
  }

  function fft(re, im, inverse) {
    var n = re.length, i, j, t;
    for (i = 0; i < n; i++) {
      j = rev[i];
      if (j > i) {
        t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (var size = 2; size <= n; size <<= 1) {
      var half = size >> 1;
      var ang = (inverse ? 2 : -2) * Math.PI / size;
      var wr = Math.cos(ang), wi = Math.sin(ang);
      for (i = 0; i < n; i += size) {
        var cr = 1, ci = 0;
        for (j = 0; j < half; j++) {
          var a = i + j, b = a + half;
          var tr = re[b] * cr - im[b] * ci;
          var ti = re[b] * ci + im[b] * cr;
          re[b] = re[a] - tr; im[b] = im[a] - ti;
          re[a] += tr; im[a] += ti;
          t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
        }
      }
    }
  }

  /* Half spectra (modes 0..N/2) are stored as interleaved [re, im] pairs. Working
     with real transforms keeps the spectrum Hermitian; with a full complex spectrum
     roundoff seeds an anti-Hermitian part that the nonlinearity never sees and the
     linear instability grows without bound. */
  function irfft(spec, out) {
    var n = N, m = n >> 1, j;
    for (j = 0; j <= m; j++) { fre[j] = spec[2 * j]; fim[j] = spec[2 * j + 1]; }
    for (j = 1; j < m; j++) { fre[n - j] = fre[j]; fim[n - j] = -fim[j]; }
    fft(fre, fim, true);
    for (j = 0; j < n; j++) out[j] = fre[j] / n;
  }

  function rfft(x, spec) {
    var m = N >> 1, j;
    for (j = 0; j < N; j++) { fre[j] = x[j]; fim[j] = 0; }
    fft(fre, fim, false);
    for (j = 0; j <= m; j++) { spec[2 * j] = fre[j]; spec[2 * j + 1] = fim[j]; }
  }

  /* ─── Kuramoto–Sivashinsky solver ─────────────────────────────── */

  var uTmp, sqTmp, Nv, Na, Nb, Nc, sa, sb, sc;

  /* Nonlinear term -(1/2) ik FFT(u^2) */
  function nonlinear(spec, out) {
    irfft(spec, uTmp);
    for (var j = 0; j < N; j++) sqTmp[j] = uTmp[j] * uTmp[j];
    rfft(sqTmp, out);
    for (var m = 0; m <= N / 2; m++) {
      var g = -0.5 * k[m], re = out[2 * m], im = out[2 * m + 1];
      out[2 * m] = -g * im;
      out[2 * m + 1] = g * re;
    }
  }

  /* ETDRK4 coefficients by contour integral, which avoids cancellation near L = 0 */
  function setupCoefficients() {
    var m = N / 2 + 1, M = 16;
    k = new Float64Array(m); E = new Float64Array(m); E2 = new Float64Array(m);
    Q = new Float64Array(m); f1 = new Float64Array(m); f2 = new Float64Array(m); f3 = new Float64Array(m);
    for (var j = 0; j < m; j++) {
      k[j] = j === N / 2 ? 0 : 2 * Math.PI * j / Lx;
      var L = k[j] * k[j] - k[j] * k[j] * k[j] * k[j];
      E[j] = Math.exp(H_STEP * L);
      E2[j] = Math.exp(H_STEP * L / 2);
      var q = 0, a = 0, b = 0, c = 0;
      for (var p = 1; p <= M; p++) {
        var th = Math.PI * (p - 0.5) / M;
        var zr = H_STEP * L + Math.cos(th), zi = Math.sin(th);
        q += cdivRe(cexpm1Half(zr, zi), zr, zi);
        var ez = Math.exp(zr), er = ez * Math.cos(zi), ei = ez * Math.sin(zi);
        var z2r = zr * zr - zi * zi, z2i = 2 * zr * zi;
        var z3r = z2r * zr - z2i * zi, z3i = z2r * zi + z2i * zr;
        /* f1: (-4 - z + e^z (4 - 3z + z^2)) / z^3 */
        var pr = 4 - 3 * zr + z2r, pi = -3 * zi + z2i;
        a += cdivRe([-4 - zr + er * pr - ei * pi, -zi + er * pi + ei * pr], z3r, z3i);
        /* f2: (2 + z + e^z (z - 2)) / z^3 */
        pr = zr - 2; pi = zi;
        b += cdivRe([2 + zr + er * pr - ei * pi, zi + er * pi + ei * pr], z3r, z3i);
        /* f3: (-4 - 3z - z^2 + e^z (4 - z)) / z^3 */
        pr = 4 - zr; pi = -zi;
        c += cdivRe([-4 - 3 * zr - z2r + er * pr - ei * pi, -3 * zi - z2i + er * pi + ei * pr], z3r, z3i);
      }
      Q[j] = H_STEP * q / M;
      f1[j] = H_STEP * a / M;
      f2[j] = H_STEP * b / M;
      f3[j] = H_STEP * c / M;
    }
  }

  function cexpm1Half(zr, zi) {
    var e = Math.exp(zr / 2);
    return [e * Math.cos(zi / 2) - 1, e * Math.sin(zi / 2)];
  }

  function cdivRe(num, dr, di) {
    return (num[0] * dr + num[1] * di) / (dr * dr + di * di);
  }

  function step() {
    var len = N + 2, j, m;
    nonlinear(v, Nv);
    for (j = 0; j < len; j++) { m = j >> 1; sa[j] = E2[m] * v[j] + Q[m] * Nv[j]; }
    nonlinear(sa, Na);
    for (j = 0; j < len; j++) { m = j >> 1; sb[j] = E2[m] * v[j] + Q[m] * Na[j]; }
    nonlinear(sb, Nb);
    for (j = 0; j < len; j++) { m = j >> 1; sc[j] = E2[m] * sa[j] + Q[m] * (2 * Nb[j] - Nv[j]); }
    nonlinear(sc, Nc);
    for (j = 0; j < len; j++) {
      m = j >> 1;
      v[j] = E[m] * v[j] + Nv[j] * f1[m] + 2 * (Na[j] + Nb[j]) * f2[m] + Nc[j] * f3[m];
    }
    stepCount++;
    simTime += H_STEP;
  }

  /* Front displacement phi = u_hat / (ik), zero mean. The longest waves (one or two
     per screen width) are damped for display only, so the front doesn't sway off
     the screen while the cells keep their true shape. */
  var phiSpec;
  function frontShape(out) {
    phiSpec[0] = phiSpec[1] = 0;
    phiSpec[N] = phiSpec[N + 1] = 0;
    for (var m = 1; m < N / 2; m++) {
      var w = m * m / (m * m + 4) / k[m];
      phiSpec[2 * m] = w * v[2 * m + 1];
      phiSpec[2 * m + 1] = -w * v[2 * m];
    }
    irfft(phiSpec, out);
  }

  function advance() {
    phiPrev.set(phiCur);
    step();
    frontShape(phiCur);
    if (stepCount % CAPTURE_EVERY === 0) {
      history.push({ t: simTime, phi: Float32Array.from(phiCur) });
      var maxAge = (frontY / SPACING + 2) * CAPTURE_EVERY * H_STEP;
      while (history.length && simTime - history[0].t > maxAge) history.shift();
    }
  }

  /* ─── Setup ───────────────────────────────────────────────────── */

  function init() {
    W = window.innerWidth;
    H = window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    layout();

    /* Domain length sets how many cells span the screen; below ~40 the dynamics
       stop being chaotic and settle into a steady pattern */
    Lx = Math.max(44, Math.min(200, W / PX_PER_UNIT));
    /* Keep the grid spacing below ~0.4 so the cusps stay resolved */
    N = Lx > 100 ? 512 : Lx > 50 ? 256 : 128;
    amp = W / Lx;

    fftInit(N);
    setupCoefficients();
    var len = N + 2;
    v = new Float64Array(len); Nv = new Float64Array(len); Na = new Float64Array(len);
    Nb = new Float64Array(len); Nc = new Float64Array(len); sa = new Float64Array(len);
    sb = new Float64Array(len); sc = new Float64Array(len); phiSpec = new Float64Array(len);
    uTmp = new Float64Array(N); sqTmp = new Float64Array(N);
    phiPrev = new Float64Array(N); phiCur = new Float64Array(N);
    history = [];
    stepCount = 0;
    simTime = 0;
    accum = 0;

    /* Small random wrinkles; the instability picks out the cell size */
    var x = new Float64Array(N);
    for (var j = 0; j < N; j++) x[j] = 0.1 * (Math.random() - 0.5);
    rfft(x, v);
    v[0] = v[1] = v[N] = v[N + 1] = 0;

    /* Let the instability saturate into the chaotic cellular state, then fill
       the screen with isochrones before the first frame is shown */
    var warm = Math.round(40 / H_STEP);
    for (var i = 0; i < warm; i++) step();
    frontShape(phiCur);
    var fill = Math.ceil(frontY / SPACING + 2) * CAPTURE_EVERY;
    for (i = 0; i < fill; i++) advance();
  }

  function layout() {
    frontY = H * (W < 680 ? 0.9 : 0.86);
  }

  /* ─── Drawing ─────────────────────────────────────────────────── */

  var speed = SPACING / (CAPTURE_EVERY * H_STEP); /* px per KS time unit */

  function tracePath(phi, base, mix, prev) {
    var dx = W / N;
    for (var j = 0; j <= N; j++) {
      var jj = j % N;
      var p = prev ? prev[jj] + mix * (phi[jj] - prev[jj]) : phi[jj];
      var y = base - amp * p;
      if (j === 0) ctx.moveTo(0, y); else ctx.lineTo(j * dx, y);
    }
  }

  function draw() {
    var mix = accum / H_STEP;
    var now = simTime - H_STEP + accum;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    /* Isochrones: past front positions, fading as they drift into the burnt gas */
    ctx.globalCompositeOperation = 'source-over';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 0.75;
    for (var i = 0; i < history.length; i++) {
      var h = history[i];
      var base = frontY - (now - h.t) * speed;
      var f = 1 - base / frontY;
      if (f >= 1) continue;
      var alpha = 0.16 * Math.pow(1 - Math.max(f, 0), 1.5);
      ctx.beginPath();
      tracePath(h.phi, base);
      ctx.strokeStyle = 'rgba(' + INK + ', ' + alpha.toFixed(3) + ')';
      ctx.stroke();
    }

    /* The flame front itself, only slightly stronger than its history */
    ctx.beginPath();
    tracePath(phiCur, frontY, mix, phiPrev);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(' + INK + ', 0.3)';
    ctx.stroke();

    /* Quiet the lines behind the text column so they live mostly in the margins */
    var col = Math.min(W, CONTENT_WIDTH);
    var left = (W - col) / 2, soft = Math.min(160, col / 4);
    var fade = W < 680 ? 0.45 : 0.7;
    var mask = ctx.createLinearGradient(0, 0, W, 0);
    mask.addColorStop(0, 'rgba(0, 0, 0, 0)');
    mask.addColorStop(Math.max(left / W, 0), 'rgba(0, 0, 0, 0)');
    mask.addColorStop((left + soft) / W, 'rgba(0, 0, 0, ' + fade + ')');
    mask.addColorStop((W - left - soft) / W, 'rgba(0, 0, 0, ' + fade + ')');
    mask.addColorStop(Math.min((W - left) / W, 1), 'rgba(0, 0, 0, 0)');
    mask.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = mask;
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';
  }

  /* ─── Animation loop ──────────────────────────────────────────── */

  function frame(ts) {
    rafId = requestAnimationFrame(frame);
    if (lastFrame === undefined) lastFrame = ts;
    var dt = Math.min((ts - lastFrame) / 1000, 0.1);
    if (dt < 1 / 40) return; /* ~30 fps is plenty for slow motion */
    lastFrame = ts;
    accum += dt * SIM_SPEED;
    while (accum >= H_STEP) {
      accum -= H_STEP;
      advance();
    }
    draw();
  }

  function start() {
    cancelAnimationFrame(rafId);
    lastFrame = undefined;
    if (reduceMotion.matches || document.hidden) {
      accum = H_STEP;
      draw();
      return;
    }
    rafId = requestAnimationFrame(frame);
  }

  var lastWidth;
  function onResize() {
    if (window.innerWidth === lastWidth) {
      /* Height-only changes (mobile URL bar): keep the simulation, resize the canvas */
      H = window.innerHeight;
      canvas.height = Math.round(H * dpr);
      layout();
      if (reduceMotion.matches) draw();
      return;
    }
    lastWidth = window.innerWidth;
    init();
    start();
  }

  var resizeTimer;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(onResize, 150);
  });
  document.addEventListener('visibilitychange', start);
  if (reduceMotion.addEventListener) reduceMotion.addEventListener('change', start);

  /* Run the warm-up after the page has painted, then fade the canvas in */
  requestAnimationFrame(function () {
    setTimeout(function () {
      onResize();
      canvas.classList.add('is-ready');
    }, 0);
  });
})();
