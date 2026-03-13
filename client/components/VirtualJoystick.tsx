'use client';

import { useMemo, useRef, useState, useCallback, useEffect } from 'react';
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
  const activePointerIdRef = useRef<number | null>(null);
  const activeTouchIdRef = useRef<number | null>(null);
  const useTouchEvents = useMemo(
    () => typeof window !== 'undefined' && navigator.maxTouchPoints > 0,
    []
  );

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

  const resetJoystick = useCallback(() => {
    activePointerIdRef.current = null;
    activeTouchIdRef.current = null;
    setActive(false);
    setKnobPos({ x: 0, y: 0 });
    lastMoveRef.current = { x: 0, y: 0 };
    onMove(0, 0);
  }, [onMove]);

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
      const normalized =
        dist > 0 && activeMagnitude > 0
          ? {
              x: (clamped.x / dist) * activeMagnitude,
              y: (clamped.y / dist) * activeMagnitude,
            }
          : { x: 0, y: 0 };
      lastMoveRef.current = normalized;
      onMove(normalized.x, normalized.y);
    },
    [getCenter, onMove]
  );

  const handlePointerDown = (e: React.PointerEvent) => {
    if (disabled) return;
    containerRef.current?.setPointerCapture(e.pointerId);
    activePointerIdRef.current = e.pointerId;
    setActive(true);
    updateFromClient(e.clientX, e.clientY);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!active || disabled || activePointerIdRef.current !== e.pointerId) return;
    updateFromClient(e.clientX, e.clientY);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (activePointerIdRef.current !== e.pointerId) return;
    containerRef.current?.releasePointerCapture(e.pointerId);
    resetJoystick();
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (!useTouchEvents || disabled) return;
    const touch = e.changedTouches[0];
    if (!touch) return;
    activeTouchIdRef.current = touch.identifier;
    setActive(true);
    updateFromClient(touch.clientX, touch.clientY);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!useTouchEvents || disabled || activeTouchIdRef.current === null) return;
    const touch = Array.from(e.changedTouches).find((item) => item.identifier === activeTouchIdRef.current);
    if (!touch) return;
    updateFromClient(touch.clientX, touch.clientY);
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!useTouchEvents || activeTouchIdRef.current === null) return;
    const touch = Array.from(e.changedTouches).find((item) => item.identifier === activeTouchIdRef.current);
    if (!touch) return;
    resetJoystick();
  };

  useEffect(() => {
    if (disabled) {
      resetJoystick();
    }
  }, [disabled, resetJoystick]);

  useEffect(() => {
    if (!active) return;

    const handleWindowBlur = () => {
      resetJoystick();
    };

    const handleVisibilityChange = () => {
      if (document.hidden) resetJoystick();
    };

    if (useTouchEvents) {
      const handleWindowTouchMove = (event: TouchEvent) => {
        if (activeTouchIdRef.current === null) return;
        const touch = Array.from(event.changedTouches).find((item) => item.identifier === activeTouchIdRef.current);
        if (!touch) return;
        event.preventDefault();
        updateFromClient(touch.clientX, touch.clientY);
      };

      const handleWindowTouchEnd = (event: TouchEvent) => {
        if (activeTouchIdRef.current === null) return;
        const touch = Array.from(event.changedTouches).find((item) => item.identifier === activeTouchIdRef.current);
        if (!touch) return;
        resetJoystick();
      };

      window.addEventListener('touchmove', handleWindowTouchMove, { passive: false });
      window.addEventListener('touchend', handleWindowTouchEnd);
      window.addEventListener('touchcancel', handleWindowTouchEnd);
      window.addEventListener('blur', handleWindowBlur);
      document.addEventListener('visibilitychange', handleVisibilityChange);

      return () => {
        window.removeEventListener('touchmove', handleWindowTouchMove);
        window.removeEventListener('touchend', handleWindowTouchEnd);
        window.removeEventListener('touchcancel', handleWindowTouchEnd);
        window.removeEventListener('blur', handleWindowBlur);
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      };
    }

    const handleWindowPointerUp = (event: PointerEvent) => {
      if (activePointerIdRef.current !== event.pointerId) return;
      resetJoystick();
    };

    window.addEventListener('pointerup', handleWindowPointerUp);
    window.addEventListener('pointercancel', handleWindowPointerUp);
    window.addEventListener('blur', handleWindowBlur);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('pointerup', handleWindowPointerUp);
      window.removeEventListener('pointercancel', handleWindowPointerUp);
      window.removeEventListener('blur', handleWindowBlur);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [active, resetJoystick, updateFromClient, useTouchEvents]);

  return (
    <div
      ref={containerRef}
      className={styles.joystick}
      style={{ width: RADIUS * 2, height: RADIUS * 2 }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
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
