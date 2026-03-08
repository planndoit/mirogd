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
  onMove: (angle: number, moving: boolean) => void;
  disabled?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [knobPos, setKnobPos] = useState({ x: 0, y: 0 });
  const [active, setActive] = useState(false);
  const lastAngleRef = useRef<number | null>(null);
  const lastMovingRef = useRef(false);

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
      const magnitude = dist / (RADIUS - KNOB_RADIUS);
      const moving = magnitude > DEADZONE;
      const angle = Math.atan2(clamped.y, clamped.x);
      if (moving !== lastMovingRef.current || (moving && lastAngleRef.current !== angle)) {
        lastAngleRef.current = angle;
        lastMovingRef.current = moving;
        onMove(angle, moving);
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
    lastAngleRef.current = null;
    lastMovingRef.current = false;
    onMove(0, false);
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
