const express = require('express'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const app = express();
let DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const writable = d => { try { fs.mkdirSync(path.join(d, 'uploads'), { recursive: true }); fs.accessSync(d, fs.constants.W_OK); return true; } catch { return false; } };
if (!writable(DIR)) {
  console.warn('⚠️  لا يمكن الكتابة في ' + DIR + ' (لا يوجد Disk مربوط). سيتم استخدام مجلد مؤقت — التعديلات تضيع عند إعادة التشغيل.');
  DIR = path.join(__dirname, 'data'); fs.mkdirSync(path.join(DIR, 'uploads'), { recursive: true });
}
const FILE = path.join(DIR, 'menu.json'), UP = path.join(DIR, 'uploads'), UF = path.join(DIR, 'users.json');
if (!fs.existsSync(FILE)) fs.copyFileSync(path.join(__dirname, 'seed.json'), FILE);
const PASS = process.env.ADMIN_PASSWORD || 'admin123';
const OWNER = String(process.env.ADMIN_EMAIL || 'admin').trim().toLowerCase();
if (!process.env.ADMIN_PASSWORD) console.warn('⚠️  ADMIN_PASSWORD غير مضبوط — كلمة المرور الحالية admin123، غيّرها فوراً.');

const PERMS = ['info', 'add', 'edit', 'delete', 'offers', 'tables', 'branches'];
const seq = (a, b) => { a = Buffer.from(String(a)); b = Buffer.from(String(b)); return a.length === b.length && crypto.timingSafeEqual(a, b); };
const rd = f => { try { return JSON.parse(fs.readFileSync(f)); } catch { return null; } };
const wr = (f, d) => { const t = f + '.tmp'; fs.writeFileSync(t, JSON.stringify(d)); fs.renameSync(t, f); };
const users = () => rd(UF) || [];
const hash = (pw, salt) => crypto.scryptSync(pw, salt, 32).toString('hex');
const pub = u => ({ id: u.id, name: u.name, email: u.email, perms: u.perms, owner: !!u.owner, active: u.active !== false });
const OWNER_USER = { id: 'owner', name: 'المالك', email: OWNER, perms: PERMS, owner: true, active: true };

const SECRET = crypto.createHash('sha256').update('tok|' + PASS).digest();
const sign = p => { const b = Buffer.from(JSON.stringify(p)).toString('base64url'); return b + '.' + crypto.createHmac('sha256', SECRET).update(b).digest('base64url'); };
function verify(t) {
  const [b, s] = String(t || '').split('.'); if (!b || !s) return null;
  if (!seq(s, crypto.createHmac('sha256', SECRET).update(b).digest('base64url'))) return null;
  try { const p = JSON.parse(Buffer.from(b, 'base64url')); return p.x > Date.now() ? p : null; } catch { return null; }
}
function who(req) {
  const t = req.get('x-admin-token') || '';
  if (t && seq(t, PASS)) return OWNER_USER;            // توافق مع النسخة القديمة
  const p = verify(t); if (!p) return null;
  if (p.u === 'owner') return OWNER_USER;
  const u = users().find(x => x.id === p.u);
  return u && u.active !== false ? pub(u) : null;
}
const auth = need => (req, res, next) => {
  const u = who(req); if (!u) return res.status(401).json({ error: 'unauthorized' });
  if (need === 'owner' ? !u.owner : (need && !u.owner && !u.perms.includes(need))) return res.status(403).json({ error: 'forbidden' });
  req.user = u; next();
};
const fails = new Map();
const limited = k => { const n = Date.now(), a = (fails.get(k) || []).filter(t => n - t < 9e5); fails.set(k, a); return a.length >= 10; };

/* ---- ما الصلاحيات المطلوبة لتغيير من بيانات إلى أخرى ---- */
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

const js = express.json({ limit: '20kb' });
app.post('/api/login', js, (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase(), pw = String(req.body.password || '');
  const key = req.ip + '|' + email;
  if (limited(key)) return res.status(429).json({ error: 'many' });
  let u = null;
  if ((!email || email === OWNER) && seq(pw, PASS)) u = OWNER_USER;
  else { const x = users().find(v => v.email === email && v.active !== false); if (x && seq(hash(pw, x.salt), x.hash)) u = pub(x); }
  if (!u) { fails.get(key).push(Date.now()); return res.status(401).json({ error: 'bad' }); }
  res.json({ token: sign({ u: u.id, x: Date.now() + 7 * 864e5 }), user: u });
});
app.get('/api/me', auth(), (req, res) => res.json(req.user));
app.get('/api/users', auth('owner'), (req, res) => res.json(users().map(pub)));
app.post('/api/users', auth('owner'), js, (req, res) => {
  const b = req.body || {}, name = String(b.name || '').trim().slice(0, 60), email = String(b.email || '').trim().toLowerCase().slice(0, 100), pw = String(b.password || '');
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'اكتب الاسم وبريداً صحيحاً' });
  if (email === OWNER) return res.status(409).json({ error: 'هذا البريد محجوز للمالك' });
  const L = users(); let u = b.id ? L.find(x => x.id === b.id) : null;
  if (L.some(x => x.email === email && x !== u)) return res.status(409).json({ error: 'البريد مستخدم مسبقاً' });
  if (!u) { if (pw.length < 6) return res.status(400).json({ error: 'الرمز 6 أحرف على الأقل' }); u = { id: crypto.randomBytes(6).toString('hex') }; L.push(u); }
  else if (pw && pw.length < 6) return res.status(400).json({ error: 'الرمز 6 أحرف على الأقل' });
  u.name = name; u.email = email; u.active = b.active !== false;
  u.perms = (Array.isArray(b.perms) ? b.perms : []).filter(p => PERMS.includes(p));
  if (pw) { u.salt = crypto.randomBytes(16).toString('hex'); u.hash = hash(pw, u.salt); }
  wr(UF, L); res.json(pub(u));
});
app.delete('/api/users/:id', auth('owner'), (req, res) => { wr(UF, users().filter(x => x.id !== req.params.id)); res.json({ ok: true }); });

app.get('/api/menu', (req, res) => { res.set('Cache-Control', 'no-store').type('json').send(fs.readFileSync(FILE)); });
app.post('/api/menu', auth(), express.json({ limit: '50mb' }), (req, res) => {
  const d = req.body, cur = rd(FILE) || { branches: [] };
  if (!d || !Array.isArray(d.branches)) return res.status(400).json({ error: 'bad data' });
  if ((d._v | 0) !== (cur._v | 0)) return res.status(409).json({ error: 'conflict' });
  if (!req.user.owner) {
    const miss = [...need(cur, d)].filter(p => !req.user.perms.includes(p));
    if (miss.length) return res.status(403).json({ error: 'forbidden', need: miss });
  }
  d._v = (cur._v | 0) + 1;
  wr(FILE, d);
  res.json({ ok: true, v: d._v });
});
app.post('/api/upload', auth('info'), express.raw({ type: () => true, limit: '60mb' }), (req, res) => {
  const ext = String(req.query.ext || 'mp4').replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 5);
  if (!['mp4', 'webm', 'mov', 'jpg', 'jpeg', 'png', 'webp'].includes(ext)) return res.status(400).json({ error: 'type' });
  const name = crypto.randomBytes(8).toString('hex') + '.' + ext;
  fs.writeFileSync(path.join(UP, name), req.body);
  res.json({ url: '/uploads/' + name });
});
app.use('/uploads', express.static(UP, { maxAge: '30d' }));
app.use(express.static(path.join(__dirname, 'public')));
app.listen(process.env.PORT || 3000, () => console.log('Menu running on', process.env.PORT || 3000));
