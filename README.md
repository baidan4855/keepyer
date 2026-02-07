# KeyKeeper

A cross-platform LLM API key manager — a clean, lightweight desktop app for managing API keys from different AI providers.

> 中文说明请见 `README.zh-CN.md`。

## Features

- **Provider management**: Add, edit, and delete AI providers (e.g. OpenAI, Anthropic)
- **Key management**: Add multiple API keys per provider
- **Expiry tracking**: Set expiration dates and automatically mark expired keys
- **Quick copy**: One-click copy provider base URL and API keys
- **Local storage**: All data stays on device, nothing is uploaded
- **Cross-platform**: Windows, macOS, and Linux
- **Lightweight**: Built with Tauri, around 10MB

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

## License

MIT License. See `LICENSE`.

## Contributing

Issues and PRs are welcome. Please read `CONTRIBUTING.md` first.
