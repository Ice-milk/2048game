// AI 引擎 — Rust WASM expectimax，仅客户端懒加载

let ready = false;
let initPromise: Promise<void> | null = null;

type AIMoveFn = (board: Uint32Array) => number;
let get_best_move: AIMoveFn | null = null;

/** 懒加载 WASM 模块（仅在浏览器调用） */
async function loadWasm() {
  if (ready) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const mod = await import('../public/wasm-ai/wasm_ai.js');
    await mod.default();
    get_best_move = mod.get_best_move;
    ready = true;
  })();

  return initPromise;
}

/** 确保 WASM 就绪 */
export async function ensureReady() {
  if (typeof window === 'undefined') return;
  await loadWasm();
}

/**
 * 同步获取最佳方向（需先 await ensureReady()）
 * 返回 null 表示 WASM 未就绪
 */
export function getAIMove(board: Uint32Array): 'up' | 'down' | 'left' | 'right' | null {
  if (!ready || !get_best_move) return null;
  const dirMap: Record<number, 'up' | 'down' | 'left' | 'right' | null> = {
    0: 'up', 1: 'down', 2: 'left', 3: 'right',
  };
  return dirMap[get_best_move(board)] ?? null;
}
