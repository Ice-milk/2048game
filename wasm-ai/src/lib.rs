use wasm_bindgen::prelude::*;

// ─── Constants ─────────────────────────────────────────────────────────

const SNAKE_WEIGHTS: [[f64; 4]; 4] = [
    [0.0,  1.0,  2.0,  3.0],
    [7.0,  6.0,  5.0,  4.0],
    [8.0,  9.0,  10.0, 11.0],
    [15.0, 14.0, 13.0, 12.0],
];
const CORNER_R: usize = 3;
const CORNER_C: usize = 0;
type Board = [u32; 16];

// ─── Board ────────────────────────────────────────────────────────────

fn empty_cells(b: &Board) -> Vec<usize> {
    (0..16).filter(|&i| b[i] == 0).collect()
}

fn slide_row(row: &[u32; 4]) -> ([u32; 4], u32) {
    let mut r = [0u32; 4];
    let mut sc = 0u32;
    let mut p = 0usize;
    for i in 0..4 {
        if row[i] == 0 { continue; }
        if p > 0 && r[p-1] == row[i] { r[p-1] *= 2; sc += r[p-1]; }
        else { r[p] = row[i]; p += 1; }
    }
    (r, sc)
}

fn move_board(b: &Board, dir: u8) -> (Board, u32, bool) {
    let mut n = *b;
    let mut sc = 0u32;
    let mut mv = false;
    match dir {
        0 => for c in 0..4 {
            let v = [n[c], n[c+4], n[c+8], n[c+12]];
            let (s, score) = slide_row(&v); sc += score;
            for r in 0..4 { if n[r*4+c] != s[r] { mv = true; } n[r*4+c] = s[r]; }
        },
        1 => for c in 0..4 {
            let v = [n[12+c], n[8+c], n[4+c], n[c]];
            let (s, score) = slide_row(&v); sc += score;
            let rev = [s[3],s[2],s[1],s[0]];
            for r in 0..4 { if n[r*4+c] != rev[r] { mv = true; } n[r*4+c] = rev[r]; }
        },
        2 => for r in 0..4 {
            let s = r*4; let v = [n[s],n[s+1],n[s+2],n[s+3]];
            let (sl, score) = slide_row(&v); sc += score;
            for c in 0..4 { if n[s+c] != sl[c] { mv = true; } n[s+c] = sl[c]; }
        },
        3 => for r in 0..4 {
            let s = r*4; let v = [n[s+3],n[s+2],n[s+1],n[s]];
            let (sl, score) = slide_row(&v); sc += score;
            for c in 0..4 { if n[s+c] != sl[3-c] { mv = true; } n[s+c] = sl[3-c]; }
        },
        _ => {}
    }
    (n, sc, mv)
}

// ─── Evaluate ──────────────────────────────────────────────────────────

fn evaluate(b: &Board) -> f64 {
    let mut empty = 0u32; let mut max_tile = 0u32;
    let mut snake = 0.0f64; let mut smooth = 0.0f64;

    for i in 0..4 { for j in 0..4 {
        let v = b[i*4+j];
        if v == 0 { empty += 1; continue; }
        if v > max_tile { max_tile = v; }
        snake += v as f64 * SNAKE_WEIGHTS[i][j];
        if j < 3 && b[i*4+j+1] != 0 { smooth -= (v as f64 - b[i*4+j+1] as f64).abs(); }
        if i < 3 && b[(i+1)*4+j] != 0 { smooth -= (v as f64 - b[(i+1)*4+j] as f64).abs(); }
    }}

    let (mut mono_l, mut mono_r) = (0.0, 0.0);
    for i in 0..4 { let (mut inc, mut dec) = (0.0, 0.0);
        let s = i*4;
        for j in 0..3 {
            let a = b[s+j] as f64; let bv = b[s+j+1] as f64;
            if a >= bv { dec += a - bv; } if a <= bv { inc += bv - a; }
        } mono_l += inc.max(dec);
    }
    for j in 0..4 { let (mut inc, mut dec) = (0.0, 0.0);
        for i in 0..3 {
            let a = b[i*4+j] as f64; let bv = b[(i+1)*4+j] as f64;
            if a >= bv { dec += a - bv; } if a <= bv { inc += bv - a; }
        } mono_r += inc.max(dec);
    }

    // Corner + scatter
    let corner = if b[CORNER_R*4+CORNER_C] == max_tile { max_tile as f64 * 2.0 } else { 0.0 };
    let mut scatter = 0.0;
    for i in 0..4 { for j in 0..4 {
        let v = b[i*4+j];
        if v >= 128 { scatter -= v as f64 * (i as f64 - CORNER_R as f64).abs() * 0.2; }
    }}

    let ew = if empty <= 2 { 420.0 } else if empty <= 5 { 320.0 } else { 270.0 };

    snake * 0.8 + mono_l * 1.2 + mono_r * 1.2 + smooth * 0.12
        + scatter * 1.0 + corner * 0.5 + empty as f64 * ew
        + (max_tile as f64 + 1.0).log2() * 50.0
}

// ─── Adaptive Depth ────────────────────────────────────────────────────

fn adepth(empty: usize) -> i32 {
    if empty >= 12 { 2 } else if empty >= 8 { 3 }
    else if empty >= 4 { 4 } else { 5 }
}

// ─── Expectimax (compact, no TT overhead) ─────────────────────────────

fn expectimax(b: &Board, depth: i32, player: bool, a: f64, bv: f64) -> f64 {
    if depth == 0 { return evaluate(b); }

    if player {
        let mut best = f64::NEG_INFINITY; let mut alpha = a;
        for d in 0u8..4 {
            let (nb, _, moved) = move_board(b, d);
            if !moved { continue; }
            let score = chance(&nb, depth, alpha, bv);
            if score > best { best = score; }
            if score > alpha { alpha = score; }
            if alpha >= bv { break; }
        }
        if best.is_infinite() { -1e9 } else { best }
    } else {
        chance(b, depth, a, bv)
    }
}

fn chance(b: &Board, depth: i32, alpha: f64, beta: f64) -> f64 {
    let empty = empty_cells(b);
    if empty.is_empty() { return evaluate(b); }

    let nd = depth - 1;
    // 激进采样：每 CHANCE 节点最多 3 格 × 2 = 6 分支
    let n = empty.len().min(3);

    let mut total = 0.0;
    for k in 0..n {
        let pos = empty[k];
        let mut b2 = *b; b2[pos] = 2;
        total += expectimax(&b2, nd, true, alpha, beta) * 0.9;
        let mut b4 = *b; b4[pos] = 4;
        total += expectimax(&b4, nd, true, alpha, beta) * 0.1;
    }
    if n < empty.len() { total *= empty.len() as f64 / n as f64; }
    total / empty.len() as f64
}

// ─── WASM Export ───────────────────────────────────────────────────────

#[wasm_bindgen]
pub fn get_best_move(board_js: &[u32]) -> u8 {
    if board_js.len() != 16 { return 4; }
    let mut b: Board = [0u32; 16];
    b.copy_from_slice(board_js);

    let depth = adepth(empty_cells(&b).len());
    let (mut best_dir, mut best_score) = (4u8, f64::NEG_INFINITY);

    // Pre-sort candidates
    let mut cand: Vec<(u8, f64)> = Vec::new();
    for d in 0u8..4 {
        let (mb, _, moved) = move_board(&b, d);
        if moved { cand.push((d, evaluate(&mb))); }
    }
    cand.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());

    for (d, _) in cand {
        let (mb, _, _) = move_board(&b, d);
        let score = chance(&mb, depth, f64::NEG_INFINITY, f64::INFINITY);
        if score > best_score { best_score = score; best_dir = d; }
    }
    best_dir
}
