// OMR engine for the KFT Collegiate School answer sheet.
// Detection uses the 40 dark-blue question-number boxes (1..40) as anchors instead of the
// 4 tiny corner markers, so it still works when a corner is covered, the paper is bent,
// sheets are stacked, or the photo is taken from a distance.
// Pure JS, no dependencies.
(function () {
  const T = window.OMR_TEMPLATE;
  const DBG = {}; let LASTBEST = 0;
  // template works in a "sheet pixel" frame: unit coords scaled to the original scan size
  const SW = 1035, SH = 1438;

  // ---------- image prep ----------
  // gray: mostly red channel (blue print looks light, black/brown pen looks dark)
  // blue: how much bluer than red a pixel is (picks out the blue printed boxes)
  function toGray(imgData) {
    const { data, width, height } = imgData;
    const n = width * height, g = new Uint8Array(n), b = new Uint8Array(n);
    for (let i = 0, j = 0; j < n; i += 4, j++) {
      g[j] = (data[i] * 3 + data[i + 1]) >> 2;
      // blueness relative to brightness, so dim or warm light doesn't wash it out
      const d = data[i + 2] - data[i];
      b[j] = d > 0 ? Math.min(255, (d * 230) / (data[i + 2] + 25)) : 0;
    }
    g.blue = b;
    return g;
  }

  // ---------- step 1: candidate number boxes ----------
  function findBoxes(blue, w, h, k) {
    // threshold relative to the most saturated blue in the frame
    const hist = new Uint32Array(256);
    for (let i = 0; i < blue.length; i += 3) hist[blue[i]]++;
    const tot = Math.ceil(blue.length / 3);
    let acc = 0, p999 = 255;
    for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= tot * 0.001) { p999 = v; break; } }
    const thr = Math.max(12, Math.min(110, p999 * (k || 0.45)));
    const bin = new Uint8Array(w * h);
    for (let p = 0; p < bin.length; p++) if (blue[p] > thr) bin[p] = 1;

    // a number box is ~2.6% of the sheet width; even a far-away sheet gives > ~0.6% of the frame
    const maxSide = Math.max(w, h) / 14, minSide = Math.max(4, Math.round(Math.max(w, h) * 0.0055)), out = [];
    const stack = new Int32Array(w * h);
    for (let p = 0; p < bin.length; p++) {
      if (bin[p] !== 1) continue;
      let sp = 0; stack[sp++] = p; bin[p] = 2;
      let area = 0, sx = 0, sy = 0, minx = w, maxx = 0, miny = h, maxy = 0, sb = 0;
      while (sp) {
        const q = stack[--sp], qx = q % w, qy = (q / w) | 0;
        area++; sx += qx; sy += qy; sb += blue[q];
        if (qx < minx) minx = qx; if (qx > maxx) maxx = qx; if (qy < miny) miny = qy; if (qy > maxy) maxy = qy;
        if (qx > 0 && bin[q - 1] === 1) { bin[q - 1] = 2; stack[sp++] = q - 1; }
        if (qx < w - 1 && bin[q + 1] === 1) { bin[q + 1] = 2; stack[sp++] = q + 1; }
        if (qy > 0 && bin[q - w] === 1) { bin[q - w] = 2; stack[sp++] = q - w; }
        if (qy < h - 1 && bin[q + w] === 1) { bin[q + w] = 2; stack[sp++] = q + w; }
      }
      const bw = maxx - minx + 1, bh = maxy - miny + 1;
      if (bw < minSide || bh < minSide || bw > maxSide || bh > maxSide) continue;
      const ar = bw / bh;
      if (ar < 0.55 || ar > 1.8) continue;
      const fill = area / (bw * bh);
      if (fill < 0.38) continue;
      // centre of the bounding box is steadier than the centroid (white digit inside)
      out.push({ x: (minx + maxx) / 2, y: (miny + maxy) / 2, size: Math.sqrt(bw * bh), fill, bl: sb / area, x0: minx, x1: maxx, y0: miny, y1: maxy, area });
    }
    return mergeFragments(out);
  }
  function mergeFragments(c) {
    if (c.length < 4) return c;
    const sz = c.map(p => p.size).sort((a, b) => a - b), med = sz[sz.length >> 1];
    const big = med * 1.35;
    let changed = true;
    while (changed) {
      changed = false;
      outer: for (let i = 0; i < c.length; i++) for (let j = i + 1; j < c.length; j++) {
        const a = c[i], b = c[j];
        if (a.size > med * 0.8 && b.size > med * 0.8) continue;           // two whole boxes: never merge
        const x0 = Math.min(a.x0, b.x0), x1 = Math.max(a.x1, b.x1), y0 = Math.min(a.y0, b.y0), y1 = Math.max(a.y1, b.y1);
        if (x1 - x0 + 1 > big || y1 - y0 + 1 > big) continue;
        const gap = Math.max(0, Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1), Math.max(a.y0, b.y0) - Math.min(a.y1, b.y1));
        if (gap > med * 0.45) continue;
        const area = a.area + b.area, bw = x1 - x0 + 1, bh = y1 - y0 + 1;
        c[i] = { x: (x0 + x1) / 2, y: (y0 + y1) / 2, size: Math.sqrt(bw * bh), fill: area / (bw * bh), bl: (a.bl * a.area + b.bl * b.area) / area, x0, x1, y0, y1, area };
        c.splice(j, 1); changed = true; break outer;
      }
    }
    // leftover tiny bits are noise
    return c.filter(p => p.size > med * 0.45);
  }

  // spatial hash for nearest-candidate lookups
  function makeGrid(c, cell) {
    const m = new Map();
    c.forEach((p, i) => {
      const k = Math.floor(p.x / cell) + ',' + Math.floor(p.y / cell);
      if (!m.has(k)) m.set(k, []); m.get(k).push(i);
    });
    return {
      near(x, y, tol) {
        const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
        let best = -1, bd = tol * tol;
        for (let a = cx - 1; a <= cx + 1; a++) for (let b = cy - 1; b <= cy + 1; b++) {
          const l = m.get(a + ',' + b); if (!l) continue;
          for (const i of l) { const d = (c[i].x - x) ** 2 + (c[i].y - y) ** 2; if (d < bd) { bd = d; best = i; } }
        }
        return best;
      },
    };
  }

  // ---------- homography helpers ----------
  function project(H, u, v) {
    const z = H[6] * u + H[7] * v + H[8];
    return [(H[0] * u + H[1] * v + H[2]) / z, (H[3] * u + H[4] * v + H[5]) / z];
  }
  function solve(A, b) {             // gaussian elimination, A is n x n
    const n = b.length;
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
    return b.map((v, i) => v / A[i][i]);
  }
  // least-squares homography src -> dst (normalised DLT, h33 = 1)
  function fitH(src, dst) {
    const norm = (P) => {
      let mx = 0, my = 0; for (const [x, y] of P) { mx += x; my += y; } mx /= P.length; my /= P.length;
      let d = 0; for (const [x, y] of P) d += Math.hypot(x - mx, y - my); d = (d / P.length) || 1;
      const s = Math.SQRT2 / d; return { s, mx, my, P: P.map(([x, y]) => [(x - mx) * s, (y - my) * s]) };
    };
    const a = norm(src), b = norm(dst);
    const M = Array.from({ length: 8 }, () => new Array(8).fill(0)), r = new Array(8).fill(0);
    for (let i = 0; i < src.length; i++) {
      const [x, y] = a.P[i], [u, v] = b.P[i];
      const rows = [[x, y, 1, 0, 0, 0, -u * x, -u * y, u], [0, 0, 0, x, y, 1, -v * x, -v * y, v]];
      for (const row of rows) for (let j = 0; j < 8; j++) { r[j] += row[j] * row[8]; for (let k = 0; k < 8; k++) M[j][k] += row[j] * row[k]; }
    }
    const hn = solve(M, r); if (!hn) return null; hn.push(1);
    // denormalise: H = Tb^-1 * Hn * Ta
    const Ta = [a.s, 0, -a.s * a.mx, 0, a.s, -a.s * a.my, 0, 0, 1];
    const Tbi = [1 / b.s, 0, b.mx, 0, 1 / b.s, b.my, 0, 0, 1];
    const mul = (A, B) => { const C = new Array(9).fill(0); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) C[i * 3 + j] += A[i * 3 + k] * B[k * 3 + j]; return C; };
    const H = mul(Tbi, mul(hn, Ta));
    return H.map(v => v / H[8]);
  }

  // template box centres in sheet-pixel frame
  const BOX = T.box.map(([u, v]) => [u * SW, v * SH]);
  const STEP = Math.hypot(BOX[1][0] - BOX[0][0], BOX[1][1] - BOX[0][1]);   // spacing between rows

  // ---------- step 2: find the box lattice ----------
  function fitLattice(c, w, h) {
    if (c.length < 6) return [];
    const cell = Math.max(8, Math.max(w, h) / 40), grid = makeGrid(c, cell);
    const byPair = [];
    // a hypothesis = one candidate + a neighbour one row below/above it
    for (let i = 0; i < c.length; i++) {
      const p = c[i];
      for (let j = 0; j < c.length; j++) {
        if (i === j) continue;
        const q = c[j], d = Math.hypot(q.x - p.x, q.y - p.y);
        if (d < p.size * 1.05 || d > p.size * 2.3) continue;
        if (q.size > p.size * 1.5 || p.size > q.size * 1.5) continue;
        byPair.push([i, j, d]);
      }
    }
    if (!byPair.length) return [];
    const hyps = [];
    const tried = new Set();
    for (const [i, j, d] of byPair) {
      const p = c[i], q = c[j], vx = q.x - p.x, vy = q.y - p.y;
      // how many boxes sit on this line at whole steps?
      const chain = [];
      for (let k = -4; k <= 4; k++) { const n = grid.near(p.x + vx * k, p.y + vy * k, d * 0.28); if (n >= 0) chain.push(k); }
      if (chain.length < 3) continue;
      const key = Math.min(...chain.map(k => grid.near(p.x + vx * k, p.y + vy * k, d * .28)));
      const sig = key + ':' + Math.round(Math.atan2(vy, vx) * 10);
      if (tried.has(sig)) continue; tried.add(sig);
      const kmin = Math.min(...chain), kmax = Math.max(...chain);
      // similarity: template "down one row" maps to (vx,vy)
      const scale = d / STEP, ang = Math.atan2(vy, vx) - Math.PI / 2;
      const ca = Math.cos(ang) * scale, sa = Math.sin(ang) * scale;
      for (let idx = 0; idx < 40; idx++) {
        const r = idx % 5;
        if (r + kmin < 0 || r + kmax > 4) continue;           // whole chain must fit in one column
        const [ox, oy] = BOX[idx];
        let count = 0; const pairs = [];
        const tol = d * 0.32;
        for (let t = 0; t < 40; t++) {
          const dx = BOX[t][0] - ox, dy = BOX[t][1] - oy;
          const x = p.x + ca * dx - sa * dy, y = p.y + sa * dx + ca * dy;
          const n = grid.near(x, y, tol);
          if (n >= 0) { count++; pairs.push([t, n]); }
        }
        if (count >= 4) hyps.push({ count, pairs, step: d });
      }
    }
    // structural hypotheses (column chains) first: they survive perspective and bending
    const sh = chainHypotheses(c, grid, byPair);
    hyps.sort((x, y) => y.count - x.count);
    hyps.unshift(...sh);
    LASTBEST = hyps.length ? hyps[0].count : 0;
    const seen = new Set(), results = [];
    for (const hy of hyps) {
      const sig = hy.pairs.map(p => p.join(':')).sort().join(',');
      if (seen.has(sig)) continue; seen.add(sig);
      const L = grow(c, grid, hy);
      if (L) { results.push(L); if (L.pairs.length >= 38) break; }   // practically perfect: stop early
      if (seen.size >= 90) break;
    }
    return results;
  }

  // ---- find 5-box columns ("chains") and arrange them into the 2 x 4 block layout ----
  function chainHypotheses(c, grid, byPair) {
    const chains = [];
    for (const [i, j, d] of byPair) {
      const p = c[i], q = c[j], vx = q.x - p.x, vy = q.y - p.y;
      // walk along the column in both directions, adapting the step as it goes (perspective changes spacing)
      const mem = [[0, i], [1, j]];
      const walk = (from, prev, dir, k0) => {
        let cur = from, sx = (c[cur].x - c[prev].x), sy = (c[cur].y - c[prev].y), k = k0;
        for (let s = 0; s < 4; s++) {
          let n = grid.near(c[cur].x + sx, c[cur].y + sy, d * 0.3), skip = 1;
          if (n < 0) { n = grid.near(c[cur].x + 2 * sx, c[cur].y + 2 * sy, d * 0.35); skip = 2; }   // one smudged box
          if (n < 0 || mem.some(m => m[1] === n)) break;
          k += dir * skip; mem.push([k, n]);
          sx = (c[n].x - c[cur].x) / skip; sy = (c[n].y - c[cur].y) / skip; cur = n;
        }
      };
      walk(j, i, 1, 1); walk(i, j, -1, 0);
      let bestW = null;
      for (let k0 = -4; k0 <= 1; k0++) { const w = mem.filter(([k]) => k >= k0 && k <= k0 + 4); if (!bestW || w.length > bestW.length) bestW = w; }
      if (bestW.length < 3) continue;
      // local step from the members themselves (straighter than the seed pair)
      chains.push({ mem: bestW, vx, vy, d, key: bestW.map(m => m[1]).sort((a, b) => a - b).join(',') });
    }
    // keep the longest chains, each box used once
    for (const ch of chains) {      // spacing regularity: smaller is better
      const pts = ch.mem.slice().sort((a, b) => a[0] - b[0]); let e = 0;
      for (let t = 1; t < pts.length; t++) { const dk = pts[t][0] - pts[t - 1][0], p = c[pts[t - 1][1]], q = c[pts[t][1]];
        e += Math.abs(Math.hypot(q.x - p.x, q.y - p.y) / dk - ch.d) / ch.d; }
      ch.irr = e / Math.max(1, pts.length - 1);
    }
    chains.sort((a, b) => (b.mem.length - a.mem.length) || (a.irr - b.irr));
    const used = new Set(), keep = [];
    for (const ch of chains) {
      if (ch.mem.some(([, n]) => used.has(n))) continue;
      ch.mem.forEach(([, n]) => used.add(n)); keep.push(ch);
      if (keep.length >= 16) break;
    }
    if (keep.length < 2) return [];
    // consensus from the longest chains: direction (mod 180) and step length
    {
      const full = keep.filter(ch => ch.mem.length >= 4).length >= 2 ? keep.filter(ch => ch.mem.length >= 4) : keep;
      const angs = full.map(ch => { let a = Math.atan2(ch.vy, ch.vx); if (a < 0) a += Math.PI; return a; }).sort((a, b) => a - b);
      const medA = angs[angs.length >> 1], ds = full.map(ch => ch.d).sort((a, b) => a - b), medD = ds[ds.length >> 1];
      for (let i = keep.length - 1; i >= 0; i--) {
        let a = Math.atan2(keep[i].vy, keep[i].vx); if (a < 0) a += Math.PI;
        let da = Math.abs(a - medA); da = Math.min(da, Math.PI - da);
        if (da > 0.3 || keep[i].d < medD * 0.7 || keep[i].d > medD * 1.4) keep.splice(i, 1);
      }
      if (keep.length < 2) return [];
      keep.splice(8);
    }
    // common "down the column" direction
    const ref = keep[0];
    for (const ch of keep) if (ch.vx * ref.vx + ch.vy * ref.vy < 0) { ch.vx = -ch.vx; ch.vy = -ch.vy; ch.mem = ch.mem.map(([k, n]) => [-k, n]); }
    let sx = 0, sy = 0, sd = 0; for (const ch of keep) { sx += ch.vx; sy += ch.vy; sd += ch.d; }
    const L = Math.hypot(sx, sy), vh = [sx / L, sy / L], uh = [vh[1], -vh[0]], step = sd / keep.length;
    for (const ch of keep) {
      ch.mem.sort((a, b) => a[0] - b[0]);
      ch.kmin = ch.mem[0][0]; ch.span = ch.mem[ch.mem.length - 1][0] - ch.kmin;
      let cx = 0, cy = 0; for (const [, n] of ch.mem) { cx += c[n].x; cy += c[n].y; } cx /= ch.mem.length; cy /= ch.mem.length;
      ch.a = cx * uh[0] + cy * uh[1]; ch.b = cx * vh[0] + cy * vh[1];
      const f = c[ch.mem[0][1]]; ch.firstB = f.x * vh[0] + f.y * vh[1];
    }
    // split into top / bottom half by a big gap along the column direction
    const byB = keep.slice().sort((a, b) => a.b - b.b);
    let groups = [byB];
    for (let i = 1; i < byB.length; i++) if (byB[i].b - byB[i - 1].b > step * 3) { groups = [byB.slice(0, i), byB.slice(i)]; break; }
    // row shift for chains with a missing box at the top: their head must sit on the line
    // through the heads of the complete chains of the same half (perspective-safe)
    const chainStep = (ch) => { const f = c[ch.mem[0][1]], l = c[ch.mem[ch.mem.length - 1][1]], sp = Math.max(1, ch.span);
      return [(l.x - f.x) / sp, (l.y - f.y) / sp]; };
    for (const g of groups) {
      const full = g.filter(ch => ch.span === 4);
      const heads = full.map(ch => c[ch.mem[0][1]]);
      let lp = null, ld = null;
      if (heads.length >= 2) {
        heads.sort((p, q) => (p.x * uh[0] + p.y * uh[1]) - (q.x * uh[0] + q.y * uh[1]));
        const h0 = heads[0], h1 = heads[heads.length - 1], L2 = Math.hypot(h1.x - h0.x, h1.y - h0.y) || 1;
        lp = [h0.x, h0.y]; ld = [(h1.x - h0.x) / L2, (h1.y - h0.y) / L2];
      } else if (heads.length === 1) { lp = [heads[0].x, heads[0].y]; ld = uh; }
      for (const ch of g) {
        ch.shift = 0;
        if (ch.span < 4 && lp) {
          const f = c[ch.mem[0][1]], [sx, sy] = chainStep(ch);
          let bs = 0, be = 1e9;
          for (let s = 0; s <= 4 - ch.span; s++) {
            const hx = f.x - s * sx - lp[0], hy = f.y - s * sy - lp[1];
            const e = Math.abs(hx * ld[1] - hy * ld[0]);           // distance from the head line
            if (e < be) { be = e; bs = s; }
          }
          ch.shift = bs;
        }
      }
    }
    // columns: blocks are ~5.7 row-steps apart sideways
    const colGap = step * (BOX[5][0] - BOX[0][0]) / STEP;
    const aMin = Math.min(...keep.map(ch => ch.a));
    for (const ch of keep) ch.col = Math.round((ch.a - aMin) / colGap);
    const maxCol = Math.max(...keep.map(ch => ch.col));
    if (maxCol > 3) return [];
    const out = [];
    const halfOpts = groups.length === 2 ? [[0, 1]] : [[0], [1]];
    // partial chains: besides the estimated row shift, also try the other possible shifts
    const partial = keep.filter(ch => ch.span < 4);
    let shiftSets = [partial.map(ch => ch.shift)];
    for (let pi = 0; pi < partial.length; pi++) {
      const next = [];
      for (const set of shiftSets) for (let s = 0; s <= 4 - partial[pi].span; s++) {
        if (s === set[pi]) continue; const n = set.slice(); n[pi] = s; next.push(n);
      }
      shiftSets = shiftSets.concat(next).slice(0, 24);
    }
    for (const set of shiftSets) {
      partial.forEach((ch, pi) => { ch.curShift = set[pi]; });
      for (let o = 0; o <= 3 - maxCol; o++) for (const hs of halfOpts) {
        const pairs = [];
        groups.forEach((g, gi) => g.forEach(ch => ch.mem.forEach(([k, n]) => {
          const sh = ch.span < 4 ? ch.curShift : 0;
          const row = k - ch.kmin + sh; if (row < 0 || row > 4) return;
          pairs.push([(hs[gi] * 4 + ch.col + o) * 5 + row, n]);
        })));
        out.push({ count: pairs.length + 100, pairs, step });   // +100: try these before the brute-force ones
      }
    }
    return out;
  }

  function grow(c, grid, best) {
    // grow the match outwards using a LOCAL affine from the nearest already-matched boxes,
    // so strong perspective / bent paper doesn't break it
    const match = new Map(best.pairs);           // template idx -> candidate idx
    const used = new Set(match.values());
    const predict = (t) => {
      const near = [...match.keys()].map(k => [k, (BOX[k][0] - BOX[t][0]) ** 2 + (BOX[k][1] - BOX[t][1]) ** 2])
        .sort((a, b) => a[1] - b[1]).slice(0, 6).map(([k]) => k);
      if (near.length < 2) return null;
      // affine fit (least squares) if the neighbours are not all in one column, else similarity
      const xs = new Set(near.map(k => Math.round(BOX[k][0] / 60)));
      if (xs.size >= 2 && near.length >= 3) {
        const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], bx = [0, 0, 0], by = [0, 0, 0];
        for (const k of near) { const r = [BOX[k][0], BOX[k][1], 1], cc = c[match.get(k)];
          for (let i = 0; i < 3; i++) { bx[i] += r[i] * cc.x; by[i] += r[i] * cc.y; for (let j = 0; j < 3; j++) M[i][j] += r[i] * r[j]; } }
        const ax = solve(M.map(r => r.slice()), bx.slice()), ay = solve(M.map(r => r.slice()), by.slice());
        if (ax && ay) return [ax[0] * BOX[t][0] + ax[1] * BOX[t][1] + ax[2], ay[0] * BOX[t][0] + ay[1] * BOX[t][1] + ay[2]];
      }
      const [k1, k2] = near, p1 = c[match.get(k1)], p2 = c[match.get(k2)];
      const tx = BOX[k2][0] - BOX[k1][0], ty = BOX[k2][1] - BOX[k1][1], ix = p2.x - p1.x, iy = p2.y - p1.y;
      const den = tx * tx + ty * ty; if (!den) return null;
      const a = (ix * tx + iy * ty) / den, b2 = (iy * tx - ix * ty) / den;
      const dx = BOX[t][0] - BOX[k1][0], dy = BOX[t][1] - BOX[k1][1];
      return [p1.x + a * dx - b2 * dy, p1.y + b2 * dx + a * dy];
    };
    const stepPx = () => {          // current row spacing in image px
      let s = 0, n = 0;
      for (const [k, ci] of match) if (k % 5 < 4 && match.has(k + 1)) { const p = c[ci], q = c[match.get(k + 1)]; s += Math.hypot(q.x - p.x, q.y - p.y); n++; }
      return n ? s / n : best.step;
    };
    for (let round = 0; round < 12; round++) {
      let grew = false; const sp = stepPx();
      // try template boxes closest to the matched set first
      const order = [...Array(40).keys()].filter(t => !match.has(t)).map(t => [t, Math.min(...[...match.keys()].map(k => (BOX[k][0] - BOX[t][0]) ** 2 + (BOX[k][1] - BOX[t][1]) ** 2))])
        .sort((a, b) => a[1] - b[1]).map(([t]) => t);
      for (const t of order) {
        const p = predict(t); if (!p) continue;
        const n = grid.near(p[0], p[1], sp * 0.3);
        if (n >= 0 && !used.has(n)) { match.set(t, n); used.add(n); grew = true; }
      }
      if (!grew) break;
    }
    let pairs = [...match.entries()], H = null;
    // global homography with outlier rejection
    for (let it = 0; it < 3; it++) {
      const cols = new Set(pairs.map(([t]) => Math.floor(t / 5)));
      if (pairs.length < 6 || cols.size < 2) return null;
      H = fitH(pairs.map(([t]) => BOX[t]), pairs.map(([, n]) => [c[n].x, c[n].y]));
      if (!H) return null;
      const sp = stepPx();
      const keep = pairs.filter(([t, n]) => { const [x, y] = project(H, BOX[t][0], BOX[t][1]); return Math.hypot(c[n].x - x, c[n].y - y) < sp * 0.45; });
      if (keep.length === pairs.length) break;
      pairs = keep;
    }
    const cols = new Set(pairs.map(([t]) => Math.floor(t / 5)));
    if (pairs.length < 14 || cols.size < 4) return null;
    H = fitH(pairs.map(([t]) => BOX[t]), pairs.map(([, n]) => [c[n].x, c[n].y]));
    if (!H) return null;
    // residual of each found box -> local correction for its row (paper bending)
    const resid = new Array(40).fill(null);
    let err = 0;
    for (const [t, n] of pairs) {
      const [x, y] = project(H, BOX[t][0], BOX[t][1]);
      resid[t] = [c[n].x - x, c[n].y - y]; err += Math.hypot(resid[t][0], resid[t][1]);
    }
    return { H, pairs, resid, err: err / pairs.length };
  }

  // centre of the box lattice in sheet px: rotating 180 deg about it maps boxes onto boxes
  const LC = BOX.reduce((a, p) => [a[0] + p[0] / 40, a[1] + p[1] / 40], [0, 0]);
  const PARTNER = BOX.map(([x, y]) => {
    let bi = 0, bd = 1e9; BOX.forEach(([u, v], i) => { const d = (u - (2 * LC[0] - x)) ** 2 + (v - (2 * LC[1] - y)) ** 2; if (d < bd) { bd = d; bi = i; } });
    return bi;
  });

  // sheet-pixel H -> unit-coordinate H (what the rest of the app uses)
  function toUnitH(H) {
    return [H[0] * SW, H[1] * SH, H[2], H[3] * SW, H[4] * SH, H[5], H[6] * SW, H[7] * SH, H[8]];
  }

  // ---------- sheet detection ----------
  function detectSheet(g, w, h) {
    if (!g.blue) return null;
    // normal light first; if that fails, retry with a lower blue threshold (dim / washed-out photos)
    for (const k of [0.45, 0.3]) {
      const r = detectWith(findBoxes(g.blue, w, h, k), g, w, h);
      if (r) return r;
    }
    return null;
  }
  function detectWith(cand, g, w, h) {
    if (cand.length > 260) return null;      // far too many blue blobs: not a sheet (or pure noise)
    const Ls = fitLattice(cand, w, h);
    DBG.cand = cand.length; DBG.hyps = Ls.length; DBG.best = LASTBEST;
    if (!Ls.length) return null;
    // the box lattice looks almost the same upside down (and shifted by a column), but the
    // printed answer circles are only to the RIGHT of each box: score every reading by how well
    // the circles line up and keep the best
    const bubbleFit = (Hs) => {
      const Hu = toUnitH(Hs), pts = [];
      for (let i = 0; i < 40; i++) for (let j = 0; j < 4; j++) pts.push(bubbleGeom(Hu, T.q[i][j][0], T.q[i][j][1]));
      return ringScore(g, w, h, pts, 0, 0) / pts.length;
    };
    let L = null, fit = -1e9;
    for (const L0 of Ls) {
      const f0 = bubbleFit(L0.H) / 5 + L0.pairs.length;
      if (f0 > fit) { fit = f0; L = L0; }
      const flipPairs = L0.pairs.map(([t, n]) => [PARTNER[t], n]);
      const Hf = fitH(flipPairs.map(([t]) => BOX[t]), flipPairs.map(([, n]) => [cand[n].x, cand[n].y]));
      if (!Hf) continue;
      const f1 = bubbleFit(Hf) / 5 + L0.pairs.length;
      if (f1 > fit) {
        const resid = new Array(40).fill(null);
        for (const [t, n] of flipPairs) { const [x, y] = project(Hf, BOX[t][0], BOX[t][1]); resid[t] = [cand[n].x - x, cand[n].y - y]; }
        fit = f1; L = { H: Hf, pairs: flipPairs, resid };
      }
    }
    fit = (fit - L.pairs.length) * 5;
    DBG.fit = fit; DBG.lat = L.pairs.length;
    if (fit < 4) return null;          // circles not where they should be: not our sheet
    const H = toUnitH(L.H);
    const corners = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([u, v]) => project(H, u, v));
    return { H, corners, resid: L.resid, found: L.pairs.length, score: L.pairs.length };
  }

  // ---------- step 3: local alignment ----------
  // how well a set of printed bubble outlines lines up at offset (dx,dy)
  function ringScore(g, w, h, pts, dx, dy) {
    let s = 0;
    for (const b of pts) {
      let ring = 0, out = 0, n = 0;
      for (let k = 0; k < 12; k++) {
        const a = k * Math.PI / 6, c = Math.cos(a), si = Math.sin(a);
        const x1 = Math.round(b.x + dx + c * b.R), y1 = Math.round(b.y + dy + si * b.R);
        const x2 = Math.round(b.x + dx + c * b.R * 1.45), y2 = Math.round(b.y + dy + si * b.R * 1.45);
        if (x2 < 0 || y2 < 0 || x2 >= w || y2 >= h || x1 < 0 || y1 < 0 || x1 >= w || y1 >= h) continue;
        ring += g[y1 * w + x1]; out += g[y2 * w + x2]; n++;
      }
      if (n) s += (out - ring) / n;
    }
    return s;
  }
  // shift a group of bubbles to where the printed circles really are (limited search)
  function alignGroup(g, w, h, pts, maxShift) {
    const r = Math.max(2, Math.round(maxShift));
    let best = ringScore(g, w, h, pts, 0, 0), bx = 0, by = 0;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (!dx && !dy) continue;
      const s = ringScore(g, w, h, pts, dx, dy) - 0.02 * (dx * dx + dy * dy);   // small preference for no shift
      if (s > best) { best = s; bx = dx; by = dy; }
    }
    for (const b of pts) { b.x += bx; b.y += by; }
    return [bx, by];
  }

  // ---------- bubble reading ----------
  function bubbleGeom(H, u, v) {
    const [cx, cy] = project(H, u, v);
    const [ex, ey] = project(H, u + T.r, v);
    const [fx, fy] = project(H, u, v + T.ry);
    return { x: cx, y: cy, R: (Math.hypot(ex - cx, ey - cy) + Math.hypot(fx - cx, fy - cy)) / 2 };
  }
  function measureFill(g, w, h, b) {
    const { x: cx, y: cy, R } = b;
    const ring = [];
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const px = Math.round(cx + Math.cos(a) * R * 1.6), py = Math.round(cy + Math.sin(a) * R * 1.6);
      if (px >= 0 && py >= 0 && px < w && py < h) ring.push(g[py * w + px]);
    }
    ring.sort((p, q) => p - q);
    const white = ring.length ? ring[Math.floor(ring.length * 0.75)] : 200;
    const thr = white * 0.62, ir = R * 0.62;
    let n = 0, dark = 0;
    const step = Math.max(.75, ir / 5);
    for (let dy = -ir; dy <= ir; dy += step) for (let dx = -ir; dx <= ir; dx += step) {
      if (dx * dx + dy * dy > ir * ir) continue;
      const px = Math.round(cx + dx), py = Math.round(cy + dy);
      if (px < 0 || py < 0 || px >= w || py >= h) continue;
      n++; if (g[py * w + px] < thr) dark++;
    }
    b.fill = n ? dark / n : 0;
    return b;
  }

  // Returns geometry + fill values for all bubbles
  function readSheet(g, w, h, H, sheet) {
    const resid = sheet && sheet.resid;
    // answers: start from H, move each row by its own number-box residual (bending), then fine-align each block
    // a box can be smudged (red ticks over it), so per block: drop residuals that disagree with the rest,
    // then fit a straight line through the good ones (bending changes smoothly down a column)
    const rowOff = new Array(40).fill(null);
    if (resid) {
      for (let blk = 0; blk < 8; blk++) {
        const ks = [0, 1, 2, 3, 4].map(k => blk * 5 + k).filter(k => resid[k]);
        if (!ks.length) continue;
        const med = (arr) => { const s = arr.slice().sort((x, y) => x - y); return s[s.length >> 1]; };
        const mx = med(ks.map(k => resid[k][0])), my = med(ks.map(k => resid[k][1]));
        const b0 = bubbleGeom(H, T.q[blk * 5][0][0], T.q[blk * 5][0][1]);
        const good = ks.filter(k => Math.hypot(resid[k][0] - mx, resid[k][1] - my) < b0.R * 0.5);
        for (let k = 0; k < 5; k++) {
          const i = blk * 5 + k;
          if (good.length >= 3) {          // least-squares line through (row, offset)
            const n = good.length, xs = good.map(j => j % 5), sx = xs.reduce((a, v) => a + v, 0) / n;
            const fit = (dim) => { const ys = good.map(j => resid[j][dim]), sy = ys.reduce((a, v) => a + v, 0) / n;
              let num = 0, den = 0; xs.forEach((x, t) => { num += (x - sx) * (ys[t] - sy); den += (x - sx) ** 2; });
              const m = den ? num / den : 0; return sy + m * (k - sx); };
            rowOff[i] = [fit(0), fit(1)];
          } else rowOff[i] = [mx, my];
        }
      }
    }
    const q = T.q.map((row, i) => row.map(([u, v]) => {
      const b = bubbleGeom(H, u, v); const off = rowOff[i];
      if (off) { b.x += off[0]; b.y += off[1]; }
      return b;
    }));
    for (let blk = 0; blk < 8; blk++) {
      const pts = q.slice(blk * 5, blk * 5 + 5).flat();
      alignGroup(g, w, h, pts, pts[0].R * 0.45);
    }
    for (const row of q) alignGroup(g, w, h, row, row[0].R * 0.3);   // last small per-row touch-up
    // student ID: no boxes nearby, so align the whole grid on its printed circles (wider search), then per column
    const id = T.id.map(col => col.map(([u, v]) => bubbleGeom(H, u, v)));
    alignGroup(g, w, h, id.flat(), id[0][0].R * 1.1);
    for (const col of id) alignGroup(g, w, h, col, col[0].R * 0.35);
    q.forEach(r => r.forEach(b => measureFill(g, w, h, b)));
    id.forEach(c => c.forEach(b => measureFill(g, w, h, b)));
    return { q, id };
  }

  const MARK = 0.45;
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
    }).join('');
  }

  window.OMR = { _dbg: DBG, _findBoxes: findBoxes, toGray, detectSheet, readSheet, decide, decodeId, project, MARK };
})();
