'use client';

import { useEffect, useRef, useState } from 'react';
import VirtualJoystick from './VirtualJoystick';
import styles from './GameView.module.css';

type Position = { x: number; y: number } | { row: number; col: number };
type GameState = {
  maze: number[][];
  positions: Record<string, Position>;
  roles: Record<string, 'police' | 'thief'>;
  prepEndAt: number | null;
  gameEndAt: number | null;
  caughtThieves: string[];
  winner: 'police' | 'thief' | null;
};

type Player = { socketId: string; nickname: string };

const WALL = 1;
const PATH = 0;

export default function GameView({
  game,
  players,
  spectators,
  mySocketId,
  onMove,
  onBackToLobby,
  isHost,
}: {
  game: GameState;
  players: Player[];
  spectators: { socketId: string; nickname: string }[];
  mySocketId: string;
  onMove: (x: number, y: number) => void;
  onBackToLobby: () => void;
  isHost: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<import('pixi.js').Application | null>(null);
  const gameRef = useRef(game);
  gameRef.current = game;
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [prepLeft, setPrepLeft] = useState<number | null>(null);

  const allParticipants = [...players, ...spectators];
  const getNickname = (socketId: string) => allParticipants.find((p) => p.socketId === socketId)?.nickname ?? '?';

  useEffect(() => {
    if (!game?.maze?.length || !containerRef.current) return;
    const container = containerRef.current;
    let app: import('pixi.js').Application;
    // 이 effect에서 생성한 Pixi 인스턴스를 로컬로 기억해 두고, cleanup 시에만 사용한다.
    // (비동기 init 중 다른 effect가 돌더라도 서로의 인스턴스를 건드리지 않도록 분리)
    let localApp: import('pixi.js').Application | null = null;
    let mazeGraphics: import('pixi.js').Graphics;
    let charactersContainer: import('pixi.js').Container;
    const displayPos = new Map<string, { x: number; y: number }>();
    const characterNodes = new Map<
      string,
      {
        container: import('pixi.js').Container;
        shadow: import('pixi.js').Graphics;
        body: import('pixi.js').Graphics;
        labelBg: import('pixi.js').Graphics;
        label: import('pixi.js').Text;
        roleMark: import('pixi.js').Text;
      }
    >();

    const init = async () => {
      const PIXI = await import('pixi.js');
      app = new PIXI.Application();
      await app.init({
        resizeTo: container,
        backgroundColor: 0xd4d0c4,
        antialias: true,
        resolution: Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1),
      });
      container.appendChild(app.canvas as HTMLCanvasElement);
      app.canvas.style.display = 'block';
      app.canvas.style.width = '100%';
      app.canvas.style.height = '100%';
      localApp = app;
      appRef.current = app;

      const rows = game.maze.length;
      const cols = game.maze[0].length;

      const getCellSize = () => {
        const w = app.renderer.width;
        const h = app.renderer.height;
        return Math.min(w / cols, h / rows);
      };

      const cellToPixel = (rowOrY: number, colOrX: number, isFloat = false) => {
        const cellSize = getCellSize();
        const offsetX = (app.renderer.width - cols * cellSize) / 2;
        const offsetY = (app.renderer.height - rows * cellSize) / 2;
        if (isFloat) {
          return { x: offsetX + colOrX * cellSize, y: offsetY + rowOrY * cellSize };
        }
        return {
          x: offsetX + colOrX * cellSize + cellSize / 2,
          y: offsetY + rowOrY * cellSize + cellSize / 2,
        };
      };

      const posToPixel = (p: Position) => {
        if ('x' in p && 'y' in p) return cellToPixel(p.y, p.x, true);
        return cellToPixel(p.row, p.col, false);
      };

      mazeGraphics = new PIXI.Graphics();
      app.stage.addChild(mazeGraphics);

      const drawMaze = () => {
        const g = gameRef.current;
        if (!g?.maze?.length) return;
        mazeGraphics.clear();
        const cellSize = getCellSize();
        const offsetX = (app.renderer.width - cols * cellSize) / 2;
        const offsetY = (app.renderer.height - rows * cellSize) / 2;
        const gap = Math.max(1, Math.floor(cellSize * 0.08));
        const inset = gap / 2;
        const PATH_LIGHT = 0x90c267;
        const PATH_DARK = 0x6da050;
        const PATH_MOSS = 0x52793a;
        const WALL_TOP = 0x8a6a46;
        const WALL_SIDE = 0x5e4731;
        const WALL_EDGE = 0xb58b60;

        const cell = (r: number, c: number) => {
          if (r < 0 || r >= rows || c < 0 || c >= cols) return WALL;
          return g.maze[r][c];
        };

        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const x = offsetX + c * cellSize + inset;
            const y = offsetY + r * cellSize + inset;
            const w = cellSize - gap;
            const h = cellSize - gap;
            if (cell(r, c) === PATH) {
              const baseColor = (r + c) % 2 === 0 ? PATH_LIGHT : PATH_DARK;
              mazeGraphics.rect(x, y, w, h).fill({ color: baseColor });
              mazeGraphics.rect(x, y, w, Math.max(2, h * 0.18)).fill({ color: 0xa6d97b, alpha: 0.45 });
              mazeGraphics.rect(x + w * 0.12, y + h * 0.12, w * 0.16, h * 0.16).fill({ color: PATH_MOSS, alpha: 0.35 });
              mazeGraphics.rect(x + w * 0.65, y + h * 0.58, w * 0.12, h * 0.12).fill({ color: 0xcfe7a4, alpha: 0.35 });
            } else {
              mazeGraphics.rect(x, y, w, h).fill({ color: WALL_SIDE });
              mazeGraphics.rect(x, y, w, h * 0.72).fill({ color: WALL_TOP });
              mazeGraphics.rect(x, y, w, Math.max(2, h * 0.14)).fill({ color: WALL_EDGE, alpha: 0.85 });
              mazeGraphics.rect(x + w * 0.08, y + h * 0.24, w * 0.84, Math.max(1, h * 0.06)).fill({ color: WALL_EDGE, alpha: 0.3 });
              mazeGraphics.rect(x + w * 0.08, y + h * 0.48, w * 0.84, Math.max(1, h * 0.06)).fill({ color: WALL_EDGE, alpha: 0.22 });
              mazeGraphics.rect(x + w * 0.82, y, Math.max(2, w * 0.18), h).fill({ color: 0x463423, alpha: 0.35 });
            }
          }
        }
      };

      charactersContainer = new PIXI.Container();
      app.stage.addChild(charactersContainer);

      const updateCharacterNodes = () => {
        const g = gameRef.current;
        if (!g) return;
        const cellSize = getCellSize();
        const avatarSize = cellSize * 0.72;
        const pos = g.positions || {};
        const roles = g.roles || {};
        const caught = new Set(g.caughtThieves || []);

        for (const socketId of Object.keys(pos)) {
          const p = pos[socketId];
          const target = posToPixel(p);
          if (!displayPos.has(socketId)) {
            displayPos.set(socketId, { x: target.x, y: target.y });
          }
          const role = roles[socketId];
          const isCaught = caught.has(socketId);

          let node = characterNodes.get(socketId);
          if (!node) {
            const cont = new PIXI.Container();
            const shadow = new PIXI.Graphics();
            const body = new PIXI.Graphics();
            const labelBg = new PIXI.Graphics();
            const label = new PIXI.Text({
              text: getNickname(socketId),
              style: {
                fontSize: Math.max(11, cellSize * 0.32),
                fill: 0xffffff,
                align: 'center',
                fontWeight: '700',
              },
            });
            const roleMark = new PIXI.Text({
              text: '?',
              style: {
                fontSize: Math.max(10, cellSize * 0.28),
                fill: 0xffffff,
                fontWeight: '800',
              },
            });
            roleMark.anchor.set(0.5);
            label.anchor.set(0.5, 0.5);
            cont.addChild(shadow);
            cont.addChild(body);
            cont.addChild(roleMark);
            cont.addChild(labelBg);
            cont.addChild(label);
            charactersContainer.addChild(cont);
            node = { container: cont, shadow, body, labelBg, label, roleMark };
            characterNodes.set(socketId, node);
          }

          node.label.text = getNickname(socketId);
          node.label.style.fontSize = Math.max(11, cellSize * 0.24);

          node.shadow.clear();
          node.shadow.ellipse(0, avatarSize * 0.42, avatarSize * 0.32, avatarSize * 0.13).fill({ color: 0x000000, alpha: 0.18 });

          node.body.clear();
          node.labelBg.clear();
          if (isCaught) {
            node.body.rect(-avatarSize * 0.24, -avatarSize * 0.18, avatarSize * 0.48, avatarSize * 0.32).fill({ color: 0x666666 });
            node.body.rect(-avatarSize * 0.18, -avatarSize * 0.46, avatarSize * 0.36, avatarSize * 0.28).fill({ color: 0x9b8a78 });
            node.body.rect(-avatarSize * 0.18, avatarSize * 0.14, avatarSize * 0.12, avatarSize * 0.26).fill({ color: 0x555555 });
            node.body.rect(avatarSize * 0.06, avatarSize * 0.14, avatarSize * 0.12, avatarSize * 0.26).fill({ color: 0x555555 });
            node.label.style.fill = 0xc8c8c8;
            node.roleMark.text = 'X';
            node.roleMark.style.fill = 0xd6d6d6;
          } else {
            if (role === 'police') {
              node.body.rect(-avatarSize * 0.3, -avatarSize * 0.16, avatarSize * 0.6, avatarSize * 0.34).fill({ color: 0x375cbe });
              node.body.rect(-avatarSize * 0.18, -avatarSize * 0.46, avatarSize * 0.36, avatarSize * 0.28).fill({ color: 0xf0c9a4 });
              node.body.rect(-avatarSize * 0.22, -avatarSize * 0.56, avatarSize * 0.44, avatarSize * 0.1).fill({ color: 0x1e326b });
              node.body.rect(-avatarSize * 0.28, -avatarSize * 0.5, avatarSize * 0.56, avatarSize * 0.08).fill({ color: 0x29438c });
              node.body.rect(-avatarSize * 0.08, -avatarSize * 0.06, avatarSize * 0.16, avatarSize * 0.12).fill({ color: 0xf1c84b });
              node.body.rect(-avatarSize * 0.18, avatarSize * 0.18, avatarSize * 0.12, avatarSize * 0.24).fill({ color: 0x1d2e63 });
              node.body.rect(avatarSize * 0.06, avatarSize * 0.18, avatarSize * 0.12, avatarSize * 0.24).fill({ color: 0x1d2e63 });
              node.roleMark.text = 'P';
              node.roleMark.style.fill = 0xffffff;
            } else if (role === 'thief') {
              node.body.rect(-avatarSize * 0.3, -avatarSize * 0.16, avatarSize * 0.6, avatarSize * 0.34).fill({ color: 0x2f3136 });
              node.body.rect(-avatarSize * 0.3, -avatarSize * 0.05, avatarSize * 0.6, avatarSize * 0.07).fill({ color: 0xd48a34 });
              node.body.rect(-avatarSize * 0.3, avatarSize * 0.06, avatarSize * 0.6, avatarSize * 0.07).fill({ color: 0xd48a34 });
              node.body.rect(-avatarSize * 0.18, -avatarSize * 0.46, avatarSize * 0.36, avatarSize * 0.28).fill({ color: 0xe8c09d });
              node.body.rect(-avatarSize * 0.2, -avatarSize * 0.38, avatarSize * 0.4, avatarSize * 0.08).fill({ color: 0x111111 });
              node.body.rect(-avatarSize * 0.18, avatarSize * 0.18, avatarSize * 0.12, avatarSize * 0.24).fill({ color: 0x151515 });
              node.body.rect(avatarSize * 0.06, avatarSize * 0.18, avatarSize * 0.12, avatarSize * 0.24).fill({ color: 0x151515 });
              node.roleMark.text = 'T';
              node.roleMark.style.fill = 0xffd38b;
            } else {
              node.body.rect(-avatarSize * 0.3, -avatarSize * 0.16, avatarSize * 0.6, avatarSize * 0.34).fill({ color: 0x7d8794 });
              node.body.rect(-avatarSize * 0.18, -avatarSize * 0.46, avatarSize * 0.36, avatarSize * 0.28).fill({ color: 0xe8c09d });
              node.body.rect(-avatarSize * 0.18, avatarSize * 0.18, avatarSize * 0.12, avatarSize * 0.24).fill({ color: 0x5d6672 });
              node.body.rect(avatarSize * 0.06, avatarSize * 0.18, avatarSize * 0.12, avatarSize * 0.24).fill({ color: 0x5d6672 });
              node.roleMark.text = '?';
              node.roleMark.style.fill = 0xffffff;
            }
            node.label.style.fill = 0xffffff;
          }

          node.roleMark.position.set(0, -avatarSize * 0.02);
          node.labelBg.roundRect(-avatarSize * 0.5, avatarSize * 0.48, avatarSize, avatarSize * 0.26, avatarSize * 0.08).fill({
            color: 0x18202c,
            alpha: 0.88,
          });
          node.label.position.set(0, avatarSize * 0.61);

          const cur = displayPos.get(socketId)!;
          node.container.position.set(cur.x, cur.y);
        }

        for (const socketId of Array.from(characterNodes.keys())) {
          if (!(socketId in pos)) {
            const node = characterNodes.get(socketId)!;
            charactersContainer.removeChild(node.container);
            node.container.destroy({ children: true });
            characterNodes.delete(socketId);
            displayPos.delete(socketId);
          }
        }
      };

      drawMaze();
      updateCharacterNodes();

      const onResize = () => {
        if (!app?.renderer?.width || !app.renderer.height) return;
        drawMaze();
        const g = gameRef.current;
        if (g?.positions) {
          for (const [socketId, pos] of Object.entries(g.positions)) {
            const target = posToPixel(pos);
            displayPos.set(socketId, { x: target.x, y: target.y });
          }
        }
        updateCharacterNodes();
      };
      app.renderer.on('resize', onResize);

      const tick = () => {
        updateCharacterNodes();
        const g = gameRef.current;
        if (!g?.positions) return;
        for (const [socketId, p] of Object.entries(g.positions)) {
          const target = posToPixel(p);
          displayPos.set(socketId, { x: target.x, y: target.y });
          const node = characterNodes.get(socketId);
          if (node) node.container.position.set(target.x, target.y);
        }
      };
      app.ticker.add(tick);

      return () => {
        if (localApp) {
          localApp.ticker.remove(tick);
          localApp.renderer.off('resize', onResize);
        }
      };
    };

    let cleanup: (() => void) | undefined;
    init().then((c) => {
      cleanup = c;
    });

    return () => {
      cleanup?.();
      // 이 effect에서 생성한 인스턴스만 정리한다.
      if (localApp) {
        const canvas = localApp.canvas as HTMLCanvasElement | undefined;
        localApp.destroy(true);
        if (canvas && canvas.parentNode) {
          canvas.parentNode.removeChild(canvas);
        }
      }
      // 현재 전역 참조가 이 effect에서 만든 인스턴스라면 함께 정리
      if (appRef.current === localApp) {
        appRef.current = null;
      }
    };
  }, [game?.maze]);

  useEffect(() => {
    if (!game) return;
    const tick = () => {
      if (game.prepEndAt) {
        const left = Math.ceil((game.prepEndAt - Date.now()) / 1000);
        setPrepLeft(Math.max(0, left));
      } else if (game.gameEndAt && !game.winner) {
        const left = Math.ceil((game.gameEndAt - Date.now()) / 1000);
        setTimeLeft(Math.max(0, left));
      } else {
        setTimeLeft(null);
        setPrepLeft(null);
      }
    };
    tick();
    const id = setInterval(tick, 200);
    return () => clearInterval(id);
  }, [game?.prepEndAt, game?.gameEndAt, game?.winner]);

  const myRole = game?.roles?.[mySocketId];
  const isPlayer = game?.positions && mySocketId in game.positions;
  const canMove = game && isPlayer && (game.prepEndAt || game.gameEndAt) && !game.winner && !game.caughtThieves?.includes(mySocketId);

  return (
    <div className={styles.wrapper}>
      <header className={styles.header}>
        <span className={styles.role}>
          {prepLeft !== null && prepLeft > 0 && `준비 ${prepLeft}초`}
          {prepLeft === 0 && !myRole && '역할 배정 중…'}
          {myRole === 'police' && '경찰'}
          {myRole === 'thief' && '도둑'}
        </span>
        <span className={styles.timer}>
          {timeLeft !== null && game?.winner !== 'police' && game?.winner !== 'thief' ? `${timeLeft}초 · ` : ''}
          플레이어 {players.length} · 관전자 {spectators.length}
        </span>
      </header>

      <div className={styles.canvasWrap}>
        <div className={styles.pixiContainer} ref={containerRef} />
      </div>

      {game.prepEndAt && prepLeft !== null && prepLeft > 0 && (
        <div className={styles.prepOverlay}>
          <div className={styles.prepText}>{prepLeft}</div>
        </div>
      )}

      {game?.winner && (
        <div className={styles.resultOverlay}>
          <p className={styles.resultText}>
            {game.winner === 'police' ? '경찰 승리!' : '도둑 승리!'}
          </p>
          <p className={styles.autoLobbyHint}>잠시 후 자동으로 대기실로 이동합니다.</p>
          {isHost && (
            <button type="button" onClick={onBackToLobby} className={styles.lobbyButton}>
              지금 대기실로
            </button>
          )}
        </div>
      )}

      {canMove && (
        <div className={styles.pad}>
          <VirtualJoystick onMove={onMove} disabled={!!game?.winner} />
        </div>
      )}
    </div>
  );
}
