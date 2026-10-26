import 'dotenv/config';
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || '';
const REDIRECT_URI =
  process.env.SPOTIFY_REDIRECT_URI || `http://127.0.0.1:${PORT}/callback`;

// Cau hinh cong khai cho frontend.
// Trong luong PKCE, client_id la thong tin PUBLIC nen tra ve day la an toan
// (khong co client_secret o bat ky dau trong du an nay).
app.get('/config', (_req, res) => {
  res.json({ clientId: CLIENT_ID, redirectUri: REDIRECT_URI });
});

// Endpoint sieu nhe cho keep-alive ping (giu Render free khoi ngu).
app.get('/healthz', (_req, res) => res.type('text').send('ok'));

// Spotify redirect ve /callback?code=... ; ta chi can tra ve trang chu,
// frontend se tu doc ?code tren URL de doi lay token.
app.get('/callback', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use(express.static(path.join(__dirname, 'public')));

// --- Trang thai phong luu trong bo nho (du cho MVP) ---
// roomId -> { hostId, state, members: Map<socketId, {name}> }
const rooms = new Map();

function roomSummary(room) {
  return {
    hostId: room.hostId,
    members: [...room.members.entries()].map(([id, m]) => ({ id, name: m.name })),
  };
}

io.on('connection', (socket) => {
  let joinedRoom = null;

  socket.on('join', ({ roomId, name }) => {
    roomId = (roomId || 'main').trim();
    joinedRoom = roomId;
    socket.join(roomId);

    if (!rooms.has(roomId)) {
      rooms.set(roomId, { hostId: socket.id, state: null, members: new Map() });
    }
    const room = rooms.get(roomId);
    room.members.set(socket.id, { name: name || 'Khach' });

    // Nguoi vao dau tien (hoac khi host cu da roi) tro thanh host.
    if (!room.hostId || !room.members.has(room.hostId)) {
      room.hostId = socket.id;
    }

    socket.emit('joined', {
      roomId,
      isHost: room.hostId === socket.id,
      state: room.state,
    });
    io.to(roomId).emit('room', roomSummary(room));
  });

  // Host day trang thai phat -> broadcast cho moi nguoi con lai trong phong.
  socket.on('state', (state) => {
    if (!joinedRoom) return;
    const room = rooms.get(joinedRoom);
    if (!room || room.hostId !== socket.id) return; // chi host duoc ra lenh
    room.state = { ...state, serverTs: Date.now() };
    socket.to(joinedRoom).emit('sync', room.state);
  });

  // Client vua vao xin trang thai hien tai de bat kip.
  socket.on('request-sync', () => {
    if (!joinedRoom) return;
    const room = rooms.get(joinedRoom);
    if (room?.state) socket.emit('sync', room.state);
  });

  socket.on('disconnect', () => {
    if (!joinedRoom) return;
    const room = rooms.get(joinedRoom);
    if (!room) return;
    room.members.delete(socket.id);

    // Host roi -> chon host moi tu nguoi con lai.
    if (room.hostId === socket.id) {
      const next = room.members.keys().next();
      room.hostId = next.done ? null : next.value;
      if (room.hostId) io.to(room.hostId).emit('promoted');
    }

    if (room.members.size === 0) rooms.delete(joinedRoom);
    else io.to(joinedRoom).emit('room', roomSummary(room));
  });
});

server.listen(PORT, () => {
  console.log(`\n  SpotTogether dang chay: ${REDIRECT_URI.replace('/callback', '')}\n`);
});
