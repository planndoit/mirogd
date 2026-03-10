/**
 * 방(room) 메모리 저장소
 * - 방 생성, 조회, 입장, 설정 변경, 게임 시작/이동/잡기
 */

import { getMazeSize, generateMaze, getRandomPathCells } from './maze.js';

const rooms = new Map();
const PREP_SECONDS = 10;
const CATCH_RADIUS = 0.5; // 거리 이내면 잡힘 (연속 좌표)
const MOVE_SPEED = 3; // 셀/초
const MOVE_TICK_MS = 50;
const DISCONNECT_GRACE_MS = 90 * 1000;
const PATH = 0;
const PLAYER_RADIUS = 0.24;

const generateRoomId = () => {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 6; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return rooms.has(id) ? generateRoomId() : id;
};

function getAllParticipants(room) {
  return [...room.players, ...room.spectators];
}

function findParticipantBySession(room, sessionId) {
  if (!sessionId) return null;
  return getAllParticipants(room).find((participant) => participant.sessionId === sessionId) ?? null;
}

function findParticipantBySocket(room, socketId) {
  if (!socketId) return null;
  return getAllParticipants(room).find((participant) => participant.socketId === socketId) ?? null;
}

function clearDisconnectTimer(participant) {
  if (participant?.disconnectTimerId) {
    clearTimeout(participant.disconnectTimerId);
    participant.disconnectTimerId = null;
  }
}

function syncHost(room) {
  if (!room.players.length) return;
  const host = room.players.find((player) => player.sessionId === room.hostSessionId) ?? room.players[0];
  room.hostSessionId = host.sessionId;
  room.hostSocketId = host.socketId;
  room.players.forEach((player) => {
    player.isHost = player.sessionId === room.hostSessionId;
  });
}

function cleanupGameParticipant(room, socketId) {
  if (!room?.game || !socketId) return;
  delete room.game.positions[socketId];
  delete room.game.directions[socketId];
  delete room.game.roles[socketId];
  room.game.caughtThieves = room.game.caughtThieves.filter((id) => id !== socketId);
}

function cancelPreparingGame(room) {
  if (!room?.game) return;
  if (room.game.moveIntervalId) {
    clearInterval(room.game.moveIntervalId);
    room.game.moveIntervalId = null;
  }
  room.status = 'waiting';
  room.game = null;
  room.players.forEach((player) => {
    player.role = null;
  });
}

function applyLeaveOutcome(room) {
  if (!room?.game) return;

  if (room.status === 'preparing') {
    cancelPreparingGame(room);
    return;
  }

  if (room.status !== 'playing' || room.game.winner) return;

  const policeCount = room.players.filter((player) => room.game.roles[player.socketId] === 'police').length;
  const thiefCount = room.players.filter((player) => room.game.roles[player.socketId] === 'thief').length;

  if (thiefCount === 0) {
    room.game.winner = 'police';
    room.status = 'ended';
    return;
  }

  if (policeCount === 0) {
    room.game.winner = 'thief';
    room.status = 'ended';
    return;
  }

  checkGameEnd(room);
}

function remapGameParticipant(room, previousSocketId, nextSocketId) {
  if (!room?.game || !previousSocketId || previousSocketId === nextSocketId) return;

  if (room.game.positions[previousSocketId]) {
    room.game.positions[nextSocketId] = room.game.positions[previousSocketId];
    delete room.game.positions[previousSocketId];
  }
  if (room.game.directions[previousSocketId]) {
    room.game.directions[nextSocketId] = room.game.directions[previousSocketId];
    delete room.game.directions[previousSocketId];
  }
  if (room.game.roles[previousSocketId]) {
    room.game.roles[nextSocketId] = room.game.roles[previousSocketId];
    delete room.game.roles[previousSocketId];
  }
  room.game.caughtThieves = room.game.caughtThieves.map((id) => (id === previousSocketId ? nextSocketId : id));
}

function finalizeLeaveBySession(roomId, sessionId) {
  const room = rooms.get(roomId);
  if (!room) return null;

  const participant = findParticipantBySession(room, sessionId);
  if (!participant) return room;

  clearDisconnectTimer(participant);
  room.players = room.players.filter((player) => player.sessionId !== sessionId);
  room.spectators = room.spectators.filter((spectator) => spectator.sessionId !== sessionId);
  cleanupGameParticipant(room, participant.socketId);

  if (room.players.length === 0) {
    if (room.game?.moveIntervalId) clearInterval(room.game.moveIntervalId);
    rooms.delete(roomId);
    return null;
  }

  syncHost(room);
  if (participant.type === 'player') {
    applyLeaveOutcome(room);
  }
  return room;
}

function makeParticipant({ sessionId, socketId, nickname, type, isHost = false }) {
  return {
    sessionId,
    socketId,
    nickname,
    type,
    role: null,
    isHost,
    disconnectedAt: null,
    disconnectTimerId: null,
  };
}

function isWalkable(maze, x, y) {
  const rows = maze.length;
  const cols = maze[0].length;
  const points = [
    [x - PLAYER_RADIUS, y - PLAYER_RADIUS],
    [x + PLAYER_RADIUS, y - PLAYER_RADIUS],
    [x - PLAYER_RADIUS, y + PLAYER_RADIUS],
    [x + PLAYER_RADIUS, y + PLAYER_RADIUS],
  ];

  return points.every(([px, py]) => {
    if (px < 0 || py < 0 || px >= cols || py >= rows) return false;
    return maze[Math.floor(py)][Math.floor(px)] === PATH;
  });
}

export function createRoom({
  roomName,
  hostNickname,
  hostSocketId,
  hostSessionId,
  maxPlayers = 6,
  gameTimeSeconds = 180,
}) {
  const roomId = generateRoomId();
  const room = {
    id: roomId,
    name: (roomName || '').trim() || '이름 없는 방',
    status: 'waiting',
    maxPlayers,
    gameTimeSeconds,
    hostSocketId,
    hostSessionId,
    players: [
      makeParticipant({
        sessionId: hostSessionId,
        socketId: hostSocketId,
        nickname: hostNickname,
        type: 'player',
        isHost: true,
      }),
    ],
    spectators: [],
    game: null,
    createdAt: Date.now(),
  };
  rooms.set(roomId, room);
  return room;
}

export function getRoom(roomId) {
  return rooms.get(roomId) ?? null;
}

export function joinRoom(roomId, socketId, nickname, forceSpectator = false, sessionId = socketId) {
  const room = rooms.get(roomId);
  if (!room) return { success: false, error: 'room_not_found' };

  const normalizedNickname = nickname.trim();
  const normalizedSessionId = sessionId || socketId;

  const existing = findParticipantBySession(room, normalizedSessionId);
  if (existing) {
    clearDisconnectTimer(existing);
    remapGameParticipant(room, existing.socketId, socketId);
    existing.socketId = socketId;
    existing.disconnectedAt = null;
    if (existing.type === 'player') syncHost(room);
    return { success: true, room, asSpectator: existing.type === 'spectator', resumed: true };
  }

  const alreadyIn = room.players.some((player) => player.socketId === socketId)
    || room.spectators.some((spectator) => spectator.socketId === socketId);
  if (alreadyIn) return { success: false, error: 'already_in_room' };

  const nicknameTaken = [...room.players, ...room.spectators].some(
    (participant) => participant.nickname.toLowerCase() === normalizedNickname.toLowerCase()
  );
  if (nicknameTaken) return { success: false, error: 'nickname_taken' };

  const playerCount = room.players.length;
  const asSpectator = room.status !== 'waiting' || forceSpectator || playerCount >= room.maxPlayers;
  const participant = makeParticipant({
    sessionId: normalizedSessionId,
    socketId,
    nickname: normalizedNickname,
    type: asSpectator ? 'spectator' : 'player',
  });

  if (asSpectator) {
    room.spectators.push(participant);
    return { success: true, room, asSpectator: true };
  }

  room.players.push(participant);
  return { success: true, room, asSpectator: false };
}

export function leaveRoom(roomId, socketId, options = {}) {
  const room = rooms.get(roomId);
  if (!room) return null;

  const participant = findParticipantBySocket(room, socketId);
  if (!participant) return room;

  if (options.gracefulDisconnect) {
    clearDisconnectTimer(participant);
    participant.disconnectedAt = Date.now();
    participant.disconnectTimerId = setTimeout(() => {
      finalizeLeaveBySession(roomId, participant.sessionId);
    }, DISCONNECT_GRACE_MS);
    return room;
  }

  return finalizeLeaveBySession(roomId, participant.sessionId);
}

export function updateRoomSettings(roomId, { maxPlayers, gameTimeSeconds }, socketId) {
  const room = rooms.get(roomId);
  if (!room || room.hostSocketId !== socketId) return null;
  if (maxPlayers != null) room.maxPlayers = Math.max(2, Math.min(12, maxPlayers));
  if (gameTimeSeconds != null) room.gameTimeSeconds = Math.max(60, Math.min(600, gameTimeSeconds));
  return room;
}

export function getAllRooms() {
  return Array.from(rooms.values());
}

export function startGame(roomId, socketId) {
  const room = rooms.get(roomId);
  if (!room) return { success: false, error: 'room_not_found' };
  if (room.status !== 'waiting') return { success: false, error: 'game_already_started' };
  if (room.hostSocketId !== socketId) return { success: false, error: 'host_only' };
  if (room.players.length < 2) return { success: false, error: 'need_at_least_2_players' };

  const { rows, cols } = getMazeSize(room.players.length);
  const maze = generateMaze(rows, cols);
  const pathCells = getRandomPathCells(maze, room.players.length);
  const positions = {};
  const directions = {};
  room.players.forEach((player, index) => {
    const cell = pathCells[index];
    positions[player.socketId] = { x: cell.col + 0.5, y: cell.row + 0.5 };
    directions[player.socketId] = { x: 0, y: 0, moving: false };
  });

  const prepEndAt = Date.now() + PREP_SECONDS * 1000;
  room.status = 'preparing';
  room.game = {
    maze,
    positions,
    directions,
    roles: {},
    prepEndAt,
    gameEndAt: null,
    caughtThieves: [],
    winner: null,
    moveIntervalId: null,
  };
  return {
    success: true,
    prepEndAt,
    game: serializeGame(room.game),
  };
}

export function finishPrepAndStartGame(roomId) {
  const room = rooms.get(roomId);
  if (!room || room.status !== 'preparing' || !room.game) return room;

  const playerIds = room.players.map((player) => player.socketId);
  const playerCount = playerIds.length;
  // 경찰 수: 최대 3명, 최소 1명, 전체 인원의 대략 1/3
  let policeCount = Math.floor(playerCount / 3);
  if (policeCount < 1) policeCount = 1;
  if (policeCount > 3) policeCount = 3;
  // 최소 1명의 도둑은 보장
  const maxPolice = Math.max(1, playerCount - 1);
  if (policeCount > maxPolice) policeCount = maxPolice;

  const thiefCount = playerCount - policeCount;
  shuffleArray(playerIds);
  const thieves = new Set(playerIds.slice(0, thiefCount));
  const roles = {};
  room.players.forEach((player) => {
    roles[player.socketId] = thieves.has(player.socketId) ? 'thief' : 'police';
  });

  room.status = 'playing';
  room.game.roles = roles;
  room.game.prepEndAt = null;
  room.game.gameEndAt = Date.now() + room.gameTimeSeconds * 1000;
  return room;
}

export function updatePositions(roomId) {
  const room = rooms.get(roomId);
  if (!room?.game || (room.status !== 'preparing' && room.status !== 'playing')) return;
  const { maze, positions, directions } = room.game;
  const rows = maze.length;
  const cols = maze[0].length;
  const dt = MOVE_TICK_MS / 1000;
  const clamp = (value, max) => Math.max(PLAYER_RADIUS, Math.min(max - PLAYER_RADIUS, value));

  for (const socketId of Object.keys(positions)) {
    const pos = positions[socketId];
    const dir = directions[socketId];
    if (!dir?.moving) continue;

    const dx = dir.x * MOVE_SPEED * dt;
    const dy = dir.y * MOVE_SPEED * dt;

    const nextX = clamp(pos.x + dx, cols);
    if (isWalkable(maze, nextX, pos.y)) {
      pos.x = nextX;
    }

    const nextY = clamp(pos.y + dy, rows);
    if (isWalkable(maze, pos.x, nextY)) {
      pos.y = nextY;
    }
  }

  if (room.status === 'playing') {
    checkCatches(room);
    checkGameEnd(room);
  }
}

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

export function setMoveDirection(roomId, socketId, x, y) {
  const room = rooms.get(roomId);
  if (!room?.game?.directions || !room.game.positions[socketId]) return room;
  const dir = room.game.directions[socketId];
  if (dir) {
    const magnitude = Math.min(1, Math.hypot(x, y));
    dir.x = magnitude > 0 ? x : 0;
    dir.y = magnitude > 0 ? y : 0;
    dir.moving = magnitude > 0;
  }
  return room;
}

function checkCatches(room) {
  const { positions, roles, caughtThieves } = room.game;
  const policeIds = room.players
    .filter((player) => roles[player.socketId] === 'police')
    .map((player) => player.socketId);
  const thiefIds = room.players
    .filter((player) => roles[player.socketId] === 'thief' && !caughtThieves.includes(player.socketId))
    .map((player) => player.socketId);

  for (const pid of policeIds) {
    const pPos = positions[pid];
    if (!pPos) continue;
    const px = 'x' in pPos ? pPos.x : pPos.col + 0.5;
    const py = 'y' in pPos ? pPos.y : pPos.row + 0.5;
    for (const tid of thiefIds) {
      if (caughtThieves.includes(tid)) continue;
      const tPos = positions[tid];
      if (!tPos) continue;
      const tx = 'x' in tPos ? tPos.x : tPos.col + 0.5;
      const ty = 'y' in tPos ? tPos.y : tPos.row + 0.5;
      const dist = Math.hypot(px - tx, py - ty);
      if (dist <= CATCH_RADIUS) {
        caughtThieves.push(tid);
      }
    }
  }
}

function checkGameEnd(room) {
  if (room.status !== 'playing' || room.game.winner) return;
  const { roles, caughtThieves, gameEndAt } = room.game;
  const thiefCount = room.players.filter((player) => roles[player.socketId] === 'thief').length;
  const caughtCount = caughtThieves.length;
  if (caughtCount >= thiefCount) {
    room.game.winner = 'police';
    room.status = 'ended';
    return;
  }
  if (Date.now() >= gameEndAt) {
    room.game.winner = 'thief';
    room.status = 'ended';
  }
}

function serializeGame(game) {
  if (!game) return null;
  const pos = {};
  for (const [id, point] of Object.entries(game.positions || {})) {
    pos[id] = 'x' in point ? { x: point.x, y: point.y } : { x: point.col + 0.5, y: point.row + 0.5 };
  }
  return {
    maze: game.maze,
    positions: pos,
    roles: { ...game.roles },
    prepEndAt: game.prepEndAt,
    gameEndAt: game.gameEndAt,
    caughtThieves: [...(game.caughtThieves || [])],
    winner: game.winner,
  };
}

export function backToLobby(roomId, socketId) {
  const room = rooms.get(roomId);
  if (!room || room.hostSocketId !== socketId) return null;
  return resetRoomToLobby(roomId);
}

export function resetRoomToLobby(roomId) {
  const room = rooms.get(roomId);
  if (!room) return null;
  if (room.game?.moveIntervalId) clearInterval(room.game.moveIntervalId);
  room.status = 'waiting';
  room.game = null;
  room.players.forEach((player) => {
    player.role = null;
  });
  return room;
}

export { serializeGame };
