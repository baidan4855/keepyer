// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#[cfg_attr(mobile, tauri::mobile_entry_point)]
#[cfg(debug_assertions)]
use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            #[cfg(debug_assertions)]
            {
                if let Some(window) = app.get_webview_window("main") {
                    window.open_devtools();
                }
            }
            #[cfg(not(debug_assertions))]
            let _ = app;
            Ok(())
        })
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![
            encrypt_data,
            decrypt_data,
            setup_password,
            verify_password,
            has_password,
            change_password,
            http_request,
            codex_exec,
            get_codex_cli_status,
            get_gateway_process_status,
            start_gateway_process,
            stop_gateway_process,
            test_gateway_proxy,
            save_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use axum::{
    body::{Body, Bytes},
    extract::State,
    http::{HeaderMap, HeaderName, HeaderValue, Method, StatusCode},
    response::Response,
    routing::any,
    Router,
};
use base64::{engine::general_purpose, Engine as _};
use futures_util::stream;
use rand::Rng;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet, VecDeque};
use std::convert::Infallible;
use std::env;
use std::fs;
use std::io::{ErrorKind, Write};
use std::path::PathBuf;
use std::process::{Output, Stdio};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::async_runtime::JoinHandle;
use tokio::process::Command;
use tokio::sync::{mpsc, oneshot};

#[derive(Serialize, Deserialize)]
struct EncryptedData {
    nonce: String,
    ciphertext: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CodexExecResult {
    success: bool,
    exit_code: i32,
    stdout: String,
    stderr: String,
    output: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CodexCliStatus {
    installed: bool,
    version: Option<String>,
    message: Option<String>,
}

const KEY_FILE: &str = "master_key.bin";
const PASSWORD_FILE: &str = "password_hash.bin";
const GATEWAY_CONFIG_FILE: &str = "gateway.runtime.config.json";
const GATEWAY_LOG_LIMIT: usize = 400;
const GATEWAY_USAGE_EVENT_LIMIT: usize = 2000;
const MAX_GATEWAY_BODY_BYTES: usize = 10 * 1024 * 1024;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GatewayUsageEvent {
    id: u64,
    timestamp: u64,
    provider_id: String,
    key_id: String,
    model_id: String,
    source_model: String,
    target_model: String,
    route: String,
    input_tokens: i64,
    output_tokens: i64,
    total_tokens: i64,
    request_count: i64,
}

#[derive(Default)]
struct GatewayProcessState {
    running: bool,
    pid: Option<u32>,
    started_at: Option<u64>,
    listen_host: Option<String>,
    listen_port: Option<u16>,
    config_path: Option<String>,
    logs: VecDeque<String>,
    usage_events: VecDeque<GatewayUsageEvent>,
    next_usage_event_id: u64,
    last_error: Option<String>,
    last_exit_code: Option<i32>,
    last_exit_at: Option<u64>,
    shutdown_tx: Option<oneshot::Sender<()>>,
    server_task: Option<JoinHandle<()>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GatewayProcessStatus {
    running: bool,
    pid: Option<u32>,
    started_at: Option<u64>,
    listen_host: Option<String>,
    listen_port: Option<u16>,
    config_path: Option<String>,
    logs: Vec<String>,
    usage_events: Vec<GatewayUsageEvent>,
    last_error: Option<String>,
    last_exit_code: Option<i32>,
    last_exit_at: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GatewayProxyTestResult {
    ok: bool,
    status: Option<u16>,
    duration_ms: u64,
    url: String,
    via: String,
    message: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GatewayRuntimeListen {
    host: String,
    port: u16,
}

#[derive(Clone, Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct GatewayRuntimeProxy {
    #[serde(default)]
    enabled: bool,
    #[serde(default)]
    url: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
enum GatewayRouteProtocol {
    Anthropic,
    Openai,
    Codex,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GatewayRuntimeRouteConfig {
    protocol: GatewayRouteProtocol,
    base_url: String,
    api_key: String,
    #[serde(default)]
    provider_id: Option<String>,
    #[serde(default)]
    key_id: Option<String>,
    anthropic_version: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GatewayRuntimeModelMapping {
    route: String,
    #[serde(alias = "model", default)]
    target_model: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GatewayRuntimeConfig {
    gateway_token: String,
    listen: GatewayRuntimeListen,
    #[serde(default)]
    proxy: GatewayRuntimeProxy,
    default_route: String,
    request_log: bool,
    routes: HashMap<String, GatewayRuntimeRouteConfig>,
    model_mappings: HashMap<String, GatewayRuntimeModelMapping>,
}

#[derive(Clone, Debug)]
struct ResolvedModelMapping {
    requested_model: String,
    target_model: String,
    route_name: String,
}

#[derive(Clone, Debug)]
struct ResolvedRoute {
    name: String,
    config: GatewayRuntimeRouteConfig,
}

#[derive(Clone)]
struct GatewayServerContext {
    config: Arc<GatewayRuntimeConfig>,
    client: reqwest::Client,
    shared_state: Arc<Mutex<GatewayProcessState>>,
}

static GATEWAY_STATE: OnceLock<Arc<Mutex<GatewayProcessState>>> = OnceLock::new();

fn gateway_state() -> Arc<Mutex<GatewayProcessState>> {
    GATEWAY_STATE
        .get_or_init(|| Arc::new(Mutex::new(GatewayProcessState::default())))
        .clone()
}

fn now_millis() -> u64 {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    duration.as_millis() as u64
}

fn is_truthy_env(value: &str) -> bool {
    matches!(
        value.trim().to_ascii_lowercase().as_str(),
        "1" | "true" | "yes" | "on"
    )
}

fn gateway_use_system_proxy() -> bool {
    env::var("KEEYPER_USE_SYSTEM_PROXY")
        .ok()
        .map(|value| is_truthy_env(&value))
        .unwrap_or(false)
}

fn push_gateway_log(state: &mut GatewayProcessState, line: String) {
    state.logs.push_back(line);
    while state.logs.len() > GATEWAY_LOG_LIMIT {
        state.logs.pop_front();
    }
}

fn push_gateway_usage_event(state: &mut GatewayProcessState, event: GatewayUsageEvent) {
    state.usage_events.push_back(event);
    while state.usage_events.len() > GATEWAY_USAGE_EVENT_LIMIT {
        state.usage_events.pop_front();
    }
}

fn build_gateway_status(state: &GatewayProcessState) -> GatewayProcessStatus {
    GatewayProcessStatus {
        running: state.running,
        pid: state.pid,
        started_at: state.started_at,
        listen_host: state.listen_host.clone(),
        listen_port: state.listen_port,
        config_path: state.config_path.clone(),
        logs: state.logs.iter().cloned().collect(),
        usage_events: state.usage_events.iter().cloned().collect(),
        last_error: state.last_error.clone(),
        last_exit_code: state.last_exit_code,
        last_exit_at: state.last_exit_at,
    }
}

fn refresh_gateway_state(state: &mut GatewayProcessState) {
    let _ = state;
}

/// 获取应用数据目录
fn get_app_data_dir() -> Result<PathBuf, String> {
    // 使用跨平台的方式获取应用数据目录
    let home_dir = dirs::home_dir().ok_or_else(|| "Failed to find home directory".to_string())?;

    let app_data_dir = if cfg!(target_os = "macos") {
        home_dir.join("Library/Application Support/com.keeyper.app")
    } else if cfg!(target_os = "windows") {
        home_dir.join("AppData/Roaming/Keeyper")
    } else {
        // Linux
        home_dir.join(".config/keeyper")
    };

    Ok(app_data_dir)
}

/// 获取或创建主密钥
fn get_or_create_master_key() -> Result<Vec<u8>, String> {
    let data_dir = get_app_data_dir()?;
    let key_path = data_dir.join(KEY_FILE);

    if key_path.exists() {
        fs::read(&key_path).map_err(|e| format!("Failed to read key file: {}", e))
    } else {
        // 创建新的主密钥
        let key: [u8; 32] = rand::thread_rng().gen();
        fs::create_dir_all(&data_dir).map_err(|e| format!("Failed to create data dir: {}", e))?;
        let mut file =
            fs::File::create(&key_path).map_err(|e| format!("Failed to create key file: {}", e))?;
        file.write_all(&key)
            .map_err(|e| format!("Failed to write key: {}", e))?;
        Ok(key.to_vec())
    }
}

/// 从密码派生密钥
fn derive_key_from_password(password: &str, salt: &[u8; 12]) -> Vec<u8> {
    // 简单的密钥派生（生产环境应使用 PBKDF2/Argon2）
    let mut key = [0u8; 32];
    let pass_bytes = password.as_bytes();
    for (i, b) in key.iter_mut().enumerate() {
        *b = pass_bytes[i % pass_bytes.len()] ^ salt[i % salt.len()] ^ (i as u8);
    }
    key.to_vec()
}

/// 加密数据
#[tauri::command]
fn encrypt_data(data: String) -> Result<String, String> {
    let key = get_or_create_master_key()?;
    let cipher =
        Aes256Gcm::new_from_slice(&key).map_err(|e| format!("Failed to create cipher: {}", e))?;

    let nonce: [u8; 12] = rand::thread_rng().gen();
    let nonce = Nonce::from_slice(&nonce);

    let ciphertext = cipher
        .encrypt(nonce, data.as_bytes())
        .map_err(|e| format!("Encryption failed: {}", e))?;

    let encrypted = EncryptedData {
        nonce: general_purpose::STANDARD.encode(&nonce),
        ciphertext: general_purpose::STANDARD.encode(&ciphertext),
    };

    serde_json::to_string(&encrypted).map_err(|e| format!("Failed to serialize: {}", e))
}

/// 解密数据
#[tauri::command]
fn decrypt_data(encrypted_data: String) -> Result<String, String> {
    println!("收到解密请求，数据长度: {}", encrypted_data.len());
    println!(
        "数据前50字符: {}",
        &encrypted_data.chars().take(50).collect::<String>()
    );

    let key = get_or_create_master_key()?;
    let cipher =
        Aes256Gcm::new_from_slice(&key).map_err(|e| format!("Failed to create cipher: {}", e))?;

    let encrypted: EncryptedData = serde_json::from_str(&encrypted_data)
        .map_err(|e| format!("Failed to deserialize: {}", e))?;

    println!("nonce 长度: {}", encrypted.nonce.len());
    println!("ciphertext 长度: {}", encrypted.ciphertext.len());

    let nonce_bytes = general_purpose::STANDARD
        .decode(&encrypted.nonce)
        .map_err(|e| format!("Failed to decode nonce: {}", e))?;
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = general_purpose::STANDARD
        .decode(&encrypted.ciphertext)
        .map_err(|e| format!("Failed to decode ciphertext: {}", e))?;

    println!("密文长度: {} bytes", ciphertext.len());

    let plaintext = cipher
        .decrypt(nonce, ciphertext.as_ref())
        .map_err(|e| format!("Decryption failed: {}", e))?;

    let result =
        String::from_utf8(plaintext.to_vec()).map_err(|e| format!("Invalid UTF-8: {}", e))?;

    println!("解密结果长度: {}", result.len());
    println!(
        "解密结果前50字符: {}",
        &result.chars().take(50).collect::<String>()
    );

    Ok(result)
}

/// 设置密码
#[tauri::command]
fn setup_password(password: String) -> Result<(), String> {
    let data_dir = get_app_data_dir()?;
    let password_path = data_dir.join(PASSWORD_FILE);

    // 生成随机盐值
    let salt: [u8; 12] = rand::thread_rng().gen();
    let key = derive_key_from_password(&password, &salt);

    // 存储盐值和派生密钥的哈希（用于验证）
    let hash = format!(
        "{}:{}",
        general_purpose::STANDARD.encode(&salt),
        general_purpose::STANDARD.encode(&key[..16]) // 存储部分派生密钥作为验证
    );

    fs::create_dir_all(&data_dir).map_err(|e| format!("Failed to create data dir: {}", e))?;
    fs::write(&password_path, hash).map_err(|e| format!("Failed to write password: {}", e))?;

    Ok(())
}

/// 验证密码
#[tauri::command]
fn verify_password(password: String) -> Result<bool, String> {
    let data_dir = get_app_data_dir()?;
    let password_path = data_dir.join(PASSWORD_FILE);

    if !password_path.exists() {
        return Err("Password not set up".to_string());
    }

    let stored = fs::read_to_string(&password_path)
        .map_err(|e| format!("Failed to read password: {}", e))?;

    let parts: Vec<&str> = stored.split(':').collect();
    if parts.len() != 2 {
        return Err("Corrupted password data".to_string());
    }

    let salt = general_purpose::STANDARD
        .decode(&parts[0])
        .map_err(|e| format!("Failed to decode salt: {}", e))?;
    let salt_array: [u8; 12] = salt
        .try_into()
        .map_err(|_| "Invalid salt length".to_string())?;

    let key = derive_key_from_password(&password, &salt_array);
    let stored_hash = parts[1];

    // 解码存储的哈希值进行比较
    let stored_hash_bytes = general_purpose::STANDARD
        .decode(&stored_hash)
        .map_err(|e| format!("Failed to decode hash: {}", e))?;

    Ok(&key[..16] == stored_hash_bytes.as_slice())
}

/// 检查是否已设置密码
#[tauri::command]
fn has_password() -> Result<bool, String> {
    let data_dir = get_app_data_dir()?;
    let password_path = data_dir.join(PASSWORD_FILE);
    Ok(password_path.exists())
}

/// 修改密码（需要验证原密码）
#[tauri::command]
fn change_password(old_password: String, new_password: String) -> Result<(), String> {
    // 先验证原密码
    let is_valid = verify_password(old_password)?;
    if !is_valid {
        return Err("原密码错误".to_string());
    }

    // 原密码正确，设置新密码
    setup_password(new_password)
}

/// HTTP 请求代理命令（带重试机制）
#[tauri::command]
async fn http_request(
    url: String,
    method: String,
    headers: Option<String>,
    body: Option<String>,
    timeout_ms: Option<u64>,
) -> Result<String, String> {
    use reqwest::Client;

    // 构建带连接池的客户端
    let use_system_proxy = gateway_use_system_proxy();
    let mut client_builder = Client::builder()
        .use_native_tls()
        .pool_idle_timeout(std::time::Duration::from_secs(90))
        .timeout(std::time::Duration::from_secs(30))
        .connect_timeout(std::time::Duration::from_secs(12));
    if !use_system_proxy {
        client_builder = client_builder.no_proxy();
    }
    let client = client_builder
        .build()
        .map_err(|e| format!("创建客户端失败: {}", e))?;

    let mut request_builder = match method.as_str() {
        "GET" => client.get(&url),
        "POST" => client.post(&url),
        "PUT" => client.put(&url),
        "DELETE" => client.delete(&url),
        "PATCH" => client.patch(&url),
        "HEAD" => client.head(&url),
        _ => return Err("不支持的 HTTP 方法".to_string()),
    };

    // 添加超时（覆盖默认超时）
    if let Some(timeout) = timeout_ms {
        request_builder = request_builder.timeout(std::time::Duration::from_millis(timeout));
    }

    // 添加请求头
    if let Some(headers_json) = headers {
        if let Ok(headers_map) =
            serde_json::from_str::<std::collections::HashMap<String, String>>(&headers_json)
        {
            for (key, value) in headers_map {
                request_builder = request_builder.header(&key, &value);
            }
        }
    }

    // 添加请求体
    if let Some(body_str) = body {
        request_builder = request_builder.body(body_str);
    }

    // 重试机制：最多3次
    let mut last_error = String::new();
    for attempt in 0..3 {
        match request_builder
            .try_clone()
            .expect("请求无法克隆")
            .send()
            .await
        {
            Ok(response) => {
                let status = response.status();
                let status_code = status.as_u16();
                let headers = response
                    .headers()
                    .iter()
                    .map(|(k, v)| (k.as_str().to_string(), v.to_str().unwrap_or("").to_string()))
                    .collect::<std::collections::HashMap<String, String>>();

                let body_bytes = response
                    .bytes()
                    .await
                    .map_err(|e| format!("读取响应失败: {}", e))?;
                let body_text = String::from_utf8(body_bytes.to_vec())
                    .map_err(|e| format!("响应不是有效的 UTF-8: {}", e))?;

                // 构建响应
                let result = serde_json::json!({
                    "status": status_code,
                    "status_text": status.canonical_reason().unwrap_or("Unknown"),
                    "headers": headers,
                    "body": body_text
                });

                return Ok(result.to_string());
            }
            Err(e) => {
                last_error = format!("请求失败 (尝试 {}/3): {}", attempt + 1, e);
                // 如果是最后一次尝试，返回错误
                if attempt == 2 {
                    return Err(last_error);
                }
                // 等待一小段时间后重试
                tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            }
        }
    }

    Err(last_error)
}

#[tauri::command]
async fn test_gateway_proxy(
    proxy_enabled: bool,
    proxy_url: String,
    test_url: String,
    timeout_ms: Option<u64>,
) -> GatewayProxyTestResult {
    let started_at = now_millis();
    let target = test_url.trim().to_string();
    if target.is_empty() {
        return GatewayProxyTestResult {
            ok: false,
            status: None,
            duration_ms: now_millis().saturating_sub(started_at),
            url: String::new(),
            via: "unknown".to_string(),
            message: "Missing test URL".to_string(),
        };
    }
    if !(target.starts_with("http://") || target.starts_with("https://")) {
        return GatewayProxyTestResult {
            ok: false,
            status: None,
            duration_ms: now_millis().saturating_sub(started_at),
            url: target,
            via: "unknown".to_string(),
            message: "Test URL must start with http:// or https://".to_string(),
        };
    }

    let proxy_url_trimmed = proxy_url.trim().to_string();
    let via = if !proxy_enabled {
        "direct".to_string()
    } else if proxy_url_trimmed.is_empty() {
        "system".to_string()
    } else {
        "custom".to_string()
    };

    let timeout = Duration::from_millis(timeout_ms.unwrap_or(12_000).clamp(1_000, 120_000));
    let mut builder = reqwest::Client::builder()
        .use_native_tls()
        .connect_timeout(Duration::from_secs(8))
        .timeout(timeout)
        .tcp_nodelay(true)
        .http1_only();
    if !proxy_enabled {
        builder = builder.no_proxy();
    } else if !proxy_url_trimmed.is_empty() {
        match reqwest::Proxy::all(&proxy_url_trimmed) {
            Ok(proxy) => builder = builder.proxy(proxy),
            Err(error) => {
                return GatewayProxyTestResult {
                    ok: false,
                    status: None,
                    duration_ms: now_millis().saturating_sub(started_at),
                    url: target,
                    via,
                    message: format!("Invalid proxy URL: {}", error),
                };
            }
        }
    }

    let client = match builder.build() {
        Ok(value) => value,
        Err(error) => {
            return GatewayProxyTestResult {
                ok: false,
                status: None,
                duration_ms: now_millis().saturating_sub(started_at),
                url: target,
                via,
                message: format!("Failed to build HTTP client: {}", error),
            };
        }
    };

    match client.get(&target).send().await {
        Ok(response) => GatewayProxyTestResult {
            ok: true,
            status: Some(response.status().as_u16()),
            duration_ms: now_millis().saturating_sub(started_at),
            url: target,
            via,
            message: format!(
                "Connected (HTTP {})",
                response.status().as_u16()
            ),
        },
        Err(error) => GatewayProxyTestResult {
            ok: false,
            status: None,
            duration_ms: now_millis().saturating_sub(started_at),
            url: target,
            via,
            message: error.to_string(),
        },
    }
}

fn should_retry_with_reasoning_override(stderr: &str) -> bool {
    let lower = stderr.to_lowercase();
    lower.contains("model_reasoning_effort") && lower.contains("unknown variant")
}

fn push_unique_codex_candidate(candidates: &mut Vec<String>, value: String) {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return;
    }
    if candidates.iter().any(|item| item == trimmed) {
        return;
    }
    candidates.push(trimmed.to_string());
}

fn normalize_shell_codex_candidate(raw_line: &str) -> Option<String> {
    let trimmed = raw_line.trim();
    if trimmed.is_empty() {
        return None;
    }

    let simple = trimmed.trim_matches('"').trim_matches('\'').to_string();
    if simple.contains('/') {
        return Some(simple);
    }
    if simple.eq_ignore_ascii_case("codex")
        || simple.to_ascii_lowercase().ends_with("codex.exe")
        || simple.to_ascii_lowercase().ends_with("\\codex.exe")
    {
        return Some(simple);
    }

    for token in trimmed.split_whitespace().rev() {
        let candidate = token.trim_matches('"').trim_matches('\'');
        if candidate.is_empty() {
            continue;
        }
        let lower = candidate.to_ascii_lowercase();
        if candidate.contains('/')
            || candidate.contains('\\')
            || lower == "codex"
            || lower.ends_with("codex.exe")
        {
            return Some(candidate.to_string());
        }
    }

    Some(simple)
}

async fn discover_codex_candidate_from_shell(shell: &str, probe: &str) -> Option<String> {
    let output = Command::new(shell)
        .arg("-ilc")
        .arg(probe)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .await
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    stdout
        .lines()
        .find_map(normalize_shell_codex_candidate)
}

fn collect_codex_absolute_candidates() -> Vec<String> {
    let mut candidates: Vec<String> = Vec::new();

    if let Ok(custom) = env::var("CODEX_CLI_PATH") {
        push_unique_codex_candidate(&mut candidates, custom);
    }

    if let Some(home) = dirs::home_dir() {
        push_unique_codex_candidate(
            &mut candidates,
            home.join(".local/bin/codex").to_string_lossy().to_string(),
        );
        push_unique_codex_candidate(
            &mut candidates,
            home.join("bin/codex").to_string_lossy().to_string(),
        );
        push_unique_codex_candidate(
            &mut candidates,
            home.join(".volta/bin/codex").to_string_lossy().to_string(),
        );
        push_unique_codex_candidate(
            &mut candidates,
            home.join(".asdf/shims/codex").to_string_lossy().to_string(),
        );
        push_unique_codex_candidate(
            &mut candidates,
            home.join(".npm-global/bin/codex").to_string_lossy().to_string(),
        );
        push_unique_codex_candidate(
            &mut candidates,
            home.join(".fnm/current/bin/codex").to_string_lossy().to_string(),
        );

        let nvm_versions = home.join(".nvm").join("versions").join("node");
        if let Ok(entries) = fs::read_dir(nvm_versions) {
            for entry in entries.flatten() {
                push_unique_codex_candidate(
                    &mut candidates,
                    entry.path().join("bin").join("codex").to_string_lossy().to_string(),
                );
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        push_unique_codex_candidate(&mut candidates, "/opt/homebrew/bin/codex".to_string());
        push_unique_codex_candidate(&mut candidates, "/usr/local/bin/codex".to_string());
    }

    #[cfg(target_os = "linux")]
    {
        push_unique_codex_candidate(&mut candidates, "/usr/local/bin/codex".to_string());
        push_unique_codex_candidate(&mut candidates, "/usr/bin/codex".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        if let Ok(local_app_data) = env::var("LOCALAPPDATA") {
            push_unique_codex_candidate(
                &mut candidates,
                PathBuf::from(&local_app_data)
                    .join("Programs")
                    .join("codex")
                    .join("codex.exe")
                    .to_string_lossy()
                    .to_string(),
            );
            push_unique_codex_candidate(
                &mut candidates,
                PathBuf::from(&local_app_data)
                    .join("Microsoft")
                    .join("WinGet")
                    .join("Links")
                    .join("codex.exe")
                    .to_string_lossy()
                    .to_string(),
            );
        }
    }

    candidates
}

fn push_unique_existing_dir(dirs: &mut Vec<String>, dir: PathBuf) {
    if !dir.is_dir() {
        return;
    }
    let raw = dir.to_string_lossy().trim().to_string();
    if raw.is_empty() {
        return;
    }
    if dirs.iter().any(|item| item == &raw) {
        return;
    }
    dirs.push(raw);
}

fn collect_additional_bin_dirs() -> Vec<String> {
    let mut dirs: Vec<String> = Vec::new();

    #[cfg(target_os = "macos")]
    {
        push_unique_existing_dir(&mut dirs, PathBuf::from("/opt/homebrew/bin"));
        push_unique_existing_dir(&mut dirs, PathBuf::from("/usr/local/bin"));
    }

    #[cfg(target_os = "linux")]
    {
        push_unique_existing_dir(&mut dirs, PathBuf::from("/usr/local/bin"));
        push_unique_existing_dir(&mut dirs, PathBuf::from("/usr/bin"));
        push_unique_existing_dir(&mut dirs, PathBuf::from("/bin"));
    }

    #[cfg(target_os = "windows")]
    {
        if let Ok(local_app_data) = env::var("LOCALAPPDATA") {
            push_unique_existing_dir(
                &mut dirs,
                PathBuf::from(&local_app_data).join("Microsoft").join("WinGet").join("Links"),
            );
            push_unique_existing_dir(
                &mut dirs,
                PathBuf::from(&local_app_data).join("Programs").join("codex"),
            );
            push_unique_existing_dir(
                &mut dirs,
                PathBuf::from(&local_app_data).join("Volta").join("bin"),
            );
        }
    }

    if let Some(home) = dirs::home_dir() {
        push_unique_existing_dir(&mut dirs, home.join(".local").join("bin"));
        push_unique_existing_dir(&mut dirs, home.join("bin"));
        push_unique_existing_dir(&mut dirs, home.join(".volta").join("bin"));
        push_unique_existing_dir(&mut dirs, home.join(".asdf").join("shims"));
        push_unique_existing_dir(&mut dirs, home.join(".fnm"));

        let nvm_versions = home.join(".nvm").join("versions").join("node");
        if let Ok(entries) = fs::read_dir(nvm_versions) {
            for entry in entries.flatten() {
                push_unique_existing_dir(&mut dirs, entry.path().join("bin"));
            }
        }
    }

    dirs
}

fn apply_codex_command_path_env(
    command: &mut Command,
    executable: &str,
    additional_bin_dirs: &[String],
) {
    let mut unique = HashSet::<String>::new();
    let mut entries = Vec::<PathBuf>::new();

    if let Ok(current_path) = env::var("PATH") {
        for path in env::split_paths(&current_path) {
            let normalized = path.to_string_lossy().to_string();
            if normalized.is_empty() || !unique.insert(normalized) {
                continue;
            }
            entries.push(path);
        }
    }

    if executable.contains('/') || executable.contains('\\') {
        if let Some(parent) = PathBuf::from(executable).parent() {
            let normalized = parent.to_string_lossy().to_string();
            if !normalized.is_empty() && unique.insert(normalized) {
                entries.push(parent.to_path_buf());
            }
        }
    }

    for dir in additional_bin_dirs {
        if dir.trim().is_empty() {
            continue;
        }
        if unique.insert(dir.to_string()) {
            entries.push(PathBuf::from(dir));
        }
    }

    match env::join_paths(entries) {
        Ok(joined) => {
            command.env("PATH", joined);
        }
        Err(_) => {
            #[cfg(windows)]
            let sep = ";";
            #[cfg(not(windows))]
            let sep = ":";
            let fallback = additional_bin_dirs.join(sep);
            if !fallback.trim().is_empty() {
                command.env("PATH", fallback);
            }
        }
    }
}

async fn discover_codex_command_candidates() -> Vec<String> {
    let mut candidates: Vec<String> = Vec::new();

    // Try inherited PATH first (works for tauri:dev and terminal-started app).
    push_unique_codex_candidate(&mut candidates, "codex".to_string());

    // GUI-launched app may miss shell PATH; probe shell profiles for absolute path.
    if let Some(path) = discover_codex_candidate_from_shell(
        "/bin/zsh",
        "whence -p codex 2>/dev/null || command -v codex 2>/dev/null || which codex 2>/dev/null",
    )
    .await
    {
        push_unique_codex_candidate(&mut candidates, path);
    }
    if let Some(path) = discover_codex_candidate_from_shell(
        "/bin/bash",
        "command -v codex 2>/dev/null || which codex 2>/dev/null",
    )
    .await
    {
        push_unique_codex_candidate(&mut candidates, path);
    }
    if let Some(path) = discover_codex_candidate_from_shell(
        "/bin/sh",
        "command -v codex 2>/dev/null || which codex 2>/dev/null",
    )
    .await
    {
        push_unique_codex_candidate(&mut candidates, path);
    }

    for candidate in collect_codex_absolute_candidates() {
        push_unique_codex_candidate(&mut candidates, candidate);
    }

    candidates
}

async fn run_codex_command(
    prompt: &str,
    model: Option<&str>,
    profile: Option<&str>,
    working_dir: Option<&str>,
    timeout: Duration,
    force_reasoning_override: bool,
) -> Result<Output, String> {
    let candidates = discover_codex_command_candidates().await;
    let additional_bin_dirs = collect_additional_bin_dirs();
    let mut last_error: Option<String> = None;

    for executable in &candidates {
        let mut command = Command::new(executable);
        apply_codex_command_path_env(&mut command, executable, &additional_bin_dirs);
        command.arg("exec");
        command.arg("--skip-git-repo-check");
        command.arg("--color").arg("never");

        if force_reasoning_override {
            command.arg("-c").arg(r#"model_reasoning_effort="high""#);
        }

        if let Some(model_name) = model {
            command.arg("-m").arg(model_name);
        }

        if let Some(profile_name) = profile {
            command.arg("-p").arg(profile_name);
        }

        if let Some(dir) = working_dir {
            command.arg("-C").arg(dir);
        }

        command.arg(prompt);
        command.stdout(Stdio::piped());
        command.stderr(Stdio::piped());

        match tokio::time::timeout(timeout, command.output()).await {
            Ok(Ok(output)) => return Ok(output),
            Ok(Err(error)) if error.kind() == ErrorKind::NotFound => {
                continue;
            }
            Ok(Err(error)) => {
                last_error = Some(format!("codex exec failed ({}): {}", executable, error));
                continue;
            }
            Err(_) => {
                return Err(format!(
                    "codex exec timed out after {} ms",
                    timeout.as_millis()
                ));
            }
        }
    }

    if let Some(error) = last_error {
        return Err(error);
    }

    Err(
        "codex executable not found. Please install Codex CLI and ensure PATH is available to the app, or set CODEX_CLI_PATH."
            .to_string(),
    )
}

#[tauri::command]
async fn codex_exec(
    prompt: String,
    model: Option<String>,
    profile: Option<String>,
    working_dir: Option<String>,
    timeout_ms: Option<u64>,
) -> Result<CodexExecResult, String> {
    let normalized_prompt = prompt.trim();
    if normalized_prompt.is_empty() {
        return Err("Prompt cannot be empty".to_string());
    }

    let normalized_model = model
        .as_ref()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty());
    let normalized_profile = profile
        .as_ref()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty());
    let normalized_working_dir = working_dir
        .as_ref()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty());

    let timeout = Duration::from_millis(timeout_ms.unwrap_or(240_000).max(1_000));
    let mut output = run_codex_command(
        normalized_prompt,
        normalized_model.as_deref(),
        normalized_profile.as_deref(),
        normalized_working_dir.as_deref(),
        timeout,
        false,
    )
    .await?;

    if !output.status.success() {
        let first_stderr = String::from_utf8_lossy(&output.stderr);
        if should_retry_with_reasoning_override(&first_stderr) {
            output = run_codex_command(
                normalized_prompt,
                normalized_model.as_deref(),
                normalized_profile.as_deref(),
                normalized_working_dir.as_deref(),
                timeout,
                true,
            )
            .await?;
        }
    }

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let output_text = if !stdout.trim().is_empty() {
        stdout.trim().to_string()
    } else {
        stderr.trim().to_string()
    };

    Ok(CodexExecResult {
        success: output.status.success(),
        exit_code: output
            .status
            .code()
            .unwrap_or(if output.status.success() { 0 } else { 1 }),
        stdout,
        stderr,
        output: output_text,
    })
}

#[tauri::command]
async fn get_codex_cli_status() -> Result<CodexCliStatus, String> {
    let candidates = discover_codex_command_candidates().await;
    let additional_bin_dirs = collect_additional_bin_dirs();
    let mut last_error: Option<String> = None;

    for executable in &candidates {
        let mut command = Command::new(executable);
        apply_codex_command_path_env(&mut command, executable, &additional_bin_dirs);
        let output = command
            .arg("--version")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .await;

        match output {
            Ok(result) => {
                let stdout = String::from_utf8_lossy(&result.stdout).trim().to_string();
                let stderr = String::from_utf8_lossy(&result.stderr).trim().to_string();

                let version = if !stdout.is_empty() {
                    Some(stdout.clone())
                } else if !stderr.is_empty() {
                    Some(stderr.clone())
                } else {
                    None
                };

                let message = if result.status.success() {
                    Some(format!("resolved via {}", executable))
                } else if !stderr.is_empty() {
                    Some(stderr)
                } else if !stdout.is_empty() {
                    Some(stdout)
                } else {
                    Some(format!("codex --version exited with status {}", result.status))
                };

                return Ok(CodexCliStatus {
                    installed: true,
                    version,
                    message,
                });
            }
            Err(error) if error.kind() == ErrorKind::NotFound => {
                continue;
            }
            Err(error) => {
                last_error = Some(format!("{}: {}", executable, error));
                continue;
            }
        }
    }

    let message = if let Some(error) = last_error {
        format!("Codex CLI was detected but failed to execute ({})", error)
    } else if candidates.is_empty() {
        "codex command not found in app environment".to_string()
    } else {
        format!(
            "codex command not found in app environment (checked: {})",
            candidates.join(", ")
        )
    };

    Ok(CodexCliStatus {
        installed: false,
        version: None,
        message: Some(message),
    })
}

fn push_gateway_log_shared(shared_state: &Arc<Mutex<GatewayProcessState>>, line: String) {
    if let Ok(mut state) = shared_state.lock() {
        push_gateway_log(&mut state, line);
    }
}

fn push_gateway_usage_event_shared(
    shared_state: &Arc<Mutex<GatewayProcessState>>,
    mut event: GatewayUsageEvent,
) {
    if event.input_tokens < 0 {
        event.input_tokens = 0;
    }
    if event.output_tokens < 0 {
        event.output_tokens = 0;
    }
    let computed_total = event.input_tokens + event.output_tokens;
    if event.total_tokens < computed_total {
        event.total_tokens = computed_total;
    }
    if event.request_count <= 0 {
        event.request_count = 1;
    }

    if let Ok(mut state) = shared_state.lock() {
        state.next_usage_event_id = state.next_usage_event_id.saturating_add(1);
        event.id = state.next_usage_event_id;
        push_gateway_usage_event(&mut state, event);
    }
}

fn log_gateway_request(ctx: &GatewayServerContext, message: &str, extras: &[(&str, String)]) {
    if !ctx.config.request_log {
        return;
    }
    let mut line = format!("[{}] {}", now_millis(), message);
    for (key, value) in extras {
        if !value.is_empty() {
            line.push(' ');
            line.push_str(key);
            line.push('=');
            line.push_str(value);
        }
    }
    push_gateway_log_shared(&ctx.shared_state, line);
}

fn header_value_string(headers: &HeaderMap, key: &str) -> String {
    headers
        .get(key)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string()
}

fn parse_bearer_token(value: &str) -> String {
    let trimmed = value.trim();
    if let Some(rest) = trimmed.strip_prefix("Bearer ") {
        return rest.trim().to_string();
    }
    if let Some(rest) = trimmed.strip_prefix("bearer ") {
        return rest.trim().to_string();
    }
    String::new()
}

fn check_gateway_auth(headers: &HeaderMap, config: &GatewayRuntimeConfig) -> bool {
    let expected = config.gateway_token.trim();
    if expected.is_empty() {
        return true;
    }

    let bearer = parse_bearer_token(&header_value_string(headers, "authorization"));
    let api_key = header_value_string(headers, "x-api-key");
    let token = if !bearer.is_empty() { bearer } else { api_key };
    token == expected
}

fn is_version_segment(segment: &str) -> bool {
    if segment.len() <= 1 {
        return false;
    }
    let Some(rest) = segment.strip_prefix('v') else {
        return false;
    };
    rest.chars().all(|ch| ch.is_ascii_digit())
}

fn trim_version_prefix(path: &str) -> &str {
    if !path.starts_with("/v") {
        return path;
    }
    let bytes = path.as_bytes();
    let mut index = 2;
    while index < bytes.len() && bytes[index].is_ascii_digit() {
        index += 1;
    }
    if index == 2 {
        return path;
    }
    &path[index..]
}

fn join_url(base_url: &str, path: &str) -> Result<String, String> {
    let clean_base = base_url.trim_end_matches('/');
    if clean_base.is_empty() {
        return Err("Missing upstream baseUrl".to_string());
    }

    let joined_path = if let Some(segment) = clean_base.rsplit('/').next() {
        if is_version_segment(segment) {
            trim_version_prefix(path)
        } else {
            path
        }
    } else {
        path
    };

    if joined_path.starts_with('/') {
        Ok(format!("{}{}", clean_base, joined_path))
    } else {
        Ok(format!("{}/{}", clean_base, joined_path))
    }
}

fn parse_json_body(body: &Bytes) -> Result<Value, String> {
    if body.len() > MAX_GATEWAY_BODY_BYTES {
        return Err("Request body too large".to_string());
    }
    if body.is_empty() {
        return Ok(json!({}));
    }
    serde_json::from_slice::<Value>(body).map_err(|_| "Invalid JSON body".to_string())
}

fn json_response_with_headers(
    status: StatusCode,
    payload: Value,
    extra_headers: &HeaderMap,
) -> Response {
    let mut response = Response::new(Body::from(payload.to_string()));
    *response.status_mut() = status;
    response.headers_mut().insert(
        HeaderName::from_static("content-type"),
        HeaderValue::from_static("application/json; charset=utf-8"),
    );
    for (name, value) in extra_headers {
        response.headers_mut().insert(name, value.clone());
    }
    response
}

fn anthropic_error_response(status: StatusCode, message: &str, error_type: &str) -> Response {
    json_response_with_headers(
        status,
        json!({
            "type": "error",
            "error": {
                "type": error_type,
                "message": message
            }
        }),
        &HeaderMap::new(),
    )
}

fn copy_relevant_headers(from: &reqwest::header::HeaderMap) -> HeaderMap {
    let mut headers = HeaderMap::new();
    for key in [
        "x-request-id",
        "request-id",
        "anthropic-request-id",
        "retry-after",
    ] {
        if let Some(value) = from.get(key) {
            if let Ok(name) = HeaderName::from_bytes(key.as_bytes()) {
                headers.insert(name, value.clone());
            }
        }
    }
    headers
}

fn extract_error_message(payload: &Value) -> Option<String> {
    payload
        .get("error")
        .and_then(|err| err.get("message"))
        .and_then(Value::as_str)
        .map(String::from)
        .or_else(|| {
            payload
                .get("message")
                .and_then(Value::as_str)
                .map(String::from)
        })
}

fn extract_openai_usage(payload: &Value) -> Option<(i64, i64, i64)> {
    let usage = payload.get("usage")?;
    let input_tokens = usage
        .get("prompt_tokens")
        .and_then(Value::as_i64)
        .unwrap_or(0)
        .max(0);
    let output_tokens = usage
        .get("completion_tokens")
        .and_then(Value::as_i64)
        .unwrap_or(0)
        .max(0);
    let total_tokens = usage
        .get("total_tokens")
        .and_then(Value::as_i64)
        .unwrap_or(input_tokens + output_tokens)
        .max(input_tokens + output_tokens)
        .max(0);
    if input_tokens <= 0 && output_tokens <= 0 && total_tokens <= 0 {
        return None;
    }
    Some((input_tokens, output_tokens, total_tokens))
}

fn extract_anthropic_usage(payload: &Value) -> Option<(i64, i64, i64)> {
    let usage = payload.get("usage")?;
    let input_tokens = usage
        .get("input_tokens")
        .and_then(Value::as_i64)
        .unwrap_or(0)
        .max(0);
    let output_tokens = usage
        .get("output_tokens")
        .and_then(Value::as_i64)
        .unwrap_or(0)
        .max(0);
    let total_tokens = usage
        .get("total_tokens")
        .and_then(Value::as_i64)
        .unwrap_or(input_tokens + output_tokens)
        .max(input_tokens + output_tokens)
        .max(0);
    if input_tokens <= 0 && output_tokens <= 0 && total_tokens <= 0 {
        return None;
    }
    Some((input_tokens, output_tokens, total_tokens))
}

fn record_gateway_usage(
    ctx: &GatewayServerContext,
    route: &ResolvedRoute,
    mapping: &ResolvedModelMapping,
    usage: (i64, i64, i64),
) {
    let provider_id = route
        .config
        .provider_id
        .as_deref()
        .unwrap_or("")
        .trim()
        .to_string();
    let key_id = route
        .config
        .key_id
        .as_deref()
        .unwrap_or("")
        .trim()
        .to_string();
    let model_id = if mapping.target_model.trim().is_empty() {
        mapping.requested_model.trim()
    } else {
        mapping.target_model.trim()
    };
    if model_id.is_empty() {
        return;
    }

    push_gateway_usage_event_shared(
        &ctx.shared_state,
        GatewayUsageEvent {
            id: 0,
            timestamp: now_millis(),
            provider_id,
            key_id,
            model_id: model_id.to_string(),
            source_model: mapping.requested_model.clone(),
            target_model: mapping.target_model.clone(),
            route: route.name.clone(),
            input_tokens: usage.0,
            output_tokens: usage.1,
            total_tokens: usage.2,
            request_count: 1,
        },
    );
}

fn random_id(prefix: &str) -> String {
    let suffix = rand::thread_rng().gen::<u64>();
    format!("{}_{}_{suffix:016x}", prefix, now_millis())
}

fn normalize_anthropic_blocks(content: &Value) -> Vec<Value> {
    if let Some(text) = content.as_str() {
        return vec![json!({ "type": "text", "text": text })];
    }
    if let Some(array) = content.as_array() {
        return array
            .iter()
            .filter(|item| item.is_object())
            .cloned()
            .collect();
    }
    Vec::new()
}

fn anthropic_content_to_text(content: &Value) -> String {
    if let Some(text) = content.as_str() {
        return text.to_string();
    }
    let Some(array) = content.as_array() else {
        return String::new();
    };

    array
        .iter()
        .filter_map(|block| {
            if let Some(text) = block.as_str() {
                return Some(text.to_string());
            }
            block.get("text").and_then(Value::as_str).map(String::from)
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn normalize_tool_result_content(content: &Value) -> String {
    if let Some(text) = content.as_str() {
        return text.to_string();
    }
    if content.is_array() {
        return anthropic_content_to_text(content);
    }
    if content.is_object() {
        return serde_json::to_string(content).unwrap_or_default();
    }
    String::new()
}

fn convert_anthropic_messages_to_openai(messages: &Value) -> Vec<Value> {
    let Some(array) = messages.as_array() else {
        return Vec::new();
    };
    let mut result = Vec::new();

    for message in array {
        let Some(obj) = message.as_object() else {
            continue;
        };
        let role = if obj
            .get("role")
            .and_then(Value::as_str)
            .map(|v| v == "assistant")
            .unwrap_or(false)
        {
            "assistant"
        } else {
            "user"
        };
        let blocks = normalize_anthropic_blocks(obj.get("content").unwrap_or(&Value::Null));

        if role == "assistant" {
            let mut text_parts = Vec::new();
            let mut tool_calls = Vec::new();
            for block in blocks {
                let block_type = block.get("type").and_then(Value::as_str).unwrap_or("");
                if block_type == "text" {
                    if let Some(text) = block.get("text").and_then(Value::as_str) {
                        if !text.is_empty() {
                            text_parts.push(text.to_string());
                        }
                    }
                    continue;
                }
                if block_type == "tool_use" {
                    let call_id = block
                        .get("id")
                        .and_then(Value::as_str)
                        .map(String::from)
                        .unwrap_or_else(|| format!("call_{}", random_id("tool")));
                    let name = block.get("name").and_then(Value::as_str).unwrap_or("tool");
                    let args_json = serde_json::to_string(block.get("input").unwrap_or(&json!({})))
                        .unwrap_or_else(|_| "{}".to_string());
                    tool_calls.push(json!({
                        "id": call_id,
                        "type": "function",
                        "function": {
                            "name": name,
                            "arguments": args_json
                        }
                    }));
                }
            }

            let mut openai_message = json!({
                "role": "assistant",
                "content": text_parts.join("\n")
            });
            if let Some(map) = openai_message.as_object_mut() {
                if !tool_calls.is_empty() {
                    map.insert("tool_calls".to_string(), Value::Array(tool_calls));
                }
            }
            result.push(openai_message);
            continue;
        }

        let mut user_text_buffer = Vec::new();
        let flush_user_text = |out: &mut Vec<Value>, buffer: &mut Vec<String>| {
            if buffer.is_empty() {
                return;
            }
            out.push(json!({
                "role": "user",
                "content": buffer.join("\n")
            }));
            buffer.clear();
        };

        for block in blocks {
            let block_type = block.get("type").and_then(Value::as_str).unwrap_or("");
            if block_type == "text" {
                if let Some(text) = block.get("text").and_then(Value::as_str) {
                    if !text.is_empty() {
                        user_text_buffer.push(text.to_string());
                    }
                }
                continue;
            }
            if block_type == "tool_result" {
                flush_user_text(&mut result, &mut user_text_buffer);
                let call_id = block
                    .get("tool_use_id")
                    .and_then(Value::as_str)
                    .or_else(|| block.get("tool_call_id").and_then(Value::as_str))
                    .map(String::from)
                    .unwrap_or_else(|| format!("call_{}", random_id("tool")));
                result.push(json!({
                    "role": "tool",
                    "tool_call_id": call_id,
                    "content": normalize_tool_result_content(block.get("content").unwrap_or(&Value::Null)),
                }));
                continue;
            }
            if block_type == "image" {
                user_text_buffer.push("[image omitted by gateway]".to_string());
            }
        }
        flush_user_text(&mut result, &mut user_text_buffer);
    }

    result
}

fn normalize_anthropic_system(system: &Value) -> String {
    if let Some(text) = system.as_str() {
        return text.to_string();
    }
    let Some(array) = system.as_array() else {
        return String::new();
    };

    array
        .iter()
        .filter_map(|block| {
            let block_type = block.get("type").and_then(Value::as_str).unwrap_or("");
            if block_type != "text" {
                return None;
            }
            block.get("text").and_then(Value::as_str).map(String::from)
        })
        .collect::<Vec<_>>()
        .join("\n\n")
}

fn convert_anthropic_tools_to_openai(tools: &Value) -> Option<Value> {
    let Some(array) = tools.as_array() else {
        return None;
    };

    let mut converted = Vec::new();
    for tool in array {
        let Some(name) = tool.get("name").and_then(Value::as_str) else {
            continue;
        };
        let description = tool.get("description").and_then(Value::as_str);
        let parameters = if let Some(schema) = tool.get("input_schema") {
            if schema.is_object() {
                schema.clone()
            } else {
                json!({"type": "object", "properties": {}})
            }
        } else {
            json!({"type": "object", "properties": {}})
        };
        converted.push(json!({
            "type": "function",
            "function": {
                "name": name,
                "description": description,
                "parameters": parameters
            }
        }));
    }

    if converted.is_empty() {
        None
    } else {
        Some(Value::Array(converted))
    }
}

fn convert_anthropic_tool_choice_to_openai(tool_choice: &Value) -> Option<Value> {
    if tool_choice.is_null() {
        return None;
    }
    if let Some(raw) = tool_choice.as_str() {
        return Some(match raw {
            "auto" => json!("auto"),
            "any" => json!("required"),
            "none" => json!("none"),
            _ => return None,
        });
    }
    let Some(choice) = tool_choice.as_object() else {
        return None;
    };
    let choice_type = choice.get("type").and_then(Value::as_str).unwrap_or("");
    match choice_type {
        "auto" => Some(json!("auto")),
        "any" => Some(json!("required")),
        "none" => Some(json!("none")),
        "tool" => choice.get("name").and_then(Value::as_str).map(|name| {
            json!({
                "type": "function",
                "function": { "name": name }
            })
        }),
        _ => None,
    }
}

fn convert_anthropic_request_to_openai(payload: &Value, target_model: &str) -> Value {
    let mut messages =
        convert_anthropic_messages_to_openai(payload.get("messages").unwrap_or(&Value::Null));
    let system_text = normalize_anthropic_system(payload.get("system").unwrap_or(&Value::Null));
    if !system_text.is_empty() {
        messages.insert(0, json!({ "role": "system", "content": system_text }));
    }

    let max_tokens = payload
        .get("max_tokens")
        .and_then(Value::as_i64)
        .unwrap_or(1024)
        .max(1);

    let mut output = serde_json::Map::new();
    output.insert("model".to_string(), json!(target_model));
    output.insert("messages".to_string(), Value::Array(messages));
    output.insert("max_tokens".to_string(), json!(max_tokens));
    output.insert(
        "stream".to_string(),
        json!(payload.get("stream").and_then(Value::as_bool).unwrap_or(false)),
    );

    if let Some(temp) = payload.get("temperature") {
        output.insert("temperature".to_string(), temp.clone());
    }
    if let Some(stop_sequences) = payload.get("stop_sequences") {
        if stop_sequences.is_array() {
            output.insert("stop".to_string(), stop_sequences.clone());
        }
    }
    if let Some(tools) =
        convert_anthropic_tools_to_openai(payload.get("tools").unwrap_or(&Value::Null))
    {
        output.insert("tools".to_string(), tools);
    }
    if let Some(tool_choice) =
        convert_anthropic_tool_choice_to_openai(payload.get("tool_choice").unwrap_or(&Value::Null))
    {
        output.insert("tool_choice".to_string(), tool_choice);
    }

    Value::Object(output)
}

fn extract_openai_message_text(content: &Value) -> String {
    if let Some(text) = content.as_str() {
        return text.to_string();
    }
    if let Some(array) = content.as_array() {
        return array
            .iter()
            .filter_map(|part| {
                if let Some(text) = part.get("text").and_then(Value::as_str) {
                    return Some(text.to_string());
                }
                None
            })
            .collect::<Vec<_>>()
            .join("\n");
    }
    content
        .get("text")
        .and_then(Value::as_str)
        .map(String::from)
        .unwrap_or_default()
}

fn parse_openai_tool_call_arguments(args_raw: &str) -> Value {
    if args_raw.trim().is_empty() {
        return json!({});
    }
    match serde_json::from_str::<Value>(args_raw) {
        Ok(value) if value.is_object() => value,
        _ => json!({ "_raw": args_raw }),
    }
}

fn map_openai_finish_reason(reason: Option<&str>, has_tool_use: bool) -> &'static str {
    if has_tool_use {
        return "tool_use";
    }
    match reason {
        Some("stop") => "end_turn",
        Some("length") => "max_tokens",
        Some("tool_calls") => "tool_use",
        Some("content_filter") => "stop_sequence",
        _ => "end_turn",
    }
}

fn convert_openai_response_to_anthropic(openai_payload: &Value, requested_model: &str) -> Value {
    let choice = openai_payload
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|arr| arr.first())
        .cloned()
        .unwrap_or_else(|| json!({}));
    let message = choice.get("message").cloned().unwrap_or_else(|| json!({}));

    let mut content_blocks = Vec::new();
    let text = extract_openai_message_text(message.get("content").unwrap_or(&Value::Null));
    if !text.is_empty() {
        content_blocks.push(json!({ "type": "text", "text": text }));
    }

    let tool_calls = message
        .get("tool_calls")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    for tool_call in &tool_calls {
        let call_id = tool_call
            .get("id")
            .and_then(Value::as_str)
            .map(String::from)
            .unwrap_or_else(|| format!("toolu_{}", random_id("tool")));
        let name = tool_call
            .get("function")
            .and_then(|fun| fun.get("name"))
            .and_then(Value::as_str)
            .unwrap_or("tool");
        let args_raw = tool_call
            .get("function")
            .and_then(|fun| fun.get("arguments"))
            .and_then(Value::as_str)
            .unwrap_or("");
        content_blocks.push(json!({
            "type": "tool_use",
            "id": call_id,
            "name": name,
            "input": parse_openai_tool_call_arguments(args_raw),
        }));
    }

    if content_blocks.is_empty() {
        content_blocks.push(json!({"type":"text","text":""}));
    }

    let usage = openai_payload
        .get("usage")
        .cloned()
        .unwrap_or_else(|| json!({}));
    let input_tokens = usage
        .get("prompt_tokens")
        .and_then(Value::as_i64)
        .unwrap_or(0)
        .max(0);
    let output_tokens = usage
        .get("completion_tokens")
        .and_then(Value::as_i64)
        .unwrap_or(0)
        .max(0);
    let stop_reason = map_openai_finish_reason(
        choice.get("finish_reason").and_then(Value::as_str),
        !tool_calls.is_empty(),
    );
    let id = openai_payload
        .get("id")
        .and_then(Value::as_str)
        .map(String::from)
        .unwrap_or_else(|| format!("msg_{}", random_id("msg")));

    json!({
      "id": id,
      "type": "message",
      "role": "assistant",
      "model": requested_model,
      "content": content_blocks,
      "stop_reason": stop_reason,
      "stop_sequence": Value::Null,
      "usage": {
        "input_tokens": input_tokens,
        "output_tokens": output_tokens
      }
    })
}

fn write_sse_event(output: &mut String, event: &str, data: &Value) {
    output.push_str("event: ");
    output.push_str(event);
    output.push('\n');
    output.push_str("data: ");
    output.push_str(&data.to_string());
    output.push_str("\n\n");
}

fn stream_anthropic_message(message_payload: &Value) -> String {
    let mut output = String::new();
    let content = message_payload
        .get("content")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    write_sse_event(
        &mut output,
        "message_start",
        &json!({
          "type": "message_start",
          "message": {
            "id": message_payload.get("id").and_then(Value::as_str).unwrap_or(""),
            "type": "message",
            "role": "assistant",
            "model": message_payload.get("model").and_then(Value::as_str).unwrap_or(""),
            "content": [],
            "stop_reason": Value::Null,
            "stop_sequence": Value::Null,
            "usage": {
              "input_tokens": message_payload
                .get("usage")
                .and_then(|u| u.get("input_tokens"))
                .and_then(Value::as_i64)
                .unwrap_or(0),
              "output_tokens": 0
            }
          }
        }),
    );

    for (index, block) in content.iter().enumerate() {
        let block_type = block.get("type").and_then(Value::as_str).unwrap_or("text");
        if block_type == "tool_use" {
            write_sse_event(
                &mut output,
                "content_block_start",
                &json!({
                  "type": "content_block_start",
                  "index": index,
                  "content_block": {
                    "type": "tool_use",
                    "id": block.get("id").and_then(Value::as_str).unwrap_or(""),
                    "name": block.get("name").and_then(Value::as_str).unwrap_or("tool"),
                    "input": {}
                  }
                }),
            );
            let partial_json = serde_json::to_string(block.get("input").unwrap_or(&json!({})))
                .unwrap_or_else(|_| "{}".to_string());
            if partial_json != "{}" {
                write_sse_event(
                    &mut output,
                    "content_block_delta",
                    &json!({
                      "type": "content_block_delta",
                      "index": index,
                      "delta": {
                        "type": "input_json_delta",
                        "partial_json": partial_json
                      }
                    }),
                );
            }
            write_sse_event(
                &mut output,
                "content_block_stop",
                &json!({
                  "type": "content_block_stop",
                  "index": index
                }),
            );
            continue;
        }

        let text = block
            .get("text")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        write_sse_event(
            &mut output,
            "content_block_start",
            &json!({
              "type": "content_block_start",
              "index": index,
              "content_block": {
                "type": "text",
                "text": ""
              }
            }),
        );
        if !text.is_empty() {
            write_sse_event(
                &mut output,
                "content_block_delta",
                &json!({
                  "type": "content_block_delta",
                  "index": index,
                  "delta": {
                    "type": "text_delta",
                    "text": text
                  }
                }),
            );
        }
        write_sse_event(
            &mut output,
            "content_block_stop",
            &json!({
              "type": "content_block_stop",
              "index": index
            }),
        );
    }

    write_sse_event(
        &mut output,
        "message_delta",
        &json!({
          "type": "message_delta",
          "delta": {
            "stop_reason": message_payload.get("stop_reason").cloned().unwrap_or(json!("end_turn")),
            "stop_sequence": message_payload.get("stop_sequence").cloned().unwrap_or(Value::Null)
          },
          "usage": {
            "output_tokens": message_payload
              .get("usage")
              .and_then(|u| u.get("output_tokens"))
              .and_then(Value::as_i64)
              .unwrap_or(0)
          }
        }),
    );
    write_sse_event(
        &mut output,
        "message_stop",
        &json!({ "type": "message_stop" }),
    );

    output
}

#[derive(Clone, Debug)]
struct OpenAiToolStreamBlock {
    anthropic_index: usize,
}

struct OpenAiToAnthropicStreamBridge {
    requested_model: String,
    message_id: String,
    message_model: String,
    started: bool,
    input_tokens: i64,
    output_tokens_estimate: i64,
    output_tokens_from_usage: Option<i64>,
    finish_reason: Option<String>,
    next_content_index: usize,
    text_block_index: Option<usize>,
    tool_blocks: HashMap<i64, OpenAiToolStreamBlock>,
    open_blocks: HashSet<usize>,
    saw_tool_use: bool,
}

impl OpenAiToAnthropicStreamBridge {
    fn new(requested_model: &str, estimated_input_tokens: i64) -> Self {
        let model = requested_model.trim();
        Self {
            requested_model: if model.is_empty() {
                "unknown".to_string()
            } else {
                model.to_string()
            },
            message_id: format!("msg_{}", random_id("msg")),
            message_model: if model.is_empty() {
                "unknown".to_string()
            } else {
                model.to_string()
            },
            started: false,
            input_tokens: estimated_input_tokens.max(0),
            output_tokens_estimate: 0,
            output_tokens_from_usage: None,
            finish_reason: None,
            next_content_index: 0,
            text_block_index: None,
            tool_blocks: HashMap::new(),
            open_blocks: HashSet::new(),
            saw_tool_use: false,
        }
    }

    fn apply_usage(&mut self, payload: &Value) {
        let Some(usage) = payload.get("usage") else {
            return;
        };
        if let Some(prompt_tokens) = usage.get("prompt_tokens").and_then(Value::as_i64) {
            self.input_tokens = prompt_tokens.max(0);
        }
        if let Some(completion_tokens) = usage.get("completion_tokens").and_then(Value::as_i64) {
            self.output_tokens_from_usage = Some(completion_tokens.max(0));
        }
    }

    fn ensure_message_start(&mut self, chunk: Option<&Value>, output: &mut Vec<Bytes>) {
        if self.started {
            return;
        }
        if let Some(payload) = chunk {
            if let Some(id) = payload.get("id").and_then(Value::as_str) {
                let trimmed = id.trim();
                if !trimmed.is_empty() {
                    self.message_id = trimmed.to_string();
                }
            }
            if let Some(model) = payload.get("model").and_then(Value::as_str) {
                let trimmed = model.trim();
                if !trimmed.is_empty() {
                    self.message_model = trimmed.to_string();
                }
            }
        }
        output.push(sse_event_bytes(
            "message_start",
            &json!({
              "type": "message_start",
              "message": {
                "id": self.message_id,
                "type": "message",
                "role": "assistant",
                "model": self.requested_model,
                "content": [],
                "stop_reason": Value::Null,
                "stop_sequence": Value::Null,
                "usage": {
                  "input_tokens": self.input_tokens.max(0),
                  "output_tokens": 0
                }
              }
            }),
        ));
        self.started = true;
    }

    fn ensure_text_block_started(&mut self, output: &mut Vec<Bytes>) -> usize {
        if let Some(index) = self.text_block_index {
            return index;
        }
        let index = self.next_content_index;
        self.next_content_index += 1;
        self.text_block_index = Some(index);
        self.open_blocks.insert(index);
        output.push(sse_event_bytes(
            "content_block_start",
            &json!({
              "type": "content_block_start",
              "index": index,
              "content_block": {
                "type": "text",
                "text": ""
              }
            }),
        ));
        index
    }

    fn ensure_tool_block_started(
        &mut self,
        openai_index: i64,
        tool_id: Option<&str>,
        tool_name: Option<&str>,
        output: &mut Vec<Bytes>,
    ) -> usize {
        if let Some(existing) = self.tool_blocks.get(&openai_index) {
            return existing.anthropic_index;
        }
        let id = tool_id
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(String::from)
            .unwrap_or_else(|| format!("toolu_{}", random_id("tool")));
        let name = tool_name
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(String::from)
            .unwrap_or_else(|| "tool".to_string());
        let anthropic_index = self.next_content_index;
        self.next_content_index += 1;
        self.tool_blocks.insert(
            openai_index,
            OpenAiToolStreamBlock {
                anthropic_index,
            },
        );
        self.open_blocks.insert(anthropic_index);
        self.saw_tool_use = true;
        output.push(sse_event_bytes(
            "content_block_start",
            &json!({
              "type": "content_block_start",
              "index": anthropic_index,
              "content_block": {
                "type": "tool_use",
                "id": id,
                "name": name,
                "input": {}
              }
            }),
        ));
        anthropic_index
    }

    fn ingest_chunk(&mut self, chunk: &Value) -> Vec<Bytes> {
        let mut output = Vec::new();
        self.apply_usage(chunk);
        self.ensure_message_start(Some(chunk), &mut output);

        let choice = chunk
            .get("choices")
            .and_then(Value::as_array)
            .and_then(|items| items.first())
            .cloned()
            .unwrap_or(Value::Null);

        if let Some(reason) = choice.get("finish_reason").and_then(Value::as_str) {
            let trimmed = reason.trim();
            if !trimmed.is_empty() {
                self.finish_reason = Some(trimmed.to_string());
            }
        }

        let delta = choice.get("delta").cloned().unwrap_or(Value::Null);
        for text in openai_delta_text_parts(&delta) {
            if text.is_empty() {
                continue;
            }
            let index = self.ensure_text_block_started(&mut output);
            self.output_tokens_estimate += estimate_text_tokens(&text);
            output.push(sse_event_bytes(
                "content_block_delta",
                &json!({
                  "type": "content_block_delta",
                  "index": index,
                  "delta": {
                    "type": "text_delta",
                    "text": text
                  }
                }),
            ));
        }

        if let Some(tool_calls) = delta.get("tool_calls").and_then(Value::as_array) {
            for (fallback_index, tool_call) in tool_calls.iter().enumerate() {
                let openai_index = tool_call
                    .get("index")
                    .and_then(Value::as_i64)
                    .unwrap_or(fallback_index as i64);
                let function = tool_call.get("function").cloned().unwrap_or(Value::Null);
                let tool_id = tool_call.get("id").and_then(Value::as_str);
                let tool_name = function.get("name").and_then(Value::as_str);
                let anthropic_index =
                    self.ensure_tool_block_started(openai_index, tool_id, tool_name, &mut output);

                let arguments_delta = function
                    .get("arguments")
                    .and_then(Value::as_str)
                    .map(String::from)
                    .or_else(|| {
                        let args = function.get("arguments")?;
                        if args.is_object() || args.is_array() {
                            return Some(args.to_string());
                        }
                        None
                    })
                    .unwrap_or_default();
                if arguments_delta.is_empty() {
                    continue;
                }
                self.output_tokens_estimate += estimate_text_tokens(&arguments_delta);
                output.push(sse_event_bytes(
                    "content_block_delta",
                    &json!({
                      "type": "content_block_delta",
                      "index": anthropic_index,
                      "delta": {
                        "type": "input_json_delta",
                        "partial_json": arguments_delta
                      }
                    }),
                ));
            }
        }

        output
    }

    fn finalize(&mut self) -> (Vec<Bytes>, (i64, i64, i64)) {
        let mut output = Vec::new();
        self.ensure_message_start(None, &mut output);

        let mut open_indices = self.open_blocks.iter().copied().collect::<Vec<_>>();
        open_indices.sort_unstable();
        for index in open_indices {
            output.push(sse_event_bytes(
                "content_block_stop",
                &json!({
                  "type": "content_block_stop",
                  "index": index
                }),
            ));
        }
        self.open_blocks.clear();

        let output_tokens = self
            .output_tokens_from_usage
            .unwrap_or(self.output_tokens_estimate.max(0))
            .max(0);
        let stop_reason = map_openai_finish_reason(self.finish_reason.as_deref(), self.saw_tool_use);
        output.push(sse_event_bytes(
            "message_delta",
            &json!({
              "type": "message_delta",
              "delta": {
                "stop_reason": stop_reason,
                "stop_sequence": Value::Null
              },
              "usage": {
                "output_tokens": output_tokens
              }
            }),
        ));
        output.push(sse_event_bytes(
            "message_stop",
            &json!({ "type": "message_stop" }),
        ));

        let input_tokens = self.input_tokens.max(0);
        let total_tokens = input_tokens + output_tokens;
        (output, (input_tokens, output_tokens, total_tokens))
    }
}

fn sse_event_bytes(event: &str, data: &Value) -> Bytes {
    let mut output = String::new();
    write_sse_event(&mut output, event, data);
    Bytes::from(output)
}

fn openai_delta_text_parts(delta: &Value) -> Vec<String> {
    let mut parts = Vec::new();
    let Some(content) = delta.get("content") else {
        return parts;
    };
    if let Some(text) = content.as_str() {
        if !text.is_empty() {
            parts.push(text.to_string());
        }
        return parts;
    }
    if let Some(array) = content.as_array() {
        for part in array {
            if let Some(text) = part.get("text").and_then(Value::as_str) {
                if !text.is_empty() {
                    parts.push(text.to_string());
                }
            }
        }
    }
    parts
}

fn find_sse_frame_delimiter(buffer: &str) -> Option<(usize, usize)> {
    let lf = buffer.find("\n\n").map(|index| (index, 2));
    let crlf = buffer.find("\r\n\r\n").map(|index| (index, 4));
    match (lf, crlf) {
        (Some(left), Some(right)) => {
            if left.0 <= right.0 {
                Some(left)
            } else {
                Some(right)
            }
        }
        (Some(value), None) | (None, Some(value)) => Some(value),
        (None, None) => None,
    }
}

fn take_next_sse_frame(buffer: &mut String) -> Option<String> {
    let (frame_end, delimiter_len) = find_sse_frame_delimiter(buffer)?;
    let frame = buffer[..frame_end].to_string();
    buffer.drain(..(frame_end + delimiter_len));
    Some(frame)
}

fn extract_sse_payload(frame: &str) -> Option<String> {
    let mut data_lines = Vec::new();
    for raw_line in frame.lines() {
        let line = raw_line.trim_end_matches('\r');
        if line.starts_with(':') {
            continue;
        }
        let Some(value) = line.strip_prefix("data:") else {
            continue;
        };
        let value = value.strip_prefix(' ').unwrap_or(value);
        data_lines.push(value.to_string());
    }
    if data_lines.is_empty() {
        None
    } else {
        Some(data_lines.join("\n"))
    }
}

fn extract_sse_data_line(line: &str) -> Option<String> {
    let trimmed = line.trim_end_matches('\r');
    if trimmed.is_empty() || trimmed.starts_with(':') {
        return None;
    }
    let value = trimmed.strip_prefix("data:")?;
    let value = value.strip_prefix(' ').unwrap_or(value);
    if value.is_empty() {
        None
    } else {
        Some(value.to_string())
    }
}

fn take_next_sse_payload(buffer: &mut String) -> Option<String> {
    if let Some(frame) = take_next_sse_frame(buffer) {
        return extract_sse_payload(&frame);
    }

    while let Some(line_end) = buffer.find('\n') {
        let line = buffer[..line_end].to_string();
        buffer.drain(..(line_end + 1));
        if let Some(payload) = extract_sse_data_line(&line) {
            return Some(payload);
        }
    }

    None
}

fn stream_openai_to_anthropic_body(
    ctx: GatewayServerContext,
    route: ResolvedRoute,
    mapping: ResolvedModelMapping,
    upstream: reqwest::Response,
    estimated_input_tokens: i64,
) -> Body {
    let (tx, rx) = mpsc::channel::<Bytes>(32);
    let stream_started_at = now_millis();
    tauri::async_runtime::spawn(async move {
        let mut upstream_response = upstream;
        let mut parser_buffer = String::new();
        let mut saw_done_marker = false;
        let mut saw_first_chunk = false;
        let mut bridge = OpenAiToAnthropicStreamBridge::new(&mapping.requested_model, estimated_input_tokens);

        log_gateway_request(
            &ctx,
            "proxy.stream.openai.start",
            &[
                ("path", "/v1/messages".to_string()),
                ("model", mapping.requested_model.clone()),
                ("target", mapping.target_model.clone()),
                ("route", route.name.clone()),
            ],
        );

        'stream: loop {
            let chunk = match upstream_response.chunk().await {
                Ok(Some(value)) => value,
                Ok(None) => break 'stream,
                Err(error) => {
                    log_gateway_request(
                        &ctx,
                        "proxy.stream.openai.error",
                        &[
                            ("path", "/v1/messages".to_string()),
                            ("model", mapping.requested_model.clone()),
                            ("target", mapping.target_model.clone()),
                            ("route", route.name.clone()),
                            ("error", error.to_string()),
                        ],
                    );
                    break 'stream;
                }
            };

            if !saw_first_chunk {
                saw_first_chunk = true;
                log_gateway_request(
                    &ctx,
                    "proxy.stream.openai.first_chunk",
                    &[
                        ("path", "/v1/messages".to_string()),
                        ("model", mapping.requested_model.clone()),
                        ("target", mapping.target_model.clone()),
                        ("route", route.name.clone()),
                        (
                            "first_chunk_ms",
                            now_millis().saturating_sub(stream_started_at).to_string(),
                        ),
                    ],
                );
            }

            parser_buffer.push_str(&String::from_utf8_lossy(&chunk));
            while let Some(payload) = take_next_sse_payload(&mut parser_buffer) {
                let trimmed = payload.trim();
                if trimmed.eq_ignore_ascii_case("[DONE]") {
                    saw_done_marker = true;
                    break 'stream;
                }
                let parsed = match serde_json::from_str::<Value>(trimmed) {
                    Ok(value) => value,
                    Err(_) => continue,
                };
                for event in bridge.ingest_chunk(&parsed) {
                    if tx.send(event).await.is_err() {
                        return;
                    }
                }
            }
        }

        if !saw_done_marker {
            if let Some(payload) = extract_sse_payload(parser_buffer.trim())
                .or_else(|| extract_sse_data_line(parser_buffer.trim()))
            {
                let trimmed = payload.trim();
                if !trimmed.is_empty() && !trimmed.eq_ignore_ascii_case("[DONE]") {
                    if let Ok(parsed) = serde_json::from_str::<Value>(trimmed) {
                        for event in bridge.ingest_chunk(&parsed) {
                            if tx.send(event).await.is_err() {
                                return;
                            }
                        }
                    }
                }
            }
        }

        let (tail_events, usage) = bridge.finalize();
        for event in tail_events {
            if tx.send(event).await.is_err() {
                return;
            }
        }
        record_gateway_usage(&ctx, &route, &mapping, usage);
        log_gateway_request(
            &ctx,
            "proxy.stream.openai.done",
            &[
                ("path", "/v1/messages".to_string()),
                ("model", mapping.requested_model.clone()),
                ("target", mapping.target_model.clone()),
                ("route", route.name.clone()),
                ("input_tokens", usage.0.to_string()),
                ("output_tokens", usage.1.to_string()),
                (
                    "duration_ms",
                    now_millis().saturating_sub(stream_started_at).to_string(),
                ),
            ],
        );
    });
    let output_stream = stream::unfold(rx, |mut receiver| async move {
        receiver
            .recv()
            .await
            .map(|chunk| (Ok::<Bytes, Infallible>(chunk), receiver))
    });
    Body::from_stream(output_stream)
}

fn is_event_stream_content_type(content_type: &str) -> bool {
    content_type
        .to_ascii_lowercase()
        .contains("text/event-stream")
}

fn estimate_input_tokens(payload: &Value) -> i64 {
    let relevant = json!({
      "system": payload.get("system").cloned().unwrap_or(Value::Null),
      "messages": payload.get("messages").cloned().unwrap_or(Value::Null),
    });
    let serialized = serde_json::to_string(&relevant).unwrap_or_default();
    std::cmp::max(1, (serialized.len() as i64 + 3) / 4)
}

fn estimate_openai_input_tokens(payload: &Value) -> i64 {
    let relevant = json!({
      "messages": payload.get("messages").cloned().unwrap_or(Value::Null),
      "tools": payload.get("tools").cloned().unwrap_or(Value::Null),
      "tool_choice": payload.get("tool_choice").cloned().unwrap_or(Value::Null),
    });
    let serialized = serde_json::to_string(&relevant).unwrap_or_default();
    std::cmp::max(1, (serialized.len() as i64 + 3) / 4)
}

fn estimate_text_tokens(text: &str) -> i64 {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return 0;
    }
    std::cmp::max(1, (trimmed.chars().count() as i64 + 3) / 4)
}

fn build_codex_prompt_from_openai_payload(payload: &Value) -> String {
    let Some(messages) = payload.get("messages").and_then(Value::as_array) else {
        return String::new();
    };

    let mut blocks = Vec::new();
    for item in messages {
        let Some(message) = item.as_object() else {
            continue;
        };
        let role = message
            .get("role")
            .and_then(Value::as_str)
            .unwrap_or("user")
            .trim();
        let content = extract_openai_message_text(message.get("content").unwrap_or(&Value::Null));
        if content.trim().is_empty() {
            continue;
        }
        blocks.push(format!(
            "<{}>\n{}\n</{}>",
            role,
            content.trim(),
            role
        ));
    }

    blocks.join("\n\n")
}

fn resolve_codex_working_dir(route: &ResolvedRoute) -> Option<String> {
    let trimmed = route.config.base_url.trim();
    if trimmed.is_empty() {
        return None;
    }
    let lower = trimmed.to_ascii_lowercase();
    if lower.starts_with("http://") || lower.starts_with("https://") {
        return None;
    }
    Some(trimmed.to_string())
}

async fn run_codex_gateway_completion(
    openai_payload: &Value,
    mapping: &ResolvedModelMapping,
    route: &ResolvedRoute,
) -> Result<Value, String> {
    let prompt = {
        let built = build_codex_prompt_from_openai_payload(openai_payload);
        if built.trim().is_empty() {
            "Reply to the user request directly.".to_string()
        } else {
            built
        }
    };
    let timeout = Duration::from_millis(240_000);
    let model = mapping.target_model.trim();
    let model_arg = if model.is_empty() { None } else { Some(model) };
    let working_dir = resolve_codex_working_dir(route);

    let mut output = run_codex_command(
        &prompt,
        model_arg,
        None,
        working_dir.as_deref(),
        timeout,
        false,
    )
    .await?;

    if !output.status.success() {
        let first_stderr = String::from_utf8_lossy(&output.stderr);
        if should_retry_with_reasoning_override(&first_stderr) {
            output = run_codex_command(
                &prompt,
                model_arg,
                None,
                working_dir.as_deref(),
                timeout,
                true,
            )
            .await?;
        }
    }

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let completion_text = if !stdout.trim().is_empty() {
        stdout.trim().to_string()
    } else {
        stderr.trim().to_string()
    };

    if !output.status.success() {
        let error_text = if !stderr.trim().is_empty() {
            stderr.trim().to_string()
        } else if !stdout.trim().is_empty() {
            stdout.trim().to_string()
        } else {
            format!("codex exec exited with status {}", output.status)
        };
        return Err(format!("Codex route failed: {}", error_text));
    }

    let prompt_tokens = estimate_openai_input_tokens(openai_payload).max(0);
    let completion_tokens = estimate_text_tokens(&completion_text).max(0);
    let total_tokens = prompt_tokens + completion_tokens;

    Ok(json!({
      "id": random_id("chatcmpl"),
      "object": "chat.completion",
      "created": (now_millis() / 1000) as i64,
      "model": if model.is_empty() { mapping.requested_model.clone() } else { mapping.target_model.clone() },
      "choices": [{
        "index": 0,
        "message": {
          "role": "assistant",
          "content": completion_text
        },
        "finish_reason": "stop"
      }],
      "usage": {
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "total_tokens": total_tokens
      }
    }))
}

fn resolve_model_mapping(
    config: &GatewayRuntimeConfig,
    requested_model: &str,
) -> Result<ResolvedModelMapping, String> {
    if let Some(mapping) = config.model_mappings.get(requested_model) {
        let target_model = if mapping.target_model.trim().is_empty() {
            requested_model.to_string()
        } else {
            mapping.target_model.trim().to_string()
        };
        return Ok(ResolvedModelMapping {
            requested_model: requested_model.to_string(),
            target_model,
            route_name: mapping.route.trim().to_string(),
        });
    }

    if let Some(mapping) = config.model_mappings.get("*") {
        let target_model = if mapping.target_model.trim().is_empty() {
            requested_model.to_string()
        } else {
            mapping.target_model.trim().to_string()
        };
        return Ok(ResolvedModelMapping {
            requested_model: requested_model.to_string(),
            target_model,
            route_name: mapping.route.trim().to_string(),
        });
    }

    if config.default_route.trim().is_empty() {
        return Err(format!(
            "No mapping for model \"{}\" and no defaultRoute configured",
            requested_model
        ));
    }

    Ok(ResolvedModelMapping {
        requested_model: requested_model.to_string(),
        target_model: requested_model.to_string(),
        route_name: config.default_route.trim().to_string(),
    })
}

fn resolve_route(
    config: &GatewayRuntimeConfig,
    route_name: &str,
    model: &str,
) -> Result<ResolvedRoute, String> {
    let Some(route) = config.routes.get(route_name) else {
        return Err(format!(
            "Route \"{}\" not found for model \"{}\"",
            route_name, model
        ));
    };
    Ok(ResolvedRoute {
        name: route_name.to_string(),
        config: route.clone(),
    })
}

fn route_api_key(route: &ResolvedRoute) -> Result<String, String> {
    let key = route.config.api_key.trim();
    if key.is_empty() {
        return Err(format!("Route \"{}\" missing api key", route.name));
    }
    Ok(key.to_string())
}

async fn fetch_anthropic_upstream(
    ctx: &GatewayServerContext,
    route: &ResolvedRoute,
    req_headers: &HeaderMap,
    path: &str,
    payload: &Value,
) -> Result<reqwest::Response, String> {
    let api_key = route_api_key(route)?;
    let upstream_url = join_url(&route.config.base_url, path)?;
    let stream_requested = payload
        .get("stream")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert(
        reqwest::header::CONTENT_TYPE,
        reqwest::header::HeaderValue::from_static("application/json"),
    );
    headers.insert(
        reqwest::header::ACCEPT,
        reqwest::header::HeaderValue::from_static(if stream_requested {
            "text/event-stream"
        } else {
            "application/json"
        }),
    );
    headers.insert(
        reqwest::header::CACHE_CONTROL,
        reqwest::header::HeaderValue::from_static("no-cache"),
    );
    headers.insert(
        reqwest::header::ACCEPT_ENCODING,
        reqwest::header::HeaderValue::from_static("identity"),
    );
    let api_key_header = reqwest::header::HeaderValue::from_str(&api_key)
        .map_err(|e| format!("Invalid route API key header value: {}", e))?;
    headers.insert("x-api-key", api_key_header.clone());
    headers.insert(
        reqwest::header::AUTHORIZATION,
        reqwest::header::HeaderValue::from_str(&format!("Bearer {}", api_key))
            .map_err(|e| format!("Invalid authorization header value: {}", e))?,
    );

    let anthropic_version = header_value_string(req_headers, "anthropic-version");
    let version = if anthropic_version.trim().is_empty() {
        route
            .config
            .anthropic_version
            .as_deref()
            .unwrap_or("2023-06-01")
            .to_string()
    } else {
        anthropic_version
    };
    headers.insert(
        "anthropic-version",
        reqwest::header::HeaderValue::from_str(&version)
            .map_err(|e| format!("Invalid anthropic-version header value: {}", e))?,
    );
    let beta = header_value_string(req_headers, "anthropic-beta");
    if !beta.trim().is_empty() {
        headers.insert(
            "anthropic-beta",
            reqwest::header::HeaderValue::from_str(beta.trim())
                .map_err(|e| format!("Invalid anthropic-beta header value: {}", e))?,
        );
    }

    ctx.client
        .post(upstream_url)
        .headers(headers)
        .body(payload.to_string())
        .send()
        .await
        .map_err(|e| format!("Upstream request failed: {}", e))
}

async fn fetch_openai_upstream(
    ctx: &GatewayServerContext,
    route: &ResolvedRoute,
    path: &str,
    payload: &Value,
) -> Result<reqwest::Response, String> {
    let api_key = route_api_key(route)?;
    let upstream_url = join_url(&route.config.base_url, path)?;
    let stream_requested = payload
        .get("stream")
        .and_then(Value::as_bool)
        .unwrap_or(false);

    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert(
        reqwest::header::CONTENT_TYPE,
        reqwest::header::HeaderValue::from_static("application/json"),
    );
    headers.insert(
        reqwest::header::ACCEPT,
        reqwest::header::HeaderValue::from_static(if stream_requested {
            "text/event-stream"
        } else {
            "application/json"
        }),
    );
    headers.insert(
        reqwest::header::CACHE_CONTROL,
        reqwest::header::HeaderValue::from_static("no-cache"),
    );
    headers.insert(
        reqwest::header::ACCEPT_ENCODING,
        reqwest::header::HeaderValue::from_static("identity"),
    );
    headers.insert(
        reqwest::header::AUTHORIZATION,
        reqwest::header::HeaderValue::from_str(&format!("Bearer {}", api_key))
            .map_err(|e| format!("Invalid authorization header value: {}", e))?,
    );

    ctx.client
        .post(upstream_url)
        .headers(headers)
        .body(payload.to_string())
        .send()
        .await
        .map_err(|e| format!("Upstream request failed: {}", e))
}

fn build_model_list(config: &GatewayRuntimeConfig) -> Value {
    let mut explicit = config
        .model_mappings
        .keys()
        .filter(|name| name.as_str() != "*")
        .cloned()
        .collect::<Vec<_>>();
    explicit.sort_unstable();
    if explicit.is_empty() {
        return json!([{
          "id": "default",
          "type": "model",
          "display_name": "default",
          "created_at": now_millis().to_string()
        }]);
    }
    Value::Array(
        explicit
            .into_iter()
            .map(|id| {
                json!({
                  "id": id,
                  "type": "model",
                  "display_name": id,
                  "created_at": now_millis().to_string()
                })
            })
            .collect(),
    )
}

async fn gateway_health_handler(State(ctx): State<GatewayServerContext>) -> Response {
    json_response_with_headers(
        StatusCode::OK,
        json!({
          "ok": true,
          "name": "keeyper-rust-gateway",
          "now": now_millis(),
          "listen": {
            "host": ctx.config.listen.host,
            "port": ctx.config.listen.port,
          }
        }),
        &HeaderMap::new(),
    )
}

async fn gateway_models_handler(
    State(ctx): State<GatewayServerContext>,
    method: Method,
    headers: HeaderMap,
) -> Response {
    if method != Method::GET {
        return anthropic_error_response(
            StatusCode::METHOD_NOT_ALLOWED,
            "Method Not Allowed",
            "invalid_request_error",
        );
    }
    if !check_gateway_auth(&headers, &ctx.config) {
        return anthropic_error_response(
            StatusCode::UNAUTHORIZED,
            "Invalid gateway token",
            "authentication_error",
        );
    }
    let models = build_model_list(&ctx.config);
    json_response_with_headers(
        StatusCode::OK,
        json!({
          "data": models,
          "first_id": models.as_array().and_then(|items| items.first()).and_then(|m| m.get("id")).cloned().unwrap_or(Value::Null),
          "last_id": models.as_array().and_then(|items| items.last()).and_then(|m| m.get("id")).cloned().unwrap_or(Value::Null),
          "has_more": false
        }),
        &HeaderMap::new(),
    )
}

async fn handle_anthropic_messages(
    ctx: &GatewayServerContext,
    headers: &HeaderMap,
    payload: &Value,
    mapping: &ResolvedModelMapping,
    route: &ResolvedRoute,
) -> Response {
    let mut upstream_payload = payload.clone();
    if let Some(obj) = upstream_payload.as_object_mut() {
        obj.insert(
            "model".to_string(),
            Value::String(mapping.target_model.clone()),
        );
    }
    let stream = payload
        .get("stream")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let upstream_started_at = now_millis();
    let upstream = match fetch_anthropic_upstream(
        ctx,
        route,
        headers,
        "/v1/messages",
        &upstream_payload,
    )
    .await
    {
        Ok(resp) => resp,
        Err(error) => {
            return anthropic_error_response(StatusCode::BAD_GATEWAY, &error, "api_error")
        }
    };

    let status =
        StatusCode::from_u16(upstream.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    let passthrough_headers = copy_relevant_headers(upstream.headers());
    let upstream_content_type = upstream
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    log_gateway_request(
        ctx,
        "proxy.upstream.headers",
        &[
            ("path", "/v1/messages".to_string()),
            ("protocol", "anthropic".to_string()),
            ("model", mapping.requested_model.clone()),
            ("target", mapping.target_model.clone()),
            ("route", route.name.clone()),
            ("status", status.as_u16().to_string()),
            ("stream_requested", stream.to_string()),
            ("content_type", upstream_content_type.clone()),
            (
                "upstream_headers_ms",
                now_millis().saturating_sub(upstream_started_at).to_string(),
            ),
        ],
    );

    if stream {
        let content_type = if upstream_content_type.trim().is_empty() {
            "text/event-stream; charset=utf-8".to_string()
        } else {
            upstream_content_type
        };
        let mut response = Response::new(Body::from_stream(upstream.bytes_stream()));
        *response.status_mut() = status;
        for (name, value) in &passthrough_headers {
            response.headers_mut().insert(name, value.clone());
        }
        if let Ok(value) = HeaderValue::from_str(&content_type) {
            response
                .headers_mut()
                .insert(HeaderName::from_static("content-type"), value);
        }
        response.headers_mut().insert(
            HeaderName::from_static("cache-control"),
            HeaderValue::from_static("no-cache, no-transform"),
        );
        response.headers_mut().insert(
            HeaderName::from_static("connection"),
            HeaderValue::from_static("keep-alive"),
        );
        response.headers_mut().insert(
            HeaderName::from_static("x-accel-buffering"),
            HeaderValue::from_static("no"),
        );
        return response;
    }

    let body_text = upstream
        .text()
        .await
        .unwrap_or_else(|_| "{\"type\":\"error\",\"error\":{\"type\":\"api_error\",\"message\":\"Failed to read upstream response\"}}".to_string());
    if let Ok(parsed) = serde_json::from_str::<Value>(&body_text) {
        if let Some(usage) = extract_anthropic_usage(&parsed) {
            record_gateway_usage(ctx, route, mapping, usage);
        }
    }
    let mut response = Response::new(Body::from(body_text));
    *response.status_mut() = status;
    for (name, value) in &passthrough_headers {
        response.headers_mut().insert(name, value.clone());
    }
    response.headers_mut().insert(
        HeaderName::from_static("content-type"),
        HeaderValue::from_static("application/json; charset=utf-8"),
    );
    response
}

async fn handle_openai_messages(
    ctx: &GatewayServerContext,
    payload: &Value,
    mapping: &ResolvedModelMapping,
    route: &ResolvedRoute,
) -> Response {
    let stream_requested = payload
        .get("stream")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let openai_payload = convert_anthropic_request_to_openai(payload, &mapping.target_model);

    if matches!(route.config.protocol, GatewayRouteProtocol::Codex) {
        let parsed = match run_codex_gateway_completion(&openai_payload, mapping, route).await {
            Ok(value) => value,
            Err(error) => return anthropic_error_response(StatusCode::BAD_GATEWAY, &error, "api_error"),
        };
        if let Some(usage) = extract_openai_usage(&parsed) {
            record_gateway_usage(ctx, route, mapping, usage);
        }
        let anthropic_response =
            convert_openai_response_to_anthropic(&parsed, &mapping.requested_model);
        if stream_requested {
            let mut response =
                Response::new(Body::from(stream_anthropic_message(&anthropic_response)));
            *response.status_mut() = StatusCode::OK;
            response.headers_mut().insert(
                HeaderName::from_static("content-type"),
                HeaderValue::from_static("text/event-stream; charset=utf-8"),
            );
            response.headers_mut().insert(
                HeaderName::from_static("cache-control"),
                HeaderValue::from_static("no-cache, no-transform"),
            );
            response.headers_mut().insert(
                HeaderName::from_static("connection"),
                HeaderValue::from_static("keep-alive"),
            );
            response.headers_mut().insert(
                HeaderName::from_static("x-accel-buffering"),
                HeaderValue::from_static("no"),
            );
            return response;
        }
        return json_response_with_headers(StatusCode::OK, anthropic_response, &HeaderMap::new());
    }

    let upstream_started_at = now_millis();
    let upstream = match fetch_openai_upstream(ctx, route, "/v1/chat/completions", &openai_payload).await
    {
        Ok(resp) => resp,
        Err(error) => {
            return anthropic_error_response(StatusCode::BAD_GATEWAY, &error, "api_error");
        }
    };
    let status = StatusCode::from_u16(upstream.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    let passthrough_headers = copy_relevant_headers(upstream.headers());
    let upstream_content_type = upstream
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    log_gateway_request(
        ctx,
        "proxy.upstream.headers",
        &[
            ("path", "/v1/messages".to_string()),
            ("protocol", "openai".to_string()),
            ("model", mapping.requested_model.clone()),
            ("target", mapping.target_model.clone()),
            ("route", route.name.clone()),
            ("status", status.as_u16().to_string()),
            ("stream_requested", stream_requested.to_string()),
            ("content_type", upstream_content_type.clone()),
            (
                "upstream_headers_ms",
                now_millis().saturating_sub(upstream_started_at).to_string(),
            ),
        ],
    );

    if !status.is_success() {
        let upstream_text = upstream.text().await.unwrap_or_else(|_| "{}".to_string());
        let parsed = serde_json::from_str::<Value>(&upstream_text).unwrap_or(Value::Null);
        let message =
            extract_error_message(&parsed).unwrap_or_else(|| format!("Upstream error: {}", status));
        return anthropic_error_response(status, &message, "api_error");
    }

    if stream_requested && is_event_stream_content_type(&upstream_content_type) {
        let estimated_input_tokens = estimate_openai_input_tokens(&openai_payload).max(0);
        let body = stream_openai_to_anthropic_body(
            ctx.clone(),
            route.clone(),
            mapping.clone(),
            upstream,
            estimated_input_tokens,
        );
        let mut response = Response::new(body);
        *response.status_mut() = StatusCode::OK;
        for (name, value) in &passthrough_headers {
            response.headers_mut().insert(name, value.clone());
        }
        response.headers_mut().insert(
            HeaderName::from_static("content-type"),
            HeaderValue::from_static("text/event-stream; charset=utf-8"),
        );
        response.headers_mut().insert(
            HeaderName::from_static("cache-control"),
            HeaderValue::from_static("no-cache, no-transform"),
        );
        response.headers_mut().insert(
            HeaderName::from_static("connection"),
            HeaderValue::from_static("keep-alive"),
        );
        response.headers_mut().insert(
            HeaderName::from_static("x-accel-buffering"),
            HeaderValue::from_static("no"),
        );
        return response;
    }

    if stream_requested {
        log_gateway_request(
            ctx,
            "proxy.stream.openai.non_sse",
            &[
                ("path", "/v1/messages".to_string()),
                ("model", mapping.requested_model.clone()),
                ("target", mapping.target_model.clone()),
                ("route", route.name.clone()),
                ("content_type", upstream_content_type.clone()),
            ],
        );
    }

    let upstream_text = match upstream.text().await {
        Ok(text) => text,
        Err(error) => {
            return anthropic_error_response(
                StatusCode::BAD_GATEWAY,
                &format!("Failed to read upstream response: {}", error),
                "api_error",
            )
        }
    };
    let parsed = serde_json::from_str::<Value>(&upstream_text).unwrap_or(Value::Null);
    if !parsed.is_object() {
        return anthropic_error_response(
            StatusCode::BAD_GATEWAY,
            "Upstream returned invalid JSON",
            "api_error",
        );
    }
    if let Some(usage) = extract_openai_usage(&parsed) {
        record_gateway_usage(ctx, route, mapping, usage);
    }

    let anthropic_response = convert_openai_response_to_anthropic(&parsed, &mapping.requested_model);
    if stream_requested {
        let mut response = Response::new(Body::from(stream_anthropic_message(&anthropic_response)));
        *response.status_mut() = StatusCode::OK;
        for (name, value) in &passthrough_headers {
            response.headers_mut().insert(name, value.clone());
        }
        response.headers_mut().insert(
            HeaderName::from_static("content-type"),
            HeaderValue::from_static("text/event-stream; charset=utf-8"),
        );
        response.headers_mut().insert(
            HeaderName::from_static("cache-control"),
            HeaderValue::from_static("no-cache, no-transform"),
        );
        response.headers_mut().insert(
            HeaderName::from_static("connection"),
            HeaderValue::from_static("keep-alive"),
        );
        response.headers_mut().insert(
            HeaderName::from_static("x-accel-buffering"),
            HeaderValue::from_static("no"),
        );
        return response;
    }

    json_response_with_headers(StatusCode::OK, anthropic_response, &passthrough_headers)
}

async fn handle_count_tokens(
    ctx: &GatewayServerContext,
    headers: &HeaderMap,
    payload: &Value,
    mapping: &ResolvedModelMapping,
    route: &ResolvedRoute,
) -> Response {
    if matches!(route.config.protocol, GatewayRouteProtocol::Anthropic) {
        let mut upstream_payload = payload.clone();
        if let Some(obj) = upstream_payload.as_object_mut() {
            obj.insert(
                "model".to_string(),
                Value::String(mapping.target_model.clone()),
            );
        }
        let upstream = match fetch_anthropic_upstream(
            ctx,
            route,
            headers,
            "/v1/messages/count_tokens",
            &upstream_payload,
        )
        .await
        {
            Ok(resp) => resp,
            Err(error) => {
                return anthropic_error_response(StatusCode::BAD_GATEWAY, &error, "api_error")
            }
        };
        let status =
            StatusCode::from_u16(upstream.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
        let passthrough_headers = copy_relevant_headers(upstream.headers());
        let body = upstream.text().await.unwrap_or_else(|_| "{}".to_string());
        let mut response = Response::new(Body::from(body));
        *response.status_mut() = status;
        for (name, value) in &passthrough_headers {
            response.headers_mut().insert(name, value.clone());
        }
        response.headers_mut().insert(
            HeaderName::from_static("content-type"),
            HeaderValue::from_static("application/json; charset=utf-8"),
        );
        return response;
    }

    if matches!(route.config.protocol, GatewayRouteProtocol::Codex) {
        let input_tokens = estimate_input_tokens(payload).max(0);
        return json_response_with_headers(
            StatusCode::OK,
            json!({ "input_tokens": input_tokens }),
            &HeaderMap::new(),
        );
    }

    // For OpenAI-compatible routes, use local estimation to avoid an extra
    // upstream completion call that can significantly delay Claude preflight.
    let openai_payload = convert_anthropic_request_to_openai(payload, &mapping.target_model);
    let input_tokens = estimate_openai_input_tokens(&openai_payload).max(0);
    log_gateway_request(
        ctx,
        "proxy.count_tokens.estimated",
        &[
            ("path", "/v1/messages/count_tokens".to_string()),
            ("model", mapping.requested_model.clone()),
            ("target", mapping.target_model.clone()),
            ("route", route.name.clone()),
            ("protocol", "openai".to_string()),
            ("input_tokens", input_tokens.to_string()),
        ],
    );
    json_response_with_headers(
        StatusCode::OK,
        json!({ "input_tokens": input_tokens }),
        &HeaderMap::new(),
    )
}

async fn gateway_messages_handler(
    State(ctx): State<GatewayServerContext>,
    method: Method,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if method != Method::POST {
        return anthropic_error_response(
            StatusCode::METHOD_NOT_ALLOWED,
            "Method Not Allowed",
            "invalid_request_error",
        );
    }
    if !check_gateway_auth(&headers, &ctx.config) {
        return anthropic_error_response(
            StatusCode::UNAUTHORIZED,
            "Invalid gateway token",
            "authentication_error",
        );
    }

    let payload = match parse_json_body(&body) {
        Ok(value) => value,
        Err(error) => {
            return anthropic_error_response(
                StatusCode::BAD_REQUEST,
                &error,
                "invalid_request_error",
            )
        }
    };
    let requested_model = payload
        .get("model")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("");
    if requested_model.is_empty() {
        return anthropic_error_response(
            StatusCode::BAD_REQUEST,
            "Missing required field: model",
            "invalid_request_error",
        );
    }

    let mapping = match resolve_model_mapping(&ctx.config, requested_model) {
        Ok(value) => value,
        Err(error) => {
            return anthropic_error_response(
                StatusCode::BAD_REQUEST,
                &error,
                "invalid_request_error",
            )
        }
    };
    let route = match resolve_route(&ctx.config, &mapping.route_name, &mapping.requested_model) {
        Ok(value) => value,
        Err(error) => {
            return anthropic_error_response(
                StatusCode::BAD_REQUEST,
                &error,
                "invalid_request_error",
            )
        }
    };

    log_gateway_request(
        &ctx,
        "proxy.request",
        &[
            ("path", "/v1/messages".to_string()),
            ("model", mapping.requested_model.clone()),
            ("target", mapping.target_model.clone()),
            ("route", route.name.clone()),
            (
                "protocol",
                match route.config.protocol {
                    GatewayRouteProtocol::Anthropic => "anthropic".to_string(),
                    GatewayRouteProtocol::Openai => "openai".to_string(),
                    GatewayRouteProtocol::Codex => "codex".to_string(),
                },
            ),
            (
                "stream",
                if payload
                    .get("stream")
                    .and_then(Value::as_bool)
                    .unwrap_or(false)
                {
                    "true".to_string()
                } else {
                    "false".to_string()
                },
            ),
        ],
    );

    let request_started_at = now_millis();
    let response = match route.config.protocol {
        GatewayRouteProtocol::Anthropic => {
            handle_anthropic_messages(&ctx, &headers, &payload, &mapping, &route).await
        }
        GatewayRouteProtocol::Openai | GatewayRouteProtocol::Codex => {
            handle_openai_messages(&ctx, &payload, &mapping, &route).await
        }
    };
    log_gateway_request(
        &ctx,
        "proxy.response",
        &[
            ("path", "/v1/messages".to_string()),
            ("model", mapping.requested_model.clone()),
            ("target", mapping.target_model.clone()),
            ("route", route.name.clone()),
            (
                "protocol",
                match route.config.protocol {
                    GatewayRouteProtocol::Anthropic => "anthropic".to_string(),
                    GatewayRouteProtocol::Openai => "openai".to_string(),
                    GatewayRouteProtocol::Codex => "codex".to_string(),
                },
            ),
            ("status", response.status().as_u16().to_string()),
            (
                "duration_ms",
                now_millis()
                    .saturating_sub(request_started_at)
                    .to_string(),
            ),
        ],
    );
    response
}

async fn gateway_count_tokens_handler(
    State(ctx): State<GatewayServerContext>,
    method: Method,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if method != Method::POST {
        return anthropic_error_response(
            StatusCode::METHOD_NOT_ALLOWED,
            "Method Not Allowed",
            "invalid_request_error",
        );
    }
    if !check_gateway_auth(&headers, &ctx.config) {
        return anthropic_error_response(
            StatusCode::UNAUTHORIZED,
            "Invalid gateway token",
            "authentication_error",
        );
    }

    let payload = match parse_json_body(&body) {
        Ok(value) => value,
        Err(error) => {
            return anthropic_error_response(
                StatusCode::BAD_REQUEST,
                &error,
                "invalid_request_error",
            )
        }
    };
    let requested_model = payload
        .get("model")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("");
    if requested_model.is_empty() {
        return anthropic_error_response(
            StatusCode::BAD_REQUEST,
            "Missing required field: model",
            "invalid_request_error",
        );
    }

    let mapping = match resolve_model_mapping(&ctx.config, requested_model) {
        Ok(value) => value,
        Err(error) => {
            return anthropic_error_response(
                StatusCode::BAD_REQUEST,
                &error,
                "invalid_request_error",
            )
        }
    };
    let route = match resolve_route(&ctx.config, &mapping.route_name, &mapping.requested_model) {
        Ok(value) => value,
        Err(error) => {
            return anthropic_error_response(
                StatusCode::BAD_REQUEST,
                &error,
                "invalid_request_error",
            )
        }
    };

    log_gateway_request(
        &ctx,
        "proxy.request",
        &[
            ("path", "/v1/messages/count_tokens".to_string()),
            ("model", mapping.requested_model.clone()),
            ("target", mapping.target_model.clone()),
            ("route", route.name.clone()),
        ],
    );

    let request_started_at = now_millis();
    let response = handle_count_tokens(&ctx, &headers, &payload, &mapping, &route).await;
    log_gateway_request(
        &ctx,
        "proxy.response",
        &[
            ("path", "/v1/messages/count_tokens".to_string()),
            ("model", mapping.requested_model.clone()),
            ("target", mapping.target_model.clone()),
            ("route", route.name.clone()),
            (
                "protocol",
                match route.config.protocol {
                    GatewayRouteProtocol::Anthropic => "anthropic".to_string(),
                    GatewayRouteProtocol::Openai => "openai".to_string(),
                    GatewayRouteProtocol::Codex => "codex".to_string(),
                },
            ),
            ("status", response.status().as_u16().to_string()),
            (
                "duration_ms",
                now_millis()
                    .saturating_sub(request_started_at)
                    .to_string(),
            ),
        ],
    );
    response
}

async fn gateway_not_found_handler() -> Response {
    anthropic_error_response(StatusCode::NOT_FOUND, "Not Found", "invalid_request_error")
}

fn build_gateway_router(ctx: GatewayServerContext) -> Router {
    Router::new()
        .route("/health", any(gateway_health_handler))
        .route("/v1/models", any(gateway_models_handler))
        .route("/v1/messages", any(gateway_messages_handler))
        .route(
            "/v1/messages/count_tokens",
            any(gateway_count_tokens_handler),
        )
        .fallback(any(gateway_not_found_handler))
        .with_state(ctx)
}

fn parse_runtime_config(config_content: &str) -> Result<GatewayRuntimeConfig, String> {
    let config: GatewayRuntimeConfig = serde_json::from_str(config_content)
        .map_err(|e| format!("Invalid gateway runtime config: {}", e))?;
    if config.routes.is_empty() {
        return Err("No gateway routes configured".to_string());
    }
    Ok(config)
}

#[tauri::command]
fn get_gateway_process_status() -> Result<GatewayProcessStatus, String> {
    let shared_state = gateway_state();
    let mut state = shared_state
        .lock()
        .map_err(|e| format!("Gateway state lock poisoned: {}", e))?;
    refresh_gateway_state(&mut state);
    Ok(build_gateway_status(&state))
}

#[tauri::command]
async fn start_gateway_process(
    config_content: String,
    listen_host: String,
    listen_port: u16,
) -> Result<GatewayProcessStatus, String> {
    let runtime_config = parse_runtime_config(&config_content)?;
    let bind_host = if listen_host.trim().is_empty() {
        runtime_config.listen.host.clone()
    } else {
        listen_host.trim().to_string()
    };
    let bind_port = if listen_port == 0 {
        runtime_config.listen.port
    } else {
        listen_port
    };

    let shared_state = gateway_state();
    {
        let mut state = shared_state
            .lock()
            .map_err(|e| format!("Gateway state lock poisoned: {}", e))?;
        refresh_gateway_state(&mut state);
        if state.running {
            return Err("Gateway process is already running".to_string());
        }
    }

    let data_dir = get_app_data_dir()?;
    fs::create_dir_all(&data_dir).map_err(|e| format!("Failed to create app data dir: {}", e))?;
    let config_path = data_dir.join(GATEWAY_CONFIG_FILE);
    fs::write(&config_path, &config_content)
        .map_err(|e| format!("Failed to write gateway config file: {}", e))?;

    let listener = match tokio::net::TcpListener::bind((bind_host.as_str(), bind_port)).await {
        Ok(value) => value,
        Err(error) => {
            if let Ok(mut state) = shared_state.lock() {
                state.running = false;
                state.last_error = Some(format!("Failed to bind gateway listener: {}", error));
            }
            return Err(format!("Failed to bind gateway listener: {}", error));
        }
    };

    let proxy_enabled = runtime_config.proxy.enabled;
    let proxy_url = runtime_config.proxy.url.trim().to_string();
    let proxy_mode = if !proxy_enabled {
        "direct"
    } else if proxy_url.is_empty() {
        "system"
    } else {
        "custom"
    };
    let mut client_builder = reqwest::Client::builder()
        .use_native_tls()
        .pool_idle_timeout(std::time::Duration::from_secs(90))
        .timeout(std::time::Duration::from_secs(90))
        .connect_timeout(std::time::Duration::from_secs(12))
        .tcp_nodelay(true)
        .http1_only();
    if !proxy_enabled {
        client_builder = client_builder.no_proxy();
    } else if !proxy_url.is_empty() {
        let proxy = reqwest::Proxy::all(&proxy_url)
            .map_err(|e| format!("Invalid proxy URL in gateway config: {}", e))?;
        client_builder = client_builder.proxy(proxy);
    }
    let client = client_builder
        .build()
        .map_err(|e| format!("Failed to build gateway HTTP client: {}", e))?;

    let config_arc = Arc::new(runtime_config);
    let context = GatewayServerContext {
        config: config_arc.clone(),
        client,
        shared_state: shared_state.clone(),
    };
    let router = build_gateway_router(context);
    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
    let server_shared_state = shared_state.clone();

    let server_task = tauri::async_runtime::spawn(async move {
        let serve_result = axum::serve(listener, router)
            .with_graceful_shutdown(async move {
                let _ = shutdown_rx.await;
            })
            .await;

        if let Ok(mut state) = server_shared_state.lock() {
            state.running = false;
            state.pid = None;
            state.started_at = None;
            state.shutdown_tx = None;
            state.server_task = None;
            state.last_exit_at = Some(now_millis());

            if let Err(error) = serve_result {
                state.last_error = Some(format!("Gateway server exited with error: {}", error));
                state.last_exit_code = Some(1);
                push_gateway_log(
                    &mut state,
                    format!("[gateway] server exited with error: {}", error),
                );
            } else {
                push_gateway_log(&mut state, "[gateway] server stopped".to_string());
            }
        }
    });

    {
        let mut state = shared_state
            .lock()
            .map_err(|e| format!("Gateway state lock poisoned: {}", e))?;
        state.running = true;
        state.pid = Some(std::process::id());
        state.started_at = Some(now_millis());
        state.listen_host = Some(bind_host.clone());
        state.listen_port = Some(bind_port);
        state.config_path = Some(config_path.to_string_lossy().to_string());
        state.last_error = None;
        state.last_exit_code = None;
        state.last_exit_at = None;
        state.logs.clear();
        state.usage_events.clear();
        state.next_usage_event_id = 0;
        state.shutdown_tx = Some(shutdown_tx);
        state.server_task = Some(server_task);
        push_gateway_log(
            &mut state,
            format!(
                "[gateway] rust server started (pid={}, host={}, port={}, proxy_mode={}, proxy_url_set={}, upstream_transport=http1)",
                std::process::id(),
                bind_host,
                bind_port,
                proxy_mode,
                if proxy_url.is_empty() { "false" } else { "true" }
            ),
        );
    }

    get_gateway_process_status()
}

#[tauri::command]
async fn stop_gateway_process() -> Result<GatewayProcessStatus, String> {
    let shared_state = gateway_state();
    let (shutdown_tx, server_task, pid) = {
        let mut state = shared_state
            .lock()
            .map_err(|e| format!("Gateway state lock poisoned: {}", e))?;
        refresh_gateway_state(&mut state);
        if !state.running {
            return Ok(build_gateway_status(&state));
        }
        (
            state.shutdown_tx.take(),
            state.server_task.take(),
            state.pid.unwrap_or(0),
        )
    };

    if let Some(tx) = shutdown_tx {
        let _ = tx.send(());
    }
    if let Some(task) = server_task {
        let _ = task.await;
    }

    let mut state = shared_state
        .lock()
        .map_err(|e| format!("Gateway state lock poisoned: {}", e))?;
    state.running = false;
    state.pid = None;
    state.started_at = None;
    state.last_exit_code = Some(-1);
    state.last_exit_at = Some(now_millis());
    state.last_error = None;
    push_gateway_log(
        &mut state,
        format!("[gateway] server stopped by user (pid={})", pid),
    );
    Ok(build_gateway_status(&state))
}

/// 保存文件到本地
#[tauri::command]
async fn save_file(file_name: String, content: String) -> Result<String, String> {
    use rfd::AsyncFileDialog;

    // 获取桌面目录作为默认位置
    let desktop_dir = dirs::desktop_dir().ok_or_else(|| "无法获取桌面目录".to_string())?;

    let dialog = AsyncFileDialog::new()
        .set_file_name(&file_name)
        .set_title("保存文件")
        .set_directory(&desktop_dir);

    // 等待用户选择保存位置
    let file_handle = dialog
        .save_file()
        .await
        .ok_or_else(|| "用户取消保存".to_string())?;

    // 使用 FileHandle 的 write 方法写入文件
    file_handle
        .write(&content.into_bytes())
        .await
        .map_err(|e| format!("写入文件失败: {}", e))?;

    // 获取文件路径用于返回消息
    let path_str = file_handle.path().to_string_lossy().to_string();

    Ok(format!("文件已保存: {}", path_str))
}
