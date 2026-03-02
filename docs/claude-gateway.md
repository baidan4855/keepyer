# Claude Code 代理网关（Keeyper）

这个网关提供 Claude Code 需要的 Anthropic 兼容接口：

- `POST /v1/messages`
- `POST /v1/messages/count_tokens`
- `GET /v1/models`

并支持：

- `gateway-token` 鉴权
- 模型映射（每个 Claude Code 模型名映射到任意上游模型）
- 路由映射（不同模型走不同上游：Anthropic / OpenAI）

## 1. 通过 Keeyper GUI 配置（推荐）

在 Keeyper 主界面打开侧栏 `网关` 页面，可视化配置：

- `Gateway Token`
- `监听地址 / 端口`
- 模型映射（`Claude 模型名 -> Provider -> API Key -> 上游模型名`）

配置完成后点击：

- `保存网关配置`
- `导出 gateway.config.json`
- `启动网关 / 停止网关`

即可得到网关配置文件，无需手动编辑 JSON。

## 2. 手动准备配置（可选）

在项目根目录创建配置文件：

```bash
cp gateway.config.example.json gateway.config.json
```

关键字段：

- `gatewayToken`: Claude Code 访问网关时必须携带的 token
- `defaultRoute`: 模型没有显式映射时的默认路由
- `routes`: 上游路由定义
  - `protocol`: `anthropic` 或 `openai`
  - `baseUrl`: 上游地址
  - `apiKeyEnv`: 从环境变量读取上游 key
- `modelMappings`: Claude Code 模型名到上游模型的映射

示例：

```json
{
  "gatewayToken": "my-gateway-token",
  "defaultRoute": "anthropic-main",
  "routes": {
    "anthropic-main": {
      "protocol": "anthropic",
      "baseUrl": "https://api.anthropic.com",
      "apiKeyEnv": "ANTHROPIC_API_KEY"
    },
    "openai-main": {
      "protocol": "openai",
      "baseUrl": "https://api.openai.com",
      "apiKeyEnv": "OPENAI_API_KEY"
    }
  },
  "modelMappings": {
    "claude-sonnet-4-5": {
      "route": "anthropic-main",
      "targetModel": "claude-sonnet-4-5"
    },
    "claude-opus-4-1": {
      "route": "anthropic-main",
      "targetModel": "claude-opus-4-1"
    },
    "claude-haiku-4-5": {
      "route": "openai-main",
      "targetModel": "gpt-5-mini"
    },
    "*": {
      "route": "anthropic-main",
      "targetModel": "claude-sonnet-4-5"
    }
  }
}
```

## 3. 设置上游 API Key

```bash
export ANTHROPIC_API_KEY="your-anthropic-key"
export OPENAI_API_KEY="your-openai-key"
```

## 4. 启动网关

```bash
npm run gateway:claude
```

默认监听：`http://127.0.0.1:8787`

如果要用其他配置文件：

```bash
KEEYPER_GATEWAY_CONFIG=/abs/path/to/gateway.config.json npm run gateway:claude
```

## 5. 在 Claude Code 中使用

把 Claude Code 指向网关：

```bash
export ANTHROPIC_BASE_URL="http://127.0.0.1:8787"
export ANTHROPIC_AUTH_TOKEN="my-gateway-token"
claude
```

说明：

- `ANTHROPIC_AUTH_TOKEN` 必须与 `gateway.config.json` 里的 `gatewayToken` 一致
- Claude Code 里选择的模型名会先匹配 `modelMappings`，再路由到对应上游模型

## 6. 快速验证

健康检查：

```bash
curl -s http://127.0.0.1:8787/health | jq
```

模型列表（带 token）：

```bash
curl -s \
  -H "Authorization: Bearer my-gateway-token" \
  http://127.0.0.1:8787/v1/models | jq
```

## 7. 常见问题

- 401 `Invalid gateway token`
  - 检查 `ANTHROPIC_AUTH_TOKEN` 是否与 `gatewayToken` 一致。
- 500 `missing api key`
  - 检查 `apiKeyEnv` 对应的环境变量是否已导出。
- 某个模型未命中映射
  - 检查 `modelMappings` 里是否存在该模型，或是否配置了 `"*"`。
