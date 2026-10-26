import { login, handleCallback, getValidToken, logout } from './auth.js';

let CONFIG = { clientId: '', redirectUri: '' };
let socket = null;
let player = null;
let deviceId = null;
let isHost = false;
let lastPushed = 0;

// Theo doi de phat hien bai nhac ket thuc (chi host) -> tu chuyen bai.
let lastTrackId = null;
let lastPos = 0;

const $ = (id) => document.getElementById(id);
const log = (msg) => {
  const el = $('log');
  el.textContent = `${new Date().toLocaleTimeString()}  ${msg}\n` + el.textContent;
};

// ---------- Icon SVG ----------
// [isFill, innerSVG]
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
  if (token) {
    showApp();
  } else {
    $('status').textContent = 'Hãy đăng nhập bằng tài khoản Spotify Premium.';
    $('login-btn').style.display = 'inline-flex';
  }
}

$('login-btn').onclick = () => login(CONFIG.clientId, CONFIG.redirectUri);
$('logout-btn').onclick = () => {
  logout();
  location.reload();
};

function showApp() {
  $('login-btn').style.display = 'none';
  $('logout-btn').style.display = 'inline-flex';
  $('app').style.display = 'block';
  $('status').textContent = 'Đang khởi tạo trình phát…';
  loadSDK();
}

// ---------- Web Playback SDK ----------
function loadSDK() {
  window.onSpotifyWebPlaybackSDKReady = () => {
    player = new Spotify.Player({
      name: 'SpotTogether',
      getOAuthToken: async (cb) => cb(await getValidToken(CONFIG.clientId)),
      volume: 0.8,
    });

    player.addListener('ready', ({ device_id }) => {
      deviceId = device_id;
      $('status').textContent = 'Đã kết nối trình phát ✓  Hãy vào một phòng.';
      log('Trình phát sẵn sàng');
    });
    player.addListener('authentication_error', ({ message }) => log('Lỗi xác thực: ' + message));
    player.addListener('account_error', () => log('Tài khoản KHÔNG phải Premium.'));

    player.addListener('player_state_changed', (state) => {
      if (!state) return;
      updateNowPlaying({
        name: state.track_window.current_track.name,
        artists: state.track_window.current_track.artists.map((a) => a.name).join(', '),
        image: state.track_window.current_track.album.images?.[0]?.url,
        isPlaying: !state.paused,
      });
      if (!isHost) return;

      // Phat hien ket thuc bai: bai dang phat (lastPos>0) nay paused o vi tri 0.
      const cur = state.track_window.current_track;
      if (state.paused && state.position === 0 && lastTrackId === cur.id && lastPos > 1000) {
        log('Bài kết thúc — chuyển bài tiếp theo');
        socket.emit('queue-next');
      }
      lastTrackId = cur.id;
      lastPos = state.position;

      // Day trang thai cho ca phong (kem metadata de hien now-playing).
      const now = Date.now();
      if (now - lastPushed < 250) return;
      lastPushed = now;
      socket.emit('state', {
        trackUri: cur.uri,
        positionMs: state.position,
        isPlaying: !state.paused,
        name: cur.name,
        artists: cur.artists.map((a) => a.name).join(', '),
        image: cur.album.images?.[0]?.url,
      });
    });

    player.connect();
  };

  const s = document.createElement('script');
  s.src = 'https://sdk.scdn.co/spotify-player.js';
  document.body.appendChild(s);
}

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
    $('joinbar') && $('join-btn') && ($('join-btn').textContent = 'Đổi phòng');
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
    if (state) applySync(state);
    else socket.emit('request-sync');
  });

  socket.on('promoted', () => {
    isHost = true;
    $('room-badge').className = 'badge host';
    $('host-controls').style.display = 'flex';
    renderQueue(currentQueue); // ve lai nut xoa
    log('Host cũ đã rời — bạn được nâng làm Host');
  });

  socket.on('room', renderMembers);
  socket.on('queue', renderQueue);
  socket.on('sync', (state) => {
    if (!isHost) applySync(state);
  });
  // Host nhan lenh phat bai tiep theo tu hang doi.
  socket.on('play-track', (track) => playTrack(track.uri, 0, true));
}

// ---------- Now playing ----------
function updateNowPlaying({ name, artists, image, isPlaying }) {
  $('np-title').textContent = name || '—';
  $('np-artist').textContent = artists || '';
  if (image) $('np-art').src = image;
  $('toggle-btn').innerHTML = icon(isPlaying ? 'pause' : 'play', 20);
}

// ---------- Tim kiem ----------
async function doSearch() {
  const q = $('search-input').value.trim();
  if (!q) return;
  const token = await getValidToken(CONFIG.clientId);
  const res = await fetch(
    `https://api.spotify.com/v1/search?type=track&limit=8&q=${encodeURIComponent(q)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
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

function trackRow(tr, inner) {
  return `<li class="track">
    <img src="${escapeHtml(tr.image)}" alt="" />
    <div class="t-meta">
      <span class="t-name">${escapeHtml(tr.name)}</span>
      <span class="t-sub">${escapeHtml(tr.artists)}${tr.addedBy ? ' · ' + escapeHtml(tr.addedBy) : ''}</span>
    </div>
    <div class="t-actions">${inner}</div>
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
let currentQueue = [];
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
$('toggle-btn').onclick = () => player && player.togglePlay();

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

// ---------- Phat & dong bo ----------
async function playTrack(trackUri, positionMs, play) {
  if (!deviceId) return log('Trình phát chưa sẵn sàng');
  const token = await getValidToken(CONFIG.clientId);
  await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ uris: [trackUri], position_ms: Math.max(0, positionMs) }),
  });
  if (!play) {
    await fetch('https://api.spotify.com/v1/me/player/pause', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` },
    });
  }
}

// Nguoi nghe: khop theo trang thai host (bu do tre mang).
async function applySync(state) {
  updateNowPlaying(state);
  const elapsed = state.isPlaying ? Date.now() - state.serverTs : 0;
  const target = state.positionMs + elapsed;
  log(`Đồng bộ: ${state.isPlaying ? 'phát' : 'dừng'} @ ${(target / 1000).toFixed(1)}s`);
  await playTrack(state.trackUri, target, state.isPlaying);
}

init();
