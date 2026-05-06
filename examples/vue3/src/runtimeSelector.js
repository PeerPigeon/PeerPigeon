// Runtime selector for Vue UI
export const Runtime = Object.freeze({
  RUST: 'rust',
  GO: 'go',
  VANILLA: 'vanilla',
});

export function loadRuntime(runtime) {
  if (runtime === Runtime.RUST) {
    return import('../public/rust-wasm/peerpigeon_rs.js');
  } else if (runtime === Runtime.GO) {
    return import('../public/wasm_exec.js').then(() => import('../public/go-wasm.js'));
  } else {
    return Promise.resolve(window.VanillaPeerPigeon);
  }
}
