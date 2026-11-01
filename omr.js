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
    return mm;
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
    const ks = [lastK].concat([0.55, 0.42, 0.68].filter(k => k !== lastK));
    for (const k of ks) {
      const r = detectWith(findBlobs(g, w, h, k, mm), g, w, h, mm);
      if (r) { lastK = k; return r; }
    }
    return null;
  }

  function detectWith(blobs, g, w, h, mm) {
    if (blobs.length < 4) return null;
    const K = Math.min(7, blobs.length);
    const pick = (fn) => blobs.slice().sort((a, b) => fn(a) - fn(b)).slice(0, K);
    const tl = pick(b => b.x + b.y);
    const tr = pick(b => -(b.x - b.y));
    const br = pick(b => -(b.x + b.y));
    const bl = pick(b => b.x - b.y);
    let best = null;
    for (const a of tl) for (const b of tr) for (const c of br) for (const d of bl) {
      if (a === b || a === c || a === d || b === c || b === d || c === d) continue;
      const P0 = [[a.x, a.y], [b.x, b.y], [c.x, c.y], [d.x, d.y]];
      // convex & clockwise (screen coords)
      if (cross(P0[0], P0[1], P0[2]) <= 0 || cross(P0[1], P0[2], P0[3]) <= 0 ||
          cross(P0[2], P0[3], P0[0]) <= 0 || cross(P0[3], P0[0], P0[1]) <= 0) continue;
      const sizes = [a.size, b.size, c.size, d.size];
      if (Math.max(...sizes) > Math.min(...sizes) * 2.6) continue;
      // try the 4 rotations: sheet may be upside down or sideways
      for (let r = 0; r < 4; r++) {
        const P = P0.slice(r).concat(P0.slice(0, r));
        const top = dist(P[0], P[1]), bot = dist(P[3], P[2]), lef = dist(P[0], P[3]), rig = dist(P[1], P[2]);
        if (top < Math.min(w, h) * 0.15) continue;
        if (top / bot > 1.7 || bot / top > 1.7 || lef / rig > 1.7 || rig / lef > 1.7) continue;
        const aspect = (lef + rig) / (top + bot); // expected ~1.39
        if (aspect < 1.0 || aspect > 2.0) continue;
        const expSize = ((top + bot) / 2) * 0.0092;
        if (sizes.some(s => s < expSize * 0.35 || s > expSize * 2.6)) continue;
        const H = homography([[0, 0], [1, 0], [1, 1], [0, 1]], P);
        if (!H) continue;
        const v = validate(H, g, w, h, mm, Math.max(1, expSize * 0.35));
        if (!v) continue;
        const score = v + (1 - Math.abs(aspect - 1.39)) * 0.1;
        if (!best || score > best.score) best = { score, H, corners: P };
      }
    }
    return best;
  }

  // checks that known dark/white spots of the printed sheet are where the homography says
  function validate(H, g, w, h, mm, pr) {
    let dOk = 0, wOk = 0, dSum = 0, wSum = 0;
    for (const [u, v] of T.dark) {
      const [x, y] = project(H, u, v);
      const m = sampleMean(g, w, h, x, y, pr); if (m < 0) return 0;
      const ref = mm[Math.round(y) * w + Math.round(x)];
      if (m < ref * 0.7) dOk++;
      dSum += m;
    }
    for (const [u, v] of T.white) {
      const [x, y] = project(H, u, v);
      const m = sampleMean(g, w, h, x, y, pr); if (m < 0) return 0;
      const ref = mm[Math.round(y) * w + Math.round(x)];
      if (m > ref * 0.9) wOk++;
      wSum += m;
    }
    const fd = dOk / T.dark.length, fw = wOk / T.white.length;
    if (fd < 0.8 || fw < 0.8) return 0;
    const dk = dSum / T.dark.length, wt = wSum / T.white.length;
    if (wt - dk < 40) return 0;
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

  window.OMR = { _findBlobs: findBlobs, toGray, detectSheet, readSheet, decide, decodeId, project, MARK };
})();
