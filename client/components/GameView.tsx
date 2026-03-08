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
const LERP = 0.2;

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
  onMove: (angle: number, moving: boolean) => void;
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
    let mazeGraphics: import('pixi.js').Graphics;
    let charactersContainer: import('pixi.js').Container;
    const displayPos = new Map<string, { x: number; y: number }>();
    const characterNodes = new Map<string, { container: import('pixi.js').Container; circle: import('pixi.js').Graphics; label: import('pixi.js').Text }>();

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
        const gap = Math.max(1, cellSize * 0.06);
        const radius = Math.max(2, cellSize * 0.12);
        const PATH_FILL = 0xe8e4d9;
        const WALL_FILL = 0x6b5344;
        const WALL_HIGHLIGHT = 0x8b7355;

        const cell = (r: number, c: number) => {
          if (r < 0 || r >= rows || c < 0 || c >= cols) return WALL;
          return g.maze[r][c];
        };

        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const x = offsetX + c * cellSize + gap / 2;
            const y = offsetY + r * cellSize + gap / 2;
            const w = cellSize - gap;
            const h = cellSize - gap;
            if (cell(r, c) === PATH) {
              mazeGraphics.roundRect(x, y, w, h, radius).fill({ color: PATH_FILL });
            } else {
              mazeGraphics.roundRect(x, y, w, h, radius).fill({ color: WALL_FILL });
              mazeGraphics.roundRect(x, y, w, h, radius).stroke({
                width: 1,
                color: WALL_HIGHLIGHT,
                alignment: 0,
              });
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
        const radius = cellSize * 0.38;
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
            const circle = new PIXI.Graphics();
            const label = new PIXI.Text({
              text: getNickname(socketId),
              style: {
                fontSize: Math.max(11, cellSize * 0.32),
                fill: 0xffffff,
                align: 'center',
              },
            });
            label.anchor.set(0.5, 0);
            label.y = radius + 2;
            cont.addChild(circle);
            cont.addChild(label);
            charactersContainer.addChild(cont);
            node = { container: cont, circle, label };
            characterNodes.set(socketId, node);
          }

          node.label.text = getNickname(socketId);

          node.circle.clear();
          if (isCaught) {
            node.circle.circle(0, 0, radius).fill({ color: 0x666666 });
            node.label.style.fill = 0x999999;
          } else {
            if (role === 'police') {
              node.circle.circle(0, 0, radius).fill({ color: 0x5b7cff });
            } else if (role === 'thief') {
              node.circle.circle(0, 0, radius).fill({ color: 0xff9f43 });
            } else {
              node.circle.circle(0, 0, radius).fill({ color: 0x888888 });
            }
            node.circle.stroke({ width: 2, color: 0xffffff });
            node.label.style.fill = 0xffffff;
          }

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
          const cur = displayPos.get(socketId);
          if (cur) {
            cur.x += (target.x - cur.x) * LERP;
            cur.y += (target.y - cur.y) * LERP;
            const node = characterNodes.get(socketId);
            if (node) node.container.position.set(cur.x, cur.y);
          }
        }
      };
      app.ticker.add(tick);

      return () => {
        app.ticker.remove(tick);
        app.renderer.off('resize', onResize);
      };
    };

    let cleanup: (() => void) | undefined;
    init().then((c) => { cleanup = c; });

    return () => {
      cleanup?.();
      if (appRef.current && container.contains(appRef.current.canvas as Node)) {
        const canvas = appRef.current.canvas;
        appRef.current.destroy(true);
        if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
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
        {timeLeft !== null && game?.winner !== 'police' && game?.winner !== 'thief' && (
          <span className={styles.timer}>{timeLeft}초</span>
        )}
      </header>

      <div className={`${styles.canvasWrap} ${styles.pixiContainer}`} ref={containerRef} />

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
