#!/usr/bin/env node
/**
 * SoundCloud Likes Extractor
 * Usage: node soundcloud_likes.js <username>
 * Example: node soundcloud_likes.js yangzog
 *
 * No npm install needed — uses only Node.js built-ins.
 * Opens a browser viewer at http://localhost:3000 with all your likes.
 */

const http = require('http');
const https = require('https');
const { execSync } = require('child_process');

const username = process.argv[2];
if (!username) {
  console.error('Usage: node soundcloud_likes.js <username>');
  process.exit(1);
}

// ─── HTTP helper (no dependencies) ───────────────────────────────────────────
function get(url) {
  return new Promise((resolve, reject) => {
    const follow = (u, hops = 0) => {
      if (hops > 5) return reject(new Error('Too many redirects'));
      const mod = u.startsWith('https') ? https : http;
      mod.get(u, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/json,*/*',
        }
      }, res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const loc = res.headers.location.startsWith('http')
            ? res.headers.location
            : new URL(res.headers.location, u).href;
          res.resume();
          return follow(loc, hops + 1);
        }
        if (res.statusCode >= 400) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} for ${u}`));
        }
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        res.on('error', reject);
      }).on('error', reject);
    };
    follow(url);
  });
}

// ─── Auto-detect client_id ────────────────────────────────────────────────────
async function detectClientId() {
  console.log(`[1/3] Fetching SoundCloud page for client_id…`);
  const html = await get(`https://soundcloud.com/${username}`);
  const scripts = [...html.matchAll(/src="(https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js)"/g)].map(m => m[1]);
  if (!scripts.length) throw new Error('No asset scripts found on SoundCloud page.');

  for (const src of scripts.slice(-8)) {
    try {
      const js = await get(src);
      const m = js.match(/[,{(]client_id:"([a-zA-Z0-9]{20,42})"/);
      if (m) { console.log(`    ✓ client_id found`); return m[1]; }
    } catch { /* try next */ }
  }
  throw new Error('Could not detect client_id from SoundCloud scripts.');
}

// ─── Resolve user ─────────────────────────────────────────────────────────────
async function resolveUser(clientId) {
  console.log(`[2/3] Resolving user @${username}…`);
  const json = await get(`https://api-v2.soundcloud.com/resolve?url=https://soundcloud.com/${encodeURIComponent(username)}&client_id=${clientId}`);
  const user = JSON.parse(json);
  if (!user.id) throw new Error('User not found.');
  console.log(`    ✓ Found: ${user.full_name || user.username} (${user.followers_count || 0} followers)`);
  return user;
}

// ─── Fetch all likes ──────────────────────────────────────────────────────────
async function fetchLikes(userId, clientId) {
  console.log(`[3/3] Fetching likes… (this may take a while for large collections)`);
  const tracks = [];
  let next = `https://api-v2.soundcloud.com/users/${userId}/likes?limit=200&client_id=${clientId}`;
  let page = 0;

  while (next) {
    const json = await get(next);
    const data = JSON.parse(json);
    const items = (data.collection || []).filter(i => i.track);
    items.forEach(item => {
      const t = item.track;
      tracks.push({
        id: t.id,
        title: t.title || 'Untitled',
        artist: (t.publisher_metadata && t.publisher_metadata.artist) || (t.user && t.user.username) || 'Unknown',
        artwork: t.artwork_url ? t.artwork_url.replace('-large', '-t300x300') : null,
        url: t.permalink_url,
        duration: t.duration || 0,
        likedAt: item.created_at || '',
        bpm: t.bpm || null,
        key: t.key_signature || null,
        genre: t.genre || null
      });
    });

    page++;
    process.stdout.write(`\r    ${tracks.length} tracks loaded…`);

    if (data.next_href) {
      const sep = data.next_href.includes('?') ? '&' : '?';
      next = data.next_href + sep + `client_id=${clientId}`;
      await new Promise(r => setTimeout(r, 100)); // gentle rate-limit
    } else {
      next = null;
    }
  }

  console.log(`\n    ✓ Done! ${tracks.length} total likes.`);
  return tracks;
}

// ─── Build viewer HTML ────────────────────────────────────────────────────────
function buildHTML(tracks, displayName) {
  const dataJson = JSON.stringify(tracks);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${displayName} — SoundCloud Likes (${tracks.length})</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0f0f0f;color:#e0e0e0;min-height:100vh}
  header{background:#181818;border-bottom:1px solid #2a2a2a;padding:16px 24px;position:sticky;top:0;z-index:100}
  header h1{font-size:18px;font-weight:700;color:#ff5500;margin-bottom:12px}
  .topbar{display:flex;gap:12px;align-items:center;flex-wrap:wrap}
  .count{font-size:13px;color:#666}
  .count span{color:#ff5500;font-weight:700}
  input[type=text]{background:#252525;border:1px solid #333;border-radius:7px;color:#e0e0e0;padding:8px 13px;font-size:13px;outline:none;flex:1;max-width:280px}
  input[type=text]:focus{border-color:#ff5500}
  .btn{background:#252525;border:1px solid #333;border-radius:7px;color:#ccc;padding:8px 14px;font-size:12px;font-weight:600;cursor:pointer;transition:all .2s;white-space:nowrap;text-decoration:none;display:inline-block}
  .btn:hover{background:#333;color:#fff}
  .btn.red{background:#ff5500;border-color:#ff5500;color:#fff}
  .btn.red:hover{background:#e64d00}
  #container{padding:16px 24px;max-width:1400px;margin:0 auto}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px}
  .card{background:#1a1a1a;border:1px solid #252525;border-radius:11px;overflow:hidden;transition:border-color .2s,transform .15s;cursor:pointer}
  .card:hover{border-color:#ff5500;transform:translateY(-2px)}
  .art{width:100%;aspect-ratio:1;object-fit:cover;background:#222;display:block}
  .art-ph{width:100%;aspect-ratio:1;background:linear-gradient(135deg,#252525,#181818);display:flex;align-items:center;justify-content:center;font-size:42px}
  .info{padding:11px 13px}
  .ttl{font-size:13px;font-weight:600;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:3px}
  .art2{font-size:12px;color:#777;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:6px}
  .meta{display:flex;gap:5px;flex-wrap:wrap;margin-bottom:8px}
  .tag{background:#1e1e1e;border:1px solid #2e2e2e;border-radius:4px;padding:2px 7px;font-size:11px;color:#999;white-space:nowrap}
  .tag.bpm{color:#ff9955;border-color:#3a2010}
  .tag.key{color:#55aaff;border-color:#102030}
  .actions{display:flex;gap:6px}
  .play{background:#ff5500;border:none;border-radius:6px;color:#fff;padding:5px 12px;font-size:12px;font-weight:700;cursor:pointer;flex:1;transition:background .2s}
  .play:hover{background:#e64d00}
  .sm{background:#222;border:1px solid #303030;border-radius:6px;color:#aaa;padding:5px 8px;font-size:11px;cursor:pointer;transition:all .2s;text-decoration:none;white-space:nowrap}
  .sm:hover{background:#333;color:#fff}
  .sm.o{color:#ff5500;border-color:#3a1a00}
  .sm.o:hover{background:#ff5500;color:#fff}
  .copied{color:#4caf50!important}
  /* modal */
  .overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.88);z-index:200;align-items:center;justify-content:center;padding:16px}
  .overlay.on{display:flex}
  .mbox{background:#1a1a1a;border-radius:14px;padding:20px;max-width:560px;width:100%;border:1px solid #2e2e2e}
  .mhead{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;gap:10px}
  .mtitle{font-size:15px;font-weight:700;color:#fff}
  .martist{font-size:12px;color:#777;margin-top:2px}
  .xbtn{background:#2a2a2a;border:none;border-radius:50%;color:#aaa;width:28px;height:28px;font-size:15px;cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center}
  .xbtn:hover{background:#444;color:#fff}
  .mplayer{border-radius:7px;overflow:hidden;margin-bottom:11px}
  .mplayer iframe{width:100%;display:block;border:none}
  .mlinks{display:flex;gap:8px}
  .mlinks a{flex:1;text-align:center;padding:9px;border-radius:7px;font-size:13px;font-weight:600;text-decoration:none;transition:all .2s}
  .msc{background:#ff5500;color:#fff}
  .msc:hover{background:#e64d00}
  .mdl{background:#1a1a1a;color:#ff5500;border:1px solid #ff5500}
  .mdl:hover{background:#ff5500;color:#fff}
  #sentinel{height:60px;display:flex;align-items:center;justify-content:center;color:#444;font-size:13px}
  .spin{display:inline-block;width:16px;height:16px;border:2px solid #333;border-top-color:#ff5500;border-radius:50%;animation:sp .7s linear infinite;vertical-align:middle;margin-right:5px}
  @keyframes sp{to{transform:rotate(360deg)}}
</style>
</head>
<body>
<header>
  <h1>🎵 ${displayName} — SoundCloud Likes</h1>
  <div class="topbar">
    <span class="count">Showing <span id="showCount">${tracks.length}</span> of <span>${tracks.length}</span> likes</span>
    <input type="text" id="q" placeholder="🔍 Search title or artist…" oninput="filter()">
    <button class="btn" onclick="exportCSV()">Export CSV</button>
    <button class="btn" onclick="exportLinks()">Export Links</button>
  </div>
</header>
<div id="container">
  <div class="grid" id="grid"></div>
  <div id="sentinel"></div>
</div>

<div class="overlay" id="ov" onclick="if(event.target===this)closeModal()">
  <div class="mbox">
    <div class="mhead">
      <div><div class="mtitle" id="mt"></div><div class="martist" id="ma"></div></div>
      <button class="xbtn" onclick="closeModal()">✕</button>
    </div>
    <div class="mplayer" id="mp"></div>
    <div class="mlinks" id="ml"></div>
  </div>
</div>

<script>
const ALL = ${dataJson};
let shown = [...ALL], disp = 0;
const N = 40;
let busy = false, obs;

function init() {
  obs = new IntersectionObserver(e => { if(e[0].isIntersecting && !busy) more(); }, {rootMargin:'500px'});
  obs.observe(document.getElementById('sentinel'));
  more();
}

function more() {
  if(busy) return;
  const chunk = shown.slice(disp, disp+N);
  if(!chunk.length){ document.getElementById('sentinel').innerHTML = disp?'— All tracks loaded —':''; return; }
  busy = true;
  document.getElementById('sentinel').innerHTML = '<span class="spin"></span>';
  const g = document.getElementById('grid');
  chunk.forEach(t => g.appendChild(card(t)));
  disp += chunk.length;
  document.getElementById('sentinel').innerHTML = disp < shown.length ? '' : '<span>— All tracks loaded —</span>';
  busy = false;
}

function card(t) {
  const d = document.createElement('div');
  d.className = 'card';
  const td = JSON.stringify(t).replace(/"/g,'&quot;');
  const art = t.artwork
    ? \`<img class="art" src="\${t.artwork}" loading="lazy" alt="" onclick='play(\${td})'>\`
    : \`<div class="art-ph" onclick='play(\${td})'>🎵</div>\`;
  const dur = t.duration ? ' · '+fmt(t.duration) : '';
  const metaTags = [
    t.bpm  ? \`<span class="tag bpm">♩ \${Math.round(t.bpm)} BPM</span>\` : '',
    t.key  ? \`<span class="tag key">🎵 \${e(t.key)}</span>\` : '',
    t.genre? \`<span class="tag">\${e(t.genre)}</span>\` : ''
  ].filter(Boolean).join('');
  d.innerHTML = art+\`<div class="info">
    <div class="ttl" title="\${e(t.title)}">\${e(t.title)}</div>
    <div class="art2">\${e(t.artist)}\${dur}</div>
    \${metaTags ? \`<div class="meta">\${metaTags}</div>\` : ''}
    <div class="actions">
      <button class="play" onclick='play(\${td})'>▶ Play</button>
      <button class="sm" onclick="cp('\${e(t.url)}',this)">Copy</button>
      <a class="sm o" href="\${e(t.url)}" target="_blank">Open ↗</a>
    </div>
  </div>\`;
  return d;
}

function play(t) {
  if(typeof t==='string') t=JSON.parse(t);
  document.getElementById('mt').textContent = t.title;
  document.getElementById('ma').textContent = t.artist;
  document.getElementById('mp').innerHTML = \`<iframe src="https://w.soundcloud.com/player/?url=\${encodeURIComponent(t.url)}&color=%23ff5500&auto_play=true&show_artwork=true&show_user=true&buying=false&sharing=false&download=false" height="166"></iframe>\`;
  document.getElementById('ml').innerHTML = \`<a class="msc" href="\${e(t.url)}" target="_blank">Open on SoundCloud</a><a class="mdl" href="https://soundcloudmp3.org/?url=\${encodeURIComponent(t.url)}" target="_blank">Download ↓</a>\`;
  document.getElementById('ov').classList.add('on');
}

function closeModal() { document.getElementById('ov').classList.remove('on'); document.getElementById('mp').innerHTML=''; }

function filter() {
  const q = document.getElementById('q').value.toLowerCase();
  shown = q ? ALL.filter(t=>t.title.toLowerCase().includes(q)||t.artist.toLowerCase().includes(q)) : [...ALL];
  document.getElementById('showCount').textContent = shown.length;
  document.getElementById('grid').innerHTML=''; disp=0;
  document.getElementById('sentinel').textContent='';
  more();
}

function cp(url, btn) {
  navigator.clipboard.writeText(url).then(()=>{ const o=btn.textContent; btn.textContent='✓'; btn.classList.add('copied'); setTimeout(()=>{btn.textContent=o;btn.classList.remove('copied')},1500); });
}

function fmt(ms) { const s=Math.floor(ms/1000),m=Math.floor(s/60),h=Math.floor(m/60); return h?\`\${h}:\${String(m%60).padStart(2,'0')}:\${String(s%60).padStart(2,'0')}\`:\`\${m}:\${String(s%60).padStart(2,'0')}\`; }
function e(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function exportCSV() {
  const rows=[['Title','Artist','BPM','Key','Genre','URL','Duration','Liked At']];
  ALL.forEach(t=>rows.push([\`"\${t.title.replace(/"/g,'""')}"\`,\`"\${t.artist.replace(/"/g,'""')}"\`,t.bpm||'',t.key||'',t.genre||'',t.url,fmt(t.duration),t.likedAt]));
  dl('soundcloud_likes.csv',rows.map(r=>r.join(',')).join('\\n'),'text/csv');
}
function exportLinks(){ dl('soundcloud_likes_links.txt',ALL.map(t=>\`\${t.title} — \${t.artist}\\n\${t.url}\`).join('\\n\\n'),'text/plain'); }
function dl(n,c,t){ const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([c],{type:t})); a.download=n; a.click(); }

init();
</script>
</body>
</html>`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  try {
    const clientId = await detectClientId();
    const user = await resolveUser(clientId);
    const tracks = await fetchLikes(user.id, clientId);

    const html = buildHTML(tracks, user.full_name || user.username || username);

    // Serve on localhost (avoids file:// CORS issues entirely)
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    });

    server.listen(3000, '127.0.0.1', () => {
      const url = 'http://localhost:3000';
      console.log(`\n✅ Ready! Opening browser at ${url}`);
      console.log('   Press Ctrl+C to stop the server.\n');

      // Open browser cross-platform
      const cmd = process.platform === 'darwin' ? `open "${url}"`
                : process.platform === 'win32'  ? `start "${url}"`
                : `xdg-open "${url}"`;
      try { execSync(cmd); } catch { console.log(`   (Open ${url} manually if browser didn't launch)`); }
    });

  } catch (e) {
    console.error('\n❌ Error:', e.message);
    process.exit(1);
  }
})();
