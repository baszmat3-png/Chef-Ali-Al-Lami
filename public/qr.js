/* مولّد QR مضمّن (بدون مكتبات خارجية): وضع Byte، تصحيح أخطاء M، النسخ 1–10 */
(function (root) {
  const EXP = new Array(512), LOG = new Array(256);
  for (let i = 0, x = 1; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11d; }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

  // [ecc لكل كتلة, عدد كتل المجموعة 1, بيانات المجموعة 1, عدد كتل المجموعة 2, بيانات المجموعة 2] — مستوى M
  const TBL = [null, [10, 1, 16, 0, 0], [16, 1, 28, 0, 0], [26, 1, 44, 0, 0], [18, 2, 32, 0, 0], [24, 2, 43, 0, 0],
    [16, 4, 27, 0, 0], [18, 4, 31, 0, 0], [22, 2, 38, 2, 39], [22, 3, 36, 2, 37], [26, 4, 43, 1, 44]];
  const ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
  const dataCap = v => { const t = TBL[v]; return t[1] * t[2] + t[3] * t[4]; };

  function rsGen(n) {
    const r = new Array(n).fill(0); r[n - 1] = 1; let root = 1;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) { r[j] = mul(r[j], root); if (j + 1 < n) r[j] ^= r[j + 1]; }
      root = mul(root, 2);
    }
    return r;
  }
  function rsRem(data, gen) {
    const rem = new Array(gen.length).fill(0);
    for (const b of data) {
      const f = b ^ rem.shift(); rem.push(0);
      for (let i = 0; i < gen.length; i++) rem[i] ^= mul(gen[i], f);
    }
    return rem;
  }

  function make(text) {
    const bytes = Array.from(new TextEncoder().encode(String(text)));
    let v = 1;
    while (v <= 10 && bytes.length > dataCap(v) - (v < 10 ? 2 : 3)) v++;
    if (v > 10) throw new Error('QR: النص طويل');
    const bits = [];
    const put = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
    put(4, 4); put(bytes.length, v < 10 ? 8 : 16); bytes.forEach(b => put(b, 8));
    const cap = dataCap(v) * 8;
    put(0, Math.min(4, cap - bits.length));
    while (bits.length % 8) bits.push(0);
    for (let pad = 0xEC; bits.length < cap; pad ^= 0xEC ^ 0x11) put(pad, 8);
    const cw = []; for (let i = 0; i < bits.length; i += 8) cw.push(parseInt(bits.slice(i, i + 8).join(''), 2));

    const [ecn, n1, d1, n2, d2] = TBL[v], gen = rsGen(ecn), blocks = [], eccs = [];
    let p = 0;
    for (let i = 0; i < n1 + n2; i++) {
      const len = i < n1 ? d1 : d2, d = cw.slice(p, p + len); p += len;
      blocks.push(d); eccs.push(rsRem(d, gen));
    }
    const all = [];
    for (let i = 0; i < Math.max(d1, d2); i++) blocks.forEach(b => { if (i < b.length) all.push(b[i]); });
    for (let i = 0; i < ecn; i++) eccs.forEach(e => all.push(e[i]));

    const size = v * 4 + 17;
    const M = Array.from({ length: size }, () => new Array(size).fill(false));
    const FN = Array.from({ length: size }, () => new Array(size).fill(false));
    const setF = (x, y, d) => { if (x >= 0 && y >= 0 && x < size && y < size) { M[y][x] = !!d; FN[y][x] = true; } };
    for (let i = 0; i < size; i++) { setF(6, i, i % 2 === 0); setF(i, 6, i % 2 === 0); }
    const finder = (cx, cy) => { for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const d = Math.max(Math.abs(dx), Math.abs(dy)); setF(cx + dx, cy + dy, d !== 2 && d !== 4); } };
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
    const al = ALIGN[v], last = al.length - 1;
    for (let i = 0; i < al.length; i++) for (let j = 0; j < al.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) setF(al[i] + dx, al[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
    const drawFormat = mask => {
      let rem = mask; for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      const f = ((mask << 10) | rem) ^ 0x5412, g = i => ((f >>> i) & 1) === 1;
      for (let i = 0; i <= 5; i++) setF(8, i, g(i));
      setF(8, 7, g(6)); setF(8, 8, g(7)); setF(7, 8, g(8));
      for (let i = 9; i < 15; i++) setF(14 - i, 8, g(i));
      for (let i = 0; i < 8; i++) setF(size - 1 - i, 8, g(i));
      for (let i = 8; i < 15; i++) setF(8, size - 15 + i, g(i));
      setF(8, size - 8, true);
    };
    drawFormat(0);
    if (v >= 7) {
      let rem = v; for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
      const vb = (v << 12) | rem;
      for (let i = 0; i < 18; i++) { const b = ((vb >>> i) & 1) === 1, a = size - 11 + (i % 3), c = Math.floor(i / 3); setF(a, c, b); setF(c, a, b); }
    }
    // وضع البتات
    let k = 0; const total = all.length * 8;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
        const x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - vert : vert;
        if (!FN[y][x] && k < total) { M[y][x] = ((all[k >>> 3] >>> (7 - (k & 7))) & 1) === 1; k++; }
      }
    }
    const MASKS = [(x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x, y) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
      (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => (x * y) % 2 + (x * y) % 3 === 0,
      (x, y) => ((x * y) % 2 + (x * y) % 3) % 2 === 0, (x, y) => ((x + y) % 2 + (x * y) % 3) % 2 === 0];
    const applyMask = m => { for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!FN[y][x] && MASKS[m](x, y)) M[y][x] = !M[y][x]; };
    const penalty = () => {
      let s = 0; const lines = [];
      for (let y = 0; y < size; y++) lines.push(M[y].map(b => (b ? '1' : '0')).join(''));
      for (let x = 0; x < size; x++) lines.push(M.map(r => (r[x] ? '1' : '0')).join(''));
      for (const l of lines) {
        const runs = l.match(/(.)\1{4,}/g) || []; runs.forEach(r => (s += r.length - 2));
        s += 40 * ((l.match(/(?=(10111010000|00001011101))/g) || []).length);
      }
      for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) { const c = M[y][x]; if (c === M[y][x + 1] && c === M[y + 1][x] && c === M[y + 1][x + 1]) s += 3; }
      let dark = 0; M.forEach(r => r.forEach(b => { if (b) dark++; }));
      s += Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10;
      return s;
    };
    let best = 0, bestP = Infinity;
    for (let m = 0; m < 8; m++) { applyMask(m); drawFormat(m); const pp = penalty(); if (pp < bestP) { bestP = pp; best = m; } applyMask(m); }
    applyMask(best); drawFormat(best);
    return M;
  }

  function svg(text, px) {
    const M = make(text), n = M.length, q = 4;
    let d = '';
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (M[y][x]) d += `M${x + q} ${y + q}h1v1h-1z`;
    const t = n + q * 2;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${t} ${t}" width="${px || 200}" height="${px || 200}" shape-rendering="crispEdges"><rect width="${t}" height="${t}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
  }
  root.QR = { make, svg };
  if (typeof module !== 'undefined') module.exports = root.QR;
})(typeof window !== 'undefined' ? window : globalThis);
