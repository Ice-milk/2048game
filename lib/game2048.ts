export type Tile = number | null;
export type Board = Tile[][];
export type Direction = 'up' | 'down' | 'left' | 'right';

export interface MoveResult {
  board: Board;
  moved: boolean;
  scoreDelta: number;
  gameOver: boolean;
  hasWon: boolean;
}

const BOARD_SIZE = 4;

export function createEmptyBoard(): Board {
  return Array.from({ length: BOARD_SIZE }, () => Array<Tile>(BOARD_SIZE).fill(null));
}

export function cloneBoard(board: Board): Board {
  return board.map((row) => [...row]);
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
  next[row][col] = Math.random() < 0.9 ? 2 : 4;
  return next;
}

export function createInitialBoard(): Board {
  return addRandomTile(addRandomTile(createEmptyBoard()));
}

function slideAndMergeLine(line: Tile[]): { line: Tile[]; scoreDelta: number } {
  const filtered = line.filter((cell): cell is number => cell !== null);
  const merged: Tile[] = [];
  let scoreDelta = 0;

  for (let i = 0; i < filtered.length; i++) {
    if (filtered[i] === filtered[i + 1]) {
      const value = filtered[i] * 2;
      merged.push(value);
      scoreDelta += value;
      i += 1;
    } else {
      merged.push(filtered[i]);
    }
  }

  while (merged.length < BOARD_SIZE) merged.push(null);
  return { line: merged, scoreDelta };
}

function linesEqual(a: Tile[], b: Tile[]): boolean {
  return a.every((value, index) => value === b[index]);
}

export function canMove(board: Board): boolean {
  for (let i = 0; i < BOARD_SIZE; i++) {
    for (let j = 0; j < BOARD_SIZE; j++) {
      const cell = board[i][j];
      if (cell === null) return true;
      if (i < BOARD_SIZE - 1 && board[i + 1][j] === cell) return true;
      if (j < BOARD_SIZE - 1 && board[i][j + 1] === cell) return true;
    }
  }
  return false;
}

export function hasWinningTile(board: Board, target = 2048): boolean {
  return board.some((row) => row.some((cell) => (cell ?? 0) >= target));
}

export function moveBoard(board: Board, direction: Direction): MoveResult {
  const next = cloneBoard(board);
  let moved = false;
  let scoreDelta = 0;

  if (direction === 'left' || direction === 'right') {
    for (let row = 0; row < BOARD_SIZE; row++) {
      const original = [...next[row]];
      const working = direction === 'right' ? [...original].reverse() : original;
      const merged = slideAndMergeLine(working);
      const finalLine = direction === 'right' ? [...merged.line].reverse() : merged.line;
      next[row] = finalLine;
      if (!linesEqual(original, finalLine)) moved = true;
      scoreDelta += merged.scoreDelta;
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
    }
  }

  const boardAfterSpawn = moved ? addRandomTile(next) : next;

  return {
    board: boardAfterSpawn,
    moved,
    scoreDelta,
    gameOver: !canMove(boardAfterSpawn),
    hasWon: hasWinningTile(boardAfterSpawn),
  };
}
