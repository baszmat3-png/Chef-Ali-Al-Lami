const express = require('express'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const app = express();
const DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const FILE = path.join(DIR, 'menu.json'), UP = path.join(DIR, 'uploads');
fs.mkdirSync(UP, { recursive: true });
if (!fs.existsSync(FILE)) fs.copyFileSync(path.join(__dirname, 'seed.json'), FILE);
const PASS = process.env.ADMIN_PASSWORD || 'admin123';
if (!process.env.ADMIN_PASSWORD) console.warn('⚠️  ADMIN_PASSWORD غير مضبوط — كلمة المرور الحالية admin123، غيّرها فوراً.');

const ok = req => {
  const a = Buffer.from(String(req.get('x-admin-token') || '')), b = Buffer.from(PASS);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
const auth = (req, res, next) => ok(req) ? next() : res.status(401).json({ error: 'unauthorized' });

app.get('/api/menu', (req, res) => {
  res.set('Cache-Control', 'no-store').type('json').send(fs.readFileSync(FILE));
});
app.post('/api/login', auth, (req, res) => res.json({ ok: true }));
app.post('/api/menu', auth, express.json({ limit: '50mb' }), (req, res) => {
  const d = req.body;
  if (!d || !Array.isArray(d.branches)) return res.status(400).json({ error: 'bad data' });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(d));
  fs.renameSync(tmp, FILE);
  res.json({ ok: true });
});
app.post('/api/upload', auth, express.raw({ type: () => true, limit: '60mb' }), (req, res) => {
  const ext = String(req.query.ext || 'mp4').replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 5);
  if (!['mp4', 'webm', 'mov', 'jpg', 'jpeg', 'png', 'webp'].includes(ext)) return res.status(400).json({ error: 'type' });
  const name = crypto.randomBytes(8).toString('hex') + '.' + ext;
  fs.writeFileSync(path.join(UP, name), req.body);
  res.json({ url: '/uploads/' + name });
});
app.use('/uploads', express.static(UP, { maxAge: '30d' }));
app.use(express.static(path.join(__dirname, 'public')));
app.listen(process.env.PORT || 3000, () => console.log('Menu running on', process.env.PORT || 3000));
