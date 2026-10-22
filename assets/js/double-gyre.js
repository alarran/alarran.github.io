/* Background animation: passive tracers in the time-periodic double gyre
   (Shadden, Lekien & Marsden 2005), a standard test case for Lagrangian
   coherent structures. On the domain [0, 2] x [0, 1] the stream function is

     psi = A sin(pi f(x, t)) sin(pi y),  f = eps sin(wt) x^2 + (1 - 2 eps sin(wt)) x.

   Tracers are colored by the gyre they start in, so the lobes that carry fluid
   across the oscillating separatrix show up as the two colors interleave. */
(function () {
  var canvas = document.createElement('canvas');
  var ctx = canvas.getContext('2d');
  if (!ctx) return;
  canvas.className = 'flow-bg';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.insertBefore(canvas, document.body.firstChild);

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  /* Site ink and teal accents */
  var COLORS = ['90, 95, 135', '58, 138, 145'];

  var A = 0.1, EPS = 0.25, OMEGA = 2 * Math.PI / 10;
  var PX_PER_SECOND = 45;     /* fastest tracer speed on screen */
  var TRAIL = 18;             /* stored points per trail */
  var RECORD_EVERY = 3;       /* frames between stored points */
  var HEAD_ALPHA = 0.45;
  var CONTENT_WIDTH = 1040;   /* matches .profile-container max-width */

  var W, H, dpr, portrait, simSpeed, t, count;
  var cx, cy, tx, ty, len, color, life, dying;
  var frameCount, lastFrame, rafId;

  /* ─── Flow ────────────────────────────────────────────────────── */

  var vu, vv;
  function velocity(x, y, time) {
    var s = EPS * Math.sin(OMEGA * time);
    var b = 1 - 2 * s;
    var f = s * x * x + b * x;
    var df = 2 * s * x + b;
    vu = -Math.PI * A * Math.sin(Math.PI * f) * Math.cos(Math.PI * y);
    vv = Math.PI * A * Math.cos(Math.PI * f) * Math.sin(Math.PI * y) * df;
  }

  /* Classical RK4 for every tracer over one frame */
  function advect(dt) {
    var h2 = dt / 2;
    for (var i = 0; i < count; i++) {
      if (dying[i]) continue;
      var x = cx[i], y = cy[i];
      velocity(x, y, t);
      var k1u = vu, k1v = vv;
      velocity(x + h2 * k1u, y + h2 * k1v, t + h2);
      var k2u = vu, k2v = vv;
      velocity(x + h2 * k2u, y + h2 * k2v, t + h2);
      var k3u = vu, k3v = vv;
      velocity(x + dt * k3u, y + dt * k3v, t + dt);
      x += dt / 6 * (k1u + 2 * k2u + 2 * k3u + vu);
      y += dt / 6 * (k1v + 2 * k2v + 2 * k3v + vv);
      cx[i] = Math.min(2, Math.max(0, x));
      cy[i] = Math.min(1, Math.max(0, y));
    }
    t += dt;
  }

  /* ─── Tracers ─────────────────────────────────────────────────── */

  function spawn(i) {
    cx[i] = 2 * Math.random();
    cy[i] = Math.random();
    color[i] = cx[i] < 1 ? 0 : 1;
    len[i] = 0;
    life[i] = 8 + 12 * Math.random();
    dying[i] = 0;
  }

  /* Push the current position onto each trail. Expired tracers stop moving and
     their trails shrink away before they respawn, so nothing pops out abruptly. */
  function record(elapsed) {
    for (var i = 0; i < count; i++) {
      var o = i * TRAIL;
      if (dying[i]) {
        if (--len[i] <= 0) spawn(i);
        continue;
      }
      for (var j = Math.min(len[i], TRAIL - 1); j > 0; j--) {
        tx[o + j] = tx[o + j - 1];
        ty[o + j] = ty[o + j - 1];
      }
      tx[o] = cx[i];
      ty[o] = cy[i];
      if (len[i] < TRAIL) len[i]++;
      life[i] -= elapsed;
      if (life[i] <= 0) dying[i] = 1;
    }
  }

  /* ─── Setup ───────────────────────────────────────────────────── */

  function resize() {
    W = window.innerWidth;
    H = window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    /* The domain is 2:1, so on tall screens lay it along the vertical */
    portrait = H > W * 1.1;
    var pxPerUnit = portrait ? H / 2 : W / 2;
    simSpeed = PX_PER_SECOND / (Math.PI * A * pxPerUnit);
  }

  function init() {
    resize();
    count = Math.round(Math.min(1800, Math.max(400, W * H / 1100)));
    cx = new Float32Array(count); cy = new Float32Array(count);
    tx = new Float32Array(count * TRAIL); ty = new Float32Array(count * TRAIL);
    len = new Uint8Array(count); color = new Uint8Array(count);
    life = new Float32Array(count); dying = new Uint8Array(count);
    t = 10 * Math.random();
    frameCount = 0;
    for (var i = 0; i < count; i++) {
      spawn(i);
      /* Stagger lifetimes so respawns are spread out in time */
      life[i] *= Math.random();
    }
    /* Pre-run so the page opens with full trails */
    var dt = simSpeed / 30;
    for (var n = 0; n < TRAIL * RECORD_EVERY; n++) {
      advect(dt);
      if (n % RECORD_EVERY === 0) record(RECORD_EVERY / 30);
    }
  }

  /* ─── Drawing ─────────────────────────────────────────────────── */

  function sx(x, y) { return portrait ? y * W : x / 2 * W; }
  function sy(x, y) { return portrait ? x / 2 * H : (1 - y) * H; }

  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, W, H);
    ctx.lineWidth = 1;
    ctx.lineCap = 'round';

    /* One path per color and trail age, so each stroke has a single opacity */
    for (var c = 0; c < COLORS.length; c++) {
      for (var j = -1; j < TRAIL - 1; j++) {
        ctx.beginPath();
        for (var i = 0; i < count; i++) {
          if (color[i] !== c) continue;
          var o = i * TRAIL;
          if (j === -1) {
            /* Live segment from the newest stored point to the moving head */
            if (dying[i] || len[i] < 1) continue;
            ctx.moveTo(sx(tx[o], ty[o]), sy(tx[o], ty[o]));
            ctx.lineTo(sx(cx[i], cy[i]), sy(cx[i], cy[i]));
          } else {
            if (j + 1 >= len[i]) continue;
            var a = o + j, b = a + 1;
            ctx.moveTo(sx(tx[a], ty[a]), sy(tx[a], ty[a]));
            ctx.lineTo(sx(tx[b], ty[b]), sy(tx[b], ty[b]));
          }
        }
        var alpha = HEAD_ALPHA * (1 - (j + 1) / TRAIL);
        ctx.strokeStyle = 'rgba(' + COLORS[c] + ', ' + alpha.toFixed(3) + ')';
        ctx.stroke();
      }
    }

    /* Quiet the tracers behind the text column so they stay mostly in the margins */
    var col = Math.min(W, CONTENT_WIDTH);
    var left = (W - col) / 2, soft = Math.min(160, col / 4);
    var fade = W < 680 ? 0.35 : 0.5;
    var mask = ctx.createLinearGradient(0, 0, W, 0);
    mask.addColorStop(0, 'rgba(0, 0, 0, 0)');
    mask.addColorStop(left / W, 'rgba(0, 0, 0, 0)');
    mask.addColorStop((left + soft) / W, 'rgba(0, 0, 0, ' + fade + ')');
    mask.addColorStop((W - left - soft) / W, 'rgba(0, 0, 0, ' + fade + ')');
    mask.addColorStop((W - left) / W, 'rgba(0, 0, 0, 0)');
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
    advect(dt * simSpeed);
    if (++frameCount % RECORD_EVERY === 0) record(dt * RECORD_EVERY);
    draw();
  }

  function start() {
    cancelAnimationFrame(rafId);
    lastFrame = undefined;
    draw();
    if (reduceMotion.matches || document.hidden) return;
    rafId = requestAnimationFrame(frame);
  }

  var lastWidth;
  function onResize() {
    if (window.innerWidth === lastWidth) {
      /* Height-only changes (mobile URL bar): tracers live in flow coordinates,
         so only the mapping to the screen changes */
      resize();
      draw();
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

  /* Set up after the page has painted, then fade the canvas in */
  requestAnimationFrame(function () {
    setTimeout(function () {
      onResize();
      canvas.classList.add('is-ready');
    }, 0);
  });
})();
