// OMR engine: corner-marker detection, homography, bubble reading.
// Pure JS, no dependencies. Works on a grayscale (red-channel) buffer.
(function () {
  const T = window.OMR_TEMPLATE;

  // ---------- grayscale ----------
  // Red channel gives the best contrast for blue/black pen and the blue print.
  function toGray(imgData) {
    const { data, width, height } = imgData;
    const g = new Uint8Array(width * height);
    for (let i = 0, j = 0; j < g.length; i += 4, j++) {
      // mostly red, a bit of green so black/blue both read dark
      g[j] = (data[i] * 3 + data[i + 1]) >> 2;
    }
    return g;
  }

  // ---------- adaptive threshold + connected components ----------
  function meanMap(g, w, h) {
    const ii = new Float64Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) {
      let rs = 0;
      for (let x = 0; x < w; x++) {
        rs += g[y * w + x];
        ii[(y + 1) * (w + 1) + x + 1] = ii[y * (w + 1) + x + 1] + rs;
      }
    }
    const rad = Math.max(8, Math.round(Math.max(w, h) / 50));
    const mm = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - rad), y1 = Math.min(h, y + rad + 1);
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - rad), x1 = Math.min(w, x + rad + 1);
        const sum = ii[y1 * (w + 1) + x1] - ii[y0 * (w + 1) + x1] - ii[y1 * (w + 1) + x0] + ii[y0 * (w + 1) + x0];
        mm[y * w + x] = sum / ((x1 - x0) * (y1 - y0));
      }
    }
    mm.ii = ii;
    return mm;
  }

  // Center-surround detector for small solid dark squares (the 4 corner markers).
  // Works on blurry / low-contrast / small markers where plain thresholding fails.
  const DIRS = [[1, 0], [0.7071, 0.7071], [0, 1], [-0.7071, 0.7071], [-1, 0], [-0.7071, -0.7071], [0, -1], [0.7071, -0.7071]];
  function findMarkers(g, w, h, mm) {
    const ii = mm.ii, W1 = w + 1;
    const box = (x0, y0, x1, y1) => ii[y1 * W1 + x1] - ii[y0 * W1 + x1] - ii[y1 * W1 + x0] + ii[y0 * W1 + x0];
    const long = Math.max(w, h);
    const sizes = [];
    for (let a = 3; a <= Math.max(6, Math.round(long / 100)); a = Math.max(a + 1, Math.round(a * 1.3))) sizes.push(a);
    const best = new Float32Array(w * h), bestA = new Uint8Array(w * h), bestO = new Uint8Array(w * h);
    for (const a of sizes) {
      const hi = a >> 1, ho = Math.round(a * 1.25);   // inner half-size, outer half-size
      const ai = (2 * hi + 1) ** 2, ao = (2 * ho + 1) ** 2 - ai;
      for (let y = ho + 1; y < h - ho - 1; y++) {
        for (let x = ho + 1; x < w - ho - 1; x++) {
          if (g[y * w + x] > mm[y * w + x] * 0.88) continue; // centre not dark: skip fast
          const si = box(x - hi, y - hi, x + hi + 1, y + hi + 1);
          const inner = si / ai;
          if (inner > 170) continue;
          const outer = (box(x - ho, y - ho, x + ho + 1, y + ho + 1) - si) / ao;
          if (outer < 60) continue;
          const r = (outer - inner) / outer;
          const p = y * w + x;
          if (r > best[p]) { best[p] = r; bestA[p] = a; bestO[p] = outer; }
        }
      }
    }
    // local maxima + non-max suppression
    const cand = [];
    for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 2; x++) {
      const p = y * w + x, r = best[p];
      if (r < 0.2) continue;
      if (r < best[p - 1] || r < best[p + 1] || r < best[p - w] || r < best[p + w] ||
          r < best[p - w - 1] || r < best[p - w + 1] || r < best[p + w - 1] || r < best[p + w + 1]) continue;
      cand.push({ x, y, r, a: bestA[p], o: bestO[p] });
    }
    cand.sort((p, q) => q.r - p.r);
    const out = [];
    for (const c of cand) {
      if (out.some(o => Math.abs(o.x - c.x) < o.a * 1.5 && Math.abs(o.y - c.y) < o.a * 1.5)) continue;
      // must be surrounded by paper on (almost) all sides; rejects the paper's outer edge
      {
        const R = Math.max(c.a * 2, c.a + 3);
        let mx = 0; const vals = [];
        for (let k = 0; k < 8; k++) {
          const px = Math.round(c.x + R * DIRS[k][0]), py = Math.round(c.y + R * DIRS[k][1]);
          const v = (px < 0 || py < 0 || px >= w || py >= h) ? 0 : g[py * w + px];
          vals.push(v); if (v > mx) mx = v;
        }
        let bright = 0; for (const v of vals) if (v > mx * 0.8) bright++;
        if (bright < 6) continue;
      }
      // refine centre: darkness-weighted centroid inside the box
      const hw = c.a;
      let sw = 0, sx = 0, sy = 0;
      const thr = mm[c.y * w + c.x];
      for (let yy = Math.max(0, c.y - hw); yy <= Math.min(h - 1, c.y + hw); yy++)
        for (let xx = Math.max(0, c.x - hw); xx <= Math.min(w - 1, c.x + hw); xx++) {
          const d = thr - g[yy * w + xx];
          if (d > 0) { sw += d; sx += d * xx; sy += d * yy; }
        }
      out.push({ x: sw ? sx / sw : c.x, y: sw ? sy / sw : c.y, size: c.a, fill: c.r, bg: c.o });
      if (out.length > 1500) break;
    }
    return out;
  }

  function findBlobs(g, w, h, k, mm) {
    if (!mm) mm = meanMap(g, w, h);
    k = k || 0.55;
    const bin = new Uint8Array(w * h);
    for (let p = 0; p < bin.length; p++) {
      const v = g[p];
      if (v < mm[p] * k && v < 150) bin[p] = 1;
    }
    // erode 3x3 once: removes thin printed lines that may touch the markers
    const er = new Uint8Array(w * h);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      if (bin[p] && bin[p - 1] && bin[p + 1] && bin[p - w] && bin[p + w] &&
          bin[p - w - 1] && bin[p - w + 1] && bin[p + w - 1] && bin[p + w + 1]) er[p] = 1;
    }
    bin.set(er);
    // flood-fill labelling
    const maxSide = Math.max(w, h) / 25;
    const blobs = [];
    const stack = new Int32Array(w * h);
    for (let p = 0; p < bin.length; p++) {
      if (bin[p] !== 1) continue;
      let sp = 0; stack[sp++] = p; bin[p] = 2;
      let area = 0, sx = 0, sy = 0, minx = w, maxx = 0, miny = h, maxy = 0, big = false;
      while (sp) {
        const q = stack[--sp];
        const qx = q % w, qy = (q / w) | 0;
        area++; sx += qx; sy += qy;
        if (qx < minx) minx = qx; if (qx > maxx) maxx = qx;
        if (qy < miny) miny = qy; if (qy > maxy) maxy = qy;
        if (maxx - minx > maxSide || maxy - miny > maxSide) big = true;
        if (qx > 0 && bin[q - 1] === 1) { bin[q - 1] = 2; stack[sp++] = q - 1; }
        if (qx < w - 1 && bin[q + 1] === 1) { bin[q + 1] = 2; stack[sp++] = q + 1; }
        if (qy > 0 && bin[q - w] === 1) { bin[q - w] = 2; stack[sp++] = q - w; }
        if (qy < h - 1 && bin[q + w] === 1) { bin[q + w] = 2; stack[sp++] = q + w; }
      }
      if (big) continue;
      const bw = maxx - minx + 1, bh = maxy - miny + 1;
      if (bw < 2 || bh < 2) continue;
      const ar = bw / bh;
      if (ar < 0.55 || ar > 1.8) continue;
      const fill = area / (bw * bh);
      if (fill < 0.68) continue;
      blobs.push({ x: sx / area, y: sy / area, size: Math.sqrt(area) + 2, fill });
    }
    return blobs;
  }

  // ---------- homography ----------
  // returns 3x3 (array of 9) mapping src -> dst for 4 point pairs
  function homography(src, dst) {
    const A = [], b = [];
    for (let i = 0; i < 4; i++) {
      const [x, y] = src[i], [u, v] = dst[i];
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
    }
    // gaussian elimination
    const n = 8;
    for (let c = 0; c < n; c++) {
      let piv = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
      [A[c], A[piv]] = [A[piv], A[c]]; [b[c], b[piv]] = [b[piv], b[c]];
      if (Math.abs(A[c][c]) < 1e-12) return null;
      for (let r = 0; r < n; r++) {
        if (r === c) continue;
        const f = A[r][c] / A[c][c];
        for (let k = c; k < n; k++) A[r][k] -= f * A[c][k];
        b[r] -= f * b[c];
      }
    }
    const hm = b.map((v, i) => v / A[i][i]);
    hm.push(1);
    return hm;
  }
  // closed-form unit square -> quad (P0..P3 = (0,0),(1,0),(1,1),(0,1))
  function squareToQuad(P) {
    const [x0, y0] = P[0], [x1, y1] = P[1], [x2, y2] = P[2], [x3, y3] = P[3];
    const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
    const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
    const den = dx1 * dy2 - dx2 * dy1;
    if (Math.abs(den) < 1e-9) return null;
    const g7 = (dx3 * dy2 - dx2 * dy3) / den, h8 = (dx1 * dy3 - dx3 * dy1) / den;
    return [x1 - x0 + g7 * x1, x3 - x0 + h8 * x3, x0, y1 - y0 + g7 * y1, y3 - y0 + h8 * y3, y0, g7, h8, 1];
  }
  function project(H, u, v) {
    const z = H[6] * u + H[7] * v + H[8];
    return [(H[0] * u + H[1] * v + H[2]) / z, (H[3] * u + H[4] * v + H[5]) / z];
  }

  function sampleMean(g, w, h, x, y, r) {
    let s = 0, n = 0;
    const ri = Math.max(1, Math.round(r));
    for (let dy = -ri; dy <= ri; dy++) for (let dx = -ri; dx <= ri; dx++) {
      const px = Math.round(x + dx), py = Math.round(y + dy);
      if (px < 0 || py < 0 || px >= w || py >= h) return -1;
      s += g[py * w + px]; n++;
    }
    return s / n;
  }

  function cross(o, a, b) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); }
  function dist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }

  // ---------- sheet detection ----------
  let lastK = 0.55;
  function detectSheet(g, w, h) {
    const mm = meanMap(g, w, h);
    // paper brightness ~ 90th percentile
    const hist = new Uint32Array(256);
    for (let i = 0; i < g.length; i += 7) hist[g[i]]++;
    let acc = 0, tot = Math.ceil(g.length / 7), p90 = 255;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= tot * 0.9) { p90 = v; break; } }
    // markers sit on white paper: drop candidates whose surroundings are much darker than paper
    const all = findMarkers(g, w, h, mm).filter(b => b.bg >= p90 * 0.35);
    // try the strongest candidates first, then weaker ones
    for (const minR of [0.45, 0.3, 0]) {
      const set = minR ? all.filter(b => b.fill >= minR) : all;
      if (minR && set.length === all.length) continue;
      const r0 = detectWith(set, g, w, h, mm);
      if (r0) return r0;
    }
    // fallback: plain threshold blobs (sharp, high-contrast images)
    return detectWith(findBlobs(g, w, h, 0.55, mm), g, w, h, mm);
  }

  function detectWith(blobs, g, w, h, mm) {
    if (blobs.length < 4) return null;
    const K = Math.min(12, blobs.length);
    const pick = (fn) => blobs.map(b => [fn(b), b]).sort((p, q) => p[0] - q[0]).slice(0, K).map(p => p[1]);
    const tl = pick(b => b.x + b.y);
    const tr = pick(b => -(b.x - b.y));
    const br = pick(b => -(b.x + b.y));
    const bl = pick(b => b.x - b.y);
    const minDiag = Math.min(w, h) * 0.3;
    const sz = (p, q) => p.size > q.size * 2.6 || q.size > p.size * 2.6;
    const cr = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    const dd = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
    let best = null;
    for (const a of tl) for (const c of br) {
      if (a === c || sz(a, c) || dd(a, c) < minDiag) continue;
      for (const b of tr) {
        if (b === a || b === c || sz(a, b) || sz(b, c) || cr(a, b, c) <= 0) continue;
        for (const d of bl) {
          if (d === a || d === b || d === c || sz(a, d) || sz(b, d) || sz(c, d)) continue;
          if (cr(c, d, a) <= 0 || cr(b, c, d) <= 0 || cr(d, a, b) <= 0) continue;
          const s01 = dd(a, b), s12 = dd(b, c), s23 = dd(c, d), s30 = dd(d, a);
          if (s01 / s23 > 1.7 || s23 / s01 > 1.7 || s12 / s30 > 1.7 || s30 / s12 > 1.7) continue;
          const asp = (s12 + s30) / (s01 + s23);   // image-space height/width
          const P0 = [[a.x, a.y], [b.x, b.y], [c.x, c.y], [d.x, d.y]];
          const meanSize = (a.size + b.size + c.size + d.size) / 4;
          // portrait in image (rotation 0 or 180) or landscape (90 / 270)
          const rots = asp >= 1.0 && asp <= 2.0 ? [0, 2] : (1 / asp >= 1.0 && 1 / asp <= 2.0 ? [1, 3] : []);
          for (const r of rots) {
            const P = P0.slice(r).concat(P0.slice(0, r));
            const sheetW = (dd2(P[0], P[1]) + dd2(P[3], P[2])) / 2;
            const expSize = sheetW * 0.0092;
            if (meanSize < expSize * 0.3 || meanSize > expSize * 3) continue;
            const H = squareToQuad(P);
            if (!H) continue;
            if (!quickCheck(H, g, w, h, mm)) continue;
            const v = validate(H, g, w, h, mm, Math.max(1, expSize * 0.35));
            if (!v) continue;
            const aspS = r % 2 ? 1 / asp : asp;
            const score = v + (1 - Math.abs(aspS - 1.39)) * 0.1;
            if (!best || score > best.score) best = { score, H, corners: P };
          }
        }
      }
    }
    return best;
  }
  function dd2(p, q) { return Math.hypot(p[0] - q[0], p[1] - q[1]); }

  // checks that known dark/white spots of the printed sheet are where the homography says
  // quick rejection with a few spread-out points before the full check
  const QD = [0, 7, 12, 15, 17], QW = [0, 2, 4, 6, 9, 11];
  function quickCheck(H, g, w, h, mm) {
    let bad = 0;
    for (const i of QD) {
      const [x, y] = project(H, T.dark[i][0], T.dark[i][1]);
      const xi = Math.round(x), yi = Math.round(y);
      if (xi < 1 || yi < 1 || xi >= w - 1 || yi >= h - 1) return false;
      const p = yi * w + xi;
      if (g[p] > mm[p] * 0.85 && ++bad > 1) return false;
    }
    for (const i of QW) {
      const [x, y] = project(H, T.white[i][0], T.white[i][1]);
      const xi = Math.round(x), yi = Math.round(y);
      if (xi < 1 || yi < 1 || xi >= w - 1 || yi >= h - 1) return false;
      const p = yi * w + xi;
      if (g[p] < mm[p] * 0.8 && ++bad > 1) return false;
    }
    return true;
  }

  function validate(H, g, w, h, mm, pr) {
    let dOk = 0, wOk = 0, dSum = 0, wSum = 0, dBad = 0, wBad = 0;
    const maxBadD = Math.floor(T.dark.length * 0.25), maxBadW = Math.floor(T.white.length * 0.25);
    for (const [u, v] of T.dark) {
      const [x, y] = project(H, u, v);
      const m = sampleMean(g, w, h, x, y, pr); if (m < 0) return 0;
      const ref = mm[Math.round(y) * w + Math.round(x)];
      if (m < ref * 0.8) dOk++; else if (++dBad > maxBadD) return 0;
      dSum += m;
    }
    for (const [u, v] of T.white) {
      const [x, y] = project(H, u, v);
      const m = sampleMean(g, w, h, x, y, pr); if (m < 0) return 0;
      const ref = mm[Math.round(y) * w + Math.round(x)];
      if (m > ref * 0.86) wOk++; else if (++wBad > maxBadW) return 0;
      wSum += m;
    }
    const fd = dOk / T.dark.length, fw = wOk / T.white.length;
    if (fd < 0.75 || fw < 0.75) return 0;
    const dk = dSum / T.dark.length, wt = wSum / T.white.length;
    if (wt - dk < 22 || dk > wt * 0.8) return 0;
    return fd + fw + (wt - dk) / 255;
  }

  // ---------- bubble reading ----------
  function bubbleFill(g, w, h, H, u, v) {
    const [cx, cy] = project(H, u, v);
    const [ex, ey] = project(H, u + T.r, v);
    const [fx, fy] = project(H, u, v + T.ry);
    const R = (Math.hypot(ex - cx, ey - cy) + Math.hypot(fx - cx, fy - cy)) / 2;
    // local white reference: ring outside the bubble
    const ring = [];
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const px = Math.round(cx + Math.cos(a) * R * 1.55), py = Math.round(cy + Math.sin(a) * R * 1.55);
      if (px >= 0 && py >= 0 && px < w && py < h) ring.push(g[py * w + px]);
    }
    ring.sort((p, q) => p - q);
    const white = ring.length ? ring[Math.floor(ring.length * 0.75)] : 200;
    const thr = white * 0.62;
    const ir = R * 0.62;
    let n = 0, dark = 0;
    const step = Math.max(1, ir / 5);
    for (let dy = -ir; dy <= ir; dy += step) for (let dx = -ir; dx <= ir; dx += step) {
      if (dx * dx + dy * dy > ir * ir) continue;
      const px = Math.round(cx + dx), py = Math.round(cy + dy);
      if (px < 0 || py < 0 || px >= w || py >= h) continue;
      n++; if (g[py * w + px] < thr) dark++;
    }
    return { x: cx, y: cy, R, fill: n ? dark / n : 0 };
  }

  // Returns raw geometry + fill values for all bubbles
  function readSheet(g, w, h, H) {
    const q = T.q.map(row => row.map(([u, v]) => bubbleFill(g, w, h, H, u, v)));
    const id = T.id.map(col => col.map(([u, v]) => bubbleFill(g, w, h, H, u, v)));
    return { q, id };
  }

  const MARK = 0.45;
  // decide selection for a list of fills
  function decide(fills) {
    const marked = [];
    const mx = Math.max(...fills);
    fills.forEach((f, i) => { if (f >= MARK && f >= mx * 0.6) marked.push(i); });
    return marked;
  }

  const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
  function decodeId(idFills) {
    return idFills.map(col => {
      const m = decide(col);
      if (m.length === 1) return DIGITS[m[0]];
      if (m.length === 0) return '';
      return '?';
    }).join('').replace(/^$/, '');
  }

  window.OMR = { _findBlobs: findBlobs, _findMarkers: findMarkers, _meanMap: meanMap, _validate: validate, _homography: homography, toGray, detectSheet, readSheet, decide, decodeId, project, MARK };
})();
