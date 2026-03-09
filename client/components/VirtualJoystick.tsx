'use client';

import { useRef, useState, useCallback } from 'react';
import styles from './VirtualJoystick.module.css';

const RADIUS = 70;
const KNOB_RADIUS = 28;
const DEADZONE = 0.15;

export default function VirtualJoystick({
  onMove,
  disabled,
}: {
  onMove: (x: number, y: number) => void;
  disabled?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [knobPos, setKnobPos] = useState({ x: 0, y: 0 });
  const [active, setActive] = useState(false);
  const lastMoveRef = useRef<{ x: number; y: number } | null>(null);

  const getCenter = useCallback(() => {
    const el = containerRef.current;
    if (!el) return { x: RADIUS, y: RADIUS };
    const rect = el.getBoundingClientRect();
    return { x: rect.width / 2, y: rect.height / 2 };
  }, []);

  const clampKnob = (dx: number, dy: number) => {
    const dist = Math.hypot(dx, dy);
    if (dist <= RADIUS - KNOB_RADIUS) return { x: dx, y: dy };
    const scale = (RADIUS - KNOB_RADIUS) / dist;
    return { x: dx * scale, y: dy * scale };
  };

  const updateFromClient = useCallback(
    (clientX: number, clientY: number) => {
      const center = getCenter();
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const dx = clientX - rect.left - center.x;
      const dy = clientY - rect.top - center.y;
      const clamped = clampKnob(dx, dy);
      setKnobPos(clamped);
      const dist = Math.hypot(clamped.x, clamped.y);
      const maxDistance = RADIUS - KNOB_RADIUS;
      const rawMagnitude = dist / maxDistance;
      const activeMagnitude = rawMagnitude <= DEADZONE ? 0 : (rawMagnitude - DEADZONE) / (1 - DEADZONE);
      const normalized = dist > 0
        ? {
            x: (clamped.x / dist) * activeMagnitude,
            y: (clamped.y / dist) * activeMagnitude,
          }
        : { x: 0, y: 0 };
      const lastMove = lastMoveRef.current;
      if (!lastMove || Math.abs(lastMove.x - normalized.x) > 0.02 || Math.abs(lastMove.y - normalized.y) > 0.02) {
        lastMoveRef.current = normalized;
        onMove(normalized.x, normalized.y);
      }
    },
    [getCenter, onMove]
  );

  const handlePointerDown = (e: React.PointerEvent) => {
    if (disabled) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setActive(true);
    updateFromClient(e.clientX, e.clientY);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!active || disabled) return;
    updateFromClient(e.clientX, e.clientY);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    setActive(false);
    setKnobPos({ x: 0, y: 0 });
    lastMoveRef.current = { x: 0, y: 0 };
    onMove(0, 0);
  };

  return (
    <div
      ref={containerRef}
      className={styles.joystick}
      style={{ width: RADIUS * 2, height: RADIUS * 2 }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <div className={styles.outer} />
      <div
        className={styles.knob}
        style={{
          transform: `translate(${knobPos.x}px, ${knobPos.y}px)`,
          width: KNOB_RADIUS * 2,
          height: KNOB_RADIUS * 2,
          marginLeft: -KNOB_RADIUS,
          marginTop: -KNOB_RADIUS,
        }}
      />
    </div>
  );
}
