import { spawn } from 'node:child_process';
import { platform } from 'node:os';

export const isWindows = platform() === 'win32';

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export function runShell(cwd: string, command: string, timeoutMs: number): Promise<CommandResult> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const child = spawn(command, {
      cwd,
      shell: true,
      env: { ...process.env, CI: 'true', FORCE_COLOR: '0' },
      windowsHide: true,
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill(isWindows ? undefined : 'SIGKILL');
    }, timeoutMs);

    child.stdout?.on('data', (d: Buffer) => {
      stdout += d.toString('utf8');
      if (stdout.length > 500_000) {
        stdout = stdout.slice(-400_000) + '\n...[truncated]';
      }
    });
    child.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString('utf8');
      if (stderr.length > 200_000) {
        stderr = stderr.slice(-150_000) + '\n...[truncated]';
      }
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: 1, stdout, stderr: `${stderr}\n${err.message}`, timedOut });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr, timedOut });
    });
  });
}
