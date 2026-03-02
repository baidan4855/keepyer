import { invoke } from '@tauri-apps/api/core';

export interface CodexExecRequest {
  prompt: string;
  model?: string;
  profile?: string;
  workingDir?: string;
  timeoutMs?: number;
}

export interface CodexExecResult {
  success: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  output: string;
}

export interface CodexCliStatus {
  installed: boolean;
  version?: string | null;
  message?: string | null;
}

export async function runCodexExec(request: CodexExecRequest): Promise<CodexExecResult> {
  return invoke<CodexExecResult>('codex_exec', {
    prompt: request.prompt,
    model: request.model ?? null,
    profile: request.profile ?? null,
    workingDir: request.workingDir ?? null,
    timeoutMs: request.timeoutMs ?? null,
  });
}

export async function getCodexCliStatus(): Promise<CodexCliStatus> {
  return invoke<CodexCliStatus>('get_codex_cli_status');
}
