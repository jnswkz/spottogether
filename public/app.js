import { login, handleCallback, getValidToken, logout } from './auth.js';

// KIEN TRUC: web app chi DIEU KHIEN. Nhac phat tren APP SPOTIFY cua moi nguoi
// (dien thoai / may tinh), khong phat trong trinh duyet. Khong dung Web Playback SDK;
// moi lenh phat/dung deu goi Web API /me/player toi THIET BI Spotify da chon.

let CONFIG = { clientId: '', redirectUri: '' };
let socket = null;
let isHost = false;
let playing = false;

// Host doc trang thai bang cach poll /me/player; chi gui khi CO thay doi.
let hostLastUri = null;
let hostLastPlaying = null;
let lastTrackId = null;
let lastProgress = 0;

// Listener chi hanh dong khi bai / play-pause doi (tranh phat lai moi giay).
let lsTrack = null;
let lsPlaying = null;

let currentQueue = [];

const $ = (id) => document.getElementById(id);
const log = (msg) => {
  const el = $('log');
  el.textContent = `${new Date().toLocaleTimeString()}  ${msg}\n` + el.textContent;
};

// ---------- Icon SVG ----------
const ICONS = {
  play: [true, '<polygon points="6 4 20 12 6 20 6 4"/>'],
  pause: [true, '<rect x="6" y="4" width="4.5" height="16" rx="1"/><rect x="13.5" y="4" width="4.5" height="16" rx="1"/>'],
  plus: [false, '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>'],
  trash: [false, '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>'],
  crown: [true, '<path d="M3 7l4 4 5-7 5 7 4-4-2 12H5L3 7z"/>'],
  user: [false, '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'],
};
function icon(name, size = 18) {
  const [fill, inner] = ICONS[name];
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="${fill ? 'currentColor' : 'none'}" stroke="${fill ? 'none' : 'currentColor'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
}
function escapeHtml(s = '') {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]),
  );
}

// ---------- Goi Web API ----------
async function api(path, opts = {}) {
  const token = await getValidToken(CONFIG.clientId);
  return fetch('https://api.spotify.com/v1/' + path, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, ...(opts.headers || {}) },
  });
}

// ---------- Khoi tao ----------
async function init() {
  CONFIG = await fetch('/config').then((r) => r.json());
  if (!CONFIG.clientId) {
    $('status').textContent = 'Chưa cấu hình SPOTIFY_CLIENT_ID — xem README.';
    return;
  }
  if (location.search.includes('code=')) {
    await handleCallback(CONFIG.clientId, CONFIG.redirectUri);
  }
  const token = await getValidToken(CONFIG.clientId);
  if (token) showApp();
  else {
    $('status').textContent = 'Hãy đăng nhập bằng tài khoản Spotify Premium.';
    $('login-btn').style.display = 'inline-flex';
  }
}

$('login-btn').onclick = () => login(CONFIG.clientId, CONFIG.redirectUri);
$('logout-btn').onclick = () => {
  logout();
  location.reload();
};

async function showApp() {
  $('login-btn').style.display = 'none';
  $('logout-btn').style.display = 'inline-flex';
  $('app').style.display = 'block';
  $('device-card').style.display = 'block';

  // Kiem tra loai tai khoan: kieu B BAT BUOC Premium moi dieu khien phat duoc.
  const me = await api('me').then((r) => r.json()).catch(() => ({}));
  const product = me.product || '?';
  if (product === 'premium') {
    log('Tài khoản: Premium ✓');
  } else {
    log('Tài khoản: ' + product + ' — KHÔNG phải Premium, không điều khiển phát được!');
    $('status').textContent =
      'Tài khoản "' + product + '" không phải Premium → chỉ xem được, KHÔNG phát/điều khiển được (đây là giới hạn của Spotify, không phải lỗi app).';
  }

  await fetchDevices();
  setInterval(pollHost, 1000); // chi chay khi la host (guard ben trong)
}

// ---------- Thiet bi Spotify ----------
async function fetchDevices() {
  const res = await api('me/player/devices');
  const data = await res.json().catch(() => ({}));
  const devices = data.devices || [];
  const sel = $('device-select');
  if (!devices.length) {
    sel.innerHTML = '<option value="">— Chưa thấy thiết bị nào —</option>';
    $('status').textContent = 'Mở app Spotify (điện thoại/máy tính), phát thử 1 bài, rồi bấm Làm mới.';
    return;
  }
  const prev = sel.value;
  sel.innerHTML = devices
    .map((d) => `<option value="${d.id}"${d.is_active ? ' selected' : ''}>${escapeHtml(d.name)} · ${escapeHtml(d.type)}</option>`)
    .join('');
  if (prev && devices.some((d) => d.id === prev)) sel.value = prev;
  $('status').textContent = 'Sẵn sàng. Thiết bị phát: ' + (sel.selectedOptions[0]?.textContent || '');
}
function selectedDevice() {
  return $('device-select').value || '';
}
$('device-refresh').onclick = fetchDevices;
$('device-select').onchange = () => {
  $('status').textContent = 'Thiết bị phát: ' + ($('device-select').selectedOptions[0]?.textContent || '');
};

// ---------- Vao phong ----------
$('join-btn').onclick = () => {
  const roomId = $('room-id').value.trim() || 'main';
  const name = $('name').value.trim() || 'Khách';
  if (!socket) {
    socket = io();
    bindSocket();
  }
  socket.emit('join', { roomId, name });
};

function bindSocket() {
  socket.on('joined', ({ roomId, isHost: host, state, queue }) => {
    isHost = host;
    const badge = $('room-badge');
    badge.className = 'badge' + (host ? ' host' : '');
    badge.innerHTML = host
      ? icon('crown', 15) + ` Phòng ${escapeHtml(roomId)} · bạn là Host`
      : icon('user', 15) + ` Phòng ${escapeHtml(roomId)} · người nghe`;
    $('roombar').style.display = 'block';
    $('now-card').style.display = 'flex';
    $('host-controls').style.display = host ? 'flex' : 'none';
    log(host ? 'Bạn là Host — điều khiển cả phòng' : 'Đã vào phòng, chờ host phát nhạc');
    renderQueue(queue || []);
    if (state && !host) applySync(state);
  });

  socket.on('promoted', () => {
    isHost = true;
    $('room-badge').className = 'badge host';
    $('host-controls').style.display = 'flex';
    renderQueue(currentQueue);
    log('Host cũ đã rời — bạn được nâng làm Host');
  });

  socket.on('room', renderMembers);
  socket.on('queue', renderQueue);
  socket.on('sync', (state) => {
    if (!isHost) applySync(state);
  });
  socket.on('play-track', (track) => playTrack(track.uri, 0, true));
}

// ---------- Host: doc trang thai app Spotify ----------
async function pollHost() {
  if (!isHost) return;
  let res;
  try {
    res = await api('me/player');
  } catch {
    return;
  }
  if (res.status === 204) {
    // Khong co gi phat: neu vua phat xong 1 bai -> chuyen bai tiep theo.
    if (lastTrackId && lastProgress > 1000) {
      lastTrackId = null;
      lastProgress = 0;
      if (currentQueue.length) {
        log('Bài kết thúc — chuyển bài tiếp theo');
        socket.emit('queue-next');
      }
    }
    return;
  }
  const d = await res.json().catch(() => null);
  if (!d || !d.item) {
    // Thiet bi active nhung chua co bai nao thuc su phat.
    if (d && d.device) {
      const dbg = `Thiết bị "${d.device.name}" active nhưng chưa phát bài (loại: ${d.currently_playing_type || '?'}).`;
      if (dbg !== window.__lastDbg) {
        window.__lastDbg = dbg;
        log(dbg);
      }
    }
    return;
  }
  const cur = d.item;
  updateNowPlaying({
    name: cur.name,
    artists: cur.artists.map((a) => a.name).join(', '),
    image: cur.album.images?.[0]?.url,
    isPlaying: d.is_playing,
  });
  lastTrackId = cur.id;
  lastProgress = d.progress_ms;

  // Chi broadcast khi doi bai hoac doi play/pause (tranh spam).
  if (cur.uri !== hostLastUri || d.is_playing !== hostLastPlaying) {
    hostLastUri = cur.uri;
    hostLastPlaying = d.is_playing;
    socket.emit('state', {
      trackUri: cur.uri,
      positionMs: d.progress_ms,
      isPlaying: d.is_playing,
      name: cur.name,
      artists: cur.artists.map((a) => a.name).join(', '),
      image: cur.album.images?.[0]?.url,
    });
  }
}

// ---------- Now playing ----------
function updateNowPlaying({ name, artists, image, isPlaying }) {
  playing = !!isPlaying;
  $('np-title').textContent = name || '—';
  $('np-artist').textContent = artists || '';
  if (image) $('np-art').src = image;
  $('toggle-btn').innerHTML = icon(isPlaying ? 'pause' : 'play', 20);
}

// ---------- Tim kiem ----------
async function doSearch() {
  const q = $('search-input').value.trim();
  if (!q) return;
  const res = await api(`search?type=track&limit=8&q=${encodeURIComponent(q)}`);
  const data = await res.json();
  renderResults(data.tracks?.items || []);
}
$('search-btn').onclick = doSearch;
$('search-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') doSearch();
});

function toTrack(t) {
  return {
    uri: t.uri,
    name: t.name,
    artists: t.artists.map((a) => a.name).join(', '),
    image: t.album.images?.[2]?.url || t.album.images?.[0]?.url || '',
  };
}
function trackRow(tr, actions) {
  return `<li class="track">
    <img src="${escapeHtml(tr.image)}" alt="" />
    <div class="t-meta">
      <span class="t-name">${escapeHtml(tr.name)}</span>
      <span class="t-sub">${escapeHtml(tr.artists)}${tr.addedBy ? ' · ' + escapeHtml(tr.addedBy) : ''}</span>
    </div>
    <div class="t-actions">${actions}</div>
  </li>`;
}
function renderResults(items) {
  const tracks = items.map(toTrack);
  window.__results = tracks;
  $('results').innerHTML = tracks
    .map((tr, i) => {
      const add = `<button class="mini" data-add="${i}">${icon('plus', 14)} Thêm</button>`;
      const playNow = isHost ? `<button class="mini green" data-play="${i}">${icon('play', 14)} Phát</button>` : '';
      return trackRow(tr, playNow + add);
    })
    .join('');
}
$('results').addEventListener('click', (e) => {
  const addBtn = e.target.closest('[data-add]');
  const playBtn = e.target.closest('[data-play]');
  if (addBtn) {
    const tr = window.__results[+addBtn.dataset.add];
    socket.emit('queue-add', tr);
    log('Đã thêm vào hàng đợi: ' + tr.name);
  } else if (playBtn && isHost) {
    const tr = window.__results[+playBtn.dataset.play];
    playTrack(tr.uri, 0, true);
  }
});

// ---------- Hang doi ----------
function renderQueue(queue) {
  currentQueue = queue || [];
  $('queue-count').textContent = currentQueue.length;
  $('queue-empty').style.display = currentQueue.length ? 'none' : 'block';
  $('queue').innerHTML = currentQueue
    .map((tr, i) => {
      const del = isHost ? `<button class="mini" data-del="${i}" title="Xóa">${icon('trash', 14)}</button>` : '';
      return `<li class="track">
        <span class="pos">${i + 1}</span>
        <img src="${escapeHtml(tr.image)}" alt="" />
        <div class="t-meta">
          <span class="t-name">${escapeHtml(tr.name)}</span>
          <span class="t-sub">${escapeHtml(tr.artists)}${tr.addedBy ? ' · ' + escapeHtml(tr.addedBy) : ''}</span>
        </div>
        <div class="t-actions">${del}</div>
      </li>`;
    })
    .join('');
}
$('queue').addEventListener('click', (e) => {
  const del = e.target.closest('[data-del]');
  if (del && isHost) socket.emit('queue-remove', +del.dataset.del);
});
$('next-btn').onclick = () => isHost && socket.emit('queue-next');

// Host play/pause tren app Spotify qua Web API.
$('toggle-btn').onclick = async () => {
  if (!isHost) return;
  const dev = selectedDevice();
  if (!dev) return log('Chưa chọn thiết bị Spotify');
  await api(`me/player/${playing ? 'pause' : 'play'}?device_id=${dev}`, { method: 'PUT' });
};

// ---------- Thanh vien ----------
function renderMembers(room) {
  $('members').innerHTML = room.members
    .map((m) => {
      const host = m.id === room.hostId;
      const ico = host ? `<span class="host-ico">${icon('crown', 15)}</span>` : icon('user', 15);
      return `<li>${ico} ${escapeHtml(m.name)}</li>`;
    })
    .join('');
}

// ---------- Phat tren thiet bi da chon ----------
async function playTrack(uri, positionMs, play) {
  const dev = selectedDevice();
  if (!dev) {
    $('status').textContent = 'Hãy chọn thiết bị Spotify để phát (mở app Spotify rồi Làm mới).';
    return log('Chưa chọn thiết bị Spotify');
  }

  log(`Phát "${uri.split(':').pop()}" → thiết bị ${dev.slice(0, 8)}…`);
  // Phat bai tren thiet bi da chon (thiet bi can dang active: mo app Spotify
  // va phat tay 1 bai truoc). device_id trong URL se tu chuyen phat ve dung may.
  const r = await api(`me/player/play?device_id=${dev}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uris: [uri], position_ms: Math.max(0, positionMs) }),
  });
  if (r.status >= 400) {
    const j = await r.json().catch(() => ({}));
    const reason = j.error?.reason || j.error?.message || r.status;
    log('Lỗi phát (' + r.status + '): ' + reason);
    $('status').textContent = 'Không phát được: ' + reason;
  } else {
    log('Đã gửi lệnh phát (' + r.status + ') tới thiết bị');
  }

  if (!play) await api(`me/player/pause?device_id=${dev}`, { method: 'PUT' });
}

// ---------- Listener: khop theo host (chi khi doi bai / play-pause) ----------
async function applySync(state) {
  updateNowPlaying(state);
  const changedTrack = state.trackUri !== lsTrack;
  const changedPlay = state.isPlaying !== lsPlaying;
  lsTrack = state.trackUri;
  lsPlaying = state.isPlaying;

  if (changedTrack) {
    const elapsed = state.isPlaying ? Date.now() - state.serverTs : 0;
    log('Đồng bộ bài mới @ ' + ((state.positionMs + elapsed) / 1000).toFixed(1) + 's');
    await playTrack(state.trackUri, state.positionMs + elapsed, state.isPlaying);
  } else if (changedPlay) {
    const dev = selectedDevice();
    if (!dev) return;
    await api(`me/player/${state.isPlaying ? 'play' : 'pause'}?device_id=${dev}`, { method: 'PUT' });
  }
  // Cung bai + cung trang thai -> khong lam gi (de nhac chay tiep).
}

init();
