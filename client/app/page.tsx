'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { playSfx } from '@/lib/sfx';
import styles from './page.module.css';

const API_URL = process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3001';

type RoomItem = {
  roomId: string;
  roomName: string;
  status: string;
  maxPlayers: number;
  gameTimeSeconds: number;
  playerCount: number;
  spectatorCount: number;
};

const statusLabel: Record<string, string> = {
  waiting: '대기 중',
  preparing: '준비 중',
  playing: '게임 중',
  ended: '종료',
};

export default function HomePage() {
  const [rooms, setRooms] = useState<RoomItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchRooms = async () => {
    try {
      setError('');
      const res = await fetch(`${API_URL}/api/rooms`);
      if (!res.ok) throw new Error('방 목록을 불러올 수 없습니다.');
      const data = await res.json();
      setRooms(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : '오류가 발생했습니다.');
      setRooms([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRooms();
    const interval = setInterval(fetchRooms, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <main className={styles.main}>
      <div className={styles.container}>
        <h1 className={styles.title}>미로 속 경찰과 도둑</h1>
        <p className={styles.subtitle}>
          방을 만들거나 목록에서 방을 골라 입장하세요.
        </p>

        <Link href="/create" className={styles.primaryButton} onClick={() => { void playSfx('tap'); }}>
          방 만들기
        </Link>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>방 목록</h2>
          {loading && <p className={styles.listHint}>불러오는 중…</p>}
          {error && <p className={styles.error}>{error}</p>}
          {!loading && !error && rooms.length === 0 && (
            <p className={styles.listHint}>만들어진 방이 없습니다. 방 만들기를 눌러 새 방을 만드세요.</p>
          )}
          {!loading && rooms.length > 0 && (
            <ul className={styles.roomList}>
              {rooms.map((room) => (
                <li key={room.roomId}>
                  <Link href={`/room/${room.roomId}`} className={styles.roomItem} onClick={() => { void playSfx('tap'); }}>
                    <span className={styles.roomName}>{room.roomName}</span>
                    <span className={styles.roomMeta}>
                      {room.playerCount}/{room.maxPlayers}명
                      {' · '}
                      {statusLabel[room.status] ?? room.status}
                      {' · '}
                      코드 {room.roomId}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
