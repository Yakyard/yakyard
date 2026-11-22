//! Yakyard locked conversations: a thin wasm-bindgen layer over vodozemac.
//!
//! Only the pieces Yakyard needs are exposed: an Olm account per device,
//! Olm sessions (to send room keys device to device), Megolm group sessions
//! (to encrypt conversation messages) and Ed25519 for the per-person
//! signing key that vouches for devices. All cryptography is vodozemac's.
//! Pickles are returned as plain JSON so the browser can wrap them with a
//! non-extractable WebCrypto key before they touch IndexedDB.

use vodozemac::megolm::{
    ExportedSessionKey, GroupSession as VGroup, InboundGroupSession as VInbound, MegolmMessage,
    SessionConfig as MegolmConfig, SessionKey,
};
use vodozemac::olm::{Account as VAccount, OlmMessage, Session as VSession, SessionConfig};
use vodozemac::{Curve25519PublicKey, Ed25519PublicKey, Ed25519SecretKey, Ed25519Signature};
use wasm_bindgen::prelude::*;

fn err<E: std::fmt::Display>(e: E) -> JsError {
    JsError::new(&e.to_string())
}

fn megolm_config() -> MegolmConfig {
    MegolmConfig::version_1()
}

#[wasm_bindgen]
pub struct Account(VAccount);

#[wasm_bindgen]
impl Account {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Account {
        Account(VAccount::new())
    }
    pub fn from_pickle(json: &str) -> Result<Account, JsError> {
        Ok(Account(VAccount::from_pickle(serde_json::from_str(json).map_err(err)?)))
    }
    pub fn pickle(&self) -> String {
        serde_json::to_string(&self.0.pickle()).unwrap_or_default()
    }
    pub fn curve25519(&self) -> String {
        self.0.curve25519_key().to_base64()
    }
    pub fn ed25519(&self) -> String {
        self.0.ed25519_key().to_base64()
    }
    pub fn sign(&self, message: &str) -> String {
        self.0.sign(message).to_base64()
    }
    pub fn generate_one_time_keys(&mut self, count: usize) {
        self.0.generate_one_time_keys(count);
    }
    /// JSON object: key id -> base64 public key, unpublished keys only.
    pub fn one_time_keys(&self) -> String {
        let m: std::collections::BTreeMap<String, String> = self
            .0
            .one_time_keys()
            .into_iter()
            .map(|(k, v)| (k.to_base64(), v.to_base64()))
            .collect();
        serde_json::to_string(&m).unwrap_or_default()
    }
    pub fn generate_fallback_key(&mut self) {
        self.0.generate_fallback_key();
    }
    pub fn fallback_key(&self) -> String {
        let m: std::collections::BTreeMap<String, String> = self
            .0
            .fallback_key()
            .into_iter()
            .map(|(k, v)| (k.to_base64(), v.to_base64()))
            .collect();
        serde_json::to_string(&m).unwrap_or_default()
    }
    pub fn mark_keys_as_published(&mut self) {
        self.0.mark_keys_as_published();
    }
    pub fn create_outbound_session(
        &self,
        identity_key: &str,
        one_time_key: &str,
    ) -> Result<Session, JsError> {
        let ik = Curve25519PublicKey::from_base64(identity_key).map_err(err)?;
        let otk = Curve25519PublicKey::from_base64(one_time_key).map_err(err)?;
        Ok(Session(
            self.0
                .create_outbound_session(SessionConfig::version_1(), ik, otk)
                .map_err(err)?,
        ))
    }
    /// Takes a pre-key message (type 0). Returns the new session; the
    /// plaintext is read with `Session::take_plaintext`.
    pub fn create_inbound_session(
        &mut self,
        identity_key: &str,
        body: &str,
    ) -> Result<Session, JsError> {
        let ik = Curve25519PublicKey::from_base64(identity_key).map_err(err)?;
        let bytes = vodozemac::base64_decode(body).map_err(err)?;
        let msg = OlmMessage::from_parts(0, &bytes).map_err(err)?;
        match msg {
            OlmMessage::PreKey(m) => {
                let r = self
                    .0
                    .create_inbound_session(SessionConfig::version_1(), ik, &m)
                    .map_err(err)?;
                let mut s = Session(r.session);
                s.set_plaintext(r.plaintext);
                Ok(s)
            }
            _ => Err(JsError::new("not a pre-key message")),
        }
    }
}

#[wasm_bindgen]
pub struct Session(VSession);

thread_local! {
    static LAST_PLAINTEXT: std::cell::RefCell<Vec<u8>> = const { std::cell::RefCell::new(Vec::new()) };
}

impl Session {
    fn set_plaintext(&mut self, p: Vec<u8>) {
        LAST_PLAINTEXT.with(|c| *c.borrow_mut() = p);
    }
}

#[wasm_bindgen]
impl Session {
    pub fn from_pickle(json: &str) -> Result<Session, JsError> {
        Ok(Session(VSession::from_pickle(serde_json::from_str(json).map_err(err)?)))
    }
    pub fn pickle(&self) -> String {
        serde_json::to_string(&self.0.pickle()).unwrap_or_default()
    }
    pub fn session_id(&self) -> String {
        self.0.session_id()
    }
    /// Plaintext of the pre-key message that created this inbound session.
    pub fn take_plaintext() -> String {
        LAST_PLAINTEXT.with(|c| {
            let v = std::mem::take(&mut *c.borrow_mut());
            String::from_utf8(v).unwrap_or_default()
        })
    }
    /// Returns "type:base64".
    pub fn encrypt(&mut self, plaintext: &str) -> Result<String, JsError> {
        let (t, body) = self.0.encrypt(plaintext).map_err(err)?.to_parts();
        Ok(format!("{}:{}", t, vodozemac::base64_encode(body)))
    }
    pub fn decrypt(&mut self, kind: usize, body: &str) -> Result<String, JsError> {
        let bytes = vodozemac::base64_decode(body).map_err(err)?;
        let msg = OlmMessage::from_parts(kind, &bytes).map_err(err)?;
        let p = self.0.decrypt(&msg).map_err(err)?;
        String::from_utf8(p).map_err(err)
    }
}

#[wasm_bindgen]
pub struct GroupSession(VGroup);

#[wasm_bindgen]
impl GroupSession {
    #[wasm_bindgen(constructor)]
    pub fn new() -> GroupSession {
        GroupSession(VGroup::new(megolm_config()))
    }
    pub fn from_pickle(json: &str) -> Result<GroupSession, JsError> {
        Ok(GroupSession(VGroup::from_pickle(serde_json::from_str(json).map_err(err)?)))
    }
    pub fn pickle(&self) -> String {
        serde_json::to_string(&self.0.pickle()).unwrap_or_default()
    }
    pub fn session_id(&self) -> String {
        self.0.session_id()
    }
    pub fn session_key(&self) -> String {
        self.0.session_key().to_base64()
    }
    pub fn message_index(&self) -> u32 {
        self.0.message_index()
    }
    pub fn encrypt(&mut self, plaintext: &str) -> String {
        self.0.encrypt(plaintext).to_base64()
    }
}

#[wasm_bindgen]
pub struct InboundGroupSession(VInbound);

#[wasm_bindgen]
impl InboundGroupSession {
    #[wasm_bindgen(constructor)]
    pub fn new(session_key: &str) -> Result<InboundGroupSession, JsError> {
        let k = SessionKey::from_base64(session_key).map_err(err)?;
        Ok(InboundGroupSession(VInbound::new(&k, megolm_config())))
    }
    pub fn import(exported: &str) -> Result<InboundGroupSession, JsError> {
        let k = ExportedSessionKey::from_base64(exported).map_err(err)?;
        Ok(InboundGroupSession(VInbound::import(&k, megolm_config())))
    }
    pub fn from_pickle(json: &str) -> Result<InboundGroupSession, JsError> {
        Ok(InboundGroupSession(VInbound::from_pickle(
            serde_json::from_str(json).map_err(err)?,
        )))
    }
    pub fn pickle(&self) -> String {
        serde_json::to_string(&self.0.pickle()).unwrap_or_default()
    }
    pub fn session_id(&self) -> String {
        self.0.session_id()
    }
    pub fn first_known_index(&self) -> u32 {
        self.0.first_known_index()
    }
    /// Returns "index:plaintext".
    pub fn decrypt(&mut self, message: &str) -> Result<String, JsError> {
        let m = MegolmMessage::from_base64(message).map_err(err)?;
        let d = self.0.decrypt(&m).map_err(err)?;
        let p = String::from_utf8(d.plaintext).map_err(err)?;
        Ok(format!("{}:{}", d.message_index, p))
    }
    pub fn export_at_first_known_index(&self) -> String {
        self.0.export_at_first_known_index().to_base64()
    }
    pub fn export_at(&mut self, index: u32) -> Option<String> {
        self.0.export_at(index).map(|k| k.to_base64())
    }
}

/// Per-person signing key. The 32-byte seed comes from the recovery key.
#[wasm_bindgen]
pub struct SigningKey(Ed25519SecretKey);

#[wasm_bindgen]
impl SigningKey {
    pub fn from_seed(seed: &[u8]) -> Result<SigningKey, JsError> {
        let a: &[u8; 32] = seed.try_into().map_err(|_| JsError::new("seed must be 32 bytes"))?;
        Ok(SigningKey(Ed25519SecretKey::from_slice(a)))
    }
    pub fn public_key(&self) -> String {
        self.0.public_key().to_base64()
    }
    pub fn sign(&self, message: &str) -> String {
        self.0.sign(message.as_bytes()).to_base64()
    }
}

#[wasm_bindgen]
pub fn ed25519_verify(public_key: &str, message: &str, signature: &str) -> bool {
    let Ok(k) = Ed25519PublicKey::from_base64(public_key) else { return false };
    let Ok(s) = Ed25519Signature::from_base64(signature) else { return false };
    k.verify(message.as_bytes(), &s).is_ok()
}
