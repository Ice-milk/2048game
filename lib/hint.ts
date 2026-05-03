import { Board, Direction, cloneBoard, moveBoard } from './game2048';

// ─── Expectimax AI v2 — Based on research: depth 4+ with snake pattern ───────

/** 搜索深度：4 平衡性能与强度，游戏后期可加深 */
const BASE_DEPTH = 4;

/**
 * 蛇形权重矩阵 —— 鼓励 tiles 呈蛇形排列：
 * 左下角最重，蜿蜒到右上角
 */
const SNAKE_WEIGHTS = [
  [0,  1,  2,  3],
  [7,  6,  5,  4],
  [8,  9,  10, 11],
  [15, 14, 13, 12],
];

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

  // 角落奖励：最大 tile 在左下角时给 bonus
  let cornerBonus = 0;
  if (board[3][0] && board[3][0]!.value === maxTile) {
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

    // 优化：对每个空格，出 2(90%) 和 4(10%) 的期望值
    // 但空格多时采样以保持性能
    const sampleSize = depth >= 3 ? Math.min(empty.length, 6) : empty.length;

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
 * 自适应深度：开局深度浅（快），后期深度深（精确）
 */
function adaptiveDepth(emptyCount: number): number {
  if (emptyCount >= 8) return 3;       // 开局快
  if (emptyCount >= 5) return BASE_DEPTH;    // 4
  if (emptyCount >= 3) return BASE_DEPTH + 1; // 5
  return BASE_DEPTH + 2;                     // 6（残局精确）
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
