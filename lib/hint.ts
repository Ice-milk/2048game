import { Board, Direction, cloneBoard, moveBoard } from './game2048';

// ─── Expectimax AI v3 — 自适应深度 3-8，残局深入搜索 ───────────────

/** 自适应深度上限 */
const MAX_DEPTH = 8;

/**
 * 角落偏好：'bottom-left' | 'top-left'
 * 两种模式数学对称，成功率理论上相同
 */
const CORNER = 'bottom-left' as const;

/** 蛇形权重矩阵（根据 CORNER 自动生成） */
const SNAKE_WEIGHTS: number[][] = (() => {
  // 标准左上蛇形：沿行蜿蜒，权重从 15 递减到 0
  const base = [
    [15, 14, 13, 12],
    [8,  9,  10, 11],
    [7,  6,  5,  4],
    [0,  1,  2,  3],
  ];
  // top-left 原样返回，bottom-left 垂直翻转
  return CORNER === 'bottom-left' ? [...base].reverse() : base;
})();

/** 角落检测坐标：对应 CORNER 配置 */
const CORNER_CELL: [number, number] = [CORNER === 'bottom-left' ? 3 : 0, 0];

const BOARD_SIZE = 4;

// ─── 评估函数 ────────────────────────────────────────────────────────

function evaluate(board: Board): number {
  let emptyCells = 0;
  let maxTile = 0;
  let snakeScore = 0;
  let monotonicityL = 0;
  let monotonicityR = 0;
  let smoothness = 0;
  let clusterPenalty = 0;

  for (let i = 0; i < BOARD_SIZE; i++) {
    for (let j = 0; j < BOARD_SIZE; j++) {
      const cell = board[i][j];
      if (!cell) { emptyCells++; continue; }
      const v = cell.value;
      if (v > maxTile) maxTile = v;

      // 蛇形权重
      snakeScore += v * SNAKE_WEIGHTS[i][j];

      // 平滑度：相邻 tile 值越接近越好
      if (j < 3 && board[i][j + 1]) {
        const diff = Math.abs(v - board[i][j + 1]!.value);
        smoothness -= diff;
      }
      if (i < 3 && board[i + 1][j]) {
        const diff = Math.abs(v - board[i + 1][j]!.value);
        smoothness -= diff;
      }
    }
  }

  // 单调性：两种方向取最大值（适应不同蛇形走向）
  for (let i = 0; i < BOARD_SIZE; i++) {
    let inc = 0, dec = 0;
    for (let j = 0; j < 3; j++) {
      const a = board[i][j]?.value ?? 0;
      const b = board[i][j + 1]?.value ?? 0;
      if (a >= b) dec += (a - b);
      if (a <= b) inc += (b - a);
    }
    monotonicityL += Math.max(inc, dec);
  }
  for (let j = 0; j < BOARD_SIZE; j++) {
    let inc = 0, dec = 0;
    for (let i = 0; i < 3; i++) {
      const a = board[i][j]?.value ?? 0;
      const b = board[i + 1][j]?.value ?? 0;
      if (a >= b) dec += (a - b);
      if (a <= b) inc += (b - a);
    }
    monotonicityR += Math.max(inc, dec);
  }

  // 角落奖励：最大 tile 在目标角落时给 bonus
  let cornerBonus = 0;
  const [cr, cc] = CORNER_CELL;
  if (board[cr][cc] && board[cr][cc]!.value === maxTile) {
    cornerBonus = maxTile * 2;
  }

  // 空格数权重（最重要！）
  // 博弈后期空格少时，空格权重需要更高
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

// ─── Expectimax 搜索 ──────────────────────────────────────────────────

function expectimax(
  board: Board,
  depth: number,
  isPlayer: boolean,
  alpha: number,
  beta: number,
): number {
  if (depth === 0) return evaluate(board);

  if (isPlayer) {
    // MAX 层
    let bestScore = -Infinity;
    const dirs: Direction[] = ['up', 'down', 'left', 'right'];
    for (const d of dirs) {
      const r = moveBoard(board, d);
      if (!r.moved) continue;
      const score = expectimax(r.board, depth - 1, false, alpha, beta);
      if (score > bestScore) bestScore = score;
      // 简单的 α 剪枝（对 expectimax 不完全精确但有效加速）
      if (score > alpha) alpha = score;
      if (alpha >= beta) break;
    }
    return bestScore === -Infinity ? -1e9 : bestScore;
  } else {
    // CHANCE 层
    const empty = getEmptyCells(board);
    if (empty.length === 0) return evaluate(board);

    // 采样策略：深度越深采样越激进（平衡性能与精度）
    let sampleSize: number;
    if (depth >= 7)       sampleSize = Math.min(empty.length, 4);
    else if (depth >= 5)  sampleSize = Math.min(empty.length, 5);
    else if (depth >= 3)  sampleSize = Math.min(empty.length, 7);
    else                  sampleSize = empty.length;

    let totalScore = 0;

    for (let k = 0; k < sampleSize; k++) {
      const [r, c] = empty[k];

      // 出 2 (0.9 概率)
      const b2 = cloneBoard(board);
      b2[r][c] = { id: 0, value: 2 };
      const s2 = expectimax(b2, depth - 1, true, alpha, beta);
      totalScore += s2 * 0.9;

      // 出 4 (0.1 概率)
      const b4 = cloneBoard(board);
      b4[r][c] = { id: 0, value: 4 };
      const s4 = expectimax(b4, depth - 1, true, alpha, beta);
      totalScore += s4 * 0.1;
    }

    // 如果只采样了部分空格，按比例缩放
    if (sampleSize < empty.length) {
      totalScore = totalScore * empty.length / sampleSize;
    }

    return totalScore / empty.length;
  }
}

function getEmptyCells(board: Board): [number, number][] {
  const cells: [number, number][] = [];
  for (let i = 0; i < BOARD_SIZE; i++) {
    for (let j = 0; j < BOARD_SIZE; j++) {
      if (!board[i][j]) cells.push([i, j]);
    }
  }
  return cells;
}

/**
 * 自适应深度：开局浅（快），后期深（精确）
 * 空格越少意味着越接近残局 → 需要更深搜索
 */
function adaptiveDepth(emptyCount: number): number {
  if (emptyCount >= 10) return 3;  // 大量空格：浅搜
  if (emptyCount >= 8)  return 4;
  if (emptyCount >= 6)  return 5;
  if (emptyCount >= 4)  return 6;
  if (emptyCount >= 2)  return 7;
  return MAX_DEPTH;                // ≤1 空格：深度 8 搜到底
}

/**
 * 返回推荐方向（null = 无有效移动）
 */
export function getBestDirection(board: Board): Direction | null {
  const dirs: Direction[] = ['up', 'down', 'left', 'right'];
  const emptyCount = getEmptyCells(board).length;
  const depth = adaptiveDepth(emptyCount);

  let bestDir: Direction | null = null;
  let bestScore = -Infinity;

  // 预打分排序
  const candidates: { dir: Direction; greedyScore: number }[] = [];
  for (const d of dirs) {
    const r = moveBoard(board, d);
    if (r.moved) {
      candidates.push({ dir: d, greedyScore: evaluate(r.board) });
    }
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.greedyScore - a.greedyScore);

  for (const { dir } of candidates) {
    const r = moveBoard(board, dir);
    const score = expectimax(r.board, depth, false, -Infinity, Infinity);
    if (score > bestScore) {
      bestScore = score;
      bestDir = dir;
    }
  }

  return bestDir;
}
