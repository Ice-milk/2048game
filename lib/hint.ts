import { Board, Direction, cloneBoard, moveBoard } from './game2048';

// ─── Expectimax AI for 2048 ───────────────────────────────────────

/** 搜索深度（可调：3=快但偏弱，4=平衡，5=强但慢） */
const SEARCH_DEPTH = 3;

/** 最大 tile 所在的角（通常左上角最优） */
const CORNER_ROW = 0;
const CORNER_COL = 0;

/**
 * 评估函数：对棋盘打分
 *
 * 综合考虑：
 *   - 角位权重：最高 tile 应在角落
 *   - 单调性：行/列从角落向外递减
 *   - 平滑度：相邻 tile 值接近更好
 *   - 空格数：空格越多越好
 *   - 最大 tile 奖励
 */
function evaluate(board: Board): number {
  let cornerWeight = 0;
  let monotonicity = 0;
  let smoothness = 0;
  let emptyCells = 0;
  let maxTile = 0;

  const cornerDistWeight = buildCornerDistWeight();

  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      const cell = board[i][j];
      if (!cell) {
        emptyCells++;
        continue;
      }
      const v = cell.value;
      if (v > maxTile) maxTile = v;

      // 角位权重：大 tile 离角落越近越好
      cornerWeight += v * cornerDistWeight[i][j];

      // 平滑度：与右、下邻居的差异
      if (j < 3 && board[i][j + 1]) {
        smoothness -= Math.abs(v - board[i][j + 1]!.value);
      }
      if (i < 3 && board[i + 1][j]) {
        smoothness -= Math.abs(v - board[i + 1][j]!.value);
      }
    }
  }

  // 单调性：行单调 + 列单调
  for (let i = 0; i < 4; i++) {
    monotonicity += rowMonotonicity(board, i);
    monotonicity += colMonotonicity(board, i);
  }

  // 角落奖励：最大 tile 如果在角落，额外加分
  let cornerBonus = 0;
  const corners: [number, number][] = [[0, 0], [0, 3], [3, 0], [3, 3]];
  for (const [r, c] of corners) {
    if (board[r][c] && board[r][c]!.value === maxTile) {
      cornerBonus = maxTile * 4;
      break;
    }
  }

  // 权重调优
  return (
    cornerWeight * 1.0 +
    monotonicity * 1.5 +
    smoothness * 0.1 +
    emptyCells * 270 +
    cornerBonus * 0.5 +
    Math.log2(maxTile) * 100
  );
}

/** 距离角落的衰减权重矩阵 */
function buildCornerDistWeight(): number[][] {
  const cx = CORNER_ROW, cy = CORNER_COL;
  const weights: number[][] = [];
  for (let i = 0; i < 4; i++) {
    weights[i] = [];
    for (let j = 0; j < 4; j++) {
      const dist = Math.abs(i - cx) + Math.abs(j - cy);
      // 距离越远权重越小（指数衰减）
      weights[i][j] = Math.pow(0.5, dist);
    }
  }
  return weights;
}

/** 计算一行的单调性（从左到右递减得分高） */
function rowMonotonicity(board: Board, row: number): number {
  let inc = 0, dec = 0;
  for (let j = 0; j < 3; j++) {
    const a = board[row][j]?.value ?? 0;
    const b = board[row][j + 1]?.value ?? 0;
    if (a >= b) dec += a - b;
    if (a <= b) inc += b - a;
  }
  return Math.max(inc, dec);
}

/** 计算一列的单调性（从上到下递减得分高） */
function colMonotonicity(board: Board, col: number): number {
  let inc = 0, dec = 0;
  for (let i = 0; i < 3; i++) {
    const a = board[i][col]?.value ?? 0;
    const b = board[i + 1][col]?.value ?? 0;
    if (a >= b) dec += a - b;
    if (a <= b) inc += b - a;
  }
  return Math.max(inc, dec);
}

/**
 * 获取所有空格位置
 */
function getEmptyCells(board: Board): [number, number][] {
  const cells: [number, number][] = [];
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      if (!board[i][j]) cells.push([i, j]);
    }
  }
  return cells;
}

/**
 * Expectimax 搜索
 *
 * - isPlayer: true = MAX 层（玩家选择最佳方向）
 * - isPlayer: false = CHANCE 层（随机出 tile，计算期望值）
 */
function expectimax(
  board: Board,
  depth: number,
  isPlayer: boolean,
): number {
  if (depth === 0) {
    return evaluate(board);
  }

  if (isPlayer) {
    // MAX 层：尝试四个方向，取最大评分
    let bestScore = -Infinity;
    const dirs: Direction[] = ['up', 'down', 'left', 'right'];
    for (const d of dirs) {
      const r = moveBoard(board, d);
      if (!r.moved) continue;
      const score = expectimax(r.board, depth - 1, false);
      if (score > bestScore) bestScore = score;
    }
    // 无有效移动 → 游戏结束，返回极低分
    return bestScore === -Infinity ? -1e9 : bestScore;
  } else {
    // CHANCE 层：每个空格都有概率出 2 (90%) 或 4 (10%)
    const empty = getEmptyCells(board);
    if (empty.length === 0) return evaluate(board);

    // 性能优化：空格太多时只采样部分
    const sampleSize = Math.min(empty.length, 8);
    let totalScore = 0;
    let totalWeight = 0;

    for (let k = 0; k < sampleSize; k++) {
      const [r, c] = empty[k];

      // 出 2 的情况 (权重 0.9)
      const board2 = cloneBoard(board);
      board2[r][c] = { id: 0, value: 2 };
      const score2 = expectimax(board2, depth - 1, true);
      totalScore += score2 * 0.9;
      totalWeight += 0.9;

      // 出 4 的情况 (权重 0.1)
      const board4 = cloneBoard(board);
      board4[r][c] = { id: 0, value: 4 };
      const score4 = expectimax(board4, depth - 1, true);
      totalScore += score4 * 0.1;
      totalWeight += 0.1;
    }

    return totalScore / totalWeight;
  }
}

/**
 * 返回推荐方向（null = 无有效移动）
 *
 * 使用 Expectimax 搜索，先对可移动方向排序（贪心预打分），
 * 搜索时剪枝，取评分最高的方向。
 */
export function getBestDirection(board: Board): Direction | null {
  const dirs: Direction[] = ['up', 'down', 'left', 'right'];
  let bestDir: Direction | null = null;
  let bestScore = -Infinity;

  // 预打分排序：先快速评估，优先搜索好的方向
  const candidates: { dir: Direction; greedyScore: number }[] = [];
  for (const d of dirs) {
    const r = moveBoard(board, d);
    if (r.moved) {
      candidates.push({ dir: d, greedyScore: evaluate(r.board) });
    }
  }

  if (candidates.length === 0) return null;

  // 按贪心分降序排列（好的方向先搜，利于剪枝）
  candidates.sort((a, b) => b.greedyScore - a.greedyScore);

  for (const { dir } of candidates) {
    const r = moveBoard(board, dir);
    const score = expectimax(r.board, SEARCH_DEPTH, false);
    if (score > bestScore) {
      bestScore = score;
      bestDir = dir;
    }
  }

  return bestDir;
}
