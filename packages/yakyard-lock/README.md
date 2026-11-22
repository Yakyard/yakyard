# yakyard-lock

End-to-end encryption for [Yakyard](../../README.md)'s locked conversations. It runs in the browser: Olm and Megolm from [vodozemac](https://github.com/matrix-org/vodozemac) (compiled to WebAssembly), plus recovery keys, an encrypted key backup, device approval and per-person device signing.

Copyright 2026 QVINTA Ltd. Licensed under the [Apache License 2.0](LICENSE), unlike the rest of Yakyard (PolyForm Shield), so anyone can audit it, fix it and reuse it.

> **Not independently audited yet.** vodozemac itself was audited by Least Authority (2022). This package, the code that decides who gets which key, has not been. Reviews and reports are welcome: see Yakyard's [SECURITY.md](../../SECURITY.md).

## What's in it

| Path | What |
|---|---|
| `crypto/` | A 250-line Rust crate exposing the parts of vodozemac 0.11.2 Yakyard uses, through `wasm-bindgen` |
| `dist/` | The built WebAssembly (333 KB, 131 KB gzipped) and its JavaScript glue |
| `src/lock.js` | The engine: devices, the person's signing key, Olm sessions, Megolm sessions with rotation, the key backup, files |
| `src/store-idb.js` | Storage on the device: IndexedDB, sealed with a non-extractable AES-256-GCM key |
| `test/` | Unit tests against an in-memory stand-in for the server (`npm test`) |

No DOM code and no network code of its own: the app passes in `api` (fetch JSON from the Yakyard server), `store` and the WebAssembly module.

## How it works, in short

- **Devices.** Each browser is a device with an Olm account. Private keys stay on it.
- **People.** A recovery key (32 random bytes and a checksum, written as 53 characters) turns into an Ed25519 signing key and an AES-256-GCM backup key (HKDF-SHA256). The signing key signs each of the person's devices. Others only send keys to signed devices, and pin the signing key the first time they see it.
- **Messages.** One Megolm session per sending device per conversation, shared over Olm to every signed device of every member. A new session starts when any device that had the old one is gone (someone left or was removed), after 100 messages, and after 7 days. The conversation id and the sender's id are inside the signed payload; the reader checks both, and refuses replays.
- **Files.** A fresh AES-256-GCM key per file, carried inside the encrypted message.
- **Backup.** Every Megolm key a device holds is encrypted with the backup key and stored on the server, so a new device with the recovery key can read older messages.
- **Approval.** A device that holds the recovery key can approve a new one after the person compares a 20-digit code on both screens.

## Threat model, summary

The server (and its admin, and anyone with the database) sees who is in a conversation, who sent what when, sizes, and who reacted or was mentioned. It never sees message text, reactions' emoji, file contents or names, or keys. It can't add a device to someone's account without their signing key. It could still drop messages, add a member to a channel (visible in the member list), show a changed signing key to someone who never pinned the old one, or send changed app code: the app shows a security code per release to make that visible. Full version: [docs/E2EE.md](../../docs/E2EE.md#threat-model).

## Build and test

```bash
npm run build:wasm   # needs Rust with the wasm32-unknown-unknown target and wasm-bindgen-cli 0.2.100
npm test
```

In Yakyard, `npm run lock:build` rebuilds and copies the files to `public/lock/`, and `npm run lock:sync` copies them and updates the manifest and `docs/E2EE-HASHES.md`.
