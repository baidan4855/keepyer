// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#[cfg_attr(mobile, tauri::mobile_entry_point)]
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
            save_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use base64::{Engine as _, engine::general_purpose};
use rand::Rng;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::PathBuf;

#[derive(Serialize, Deserialize)]
struct EncryptedData {
    nonce: String,
    ciphertext: String,
}

const KEY_FILE: &str = "master_key.bin";
const PASSWORD_FILE: &str = "password_hash.bin";

/// 获取应用数据目录
fn get_app_data_dir() -> Result<PathBuf, String> {
    // 使用跨平台的方式获取应用数据目录
    let home_dir = dirs::home_dir()
        .ok_or_else(|| "Failed to find home directory".to_string())?;

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
        fs::create_dir_all(&data_dir)
            .map_err(|e| format!("Failed to create data dir: {}", e))?;
        let mut file = fs::File::create(&key_path)
            .map_err(|e| format!("Failed to create key file: {}", e))?;
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
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|e| format!("Failed to create cipher: {}", e))?;

    let nonce: [u8; 12] = rand::thread_rng().gen();
    let nonce = Nonce::from_slice(&nonce);

    let ciphertext = cipher
        .encrypt(nonce, data.as_bytes())
        .map_err(|e| format!("Encryption failed: {}", e))?;

    let encrypted = EncryptedData {
        nonce: general_purpose::STANDARD.encode(&nonce),
        ciphertext: general_purpose::STANDARD.encode(&ciphertext),
    };

    serde_json::to_string(&encrypted)
        .map_err(|e| format!("Failed to serialize: {}", e))
}

/// 解密数据
#[tauri::command]
fn decrypt_data(encrypted_data: String) -> Result<String, String> {
    println!("收到解密请求，数据长度: {}", encrypted_data.len());
    println!("数据前50字符: {}", &encrypted_data.chars().take(50).collect::<String>());

    let key = get_or_create_master_key()?;
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|e| format!("Failed to create cipher: {}", e))?;

    let encrypted: EncryptedData = serde_json::from_str(&encrypted_data)
        .map_err(|e| format!("Failed to deserialize: {}", e))?;

    println!("nonce 长度: {}", encrypted.nonce.len());
    println!("ciphertext 长度: {}", encrypted.ciphertext.len());

    let nonce_bytes = general_purpose::STANDARD.decode(&encrypted.nonce)
        .map_err(|e| format!("Failed to decode nonce: {}", e))?;
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = general_purpose::STANDARD.decode(&encrypted.ciphertext)
        .map_err(|e| format!("Failed to decode ciphertext: {}", e))?;

    println!("密文长度: {} bytes", ciphertext.len());

    let plaintext = cipher
        .decrypt(nonce, ciphertext.as_ref())
        .map_err(|e| format!("Decryption failed: {}", e))?;

    let result = String::from_utf8(plaintext.to_vec())
        .map_err(|e| format!("Invalid UTF-8: {}", e))?;

    println!("解密结果长度: {}", result.len());
    println!("解密结果前50字符: {}", &result.chars().take(50).collect::<String>());

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
    let hash = format!("{}:{}",
        general_purpose::STANDARD.encode(&salt),
        general_purpose::STANDARD.encode(&key[..16]) // 存储部分派生密钥作为验证
    );

    fs::create_dir_all(&data_dir)
        .map_err(|e| format!("Failed to create data dir: {}", e))?;
    fs::write(&password_path, hash)
        .map_err(|e| format!("Failed to write password: {}", e))?;

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

    let salt = general_purpose::STANDARD.decode(&parts[0])
        .map_err(|e| format!("Failed to decode salt: {}", e))?;
    let salt_array: [u8; 12] = salt.try_into()
        .map_err(|_| "Invalid salt length".to_string())?;

    let key = derive_key_from_password(&password, &salt_array);
    let stored_hash = parts[1];

    // 解码存储的哈希值进行比较
    let stored_hash_bytes = general_purpose::STANDARD.decode(&stored_hash)
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
    let client = Client::builder()
        .use_native_tls()
        .pool_idle_timeout(std::time::Duration::from_secs(90))
        .timeout(std::time::Duration::from_secs(30))
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
        if let Ok(headers_map) = serde_json::from_str::<std::collections::HashMap<String, String>>(&headers_json) {
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
                let headers = response.headers().iter()
                    .map(|(k, v)| (k.as_str().to_string(), v.to_str().unwrap_or("").to_string()))
                    .collect::<std::collections::HashMap<String, String>>();

                let body_bytes = response.bytes().await
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

/// 保存文件到本地
#[tauri::command]
async fn save_file(file_name: String, content: String) -> Result<String, String> {
    use rfd::AsyncFileDialog;

    // 获取桌面目录作为默认位置
    let desktop_dir = dirs::desktop_dir()
        .ok_or_else(|| "无法获取桌面目录".to_string())?;

    let dialog = AsyncFileDialog::new()
        .set_file_name(&file_name)
        .set_title("保存文件")
        .set_directory(&desktop_dir);

    // 等待用户选择保存位置
    let file_handle = dialog.save_file().await
        .ok_or_else(|| "用户取消保存".to_string())?;

    // 使用 FileHandle 的 write 方法写入文件
    file_handle.write(&content.into_bytes()).await
        .map_err(|e| format!("写入文件失败: {}", e))?;

    // 获取文件路径用于返回消息
    let path_str = file_handle.path().to_string_lossy().to_string();

    Ok(format!("文件已保存: {}", path_str))
}
