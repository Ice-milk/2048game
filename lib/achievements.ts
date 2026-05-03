import type { Board } from './game2048';

export interface AchievementDef {
  id: string;
  icon: string;
  title: string;
  desc: string;
}

export interface AchievementState {
  score: number;
  moveCount: number;
  highestTile: number;
  consecutiveMerges: number;
  boardFull: boolean;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'first-merge', icon: '○', title: '初次合并', desc: '完成第一次 tile 合并' },
  { id: 'tile-256', icon: '◆', title: '四分之一千', desc: '合成 256 方块' },
  { id: 'tile-1024', icon: '◇', title: 'Kilo Tile', desc: '合成 1024 方块' },
  { id: 'tile-2048', icon: '★', title: '经典达成', desc: '合成 2048 方块' },
  { id: 'score-5k', icon: '✦', title: '五千分', desc: '单局得分突破 5,000' },
  { id: 'score-10k', icon: '✦', title: '万分户', desc: '单局得分突破 10,000' },
  { id: 'score-30k', icon: '★', title: '三万分', desc: '单局得分突破 30,000' },
  { id: 'steps-100', icon: '»', title: '百步穿杨', desc: '累计移动 100 步' },
  { id: 'triple-merge', icon: '◈', title: '帽子戏法', desc: '连续 3 步都产生合并' },
  { id: 'full-house', icon: '▪', title: '客满', desc: '占满全部 16 格' },
];

function isFull(board: Board): boolean {
  for (const row of board) for (const cell of row) if (!cell) return false;
  return true;
}

function getHighestTile(board: Board): number {
  let max = 0;
  for (const row of board) for (const cell of row) if (cell && cell.value > max) max = cell.value;
  return max;
}

export function evaluateAchievements(state: AchievementState): string[] {
  const unlocked: string[] = [];
  if (state.moveCount >= 1 && state.score > 0) unlocked.push('first-merge');
  if (state.highestTile >= 256) unlocked.push('tile-256');
  if (state.highestTile >= 1024) unlocked.push('tile-1024');
  if (state.highestTile >= 2048) unlocked.push('tile-2048');
  if (state.score >= 5000) unlocked.push('score-5k');
  if (state.score >= 10000) unlocked.push('score-10k');
  if (state.score >= 30000) unlocked.push('score-30k');
  if (state.moveCount >= 100) unlocked.push('steps-100');
  if (state.consecutiveMerges >= 3) unlocked.push('triple-merge');
  if (state.boardFull) unlocked.push('full-house');
  return unlocked;
}
