// AI Worker — 在独立线程运行 expectimax 搜索，主线程不阻塞
import { Board, Direction, cloneBoard, moveBoard } from '../lib/game2048';

// ─── 配置（与 hint.ts 保持一致）─────────────────────────────────
const CORNER = 'bottom-left' as const;

const SNAKE_WEIGHTS: number[][] = (() => {
  const base = [
    [15, 14, 13, 12],
    [8,  9,  10, 11],
    [7,  6,  5,  4],
    [0,  1,  2,  3],
  ];
  return CORNER === 'bottom-left' ? [...base].reverse() : base;
})();

const CORNER_CELL: [number, number] = [
  CORNER === 'bottom-left' ? 3 : 0,
  0,
];

// ─── 评估函数 ────────────────────────────────────────────────────
function evaluate(board: Board): number {
  let emptyCells = 0;
  let maxTile = 0;
  let snakeScore = 0;
  let monotonicityL = 0;
  let monotonicityR = 0;
  let smoothness = 0;

  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      const cell = board[i][j];
      if (!cell) { emptyCells++; continue; }
      const v = cell.value;
      if (v > maxTile) maxTile = v;
      snakeScore += v * SNAKE_WEIGHTS[i][j];
      if (j < 3 && board[i][j + 1]) smoothness -= Math.abs(v - board[i][j + 1]!.value);
      if (i < 3 && board[i + 1][j]) smoothness -= Math.abs(v - board[i + 1][j]!.value);
    }
  }

  for (let i = 0; i < 4; i++) {
    let inc = 0, dec = 0;
    for (let j = 0; j < 3; j++) {
      const a = board[i][j]?.value ?? 0;
      const b = board[i][j + 1]?.value ?? 0;
      if (a >= b) dec += (a - b);
      if (a <= b) inc += (b - a);
    }
    monotonicityL += Math.max(inc, dec);
  }
  for (let j = 0; j < 4; j++) {
    let inc = 0, dec = 0;
    for (let i = 0; i < 3; i++) {
      const a = board[i][j]?.value ?? 0;
      const b = board[i + 1][j]?.value ?? 0;
      if (a >= b) dec += (a - b);
      if (a <= b) inc += (b - a);
    }
    monotonicityR += Math.max(inc, dec);
  }

  let cornerBonus = 0;
  const [cr, cc] = CORNER_CELL;
  if (board[cr][cc] && board[cr][cc]!.value === maxTile) {
    cornerBonus = maxTile * 2;
  }

  const emptyWeight = emptyCells <= 3 ? 350 : 270;

  return (
    snakeScore * 0.8 +
    monotonicityL * 1.0 +
    monotonicityR * 1.0 +
    smoothness * 0.15 +
    cornerBonus * 0.5 +
    emptyCells * emptyWeight +
    Math.log2(maxTile + 1) * 60
  );
}

// ─── Expectimax 搜索 ──────────────────────────────────────────────

function getEmptyCells(board: Board): [number, number][] {
  const cells: [number, number][] = [];
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      if (!board[i][j]) cells.push([i, j]);
    }
  }
  return cells;
}

function adaptiveDepth(emptyCount: number): number {
  if (emptyCount >= 10) return 3;
  if (emptyCount >= 8)  return 4;
  if (emptyCount >= 6)  return 5;
  if (emptyCount >= 4)  return 6;
  if (emptyCount >= 2)  return 7;
  return 8;
}

let stopRequested = false;

function expectimax(
  board: Board,
  depth: number,
  isPlayer: boolean,
  alpha: number,
  beta: number,
): number {
  if (stopRequested) return evaluate(board);
  if (depth === 0) return evaluate(board);

  if (isPlayer) {
    let bestScore = -Infinity;
    const dirs: Direction[] = ['up', 'down', 'left', 'right'];
    for (const d of dirs) {
      if (stopRequested) break;
      const r = moveBoard(board, d);
      if (!r.moved) continue;
      const score = expectimax(r.board, depth - 1, false, alpha, beta);
      if (score > bestScore) bestScore = score;
      if (score > alpha) alpha = score;
      if (alpha >= beta) break;
    }
    return bestScore === -Infinity ? -1e9 : bestScore;
  } else {
    const empty = getEmptyCells(board);
    if (empty.length === 0) return evaluate(board);

    let sampleSize: number;
    if (depth >= 7)       sampleSize = Math.min(empty.length, 4);
    else if (depth >= 5)  sampleSize = Math.min(empty.length, 5);
    else if (depth >= 3)  sampleSize = Math.min(empty.length, 7);
    else                  sampleSize = empty.length;

    let totalScore = 0;

    for (let k = 0; k < sampleSize; k++) {
      if (stopRequested) break;
      const [r, c] = empty[k];
      const b2 = cloneBoard(board);
      b2[r][c] = { id: 0, value: 2 };
      totalScore += expectimax(b2, depth - 1, true, alpha, beta) * 0.9;

      const b4 = cloneBoard(board);
      b4[r][c] = { id: 0, value: 4 };
      totalScore += expectimax(b4, depth - 1, true, alpha, beta) * 0.1;
    }

    if (sampleSize < empty.length) {
      totalScore = totalScore * empty.length / sampleSize;
    }
    return totalScore / empty.length;
  }
}

// ─── Worker 消息处理 ──────────────────────────────────────────────

interface WorkerRequest {
  type: 'search';
  board: Board;
  timeLimit?: number;
}

interface WorkerResponse {
  type: 'result';
  direction: Direction | null;
  elapsed: number;
}

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const { type, board, timeLimit = 60000 } = e.data;

  if (type === 'search') {
    stopRequested = false;
    const startTime = performance.now();

    // 限时兜底：超时后中断
    const timeoutMs = timeLimit;
    const deadline = startTime + timeoutMs;

    const dirs: Direction[] = ['up', 'down', 'left', 'right'];
    const emptyCount = getEmptyCells(board).length;
    const depth = adaptiveDepth(emptyCount);

    let bestDir: Direction | null = null;
    let bestScore = -Infinity;

    // 可中断的搜索循环
    for (const d of dirs) {
      if (stopRequested || performance.now() > deadline) break;

      const r = moveBoard(board, d);
      if (!r.moved) continue;
      const score = expectimax(r.board, depth, false, -Infinity, Infinity);
      if (score > bestScore) {
        bestScore = score;
        bestDir = d;
      }
    }

    const elapsed = performance.now() - startTime;
    const response: WorkerResponse = {
      type: 'result',
      direction: bestDir,
      elapsed: Math.round(elapsed),
    };
    self.postMessage(response);
  }
};
