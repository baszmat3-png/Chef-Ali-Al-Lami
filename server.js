const express = require('express'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const app = express();
const DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
function useSB0() { return !!(process.env.SUPABASE_URL && process.env.SUPABASE_KEY); }
const FILE = path.join(DIR, 'menu.json'), UP = path.join(DIR, 'uploads');
fs.mkdirSync(UP, { recursive: true });
if (!useSB0() && !fs.existsSync(FILE)) fs.copyFileSync(path.join(__dirname, 'seed.json'), FILE);

// ---- تخزين دائم اختياري عبر Supabase (مجاني). بدون المتغيرات يستخدم الملفات المحلية ----
const SB = (process.env.SUPABASE_URL || '').replace(/\/+$/, ''), SK = process.env.SUPABASE_KEY || '', BUCKET = 'uploads';
const sbH = (x = {}) => ({ apikey: SK, Authorization: 'Bearer ' + SK, ...x });
const useSB = !!(SB && SK);
async function loadMenu() {
  if (useSB) {
    const r = await fetch(`${SB}/rest/v1/kv?id=eq.menu&select=data`, { headers: sbH() });
    if (!r.ok) throw new Error('supabase read ' + r.status + ' ' + await r.text());
    const rows = await r.json();
    if (rows.length) return JSON.stringify(rows[0].data);
    const seed = fs.readFileSync(path.join(__dirname, 'seed.json'), 'utf8');
    await saveMenu(JSON.parse(seed));
    return seed;
  }
  return fs.readFileSync(FILE, 'utf8');
}
async function saveMenu(d) {
  if (useSB) {
    const r = await fetch(`${SB}/rest/v1/kv?on_conflict=id`, {
      method: 'POST',
      headers: sbH({ 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' }),
      body: JSON.stringify({ id: 'menu', data: d })
    });
    if (!r.ok) throw new Error('supabase write ' + r.status + ' ' + await r.text());
    return;
  }
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(d));
  fs.renameSync(tmp, FILE);
}
const MIME = { mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
async function saveFile(name, ext, buf) {
  if (useSB) {
    const r = await fetch(`${SB}/storage/v1/object/${BUCKET}/${name}`, {
      method: 'POST', headers: sbH({ 'Content-Type': MIME[ext] || 'application/octet-stream' }), body: buf
    });
    if (!r.ok) throw new Error('supabase upload ' + r.status + ' ' + await r.text());
    return `${SB}/storage/v1/object/public/${BUCKET}/${name}`;
  }
  fs.writeFileSync(path.join(UP, name), buf);
  return '/uploads/' + name;
}

const PASS = process.env.ADMIN_PASSWORD || 'admin123';
if (!process.env.ADMIN_PASSWORD) console.warn('⚠️  ADMIN_PASSWORD غير مضبوط — كلمة المرور الحالية admin123، غيّرها فوراً.');

const ok = req => {
  const a = Buffer.from(String(req.get('x-admin-token') || '')), b = Buffer.from(PASS);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
const auth = (req, res, next) => ok(req) ? next() : res.status(401).json({ error: 'unauthorized' });

app.get('/api/menu', async (req, res) => {
  try { res.set('Cache-Control', 'no-store').type('json').send(await loadMenu()); }
  catch (e) { console.error(e); res.status(500).json({ error: 'storage' }); }
});
app.post('/api/login', auth, (req, res) => res.json({ ok: true }));
app.post('/api/menu', auth, express.json({ limit: '50mb' }), async (req, res) => {
  const d = req.body;
  if (!d || !Array.isArray(d.branches)) return res.status(400).json({ error: 'bad data' });
  try { await saveMenu(d); res.json({ ok: true }); }
  catch (e) { console.error(e); res.status(500).json({ error: 'storage' }); }
});
app.post('/api/upload', auth, express.raw({ type: () => true, limit: '60mb' }), async (req, res) => {
  const ext = String(req.query.ext || 'mp4').replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 5);
  if (!['mp4', 'webm', 'mov', 'jpg', 'jpeg', 'png', 'webp'].includes(ext)) return res.status(400).json({ error: 'type' });
  const name = crypto.randomBytes(8).toString('hex') + '.' + ext;
  try { res.json({ url: await saveFile(name, ext, req.body) }); }
  catch (e) { console.error(e); res.status(500).json({ error: 'storage' }); }
});
app.use('/uploads', express.static(UP, { maxAge: '30d' }));
app.use(express.static(path.join(__dirname, 'public')));
app.listen(process.env.PORT || 3000, () => console.log('Menu running on', process.env.PORT || 3000));
