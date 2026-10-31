// خدمة بسيطة: تعتمد الشبكة دائماً (حتى تصل التعديلات فوراً) وتعرض صفحة بديلة عند انقطاع الإنترنت
const OFF = '<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;background:#0b0b0e;color:#fff;font:18px system-ui;text-align:center;padding:24px"><div style="font-size:54px">📶</div><b>لا يوجد اتصال بالإنترنت</b><span style="opacity:.7">تحقق من الاتصال ثم أعد المحاولة</span><button onclick="location.reload()" style="border:0;border-radius:12px;padding:12px 32px;font-size:17px;background:#e8c468">إعادة المحاولة</button></body></html>';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  if (e.request.mode !== 'navigate') return;
  e.respondWith(fetch(e.request).catch(() => new Response(OFF, { headers: { 'content-type': 'text/html; charset=utf-8' } })));
});
