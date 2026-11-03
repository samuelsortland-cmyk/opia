/* Opia 5.5 — pixel sprite renderer.
 *
 * window.OpiaSprite.create(canvas, { scale }) -> { draw(pose), resize(), hitTest(cssX, cssY), LW, LH, scale }
 *
 * Pure drawing: given a pose object it paints one frame. All animation logic
 * lives in behavior.js. The art is built from the user's reference sprite
 * (opia/assets/opia-base.png): a flat orange body with two square black eyes,
 * little side arms and four short legs, plus a top hat and a monocle with a chain.
 *
 * Pose fields (all optional):
 *   x, y            logical-pixel offset of the whole pet (y < 0 = in the air)
 *   jx, jy          micro-jitter in device pixels
 *   eyeDX, eyeDY    gaze, -1..1 (rounded to whole pixels)
 *   blink           0..1 (>0.5 = eyes shut)
 *   eyes            'normal' | 'happy' | 'x' | 'wide' | 'closed'
 *   squint          true = non-monocle eye squints (peering through the monocle)
 *   squash          -1..1 (+ = flatter/wider, - = taller/thinner), area-preserving-ish
 *   tilt            radians, pivot at the feet
 *   armL, armR      -1..1 (+ = raised)
 *   legPhase        radians; walk cycle when walking=true
 *   walking         bool
 *   dangle          0..1 legs dangling (being carried)
 *   hatTilt         radians, hatLift logical px, hatX logical px
 *   monocleGlint    0..1 sweep of the glint across the glass (0 = static sparkle)
 *   chainSwing      -1..1
 *   blush           0..1
 *   shadow          bool (default true)
 *   particles       [{ kind, x, y, a, size }] in logical canvas coords
 */
(function () {
  'use strict';

  var LW = 48; // logical canvas size
  var LH = 44;
  var FEET_Y = LH - 3; // logical y of the feet bottom
  var CX = 24; // logical x of the pet's centre

  var C = {
    body: '#D87556',
    bodyHi: '#E29880',
    bodyLo: '#BF6347',
    eye: '#000000',
    eyeHi: '#FFFFFF',
    blush: '#F0A08C',
    hat: '#1E1B22',
    hatHi: '#3B3644',
    hatLo: '#121015',
    band: '#8E2F3A',
    bandHi: '#B8495A',
    gold: '#E7B43F',
    goldLo: '#A97B1F',
    glass: 'rgba(200,230,255,0.38)',
    glint: '#FFFFFF',
    shadow: 'rgba(40,20,10,0.22)'
  };

  // Character-local layout (matches the reference grid at ~2.25 px per cell):
  // body 16x12 at x 4..19, arms 4x4 at y 4..7, legs 2 wide at x 4,8,14,18, y 12..15.
  var CH_W = 24, CH_H = 16, M = 2; // offscreen margin
  var LEGS = [4, 8, 14, 18];
  var EYE_L = 6, EYE_R = 16, EYE_Y = 2;

  // Hat local box: x 5..18, y -10..-1 (pivot at local (12, 0) = top centre of body).
  var HAT_W = 14, HAT_H = 10, HAT_X0 = 5, HAT_Y0 = -10;

  var GLYPHS = {
    heart: { c: '#E84A6A', g: ['XX.XX', 'XXXXX', 'XXXXX', '.XXX.', '..X..'] },
    z: { c: '#7B8BE0', g: ['XXXX', '..X.', '.X..', 'XXXX'] },
    zs: { c: '#7B8BE0', g: ['XXX', '.X.', 'XXX'] },
    bang: { c: '#F2C14E', g: ['X', 'X', 'X', '.', 'X'] },
    q: { c: '#7B8BE0', g: ['XXX', '..X', '.XX', '...', '.X.'] },
    spark: { c: '#F7D261', g: ['.X.', 'XXX', '.X.'] },
    star: { c: '#FFF2B0', g: ['X.X', '.X.', 'X.X'] },
    drop: { c: '#8ED0F5', g: ['.X.', 'XXX', 'XXX', '.X.'] },
    dot: { c: '#7B8BE0', g: ['X'] },
    note: { c: '#7B8BE0', g: ['.XX', '.X.', '.X.', 'XX.'] },
    puff: { c: 'rgba(255,255,255,0.8)', g: ['.X.', 'XXX', '.X.'] }
  };

  function mk(w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var x = c.getContext('2d');
    x.imageSmoothingEnabled = false;
    return { c: c, x: x };
  }

  function create(canvas, opts) {
    opts = opts || {};
    var ctx = canvas.getContext('2d');
    var ch = mk(CH_W + M * 2, CH_H + M * 2 + 2);
    var hat = mk(HAT_W, HAT_H);
    var dpr = 1, scale = 1, offX = 0, offY = 0;

    function resize() {
      dpr = window.devicePixelRatio || 1;
      var cssW = canvas.clientWidth || canvas.width / dpr || 200;
      var cssH = canvas.clientHeight || canvas.height / dpr || 200;
      var bw = Math.round(cssW * dpr), bh = Math.round(cssH * dpr);
      if (canvas.width !== bw || canvas.height !== bh) {
        canvas.width = bw; canvas.height = bh;
      }
      var fit = Math.floor(Math.min(cssW / LW, cssH / LH));
      var cssScale = Math.max(opts.scale || 1, fit, 1);
      scale = Math.max(1, Math.round(cssScale * dpr)); // device px per logical px
      offX = Math.round((bw - LW * scale) / 2);
      offY = bh - LH * scale;
      api.scale = scale;
    }

    function px(x, X, Y, w, h, col) {
      x.fillStyle = col;
      x.fillRect(X, Y, w || 1, h || 1);
    }

    // ---- character (body, eyes, arms, legs, monocle) ----
    function drawChar(p) {
      var x = ch.x;
      x.clearRect(0, 0, ch.c.width, ch.c.height);
      var o = M; // local -> offscreen offset
      // legs
      var dangle = p.dangle || 0;
      for (var i = 0; i < 4; i++) {
        var lx = LEGS[i], top = 12, len = 4, dx = 0;
        if (p.walking) {
          var ph = (p.legPhase || 0) + (i % 2 ? Math.PI : 0);
          if (Math.sin(ph) > 0.2) len = 3; // lifted
        }
        if (dangle > 0.3) {
          len = 5;
          dx = Math.round(Math.sin((p.legPhase || 0) * 1.3 + i * 1.7) * dangle);
        }
        px(x, o + lx + dx, o + top, 2, len, C.body);
        if (len === 3) px(x, o + lx + dx, o + top + 2, 2, 1, C.bodyLo);
      }
      // arms
      var aL = Math.round(-(p.armL || 0) * 2), aR = Math.round(-(p.armR || 0) * 2);
      px(x, o + 0, o + 4 + aL, 4, 4, C.body);
      px(x, o + 20, o + 4 + aR, 4, 4, C.body);
      // body
      px(x, o + 4, o + 0, 16, 12, C.body);
      // blush
      if ((p.blush || 0) > 0.2) {
        x.globalAlpha = Math.min(1, p.blush);
        px(x, o + 5, o + 5, 2, 1, C.blush);
        px(x, o + 17, o + 6, 2, 1, C.blush);
        x.globalAlpha = 1;
      }
      // monocle glass tint (behind the eye)
      var mx = 14, my = 0; // ring box 6x6 at local (14..19, 0..5)
      x.fillStyle = C.glass;
      x.fillRect(o + mx + 1, o + my + 1, 4, 4);
      // eyes
      var ex = Math.max(-1, Math.min(1, Math.round(p.eyeDX || 0)));
      var ey = Math.max(-1, Math.min(1, Math.round(p.eyeDY || 0)));
      var style = p.eyes || 'normal';
      if ((p.blink || 0) > 0.5 && style !== 'x') style = 'closed';
      drawEye(x, o + EYE_L + ex, o + EYE_Y + ey, p.squint ? 'squint' : style, false);
      drawEye(x, o + EYE_R + ex, o + EYE_Y + ey, style, true);
      // monocle glint
      var g = p.monocleGlint || 0;
      if (g > 0 && g < 1) {
        var gi = Math.floor(g * 5);
        px(x, o + mx + 1 + Math.min(3, gi), o + my + 1 + Math.max(0, 3 - gi), 1, 1, C.glint);
        if (gi > 0) {
          x.globalAlpha = 0.5;
          px(x, o + mx + Math.min(4, gi), o + my + Math.max(1, 4 - gi), 1, 1, C.glint);
          x.globalAlpha = 1;
        }
      } else {
        px(x, o + mx + 1, o + my + 1, 1, 1, 'rgba(255,255,255,0.75)');
      }
      // monocle ring
      px(x, o + mx + 1, o + my, 4, 1, C.gold);
      px(x, o + mx + 1, o + my + 5, 4, 1, C.goldLo);
      px(x, o + mx, o + my + 1, 1, 4, C.gold);
      px(x, o + mx + 5, o + my + 1, 1, 4, C.goldLo);
      // chain: hangs from the ring's bottom-left, drapes down the body, swings
      var sw = p.chainSwing || 0;
      var chain = [[14, 6], [13, 7], [13, 8], [12, 9], [12, 10], [12, 11]];
      for (var k = 0; k < chain.length; k++) {
        var cx = chain[k][0] + Math.round(sw * (k / (chain.length - 1)) * 2);
        px(x, o + cx, o + chain[k][1], 1, 1, k % 2 ? C.goldLo : C.gold);
      }
    }

    function drawEye(x, X, Y, style, isMonocle) {
      switch (style) {
        case 'closed':
          px(x, X, Y + 1, 2, 1, C.eye); break;
        case 'squint':
          px(x, X - 1, Y + 1, 3, 1, C.eye); px(x, X - 1, Y, 1, 1, C.eye); break;
        case 'happy':
          px(x, X - 1, Y + 1, 1, 1, C.eye); px(x, X, Y, 2, 1, C.eye); px(x, X + 2, Y + 1, 1, 1, C.eye); break;
        case 'x':
          px(x, X - 1, Y - 1, 1, 1, C.eye); px(x, X + 2, Y - 1, 1, 1, C.eye);
          px(x, X, Y, 2, 2, C.eye);
          px(x, X - 1, Y + 2, 1, 1, C.eye); px(x, X + 2, Y + 2, 1, 1, C.eye); break;
        case 'wide':
          px(x, X - (isMonocle ? 0 : 1), Y - 1, 3, 3, C.eye);
          px(x, X - (isMonocle ? 0 : 1), Y - 1, 1, 1, C.eyeHi); break;
        default:
          px(x, X, Y, 2, 2, C.eye);
      }
    }

    // ---- top hat ----
    function drawHat() {
      var x = hat.x;
      x.clearRect(0, 0, HAT_W, HAT_H);
      // local hat coords -> offscreen: (lx - HAT_X0, ly - HAT_Y0)
      function h(lx, ly, w, hh, col) { px(x, lx - HAT_X0, ly - HAT_Y0, w, hh, col); }
      // crown x 8..15, y -10..-3
      h(8, -10, 8, 8, C.hat);
      h(8, -10, 8, 1, C.hatHi);  // top rim
      h(9, -9, 1, 5, C.hatHi);   // side shine
      h(15, -9, 1, 6, C.hatLo);
      // band y -4..-3
      h(8, -4, 8, 2, C.band);
      h(8, -4, 8, 1, C.bandHi);
      h(13, -4, 1, 2, C.gold);   // tiny buckle
      // brim y -2..-1, x 5..18
      h(6, -2, 12, 1, C.hat);
      h(5, -1, 14, 1, C.hatLo);
      h(6, -2, 3, 1, C.hatHi);
    }

    function drawGlyph(kind, lx, ly, a, size) {
      var gl = GLYPHS[kind];
      if (!gl) return;
      var s = scale * (size || 1);
      ctx.globalAlpha = Math.max(0, Math.min(1, a == null ? 1 : a));
      ctx.fillStyle = gl.c;
      var X = offX + Math.round(lx * scale), Y = offY + Math.round(ly * scale);
      for (var r = 0; r < gl.g.length; r++) {
        var row = gl.g[r];
        for (var c = 0; c < row.length; c++) if (row[c] === 'X') ctx.fillRect(X + c * s, Y + r * s, s, s);
      }
      ctx.globalAlpha = 1;
    }

    function draw(p) {
      p = p || {};
      if (!scale || canvas.width === 0) resize();
      ctx.imageSmoothingEnabled = false;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      var s = scale;
      var bx = CX + (p.x || 0), by = FEET_Y + (p.y || 0);

      // ground shadow
      if (p.shadow !== false) {
        var air = Math.max(0, -(p.y || 0));
        var sw = Math.max(8, 22 - Math.round(air * 1.2));
        ctx.fillStyle = C.shadow;
        ctx.fillRect(offX + Math.round((CX + (p.x || 0) - sw / 2) * s), offY + (FEET_Y + 1) * s, sw * s, s);
        ctx.fillRect(offX + Math.round((CX + (p.x || 0) - sw / 2 + 2) * s), offY + (FEET_Y + 2) * s, (sw - 4) * s, s);
      }

      drawChar(p);
      drawHat();

      var sq = Math.max(-1, Math.min(1, p.squash || 0));
      var sx = 1 + 0.13 * sq, sy = 1 - 0.15 * sq;
      ctx.save();
      ctx.translate(offX + bx * s + (p.jx || 0), offY + by * s + (p.jy || 0));
      ctx.rotate(p.tilt || 0);
      ctx.scale(sx, sy);
      // character offscreen: local (0,0) at (M,M); feet bottom at local y 16 (+1 when dangling)
      var feet = CH_H + ((p.dangle || 0) > 0.3 ? 1 : 0);
      ctx.drawImage(ch.c, -(CH_W / 2 + M) * s, -(feet + M) * s, ch.c.width * s, ch.c.height * s);
      // hat (pivot at body top-centre = local (12, 0))
      ctx.translate((p.hatX || 0) * s, (-feet - (p.hatLift || 0)) * s);
      ctx.rotate(p.hatTilt || 0);
      ctx.drawImage(hat.c, (HAT_X0 - 12) * s, HAT_Y0 * s, HAT_W * s, HAT_H * s);
      ctx.restore();

      var parts = p.particles;
      if (parts) for (var i = 0; i < parts.length; i++) {
        var q = parts[i];
        drawGlyph(q.kind, q.x, q.y, q.a, q.size);
      }
    }

    function hitTest(cssX, cssY) {
      var X = Math.round(cssX * dpr), Y = Math.round(cssY * dpr);
      if (X < 0 || Y < 0 || X >= canvas.width || Y >= canvas.height) return false;
      try {
        // check a small neighbourhood so 1px gaps between legs still count
        var d = ctx.getImageData(Math.max(0, X - 2), Math.max(0, Y - 2), 5, 5).data;
        for (var i = 3; i < d.length; i += 4) if (d[i] > 60) return true;
      } catch (e) { return true; }
      return false;
    }

    // Logical -> CSS pixel helpers (for positioning particles / bubbles)
    function toCss(lx, ly) {
      return { x: (offX + lx * scale) / dpr, y: (offY + ly * scale) / dpr };
    }

    var api = {
      draw: draw, resize: resize, hitTest: hitTest, toCss: toCss,
      LW: LW, LH: LH, CX: CX, FEET_Y: FEET_Y, scale: 1, colors: C
    };
    resize();
    return api;
  }

  window.OpiaSprite = { create: create, LW: LW, LH: LH };
})();
