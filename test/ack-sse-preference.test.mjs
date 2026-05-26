import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ClawTell } from '../src/index.mjs';
import { jsonResponse } from './helpers.mjs';

let originalFetch;
beforeEach(() => { originalFetch = global.fetch; });
afterEach(() => { global.fetch = originalFetch; });

describe('ClawTell.ack with preferSse', () => {
  it('hits SSE host /v1/ack first when preferSse=true', async () => {
    const calls = [];
    global.fetch = async (url) => {
      calls.push(String(url));
      return jsonResponse(200, { acked: ['m1'] });
    };
    const client = new ClawTell({ apiKey: 'claw_test_x', baseUrl: 'https://api.example.test' });
    const result = await client.ack(['m1'], { preferSse: true });
    expect(calls[0]).toContain('clawtell-sse.fly.dev/v1/ack');
    expect(calls.length).toBe(1);
    expect(result).toEqual({ acked: ['m1'] });
  });

  it('falls back to main API host on SSE 5xx', async () => {
    const calls = [];
    global.fetch = async (url) => {
      const s = String(url);
      calls.push(s);
      if (s.includes('clawtell-sse.fly.dev')) {
        return new Response('', { status: 503 });
      }
      return jsonResponse(200, { success: true, acked: 1 });
    };
    const client = new ClawTell({ apiKey: 'claw_test_x', baseUrl: 'https://api.example.test' });
    const result = await client.ack(['m1'], { preferSse: true });
    expect(calls.length).toBe(2);
    expect(calls[0]).toContain('clawtell-sse.fly.dev/v1/ack');
    expect(calls[1]).toContain('api.example.test/api/messages/ack');
    expect(result.success).toBe(true);
  });

  it('default ack signature unchanged (no preferSse)', async () => {
    const calls = [];
    global.fetch = async (url) => {
      calls.push(String(url));
      return jsonResponse(200, { success: true, acked: 1 });
    };
    const client = new ClawTell({ apiKey: 'claw_test_x', baseUrl: 'https://api.example.test' });
    await client.ack(['m1']);
    expect(calls[0]).toContain('api.example.test/api/messages/ack');
    expect(calls.length).toBe(1);
  });

  it('empty list returns immediately without fetch', async () => {
    let fetchCalled = false;
    global.fetch = async () => { fetchCalled = true; return jsonResponse(200, {}); };
    const client = new ClawTell({ apiKey: 'claw_test_x', baseUrl: 'https://api.example.test' });
    expect(await client.ack([])).toEqual({ success: true, acked: 0 });
    expect(await client.ack([], { preferSse: true })).toEqual({ success: true, acked: 0 });
    expect(fetchCalled).toBe(false);
  });

  it('propagates 4xx from SSE host without fallback', async () => {
    const calls = [];
    global.fetch = async (url) => {
      const s = String(url);
      calls.push(s);
      if (s.includes('clawtell-sse.fly.dev')) {
        return jsonResponse(400, { error: 'bad request' });
      }
      return jsonResponse(200, { success: true, acked: 1 });
    };
    const client = new ClawTell({ apiKey: 'claw_test_x', baseUrl: 'https://api.example.test' });
    await expect(client.ack(['m1'], { preferSse: true })).rejects.toThrow();
    expect(calls.length).toBe(1);
    expect(calls[0]).toContain('clawtell-sse.fly.dev');
  });

  it('falls back when SSE host throws connection error', async () => {
    const calls = [];
    global.fetch = async (url) => {
      const s = String(url);
      calls.push(s);
      if (s.includes('clawtell-sse.fly.dev')) {
        throw new TypeError('fetch failed');
      }
      return jsonResponse(200, { success: true, acked: 1 });
    };
    const client = new ClawTell({ apiKey: 'claw_test_x', baseUrl: 'https://api.example.test' });
    const result = await client.ack(['m1'], { preferSse: true });
    expect(calls.length).toBe(2);
    expect(result.success).toBe(true);
  });
});
