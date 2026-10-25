const express = require('express'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const open = require('./store');
const app = express();
app.set('trust proxy', 1);

const PASS = process.env.ADMIN_PASSWORD || 'admin123';
const OWNER = String(process.env.ADMIN_EMAIL || 'admin').trim().toLowerCase();
if (!process.env.ADMIN_PASSWORD) console.warn('⚠️  ADMIN_PASSWORD غير مضبوط — كلمة المرور الحالية admin123، غيّرها فوراً.');

const PERMS = ['info', 'add', 'edit', 'delete', 'offers', 'tables', 'branches'];
const seq = (a, b) => { a = Buffer.from(String(a)); b = Buffer.from(String(b)); return a.length === b.length && crypto.timingSafeEqual(a, b); };
const hash = (pw, salt) => crypto.scryptSync(pw, salt, 32).toString('hex');
const pub = u => ({ id: u.id, name: u.name, email: u.email, perms: u.perms, owner: !!u.owner, active: u.active !== false });
const OWNER_USER = { id: 'owner', name: 'المالك', email: OWNER, perms: PERMS, owner: true, active: true };
const sha = b => crypto.createHash('sha1').update(b).digest('hex').slice(0, 20);
const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(e => { console.error(e); if (!res.headersSent) res.status(500).json({ error: 'server' }); });

let S;                       // التخزين
let MENU = null;             // { d, s } نسخة المنيو في الذاكرة (القراءة العامة سريعة)
let USERS = [];
let SECRET_T = '';           // سر توقيع رموز الطاولات (يُحفظ مع البيانات فلا يتغير بتغيّر كلمة المرور)
let CTR = 9900;              // رقم الطلب التالي
let RT = [];                 // تقييمات الزبائن (الأحدث أولاً)
let TOP = null;              // الأصناف الأكثر طلباً (تخزين مؤقت)
let lastAuto = 0;

let chain = Promise.resolve();
const lock = fn => { const r = chain.then(fn, fn); chain = r.catch(() => {}); return r; };

const mkMenu = d => ({ d, s: JSON.stringify(d) });
const SIGN = crypto.createHash('sha256').update('tok|' + PASS).digest();
const sign = p => { const b = Buffer.from(JSON.stringify(p)).toString('base64url'); return b + '.' + crypto.createHmac('sha256', SIGN).update(b).digest('base64url'); };
function verify(t) {
  const [b, s] = String(t || '').split('.'); if (!b || !s) return null;
  if (!seq(s, crypto.createHmac('sha256', SIGN).update(b).digest('base64url'))) return null;
  try { const p = JSON.parse(Buffer.from(b, 'base64url')); return p.x > Date.now() ? p : null; } catch { return null; }
}
function who(req) {
  const t = req.get('x-admin-token') || '';
  if (t && seq(t, PASS)) return OWNER_USER;
  const p = verify(t); if (!p) return null;
  if (p.u === 'owner') return OWNER_USER;
  const u = USERS.find(x => x.id === p.u);
  return u && u.active !== false ? pub(u) : null;
}
// need: 'owner' | 'perm' | ['perm1','perm2'] (أي واحدة تكفي) | undefined (أي مستخدم مسجّل)
const auth = need => (req, res, next) => {
  const u = who(req); if (!u) return res.status(401).json({ error: 'unauthorized' });
  if (need === 'owner' ? !u.owner : (need && !u.owner && !(Array.isArray(need) ? need : [need]).some(p => u.perms.includes(p)))) return res.status(403).json({ error: 'forbidden' });
  req.user = u; next();
};
const fails = new Map();
const limited = k => { const n = Date.now(), a = (fails.get(k) || []).filter(t => n - t < 9e5); fails.set(k, a); return a.length >= 10; };
const oLim = new Map();
const orderLimited = k => { const n = Date.now(), a = (oLim.get(k) || []).filter(t => n - t < 6e5); a.push(n); oLim.set(k, a); return a.length > 20; };

/* ---- الصلاحيات المطلوبة لتغيير من بيانات إلى أخرى ---- */
const J = JSON.stringify;
const nz = v => (v == null || v === '' || (Array.isArray(v) && !v.length) || (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length)) ? null : v;
const same = (a, b) => J(nz(a)) === J(nz(b));
const byId = l => Object.fromEntries((l || []).map(x => [x.id, x]));
function need(o, n) {
  const r = new Set(), keys = (a, b) => new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys(o, n)) if (k !== 'branches' && k !== '_v' && !same(o[k], n[k])) r.add('info');
  const ob = byId(o.branches), nb = byId(n.branches);
  if (Object.keys(nb).some(i => !ob[i]) || Object.keys(ob).some(i => !nb[i])) r.add('branches');
  for (const id in nb) {
    if (!ob[id]) continue;
    const a = ob[id], b = nb[id];
    for (const k of keys(a, b)) {
      if (same(a[k], b[k])) continue;
      if (k === 'items') {
        const ai = byId(a.items), bi = byId(b.items);
        for (const i in bi) { if (!ai[i]) r.add('add'); else if (J(ai[i]) !== J(bi[i])) r.add('edit'); }
        for (const i in ai) if (!bi[i]) r.add('delete');
      } else if (k === 'cats') {
        const A = a.cats || [], B = b.cats || [];
        if (B.some(c => !A.includes(c))) r.add('add');
        if (A.some(c => !B.includes(c))) r.add('delete');
      } else if (k === 'cimg') r.add('edit');
      else if (k === 'offers') r.add('offers');
      else if (k === 'tables') r.add('tables');
      else r.add('info');
    }
  }
  return r;
}

/* ---- الصور: أي صورة base64 قديمة تتحول إلى ملف مخزَّن (يبقى المنيو خفيفاً) ---- */
const MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime' };
const DURI = /^data:image\/(jpeg|png|webp);base64,/;
async function externalize(node) {
  let n = 0;
  const walk = async o => {
    for (const k of Object.keys(o)) {
      const v = o[k];
      if (typeof v === 'string' && DURI.test(v)) {
        const ext = v.startsWith('data:image/png') ? 'png' : v.startsWith('data:image/webp') ? 'webp' : 'jpg';
        const buf = Buffer.from(v.slice(v.indexOf(',') + 1), 'base64'), name = sha(buf) + '.' + ext;
        await S.putFile(name, MIME[ext], buf); o[k] = '/uploads/' + name; n++;
      } else if (v && typeof v === 'object') await walk(v);
    }
  };
  await walk(node); return n;
}

async function snapshot(label) {
  await S.addBackup(label, { menu: MENU.d, users: USERS });
  await S.pruneBackups(40);
}
async function commitMenu(d) {
  await S.setKV('menu', d); MENU = mkMenu(d); TOP = null;
  if (Date.now() - lastAuto > 6 * 36e5) { lastAuto = Date.now(); snapshot('auto').catch(e => console.error('snapshot', e.message)); }
}

/* ---- تسجيل الدخول والمستخدمون ---- */
const js = express.json({ limit: '20kb' });
app.post('/api/login', js, (req, res) => {
  const email = String((req.body || {}).email || '').trim().toLowerCase(), pw = String((req.body || {}).password || '');
  const key = req.ip + '|' + email;
  if (limited(key)) return res.status(429).json({ error: 'many' });
  let u = null;
  if ((!email || email === OWNER) && seq(pw, PASS)) u = OWNER_USER;
  else { const x = USERS.find(v => v.email === email && v.active !== false); if (x && seq(hash(pw, x.salt), x.hash)) u = pub(x); }
  if (!u) { fails.get(key).push(Date.now()); return res.status(401).json({ error: 'bad' }); }
  res.json({ token: sign({ u: u.id, x: Date.now() + 30 * 864e5 }), user: u });
});
app.get('/api/me', auth(), (req, res) => res.json(req.user));
app.post('/api/me/password', auth(), js, ah(async (req, res) => {
  if (req.user.owner) return res.status(400).json({ error: 'كلمة مرور المالك تُغيَّر من إعدادات Render (ADMIN_PASSWORD)' });
  const b = req.body || {}, o = String(b.old || ''), n = String(b.new || '');
  const L = USERS.map(x => ({ ...x })), u = L.find(x => x.id === req.user.id);
  if (!u || !seq(hash(o, u.salt), u.hash)) return res.status(403).json({ error: 'كلمة المرور الحالية غير صحيحة' });
  if (n.length < 6) return res.status(400).json({ error: 'الرمز الجديد 6 أحرف على الأقل' });
  u.salt = crypto.randomBytes(16).toString('hex'); u.hash = hash(n, u.salt);
  await S.setKV('users', L); USERS = L; res.json({ ok: true });
}));
app.get('/api/users', auth('owner'), (req, res) => res.json(USERS.map(pub)));
app.post('/api/users', auth('owner'), js, ah(async (req, res) => {
  const b = req.body || {}, name = String(b.name || '').trim().slice(0, 60), email = String(b.email || '').trim().toLowerCase().slice(0, 100), pw = String(b.password || '');
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'اكتب الاسم وبريداً صحيحاً' });
  if (email === OWNER) return res.status(409).json({ error: 'هذا البريد محجوز للمالك' });
  const L = USERS.map(x => ({ ...x })); let u = b.id ? L.find(x => x.id === b.id) : null;
  if (L.some(x => x.email === email && x !== u)) return res.status(409).json({ error: 'البريد مستخدم مسبقاً' });
  if (!u) { if (pw.length < 6) return res.status(400).json({ error: 'الرمز 6 أحرف على الأقل' }); u = { id: crypto.randomBytes(6).toString('hex') }; L.push(u); }
  else if (pw && pw.length < 6) return res.status(400).json({ error: 'الرمز 6 أحرف على الأقل' });
  u.name = name; u.email = email; u.active = b.active !== false;
  u.perms = (Array.isArray(b.perms) ? b.perms : []).filter(p => PERMS.includes(p));
  if (pw) { u.salt = crypto.randomBytes(16).toString('hex'); u.hash = hash(pw, u.salt); }
  await S.setKV('users', L); USERS = L; res.json(pub(u));
}));
app.delete('/api/users/:id', auth('owner'), ah(async (req, res) => {
  const L = USERS.filter(x => x.id !== req.params.id); await S.setKV('users', L); USERS = L; res.json({ ok: true });
}));

/* ---- المنيو (مزامنة مباشرة وحفظ دائم) ---- */
app.get('/api/menu', (req, res) => {
  const tag = '"v' + (MENU.d._v | 0) + '"';
  res.set({ 'Cache-Control': 'no-cache', ETag: tag });
  if (req.get('if-none-match') === tag) return res.status(304).end();
  res.type('json').send(MENU.s);
});
app.get('/api/v', (req, res) => res.set('Cache-Control', 'no-store').json({ v: MENU.d._v | 0 }));
app.post('/api/menu', auth(), express.json({ limit: '50mb' }), ah((req, res) => lock(async () => {
  const d = req.body, cur = MENU.d;
  if (!d || !Array.isArray(d.branches) || !d.branches.length) return res.status(400).json({ error: 'bad data' });
  if ((d._v | 0) !== (cur._v | 0)) return res.status(409).json({ error: 'conflict' });
  if (!req.user.owner) {
    const miss = [...need(cur, d)].filter(p => !req.user.perms.includes(p));
    if (miss.length) return res.status(403).json({ error: 'forbidden', need: miss });
  }
  const ext = await externalize(d);
  d._v = (cur._v | 0) + 1;
  await commitMenu(d);
  res.json({ ok: true, v: d._v, ext: ext > 0 });
})));

/* ---- رفع الصور والفيديو (يُخزَّن في قاعدة البيانات ويُقدَّم للجميع) ---- */
const magic = (b, ext) => {
  if (ext === 'jpg') return b[0] === 0xFF && b[1] === 0xD8;
  if (ext === 'png') return b.slice(0, 4).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47]));
  if (ext === 'webp') return b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP';
  if (ext === 'mp4' || ext === 'mov') return b.slice(4, 8).toString() === 'ftyp';
  if (ext === 'webm') return b.slice(0, 4).equals(Buffer.from([0x1A, 0x45, 0xDF, 0xA3]));
  return false;
};
app.post('/api/upload', auth(['info', 'add', 'edit']), express.raw({ type: () => true, limit: '60mb' }), ah(async (req, res) => {
  let ext = String(req.query.ext || 'mp4').replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 5); if (ext === 'jpeg') ext = 'jpg';
  const buf = req.body;
  if (!MIME[ext] || !Buffer.isBuffer(buf) || buf.length < 12 || !magic(buf, ext)) return res.status(400).json({ error: 'type' });
  const name = sha(buf) + '.' + ext;
  await S.putFile(name, MIME[ext], buf);
  res.json({ url: '/uploads/' + name });
}));
app.get('/uploads/:name', ah(async (req, res) => {
  if (!/^[a-f0-9]{8,40}\.(jpg|png|webp|mp4|webm|mov)$/.test(req.params.name)) return res.status(404).end();
  const f = await S.getFile(req.params.name); if (!f) return res.status(404).end();
  const buf = f.data, total = buf.length;
  res.set({ 'Cache-Control': 'public, max-age=31536000, immutable', 'Accept-Ranges': 'bytes', 'Content-Type': f.mime, 'X-Content-Type-Options': 'nosniff' });
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.get('range') || '');
  if (m && (m[1] || m[2])) {
    const a = m[1] === '' ? Math.max(0, total - Number(m[2])) : Number(m[1]);
    const z = m[1] === '' || m[2] === '' ? total - 1 : Math.min(Number(m[2]), total - 1);
    if (a > z || a >= total) return res.status(416).set('Content-Range', 'bytes */' + total).end();
    return res.status(206).set({ 'Content-Range': `bytes ${a}-${z}/${total}`, 'Content-Length': z - a + 1 }).end(buf.subarray(a, z + 1));
  }
  res.send(buf);
}));

/* ---- روابط الطاولات الموقّعة: رقم الطاولة داخل الرابط بتوقيع HMAC لا يمكن تزويره ---- */
const tsig = (b, t) => crypto.createHmac('sha256', process.env.TABLE_SECRET || SECRET_T).update('t|' + b + '|' + t).digest('base64url').slice(0, 12);
const TID = /^[\w-]{1,30}$/;
app.get('/t/:b/:t/:s', (req, res) => {
  const { b, t, s } = req.params;
  const br = TID.test(b) && TID.test(t) && MENU.d.branches.find(x => x.id === b), tb = br && (br.tables || []).find(x => x.id === t);
  if (!tb || !seq(tsig(b, t), s)) return res.redirect('/');
  const data = JSON.stringify({ b, t, n: tb.name, s }).replace(/</g, '\\u003c');
  const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8').replace('<head>', '<head><script>window.__TBL=' + data + '</script>');
  res.set('Cache-Control', 'no-store').type('html').send(html);
});
app.post('/api/qr', auth('tables'), js, (req, res) => {
  const b = String((req.body || {}).b || ''), br = MENU.d.branches.find(x => x.id === b);
  if (!br) return res.status(400).json({ error: 'bad' });
  res.json({ sigs: Object.fromEntries((br.tables || []).map(t => [t.id, tsig(b, t.id)])) });
});

/* ---- الطلبات (تُسجَّل على السيرفر ثم تُرسل بواتساب) والأكثر طلباً ---- */
const nowDay = () => new Date(Date.now() + 3 * 36e5).toISOString().slice(0, 10);
function price(b, i) {
  if (i.o > i.p) return i.p;
  const n = nowDay(); let best = i.p;
  (b.offers || []).filter(o => (!o.from || o.from <= n) && (!o.to || o.to >= n)).forEach(o => {
    const t = o.t || []; if (!(o.scope === 'all' || (o.scope === 'cat' && t.includes(i.c)) || (o.scope === 'item' && t.includes(i.id)))) return;
    const np = o.type === 'fix' ? Math.max(0, i.p - o.val) : Math.round(i.p * (1 - o.val / 100)); if (np < best) best = np;
  });
  return best;
}
const clip = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
app.post('/api/order', express.json({ limit: '50kb' }), ah(async (req, res) => {
  if (orderLimited(req.ip)) return res.status(429).json({ error: 'many' });
  const b = req.body || {}, br = MENU.d.branches.find(x => x.id === b.b);
  if (!br || !Array.isArray(b.items) || !b.items.length || b.items.length > 60) return res.status(400).json({ error: 'bad' });
  const items = [];
  for (const x of b.items) {
    const it = br.items.find(i => i.id === x.id), q = Math.floor(Number(x.q));
    if (!it || it.a === false || !(q >= 1 && q <= 99)) return res.status(400).json({ error: 'bad item' });
    items.push({ id: it.id, n: it.n, q, p: price(br, it) });
  }
  let table = null;
  if (b.tk && b.tk.t) {
    const tb = (br.tables || []).find(t => t.id === b.tk.t);
    if (tb && seq(tsig(br.id, tb.id), String(b.tk.s || ''))) table = { id: tb.id, name: tb.name };
  }
  const o = { id: Date.now().toString(36) + crypto.randomBytes(3).toString('hex'), ts: new Date().toISOString(), b: br.id, bn: br.name, table,
    name: clip(b.name, 60), phone: clip(b.phone, 25), notes: clip(b.notes, 300), items, total: items.reduce((s, i) => s + i.p * i.q, 0) };
  if (!o.name || o.phone.replace(/\D/g, '').length < 7) return res.status(400).json({ error: 'bad contact' });
  await lock(async () => { o.no = CTR++; await S.setKV('ctr', { n: CTR }); await S.addOrder(o); });
  TOP = null;
  res.json({ ok: true, id: o.id, no: o.no });
}));
app.get('/api/orders', auth(), ah(async (req, res) => res.set('Cache-Control', 'no-store').json(await S.listOrders(req.query.b ? String(req.query.b) : null, 200))));
app.delete('/api/orders/:id', auth('delete'), ah(async (req, res) => { await S.delOrder(req.params.id); TOP = null; res.json({ ok: true }); }));
app.get('/api/top', ah(async (req, res) => {
  if (!TOP) {
    const cnt = {}; (await S.recentOrders(3000)).forEach(o => o.items.forEach(i => { const c = cnt[o.b] = cnt[o.b] || {}; c[i.id] = (c[i.id] || 0) + i.q; }));
    TOP = {}; MENU.d.branches.forEach(b => {
      const ok = new Set(b.items.filter(i => i.a !== false).map(i => i.id));
      TOP[b.id] = Object.entries(cnt[b.id] || {}).filter(([id]) => ok.has(id)).sort((x, y) => y[1] - x[1]).slice(0, 8).map(x => x[0]);
    });
  }
  res.set('Cache-Control', 'no-cache').json(TOP);
}));

/* ---- التقييمات ---- */
const rLim = new Map();
const rateLimited = k => { const n = Date.now(), a = (rLim.get(k) || []).filter(t => n - t < 36e5); a.push(n); rLim.set(k, a); return a.length > 5; };
app.post('/api/rate', express.json({ limit: '10kb' }), ah(async (req, res) => {
  if (rateLimited(req.ip)) return res.status(429).json({ error: 'many' });
  const b = req.body || {}, br = MENU.d.branches.find(x => x.id === b.b), st = Math.round(Number(b.s));
  if (!br || !br.rt || !(st >= 1 && st <= 5)) return res.status(400).json({ error: 'bad' });
  RT.unshift({ id: Date.now().toString(36) + crypto.randomBytes(2).toString('hex'), ts: new Date().toISOString(), b: br.id, s: st, c: clip(b.c, 300), n: clip(b.n, 40) });
  RT = RT.slice(0, 2000); await S.setKV('ratings', RT); res.json({ ok: true });
}));
app.get('/api/rating-sum', (req, res) => {
  const o = {}; MENU.d.branches.filter(b => b.rt).forEach(b => { const l = RT.filter(r => r.b === b.id); if (l.length) o[b.id] = { a: Math.round(l.reduce((x, r) => x + r.s, 0) / l.length * 10) / 10, n: l.length }; });
  res.set('Cache-Control', 'no-cache').json(o);
});
app.get('/api/rates', auth(), (req, res) => res.set('Cache-Control', 'no-store').json(RT.filter(r => !req.query.b || r.b === String(req.query.b)).slice(0, 300)));
app.delete('/api/rates/:id', auth('delete'), ah(async (req, res) => { RT = RT.filter(r => r.id !== req.params.id); await S.setKV('ratings', RT); res.json({ ok: true }); }));

/* ---- النسخ الاحتياطي والاستيراد (للمالك) ---- */
app.get('/api/backups', auth('owner'), ah(async (req, res) => res.json(await S.listBackups())));
app.post('/api/backups', auth('owner'), ah(async (req, res) => { await snapshot('manual'); res.json({ ok: true }); }));
async function restoreCore(menu, users) {
  const cur = MENU.d, d = JSON.parse(JSON.stringify(menu)); d._v = (cur._v | 0) + 1;
  await externalize(d); await S.setKV('menu', d); MENU = mkMenu(d); TOP = null;
  if (Array.isArray(users)) { await S.setKV('users', users); USERS = users; }
}
app.post('/api/backups/:id/restore', auth('owner'), ah((req, res) => lock(async () => {
  const b = await S.getBackup(req.params.id); if (!b || !b.menu) return res.status(404).json({ error: 'not found' });
  await snapshot('before-restore'); await restoreCore(b.menu, b.users); res.json({ ok: true });
})));
app.get('/api/backup/ticket', auth('owner'), (req, res) => res.json({ tk: sign({ u: 'owner', x: Date.now() + 120000 }) }));
app.get('/api/backup', (req, res, next) => { if (req.query.tk) req.headers['x-admin-token'] = String(req.query.tk); next(); }, auth('owner'), ah(async (req, res) => {
  const files = await S.allFiles();
  const head = JSON.stringify({ format: 'chef-menu-backup', version: 1, created: new Date().toISOString(), menu: MENU.d, users: USERS, orders: await S.listOrders(null, 5000), ratings: RT, ctr: CTR, secret: SECRET_T });
  res.set({ 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="menu-backup-' + new Date().toISOString().slice(0, 10) + '.json"', 'Cache-Control': 'no-store' });
  try {
    res.write(head.slice(0, -1) + ',"files":[');
    let first = true;
    for (const f of files) { res.write((first ? '' : ',') + JSON.stringify({ name: f.name, mime: f.mime, data: Buffer.from(f.data).toString('base64') })); first = false; }
    res.end(']}');
  } catch (e) { console.error(e); res.destroy(); }
}));
app.post('/api/restore', auth('owner'), express.json({ limit: '250mb' }), ah((req, res) => lock(async () => {
  const b = req.body;
  if (!b || b.format !== 'chef-menu-backup' || !b.menu || !Array.isArray(b.menu.branches) || !b.menu.branches.length) return res.status(400).json({ error: 'ملف نسخة احتياطية غير صالح' });
  await snapshot('before-restore');
  for (const f of Array.isArray(b.files) ? b.files : []) {
    const ext = String(f.name || '').split('.').pop();
    if (!/^[a-f0-9]{8,40}\.(jpg|png|webp|mp4|webm|mov)$/.test(f.name || '') || !MIME[ext]) continue;
    await S.putFile(f.name, MIME[ext], Buffer.from(String(f.data || ''), 'base64'));
  }
  if (Array.isArray(b.orders)) await S.replaceOrders(b.orders);
  if (Array.isArray(b.orders)) { const mx = Math.max(0, ...b.orders.map(o => o.no | 0)); CTR = Math.max(CTR, (b.ctr | 0), mx + 1, 9900); await S.setKV('ctr', { n: CTR }); }
  if (Array.isArray(b.ratings)) { RT = b.ratings.slice(0, 2000); await S.setKV('ratings', RT); }
  if (b.secret && /^[a-f0-9]{16,128}$/.test(b.secret)) { SECRET_T = b.secret; await S.setKV('secret', { v: b.secret }); }
  await restoreCore(b.menu, Array.isArray(b.users) ? b.users : undefined);
  res.json({ ok: true, v: MENU.d._v, items: MENU.d.branches.reduce((n, x) => n + (x.items || []).length, 0), branches: MENU.d.branches.length, files: (b.files || []).length, orders: (b.orders || []).length, users: USERS.length });
})));

app.use(express.static(path.join(__dirname, 'public')));

(async () => {
  S = await open();
  console.log('التخزين:', S.kind === 'postgres' ? 'Postgres (دائم)' : 'ملفات محلية');
  let d = await S.getKV('menu');
  if (!d || !Array.isArray(d.branches)) { d = JSON.parse(fs.readFileSync(path.join(__dirname, 'seed.json'), 'utf8')); d._v = 1; await S.setKV('menu', d); }
  MENU = mkMenu(d);
  if (await externalize(d)) { d._v = (d._v | 0) + 1; await S.setKV('menu', d); MENU = mkMenu(d); }
  USERS = (await S.getKV('users')) || [];
  RT = (await S.getKV('ratings')) || [];
  { const c = await S.getKV('ctr'); CTR = Math.max(9900, c && c.n | 0); }
  const sec = await S.getKV('secret');
  if (sec && sec.v) SECRET_T = sec.v; else { SECRET_T = crypto.randomBytes(24).toString('hex'); await S.setKV('secret', { v: SECRET_T }); }
  app.listen(process.env.PORT || 3000, () => console.log('Menu running on', process.env.PORT || 3000));
})().catch(e => { console.error('فشل التشغيل:', e); process.exit(1); });
