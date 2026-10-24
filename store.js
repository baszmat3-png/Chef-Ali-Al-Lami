/* طبقة التخزين: Postgres (دائم) عند وجود DATABASE_URL، وإلا ملفات محلية.
   كل شيء يُحفظ هنا: المنيو، المستخدمون، الصور والفيديو، الطلبات، النسخ الاحتياطية. */
const fs = require('fs'), path = require('path');

/* ---------------------------------- Postgres ---------------------------------- */
async function pgStore(url) {
  const { Pool } = require('pg');
  const local = /(@|\/\/)(localhost|127\.0\.0\.1)(:|\/)/.test(url) || /sslmode=disable/.test(url);
  const mk = ssl => {
    const p = new Pool({ connectionString: url, ssl, max: 4, idleTimeoutMillis: 30000 });
    p.on('error', e => console.error('pg pool:', e.message));
    return p;
  };
  const SCHEMA = [
    'create table if not exists kv (id text primary key, data jsonb not null)',
    'create table if not exists files (name text primary key, mime text not null, data bytea not null, ts timestamptz not null default now())',
    'create table if not exists orders (id text primary key, ts timestamptz not null default now(), branch text, data jsonb not null)',
    'create table if not exists backups (id serial primary key, ts timestamptz not null default now(), label text, data jsonb not null)',
    'create index if not exists orders_ts on orders (ts desc)'
  ];
  let pool = mk(local ? false : { rejectUnauthorized: false });
  try { for (const s of SCHEMA) await pool.query(s); }
  catch (e) {
    if (!local && /SSL/i.test(e.message)) {            // الخادم لا يدعم SSL (اتصال داخلي)
      try { await pool.end(); } catch {}
      pool = mk(false); for (const s of SCHEMA) await pool.query(s);
    } else throw e;
  }
  const q = (t, p) => pool.query(t, p);
  return {
    kind: 'postgres',
    async getKV(id) { const r = await q('select data from kv where id=$1', [id]); return r.rows[0] ? r.rows[0].data : null; },
    async setKV(id, v) { await q('insert into kv(id,data) values($1,$2) on conflict (id) do update set data=excluded.data', [id, JSON.stringify(v)]); },
    async putFile(name, mime, buf) { await q('insert into files(name,mime,data) values($1,$2,$3) on conflict (name) do nothing', [name, mime, buf]); },
    async getFile(name) { const r = await q('select mime,data from files where name=$1', [name]); return r.rows[0] || null; },
    async allFiles() { const r = await q('select name,mime,data from files order by ts'); return r.rows; },
    async addOrder(o) { await q('insert into orders(id,ts,branch,data) values($1,$2,$3,$4)', [o.id, o.ts, o.b, JSON.stringify(o)]); },
    async listOrders(b, n) { const r = await q('select data from orders where ($1::text is null or branch=$1) order by ts desc limit $2', [b || null, n]); return r.rows.map(x => x.data); },
    async recentOrders(n) { const r = await q('select data from orders order by ts desc limit $1', [n]); return r.rows.map(x => x.data); },
    async delOrder(id) { await q('delete from orders where id=$1', [id]); },
    async replaceOrders(list) { await q('delete from orders'); for (const o of list) await this.addOrder(o); },
    async addBackup(label, data) { const r = await q('insert into backups(label,data) values($1,$2) returning id', [label, JSON.stringify(data)]); return r.rows[0].id; },
    async listBackups() { const r = await q('select id,ts,label from backups order by id desc'); return r.rows.map(x => ({ id: x.id, ts: new Date(x.ts).toISOString(), label: x.label })); },
    async getBackup(id) { const r = await q('select data from backups where id=$1', [id]); return r.rows[0] ? r.rows[0].data : null; },
    async pruneBackups(keep) { await q('delete from backups where id not in (select id from backups order by id desc limit $1)', [keep]); }
  };
}

/* ------------------------------------ ملفات ------------------------------------ */
function fileStore(DIR0) {
  let DIR = DIR0;
  const ok = d => { try { fs.mkdirSync(path.join(d, 'uploads'), { recursive: true }); fs.accessSync(d, fs.constants.W_OK); return true; } catch { return false; } };
  if (!ok(DIR)) {
    console.warn('⚠️  لا يمكن الكتابة في ' + DIR + ' — سيُستخدم مجلد مؤقت، والتعديلات تضيع عند إعادة التشغيل. اضبط DATABASE_URL للحفظ الدائم.');
    DIR = path.join(__dirname, 'data'); fs.mkdirSync(path.join(DIR, 'uploads'), { recursive: true });
  }
  const BK = path.join(DIR, 'backups'); fs.mkdirSync(BK, { recursive: true });
  const rd = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
  const wr = (f, d) => { const t = f + '.tmp'; fs.writeFileSync(t, JSON.stringify(d)); fs.renameSync(t, f); };
  const EXT = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime' };
  const OF = path.join(DIR, 'orders.json');
  let orders = rd(OF) || [];
  return {
    kind: 'files',
    async getKV(id) { return rd(path.join(DIR, 'kv-' + id + '.json')); },
    async setKV(id, v) { wr(path.join(DIR, 'kv-' + id + '.json'), v); },
    async putFile(name, mime, buf) { const f = path.join(DIR, 'uploads', name); if (!fs.existsSync(f)) fs.writeFileSync(f, buf); },
    async getFile(name) { const f = path.join(DIR, 'uploads', name); if (!fs.existsSync(f)) return null; return { mime: EXT[name.split('.').pop()] || 'application/octet-stream', data: fs.readFileSync(f) }; },
    async allFiles() { return fs.readdirSync(path.join(DIR, 'uploads')).map(n => ({ name: n, mime: EXT[n.split('.').pop()] || 'application/octet-stream', data: fs.readFileSync(path.join(DIR, 'uploads', n)) })); },
    async addOrder(o) { orders.unshift(o); orders = orders.slice(0, 5000); wr(OF, orders); },
    async listOrders(b, n) { return orders.filter(o => !b || o.b === b).slice(0, n); },
    async recentOrders(n) { return orders.slice(0, n); },
    async delOrder(id) { orders = orders.filter(o => o.id !== id); wr(OF, orders); },
    async replaceOrders(list) { orders = list.slice(0, 5000); wr(OF, orders); },
    async addBackup(label, data) {
      const ids = fs.readdirSync(BK).map(n => parseInt(n)).filter(Number.isFinite), id = (ids.length ? Math.max(...ids) : 0) + 1;
      wr(path.join(BK, id + '.json'), { id, ts: new Date().toISOString(), label, data }); return id;
    },
    async listBackups() { return fs.readdirSync(BK).map(n => parseInt(n)).filter(Number.isFinite).sort((a, b) => b - a).map(id => { const x = rd(path.join(BK, id + '.json')); return { id, ts: x.ts, label: x.label }; }); },
    async getBackup(id) { const x = rd(path.join(BK, parseInt(id) + '.json')); return x ? x.data : null; },
    async pruneBackups(keep) { fs.readdirSync(BK).map(n => parseInt(n)).filter(Number.isFinite).sort((a, b) => b - a).slice(keep).forEach(id => fs.unlinkSync(path.join(BK, id + '.json'))); }
  };
}

module.exports = async function open() {
  if (process.env.DATABASE_URL) return pgStore(process.env.DATABASE_URL);
  return fileStore(process.env.DATA_DIR || path.join(__dirname, 'data'));
};
