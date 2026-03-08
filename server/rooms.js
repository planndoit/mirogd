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

const generateRoomId = () => {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 6; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return rooms.has(id) ? generateRoomId() : id;
};

/**
 * @typedef {'waiting'|'preparing'|'playing'|'ended'} RoomStatus
 * @typedef {'player'|'spectator'} ParticipantType
 * @typedef {'police'|'thief'|null} Role
 */

/**
 * @param {Object} options
 * @param {string} options.roomName
 * @param {string} options.hostNickname
 * @param {string} options.hostSocketId
 * @param {number} [options.maxPlayers=6]
 * @param {number} [options.gameTimeSeconds=180]
 */
export function createRoom({ roomName, hostNickname, hostSocketId, maxPlayers = 6, gameTimeSeconds = 180 }) {
  const roomId = generateRoomId();
  const room = {
    id: roomId,
    name: (roomName || '').trim() || '이름 없는 방',
    status: 'waiting',
    maxPlayers,
    gameTimeSeconds,
    hostSocketId,
    players: [
      { socketId: hostSocketId, nickname: hostNickname, type: 'player', role: null, isHost: true },
    ],
    spectators: [],
    game: null, // preparing/playing 시 { maze, positions, prepEndAt, gameEndAt, caughtThieves }
    createdAt: Date.now(),
  };
  rooms.set(roomId, room);
  return room;
}

/**
 * @param {string} roomId
 */
export function getRoom(roomId) {
  return rooms.get(roomId) ?? null;
}

/**
 * @param {string} roomId
 * @param {string} socketId
 * @param {string} nickname
 * @param {boolean} forceSpectator - true면 관전자로만 입장
 */
export function joinRoom(roomId, socketId, nickname, forceSpectator = false) {
  const room = rooms.get(roomId);
  if (!room) return { success: false, error: 'room_not_found' };
  if (room.status !== 'waiting') {
    return { success: true, room, asSpectator: true };
  }

  const playerCount = room.players.length;
  const asSpectator = forceSpectator || playerCount >= room.maxPlayers;

  if (asSpectator) {
    room.spectators.push({ socketId, nickname });
    return { success: true, room, asSpectator: true };
  }

  const alreadyIn = room.players.some((p) => p.socketId === socketId) || room.spectators.some((s) => s.socketId === socketId);
  if (alreadyIn) return { success: false, error: 'already_in_room' };

  const nicknameTaken = [...room.players, ...room.spectators].some(
    (p) => p.nickname.toLowerCase() === nickname.trim().toLowerCase()
  );
  if (nicknameTaken) return { success: false, error: 'nickname_taken' };

  room.players.push({
    socketId,
    nickname: nickname.trim(),
    type: 'player',
    role: null,
    isHost: false,
  });
  return { success: true, room, asSpectator: false };
}

/**
 * @param {string} roomId
 * @param {string} socketId
 */
export function leaveRoom(roomId, socketId) {
  const room = rooms.get(roomId);
  if (!room) return null;

  room.players = room.players.filter((p) => p.socketId !== socketId);
  room.spectators = room.spectators.filter((s) => s.socketId !== socketId);

  if (room.players.length === 0) {
    rooms.delete(roomId);
    return null;
  }

  if (room.hostSocketId === socketId) {
    room.hostSocketId = room.players[0].socketId;
    room.players[0].isHost = true;
  }
  return room;
}

/**
 * @param {string} roomId
 * @param {number} maxPlayers
 * @param {number} gameTimeSeconds
 * @param {string} socketId - 방장만 변경 가능
 */
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

/**
 * 게임 시작 (방장만). 미로 생성, 랜덤 스폰, 준비 10초 후 역할 배정.
 * @param {string} roomId
 * @param {string} socketId
 * @returns {{ success: boolean, error?: string, prepEndAt?: number, game?: object }}
 */
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
  const directions = {}; // { [socketId]: { angle, moving } }
  room.players.forEach((p, i) => {
    const rc = pathCells[i];
    positions[p.socketId] = { x: rc.col + 0.5, y: rc.row + 0.5 };
    directions[p.socketId] = { angle: 0, moving: false };
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

/**
 * 준비 시간 종료 시 호출: 역할 배정, 게임 시작
 */
export function finishPrepAndStartGame(roomId) {
  const room = rooms.get(roomId);
  if (!room || room.status !== 'preparing' || !room.game) return room;

  const playerIds = room.players.map((p) => p.socketId);
  const thiefCount = Math.max(1, Math.floor(playerIds.length / 2));
  shuffleArray(playerIds);
  const thieves = new Set(playerIds.slice(0, thiefCount));
  const roles = {};
  room.players.forEach((p) => {
    roles[p.socketId] = thieves.has(p.socketId) ? 'thief' : 'police';
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
  const step = MOVE_SPEED * dt;

  for (const socketId of Object.keys(positions)) {
    const pos = positions[socketId];
    const dir = directions[socketId];
    if (!dir?.moving) continue;
    const angle = dir.angle;
    let nx = pos.x + Math.cos(angle) * step;
    let ny = pos.y + Math.sin(angle) * step;
    nx = Math.max(0.3, Math.min(cols - 0.7, nx));
    ny = Math.max(0.3, Math.min(rows - 0.7, ny));
    const cellR = Math.floor(ny);
    const cellC = Math.floor(nx);
    if (cellR >= 0 && cellR < rows && cellC >= 0 && cellC < cols && maze[cellR][cellC] === 0) {
      pos.x = nx;
      pos.y = ny;
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

/**
 * 이동 방향 설정 (360° 연속 이동). angle(rad), moving(boolean)
 */
export function setMoveDirection(roomId, socketId, angle, moving) {
  const room = rooms.get(roomId);
  if (!room?.game?.directions || !room.game.positions[socketId]) return room;
  const dir = room.game.directions[socketId];
  if (dir) {
    dir.angle = angle;
    dir.moving = moving;
  }
  return room;
}

function checkCatches(room) {
  const { positions, roles, caughtThieves } = room.game;
  const policeIds = room.players.filter((p) => roles[p.socketId] === 'police').map((p) => p.socketId);
  const thiefIds = room.players.filter((p) => roles[p.socketId] === 'thief' && !caughtThieves.includes(p.socketId)).map((p) => p.socketId);

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
  const thiefCount = room.players.filter((p) => roles[p.socketId] === 'thief').length;
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
  for (const [id, p] of Object.entries(game.positions || {})) {
    pos[id] = 'x' in p ? { x: p.x, y: p.y } : { x: p.col + 0.5, y: p.row + 0.5 };
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

/**
 * 게임 종료 후 대기실로 (방장만). status=waiting, game=null
 */
export function backToLobby(roomId, socketId) {
  const room = rooms.get(roomId);
  if (!room || room.hostSocketId !== socketId) return null;
  return resetRoomToLobby(roomId);
}

/**
 * 게임 종료 후 자동 대기실 복귀 (서버에서 호출, 방장 불필요)
 */
export function resetRoomToLobby(roomId) {
  const room = rooms.get(roomId);
  if (!room) return null;
  if (room.game?.moveIntervalId) clearInterval(room.game.moveIntervalId);
  room.status = 'waiting';
  room.game = null;
  room.players.forEach((p) => {
    p.role = null;
  });
  return room;
}

export { serializeGame };
