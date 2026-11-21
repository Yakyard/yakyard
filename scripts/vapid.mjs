// Makes the key pair for phone notifications. Run: npm run vapid
const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
const raw = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
const pub = Buffer.from(raw).toString('base64url');
console.log('\nPut this in wrangler.toml under [vars]:\n');
console.log(`VAPID_PUBLIC = "${pub}"\n`);
console.log('Then run `npx wrangler secret put VAPID_PRIVATE` and paste this line:\n');
console.log(JSON.stringify(jwk) + '\n');
