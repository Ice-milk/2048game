'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Board,
  Direction,
  createInitialBoard,
  hasWinningTile,
  moveBoard,
} from '../lib/game2048';

const BEST_SCORE_KEY = 'demo-app-2048-best-score';
const SWIPE_MIN_DISTANCE = 48;
const GYRO_THRESHOLD = 80; // 度/秒，旋转速度阈值
const MOTION_COOLDOWN_MS = 400; // 增加冷却时间，避免回正时误触发
const MOTION_UNLOCK_THRESHOLD = 15; // 解锁阈值，确保真正静止才解锁

function getTileColor(value: number | null) {
  if (!value) return 'bg-stone-200';

  const colors: Record<number, string> = {
    2: 'bg-stone-100 text-stone-700',
    4: 'bg-stone-200 text-stone-700',
    8: 'bg-orange-300 text-white',
    16: 'bg-orange-400 text-white',
    32: 'bg-orange-500 text-white',
    64: 'bg-red-500 text-white',
    128: 'bg-amber-400 text-white text-xl',
    256: 'bg-amber-500 text-white text-xl',
    512: 'bg-amber-600 text-white text-xl',
    1024: 'bg-yellow-500 text-white text-lg',
    2048: 'bg-yellow-400 text-white text-lg ring-2 ring-yellow-200',
  };

  return colors[value] ?? 'bg-purple-600 text-white text-lg';
}

export default function Game2048() {
  const [board, setBoard] = useState<Board>(() => createInitialBoard());
  const [score, setScore] = useState(0);
  const [bestScore, setBestScore] = useState(() => {
    if (typeof window === 'undefined') return 0;
    const saved = window.localStorage.getItem(BEST_SCORE_KEY);
    return saved ? Number(saved) || 0 : 0;
  });
  const [gameOver, setGameOver] = useState(false);
  const [hasWon, setHasWon] = useState(false);
  const [motionEnabled, setMotionEnabled] = useState(false);
  const [lastMove, setLastMove] = useState<Direction | ''>('');
  const [debugData, setDebugData] = useState({ alpha: 0, beta: 0, gamma: 0 });
  const [showDebug] = useState(() => {
    if (typeof window === 'undefined') return false;
    const params = new URLSearchParams(window.location.search);
    return params.get('debug') === '1';
  });

  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const motionLockRef = useRef(false);
  const motionCooldownRef = useRef(0);
  const boardRef = useRef<HTMLDivElement | null>(null);
  const gyroCalibrationRef = useRef({ alpha: 0, beta: 0, gamma: 0 });

  const applyMove = useCallback((direction: Direction) => {
    if (gameOver) return;

    setBoard((prevBoard) => {
      const result = moveBoard(prevBoard, direction);
      if (!result.moved) {
        setGameOver(result.gameOver);
        return prevBoard;
      }

      setScore((prevScore) => {
        const nextScore = prevScore + result.scoreDelta;
        setBestScore((prevBest) => {
          const nextBest = Math.max(prevBest, nextScore);
          window.localStorage.setItem(BEST_SCORE_KEY, String(nextBest));
          return nextBest;
        });
        return nextScore;
      });

      setGameOver(result.gameOver);
      setHasWon(result.hasWon);
      setLastMove(direction);
      return result.board;
    });
  }, [gameOver]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const keyMap: Record<string, Direction> = {
        ArrowUp: 'up',
        ArrowDown: 'down',
        ArrowLeft: 'left',
        ArrowRight: 'right',
      };

      const direction = keyMap[e.key];
      if (!direction) return;
      e.preventDefault();
      applyMove(direction);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [applyMove]);

  useEffect(() => {
    const boardEl = boardRef.current;
    if (!boardEl) return;

    const handleTouchStart = (e: TouchEvent) => {
      const touch = e.touches[0];
      touchStartRef.current = { x: touch.clientX, y: touch.clientY };
    };

    const handleTouchMove = (e: TouchEvent) => {
      e.preventDefault();
    };

    const handleTouchEnd = (e: TouchEvent) => {
      const start = touchStartRef.current;
      if (!start) return;

      const touch = e.changedTouches[0];
      const deltaX = touch.clientX - start.x;
      const deltaY = touch.clientY - start.y;
      touchStartRef.current = null;

      if (Math.abs(deltaX) < SWIPE_MIN_DISTANCE && Math.abs(deltaY) < SWIPE_MIN_DISTANCE) return;

      if (Math.abs(deltaX) > Math.abs(deltaY)) {
        applyMove(deltaX > 0 ? 'right' : 'left');
      } else {
        applyMove(deltaY > 0 ? 'down' : 'up');
      }
    };

    boardEl.addEventListener('touchstart', handleTouchStart, { passive: true });
    boardEl.addEventListener('touchmove', handleTouchMove, { passive: false });
    boardEl.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      boardEl.removeEventListener('touchstart', handleTouchStart);
      boardEl.removeEventListener('touchmove', handleTouchMove);
      boardEl.removeEventListener('touchend', handleTouchEnd);
    };
  }, [applyMove]);

  // ✅ 正确的陀螺仪实现
  useEffect(() => {
    if (!motionEnabled) return;

    const handleMotion = (e: DeviceMotionEvent) => {
      if (gameOver) return;

      const rotation = e.rotationRate;
      if (!rotation || rotation.alpha === null || rotation.beta === null || rotation.gamma === null) return;

      // rotationRate 单位是度/秒
      // 根据实际测试：
      // alpha: 前后倾斜（控制上下）
      // beta: 左右倾斜（控制左右）

      const { alpha, beta, gamma } = rotation;

      if (showDebug) {
        setDebugData({
          alpha: Math.round(alpha * 10) / 10,
          beta: Math.round(beta * 10) / 10,
          gamma: Math.round(gamma * 10) / 10,
        });
      }

      const now = Date.now();
      if (now - motionCooldownRef.current < MOTION_COOLDOWN_MS) return;

      if (motionLockRef.current) {
        // 等待手机回到静止状态（更严格的阈值）
        if (Math.abs(alpha) < MOTION_UNLOCK_THRESHOLD && Math.abs(beta) < MOTION_UNLOCK_THRESHOLD) {
          motionLockRef.current = false;
        }
        return;
      }

      // 根据实际测试的映射：
      // beta (左右倾斜) → 左右移动
      // alpha (前后倾斜) → 上下移动
      let direction: Direction | null = null;

      if (Math.abs(beta) > Math.abs(alpha)) {
        // 左右倾斜更明显
        if (beta > GYRO_THRESHOLD) direction = 'right';
        else if (beta < -GYRO_THRESHOLD) direction = 'left';
      } else {
        // 前后倾斜更明显
        if (alpha > GYRO_THRESHOLD) direction = 'down';
        else if (alpha < -GYRO_THRESHOLD) direction = 'up';
      }

      if (direction) {
        motionLockRef.current = true;
        motionCooldownRef.current = now;
        applyMove(direction);
      }
    };

    window.addEventListener('devicemotion', handleMotion);
    return () => window.removeEventListener('devicemotion', handleMotion);
  }, [motionEnabled, applyMove, gameOver, showDebug]);

  const requestMotionPermission = async () => {
    if (
      typeof DeviceMotionEvent !== 'undefined' &&
      typeof (DeviceMotionEvent as unknown as { requestPermission?: () => Promise<string> }).requestPermission === 'function'
    ) {
      try {
        const permission = await (DeviceMotionEvent as unknown as { requestPermission: () => Promise<string> }).requestPermission();
        if (permission === 'granted') setMotionEnabled(true);
      } catch (error) {
        console.error('权限请求失败:', error);
      }
      return;
    }

    setMotionEnabled(true);
  };

  const restart = () => {
    setBoard(createInitialBoard());
    setScore(0);
    setGameOver(false);
    setHasWon(false);
    setLastMove('');
    motionLockRef.current = false;
    touchStartRef.current = null;
  };

  const moveLabel = useMemo(() => {
    if (!lastMove) return '';
    return { up: '↑', down: '↓', left: '←', right: '→' }[lastMove];
  }, [lastMove]);

  return (
    <main className="min-h-screen bg-gradient-to-br from-amber-50 via-orange-50 to-yellow-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-4">
        <header className="text-center">
          <h1 className="text-4xl font-bold text-stone-800 mb-2">2048 🎮</h1>
          <p className="text-stone-600">键盘、滑动、晃动控制，看看你能不能合到 2048。</p>
        </header>

        <section className="bg-white/90 backdrop-blur rounded-2xl shadow-xl p-4 sm:p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-stone-100 p-3 text-center">
              <div className="text-xs uppercase tracking-wide text-stone-500">Score</div>
              <div className="text-2xl font-bold text-stone-800">{score}</div>
            </div>
            <div className="rounded-xl bg-stone-100 p-3 text-center">
              <div className="text-xs uppercase tracking-wide text-stone-500">Best</div>
              <div className="text-2xl font-bold text-stone-800">{bestScore}</div>
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={restart}
              className="flex-1 rounded-xl bg-stone-800 px-4 py-3 text-white font-semibold transition hover:bg-stone-700 active:scale-[0.99]"
            >
              重新开始
            </button>
            {!motionEnabled && (
              <button
                onClick={requestMotionPermission}
                className="flex-1 rounded-xl bg-emerald-500 px-4 py-3 text-white font-semibold transition hover:bg-emerald-600 active:scale-[0.99]"
              >
                启用晃动
              </button>
            )}
          </div>

          {motionEnabled && (
            <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-700 text-center">
              ✅ 晃动控制已启用 - 左右倾斜控制左右，前后倾斜控制上下
            </div>
          )}

          {moveLabel && (
            <div className="text-center text-sm text-stone-500">上次移动：{moveLabel}</div>
          )}

          <div ref={boardRef} className="rounded-2xl bg-stone-300 p-3 touch-none select-none">
            <div className="grid grid-cols-4 gap-2">
              {board.map((row, i) =>
                row.map((cell, j) => (
                  <div
                    key={`${i}-${j}`}
                    className={`aspect-square rounded-xl flex items-center justify-center font-bold transition-all duration-150 text-2xl sm:text-3xl ${getTileColor(cell)} ${
                      !cell ? 'text-transparent' : ''
                    }`}
                  >
                    {cell ?? ''}
                  </div>
                ))
              )}
            </div>
          </div>

          {hasWon && !gameOver && (
            <div className="rounded-xl bg-yellow-50 border border-yellow-300 px-4 py-3 text-center text-yellow-800 font-semibold">
              🎉 已经合出 2048 了，还能继续冲更高分。
            </div>
          )}

          {gameOver && (
            <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-4 text-center space-y-1">
              <div className="text-2xl font-bold text-red-600">游戏结束</div>
              <div className="text-stone-700">最终分数：{score}</div>
            </div>
          )}

          {showDebug && motionEnabled && (
            <div className="rounded-xl bg-stone-100 p-3 text-xs font-mono text-stone-700">
              <div className="grid grid-cols-3 gap-2">
                <div>α: {debugData.alpha}°/s</div>
                <div>β: {debugData.beta}°/s</div>
                <div>γ: {debugData.gamma}°/s</div>
              </div>
              <div className="text-center text-blue-600 mt-1">
                β=前后倾斜(上下) γ=左右倾斜(左右)
              </div>
            </div>
          )}
        </section>

        <footer className="text-center text-sm text-stone-600 space-y-1">
          <p>💡 电脑用方向键，手机可滑动棋盘；需要时可开启晃动控制。</p>
          <p>把两个相同数字合并，冲到 2048，再往上卷。</p>
          {!hasWinningTile(board) && <p className="text-stone-500">提示：尽量把大数字固定在角落。</p>}
        </footer>
      </div>
    </main>
  );
}
