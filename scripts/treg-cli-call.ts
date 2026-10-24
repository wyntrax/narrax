import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { TregError, tregHeaders, type TregCall, type TregReceipt } from '@narra/narrative';

const exec = promisify(execFile);
/** Uses the user's existing CLI login without copying its token into the project or command arguments. */
export function createTregCliCall(maxCostUsd: number, onReceipt: (receipt: TregReceipt) => void): TregCall {
  return async (endpoint, body, idempotencyKey) => {
    const headers = tregHeaders(maxCostUsd, idempotencyKey);
    const args = ['--json', 'call', endpoint, '--method', 'POST', '--data', JSON.stringify(body)];
    for (const [key, value] of Object.entries(headers)) args.push('--header', `${key}: ${value}`);
    let stdout: string;
    try { ({ stdout } = await exec('treg', args, { timeout: 45_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' } })); }
    catch (e) {
      // CLI error text may include upstream payloads. Only parse its machine-readable envelope.
      stdout = typeof (e as { stdout?: unknown }).stdout === 'string' ? (e as { stdout: string }).stdout : '';
      if (!stdout) throw new TregError('TREG_CLI_FAILED');
    }
    let response;
    try { response = JSON.parse(stdout); } catch { throw new TregError('TREG_CLI_INVALID_RESPONSE'); }
    const meta = response?._treg;
    if (!meta || !Number.isInteger(meta.http_status)) throw new TregError('TREG_CLI_INVALID_RESPONSE');
    onReceipt({ endpoint, status: meta.http_status, callId: typeof meta.call_id === 'string' ? meta.call_id : null,
      costMicro: Number.isSafeInteger(meta.charged_micro) && meta.charged_micro >= 0 ? meta.charged_micro : null,
      cacheHit: false, replayed: meta.replay === true, fetchedAt: null });
    if (meta.http_status === 202 || meta.http_status < 200 || meta.http_status >= 300) throw new TregError(meta.http_status === 202 ? 'TREG_PENDING' : `TREG_HTTP_${meta.http_status}`, meta.http_status);
    return response.result;
  };
}
