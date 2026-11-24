//! Optional encryption of the clipboard text with a password shared by the user's machines.
//!
//! It only hides the content: it does not authenticate the user nor protect anything else.

use argon2::Argon2;
use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use chacha20poly1305::aead::{Aead, Generate, KeyInit, Payload};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};

const KEY_BYTES: usize = 32;
const NONCE_BYTES: usize = 24;
/// Fixed, because every machine must get the same key from the same password without asking Firestore.
const SALT: &[u8] = b"clipboard-sync content v1";

/// What is saved is this key, never the password.
#[derive(Clone)]
pub struct Key([u8; KEY_BYTES]);

impl Key {
    /// Slow on purpose (about 0.1 s): it makes guessing the password expensive.
    pub fn from_password(password: &str) -> Result<Self, String> {
        let mut key = [0; KEY_BYTES];
        Argon2::default().hash_password_into(password.as_bytes(), SALT, &mut key).map_err(|e| e.to_string())?;
        Ok(Self(key))
    }

    pub fn from_base64(text: &str) -> Option<Self> {
        Some(Self(BASE64.decode(text).ok()?.try_into().ok()?))
    }

    pub fn to_base64(&self) -> String {
        BASE64.encode(self.0)
    }

    /// Encrypts `text` for `user_id`: base64 of a random nonce followed by the encrypted text.
    pub fn encrypt(&self, text: &str, user_id: &str) -> Option<String> {
        let nonce = XNonce::generate();
        let encrypted = self.cipher().encrypt(&nonce, Payload { msg: text.as_bytes(), aad: user_id.as_bytes() }).ok()?;
        Some(BASE64.encode([nonce.as_slice(), &encrypted].concat()))
    }

    /// `None` with another password, for another user, or if the text was changed.
    pub fn decrypt(&self, encrypted: &str, user_id: &str) -> Option<String> {
        let bytes = BASE64.decode(encrypted).ok()?;
        let (nonce, msg) = bytes.split_at_checked(NONCE_BYTES)?;
        let nonce = XNonce::try_from(nonce).ok()?;
        let text = self.cipher().decrypt(&nonce, Payload { msg, aad: user_id.as_bytes() }).ok()?;
        String::from_utf8(text).ok()
    }

    fn cipher(&self) -> XChaCha20Poly1305 {
        XChaCha20Poly1305::new(&self.0.into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_same_password_and_user_read_the_text() {
        let key = Key::from_password("clave").unwrap();
        let encrypted = key.encrypt("hola ñ\r\n", "a@example.com").unwrap();

        // Another machine: the same password, or the key read back from the settings.
        assert_eq!(Key::from_password("clave").unwrap().decrypt(&encrypted, "a@example.com").as_deref(), Some("hola ñ\r\n"));
        assert_eq!(Key::from_base64(&key.to_base64()).unwrap().decrypt(&encrypted, "a@example.com").as_deref(), Some("hola ñ\r\n"));

        assert_eq!(Key::from_password("otra").unwrap().decrypt(&encrypted, "a@example.com"), None);
        assert_eq!(key.decrypt(&encrypted, "b@example.com"), None);
        assert_eq!(key.decrypt(&encrypted.replace(&encrypted[40..42], "AA"), "a@example.com"), None);
        assert_eq!(key.decrypt("no es base64!", "a@example.com"), None);
        assert_eq!(key.decrypt("AAAA", "a@example.com"), None);
        assert!(!encrypted.contains("hola"));
        assert_ne!(key.encrypt("hola ñ\r\n", "a@example.com").unwrap(), encrypted, "the same text never looks the same");
    }
}
