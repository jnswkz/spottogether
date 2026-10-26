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

// Cau hinh cong khai cho frontend (client_id trong PKCE la PUBLIC).
app.get('/config', (_req, res) => {
  res.json({ clientId: CLIENT_ID, redirectUri: REDIRECT_URI });
});

// Endpoint sieu nhe cho keep-alive ping (giu Render free khoi ngu).
app.get('/healthz', (_req, res) => res.type('text').send('ok'));

// Spotify redirect ve /callback?code=... ; tra ve trang chu de frontend xu ly.
app.get('/callback', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use(express.static(path.join(__dirname, 'public')));

// --- Trang thai phong luu trong bo nho (du cho MVP) ---
// roomId -> { hostId, state, queue, members: Map<socketId, {name}> }
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
      rooms.set(roomId, { hostId: socket.id, state: null, queue: [], members: new Map() });
    }
    const room = rooms.get(roomId);
    room.members.set(socket.id, { name: name || 'Khach' });

    if (!room.hostId || !room.members.has(room.hostId)) {
      room.hostId = socket.id;
    }

    socket.emit('joined', {
      roomId,
      isHost: room.hostId === socket.id,
      state: room.state,
      queue: room.queue,
    });
    io.to(roomId).emit('room', roomSummary(room));
  });

  // Host day trang thai phat -> broadcast cho moi nguoi con lai.
  socket.on('state', (state) => {
    if (!joinedRoom) return;
    const room = rooms.get(joinedRoom);
    if (!room || room.hostId !== socket.id) return; // chi host duoc ra lenh
    room.state = { ...state, serverTs: Date.now() };
    socket.to(joinedRoom).emit('sync', room.state);
  });

  socket.on('request-sync', () => {
    if (!joinedRoom) return;
    const room = rooms.get(joinedRoom);
    if (room?.state) socket.emit('sync', room.state);
  });

  // --- Hang doi chung ---
  // Ai cung them bai duoc.
  socket.on('queue-add', (track) => {
    const room = rooms.get(joinedRoom);
    if (!room || !track?.uri) return;
    const who = room.members.get(socket.id)?.name || 'Khach';
    room.queue.push({ ...track, addedBy: who });
    io.to(joinedRoom).emit('queue', room.queue);
  });

  // Chi host duoc xoa khoi hang doi.
  socket.on('queue-remove', (index) => {
    const room = rooms.get(joinedRoom);
    if (!room || room.hostId !== socket.id) return;
    room.queue.splice(index, 1);
    io.to(joinedRoom).emit('queue', room.queue);
  });

  // Chi host duoc chuyen bai: lay bai dau hang doi, bao host phat.
  socket.on('queue-next', () => {
    const room = rooms.get(joinedRoom);
    if (!room || room.hostId !== socket.id) return;
    const track = room.queue.shift();
    io.to(joinedRoom).emit('queue', room.queue);
    if (track) socket.emit('play-track', track);
  });

  socket.on('disconnect', () => {
    if (!joinedRoom) return;
    const room = rooms.get(joinedRoom);
    if (!room) return;
    room.members.delete(socket.id);

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
