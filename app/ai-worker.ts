// AI Worker — 在独立线程运行 Rust WASM expectimax
// 接收 WASM 二进制 + 盘面，返回最佳移动方向

let wasmExports: any = null;
let memory: WebAssembly.Memory;

interface WorkerRequest {
  type: 'init' | 'search';
  wasmBytes?: ArrayBuffer;
  board?: number[];
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const { type } = e.data;

  if (type === 'init' && e.data.wasmBytes) {
    // 从主线程接收 WASM 二进制，实例化
    const imports = {
      './wasm_ai_bg.js': {
        __wbg___wbindgen_throw_9c75d47bf9e7731e: (ptr: number, len: number) => {
          throw new Error(decodeStr(ptr, len));
        },
        __wbindgen_init_externref_table: () => {
          const table = wasmExports.__wbindgen_externrefs as WebAssembly.Table;
          const offset = table.grow(4);
          table.set(0, undefined);
          table.set(offset + 0, undefined);
          table.set(offset + 1, null);
          table.set(offset + 2, true);
          table.set(offset + 3, false);
        },
      },
    };

    const module = await WebAssembly.instantiate(e.data.wasmBytes, imports);
    wasmExports = module.instance.exports;
    memory = wasmExports.memory as WebAssembly.Memory;

    // 启动 WASM
    if (typeof wasmExports.__wbindgen_start === 'function') {
      wasmExports.__wbindgen_start();
    }

    self.postMessage({ type: 'ready' });
    return;
  }

  if (type === 'search' && wasmExports && e.data.board) {
    const board = e.data.board;
    // 分配 WASM 内存，写入 16 个 u32
    const bytesPerElement = 4;
    const ptr = (wasmExports.__wbindgen_malloc as Function)(board.length * bytesPerElement, bytesPerElement) >>> 0;
    const view = new Uint32Array(memory.buffer, ptr, board.length);
    view.set(board);

    // 调用 Rust 函数: get_best_move(ptr, len) -> u8
    const dirCode: number = (wasmExports.get_best_move as Function)(ptr, board.length);

    const dirMap: Record<number, string | null> = {
      0: 'up', 1: 'down', 2: 'left', 3: 'right',
    };

    self.postMessage({
      type: 'result',
      direction: dirMap[dirCode] ?? null,
    });
  }
};

function decodeStr(ptr: number, len: number): string {
  const bytes = new Uint8Array(memory.buffer, ptr, len);
  return new TextDecoder('utf-8').decode(bytes);
}
