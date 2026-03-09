'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getSocket } from '@/lib/socket';
import { getClientSessionId, saveRoomSession } from '@/lib/session';
import styles from './page.module.css';

export default function CreateRoomPage() {
  const router = useRouter();
  const [roomName, setRoomName] = useState('');
  const [maxPlayers, setMaxPlayers] = useState(6);
  const [gameTimeSeconds, setGameTimeSeconds] = useState(180);
  const [nickname, setNickname] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const nick = nickname.trim();
    if (!nick) {
      setError('닉네임을 입력해 주세요.');
      return;
    }
    setError('');
    setLoading(true);

    const socket = getSocket();
    socket.emit(
      'room:create',
      {
        roomName: roomName.trim() || undefined,
        maxPlayers: Math.max(2, Math.min(12, maxPlayers)),
        gameTimeSeconds: Math.max(60, Math.min(600, gameTimeSeconds)),
        nickname: nick,
        sessionId: getClientSessionId(),
      },
      (res: { success?: boolean; error?: string; roomId?: string; room?: unknown }) => {
        setLoading(false);
        if (res?.success && res.roomId && res.room) {
          saveRoomSession({ roomId: res.roomId, nickname: nick });
          try {
            sessionStorage.setItem(
              'mirogd_created_room',
              JSON.stringify({
                roomId: res.roomId,
                room: res.room,
                nickname: nick,
                isHost: true,
              })
            );
          } catch (_) {}
          router.push(`/room/${res.roomId}`);
          return;
        }
        setError(res?.error === 'nickname_required' ? '닉네임을 입력해 주세요.' : '방 생성에 실패했습니다.');
      }
    );
  };

  return (
    <main className={styles.main}>
      <div className={styles.card}>
        <Link href="/" className={styles.back}>
          ← 첫 화면
        </Link>
        <h1 className={styles.title}>방 만들기</h1>
        <p className={styles.subtitle}>방 이름과 설정을 입력한 뒤, 마지막에 닉네임을 입력하세요.</p>

        <form onSubmit={handleSubmit} className={styles.form}>
          <label className={styles.label}>방 이름</label>
          <input
            type="text"
            value={roomName}
            onChange={(e) => setRoomName(e.target.value)}
            placeholder="예: 우리 방"
            className={styles.input}
            maxLength={30}
            autoFocus
          />

          <label className={styles.label}>최대 인원</label>
          <select
            value={maxPlayers}
            onChange={(e) => setMaxPlayers(Number(e.target.value))}
            className={styles.select}
          >
            {[2, 3, 4, 5, 6, 8, 10, 12].map((n) => (
              <option key={n} value={n}>
                {n}명
              </option>
            ))}
          </select>

          <label className={styles.label}>게임 시간 (초)</label>
          <select
            value={gameTimeSeconds}
            onChange={(e) => setGameTimeSeconds(Number(e.target.value))}
            className={styles.select}
          >
            <option value={60}>1분</option>
            <option value={120}>2분</option>
            <option value={180}>3분</option>
            <option value={240}>4분</option>
            <option value={300}>5분</option>
            <option value={420}>7분</option>
            <option value={600}>10분</option>
          </select>

          <label className={styles.label}>내 닉네임</label>
          <input
            type="text"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            placeholder="닉네임"
            className={styles.input}
            maxLength={20}
          />

          {error && <p className={styles.error}>{error}</p>}

          <button type="submit" className={styles.submit} disabled={loading}>
            {loading ? '방 만드는 중…' : '방 만들기'}
          </button>
        </form>
      </div>
    </main>
  );
}
