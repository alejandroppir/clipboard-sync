//! Credentials that identify the app with the Firebase web API key only.
//!
//! This is what the Firebase web SDK sends when nobody is signed in: an `x-goog-api-key` header
//! and no `Authorization` header. Firestore then applies the project's security rules.

use firestore::gcloud_sdk::google_cloud_auth::credentials::{CacheableResource, Credentials, CredentialsProvider, EntityTag};
use firestore::gcloud_sdk::google_cloud_auth::errors::CredentialsError;
use firestore::gcloud_sdk::tonic::codegen::http::{Extensions, HeaderValue};
use firestore::gcloud_sdk::{GoogleAuthHeaders, HeaderMap};

const API_KEY_HEADER: &str = "x-goog-api-key";

#[derive(Debug)]
struct ApiKeyCredentials {
    api_key: &'static str,
    /// Lets the gRPC middleware cache the headers: they never change.
    entity_tag: EntityTag,
}

impl CredentialsProvider for ApiKeyCredentials {
    async fn headers(&self, extensions: Extensions) -> Result<CacheableResource<HeaderMap>, CredentialsError> {
        if extensions.get::<EntityTag>() == Some(&self.entity_tag) {
            return Ok(CacheableResource::NotModified);
        }
        let mut headers = HeaderMap::new();
        headers.insert(API_KEY_HEADER, HeaderValue::from_static(self.api_key));
        Ok(CacheableResource::New { entity_tag: self.entity_tag.clone(), data: headers })
    }

    async fn universe_domain(&self) -> Option<String> {
        None
    }
}

pub fn api_key(api_key: &'static str) -> GoogleAuthHeaders {
    Credentials::from(ApiKeyCredentials { api_key, entity_tag: EntityTag::new() }).into()
}
