'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Board,
  Direction,
  TileCell,
  cloneBoard,
  createInitialBoard,
  hasWinningTile,
  moveBoard,
  resetTileIdCounter,
} from '../lib/game2048';
import {
  ACHIEVEMENTS,
  type AchievementDef,
  type AchievementState,
  evaluateAchievements,
} from '../lib/achievements';
import { getBestDirection } from '../lib/hint';

/* ───── 常量 ───── */
const BEST_SCORE_KEY = '2048-best-score';
const SAVE_KEY = '2048-save';
const ACHIEVE_KEY = '2048-achievements';
const HISTORY_KEY = '2048-history';
const THEME_KEY = '2048-theme';
const SWIPE_MIN_DISTANCE = 48;
const GYRO_THRESHOLD = 80;
const MOTION_COOLDOWN_MS = 400;
const MOTION_UNLOCK_THRESHOLD = 15;
const DEBUG_RENDER_INTERVAL_MS = 100;

/* ───── 类型 ───── */
type HistoryEntry = { board: Board; score: number; moveCount: number; gameOver: boolean; hasWon: boolean };
type FloatTextItem = { id: number; text: string; row: number; col: number };
type SavedState = { board: Board; score: number; moveCount: number; accumulatedTime: number; bestScore: number };
type GameRecord = { score: number; moves: number; time: number; highestTile: number; date: string };
type AchieveNotify = { def: AchievementDef; leaving: boolean };

let _floatId = 0;

/* ───── 颜色映射 ───── */
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

function tileAnimClass(tileId: number, newIds: Set<number>, mergedIds: Set<number>): string {
  if (newIds.has(tileId)) return 'tile-new';
  if (mergedIds.has(tileId)) return 'tile-merged';
  return '';
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/* ───── 辅助：从 localStorage 恢复存档 ───── */
function loadSave(): SavedState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as SavedState;
  } catch {
    return null;
  }
}

function clearSave() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(SAVE_KEY);
}

/* ───── 主组件 ───── */
export default function Game2048() {
  /* 客户端就绪标记 —— 解决 hydration mismatch */
  const [hydrated, setHydrated] = useState(false);

  /* 游戏是否已开始 */
  const [gameStarted, setGameStarted] = useState(false);

  const [board, setBoard] = useState<Board>(createInitialBoard);
  const [score, setScore] = useState(0);
  const [bestScore, setBestScore] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const [hasWon, setHasWon] = useState(false);
  const hasWonRef = useRef(false);
  const [motionEnabled, setMotionEnabled] = useState(false);
  const [lastMove, setLastMove] = useState<Direction | ''>('');
  const [moveCount, setMoveCount] = useState(0);
  const [showDebug, setShowDebug] = useState(false);

  /* debug 陀螺仪数据 */
  const [debugData, setDebugData] = useState({ alpha: 0, beta: 0, gamma: 0 });

  /* undo / redo */
  const [undoStack, setUndoStack] = useState<HistoryEntry[]>([]);
  const [redoStack, setRedoStack] = useState<HistoryEntry[]>([]);
  const canUndo = undoStack.length > 0;
  const canRedo = redoStack.length > 0;

  /* 合并飘字 */
  const [floatTexts, setFloatTexts] = useState<FloatTextItem[]>([]);

  /* 胜利彩带 */
  const [showConfetti, setShowConfetti] = useState(false);
  const [showVictoryModal, setShowVictoryModal] = useState(false);

  /* 计时器 —— 支持页面隐藏时暂停；游戏未开始时不计时 */
  const accumulatedRef = useRef(0);
  const resumeTimeRef = useRef(Date.now());
  const isPausedRef = useRef(true);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  /* ───── refs ───── */
  const boardRef = useRef(board);
  const scoreRef = useRef(score);
  const bestScoreRef = useRef(bestScore);
  const gameOverRef = useRef(gameOver);
  const moveCountRef = useRef(moveCount);
  const boardElRef = useRef<HTMLDivElement | null>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const motionLockRef = useRef(false);
  const motionCooldownRef = useRef(0);

  /* FLIP */
  const isFlippingRef = useRef(false);
  const prevTileRectsRef = useRef<Map<number, DOMRect>>(new Map());
  const prevBoardForAnimRef = useRef<Board | null>(null);

  /* tile 动画状态（state 确保即时渲染） */
  const [newTileIds, setNewTileIds] = useState<Set<number>>(new Set());
  const [mergedTileIds, setMergedTileIds] = useState<Set<number>>(new Set());

  /* ───── 客户端一次性初始化（localStorage / URL 参数等）───── */
  useEffect(() => {
    // 恢复存档
    const save = loadSave();
    if (save) {
      setBoard(save.board);
      setScore(save.score);
      setMoveCount(save.moveCount);
      accumulatedRef.current = save.accumulatedTime;
      resumeTimeRef.current = Date.now();
      setElapsedSeconds(save.accumulatedTime);
      setBestScore(save.bestScore);
      setGameStarted(true);
    }

    // 加载最佳分数（无存档时也加载历史最佳）
    const storedBest = localStorage.getItem(BEST_SCORE_KEY);
    if (storedBest) setBestScore((prev) => Math.max(prev, Number(storedBest) || 0));

    // debug 参数
    if (new URLSearchParams(window.location.search).get('debug') === '1') {
      setShowDebug(true);
    }

    setHydrated(true);
  }, []);

  /* 暗色主题 */
  const [darkMode, setDarkMode] = useState(false);

  /* 成就 */
  const [unlockedIds, setUnlockedIds] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set();
    try {
      const raw = localStorage.getItem(ACHIEVE_KEY);
      return raw ? new Set<string>(JSON.parse(raw)) : new Set();
    } catch { return new Set(); }
  });
  const [achieveNotify, setAchieveNotify] = useState<AchieveNotify | null>(null);
  const dismissAchieve = useCallback(() => setAchieveNotify(null), []);
  const highestTileRef = useRef(0);
  const consecutiveMergesRef = useRef(0);

  /* 历史记录 */
  const [history, setHistory] = useState<GameRecord[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      return raw ? JSON.parse(raw) as GameRecord[] : [];
    } catch { return []; }
  });
  const [showHistory, setShowHistory] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [aiPlaying, setAiPlaying] = useState(false);
  const [boardShake, setBoardShake] = useState(false);

  /* 提示 & AI */
  const hint = useMemo(() => {
    if (gameOver) return null;
    return getBestDirection(board);
  }, [board, gameOver]);

  /* debug 节流 */
  const debugTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* 同步 refs */
  boardRef.current = board;
  scoreRef.current = score;
  bestScoreRef.current = bestScore;
  gameOverRef.current = gameOver;
  moveCountRef.current = moveCount;

  /* ───── 存档（仅游戏开始后保存，避免 StrictMode 二次 effect 污染）───── */
  useEffect(() => {
    if (typeof window === 'undefined' || !gameStarted) return;
    const state: SavedState = {
      board,
      score,
      moveCount,
      accumulatedTime: accumulatedRef.current + (isPausedRef.current ? 0 : Math.floor((Date.now() - resumeTimeRef.current) / 1000)),
      bestScore,
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(state));
  }, [board, score, moveCount, bestScore, gameStarted]);

  /* ───── 计时器 ───── */
  useEffect(() => {
    if (gameOver || !gameStarted) return;
    if (isPausedRef.current) {
      isPausedRef.current = false;
      resumeTimeRef.current = Date.now();
    }
    const id = setInterval(() => {
      if (isPausedRef.current) return;
      setElapsedSeconds(accumulatedRef.current + Math.floor((Date.now() - resumeTimeRef.current) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [gameOver, gameStarted]);

  /* ───── 页面隐藏时暂停计时 ───── */
  useEffect(() => {
    const handleVisibility = () => {
      if (document.hidden) {
        accumulatedRef.current += Math.floor((Date.now() - resumeTimeRef.current) / 1000);
        isPausedRef.current = true;
        setElapsedSeconds(accumulatedRef.current);
      } else {
        resumeTimeRef.current = Date.now();
        isPausedRef.current = false;
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  /* ───── 暗色主题同步 ───── */
  useEffect(() => {
    // hydrate 后从 localStorage 加载主题偏好
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === 'dark') setDarkMode(true);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    document.documentElement.classList.toggle('dark', darkMode);
    localStorage.setItem(THEME_KEY, darkMode ? 'dark' : 'light');
  }, [darkMode]);

  /* ───── 成就持久化 ───── */
  useEffect(() => {
    if (typeof window === 'undefined') return;
    localStorage.setItem(ACHIEVE_KEY, JSON.stringify([...unlockedIds]));
  }, [unlockedIds]);

  /* ───── 历史持久化 ───── */
  useEffect(() => {
    if (typeof window === 'undefined') return;
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 10)));
  }, [history]);

  /* ───── 核心移动 ───── */
  const applyMove = useCallback(
    (direction: Direction) => {
      if (gameOverRef.current) return;

      const prevBoard = boardRef.current;
      const prevScore = scoreRef.current;
      const prevMoveCount = moveCountRef.current;
      const result = moveBoard(prevBoard, direction);

      if (!result.moved) {
        setGameOver(result.gameOver);
        return;
      }

      /* 捕获 FLIP 前位置 */
      const container = boardElRef.current;
      if (container) {
        const tiles = container.querySelectorAll<HTMLElement>('[data-tile-id]');
        const rects = new Map<number, DOMRect>();
        tiles.forEach((t) => {
          const id = Number(t.dataset.tileId);
          if (id) rects.set(id, t.getBoundingClientRect());
        });
        prevTileRectsRef.current = rects;
      }

      /* 保存 undo，清空 redo */
      setUndoStack((prev) => [
        ...prev,
        { board: cloneBoard(prevBoard), score: prevScore, moveCount: prevMoveCount, gameOver: gameOverRef.current, hasWon },
      ]);
      setRedoStack([]);

      /* 更新 */
      isFlippingRef.current = true;
      prevBoardForAnimRef.current = cloneBoard(prevBoard);

      setBoard(result.board);

      const nextScore = prevScore + result.scoreDelta;
      setScore(nextScore);
      setBestScore((prevBest) => {
        const nextBest = Math.max(prevBest, nextScore);
        localStorage.setItem(BEST_SCORE_KEY, String(nextBest));
        return nextBest;
      });

      setGameOver(result.gameOver);
      setHasWon(result.hasWon);
      setLastMove(direction);
      setMoveCount((prev) => prev + 1);

      /* 检测新 tile & 合并 tile（同步，确保首次渲染就带动画） */
      {
        const prevIds = new Set<number>();
        const prevValMap = new Map<number, number>();
        prevBoard.forEach((row) =>
          row.forEach((cell) => { if (cell) { prevIds.add(cell.id); prevValMap.set(cell.id, cell.value); } }),
        );
        const nIds = new Set<number>();
        const mIds = new Set<number>();
        result.board.forEach((row) =>
          row.forEach((cell) => {
            if (!cell) return;
            if (!prevIds.has(cell.id)) nIds.add(cell.id);
            else if ((prevValMap.get(cell.id) ?? 0) < cell.value) mIds.add(cell.id);
          }),
        );
        setNewTileIds(nIds);
        setMergedTileIds(mIds);
      }

      /* 合并飘字 */
      if (result.merges.length > 0) {
        const floats: FloatTextItem[] = result.merges.map((m) => ({
          id: ++_floatId,
          text: `+${m.gained}`,
          row: m.row,
          col: m.col,
        }));
        setFloatTexts((prev) => [...prev, ...floats]);
      }

      /* 触发胜利彩带 & 弹窗（ref 防重复触发） */
      if (result.hasWon && !hasWonRef.current) {
        hasWonRef.current = true;
        setShowConfetti(true);
        setShowVictoryModal(true);
      }

      /* 触觉反馈 —— iOS Safari 不支持 Vibration API，桌面端也静默忽略 */
      if (result.merges.length > 0) {
        if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
          try { navigator.vibrate(15); } catch { /* noop */ }
        } else {
          /* 不支持振动的平台：用视觉抖动代替 */
          setBoardShake(true);
          setTimeout(() => setBoardShake(false), 160);
        }
      }

      /* 更新成就追踪 ref */
      if (result.merges.length > 0) {
        consecutiveMergesRef.current += 1;
      } else {
        consecutiveMergesRef.current = 0;
      }
      let maxTile = 0;
      result.board.forEach((row) => row.forEach((c) => { if (c && c.value > maxTile) maxTile = c.value; }));
      if (maxTile > highestTileRef.current) highestTileRef.current = maxTile;

      const boardFull = !result.board.some((row) => row.some((c) => !c));

      /* 检查成就 */
      const achState: AchievementState = {
        score: nextScore,
        moveCount: prevMoveCount + 1,
        highestTile: highestTileRef.current,
        consecutiveMerges: consecutiveMergesRef.current,
        boardFull,
      };
      const newAchs = evaluateAchievements(achState);
      setUnlockedIds((prev) => {
        const next = new Set(prev);
        let changed = false;
        for (const id of newAchs) {
          if (!next.has(id)) { next.add(id); changed = true; }
        }
        return changed ? next : prev;
      });
      /* 弹窗通知（取第一个新成就） */
      const firstNew = newAchs.find((id) => !unlockedIds.has(id));
      if (firstNew) {
        const def = ACHIEVEMENTS.find((a) => a.id === firstNew)!;
        setAchieveNotify({ def, leaving: false });
      }

      /* 游戏结束记录历史 */
      if (result.gameOver) {
        const record: GameRecord = {
          score: nextScore,
          moves: prevMoveCount + 1,
          time: elapsedSeconds,
          highestTile: highestTileRef.current,
          date: new Date().toISOString().slice(0, 10),
        };
        setHistory((prev) => [record, ...prev].slice(0, 10));
      }
    },
    [hasWon, unlockedIds, elapsedSeconds],
  );

  /* ───── AI Worker（WASM 异步，主线程零阻塞）───── */
  const aiWorkerRef = useRef<Worker | null>(null);
  const aiRunningRef = useRef(false);
  const aiPlayingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      const worker = new Worker(new URL('./ai-worker.ts', import.meta.url));
      // 主线程拿到结果
      worker.onmessage = (e: MessageEvent<{ type: string; direction: 'up' | 'down' | 'left' | 'right' | null }>) => {
        if (e.data.type === 'result' && e.data.direction && aiPlayingRef.current) {
          applyMove(e.data.direction);
        }
        aiRunningRef.current = false;
      };
      // 加载 WASM 二进制发给 Worker
      const wasmRes = await fetch('/wasm-ai/wasm_ai_bg.wasm');
      const wasmBytes = await wasmRes.arrayBuffer();
      worker.postMessage({ type: 'init', wasmBytes }, [wasmBytes]);
      if (!cancelled) aiWorkerRef.current = worker;
    };
    init();
    return () => { cancelled = true; aiWorkerRef.current?.terminate(); };
  }, []);

  aiPlayingRef.current = aiPlaying;

  /* ───── AI 自动演示（Worker 异步）───── */
  useEffect(() => {
    if (!aiPlaying || gameOver || showVictoryModal) {
      aiRunningRef.current = false;
      return;
    }
    const tick = () => {
      if (!aiPlaying || gameOver || showVictoryModal || aiRunningRef.current) return;
      if (!aiWorkerRef.current) return;
      aiRunningRef.current = true;
      const flat: number[] = [];
      const board = boardRef.current;
      for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 4; j++) {
          flat.push(board[i][j]?.value ?? 0);
        }
      }
      aiWorkerRef.current.postMessage({ type: 'search', board: flat });
    };
    tick();
    const id = setInterval(tick, 100);
    return () => clearInterval(id);
  }, [aiPlaying, gameOver, showVictoryModal, applyMove]);

  /* ───── FLIP 动画（仅处理位置滑动）───── */
  useLayoutEffect(() => {
    if (!isFlippingRef.current) return;

    const container = boardElRef.current;
    if (!container) { isFlippingRef.current = false; return; }

    const prevRects = prevTileRectsRef.current;

    /* FLIP */
    const tiles = container.querySelectorAll<HTMLElement>('[data-tile-id]');
    const flips: { el: HTMLElement; dx: number; dy: number }[] = [];

    tiles.forEach((tile) => {
      const id = Number(tile.dataset.tileId);
      if (!id) return;
      const prevRect = prevRects.get(id);
      if (!prevRect) return;
      const newRect = tile.getBoundingClientRect();
      const dx = prevRect.left - newRect.left;
      const dy = prevRect.top - newRect.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
      flips.push({ el: tile, dx, dy });
    });

    flips.forEach(({ el, dx, dy }) => {
      el.style.transform = `translate(${dx}px, ${dy}px)`;
      el.style.transition = 'none';
    });

    requestAnimationFrame(() => {
      flips.forEach(({ el }) => {
        el.style.transition = 'transform 150ms ease-in-out';
        el.style.transform = 'translate(0, 0)';
      });
    });

    isFlippingRef.current = false;
    prevRects.clear();
  }, [board]);

  /* ───── 动画 class 自动清除 ───── */
  useEffect(() => {
    if (newTileIds.size === 0 && mergedTileIds.size === 0) return;
    const timer = setTimeout(() => {
      setNewTileIds(new Set());
      setMergedTileIds(new Set());
    }, 250);
    return () => clearTimeout(timer);
  }, [newTileIds, mergedTileIds]);

  /* ───── 飘字自动移除 ───── */
  useEffect(() => {
    if (floatTexts.length === 0) return;
    const timer = setTimeout(() => setFloatTexts([]), 900);
    return () => clearTimeout(timer);
  }, [floatTexts]);

  /* ───── 彩带自动消失 ───── */
  useEffect(() => {
    if (!showConfetti) return;
    const timer = setTimeout(() => setShowConfetti(false), 4500);
    return () => clearTimeout(timer);
  }, [showConfetti]);

  /* ───── 键盘 ───── */
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!gameStarted) return;
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        handleRedo();
        return;
      }
      const keyMap: Record<string, Direction> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
      const direction = keyMap[e.key];
      if (!direction) return;
      e.preventDefault();
      setAiPlaying(false);
      applyMove(direction);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [applyMove, gameStarted]);

  /* ───── 触屏 ───── */
  useEffect(() => {
    if (!gameStarted) return;
    const el = boardElRef.current;
    if (!el) return;

    const handleStart = (e: TouchEvent) => {
      touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    };
    const handleMove = (e: TouchEvent) => e.preventDefault();
    const handleEnd = (e: TouchEvent) => {
      const start = touchStartRef.current;
      if (!start) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      touchStartRef.current = null;
      if (Math.abs(dx) < SWIPE_MIN_DISTANCE && Math.abs(dy) < SWIPE_MIN_DISTANCE) return;
      setAiPlaying(false);
      applyMove(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
    };

    el.addEventListener('touchstart', handleStart, { passive: true });
    el.addEventListener('touchmove', handleMove, { passive: false });
    el.addEventListener('touchend', handleEnd, { passive: true });
    return () => {
      el.removeEventListener('touchstart', handleStart);
      el.removeEventListener('touchmove', handleMove);
      el.removeEventListener('touchend', handleEnd);
    };
  }, [applyMove, gameStarted]);

  /* ───── 陀螺仪 ───── */
  useEffect(() => {
    if (!motionEnabled) return;

    const handleMotion = (e: DeviceMotionEvent) => {
      if (gameOverRef.current) return;
      const rr = e.rotationRate;
      if (!rr || rr.alpha === null || rr.beta === null || rr.gamma === null) return;

      const { alpha, beta } = rr;

      if (showDebug && !debugTimerRef.current) {
        setDebugData({ alpha: Math.round(alpha * 10) / 10, beta: Math.round(beta * 10) / 10, gamma: Math.round(rr.gamma * 10) / 10 });
        debugTimerRef.current = setTimeout(() => { debugTimerRef.current = null; }, DEBUG_RENDER_INTERVAL_MS);
      }

      const now = Date.now();
      if (now - motionCooldownRef.current < MOTION_COOLDOWN_MS) return;

      if (motionLockRef.current) {
        if (Math.abs(alpha) < MOTION_UNLOCK_THRESHOLD && Math.abs(beta) < MOTION_UNLOCK_THRESHOLD) motionLockRef.current = false;
        return;
      }

      let direction: Direction | null = null;
      if (Math.abs(beta) > Math.abs(alpha)) {
        if (beta > GYRO_THRESHOLD) direction = 'right';
        else if (beta < -GYRO_THRESHOLD) direction = 'left';
      } else {
        if (alpha > GYRO_THRESHOLD) direction = 'down';
        else if (alpha < -GYRO_THRESHOLD) direction = 'up';
      }

      if (direction) {
        motionLockRef.current = true;
        motionCooldownRef.current = now;
        setAiPlaying(false);
        applyMove(direction);
      }
    };

    window.addEventListener('devicemotion', handleMotion);
    return () => window.removeEventListener('devicemotion', handleMotion);
  }, [motionEnabled, applyMove, showDebug]);

  /* ───── 陀螺仪权限 ───── */
  const requestMotionPermission = async () => {
    if (
      typeof DeviceMotionEvent !== 'undefined' &&
      typeof (DeviceMotionEvent as any).requestPermission === 'function'
    ) {
      try {
        const p = await (DeviceMotionEvent as any).requestPermission();
        if (p === 'granted') setMotionEnabled(true);
      } catch { console.error('权限请求失败'); }
      return;
    }
    setMotionEnabled(true);
  };

  /* ───── 撤销 ───── */
  const handleUndo = useCallback(() => {
    if (!canUndo) return;
    setRedoStack((prev) => [
      ...prev,
      { board: cloneBoard(boardRef.current), score: scoreRef.current, moveCount: moveCountRef.current, gameOver: gameOverRef.current, hasWon },
    ]);
    setUndoStack((prev) => {
      const next = [...prev];
      const last = next.pop();
      if (!last) return prev;
      setBoard(last.board);
      setScore(last.score);
      setMoveCount(last.moveCount);
      setGameOver(last.gameOver);
      setHasWon(last.hasWon);
      setLastMove('');
      motionLockRef.current = false;
      touchStartRef.current = null;
      setShowConfetti(false);
      return next;
    });
  }, [canUndo, hasWon]);

  /* ───── 重做 ───── */
  const handleRedo = useCallback(() => {
    if (!canRedo) return;
    setUndoStack((prev) => [
      ...prev,
      { board: cloneBoard(boardRef.current), score: scoreRef.current, moveCount: moveCountRef.current, gameOver: gameOverRef.current, hasWon },
    ]);
    setRedoStack((prev) => {
      const next = [...prev];
      const last = next.pop();
      if (!last) return prev;
      setBoard(last.board);
      setScore(last.score);
      setMoveCount(last.moveCount);
      setGameOver(last.gameOver);
      setHasWon(last.hasWon);
      setLastMove('');
      motionLockRef.current = false;
      touchStartRef.current = null;
      return next;
    });
  }, [canRedo, hasWon]);

  /* ───── 开始游戏 ───── */
  const startGame = () => {
    setGameStarted(true);
    resumeTimeRef.current = Date.now();
    isPausedRef.current = false;
  };

  /* ───── 重新开始 ───── */
  const restart = () => {
    resetTileIdCounter();
    clearSave();
    setBoard(createInitialBoard());
    setScore(0);
    setMoveCount(0);
    setGameOver(false);
    setHasWon(false);
    hasWonRef.current = false;
    setLastMove('');
    setUndoStack([]);
    setRedoStack([]);
    setFloatTexts([]);
    setShowConfetti(false);
    setNewTileIds(new Set());
    setMergedTileIds(new Set());
    motionLockRef.current = false;
    touchStartRef.current = null;
    accumulatedRef.current = 0;
    resumeTimeRef.current = Date.now();
    setElapsedSeconds(0);
    highestTileRef.current = 0;
    consecutiveMergesRef.current = 0;
    setAchieveNotify(null);
    setShowShare(false);
    setShowVictoryModal(false);
    setAiPlaying(false);
    setGameStarted(true);
  };

  const moveLabel = useMemo(() => {
    if (!lastMove) return '';
    return { up: '↑', down: '↓', left: '←', right: '→' }[lastMove];
  }, [lastMove]);

  /* 棋盘容器尺寸（用于飘字定位） */
  const [boardSize, setBoardSize] = useState(0);
  useEffect(() => {
    const el = boardElRef.current;
    if (!el) return;
    const obs = new ResizeObserver(() => setBoardSize(el.offsetWidth));
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  const cellSize = boardSize / 4;

  return (
    <main className={`min-h-screen flex items-center justify-center p-4 ${darkMode ? 'dark-bg' : 'bg-gradient-to-br from-amber-50 via-orange-50 to-yellow-100'}`}>
      {/* 胜利彩带 */}
      {showConfetti && <Confetti />}

      {/* 胜利弹窗 */}
      {showVictoryModal && (
        <VictoryModal
          score={score}
          moves={moveCount}
          time={formatTime(elapsedSeconds)}
          darkMode={darkMode}
          onContinue={() => setShowVictoryModal(false)}
          onRestart={restart}
        />
      )}

      <div className="w-full max-w-md space-y-2">
        <header className="text-center">
          <div className="flex items-center justify-center gap-3">
            <h1 className="text-3xl font-bold dark-text" style={darkMode ? {color:'#e0e0e0'} : {color:'#292524'}}>2048</h1>
            <button
              onClick={() => setDarkMode((v) => !v)}
              className="text-xl p-1 rounded-lg hover:bg-stone-200 dark:hover:bg-stone-700 transition"
              title={darkMode ? '切换亮色' : '切换暗色'}
            >
              {darkMode ? '◑' : '◐'}
            </button>
          </div>
        </header>

        {/* 未开始遮罩 —— 仅在客户端就绪后渲染，避免 hydration mismatch */}
        {hydrated && !gameStarted && (
          <StartScreen darkMode={darkMode} onStart={startGame} />
        )}

        <section className={`rounded-[2rem] shadow-sm p-3 space-y-2.5 border border-white/20 ${darkMode ? 'dark-card backdrop-blur-xl' : 'bg-white/70 backdrop-blur-xl'}`}>
          {/* 分数 & 统计 */}
          <div className="grid grid-cols-4 gap-1.5">
            <div className={`rounded-xl p-1.5 text-center ${darkMode ? 'dark-stat' : 'bg-white/60 backdrop-blur-sm shadow-sm'}`}>
              <div className={`text-[9px] uppercase tracking-wide font-medium ${darkMode ? 'dark-muted' : 'text-stone-400'}`}>Score</div>
              <div className="text-lg font-extrabold tracking-tighter">{score}</div>
            </div>
            <div className={`rounded-xl p-1.5 text-center ${darkMode ? 'dark-stat' : 'bg-white/60 backdrop-blur-sm shadow-sm'}`}>
              <div className={`text-[9px] uppercase tracking-wide font-medium ${darkMode ? 'dark-muted' : 'text-stone-400'}`}>Best</div>
              <div className="text-lg font-extrabold tracking-tighter">{bestScore}</div>
            </div>
            <div className={`rounded-xl p-1.5 text-center ${darkMode ? 'dark-stat' : 'bg-white/60 backdrop-blur-sm shadow-sm'}`}>
              <div className={`text-[9px] uppercase tracking-wide font-medium ${darkMode ? 'dark-muted' : 'text-stone-400'}`}>步数</div>
              <div className="text-lg font-extrabold tracking-tighter">{moveCount}</div>
            </div>
            <div className={`rounded-xl p-1.5 text-center ${darkMode ? 'dark-stat' : 'bg-white/60 backdrop-blur-sm shadow-sm'}`}>
              <div className={`text-[9px] uppercase tracking-wide font-medium ${darkMode ? 'dark-muted' : 'text-stone-400'}`}>时间</div>
              <div className="text-lg font-extrabold tracking-tighter">{formatTime(elapsedSeconds)}</div>
            </div>
          </div>

          {/* 按钮区 - 主操作 */}
          <div className="grid grid-cols-3 gap-1.5">
            <button onClick={restart} className="rounded-full bg-[#007AFF] px-2 py-1.5 text-white font-medium text-xs transition hover:bg-[#0066D6] active:scale-[0.97]">
              重新开始
            </button>
            <button
              onClick={handleUndo}
              disabled={!canUndo}
              className={`rounded-full px-2 py-1.5 font-medium text-xs transition active:scale-[0.97] ${
                canUndo ? 'bg-[#007AFF]/10 text-[#007AFF] hover:bg-[#007AFF]/20' : `bg-stone-200 text-stone-400 cursor-not-allowed ${darkMode ? '!bg-[#2C2C2E] !text-[#636366]' : ''}`
              }`}
            >
              撤销
            </button>
            <button
              onClick={handleRedo}
              disabled={!canRedo}
              className={`rounded-full px-2 py-1.5 font-medium text-xs transition active:scale-[0.97] ${
                canRedo ? 'bg-[#007AFF]/10 text-[#007AFF] hover:bg-[#007AFF]/20' : `bg-stone-200 text-stone-400 cursor-not-allowed ${darkMode ? '!bg-[#2C2C2E] !text-[#636366]' : ''}`
              }`}
            >
              重做
            </button>
          </div>

          {/* 按钮区 - 工具 */}
          <div className="grid grid-cols-3 gap-1.5">
            <button
              onClick={() => setShowHistory((v) => !v)}
              className="rounded-full bg-[#8E8E93] px-2 py-1.5 text-white font-medium text-xs transition hover:bg-[#7A7A80] active:scale-[0.97]"
            >
              战绩
            </button>
            <button
              onClick={() => setAiPlaying((v) => !v)}
              className={`rounded-full px-2 py-1.5 text-white font-medium text-xs transition active:scale-[0.97] ${aiPlaying ? 'bg-[#FF3B30] hover:bg-[#E0352B]' : 'bg-[#AF52DE] hover:bg-[#9B3EC8]'}`}
            >
              {aiPlaying ? '停止' : 'AI 自动'}
            </button>
            {motionEnabled ? (
              <button onClick={() => setMotionEnabled(false)} className="rounded-full bg-[#FF3B30] px-2 py-1.5 text-white font-medium text-xs transition hover:bg-[#E0352B] active:scale-[0.97]">
                关晃动
              </button>
            ) : (
              <button onClick={requestMotionPermission} className="rounded-full bg-[#34C759] px-2 py-1.5 text-white font-medium text-xs transition hover:bg-[#2DB04E] active:scale-[0.97]">
                开晃动
              </button>
            )}
          </div>

          {motionEnabled && (
            <div className="rounded-2xl bg-emerald-50/70 backdrop-blur-sm border border-emerald-200/50 px-4 py-2 text-xs text-emerald-700 text-center">
              晃动控制已启用 - 左右倾斜控制左右，前后倾斜控制上下
            </div>
          )}

          {moveLabel && (
            <div className={`text-center text-xs ${darkMode ? 'dark-muted' : 'text-stone-500'}`}>上次移动：{moveLabel}</div>
          )}

          {/* 提示：始终显示方向建议 */}
          <div className={`text-center text-xs ${darkMode ? 'dark-muted' : 'text-stone-500'}`}>
            {gameOver ? (
              '游戏结束'
            ) : aiPlaying ? (
              'AI 自动演示中… 按任意方向键/滑动屏幕可接管'
            ) : (
              <>
                推荐方向：<span className="hint-arrow inline-block font-bold text-amber-500">{hint === 'up' ? '↑' : hint === 'down' ? '↓' : hint === 'left' ? '←' : '→'}</span>
                {' · '}Ctrl+Z 撤销 · Ctrl+Y 重做
              </>
            )}
          </div>

          {/* 棋盘 */}
          <div ref={boardElRef} className={`rounded-2xl p-2.5 touch-none select-none relative ${boardShake ? 'board-shake' : ''} ${darkMode ? 'dark-board' : 'bg-stone-300/60 backdrop-blur-sm'}`}>
            <div className="grid grid-cols-4 gap-1.5">
              {board.map((row, i) =>
                row.map((cell, j) => (
                  <TileCellView
                    key={cell ? cell.id : `empty-${i}-${j}`}
                    cell={cell}
                    newIds={newTileIds}
                    mergedIds={mergedTileIds}
                  />
                )),
              )}
            </div>

            {/* 合并飘字 */}
            {floatTexts.map((ft) => (
              <div
                key={ft.id}
                className="merge-float absolute font-extrabold text-amber-600 text-lg z-10"
                style={{
                  left: ft.col * cellSize + cellSize / 2,
                  top: ft.row * cellSize + cellSize / 2,
                  transform: 'translate(-50%, -50%)',
                }}
              >
                {ft.text}
              </div>
            ))}
          </div>

          {hasWon && !gameOver && !showVictoryModal && (
            <div className="rounded-xl bg-yellow-50/70 backdrop-blur-md border border-yellow-200/50 px-3 py-2 text-center text-yellow-800 font-semibold text-sm">
              已合出 2048，还能继续冲更高分。
            </div>
          )}

          {showDebug && motionEnabled && (
            <div className="rounded-xl bg-stone-100 p-3 text-xs font-mono text-stone-700">
              <div className="grid grid-cols-3 gap-2">
                <div>α: {debugData.alpha}°/s</div>
                <div>β: {debugData.beta}°/s</div>
                <div>γ: {debugData.gamma}°/s</div>
              </div>
              <div className="text-center text-blue-600 mt-1">α=前后倾斜(上下) β=左右倾斜(左右)</div>
            </div>
          )}
        </section>

        {/* 游戏结束弹窗 */}
        {gameOver && (
          <GameOverModal
            score={score}
            moves={moveCount}
            time={formatTime(elapsedSeconds)}
            highestTile={highestTileRef.current}
            darkMode={darkMode}
            onRestart={restart}
            onShare={() => setShowShare(true)}
          />
        )}

        {/* 成就弹窗 */}
        {achieveNotify && (
          <AchievementToast notify={achieveNotify} onDone={dismissAchieve} />
        )}

        {/* 历史面板 */}
        {showHistory && (
          <HistoryPanel
            records={history}
            darkMode={darkMode}
            onClose={() => setShowHistory(false)}
            onShare={() => { setShowShare(true); setShowHistory(false); }}
          />
        )}

        {/* 分享卡片 */}
        {showShare && (
          <ShareCard
            score={score}
            moves={moveCount}
            time={formatTime(elapsedSeconds)}
            highestTile={highestTileRef.current}
            darkMode={darkMode}
            onClose={() => setShowShare(false)}
          />
        )}
      </div>
    </main>
  );
}

/* ───── 游戏结束弹窗 ───── */
/* ───── 胜利弹窗 ───── */
function VictoryModal({ score, moves, time, darkMode, onContinue, onRestart }: { score: number; moves: number; time: string; darkMode: boolean; onContinue: () => void; onRestart: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" />
      <div className={`relative w-full max-w-xs rounded-3xl p-6 shadow-2xl text-center space-y-5 border border-yellow-300/50 ${darkMode ? 'dark-card backdrop-blur-xl' : 'bg-white/90 backdrop-blur-xl'}`}>
        <div className="text-5xl">🎉</div>
        <div className="space-y-2">
          <h2 className={`text-2xl font-extrabold ${darkMode ? 'text-yellow-300' : 'text-yellow-600'}`}>达到 2048！</h2>
          <p className={`text-sm ${darkMode ? 'dark-muted' : 'text-stone-500'}`}>
            {score.toLocaleString()} 分 · {moves} 步 · {time}
          </p>
        </div>
        <div className="space-y-2.5">
          <button
            onClick={onContinue}
            className="w-full rounded-full bg-[#007AFF] px-6 py-3 text-white font-bold text-base transition hover:bg-[#0066D6] active:scale-[0.97] shadow-lg shadow-[#007AFF]/30"
          >
            继续游戏
          </button>
          <button
            onClick={onRestart}
            className={`w-full rounded-full px-6 py-2.5 font-medium text-sm transition active:scale-[0.97] ${darkMode ? 'bg-stone-700 text-stone-300 hover:bg-stone-600' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'}`}
          >
            重新开始
          </button>
        </div>
      </div>
    </div>
  );
}

function GameOverModal({ score, moves, time, highestTile, darkMode, onRestart, onShare }: { score: number; moves: number; time: string; highestTile: number; darkMode: boolean; onRestart: () => void; onShare: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" />
      <div className={`relative w-full max-w-xs rounded-3xl p-6 shadow-2xl text-center space-y-5 border border-white/20 ${darkMode ? 'dark-card backdrop-blur-xl' : 'bg-white/80 backdrop-blur-xl'}`}>
        <div className={`text-5xl font-black ${darkMode ? 'text-red-400' : 'text-red-500'}`}>Game Over</div>
        <div className={`inline-block rounded-2xl px-6 py-2 text-3xl font-black tracking-tighter ${darkMode ? 'dark-stat' : 'bg-stone-100'} ${darkMode ? 'dark-text' : 'text-stone-800'}`}>
          {score.toLocaleString()}
        </div>
        <div className={`grid grid-cols-3 gap-2 text-xs ${darkMode ? 'dark-muted' : 'text-stone-500'}`}>
          <div className={`rounded-xl p-2 ${darkMode ? 'dark-stat' : 'bg-white/60'}`}>
            <div className="opacity-60">步数</div>
            <div className="font-bold">{moves}</div>
          </div>
          <div className={`rounded-xl p-2 ${darkMode ? 'dark-stat' : 'bg-white/60'}`}>
            <div className="opacity-60">用时</div>
            <div className="font-bold">{time}</div>
          </div>
          <div className={`rounded-xl p-2 ${darkMode ? 'dark-stat' : 'bg-white/60'}`}>
            <div className="opacity-60">最高</div>
            <div className="font-bold">{highestTile}</div>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={onRestart} className="flex-1 rounded-full bg-[#007AFF] px-4 py-2.5 text-white font-medium text-sm transition hover:bg-[#0066D6] active:scale-[0.97]">
            再来一局
          </button>
          <button onClick={onShare} className="rounded-full bg-[#8E8E93] px-4 py-2.5 text-white font-medium text-sm transition hover:bg-[#7A7A80] active:scale-[0.97]">
            分享
          </button>
        </div>
      </div>
    </div>
  );
}

/* ───── 开始画面 ───── */
function StartScreen({ darkMode, onStart }: { darkMode: boolean; onStart: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" />
      <div className={`relative w-full max-w-xs rounded-3xl p-8 shadow-2xl text-center space-y-6 border border-white/20 ${darkMode ? 'dark-card backdrop-blur-xl' : 'bg-white/90 backdrop-blur-xl'}`}>
        <div className="space-y-2">
          <div className={`text-5xl font-black tracking-tighter ${darkMode ? 'text-amber-400' : 'text-amber-600'}`}>2048</div>
          <p className={`text-sm ${darkMode ? 'dark-muted' : 'text-stone-500'}`}>
            使用 ←↑↓→ 方向键或滑动屏幕
            <br />
            合并相同数字，达到 2048！
          </p>
        </div>
        <button
          onClick={onStart}
          className="w-full rounded-full bg-[#007AFF] px-6 py-3.5 text-white font-bold text-lg transition hover:bg-[#0066D6] active:scale-[0.97] shadow-lg shadow-[#007AFF]/30"
        >
          开始游戏
        </button>
        <p className={`text-xs ${darkMode ? 'dark-muted' : 'text-stone-400'}`}>
          Ctrl+Z 撤销 · Ctrl+Y 重做
        </p>
      </div>
    </div>
  );
}

/* ───── Tile 子组件 ───── */
function TileCellView({ cell, newIds, mergedIds }: { cell: TileCell; newIds: Set<number>; mergedIds: Set<number> }) {
  const animClass = cell ? tileAnimClass(cell.id, newIds, mergedIds) : '';
  const value = cell?.value ?? null;
  return (
    <div
      data-tile-id={cell?.id ?? ''}
      data-tile-color={value ?? ''}
      data-tile-empty={!cell ? 'true' : undefined}
      className={`aspect-square rounded-2xl flex items-center justify-center font-bold text-xl sm:text-2xl select-none
        ${getTileColor(value)}
        ${!cell ? 'text-transparent' : ''}
        ${animClass}
      `}
    >
      {cell?.value ?? ''}
    </div>
  );
}

/* ───── 彩带组件 ───── */
function Confetti() {
  const colors = ['#f44336', '#e91e63', '#9c27b0', '#673ab7', '#3f51b5', '#2196f3', '#00bcd4', '#009688', '#4caf50', '#ffeb3b', '#ff9800', '#ff5722'];
  const pieces = useMemo(() => {
    return Array.from({ length: 60 }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      color: colors[Math.floor(Math.random() * colors.length)],
      delay: Math.random() * 1.5,
      fallDur: 2.5 + Math.random() * 2.5,
      swayDur: 1.5 + Math.random() * 1.5,
      size: 6 + Math.random() * 8,
    }));
  }, []);

  return (
    <div className="fixed inset-0 pointer-events-none z-50" aria-hidden>
      {pieces.map((p) => (
        <div
          key={p.id}
          className="confetti-piece"
          style={{
            left: `${p.left}%`,
            background: p.color,
            width: p.size,
            height: p.size * 1.6,
            animationDelay: `${p.delay}s`,
            '--fall-dur': `${p.fallDur}s`,
            '--sway-dur': `${p.swayDur}s`,
          } as React.CSSProperties}
        />
      ))}
    </div>
  );
}

/* ───── 成就弹窗 ───── */
function AchievementToast({ notify, onDone }: { notify: AchieveNotify; onDone: () => void }) {
  useEffect(() => {
    if (notify.leaving) {
      const t = setTimeout(onDone, 300);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => onDone(), 2500);
    return () => clearTimeout(t);
  }, [notify, onDone]);

  return (
    <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-2xl shadow-2xl bg-yellow-400/90 backdrop-blur-md border border-yellow-300/50 text-stone-900 font-bold flex items-center gap-3 text-sm ${notify.leaving ? 'achieve-leave' : 'achieve-enter'}`}>
      <div>
        <div className="text-xs opacity-70">成就解锁</div>
        <div>{notify.def.title}</div>
        <div className="text-xs opacity-70">{notify.def.desc}</div>
      </div>
    </div>
  );
}

/* ───── 历史面板 ───── */
function HistoryPanel({ records, darkMode, onClose, onShare }: { records: GameRecord[]; darkMode: boolean; onClose: () => void; onShare: () => void }) {
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center" onClick={onClose}>
      <div className="fixed inset-0 bg-black/30 backdrop-blur-sm" />
      <div
        className={`relative w-full max-w-md rounded-t-3xl p-5 pb-8 history-panel-enter max-h-[60vh] overflow-y-auto border border-white/20 ${darkMode ? 'dark-card backdrop-blur-xl' : 'bg-white/80 backdrop-blur-xl'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className={`text-lg font-bold ${darkMode ? 'dark-text' : 'text-stone-800'}`}>历史记录</h2>
          <button onClick={onClose} className={`text-xl ${darkMode ? 'dark-muted' : 'text-stone-400'}`}>✕</button>
        </div>
        {records.length === 0 ? (
          <p className={`text-center py-6 ${darkMode ? 'dark-muted' : 'text-stone-500'}`}>暂无记录，开始玩吧！</p>
        ) : (
          <div className="space-y-2">
            {[...records].sort((a, b) => b.score - a.score).map((r, i) => (
              <div key={i} className={`flex items-center justify-between rounded-2xl p-3 ${darkMode ? 'dark-stat' : 'bg-stone-50/70 backdrop-blur-sm'}`}>
                <div className="flex items-center gap-3">
                  <span className={`text-lg font-bold w-8 ${i === 0 ? 'text-amber-500' : darkMode ? 'dark-muted' : 'text-stone-400'}`}>
                    {i === 0 ? '1st' : i === 1 ? '2nd' : i === 2 ? '3rd' : `#${i + 1}`}
                  </span>
                  <div>
                    <div className={`font-bold ${darkMode ? 'dark-text' : 'text-stone-800'}`}>{r.score.toLocaleString()} 分</div>
                    <div className={`text-xs ${darkMode ? 'dark-muted' : 'text-stone-500'}`}>
                      {r.moves}步 · {formatTime(r.time)} · 最高 {r.highestTile} · {r.date}
                    </div>
                  </div>
                </div>
              </div>
            ))}
            <button
              onClick={onShare}
              className="w-full rounded-full bg-[#007AFF] px-4 py-2.5 text-white font-medium text-sm transition hover:bg-[#0066D6] active:scale-[0.97]"
            >
              分享战绩
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ───── 分享卡片 ───── */
function ShareCard({ score, moves, time, highestTile, darkMode, onClose }: { score: number; moves: number; time: string; highestTile: number; darkMode: boolean; onClose: () => void }) {
  const handleCopy = async () => {
    const text = `2048 战绩\n得分：${score.toLocaleString()}\n步数：${moves}\n用时：${time}\n最高方块：${highestTile}\n${new Date().toISOString().slice(0, 10)}\n来挑战我吧！`;
    try {
      await navigator.clipboard.writeText(text);
      alert('已复制到剪贴板！');
    } catch {
      prompt('复制以下文字分享：', text);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" />
      <div
        className={`relative w-full max-w-sm rounded-3xl p-6 shadow-2xl text-center space-y-4 border border-white/20 ${darkMode ? 'dark-card backdrop-blur-xl' : 'bg-white/80 backdrop-blur-xl'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <button onClick={onClose} className={`absolute top-3 right-4 text-xl ${darkMode ? 'dark-muted' : 'text-stone-400'}`}>✕</button>
        
        <h2 className={`text-2xl font-extrabold ${darkMode ? 'dark-text' : 'text-stone-800'}`}>2048 战绩</h2>
        <div className={`inline-block rounded-2xl px-6 py-2 text-3xl font-black tracking-tighter ${darkMode ? 'dark-stat' : 'bg-amber-100/70 backdrop-blur-sm'} text-amber-600`}>
          {score.toLocaleString()}
        </div>
        <div className={`grid grid-cols-3 gap-2 text-sm ${darkMode ? 'dark-muted' : 'text-stone-600'}`}>
          <div className={`rounded-2xl p-2.5 ${darkMode ? 'dark-stat' : 'bg-white/60 backdrop-blur-sm'}`}>
            <div className="text-xs opacity-70">步数</div>
            <div className="font-bold">{moves}</div>
          </div>
          <div className={`rounded-2xl p-2.5 ${darkMode ? 'dark-stat' : 'bg-white/60 backdrop-blur-sm'}`}>
            <div className="text-xs opacity-70">用时</div>
            <div className="font-bold">{time}</div>
          </div>
          <div className={`rounded-2xl p-2.5 ${darkMode ? 'dark-stat' : 'bg-white/60 backdrop-blur-sm'}`}>
            <div className="text-xs opacity-70">最高</div>
            <div className="font-bold">{highestTile}</div>
          </div>
        </div>
        <button
          onClick={handleCopy}
          className="w-full rounded-full bg-[#007AFF] px-4 py-3 text-white font-medium transition hover:bg-[#0066D6] active:scale-[0.97]"
        >
          复制战绩
        </button>
      </div>
    </div>
  );
}
