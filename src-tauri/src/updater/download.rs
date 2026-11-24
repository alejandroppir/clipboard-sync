//! Downloads a release package and checks its signature.
//!
//! The executable is downloaded directly first. If that fails, or what arrives is not the signed
//! file (a proxy may answer with its own page), the `.custom` copy is used: a zip with another
//! extension that networks blocking `.exe` and `.zip` let through.

use super::manifest::Package;
use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use futures_util::StreamExt;
use minisign_verify::{PublicKey, Signature};
use std::io::{Cursor, Read};
use std::path::{Path, PathBuf};

/// Public half of the signing key (`tauri signer generate`). The private half is a GitHub secret.
const PUBLIC_KEY: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDk0QjQyQTVEMTNBRkU3QTcKUldTbjU2OFRYU3EwbEZjbHhiZmR0V25ORWkxTXFOQXNieVgzWFFDQVR4YzJoZytRblo5TlBCblAK";
/// Refuses anything bigger, so a broken or malicious response cannot fill memory or disk.
const MAX_PACKAGE_BYTES: u64 = 200 * 1024 * 1024;

/// Downloads `package` into `dir` and returns the path of the verified executable.
pub async fn fetch(
    client: &reqwest::Client,
    asset_url: impl Fn(&str) -> String,
    package: &Package,
    version: &str,
    dir: &Path,
    on_progress: impl Fn(u8),
    on_fallback: impl Fn(&str),
) -> Result<PathBuf, String> {
    let direct = download(client, &asset_url(&package.file), &on_progress)
        .await
        .and_then(|bytes| verify(&bytes, package, version).map(|()| bytes));
    let executable = match direct {
        Ok(bytes) => bytes,
        Err(reason) => {
            on_fallback(&reason);
            let archive = download(client, &asset_url(&package.custom), &on_progress).await?;
            let bytes = extract(&archive, &package.file)?;
            verify(&bytes, package, version)?;
            bytes
        }
    };
    std::fs::create_dir_all(dir).map_err(|e| format!("no se pudo crear {}: {e}", dir.display()))?;
    let path = dir.join(&package.file);
    std::fs::write(&path, executable).map_err(|e| format!("no se pudo guardar {}: {e}", path.display()))?;
    Ok(path)
}

async fn download(client: &reqwest::Client, url: &str, on_progress: &impl Fn(u8)) -> Result<Vec<u8>, String> {
    let response = client.get(url).send().await.and_then(|r| r.error_for_status()).map_err(|e| format!("descarga de {url}: {e}"))?;
    let total = response.content_length().filter(|&len| len > 0);
    if total.is_some_and(|len| len > MAX_PACKAGE_BYTES) {
        return Err(format!("{url} es demasiado grande"));
    }
    let mut bytes = Vec::with_capacity(total.unwrap_or_default() as usize);
    let mut last_percent = None;
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("descarga de {url} interrumpida: {e}"))?;
        bytes.extend_from_slice(&chunk);
        if bytes.len() as u64 > MAX_PACKAGE_BYTES {
            return Err(format!("{url} es demasiado grande"));
        }
        if let Some(total) = total {
            let percent = (bytes.len() as u64 * 100 / total).min(100) as u8;
            if last_percent != Some(percent) {
                on_progress(percent);
                last_percent = Some(percent);
            }
        }
    }
    Ok(bytes)
}

/// Reads `file_name` from a zip archive.
fn extract(archive: &[u8], file_name: &str) -> Result<Vec<u8>, String> {
    let mut zip = zip::ZipArchive::new(Cursor::new(archive)).map_err(|e| format!("el .custom no es un zip válido: {e}"))?;
    let entry = zip.by_name(file_name).map_err(|_| format!("el .custom no contiene {file_name}"))?;
    if entry.size() > MAX_PACKAGE_BYTES {
        return Err(format!("{file_name} es demasiado grande"));
    }
    let mut bytes = Vec::with_capacity(entry.size() as usize);
    // The declared size may lie: never read past the limit.
    entry.take(MAX_PACKAGE_BYTES).read_to_end(&mut bytes).map_err(|e| format!("no se pudo descomprimir {file_name}: {e}"))?;
    Ok(bytes)
}

/// Checks that `data` was signed with the release key, as this file and for this version. Without the version,
/// a tampered `update.json` could announce an old release, genuinely signed, as a new one.
fn verify(data: &[u8], package: &Package, version: &str) -> Result<(), String> {
    let decode = |value: &str| -> Result<String, String> {
        let bytes = BASE64.decode(value.trim()).map_err(|e| format!("base64 inválido: {e}"))?;
        String::from_utf8(bytes).map_err(|e| format!("texto inválido: {e}"))
    };
    let key = PublicKey::decode(&decode(PUBLIC_KEY)?).map_err(|e| format!("clave pública inválida: {e}"))?;
    let signature = Signature::decode(&decode(&package.signature)?).map_err(|e| format!("firma inválida: {e}"))?;
    key.verify(data, &signature, false).map_err(|_| "la firma no coincide: el fichero no es el publicado".to_string())?;
    // `timestamp:…\tfile:…\tversion:…`, covered by the signature just verified.
    let signed = |field: String| signature.trusted_comment().split('\t').any(|part| part == field);
    if !signed(format!("file:{}", package.file)) || !signed(format!("version:{version}")) {
        return Err("la firma es de otro fichero o de otra versión".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    /// `tauri signer sign --app-version 2.0.0 payload.bin`, with the bytes of `PAYLOAD` and the release key.
    const PAYLOAD: &[u8] = b"clipboard-sync signature test";
    const PAYLOAD_SIGNATURE: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVTbjU2OFRYU3EwbE9qdnhuWjE2Nkd2OWltMk9wbXNNNGVCVENUTHpBNjNIRlpXZzdVeDRYT3dxa2JVak1JeWY2cVRFWk04TEVjYkJRVnBFUThLbUFNaFJEN2pHNjRnTXcwPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzk1NTQ3NDgwCWZpbGU6cGF5bG9hZC5iaW4JdmVyc2lvbjoyLjAuMApvNDFiVmtVTUFPYmJ2OFloRXVsem4wbGZTQlRlcUxDMklKT21jQjl1UzM2RUNNRVhvZHNPeU5VMEpaSXlaSklDWHR2YUx1OTVtSWVVeGFJOGJoRzFCUT09Cg==";

    #[test]
    fn accepts_the_signed_file_only() {
        let package = |file: &str, signature: &str| Package { file: file.into(), custom: String::new(), signature: signature.into() };
        let signed = package("payload.bin", PAYLOAD_SIGNATURE);
        assert!(verify(PAYLOAD, &signed, "2.0.0").is_ok());
        assert!(verify(b"tampered", &signed, "2.0.0").is_err());
        assert!(verify(PAYLOAD, &signed, "9.9.9").is_err(), "an old release announced as a new one");
        assert!(verify(PAYLOAD, &package("other.exe", PAYLOAD_SIGNATURE), "2.0.0").is_err());
        assert!(verify(PAYLOAD, &package("payload.bin", "not base64!"), "2.0.0").is_err());
    }

    #[test]
    fn extracts_the_executable_from_a_custom_file() {
        let mut archive = Vec::new();
        {
            let mut zip = zip::ZipWriter::new(Cursor::new(&mut archive));
            zip.start_file("ClipboardSync.exe", zip::write::SimpleFileOptions::default()).unwrap();
            zip.write_all(PAYLOAD).unwrap();
            zip.finish().unwrap();
        }
        assert_eq!(extract(&archive, "ClipboardSync.exe").unwrap(), PAYLOAD);
        assert!(extract(&archive, "Other.exe").is_err());
        assert!(extract(b"not a zip", "ClipboardSync.exe").is_err());
    }
}
