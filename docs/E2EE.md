<!-- nav -->
<p><a href="../README.md"><img src="brand/yakyard-app-icon.svg" width="20" height="20" alt="" align="top">&nbsp; <b>Yakyard</b></a> &nbsp;/&nbsp; <a href="WHY-YAKYARD.md">Why</a> · <a href="PROS-AND-CONS.md">Pros and cons</a> · <a href="COMPARE.md">Compare</a> · <a href="FAQ.md">FAQ</a> · <a href="SETUP.md">Setup</a> · <a href="GUIDE.md">Guide</a> · <a href="TECHNICAL.md">Technical</a> · <b>Locked conversations</b> · <a href="PRESS-KIT.md">Press kit</a></p>
<!-- /nav -->

# Locked conversations: how they work

**Preview:** the encryption library is audited, Yakyard's own code around it is not yet. We have applied for an independent audit.

A locked conversation is a DM or private channel that only the people in it can read. Messages, edits, reactions, files and voice notes are scrambled on the sender's device and unscrambled on the readers' devices. The server only ever stores and passes on the scrambled version.

**In plain words, before you lock:**
- Your admin, the server and anyone with your Cloudflare account can't read a locked conversation. Neither can we.
- They can still see who is in it, who writes and when, and how big files are.
- Search only finds messages already on your device. Phone notifications say "New message in a locked conversation", nothing more. Voice notes have no transcript. Link previews and scheduled messages are off. The Slack import can't add to it.
- You get a recovery key. If you lose every device **and** that key, your locked messages are gone for good. Nobody can get them back, not even your admin.
- A locked conversation stays locked. To stop, start a new normal one.

> **What the preview means.** The encryption library underneath (vodozemac) was audited in 2022. Yakyard's own code around it (how devices share access, the recovery key, device approval, `packages/yakyard-lock`) hasn't had an outside review. We applied for one ([AUDIT-APPLICATION.md](AUDIT-APPLICATION.md)). Until then, use locked conversations for private team talk, not for secrets that could put someone in danger.

The rest of this page is technical, for people who want to check how it works.

- [What the person sees](#what-the-person-sees)
- [Turning it on](#turning-it-on)
- [Which library, and why](#which-library-and-why)
- [Design](#design)
- [Threat model](#threat-model)
- [Code delivered by the server](#code-delivered-by-the-server)
- [What doesn't work in locked conversations](#what-doesnt-work-in-locked-conversations)
- [Voice transcripts in the browser: measured, not shipped](#voice-transcripts-in-the-browser-measured-not-shipped)
- [Free plan](#free-plan)
- [Files and tests](#files-and-tests)

## What the person sees

- **Lock it** when you start a DM or a private channel. Only then: public channels can't be locked, and you can't lock a conversation that already exists (its old messages are already on the server).
- **Two approvals, never one click.** Step 1 lists what works and what doesn't, side by side, with an "I understand" box. Step 2 asks you to type the channel name (or `lock` for a DM). Then a second person approves: an admin or the owner for a channel (not the person who asked, unless they're the only admin), and everyone in it for a DM. Until then the conversation shows "Waiting…" and nobody can post.
- **Recorded.** Each request, acceptance and approval is a line in the conversation, with who and when.
- **Can't be unlocked.** To stop, start a new normal conversation.
- **Recovery key.** The first time, you get a recovery key of 53 letters and numbers. You copy or download it, then type its last group (5 characters) to show you saved it. It opens your locked conversations on a new device. Lose every device and the key, and those messages are gone for good: nobody can get them back, the admin included. The app says this on the key screen and in the "What's different here?" list.
- **New device.** Enter the recovery key, or approve the new device from one you already use, after checking that both show the same 20-digit code.
- **In the conversation:** a "Locked" tag in the header, a lock banner with "What's different here?" and "Search here", and notes right where a limit applies (search, voice notes, link previews, Slack import).

Screens and steps for people: [GUIDE.md](GUIDE.md#locked-conversations). For the owner setting: [SETUP.md](SETUP.md#12-optional-locked-conversations).

## Turning it on

Off by default. The owner turns it on in **Admin**, **Locked conversations**, **Turn on…**, with the same two steps (understand, then type `lock`). Turning it off later stops new locked conversations; existing ones stay locked.

## Which library, and why

We needed something battle-tested, browser-ready, small enough for phones, and under a permissive license (Yakyard is PolyForm Shield, so no AGPL or GPL code, which rules out libsignal).

| Option | License (checked in each repo, 22 Nov 2026) | Track record | In the browser | Verdict |
|---|---|---|---|---|
| **vodozemac** (Olm + Megolm), Matrix.org | Apache-2.0 | Runs end-to-end encryption in Element and every matrix-rust-sdk client. Audited by Least Authority (2022, no significant findings). Security fixes through 0.11.2 (Nov 2026). | Rust, compiles to WebAssembly. Our own 250-line binding: 333 KB, 131 KB gzipped. | **Chosen** |
| **mls-rs** (MLS, RFC 9420), AWS | Apache-2.0 OR MIT | Production at AWS. MLS scales better for large groups. | Has a WebCrypto provider, but no JavaScript bindings: we'd write and maintain the whole group-state binding ourselves, plus a delivery service that orders commits, which our relay doesn't do today. | Next candidate when groups grow |
| **ts-mls** (MLS), pure TypeScript | MIT | Its README says it "has not undergone a formal security audit". | Easy to ship | Not for now |
| **matrix-sdk-crypto-wasm** (vodozemac inside the full Matrix crypto machine) | Apache-2.0 | Element Web's crypto | 9.1 MB unpacked, and it expects a Matrix homeserver API | Too heavy, wrong shape |

Why Olm/Megolm over MLS for Yakyard today: Yakyard conversations are small (a DM, or a private channel of a few dozen people), the server is a dumb relay that can't order group commits, and vodozemac is the most widely deployed and reviewed of the options. Megolm's known weaker spots (no forward secrecy within one session, no post-compromise healing until rotation) are covered by rotating sessions on every membership change, after 100 messages and after 7 days.

We pin `vodozemac = "=0.11.2"`: 0.10.0 made Olm's Diffie-Hellman refuse non-contributory (identity) keys and made Ed25519 checks strict, and 0.11.2 fixed a decoding panic and zeroization gaps (GHSA-pqp6-f7wc-6498, GHSA-mxcm-mrw6-c446, GHSA-v27v-f96q-qhjq). A unit test checks that the all-zero public key is refused.

How Element does the same jobs, and what we copied: per-device Olm accounts with one-time and fallback keys; Megolm sessions per sender per room, shared over Olm; a signing key per person that vouches for their devices (Element's cross-signing, simplified to one key); a server-side key backup encrypted with a key derived from a recovery key; device approval by comparing codes. What we left out for now: SAS emoji verification between different people (we show a 20-digit safety code instead), key requests between devices (the backup covers it), and dehydrated devices.

## Design

All of it is in `packages/yakyard-lock` (Apache-2.0, see its [README](../packages/yakyard-lock/README.md)).

**Devices.** Each browser or installed app is a device with its own vodozemac Olm account (Curve25519 identity key, Ed25519 signing key, 50 one-time keys, one fallback key). Private keys never leave the device. On the device they sit in IndexedDB, sealed with an AES-256-GCM key that the browser generated as *non-extractable*: page code can use it but can't read it.

**People.** The recovery key is 32 random bytes plus a checksum byte. HKDF-SHA256 turns it into (1) a per-person Ed25519 signing key and (2) an AES-256-GCM backup key. The signing key signs each of the person's devices (`yy-dev:v1:user:device:curve:ed`). Other people only send keys to devices with a valid signature from that person's signing key, which their device pins the first time it sees it. A changed signing key stops key sharing with that person until someone clicks "trust the new recovery key" in the banner.

**Messages.** Each sending device has one Megolm session per conversation. Before it sends, it checks who is in the conversation (from the server) and which of their devices are signed. New devices get the session key, sealed with Olm, from the current message on. If any device that had the session is gone (someone left, was removed, or removed a device), it starts a new session first, so the removed person never gets the new key. Sessions also rotate after 100 messages and after 7 days. The encrypted payload includes the conversation id; the reader checks it, checks that the session belongs to the person the server says sent the message, and refuses a ciphertext that shows up under a second message id (replay).

**Edits** are a new ciphertext for the same message. **Reactions** are encrypted too (`e2:` plus ciphertext): the server sees that someone reacted, not with what. **Files and voice notes** are encrypted with a fresh AES-256-GCM key each and uploaded as `locked.bin`; the key, name, type, size and voice waveform travel inside the encrypted message. **Mentions**: the sender's app tells the server who was mentioned (not the words), so notifications still work.

**Key backup.** Every Megolm session key a device holds is exported at its first known index, encrypted with the backup key, and stored on the server. A new device with the recovery key downloads and opens them. Approving a new device from an old one hands it the recovery secret over Olm, after both screens show the same 20-digit code.

**Sign-out** deletes the device's keys and its local search copy. Signing in again on that device takes the recovery key.

## Threat model

**The server, its admin, and anyone with the Cloudflare account or a database copy can't see:** message text, edits, reaction emoji, file contents, file names and types, voice audio, waveforms, mention text, link addresses, or the local search copy.

**They can see (metadata):** who is in each locked conversation; who sent a message, when, and in reply to what; message and file sizes (roughly); that a reaction, edit, pin or deletion happened and by whom; who was mentioned (the sender's app tells the server, for notifications); how many devices each person has and when they were last used; the lock requests and approvals; IP addresses in Cloudflare's logs.

**What a malicious server could still try, and what stops it:**

| Attack | What happens |
|---|---|
| Read stored messages, files or backups | Ciphertext only. Keys are on devices; the backup needs the recovery key. |
| Add a fake device to someone's account | Not signed by their signing key, so nobody sends it keys (tested). |
| Swap someone's signing key | Their contacts' apps notice the change and stop sending them keys until a person clicks "trust the new recovery key". The very first key you see for someone is trusted as is (trust on first use): for high-stakes conversations, compare the 20-digit codes under **What's different here?**, **Check it's really them**, in person or on a call. Each device computes them from the key it pinned, not from what the server sends now. |
| Add a person to a locked channel | Membership comes from the server, like in Matrix. The added person gets keys from then on, and shows in the member list. Watch the member list. |
| Replay or move a message to another conversation or sender | Refused: conversation id is inside the ciphertext, sessions are tied to a sender, and replays are caught by message index. |
| Drop or delay messages | Possible. End-to-end encryption doesn't stop a server from not delivering. |
| Send people changed app code | See next section. This is the biggest weak spot of any end-to-end encryption that runs in a web page. |

**Devices.** A stolen unlocked device, malware, or a browser extension with access to the page can read what the person can read. The non-extractable key stops someone who only copies the IndexedDB files. Recovery keys are as sensitive as passwords.

**Calls** (Pop in) go browser to browser over WebRTC, which encrypts media, but the server relays the call setup and isn't prevented from interfering. Calls are not part of the lock, and the app says so.

## Code delivered by the server

In a web app, the server sends the code that does the encryption. A malicious operator could send code that leaks keys. No web app can fully prevent this. What Yakyard does:

- **Release manifest.** `public/lock/manifest.json` lists the SHA-256 of every file that runs the locking code (`lock.js`, `store-idb.js`, the WebAssembly and its glue, `locked.js`). The app checks the WebAssembly against it before running it.
- **Security code in the app.** The app shows a short code made from the manifest: 16 characters in four groups, the first 64 bits of a SHA-256 over every file hash. It remembers it, and when it changes it says "Yakyard was updated. The code that locks your conversations changed" with the old and new code and the version.
- **Published hashes.** Each release lists its security code and file hashes in [E2EE-HASHES.md](E2EE-HASHES.md). `npm run lock:verify -- https://your-yakyard` downloads the files from any running Yakyard and compares them.
- **Reproducible WebAssembly.** `npm run lock:build` rebuilds it from `packages/yakyard-lock/crypto` (Rust, pinned `Cargo.lock`, `wasm-bindgen 0.2.100`), so anyone can check the committed binary. Two builds on the same toolchain gave the same bytes (SHA-256 in [E2EE-HASHES.md](E2EE-HASHES.md)); the 2.0.0 binary was built with rustc 1.97.0.
- **Strict page rules.** The app's Content Security Policy only runs scripts from its own address, plus `'wasm-unsafe-eval'` so WebAssembly can start.

What it can't do: a service worker can't refuse updates to itself (browsers fetch it from the server), so pinning code in the service worker would only move the problem. Code changed on purpose would also change the check. These are detection tools for teams that check, not a guarantee.

## What doesn't work in locked conversations

| Feature | In a locked conversation |
|---|---|
| Search | Only on the device: "Search here" looks through messages this device has already opened. The workspace search skips them and says so. |
| Phone and desktop notifications | "New message in a locked conversation", nothing else. |
| Voice note transcripts | None. Audio plays as usual. The note says "No transcript in locked conversations". |
| Link previews | Off (a preview would tell the server the address). The composer says so when you type a link. |
| Scheduled messages | Off (the server would have to hold the words). |
| Slack import | Never writes into a locked conversation (checked twice: when picking the channel and in the insert itself). The import page says so. |
| Files browser | Locked files aren't listed: their names are inside the encrypted messages. |
| Files over 100 MB | Not in locked conversations (they're encrypted in memory). |
| Reminders on a locked message | Work, but the reminder doesn't copy the message's words. |
| Old messages on a new device | Only with the recovery key or approval from another device. |
| Lost everything | Lose every device and the recovery key, and locked messages are gone for good. |

## Voice transcripts in the browser: measured, not shipped

We looked at running Whisper in the browser with transformers.js (Apache-2.0) and onnxruntime-web (MIT). The smallest usable setup, Whisper tiny with 8-bit weights, is a 10.1 MB encoder, a 30.7 MB decoder and a 14.8 MB WebAssembly runtime: **about 56 MB to download on every device** before the first transcript (sizes from Hugging Face `onnx-community/whisper-tiny.en` and npm `onnxruntime-web` 1.31.1, 22 Nov 2026). Threads need cross-origin isolation headers, and without them it runs on one core. On a mid-range phone that's a long download on mobile data and a hot phone, and tiny's accuracy is well below the `whisper-large-v3-turbo` the server uses for normal conversations. So locked voice notes have no transcript, and the note says so. Worth revisiting when browsers ship built-in speech models.

## Free plan

The server only stores and relays, so locked conversations add no CPU-heavy work. Measured with `npm run cpu-bench` (this computer, cold start, database time excluded; the budget is 7 ms):

| Route | CPU |
|---|---|
| Send a locked message | 2.7 ms |
| Open a locked conversation (50 messages) | 2.8 ms |
| Public keys for a conversation | 2.2 ms |
| Claim one-time keys | 2.1 ms |
| Relay sealed keys to 20 devices | 2.7 ms |
| Read the key inbox | 2.0 ms |
| Back up 100 keys | 3.0 ms |

All encryption runs in the browser. Extra storage: about 1 KB per sealed key package (deleted when picked up, or after 30 days), about 300 bytes per backed-up session.

## Files and tests

| Part | Where |
|---|---|
| Encryption library (Apache-2.0) | `packages/yakyard-lock/` (`src/lock.js`, `src/store-idb.js`, Rust binding in `crypto/`, built files in `dist/`) |
| Copy served to browsers, manifest | `public/lock/`, made by `npm run lock:sync` |
| Screens, two-step approvals, banners | `public/locked.js`, hooks in `public/app.js` |
| Server: keys, relay, backup, approvals | `src/e2ee.js`; message rules in `src/worker.js` (`postMessage`) |
| Tables | `e2ee_identity`, `e2ee_devices`, `e2ee_otk`, `e2ee_inbox`, `e2ee_backup`; `channels.locked`, `messages.enc` in `schema.sql` |
| Tests | `packages/yakyard-lock/test/lock.test.mjs` (encrypt, decrypt, rotation, removal, new devices, approval, fake devices, changed keys, zero key), `test/locked.test.mjs` (approval paths, setting, relay rules, silent pushes, Slack import guard, manifest), `test/security.py` (`LOCK` checks against a running server with real browsers: stored rows hold no plaintext, removed members can't decrypt, a new device without the recovery key can't read old messages) |
