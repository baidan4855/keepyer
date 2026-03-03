<p align="center">
  <img src="public/icon.png" alt="Keeyper Icon" width="120" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-2.1.0-3b82f6" alt="Version 2.1.0" />
  <img src="https://img.shields.io/badge/license-MIT-10b981" alt="MIT License" />
  <img src="https://img.shields.io/badge/Tauri-2.x-24C8DB?logo=tauri&logoColor=white" alt="Tauri 2.x" />
  <img src="https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white" alt="React 18" />
  <img src="https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white" alt="TypeScript 5.x" />
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-64748b" alt="Platforms" />
</p>

# Keeyper

A cross-platform LLM gateway and debugging workbench — focused on protocol routing, model debugging, security probing, with provider/key management built in.

> 中文说明请见 `README.zh-CN.md`。
>
> Current version: `2.1.0`.

## Features

- **Provider management**: Add, edit, and delete AI providers (e.g. OpenAI, Anthropic)
- **Codex Exec provider**: Use local `codex exec` as a provider for model testing and debug chat
- **Key management**: Add multiple API keys per provider
- **Expiry tracking**: Set expiration dates and automatically mark expired keys
- **Quick copy**: One-click copy provider base URL and API keys
- **Model search**: Search models by name or ID in the model list
- **Model testing**: Test individual models to verify availability (supports OpenAI & Claude protocols)
- **LLM gateway (Anthropic-compatible)**: Route Claude model IDs to configured providers/models with a gateway token
- **Gateway runtime control**: Start/stop gateway process and inspect runtime logs in-app
- **Local storage**: All data stays on device, nothing is uploaded
- **Cross-platform**: Windows, macOS, and Linux
- **Lightweight**: Built with Tauri, around 10MB

## Screenshots

Five key pages are shown below.

### 1. Main Dashboard

Provider and key overview, including key status and quick actions.

![Main Dashboard](assets/main.png)

### 2. Model List

Search and review available models under the selected key/provider.

![Model List](assets/model_list.png)

### 3. Debug Chat

Run single debug requests with model/protocol controls and inspect responses.

![Debug Chat](assets/debug.png)

### 4. Security Probe

Execute multi-case security probing and view pass/warn/fail matrix results.

![Security Probe](assets/probe.png)

### 5. LLM Gateway

Configure model routing and manage gateway runtime status/logs.

![LLM Gateway](assets/gateway.png)

## Development Setup

### Prerequisites

- Node.js 18+
- npm
- Rust 1.88+ (for building Tauri)

#### Install Rust

```bash
# macOS
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Windows
# Download and run https://rustup.rs/

# Linux
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

### Install Dependencies

```bash
npm install
```

### Development Mode

```bash
# Start Tauri dev mode (will also start Vite)
npm run tauri:dev
```

### Build

```bash
# Build for current platform
npm run tauri:build

# Debug build (faster)
npm run tauri:build:debug
```

Build outputs are generated at `src-tauri/target/release/bundle/`.

### Linux builds

Automated releases only produce
macOS and Windows binaries, so Linux users must build locally if they need a native release.

1. Install the system dependencies listed under `src-tauri/tauri.conf.json` and the workflow (glib, GTK, WebKit2GTK, etc.).
2. Run `npm ci` followed by `npm run tauri:build`.
3. Grab the bundle from `src-tauri/target/release/bundle/`.

## Project Structure

```
src/
  app/                 App entry and layout
  domains/             Domain modules
    providers/         Provider management
    keys/              API Key management
    settings/          Security and settings
  shared/              Shared components and utilities
  i18n/                Localization resources
  types/               Global type definitions
```

## Usage

### Add a Provider

1. Click the "Add Provider" button in the left sidebar
2. Enter the provider name (e.g. "OpenAI")
3. Enter the provider base URL (e.g. "https://api.openai.com")

### Add an API Key

1. Select a provider
2. Click the "Add Key" button in the top-right corner
3. Enter the API key (required)
4. Optional: add a name, note, and expiration date

### Key Status

- 🟢 Green: Key is valid
- 🟡 Yellow: Key expires soon (within 7 days)
- 🔴 Red: Key has expired

## Tech Stack

- **Tauri 2.0**: Lightweight cross-platform desktop framework
- **React**: UI framework
- **Vite**: Build tool
- **Tailwind CSS**: Styling
- **Zustand**: State management
- **TypeScript**: Type safety
- **Rust**: Backend logic

## Design Style

The app uses a Soft UI (New Soft UI) visual style featuring:

- Soft shadows and rounded corners
- Purple-themed palette
- Frosted glass effects
- Smooth transitions
- Strong accessibility

## Why Tauri?

Compared to Electron, Tauri offers:

- **Smaller size**: ~10MB vs Electron’s 150MB+
- **Lower memory usage**: Uses the system WebView
- **Better security**: Rust memory safety
- **Faster startup**: Lighter runtime

## Acknowledgements

This project was fully developed with `Codex` and `Claude Code`.

Special thanks to both tooling teams for enabling rapid iteration from product ideas to implementation.

## License

MIT License. See `LICENSE`.

## Contributing

Issues and PRs are welcome. Please read `CONTRIBUTING.md` first.
