use wasm_bindgen::prelude::*;
use std::collections::HashMap;

// ─── Constants ─────────────────────────────────────────────────────────

/// Snake weight matrix for bottom-left corner preference
const SNAKE_WEIGHTS: [[f64; 4]; 4] = [
    [0.0,  1.0,  2.0,  3.0],
    [7.0,  6.0,  5.0,  4.0],
    [8.0,  9.0,  10.0, 11.0],
    [15.0, 14.0, 13.0, 12.0],
];

const CORNER_ROW: usize = 3;
const CORNER_COL: usize = 0;

type Board = [u32; 16];

// ─── Transposition Table ───────────────────────────────────────────────

/// Cache key: hash of (board state, depth, is_player)
type TTCache = HashMap<(u64, i32, bool), f64>;

fn board_hash(board: &Board) -> u64 {
    let mut h: u64 = 0;
    for &v in board.iter() {
        h = h.wrapping_mul(31).wrapping_add(v as u64);
    }
    h
}

// ─── Board Operations ──────────────────────────────────────────────────

fn get_empty_cells(board: &Board) -> Vec<usize> {
    (0..16).filter(|&i| board[i] == 0).collect()
}

/// Slide and merge a single row (left direction)
fn slide_row(row: &[u32; 4]) -> ([u32; 4], u32) {
    let mut result = [0u32; 4];
    let mut score = 0u32;
    let mut pos: usize = 0;

    for i in 0..4 {
        if row[i] == 0 { continue; }
        if pos > 0 && result[pos - 1] == row[i] {
            result[pos - 1] *= 2;
            score += result[pos - 1];
        } else {
            result[pos] = row[i];
            pos += 1;
        }
    }
    (result, score)
}

fn move_board(board: &Board, direction: u8) -> (Board, u32, bool) {
    let mut next = *board;
    let mut score_delta = 0u32;
    let mut moved = false;

    match direction {
        0 => { // up
            for col in 0..4 {
                let vals = [next[col], next[col+4], next[col+8], next[col+12]];
                let (slid, score) = slide_row(&vals);
                score_delta += score;
                for row in 0..4 {
                    if next[row*4+col] != slid[row] { moved = true; }
                    next[row*4+col] = slid[row];
                }
            }
        }
        1 => { // down
            for col in 0..4 {
                let vals = [next[12+col], next[8+col], next[4+col], next[col]];
                let (slid, score) = slide_row(&vals);
                score_delta += score;
                let result = [slid[3], slid[2], slid[1], slid[0]];
                for row in 0..4 {
                    if next[row*4+col] != result[row] { moved = true; }
                    next[row*4+col] = result[row];
                }
            }
        }
        2 => { // left
            for row in 0..4 {
                let s = row * 4;
                let vals = [next[s], next[s+1], next[s+2], next[s+3]];
                let (slid, score) = slide_row(&vals);
                score_delta += score;
                for col in 0..4 {
                    if next[s+col] != slid[col] { moved = true; }
                    next[s+col] = slid[col];
                }
            }
        }
        3 => { // right
            for row in 0..4 {
                let s = row * 4;
                let vals = [next[s+3], next[s+2], next[s+1], next[s]];
                let (slid, score) = slide_row(&vals);
                score_delta += score;
                for col in 0..4 {
                    let v = slid[3-col];
                    if next[s+col] != v { moved = true; }
                    next[s+col] = v;
                }
            }
        }
        _ => {}
    }
    (next, score_delta, moved)
}

// ─── Evaluation ────────────────────────────────────────────────────────

fn evaluate(board: &Board) -> f64 {
    let mut empty = 0u32;
    let mut max_tile = 0u32;
    let mut snake = 0.0f64;
    let mut mono_l = 0.0f64;
    let mut mono_r = 0.0f64;
    let mut smooth = 0.0f64;
    let mut scatter = 0.0f64;

    for i in 0..4 {
        for j in 0..4 {
            let v = board[i*4+j];
            if v == 0 { empty += 1; continue; }
            if v > max_tile { max_tile = v; }
            snake += v as f64 * SNAKE_WEIGHTS[i][j];

            if j < 3 && board[i*4+j+1] != 0 {
                smooth -= (v as f64 - board[i*4+j+1] as f64).abs();
            }
            if i < 3 && board[(i+1)*4+j] != 0 {
                smooth -= (v as f64 - board[(i+1)*4+j] as f64).abs();
            }
        }
    }

    // Monotonicity
    for i in 0..4 {
        let s = i*4;
        let (mut inc, mut dec) = (0.0, 0.0);
        for j in 0..3 {
            let a = board[s+j] as f64;
            let b = board[s+j+1] as f64;
            if a >= b { dec += a - b; }
            if a <= b { inc += b - a; }
        }
        mono_l += inc.max(dec);
    }
    for j in 0..4 {
        let (mut inc, mut dec) = (0.0, 0.0);
        for i in 0..3 {
            let a = board[i*4+j] as f64;
            let b = board[(i+1)*4+j] as f64;
            if a >= b { dec += a - b; }
            if a <= b { inc += b - a; }
        }
        mono_r += inc.max(dec);
    }

    // Corner bonus
    let corner_bonus = if board[CORNER_ROW*4+CORNER_COL] == max_tile {
        max_tile as f64 * 2.0
    } else { 0.0 };

    // Scatter penalty: high-value tiles far from corner
    let (cr, cc) = (CORNER_ROW as i32, CORNER_COL as i32);
    for i in 0..4 {
        for j in 0..4 {
            let v = board[i*4+j];
            if v >= 128 {
                let dist = (i as i32 - cr).abs() + (j as i32 - cc).abs();
                scatter -= v as f64 * dist as f64 * 0.3;
            }
        }
    }

    // Weight tuning: empty cells most important, then snake
    let empty_weight = if empty <= 3 { 400.0 } else if empty <= 5 { 320.0 } else { 270.0 };

    snake * 0.8
        + mono_l * 1.2
        + mono_r * 1.2
        + smooth * 0.12
        + scatter * 1.0
        + corner_bonus * 0.5
        + empty as f64 * empty_weight
        + (max_tile as f64 + 1.0).log2() * 50.0
}

// ─── Adaptive Depth (per full move cycle = MAX+CHANCE) ─────────────────

fn adaptive_depth(empty_count: usize) -> i32 {
    // Each unit = one MAX+CHANCE pair
    if empty_count >= 12 { return 3; }
    if empty_count >= 10 { return 4; }
    if empty_count >= 8  { return 5; }
    if empty_count >= 6  { return 6; }
    if empty_count >= 4  { return 7; }
    if empty_count >= 2  { return 8; }
    10  // ≤1 empty: 深度 10（残局精确搜索）
}

// ─── Expectimax with Transposition Table ───────────────────────────────

fn expectimax(
    board: &Board,
    depth: i32,
    is_player: bool,
    alpha: f64,
    beta: f64,
    tt: &mut TTCache,
) -> f64 {
    if depth == 0 {
        return evaluate(board);
    }

    let hash = board_hash(board);
    let key = (hash, depth, is_player);

    // Transposition table lookup
    if let Some(&cached) = tt.get(&key) {
        return cached;
    }

    let result = if is_player {
        expectimax_max(board, depth, alpha, beta, tt)
    } else {
        expectimax_chance(board, depth, alpha, beta, tt)
    };

    tt.insert(key, result);
    result
}

fn expectimax_max(
    board: &Board,
    depth: i32,
    alpha: f64,
    beta: f64,
    tt: &mut TTCache,
) -> f64 {
    let mut best = f64::NEG_INFINITY;
    let mut a = alpha;

    for d in 0u8..4 {
        let (moved_board, _, moved) = move_board(board, d);
        if !moved { continue; }
        // MAX 层不应加随机 tile，进入 CHANCE 层才加
        let score = expectimax_chance(&moved_board, depth, a, beta, tt);
        if score > best { best = score; }
        if score > a { a = score; }
        if a >= beta { break; }
    }

    if best.is_infinite() { -1e9 } else { best }
}

fn expectimax_chance(
    board: &Board,
    depth: i32,
    alpha: f64,
    beta: f64,
    tt: &mut TTCache,
) -> f64 {
    let empty = get_empty_cells(board);
    if empty.is_empty() { return evaluate(board); }

    let new_depth = depth - 1;

    // 采样策略：深层少采样，浅层全量
    let sample_size = if depth >= 8 {
        empty.len().min(5)
    } else if depth >= 6 {
        empty.len().min(6)
    } else if depth >= 4 {
        empty.len().min(8)
    } else {
        empty.len()
    };

    let mut total = 0.0f64;

    for k in 0..sample_size {
        let pos = empty[k];

        let mut b2 = *board;
        b2[pos] = 2;
        total += expectimax(&b2, new_depth, true, alpha, beta, tt) * 0.9;

        let mut b4 = *board;
        b4[pos] = 4;
        total += expectimax(&b4, new_depth, true, alpha, beta, tt) * 0.1;
    }

    if sample_size < empty.len() {
        total *= empty.len() as f64 / sample_size as f64;
    }

    total / empty.len() as f64
}

// ─── WASM Exports ──────────────────────────────────────────────────────

#[wasm_bindgen]
pub fn get_best_move(board_js: &[u32]) -> u8 {
    if board_js.len() != 16 { return 4; }

    let mut board: Board = [0u32; 16];
    board.copy_from_slice(board_js);

    let empty_count = get_empty_cells(&board).len();
    let depth = adaptive_depth(empty_count);
    let mut tt: TTCache = HashMap::with_capacity(65536);

    let mut best_dir: u8 = 4;
    let mut best_score = f64::NEG_INFINITY;

    // 预排序候选方向
    let mut candidates: Vec<(u8, f64)> = Vec::new();
    for d in 0u8..4 {
        let (mb, _, moved) = move_board(&board, d);
        if moved {
            candidates.push((d, evaluate(&mb)));
        }
    }
    candidates.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());

    for (d, _) in candidates {
        let (moved_board, _, _) = move_board(&board, d);
        let score = expectimax_chance(&moved_board, depth, f64::NEG_INFINITY, f64::INFINITY, &mut tt);
        if score > best_score {
            best_score = score;
            best_dir = d;
        }
    }

    best_dir
}

#[wasm_bindgen]
pub fn evaluate_board(board_js: &[u32]) -> f64 {
    if board_js.len() != 16 { return 0.0; }
    let mut board: Board = [0u32; 16];
    board.copy_from_slice(board_js);
    evaluate(&board)
}
