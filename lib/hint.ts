import { Board, Direction, cloneBoard, moveBoard } from './game2048';

/** 角位权重矩阵 —— 鼓励大 tile 往左上角靠 */
const WEIGHTS = [
  [16, 12, 8, 4],
  [12, 8, 4, 2],
  [8, 4, 2, 1],
  [4, 2, 1, 0],
];

/** 对棋盘打分 */
function scoreBoard(board: Board): number {
  let s = 0;
  let empty = 0;
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      const cell = board[i][j];
      if (!cell) { empty++; continue; }
      s += cell.value * WEIGHTS[i][j];
    }
  }
  return s + empty * 2048; // 空格越多越好
}

/** 返回推荐方向（null=无有效移动） */
export function getBestDirection(board: Board): Direction | null {
  const dirs: Direction[] = ['up', 'down', 'left', 'right'];
  let best: Direction | null = null;
  let bestScore = -Infinity;
  for (const d of dirs) {
    const r = moveBoard(board, d);
    if (!r.moved) continue;
    const sc = scoreBoard(r.board);
    if (sc > bestScore) { bestScore = sc; best = d; }
  }
  return best;
}
