use wasm_bindgen::prelude::*;
use js_sys::Math;

// ─── Constants ─────────────────────────────────────────────────────────

const BOARD_SIZE: usize = 4;

/// Snake weight matrix for bottom-left corner preference
const SNAKE_WEIGHTS: [[f64; 4]; 4] = [
    [0.0,  1.0,  2.0,  3.0],
    [7.0,  6.0,  5.0,  4.0],
    [8.0,  9.0,  10.0, 11.0],
    [15.0, 14.0, 13.0, 12.0],
];

/// Corner cell coordinates (bottom-left)
const CORNER_ROW: usize = 3;
const CORNER_COL: usize = 0;

// ─── Board Operations ──────────────────────────────────────────────────

type Board = [u32; 16];

fn clone_board(board: &Board) -> Board {
    *board
}

fn get_empty_cells(board: &Board) -> Vec<usize> {
    (0..16).filter(|&i| board[i] == 0).collect()
}

#[inline]
fn row_col(idx: usize) -> (usize, usize) {
    (idx / 4, idx % 4)
}

/// Slide and merge a single row (left direction)
fn slide_row(row: &[u32; 4]) -> ([u32; 4], u32) {
    let mut result = [0u32; 4];
    let mut score = 0u32;
    let mut pos: usize = 0;

    for i in 0..4 {
        if row[i] == 0 {
            continue;
        }
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
    let mut next = clone_board(board);
    let mut score_delta = 0u32;
    let mut moved = false;

    match direction {
        0 => {
            // up
            for col in 0..4 {
                let col_vals: [u32; 4] = [next[col], next[col + 4], next[col + 8], next[col + 12]];
                let (slid, score) = slide_row(&col_vals);
                score_delta += score;
                for row in 0..4 {
                    let new_val = slid[row];
                    if next[row * 4 + col] != new_val {
                        moved = true;
                    }
                    next[row * 4 + col] = new_val;
                }
            }
        }
        1 => {
            // down
            for col in 0..4 {
                let mut col_vals: [u32; 4] = [next[12 + col], next[8 + col], next[4 + col], next[col]];
                let (slid, score) = slide_row(&col_vals);
                score_delta += score;
                col_vals = [slid[3], slid[2], slid[1], slid[0]];
                for row in 0..4 {
                    let new_val = col_vals[row];
                    if next[row * 4 + col] != new_val {
                        moved = true;
                    }
                    next[row * 4 + col] = new_val;
                }
            }
        }
        2 => {
            // left
            for row in 0..4 {
                let s = row * 4;
                let row_vals: [u32; 4] = [next[s], next[s + 1], next[s + 2], next[s + 3]];
                let (slid, score) = slide_row(&row_vals);
                score_delta += score;
                for col in 0..4 {
                    if next[s + col] != slid[col] {
                        moved = true;
                    }
                    next[s + col] = slid[col];
                }
            }
        }
        3 => {
            // right
            for row in 0..4 {
                let s = row * 4;
                let row_vals: [u32; 4] = [next[s + 3], next[s + 2], next[s + 1], next[s]];
                let (slid, score) = slide_row(&row_vals);
                score_delta += score;
                for col in 0..4 {
                    let new_val = slid[3 - col];
                    if next[s + col] != new_val {
                        moved = true;
                    }
                    next[s + col] = new_val;
                }
            }
        }
        _ => {}
    }

    (next, score_delta, moved)
}

/// Add a random tile (2 with 90% prob, 4 with 10%) after a move
fn add_random_tile(board: &Board) -> Board {
    let empty = get_empty_cells(board);
    if empty.is_empty() {
        return clone_board(board);
    }
    let idx = (Math::random() * empty.len() as f64) as usize;
    let pos = empty[idx];
    let value = if Math::random() < 0.9 { 2 } else { 4 };
    let mut next = clone_board(board);
    next[pos] = value;
    next
}

fn can_move(board: &Board) -> bool {
    let empty = get_empty_cells(board);
    if !empty.is_empty() {
        return true;
    }
    for i in 0..4 {
        for j in 0..4 {
            let cell = board[i * 4 + j];
            if j < 3 && board[i * 4 + j + 1] == cell {
                return true;
            }
            if i < 3 && board[(i + 1) * 4 + j] == cell {
                return true;
            }
        }
    }
    false
}

fn has_winning_tile(board: &Board) -> bool {
    board.iter().any(|&v| v >= 2048)
}

// ─── Evaluation Function ───────────────────────────────────────────────

fn evaluate(board: &Board) -> f64 {
    let mut empty_cells = 0u32;
    let mut max_tile = 0u32;
    let mut snake_score = 0.0f64;
    let mut monotonicity_l = 0.0f64;
    let mut monotonicity_r = 0.0f64;
    let mut smoothness = 0.0f64;

    for i in 0..4 {
        for j in 0..4 {
            let v = board[i * 4 + j];
            if v == 0 {
                empty_cells += 1;
                continue;
            }
            if v > max_tile {
                max_tile = v;
            }
            snake_score += v as f64 * SNAKE_WEIGHTS[i][j];

            // Smoothness
            if j < 3 {
                let right = board[i * 4 + j + 1];
                if right != 0 {
                    smoothness -= (v as f64 - right as f64).abs();
                }
            }
            if i < 3 {
                let down = board[(i + 1) * 4 + j];
                if down != 0 {
                    smoothness -= (v as f64 - down as f64).abs();
                }
            }
        }
    }

    // Monotonicity (rows)
    for i in 0..4 {
        let s = i * 4;
        let mut inc = 0.0f64;
        let mut dec = 0.0f64;
        for j in 0..3 {
            let a = board[s + j] as f64;
            let b = board[s + j + 1] as f64;
            if a >= b { dec += a - b; }
            if a <= b { inc += b - a; }
        }
        monotonicity_l += inc.max(dec);
    }
    // Monotonicity (columns)
    for j in 0..4 {
        let mut inc = 0.0f64;
        let mut dec = 0.0f64;
        for i in 0..3 {
            let a = board[i * 4 + j] as f64;
            let b = board[(i + 1) * 4 + j] as f64;
            if a >= b { dec += a - b; }
            if a <= b { inc += b - a; }
        }
        monotonicity_r += inc.max(dec);
    }

    // Corner bonus
    let mut corner_bonus = 0.0f64;
    if board[CORNER_ROW * 4 + CORNER_COL] == max_tile {
        corner_bonus = max_tile as f64 * 2.0;
    }

    let empty_weight = if empty_cells <= 3 { 350.0 } else { 270.0 };

    snake_score * 0.8
        + monotonicity_l * 1.0
        + monotonicity_r * 1.0
        + smoothness * 0.15
        + corner_bonus * 0.5
        + empty_cells as f64 * empty_weight
        + (max_tile as f64 + 1.0).log2() * 60.0
}

// ─── Adaptive Depth ────────────────────────────────────────────────────

fn adaptive_depth(empty_count: usize) -> i32 {
    if empty_count >= 10 { return 3; }
    if empty_count >= 8  { return 4; }
    if empty_count >= 6  { return 5; }
    if empty_count >= 4  { return 6; }
    if empty_count >= 2  { return 7; }
    8
}

// ─── Expectimax ────────────────────────────────────────────────────────

fn expectimax(board: &Board, depth: i32, is_player: bool, alpha: f64, beta: f64) -> f64 {
    if depth == 0 {
        return evaluate(board);
    }

    if is_player {
        let mut best_score = f64::NEG_INFINITY;
        let mut alpha = alpha;
        for d in 0u8..4 {
            let (next_board, _, moved) = move_board(board, d);
            if !moved {
                continue;
            }
            let board_after = add_random_tile(&next_board);
            let score = expectimax(&board_after, depth - 1, false, alpha, beta);
            if score > best_score {
                best_score = score;
            }
            if score > alpha {
                alpha = score;
            }
            if alpha >= beta {
                break;
            }
        }
        if best_score.is_infinite() {
            -1e9
        } else {
            best_score
        }
    } else {
        let empty = get_empty_cells(board);
        if empty.is_empty() {
            return evaluate(board);
        }

        let sample_size = if depth >= 7 {
            empty.len().min(4)
        } else if depth >= 5 {
            empty.len().min(5)
        } else if depth >= 3 {
            empty.len().min(7)
        } else {
            empty.len()
        };

        let mut total_score = 0.0f64;

        for k in 0..sample_size {
            let pos = empty[k];

            // Tile 2 (90% probability)
            let mut b2 = clone_board(board);
            b2[pos] = 2;
            total_score += expectimax(&b2, depth - 1, true, alpha, beta) * 0.9;

            // Tile 4 (10% probability)
            let mut b4 = clone_board(board);
            b4[pos] = 4;
            total_score += expectimax(&b4, depth - 1, true, alpha, beta) * 0.1;
        }

        if sample_size < empty.len() {
            total_score = total_score * empty.len() as f64 / sample_size as f64;
        }

        total_score / empty.len() as f64
    }
}

// ─── WASM Exports ──────────────────────────────────────────────────────

#[wasm_bindgen]
pub fn get_best_move(board_js: &[u32]) -> u8 {
    if board_js.len() != 16 {
        return 4; // invalid
    }

    let mut board: Board = [0u32; 16];
    board.copy_from_slice(board_js);

    let empty_count = get_empty_cells(&board).len();
    let depth = adaptive_depth(empty_count);

    let mut best_dir: u8 = 4; // 4 = none
    let mut best_score = f64::NEG_INFINITY;

    // Try all 4 directions
    for d in 0u8..4 {
        let (next_board, _, moved) = move_board(&board, d);
        if !moved {
            continue;
        }
        let board_after = add_random_tile(&next_board);
        let score = expectimax(&board_after, depth, false, f64::NEG_INFINITY, f64::INFINITY);
        if score > best_score {
            best_score = score;
            best_dir = d;
        }
    }

    best_dir
}

#[wasm_bindgen]
pub fn evaluate_board(board_js: &[u32]) -> f64 {
    if board_js.len() != 16 {
        return 0.0;
    }
    let mut board: Board = [0u32; 16];
    board.copy_from_slice(board_js);
    evaluate(&board)
}
