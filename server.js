/* ===========================================================================
   NEON FORTUNE — реальный бэкенд (Node.js, без внешних зависимостей)
   Считает РЕАЛЬНО подключённых игроков и транслирует:
     • живой счётчик онлайна (SSE)
     • список реальных игроков (имя + ставка)
     • ленту реальных выигрышей
   Работает как веб-сервис и сразу отдаёт статику (index.html и т.д.).
   =========================================================================== */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const IDLE_MS = 20000;   // сессия считается активной, пока «пульс» приходит чаще этого

const ADJ = ['Lucky','Neo','Vegas','Golden','Dark','Rapid','Crazy','Silent','Iron','Crimson',
  'Turbo','Mystic','Royal','Pixel','Shadow','Ruby','Cosmo','Storm'];
const ANIM = ['Fox','Wolf','Dragon','Tiger','Eagle','Shark','Panther','Viper','Lynx','Bear',
  'Hawk','Cobra','Raven','Lion','Falcon','Jaguar','Owl','Bison'];

function genName(){
  const a = ADJ[Math.floor(Math.random()*ADJ.length)];
  const b = ANIM[Math.floor(Math.random()*ANIM.length)];
  const n = 100 + Math.floor(Math.random()*899);
  return a + b + n;
}

// сессии реальных игроков: id -> {id, name, bet, last}
const sessions = new Map();
// открытые SSE-соединения: id -> res
const clients = new Map();

function broadcast(payload){
  const data = 'data: ' + JSON.stringify(payload) + '\n\n';
  for(const res of clients.values()){
    try { res.write(data); } catch(e){ /* соединение умерло — игнор */ }
  }
}

function snapshot(){
  const now = Date.now();
  for(const [id, s] of sessions){
    if(now - s.last > IDLE_MS){ sessions.delete(id); clients.delete(id); }
  }
  const players = [...sessions.values()].map(s => ({ name:s.name, bet:s.bet }));
  return { online: sessions.size, players };
}

function pushState(){ broadcast({ type:'state', ...snapshot() }); }

const MIME = {
  '.html':'text/html; charset=utf-8',
  '.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8',
  '.json':'application/json; charset=utf-8',
  '.jpg':'image/jpeg', '.jpeg':'image/jpeg',
  '.png':'image/png', '.svg':'image/svg+xml',
  '.ico':'image/x-icon', '.txt':'text/plain; charset=utf-8'
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');

  /* ---------- SSE: поток реального состояния ---------- */
  if(url.pathname === '/stream'){
    res.writeHead(200, {
      'Content-Type':'text/event-stream; charset=utf-8',
      'Cache-Control':'no-cache, no-transform',
      'Connection':'keep-alive',
      'X-Accel-Buffering':'no'   // отключаем буферизацию прокси (важно для SSE)
    });
    const id = crypto.randomBytes(6).toString('hex');
    const name = genName();
    const sess = { id, name, bet:10, last:Date.now() };
    sessions.set(id, sess);
    clients.set(id, res);

    // приветствие со списком реальных игроков
    res.write('data: ' + JSON.stringify({ type:'hello', id, ...snapshot() }) + '\n\n');

    // keep-alive, чтобы прокси не оборвал висячее соединение
    const ka = setInterval(()=>{ try { res.write(': ping\n\n'); } catch(e){} }, 15000);

    req.on('close', () => {
      clearInterval(ka);
      sessions.delete(id);
      clients.delete(id);
      pushState();
    });
    return;
  }

  /* ---------- Пульс от клиента (ставка / выигрыш) ---------- */
  if(url.pathname === '/beat' && req.method === 'POST'){
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      let d = {};
      try { d = JSON.parse(body || '{}'); } catch(e){}
      const s = d.id && sessions.get(d.id);
      if(s){
        s.last = Date.now();
        if(typeof d.bet === 'number') s.bet = d.bet;
        if(d.win && d.win > 0){
          broadcast({ type:'feed', name:s.name, text:'выиграл ' + d.win + ' 🪙' });
        }
        pushState();
      }
      res.writeHead(204); res.end();
    });
    return;
  }

  /* ---------- Отдача статики ---------- */
  let p = url.pathname === '/' ? '/index.html' : url.pathname;
  const safe = path.normalize(p).replace(/^(\.\.[\/\\])+/, '');
  const filePath = path.join(ROOT, safe);
  if(!filePath.startsWith(ROOT)){ res.writeHead(403); res.end('Forbidden'); return; }
  fs.readFile(filePath, (err, data) => {
    if(err){ res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

// периодическая чистка + рассылка актуального состояния
setInterval(pushState, 5000);

server.listen(PORT, () => console.log('NEON FORTUNE server listening on port ' + PORT));
