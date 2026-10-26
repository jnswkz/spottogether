import { login, handleCallback, getValidToken, logout } from './auth.js';

let CONFIG = { clientId: '', redirectUri: '' };
let socket = null;
let player = null;
let deviceId = null;
let isHost = false;
let lastPushed = 0;

const $ = (id) => document.getElementById(id);
const log = (msg) => {
  const el = $('log');
  el.textContent = `${new Date().toLocaleTimeString()}  ${msg}\n` + el.textContent;
};

async function init() {
  CONFIG = await fetch('/config').then((r) => r.json());
  if (!CONFIG.clientId) {
    $('status').textContent =
      'Chưa cấu hình SPOTIFY_CLIENT_ID trong file .env — xem README.';
    return;
  }

  // Neu vua quay ve tu Spotify (co ?code) thi doi lay token truoc.
  if (location.search.includes('code=')) {
    await handleCallback(CONFIG.clientId, CONFIG.redirectUri);
  }

  const token = await getValidToken(CONFIG.clientId);
  if (token) {
    showApp();
  } else {
    $('status').textContent = 'Hãy đăng nhập bằng tài khoản Spotify Premium.';
    $('login-btn').style.display = 'inline-block';
  }
}

$('login-btn').onclick = () => login(CONFIG.clientId, CONFIG.redirectUri);
$('logout-btn').onclick = () => {
  logout();
  location.reload();
};

function showApp() {
  $('login-btn').style.display = 'none';
  $('app').style.display = 'block';
  $('status').textContent = 'Đang khởi tạo trình phát…';
  loadSDK();
}

function loadSDK() {
  window.onSpotifyWebPlaybackSDKReady = () => {
    player = new Spotify.Player({
      name: 'SpotTogether',
      getOAuthToken: async (cb) => cb(await getValidToken(CONFIG.clientId)),
      volume: 0.8,
    });

    player.addListener('ready', ({ device_id }) => {
      deviceId = device_id;
      log('Trình phát sẵn sàng');
      $('status').textContent = 'Đã kết nối trình phát ✓  Hãy vào một phòng.';
    });
    player.addListener('not_ready', () => log('Trình phát offline'));
    player.addListener('initialization_error', ({ message }) => log('Lỗi init: ' + message));
    player.addListener('authentication_error', ({ message }) =>
      log('Lỗi xác thực: ' + message),
    );
    player.addListener('account_error', () =>
      log('Tài khoản KHÔNG phải Premium — kiểu B bắt buộc Premium.'),
    );

    // HOST: khi trang thai phat thay doi -> day len server de dong bo.
    player.addListener('player_state_changed', (state) => {
      if (!state || !isHost) return;
      const now = Date.now();
      if (now - lastPushed < 300) return; // chong spam
      lastPushed = now;
      socket.emit('state', {
        trackUri: state.track_window.current_track.uri,
        positionMs: state.position,
        isPlaying: !state.paused,
      });
    });

    player.connect();
  };

  const s = document.createElement('script');
  s.src = 'https://sdk.scdn.co/spotify-player.js';
  document.body.appendChild(s);
}

// ---------- Phong + dong bo ----------
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
  socket.on('joined', ({ roomId, isHost: host, state }) => {
    isHost = host;
    $('room-title').textContent = `Phòng: ${roomId} — ${host ? 'bạn là HOST 👑' : 'người nghe'}`;
    $('host-controls').style.display = host ? 'block' : 'none';
    log(host ? 'Bạn là Host — điều khiển cho cả phòng' : 'Đã vào phòng, chờ host phát nhạc');
    if (state) applySync(state);
    else socket.emit('request-sync');
  });

  socket.on('promoted', () => {
    isHost = true;
    $('host-controls').style.display = 'block';
    log('Host cũ đã rời — bạn được nâng làm Host');
  });

  socket.on('room', renderMembers);
  socket.on('sync', (state) => {
    if (!isHost) applySync(state);
  });
}

function renderMembers(room) {
  $('members').innerHTML = room.members
    .map((m) => `<li>${escapeHtml(m.name)}${m.id === room.hostId ? ' 👑' : ''}</li>`)
    .join('');
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]),
  );
}

// ---------- Dieu khien phat (Host) ----------
$('play-btn').onclick = async () => {
  let uri = $('track-uri').value.trim();
  const m = uri.match(/track[/:]([a-zA-Z0-9]+)/); // chap nhan ca URL lan URI
  if (m) uri = 'spotify:track:' + m[1];
  if (!uri.startsWith('spotify:track:')) return log('Link/URI bài hát không hợp lệ');
  await transferAndPlay(uri, 0, true);
};

$('toggle-btn').onclick = async () => {
  if (player) await player.togglePlay();
};

// Chuyen phat ve trinh duyet nay (device cua SDK) roi phat bai tai vi tri cho truoc.
async function transferAndPlay(trackUri, positionMs, play) {
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

// NGUOI NGHE: nhan trang thai tu host va khop theo.
// Buoc tinh do tre: cong them thoi gian tu luc server nhan trang thai.
async function applySync(state) {
  const elapsed = state.isPlaying ? Date.now() - state.serverTs : 0;
  const target = state.positionMs + elapsed;
  log(`Đồng bộ: ${state.isPlaying ? '▶ phát' : '⏸ dừng'} @ ${(target / 1000).toFixed(1)}s`);
  await transferAndPlay(state.trackUri, target, state.isPlaying);
}

init();
