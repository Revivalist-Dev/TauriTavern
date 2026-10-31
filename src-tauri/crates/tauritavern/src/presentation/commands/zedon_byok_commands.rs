use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::app::AppState;

const SERVICE_RECORD_RELATIVE: &str = ".cursor-byok-v3/service.json";
const MAX_MODEL_BODY_BYTES: usize = 1024 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ZedonByokServiceDto {
    pub running: bool,
    pub base_url: Option<String>,
    pub port: Option<u16>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ZedonByokCatalogDto {
    pub base_url: String,
    pub models: Vec<ZedonByokModelDto>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ZedonByokModelDto {
    pub id: String,
    #[serde(default, alias = "owned_by")]
    pub owned_by: Option<String>,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub group: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ServiceRecord {
    port: Option<u16>,
}

#[derive(Debug, Deserialize)]
struct ModelsResponse {
    #[serde(default)]
    data: Vec<ZedonByokModelDto>,
}

fn service_record_path() -> Option<PathBuf> {
    let home = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)?;
    Some(home.join(SERVICE_RECORD_RELATIVE))
}

fn loopback_base_url(port: u16) -> String {
    format!("http://127.0.0.1:{port}/byok/v1")
}

fn read_service_port() -> Result<Option<u16>, String> {
    let Some(path) = service_record_path() else {
        return Ok(None);
    };
    if !path.is_file() {
        return Ok(None);
    }
    let body = std::fs::read_to_string(path)
        .map_err(|error| format!("Could not read the Zedon-BYOK service record: {error}"))?;
    let record: ServiceRecord = serde_json::from_str(&body)
        .map_err(|error| format!("Could not parse the Zedon-BYOK service record: {error}"))?;
    Ok(record.port.filter(|port| *port != 0))
}

fn validate_loopback_url(input: &str) -> Result<String, String> {
    let url = reqwest::Url::parse(input)
        .map_err(|error| format!("Invalid Zedon-BYOK endpoint: {error}"))?;
    if url.scheme() != "http" {
        return Err("Zedon-BYOK must use an http loopback endpoint.".to_string());
    }
    let host = url.host_str().unwrap_or_default();
    if host != "127.0.0.1" && host != "localhost" && host != "[::1]" && host != "::1" {
        return Err("Zedon-BYOK endpoints must stay on a loopback host.".to_string());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("Zedon-BYOK endpoints cannot contain credentials.".to_string());
    }
    Ok(url.as_str().trim_end_matches('/').to_string())
}

fn resolve_base_url(base_url: Option<String>) -> Result<(String, Option<u16>), String> {
    if let Some(base_url) = base_url.filter(|value| !value.trim().is_empty()) {
        return Ok((validate_loopback_url(base_url.trim())?, None));
    }
    let port = read_service_port()?.ok_or_else(|| {
        "Zedon-BYOK is not running or has not written its service record.".to_string()
    })?;
    Ok((loopback_base_url(port), Some(port)))
}

#[tauri::command]
pub async fn get_zedon_byok_service() -> Result<ZedonByokServiceDto, String> {
    match read_service_port() {
        Ok(Some(port)) => Ok(ZedonByokServiceDto {
            running: true,
            base_url: Some(loopback_base_url(port)),
            port: Some(port),
            error: None,
        }),
        Ok(None) => Ok(ZedonByokServiceDto {
            running: false,
            base_url: None,
            port: None,
            error: Some("No Zedon-BYOK service record was found.".to_string()),
        }),
        Err(error) => Ok(ZedonByokServiceDto {
            running: false,
            base_url: None,
            port: None,
            error: Some(error),
        }),
    }
}

#[tauri::command]
pub async fn list_zedon_byok_models(
    api_key: Option<String>,
    base_url: Option<String>,
    app_state: State<'_, Arc<AppState>>,
) -> Result<ZedonByokCatalogDto, String> {
    let api_key = match api_key
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
    {
        Some(value) => value,
        None => app_state
            .services
            .secret_service
            .read_custom_api_key_for_host()
            .await
            .map_err(|error| format!("Could not read the saved Zedon-BYOK key: {error}"))?
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| "A Zedon-BYOK External API key is required.".to_string())?,
    };
    let (base_url, _) = resolve_base_url(base_url)?;
    let models = fetch_models(&base_url, &api_key).await?;
    Ok(ZedonByokCatalogDto { base_url, models })
}

async fn fetch_models(base_url: &str, api_key: &str) -> Result<Vec<ZedonByokModelDto>, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .build()
        .map_err(|error| format!("Could not create the Zedon-BYOK client: {error}"))?;
    let response = client
        .get(format!("{base_url}/models"))
        .bearer_auth(api_key)
        .send()
        .await
        .map_err(|error| format!("Could not reach Zedon-BYOK: {error}"))?;
    let status = response.status();
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("Could not read the Zedon-BYOK model catalog: {error}"))?;
    if !status.is_success() {
        let body = String::from_utf8_lossy(&bytes);
        let message = body.trim().chars().take(512).collect::<String>();
        return Err(format!(
            "Zedon-BYOK model catalog returned {status}: {message}"
        ));
    }
    if bytes.len() > MAX_MODEL_BODY_BYTES {
        return Err("Zedon-BYOK model catalog response was too large.".to_string());
    }
    let catalog: ModelsResponse = serde_json::from_slice(&bytes)
        .map_err(|error| format!("Could not parse the Zedon-BYOK model catalog: {error}"))?;
    Ok(catalog
        .data
        .into_iter()
        .filter(|model| !model.id.trim().is_empty())
        .map(|model| ZedonByokModelDto {
            id: model.id,
            owned_by: model.owned_by,
            category: model.category,
            group: model.group,
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::{fetch_models, loopback_base_url, validate_loopback_url};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    #[test]
    fn loopback_endpoint_is_accepted() {
        assert_eq!(
            validate_loopback_url("http://127.0.0.1:4123/byok/v1/").unwrap(),
            "http://127.0.0.1:4123/byok/v1"
        );
        assert!(validate_loopback_url("http://localhost:4123/byok/v1").is_ok());
    }

    #[test]
    fn remote_and_credentialed_endpoints_are_rejected() {
        assert!(validate_loopback_url("https://api.example.com/byok/v1").is_err());
        assert!(validate_loopback_url("http://user:pass@127.0.0.1/byok/v1").is_err());
    }

    #[test]
    fn service_base_url_is_loopback() {
        assert_eq!(loopback_base_url(4123), "http://127.0.0.1:4123/byok/v1");
    }

    #[tokio::test]
    async fn model_catalog_uses_the_external_api_contract() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = vec![0; 4096];
            let read = socket.read(&mut request).await.unwrap();
            let request = String::from_utf8_lossy(&request[..read]).to_ascii_lowercase();
            assert!(request.starts_with("get /byok/v1/models "));
            assert!(request.contains("authorization: bearer test-key"));
            let body = r#"{"data":[{"id":"tauritavern-writer","owned_by":"zedon","category":"tauritavern","group":"Creative"}]}"#;
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            socket.write_all(response.as_bytes()).await.unwrap();
        });

        let models = fetch_models(&format!("http://{address}/byok/v1"), "test-key")
            .await
            .unwrap();
        server.await.unwrap();
        assert_eq!(models.len(), 1);
        assert_eq!(models[0].id, "tauritavern-writer");
        assert_eq!(models[0].category.as_deref(), Some("tauritavern"));
    }
}
