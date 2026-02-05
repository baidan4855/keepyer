# Contributing to Keeyper

Thanks for considering a contribution. This guide is short on purpose so you can get moving quickly.

## Prerequisites

- Node.js 18+
- Rust 1.88+ (for Tauri)
- npm, yarn, or pnpm

## Setup

1. Clone the repository
2. Install dependencies: `npm install`
3. Start dev mode: `npm run tauri:dev`

## Build

- Release build: `npm run tauri:build`
- Debug build: `npm run tauri:build:debug`

## Code Style

- Use TypeScript for all new code
- Prefer domain‑based modules under `src/domains`
- Keep components small and focused
- Keep names explicit and consistent (Provider, Key, Settings)

## Lint

Run `npm run lint` before submitting a PR.

## Pull Requests

- Keep PRs focused and small
- Explain the problem and solution
- Include screenshots for UI changes
- Link related issues if applicable

## Reporting Issues

- Use the issue templates
- Include reproduction steps, logs, and screenshots if possible

Thanks again for helping improve Keeyper.
