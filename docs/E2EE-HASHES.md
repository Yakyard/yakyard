# Locking code per release

Each Yakyard release lists the security code of its locking code and the SHA-256 of every file behind it. The app shows the same code after an update (see [E2EE.md](E2EE.md#code-delivered-by-the-server)). To check a running Yakyard against this release: `npm run lock:verify -- https://your-yakyard`.

## Yakyard 2.2.1 (yakyard-lock 1.0.0)

Security code: **65AF-0FCF-2AF9-AA5B**

| File | SHA-256 |
|---|---|
| `/lock/lock.js` | `b4ba922a67cc4d9cbd891e1bb5a189d22cea0708f32f5f4dc5422b445fbe0af3` |
| `/lock/store-idb.js` | `ec8323fe7478c07ae50eac21741dd5792d01275b2562be5b73b36ff2db65193d` |
| `/lock/yakyard-crypto.js` | `f9847c7870c29ed7187348a1bada2cfd6c73b838e63108c4b333b81e7f8dec8e` |
| `/lock/yakyard-crypto_bg.wasm` | `fa7877cdfd3d64950f75159f6f974ed5b617e4e8f8604e503fddf3335b0840bf` |
| `/locked.js` | `6fa0fbc55944218ef76db13da6ba09964d9180dec189bb44cb3546fca720d6e7` |
