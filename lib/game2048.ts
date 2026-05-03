export type TileCell = { id: number; value: number } | null;
export type Board = TileCell[][];
export type Direction = 'up' | 'down' | 'left' | 'right';

export interface MergeInfo {
  row: number;
  col: number;
  gained: number;
}

export interface MoveResult {
  board: Board;
  moved: boolean;
  scoreDelta: number;
  gameOver: boolean;
  hasWon: boolean;
  merges: MergeInfo[];
}

const BOARD_SIZE = 4;

let _nextId = 0;
export function resetTileIdCounter(): void {
  _nextId = 0;
}
export function setTileIdCounter(maxId: number): void {
  _nextId = maxId;
}
function nextId(): number {
  return ++_nextId;
}

export function createEmptyBoard(): Board {
  return Array.from({ length: BOARD_SIZE }, () => Array<TileCell>(BOARD_SIZE).fill(null));
}

export function cloneBoard(board: Board): Board {
  return board.map((row) => row.map((cell) => (cell ? { ...cell } : null)));
}

export function addRandomTile(board: Board): Board {
  const next = cloneBoard(board);
  const empty: [number, number][] = [];

  for (let i = 0; i < BOARD_SIZE; i++) {
    for (let j = 0; j < BOARD_SIZE; j++) {
      if (next[i][j] === null) empty.push([i, j]);
    }
  }

  if (empty.length === 0) return next;

  const [row, col] = empty[Math.floor(Math.random() * empty.length)];
  next[row][col] = { id: nextId(), value: Math.random() < 0.9 ? 2 : 4 };
  return next;
}

export function createInitialBoard(): Board {
  return addRandomTile(addRandomTile(createEmptyBoard()));
}

function slideAndMergeLine(
  line: TileCell[],
): { line: TileCell[]; scoreDelta: number; merges: { index: number; gained: number }[] } {
  const nonNull = line.filter((cell): cell is NonNullable<TileCell> => cell !== null);
  const merged: TileCell[] = [];
  let scoreDelta = 0;
  const merges: { index: number; gained: number }[] = [];

  for (let i = 0; i < nonNull.length; i++) {
    if (i + 1 < nonNull.length && nonNull[i].value === nonNull[i + 1].value) {
      const value = nonNull[i].value * 2;
      merges.push({ index: merged.length, gained: value });
      merged.push({ id: nonNull[i].id, value });
      scoreDelta += value;
      i += 1;
    } else {
      merged.push({ ...nonNull[i] });
    }
  }

  while (merged.length < BOARD_SIZE) merged.push(null);
  return { line: merged, scoreDelta, merges };
}

function linesEqual(a: TileCell[], b: TileCell[]): boolean {
  return a.every((cell, idx) => {
    const cb = b[idx];
    if (cell === null && cb === null) return true;
    if (cell === null || cb === null) return false;
    return cell.id === cb.id && cell.value === cb.value;
  });
}

export function canMove(board: Board): boolean {
  for (let i = 0; i < BOARD_SIZE; i++) {
    for (let j = 0; j < BOARD_SIZE; j++) {
      const cell = board[i][j];
      if (cell === null) return true;
      if (i < BOARD_SIZE - 1 && board[i + 1][j]?.value === cell.value) return true;
      if (j < BOARD_SIZE - 1 && board[i][j + 1]?.value === cell.value) return true;
    }
  }
  return false;
}

export function hasWinningTile(board: Board, target = 2048): boolean {
  return board.some((row) => row.some((cell) => (cell?.value ?? 0) >= target));
}

export function moveBoard(board: Board, direction: Direction): MoveResult {
  const next = cloneBoard(board);
  let moved = false;
  let scoreDelta = 0;
  const allMerges: MergeInfo[] = [];

  if (direction === 'left' || direction === 'right') {
    for (let row = 0; row < BOARD_SIZE; row++) {
      const original = [...next[row]];
      const working = direction === 'right' ? [...original].reverse() : original;
      const merged = slideAndMergeLine(working);
      const finalLine = direction === 'right' ? [...merged.line].reverse() : merged.line;
      next[row] = finalLine;
      if (!linesEqual(original, finalLine)) moved = true;
      scoreDelta += merged.scoreDelta;

      for (const m of merged.merges) {
        allMerges.push({
          row,
          col: direction === 'right' ? BOARD_SIZE - 1 - m.index : m.index,
          gained: m.gained,
        });
      }
    }
  } else {
    for (let col = 0; col < BOARD_SIZE; col++) {
      const original = [next[0][col], next[1][col], next[2][col], next[3][col]];
      const working = direction === 'down' ? [...original].reverse() : original;
      const merged = slideAndMergeLine(working);
      const finalLine = direction === 'down' ? [...merged.line].reverse() : merged.line;
      for (let row = 0; row < BOARD_SIZE; row++) next[row][col] = finalLine[row];
      if (!linesEqual(original, finalLine)) moved = true;
      scoreDelta += merged.scoreDelta;

      for (const m of merged.merges) {
        allMerges.push({
          row: direction === 'down' ? BOARD_SIZE - 1 - m.index : m.index,
          col,
          gained: m.gained,
        });
      }
    }
  }

  const boardAfterSpawn = moved ? addRandomTile(next) : next;

  return {
    board: boardAfterSpawn,
    moved,
    scoreDelta,
    gameOver: !canMove(boardAfterSpawn),
    hasWon: hasWinningTile(boardAfterSpawn),
    merges: allMerges,
  };
}
