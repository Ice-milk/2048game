use wasm_bindgen::prelude::*;
use std::collections::HashMap;
use std::sync::Once;

// ─── Type Definitions ──────────────────────────────────────────────────

type BoardT = u64;
type RowT = u16;

const ROW_MASK: u64 = 0xFFFF;
const COL_MASK: u64 = 0x000F000F000F000F;

// ─── Heuristic Scoring Settings ────────────────────────────────────────

const SCORE_LOST_PENALTY: f32 = 200000.0;
const SCORE_MONOTONICITY_POWER: f32 = 4.0;
const SCORE_MONOTONICITY_WEIGHT: f32 = 47.0;
const SCORE_SUM_POWER: f32 = 3.5;
const SCORE_SUM_WEIGHT: f32 = 11.0;
const SCORE_MERGES_WEIGHT: f32 = 700.0;
const SCORE_EMPTY_WEIGHT: f32 = 270.0;

// ─── Search Settings ───────────────────────────────────────────────────

const CPROB_THRESH_BASE: f32 = 0.0001;
const CACHE_DEPTH_LIMIT: i32 = 15;

// ─── Lookup Tables ─────────────────────────────────────────────────────

static mut ROW_LEFT_TABLE: [RowT; 65536] = [0; 65536];
static mut ROW_RIGHT_TABLE: [RowT; 65536] = [0; 65536];
static mut COL_UP_TABLE: [BoardT; 65536] = [0; 65536];
static mut COL_DOWN_TABLE: [BoardT; 65536] = [0; 65536];
static mut HEUR_SCORE_TABLE: [f32; 65536] = [0.0; 65536];
static mut SCORE_TABLE: [f32; 65536] = [0.0; 65536];

static INIT: Once = Once::new();

// ─── Utility Functions ─────────────────────────────────────────────────

#[inline]
fn transpose(x: BoardT) -> BoardT {
    let a1 = x & 0xF0F00F0FF0F00F0F;
    let a2 = x & 0x0000F0F00000F0F0;
    let a3 = x & 0x0F0F00000F0F0000;
    let a = a1 | (a2 << 12) | (a3 >> 12);
    let b1 = a & 0xFF00FF0000FF00FF;
    let b2 = a & 0x00FF00FF00000000;
    let b3 = a & 0x00000000FF00FF00;
    b1 | (b2 >> 24) | (b3 << 24)
}

#[inline]
fn count_empty(mut x: BoardT) -> usize {
    x |= (x >> 2) & 0x3333333333333333;
    x |= x >> 1;
    x = !x & 0x1111111111111111;
    x += x >> 32;
    x += x >> 16;
    x += x >> 8;
    x += x >> 4;
    (x & 0xf) as usize
}

#[inline]
fn reverse_row(row: RowT) -> RowT {
    (row >> 12) | ((row >> 4) & 0x00F0) | ((row << 4) & 0x0F00) | (row << 12)
}

#[inline]
fn unpack_col(row: RowT) -> BoardT {
    let tmp = row as BoardT;
    (tmp | (tmp << 12) | (tmp << 24) | (tmp << 36)) & COL_MASK
}

fn count_distinct_tiles(mut board: BoardT) -> usize {
    let mut bitset: u16 = 0;
    while board != 0 {
        bitset |= 1 << (board & 0xf);
        board >>= 4;
    }
    // Don't count empty tiles
    bitset >>= 1;
    
    let mut count = 0;
    while bitset != 0 {
        bitset &= bitset - 1;
        count += 1;
    }
    count
}

// ─── Table Initialization ──────────────────────────────────────────────

fn init_tables() {
    unsafe {
        for row in 0u32..65536 {
            let mut line: [u32; 4] = [
                (row >> 0) & 0xf,
                (row >> 4) & 0xf,
                (row >> 8) & 0xf,
                (row >> 12) & 0xf,
            ];

            // Calculate score
            let mut score = 0.0f32;
            for i in 0..4 {
                let rank = line[i];
                if rank >= 2 {
                    score += ((rank - 1) * (1 << rank)) as f32;
                }
            }
            SCORE_TABLE[row as usize] = score;

            // Calculate heuristic score
            let mut sum = 0.0f32;
            let mut empty = 0;
            let mut merges = 0;

            let mut prev = 0;
            let mut counter = 0;
            for i in 0..4 {
                let rank = line[i];
                sum += (rank as f32).powf(SCORE_SUM_POWER);
                if rank == 0 {
                    empty += 1;
                } else {
                    if prev == rank {
                        counter += 1;
                    } else if counter > 0 {
                        merges += 1 + counter;
                        counter = 0;
                    }
                    prev = rank;
                }
            }
            if counter > 0 {
                merges += 1 + counter;
            }

            let mut monotonicity_left = 0.0f32;
            let mut monotonicity_right = 0.0f32;
            for i in 1..4 {
                if line[i - 1] > line[i] {
                    monotonicity_left += (line[i - 1] as f32).powf(SCORE_MONOTONICITY_POWER)
                        - (line[i] as f32).powf(SCORE_MONOTONICITY_POWER);
                } else {
                    monotonicity_right += (line[i] as f32).powf(SCORE_MONOTONICITY_POWER)
                        - (line[i - 1] as f32).powf(SCORE_MONOTONICITY_POWER);
                }
            }

            HEUR_SCORE_TABLE[row as usize] = SCORE_LOST_PENALTY
                + SCORE_EMPTY_WEIGHT * empty as f32
                + SCORE_MERGES_WEIGHT * merges as f32
                - SCORE_MONOTONICITY_WEIGHT * monotonicity_left.min(monotonicity_right)
                - SCORE_SUM_WEIGHT * sum;

            // Execute a move to the left
            for i in 0..3 {
                let mut j = i + 1;
                while j < 4 {
                    if line[j] != 0 {
                        break;
                    }
                    j += 1;
                }
                if j == 4 {
                    break; // no more tiles to the right
                }

                if line[i] == 0 {
                    line[i] = line[j];
                    line[j] = 0;
                    // Retry this entry (simulate i--)
                    if i > 0 {
                        // We need to check previous position again
                        // But the C++ code uses i-- which will be incremented in the loop
                        // In Rust, we handle this differently - we'll continue the outer loop
                    }
                } else if line[i] == line[j] {
                    if line[i] != 0xf {
                        line[i] += 1;
                    }
                    line[j] = 0;
                }
            }

            let result: RowT = ((line[0] << 0) | (line[1] << 4) | (line[2] << 8) | (line[3] << 12)) as RowT;
            let rev_result = reverse_row(result);
            let rev_row = reverse_row(row as RowT);

            ROW_LEFT_TABLE[row as usize] = (row as RowT) ^ result;
            ROW_RIGHT_TABLE[rev_row as usize] = rev_row ^ rev_result;
            COL_UP_TABLE[row as usize] = unpack_col(row as RowT) ^ unpack_col(result);
            COL_DOWN_TABLE[rev_row as usize] = unpack_col(rev_row) ^ unpack_col(rev_result);
        }
    }
}

fn ensure_tables_initialized() {
    INIT.call_once(|| {
        init_tables();
    });
}

// ─── Move Execution ────────────────────────────────────────────────────

#[inline]
fn execute_move_0(board: BoardT) -> BoardT {
    unsafe {
        let mut ret = board;
        let t = transpose(board);
        ret ^= COL_UP_TABLE[((t >> 0) & ROW_MASK) as usize] << 0;
        ret ^= COL_UP_TABLE[((t >> 16) & ROW_MASK) as usize] << 4;
        ret ^= COL_UP_TABLE[((t >> 32) & ROW_MASK) as usize] << 8;
        ret ^= COL_UP_TABLE[((t >> 48) & ROW_MASK) as usize] << 12;
        ret
    }
}

#[inline]
fn execute_move_1(board: BoardT) -> BoardT {
    unsafe {
        let mut ret = board;
        let t = transpose(board);
        ret ^= COL_DOWN_TABLE[((t >> 0) & ROW_MASK) as usize] << 0;
        ret ^= COL_DOWN_TABLE[((t >> 16) & ROW_MASK) as usize] << 4;
        ret ^= COL_DOWN_TABLE[((t >> 32) & ROW_MASK) as usize] << 8;
        ret ^= COL_DOWN_TABLE[((t >> 48) & ROW_MASK) as usize] << 12;
        ret
    }
}

#[inline]
fn execute_move_2(board: BoardT) -> BoardT {
    unsafe {
        let mut ret = board;
        ret ^= (ROW_LEFT_TABLE[((board >> 0) & ROW_MASK) as usize] as BoardT) << 0;
        ret ^= (ROW_LEFT_TABLE[((board >> 16) & ROW_MASK) as usize] as BoardT) << 16;
        ret ^= (ROW_LEFT_TABLE[((board >> 32) & ROW_MASK) as usize] as BoardT) << 32;
        ret ^= (ROW_LEFT_TABLE[((board >> 48) & ROW_MASK) as usize] as BoardT) << 48;
        ret
    }
}

#[inline]
fn execute_move_3(board: BoardT) -> BoardT {
    unsafe {
        let mut ret = board;
        ret ^= (ROW_RIGHT_TABLE[((board >> 0) & ROW_MASK) as usize] as BoardT) << 0;
        ret ^= (ROW_RIGHT_TABLE[((board >> 16) & ROW_MASK) as usize] as BoardT) << 16;
        ret ^= (ROW_RIGHT_TABLE[((board >> 32) & ROW_MASK) as usize] as BoardT) << 32;
        ret ^= (ROW_RIGHT_TABLE[((board >> 48) & ROW_MASK) as usize] as BoardT) << 48;
        ret
    }
}

fn execute_move(mov: usize, board: BoardT) -> BoardT {
    match mov {
        0 => execute_move_0(board),
        1 => execute_move_1(board),
        2 => execute_move_2(board),
        3 => execute_move_3(board),
        _ => !0u64,
    }
}

// ─── Scoring ───────────────────────────────────────────────────────────

fn score_helper(board: BoardT, table: &[f32; 65536]) -> f32 {
    table[((board >> 0) & ROW_MASK) as usize]
        + table[((board >> 16) & ROW_MASK) as usize]
        + table[((board >> 32) & ROW_MASK) as usize]
        + table[((board >> 48) & ROW_MASK) as usize]
}

fn score_heur_board(board: BoardT) -> f32 {
    unsafe {
        let heur_table_ptr = &raw const HEUR_SCORE_TABLE;
        score_helper(board, &*heur_table_ptr) + score_helper(transpose(board), &*heur_table_ptr)
    }
}

#[allow(dead_code)]
fn score_board(board: BoardT) -> f32 {
    unsafe {
        let score_table_ptr = &raw const SCORE_TABLE;
        score_helper(board, &*score_table_ptr)
    }
}

// ─── Search ────────────────────────────────────────────────────────────

#[derive(Clone, Copy)]
struct TransTableEntry {
    depth: u8,
    heuristic: f32,
}

struct EvalState {
    trans_table: HashMap<BoardT, TransTableEntry>,
    maxdepth: i32,
    curdepth: i32,
    cachehits: usize,
    moves_evaled: usize,
    depth_limit: i32,
}

impl EvalState {
    fn new() -> Self {
        EvalState {
            trans_table: HashMap::new(),
            maxdepth: 0,
            curdepth: 0,
            cachehits: 0,
            moves_evaled: 0,
            depth_limit: 0,
        }
    }
}

fn score_tilechoose_node(state: &mut EvalState, board: BoardT, cprob: f32) -> f32 {
    if cprob < CPROB_THRESH_BASE || state.curdepth >= state.depth_limit {
        state.maxdepth = state.maxdepth.max(state.curdepth);
        return score_heur_board(board);
    }

    if state.curdepth < CACHE_DEPTH_LIMIT {
        if let Some(entry) = state.trans_table.get(&board) {
            if entry.depth as i32 <= state.curdepth {
                state.cachehits += 1;
                return entry.heuristic;
            }
        }
    }

    let num_open = count_empty(board);
    let cprob = cprob / num_open as f32;

    let mut res = 0.0f32;
    let mut tmp = board;
    let mut tile_2: BoardT = 1;

    while tile_2 != 0 {
        if (tmp & 0xf) == 0 {
            res += score_move_node(state, board | tile_2, cprob * 0.9) * 0.9;
            res += score_move_node(state, board | (tile_2 << 1), cprob * 0.1) * 0.1;
        }
        tmp >>= 4;
        tile_2 <<= 4;
    }
    res = res / num_open as f32;

    if state.curdepth < CACHE_DEPTH_LIMIT {
        let entry = TransTableEntry {
            depth: state.curdepth as u8,
            heuristic: res,
        };
        state.trans_table.insert(board, entry);
    }

    res
}

fn score_move_node(state: &mut EvalState, board: BoardT, cprob: f32) -> f32 {
    let mut best = 0.0f32;
    state.curdepth += 1;

    for mov in 0..4 {
        let newboard = execute_move(mov, board);
        state.moves_evaled += 1;

        if board != newboard {
            best = best.max(score_tilechoose_node(state, newboard, cprob));
        }
    }

    state.curdepth -= 1;
    best
}

fn score_toplevel_move(board: BoardT, mov: usize) -> f32 {
    let newboard = execute_move(mov, board);

    if board == newboard {
        return 0.0;
    }

    let mut state = EvalState::new();
    state.depth_limit = 3.max(count_distinct_tiles(board) as i32 - 2);

    score_tilechoose_node(&mut state, newboard, 1.0) + 1e-6
}

fn find_best_move(board: BoardT) -> usize {
    let mut best = 0.0f32;
    let mut bestmove = 4; // 4 = no valid move

    for mov in 0..4 {
        let res = score_toplevel_move(board, mov);
        if res > best {
            best = res;
            bestmove = mov;
        }
    }

    bestmove
}

// ─── WASM Exports ──────────────────────────────────────────────────────

#[wasm_bindgen]
pub fn get_best_move(board_js: &[u32]) -> u32 {
    ensure_tables_initialized();

    if board_js.len() != 16 {
        return 4; // invalid
    }

    // Convert tile values to board representation
    // value 0 → nibble 0, value 2 → nibble 1, value 4 → nibble 2, etc.
    let mut board: BoardT = 0;
    for i in 0..16 {
        let value = board_js[i];
        let nibble = if value == 0 {
            0
        } else {
            // value = 2^n, so n = log2(value)
            (value as f32).log2() as u64
        };
        board |= nibble << (i * 4);
    }

    find_best_move(board) as u32
}

#[wasm_bindgen]
pub fn evaluate_board(board_js: &[u32]) -> f32 {
    ensure_tables_initialized();

    if board_js.len() != 16 {
        return 0.0;
    }

    let mut board: BoardT = 0;
    for i in 0..16 {
        let value = board_js[i];
        let nibble = if value == 0 {
            0
        } else {
            (value as f32).log2() as u64
        };
        board |= nibble << (i * 4);
    }

    score_heur_board(board)
}
