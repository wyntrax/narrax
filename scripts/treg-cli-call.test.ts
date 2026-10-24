import { beforeEach, expect, it, vi } from 'vitest';
import { TREG_ENDPOINTS } from '@narra/narrative';
import { createTregCliCall } from './treg-cli-call';

const exec = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', async () => {
  const { promisify } = await import('node:util');
  return { execFile: Object.assign(vi.fn(), { [promisify.custom]: exec }) };
});
beforeEach(() => { exec.mockReset(); });

it('preserves Unicode JSON, requests UTF-8 on Windows and reads CLI receipt metadata', async () => {
  const result = { output: { data: { items: [{ text: 'Narasi Solana 🚀' }] } } };
  exec.mockResolvedValue({ stdout: JSON.stringify({ result, _treg: { http_status: 200, call_id: 'call-1', charged_micro: 0, replay: true } }) });
  const receipt = vi.fn();
  expect(await createTregCliCall(.01, receipt)(TREG_ENDPOINTS.x, { query: 'Solana' }, 'request-1')).toEqual(result);
  expect(exec).toHaveBeenCalledWith('treg', expect.arrayContaining(['--json', 'Idempotency-Key: request-1']), expect.objectContaining({ env: expect.objectContaining({ PYTHONIOENCODING: 'utf-8' }), windowsHide: true }));
  expect(receipt).toHaveBeenCalledWith(expect.objectContaining({ callId: 'call-1', costMicro: 0, status: 200, replayed: true }));
});

it('records a CLI HTTP failure receipt without surfacing its private response body', async () => {
  exec.mockRejectedValue({ stdout: JSON.stringify({ result: { detail: 'private account information' }, _treg: { http_status: 402, call_id: 'refused' } }) });
  const receipt = vi.fn();
  await expect(createTregCliCall(.01, receipt)(TREG_ENDPOINTS.x, {}, 'id')).rejects.toThrow('TREG_HTTP_402');
  expect(receipt).toHaveBeenCalledWith(expect.objectContaining({ callId: 'refused', costMicro: null, status: 402 }));
  expect(exec).toHaveBeenCalledOnce();
});

it('rejects malformed output and does not mistake upstream body costs for Treg charges', async () => {
  const receipt = vi.fn(), call = createTregCliCall(.01, receipt);
  exec.mockResolvedValueOnce({ stdout: 'non-JSON console output' });
  await expect(call(TREG_ENDPOINTS.x, {}, 'id')).rejects.toThrow('TREG_CLI_INVALID_RESPONSE');
  exec.mockResolvedValueOnce({ stdout: JSON.stringify({ result: { costUsd: 4 }, _treg: { http_status: 200 } }) });
  await call(TREG_ENDPOINTS.x, {}, 'id-2');
  expect(receipt).toHaveBeenCalledWith(expect.objectContaining({ costMicro: null }));
});

it('hides process failure details and treats pending responses as pending', async () => {
  const call = createTregCliCall(.01, vi.fn());
  exec.mockRejectedValueOnce(new Error('private process details'));
  await expect(call(TREG_ENDPOINTS.x, {}, 'id')).rejects.toThrow('TREG_CLI_FAILED');
  exec.mockResolvedValueOnce({ stdout: JSON.stringify({ result: {}, _treg: { http_status: 202 } }) });
  await expect(call(TREG_ENDPOINTS.x, {}, 'id-2')).rejects.toThrow('TREG_PENDING');
});
