import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';

import type { Logger } from '../../../core/logger.js';
import { AiError, type LlmRunner } from './llm-runner.js';

const MAX_OUTPUT_BYTES = 5 * 1024 * 1024;
const KILL_GRACE_MS = 5_000;

interface CliResult {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  result?: string;
  total_cost_usd?: number;
  num_turns?: number;
  duration_api_ms?: number;
  modelUsage?: Record<string, unknown>;
}

const oneLine = (text: string, max = 300) => text.replace(/\s+/g, ' ').trim().slice(0, max);

/**
 * Runs prompts through the Claude Code CLI in non-interactive mode:
 *   claude -p <prompt> --output-format json [--allowedTools=WebSearch,WebFetch] --max-turns N
 *
 * The CLI uses whatever account is logged in on the server (`claude` → /login) and
 * its quota. It runs in an empty working directory and is only allowed the web tools,
 * so it cannot read or change files of the app.
 */
export function createClaudeCliRunner(deps: {
  bin: string;
  model: string | null;
  workDir: string;
  logger: Logger;
}): LlmRunner {
  const { bin, model, workDir, logger } = deps;

  return {
    async run(prompt, options) {
      await mkdir(workDir, { recursive: true });

      // The prompt goes first: --allowedTools takes several values and would swallow it.
      const args = [
        '-p',
        prompt,
        '--output-format',
        'json',
        '--max-turns',
        String(options.maxTurns),
      ];
      if (options.tools === 'web') args.push('--allowedTools=WebSearch,WebFetch');
      if (model) args.push('--model', model);

      const started = Date.now();
      return new Promise((resolve, reject) => {
        const child = spawn(bin, args, {
          cwd: workDir,
          env: process.env,
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';
        let size = 0;
        let settled = false;
        let stopReason: 'timeout' | 'abort' | 'overflow' | null = null;
        let killTimer: NodeJS.Timeout | undefined;

        const stop = (reason: 'timeout' | 'abort' | 'overflow') => {
          if (stopReason || child.exitCode !== null) return;
          stopReason = reason;
          child.kill('SIGTERM');
          killTimer = setTimeout(() => child.kill('SIGKILL'), KILL_GRACE_MS);
          killTimer.unref();
        };

        const timeout = setTimeout(() => stop('timeout'), options.timeoutMs);
        const onAbort = () => stop('abort');
        options.signal?.addEventListener('abort', onAbort, { once: true });
        if (options.signal?.aborted) stop('abort');

        const finish = (
          error: Error | null,
          value?: { text: string; meta: Record<string, unknown> },
        ) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          if (killTimer) clearTimeout(killTimer);
          options.signal?.removeEventListener('abort', onAbort);
          if (error) reject(error);
          else resolve(value!);
        };

        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', (chunk: string) => {
          size += Buffer.byteLength(chunk);
          if (size > MAX_OUTPUT_BYTES) return stop('overflow');
          stdout += chunk;
        });
        child.stderr.on('data', (chunk: string) => {
          if (stderr.length < 20_000) stderr += chunk;
        });

        child.on('error', (error: NodeJS.ErrnoException) => {
          finish(
            error.code === 'ENOENT'
              ? new AiError(
                  `Claude CLI ("${bin}") tidak ditemukan di server. Pasang Claude Code dan login dulu, atau atur BANK_IDEA_CLAUDE_BIN.`,
                )
              : new AiError(`Claude CLI gagal dijalankan: ${oneLine(error.message)}`),
          );
        });

        // When stopped, do not wait for grandchildren that may still hold the pipes open.
        child.on('exit', () => {
          if (stopReason === 'abort') finish(new AiError('Dihentikan.', true));
        });

        child.on('close', (code) => {
          if (settled) return; // spawn error already reported
          const durationMs = Date.now() - started;
          if (stopReason === 'abort') return finish(new AiError('Dihentikan.', true));
          if (stopReason === 'timeout') {
            return finish(
              new AiError(
                `Riset melebihi batas waktu ${Math.round(options.timeoutMs / 60_000)} menit dan dihentikan.`,
              ),
            );
          }
          if (stopReason === 'overflow')
            return finish(new AiError('Output Claude CLI terlalu besar.'));

          let parsed: CliResult | null = null;
          try {
            parsed = JSON.parse(stdout.trim()) as CliResult;
          } catch {
            parsed = null;
          }

          if (!parsed || typeof parsed.result !== 'string') {
            logger.warn('Claude CLI returned no JSON result', {
              code,
              stderr: oneLine(stderr, 1000),
              stdout: oneLine(stdout, 500),
            });
            const hint = oneLine(stderr || stdout) || `kode keluar ${code ?? '?'}`;
            return finish(new AiError(`Claude CLI gagal: ${hint}`));
          }

          if (parsed.is_error || (parsed.subtype && parsed.subtype !== 'success')) {
            const detail =
              parsed.subtype === 'error_max_turns'
                ? 'batas langkah riset tercapai sebelum selesai'
                : oneLine(parsed.result || parsed.subtype || 'tidak diketahui');
            return finish(new AiError(`Claude CLI mengembalikan error: ${detail}`));
          }

          finish(null, {
            text: parsed.result,
            meta: {
              provider: 'claude-cli',
              durationMs,
              costUsd: parsed.total_cost_usd ?? null,
              numTurns: parsed.num_turns ?? null,
              models: parsed.modelUsage ? Object.keys(parsed.modelUsage) : [],
            },
          });
        });
      });
    },
  };
}
