/**
 * 미로 속 경찰과 도둑 - 게임 서버
 * Express + Socket.io
 */

import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import {
  createRoom,
  getRoom,
  getAllRooms,
  joinRoom,
  leaveRoom,
  updateRoomSettings,
  startGame,
  finishPrepAndStartGame,
  setMoveDirection,
  updatePositions,
  backToLobby,
  resetRoomToLobby,
  serializeGame,
} from './rooms.js';

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: true },
});

const PORT = process.env.PORT || 3001;
const MOVE_TICK_MS = 50;

function startPositionBroadcast(roomId) {
  const room = getRoom(roomId);
  if (!room?.game || room.game.moveIntervalId) return;
  const id = setInterval(() => {
    const r = getRoom(roomId);
    if (!r?.game || (r.status !== 'preparing' && r.status !== 'playing')) {
      clearInterval(id);
      if (r?.game) r.game.moveIntervalId = null;
      return;
    }
    updatePositions(roomId);
    const current = getRoom(roomId);
    if (current?.game) {
      io.to(roomId).emit('game:positions', current.game.positions);
      if (current.game.caughtThieves?.length) {
        io.to(roomId).emit('game:caught', { caughtThieves: current.game.caughtThieves });
      }
      if (current.status === 'ended' && current.game.winner) {
        io.to(roomId).emit('game:ended', { winner: current.game.winner });
        io.to(roomId).emit('room:updated', serializeRoom(current));
        clearInterval(id);
        current.game.moveIntervalId = null;
        const AUTO_LOBBY_MS = 5000;
        setTimeout(() => {
          const rr = getRoom(roomId);
          if (rr?.status === 'ended') {
            resetRoomToLobby(roomId);
            const updated = getRoom(roomId);
            if (updated) io.to(roomId).emit('room:updated', serializeRoom(updated));
          }
        }, AUTO_LOBBY_MS);
      }
    }
  }, MOVE_TICK_MS);
  room.game.moveIntervalId = id;
}

// REST: 방 목록 (첫 화면에서 사용)
app.get('/api/rooms', (req, res) => {
  const list = getAllRooms().map((room) => ({
    roomId: room.id,
    roomName: room.name || '이름 없는 방',
    status: room.status,
    maxPlayers: room.maxPlayers,
    gameTimeSeconds: room.gameTimeSeconds,
    playerCount: room.players.length,
    spectatorCount: room.spectators.length,
  }));
  res.json(list);
});

// REST: 방 존재 여부 확인 (입장 페이지에서 사용)
app.get('/api/room/:roomId', (req, res) => {
  const room = getRoom(req.params.roomId);
  if (!room) return res.status(404).json({ error: 'room_not_found' });
  res.json({
    roomId: room.id,
    roomName: room.name || '이름 없는 방',
    status: room.status,
    maxPlayers: room.maxPlayers,
    gameTimeSeconds: room.gameTimeSeconds,
    playerCount: room.players.length,
    spectatorCount: room.spectators.length,
  });
});

io.on('connection', (socket) => {
  socket.on('room:create', (payload, ack) => {
    const { roomName, nickname, maxPlayers = 6, gameTimeSeconds = 180 } = payload || {};
    if (!nickname?.trim()) {
      ack?.({ success: false, error: 'nickname_required' });
      return;
    }
    const room = createRoom({
      roomName: roomName?.trim(),
      hostNickname: nickname.trim(),
      hostSocketId: socket.id,
      maxPlayers: Number(maxPlayers) || 6,
      gameTimeSeconds: Number(gameTimeSeconds) || 180,
    });
    socket.join(room.id);
    socket.data.roomId = room.id;
    socket.data.nickname = nickname.trim();
    socket.data.isHost = true;
    socket.data.asSpectator = false;
    ack?.({ success: true, roomId: room.id, room: serializeRoom(room) });
    io.to(room.id).emit('room:updated', serializeRoom(room));
  });

  socket.on('room:join', (payload, ack) => {
    const { roomId, nickname } = payload || {};
    if (!roomId || !nickname?.trim()) {
      ack?.({ success: false, error: 'room_id_and_nickname_required' });
      return;
    }
    const result = joinRoom(roomId, socket.id, nickname.trim());
    if (!result.success) {
      ack?.({ success: false, error: result.error });
      return;
    }
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.nickname = nickname.trim();
    socket.data.isHost = false;
    socket.data.asSpectator = result.asSpectator;
    ack?.({
      success: true,
      room: serializeRoom(result.room),
      asSpectator: result.asSpectator,
    });
    io.to(roomId).emit('room:updated', serializeRoom(result.room));
  });

  socket.on('room:leave', () => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    const room = leaveRoom(roomId, socket.id);
    socket.leave(roomId);
    socket.data.roomId = null;
    socket.data.nickname = null;
    socket.data.isHost = false;
    socket.data.asSpectator = false;
    if (room) io.to(roomId).emit('room:updated', serializeRoom(room));
  });

  socket.on('room:updateSettings', (payload, ack) => {
    const roomId = socket.data.roomId;
    if (!roomId) {
      ack?.({ success: false, error: 'not_in_room' });
      return;
    }
    const room = updateRoomSettings(roomId, payload || {}, socket.id);
    if (!room) {
      ack?.({ success: false, error: 'forbidden_or_invalid' });
      return;
    }
    ack?.({ success: true, room: serializeRoom(room) });
    io.to(roomId).emit('room:updated', serializeRoom(room));
  });

  socket.on('game:start', (ack) => {
    const roomId = socket.data.roomId;
    if (!roomId) {
      ack?.({ success: false, error: 'not_in_room' });
      return;
    }
    const result = startGame(roomId, socket.id);
    if (!result.success) {
      ack?.({ success: false, error: result.error });
      return;
    }
    ack?.({ success: true, game: result.game, prepEndAt: result.prepEndAt });
    io.to(roomId).emit('room:updated', serializeRoom(getRoom(roomId)));
    io.to(roomId).emit('game:state', result.game);
    startPositionBroadcast(roomId);
    const prepMs = 10 * 1000;
    setTimeout(() => {
      const room = getRoom(roomId);
      if (!room || room.status !== 'preparing') return;
      finishPrepAndStartGame(roomId);
      const updated = getRoom(roomId);
      if (updated?.game) {
        io.to(roomId).emit('room:updated', serializeRoom(updated));
        io.to(roomId).emit('game:state', serializeGame(updated.game));
      }
    }, prepMs);
  });

  socket.on('game:moveDirection', (payload) => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    const angle = Number(payload?.angle);
    const moving = Boolean(payload?.moving);
    if (Number.isNaN(angle)) return;
    const room = setMoveDirection(roomId, socket.id, angle, moving);
    if (!room?.game) return;
    io.to(roomId).emit('game:positions', serializeGame(room.game).positions);
  });

  socket.on('game:backToLobby', () => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    const room = backToLobby(roomId, socket.id);
    if (room) {
      io.to(roomId).emit('room:updated', serializeRoom(room));
    }
  });

  socket.on('disconnect', () => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    const room = leaveRoom(roomId, socket.id);
    if (room) io.to(roomId).emit('room:updated', serializeRoom(room));
  });
});

function serializeRoom(room) {
  if (!room) return null;
  const serialized = {
    id: room.id,
    name: room.name || '이름 없는 방',
    status: room.status,
    maxPlayers: room.maxPlayers,
    gameTimeSeconds: room.gameTimeSeconds,
    hostSocketId: room.hostSocketId,
    players: room.players.map((p) => ({
      socketId: p.socketId,
      nickname: p.nickname,
      type: p.type,
      role: room.game?.roles?.[p.socketId] ?? p.role ?? null,
      isHost: p.isHost,
    })),
    spectators: room.spectators.map((s) => ({
      socketId: s.socketId,
      nickname: s.nickname,
    })),
  };
  if (room.game) {
    serialized.game = serializeGame(room.game);
  }
  return serialized;
}

httpServer.listen(PORT, () => {
  console.log(`미로 속 경찰과 도둑 서버: http://localhost:${PORT}`);
});
