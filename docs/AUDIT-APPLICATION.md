# Security audit application: Open Technology Fund, Security Lab

Draft, ready to submit through OTF's Security Lab request form (https://www.opentech.fund/labs/security-lab/). Fill in the bracketed contact line before sending.

## Project

**Name:** Yakyard, locked conversations (`packages/yakyard-lock`)

**Website and code:** https://github.com/yakyard/yakyard

**Contact:** through GitHub (open an issue marked Question, or a private security advisory for anything sensitive). [Name and email of the person submitting.]

**Organization:** QVINTA Ltd, which maintains Yakyard. Yakyard is free for any team to run; the encryption package is Apache-2.0.

## Summary

Yakyard is team chat that anyone can run on their own Cloudflare account, for free, without a server. A small team deploys it with one command or one button, and it fits Cloudflare's free plan for up to about 50 people. It has channels, threads, DMs, calls and voice notes.

Version 2 adds locked conversations: DMs and private channels with end-to-end encryption. Messages, edits, reactions, files and voice notes are encrypted in the browser with Olm and Megolm (vodozemac, the library inside Element), compiled to WebAssembly. The server only stores ciphertext, relays sealed key packages between devices and keeps a key backup encrypted with each person's recovery key.

We'd like an independent review of the code we wrote around vodozemac: the part that decides which devices get which keys.

## Why it matters for privacy and internet freedom

- **Private chat without a provider.** Small organizations, newsrooms, NGOs, unions and community groups often end up on a commercial chat service because running their own (Matrix, Mattermost) needs a server and someone to look after it. Yakyard needs neither, and costs nothing at that size. Locked conversations mean that even whoever holds the cloud account can't read the sensitive ones.
- **Protection from the operator.** In a workspace, the person who runs the chat is often an employer or an organizer. Locked conversations protect members from that person too, and from anyone who gets into the cloud account or a database backup.
- **Reusable.** The encryption package is Apache-2.0, written to be lifted into other web apps that want Megolm without a full Matrix stack. A reviewed version helps more than Yakyard.
- **Honest limits.** The app tells people, in plain words, what locking changes and what the server still sees (who talks to whom and when). We want the review to check that those words are true.

## Threat model

Full version: [docs/E2EE.md](E2EE.md#threat-model). In short:

- **Adversary:** the server operator, the cloud account holder, or anyone with a copy of the database or backups; also removed members and other members acting in bad faith.
- **Should not be possible:** reading locked messages, files or reactions on the server; adding a device to someone's account without their recovery key; a removed member reading messages sent after removal; a member or the server making a message look like it came from someone else; a new device reading old messages without the recovery key or approval from an existing device.
- **Accepted, and documented:** metadata (membership, timing, sizes, who reacted or was mentioned); the server can drop messages or add a member to a channel (visible to members); trust on first use of each person's signing key (with safety codes to compare); the server delivers the web app's code (mitigated by a per-release security code shown in the app, published hashes and a verify script, not prevented).

## Scope we're asking to review

1. `packages/yakyard-lock/src/lock.js` (437 lines, JavaScript): devices, the per-person signing key derived from the recovery key, Olm session handling, Megolm session sharing and rotation, sender and replay checks, key backup, device approval.
2. `packages/yakyard-lock/src/store-idb.js` (67 lines): on-device storage with a non-extractable WebCrypto key.
3. `packages/yakyard-lock/crypto/src/lib.rs` (255 lines, Rust): the wasm-bindgen wrapper around vodozemac 0.11.2.
4. Key distribution and recovery flows on the server: `src/e2ee.js` (303 lines, JavaScript, Cloudflare Workers), plus the locked-message rules in `src/worker.js` (`postMessage`, reactions, edits).
5. The app glue that handles decrypted content and files: `public/locked.js` (488 lines).

About 1,550 lines of our own code. vodozemac itself is out of scope (audited by Least Authority in 2022), unless the review finds we use it wrongly.

**Languages:** JavaScript (browser and Cloudflare Workers), Rust (WebAssembly).

**Tests already in place:** unit tests for encryption, rotation on removal, new members, new devices with and without the recovery key, device approval, fake devices, changed signing keys, sender relabeling, the all-zero key; server tests for every approval path and the key relay rules; checks against a running server with real browsers that stored rows, the key relay and the backup never hold plaintext.

## Prior reviews

None of Yakyard's own code. vodozemac: Least Authority, 2022, no significant findings. We pin vodozemac 0.11.2, which includes the 2026 fixes (non-contributory Diffie-Hellman rejected, strict Ed25519, decoding panic, zeroization).

## What we'd do with the results

Fix everything found before calling locked conversations stable, publish the report in the repository, and credit the reviewers. Findings would go into the threat model and the tests.
