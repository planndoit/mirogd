'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { getSocket } from '@/lib/socket';
import GameView from '@/components/GameView';
import styles from './page.module.css';

type Player = { socketId: string; nickname: string; type: string; role: string | null; isHost: boolean };
type Spectator = { socketId: string; nickname: string };
type GameState = {
  maze: number[][];
  positions: Record<string, { x: number; y: number } | { row: number; col: number }>;
  roles: Record<string, 'police' | 'thief'>;
  prepEndAt: number | null;
  gameEndAt: number | null;
  caughtThieves: string[];
  winner: 'police' | 'thief' | null;
};
type Room = {
  id: string;
  name?: string;
  status: string;
  maxPlayers: number;
  gameTimeSeconds: number;
  hostSocketId: string;
  players: Player[];
  spectators: Spectator[];
  game?: GameState | null;
};

export default function RoomPage() {
  const params = useParams();
  const router = useRouter();
  const roomId = params.roomId as string;
  const [room, setRoom] = useState<Room | null>(null);
  const [joinNickname, setJoinNickname] = useState('');
  const [joinError, setJoinError] = useState('');
  const [joinLoading, setJoinLoading] = useState(false);
  const [needsJoin, setNeedsJoin] = useState(true);
  const [checkedCreated, setCheckedCreated] = useState(false);
  const [myNickname, setMyNickname] = useState('');
  const [mySocketId, setMySocketId] = useState<string>('');
  const [isHost, setIsHost] = useState(false);
  const [asSpectator, setAsSpectator] = useState(false);
  const [gameState, setGameState] = useState<GameState | null>(null);

  // 방 만들기 직후 이동한 경우: 입장 폼 건너뛰고 대기실로
  useEffect(() => {
    if (!roomId) return;
    try {
      const raw = sessionStorage.getItem('mirogd_created_room');
      const data = raw ? JSON.parse(raw) : null;
      if (data?.roomId === roomId) {
        sessionStorage.removeItem('mirogd_created_room');
        const socket = getSocket();
        setRoom(data.room as Room);
        if ((data.room as Room).game) setGameState((data.room as Room).game ?? null);
        setNeedsJoin(false);
        setMyNickname(data.nickname ?? '');
        setMySocketId(socket.id ?? '');
        setIsHost(Boolean(data.isHost));
        setAsSpectator(false);
      }
    } catch (_) {
      // ignore
    }
    setCheckedCreated(true);
  }, [roomId]);

  useEffect(() => {
    if (!roomId) return;
    const socket = getSocket();

    const onUpdated = (updated: Room) => {
      setRoom(updated);
      if (updated.game) setGameState(updated.game);
      if (updated.status === 'waiting' && !updated.game) setGameState(null);
    };

    const onGameState = (game: GameState) => {
      setGameState(game);
    };

    const onGamePositions = (positions: Record<string, { row: number; col: number }>) => {
      setGameState((prev) => (prev ? { ...prev, positions } : null));
    };

    socket.on('room:updated', onUpdated);
    socket.on('game:state', onGameState);
    socket.on('game:positions', onGamePositions);
    return () => {
      socket.off('room:updated', onUpdated);
      socket.off('game:state', onGameState);
      socket.off('game:positions', onGamePositions);
    };
  }, [roomId]);

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    const nick = joinNickname.trim();
    if (!nick) {
      setJoinError('닉네임을 입력해 주세요.');
      return;
    }
    setJoinError('');
    setJoinLoading(true);

    const socket = getSocket();
    socket.emit(
      'room:join',
      { roomId, nickname: nick },
      (res: { success?: boolean; error?: string; room?: Room; asSpectator?: boolean }) => {
        setJoinLoading(false);
        if (res?.success && res.room) {
          setRoom(res.room);
          setNeedsJoin(false);
          setMyNickname(nick);
          setMySocketId(socket.id ?? '');
          setIsHost(res.room.players.some((p) => p.nickname === nick && p.isHost));
          setAsSpectator(res.asSpectator ?? false);
          if (res.room.game) setGameState(res.room.game);
          return;
        }
        if (res?.error === 'room_not_found') setJoinError('방을 찾을 수 없습니다.');
        else if (res?.error === 'nickname_taken') setJoinError('이미 사용 중인 닉네임입니다.');
        else setJoinError('입장에 실패했습니다.');
      }
    );
  };

  const handleLeave = () => {
    const socket = getSocket();
    socket.emit('room:leave');
    setRoom(null);
    setNeedsJoin(true);
    setMyNickname('');
    setIsHost(false);
    setAsSpectator(false);
    router.push('/');
  };

  const handleStartGame = () => {
    const socket = getSocket();
    socket.emit('game:start', (res: { success?: boolean; error?: string }) => {
      if (!res?.success && res?.error === 'need_at_least_2_players') {
        alert('최소 2명 이상 필요합니다.');
      }
    });
  };

  const moveThrottleRef = useRef<{ angle: number; moving: boolean; t: number } | null>(null);
  const handleGameMove = (angle: number, moving: boolean) => {
    const now = Date.now();
    const last = moveThrottleRef.current;
    if (last && now - last.t < 50 && last.moving === moving && Math.abs(last.angle - angle) < 0.05) return;
    moveThrottleRef.current = { angle, moving, t: now };
    getSocket().emit('game:moveDirection', { angle, moving });
  };

  const handleBackToLobby = () => {
    getSocket().emit('game:backToLobby');
  };

  const handleUpdateSettings = (payload: { maxPlayers?: number; gameTimeSeconds?: number }) => {
    const socket = getSocket();
    socket.emit('room:updateSettings', payload, (res: { success?: boolean }) => {
      if (!res?.success) return;
      // room:updated will come from server
    });
  };

  const showGame = (room?.status === 'preparing' || room?.status === 'playing' || room?.status === 'ended') && (gameState ?? room?.game);

  const shareLink = typeof window !== 'undefined' ? `${window.location.origin}/room/${roomId}` : '';

  if (!roomId) {
    return (
      <main className={styles.main}>
        <p>잘못된 방입니다.</p>
        <Link href="/">첫 화면으로</Link>
      </main>
    );
  }

  if (showGame && gameState) {
    return (
      <main className={styles.main}>
        <GameView
          game={gameState}
          players={room?.players ?? []}
          spectators={room?.spectators ?? []}
          mySocketId={mySocketId}
          onMove={handleGameMove}
          onBackToLobby={handleBackToLobby}
          isHost={isHost}
        />
      </main>
    );
  }

  if (!checkedCreated) {
    return (
      <main className={styles.main}>
        <div className={styles.card}>
          <p className={styles.subtitle}>입장 확인 중…</p>
        </div>
      </main>
    );
  }

  if (needsJoin) {
    return (
      <main className={styles.main}>
        <div className={styles.card}>
          <Link href="/" className={styles.back}>
            ← 첫 화면
          </Link>
          <h1 className={styles.title}>방 입장</h1>
          <p className={styles.subtitle}>닉네임을 입력하고 입장하세요.</p>
          <form onSubmit={handleJoin} className={styles.form}>
            <input
              type="text"
              value={joinNickname}
              onChange={(e) => setJoinNickname(e.target.value)}
              placeholder="닉네임"
              className={styles.input}
              maxLength={20}
              autoFocus
            />
            {joinError && <p className={styles.error}>{joinError}</p>}
            <button type="submit" className={styles.submit} disabled={joinLoading}>
              {joinLoading ? '입장 중…' : '입장'}
            </button>
          </form>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.main}>
      <div className={styles.lobby}>
        <header className={styles.header}>
          <h1 className={styles.title}>{room?.name || '미로 속 경찰과 도둑'}</h1>
          <p className={styles.roomId}>방 코드: <strong>{roomId}</strong></p>
          <button type="button" onClick={handleLeave} className={styles.leaveButton}>
            방 나가기
          </button>
        </header>

        <div className={styles.share}>
          <label className={styles.label}>방 링크 (친구에게 공유)</label>
          <div className={styles.shareRow}>
            <input type="text" readOnly value={shareLink} className={styles.input} />
            <button
              type="button"
              className={styles.copyButton}
              onClick={() => {
                navigator.clipboard.writeText(shareLink);
              }}
            >
              복사
            </button>
          </div>
        </div>

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>플레이어 ({room?.players.length ?? 0} / {room?.maxPlayers ?? 0})</h2>
          <ul className={styles.list}>
            {room?.players.map((p) => (
              <li key={p.socketId} className={styles.listItem}>
                <span>{p.nickname}</span>
                {p.isHost && <span className={styles.badge}>방장</span>}
                {p.nickname === myNickname && <span className={styles.badgeMe}>나</span>}
              </li>
            ))}
          </ul>
        </div>

        {room && room.spectators.length > 0 && (
          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>관전자 ({room.spectators.length})</h2>
            <ul className={styles.list}>
              {room.spectators.map((s) => (
                <li key={s.socketId} className={styles.listItem}>
                  <span>{s.nickname}</span>
                  {s.nickname === myNickname && <span className={styles.badgeMe}>나</span>}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className={styles.settings}>
          <p className={styles.settingsSummary}>최대 인원: {room?.maxPlayers}명 · 게임 시간: {room ? Math.floor(room.gameTimeSeconds / 60) : 0}분</p>
          {isHost && room?.status === 'waiting' && (
            <div className={styles.settingsControls}>
              <label className={styles.settingsLabel}>
                최대 인원
                <select
                  value={room?.maxPlayers ?? 6}
                  onChange={(e) => handleUpdateSettings({ maxPlayers: Number(e.target.value) })}
                  className={styles.settingsSelect}
                >
                  {[2, 3, 4, 5, 6, 8, 10, 12].map((n) => (
                    <option key={n} value={n}>{n}명</option>
                  ))}
                </select>
              </label>
              <label className={styles.settingsLabel}>
                게임 시간
                <select
                  value={room?.gameTimeSeconds ?? 180}
                  onChange={(e) => handleUpdateSettings({ gameTimeSeconds: Number(e.target.value) })}
                  className={styles.settingsSelect}
                >
                  <option value={60}>1분</option>
                  <option value={120}>2분</option>
                  <option value={180}>3분</option>
                  <option value={240}>4분</option>
                  <option value={300}>5분</option>
                  <option value={420}>7분</option>
                  <option value={600}>10분</option>
                </select>
              </label>
            </div>
          )}
        </div>

        {isHost && room?.status === 'waiting' && (
          <div className={styles.startSection}>
            <button type="button" onClick={handleStartGame} className={styles.startButton}>
              게임 시작
            </button>
            <p className={styles.startHint}>준비되면 게임을 시작할 수 있습니다.</p>
          </div>
        )}

        {asSpectator && (
          <p className={styles.spectatorNote}>관전자로 입장했습니다. 다음 게임에 참여할 수 있습니다.</p>
        )}
      </div>
    </main>
  );
}
