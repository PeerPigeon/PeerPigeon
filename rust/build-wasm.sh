#!/bin/bash
set -e
wasm-pack build --target web --out-dir ../examples/vue3/public/rust-wasm --release
