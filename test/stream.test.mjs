import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ClawTell } from '../src/index.mjs';
import { sseResponse, jsonResponse, mockFetch } from './helpers.mjs';

const SSE_TWO_MSGS =
  'event: connected\n' +
  'data: {"name":"alice","accountId":"acc_1","timeout":120,"lastEventId":null}\n\n' +
  'event: message\n' +
  'data: {"id":"msg_001","from":"bob","subject":"hi","body":"yo","createdAt":"2026-05-26T00:00:00Z","autoReplyEligible":true}\n\n' +
  'event: message\n' +
  'data: {"id":"msg_002","from":"bob","subject":"re","body":"more","createdAt":"2026-05-26T00:00:01Z","autoReplyEligible":true}\n\n' +
  'event: timeout\n' +
  'data: \n\n';

let originalFetch;
beforeEach(() => { originalFetch = global.fetch; });
afterEach(() => { global.fetch = originalFetch; });

describe('ClawTell.stream', () => {
  it('yields messages in order', async () => {
    global.fetch = mockFetch(() => sseResponse(SSE_TWO_MSGS));
    const client = new ClawTell({ apiKey: 'claw_test_x', baseUrl: 'https://api.example.test' });
    const got = [];
    for await (const msg of client.stream({ timeout: 120, limit: 50 })) {
      got.push(msg);
    }
    expect(got.map(m => m.id)).toEqual(['msg_001', 'msg_002']);
    expect(got[0].autoReplyEligible).toBe(true);
  });

  it('sends Authorization and query params', async () => {
    const fetchFn = mockFetch(() => sseResponse('event: timeout\ndata: \n\n'));
    global.fetch = fetchFn;
    const client = new ClawTell({ apiKey: 'claw_test_x', baseUrl: 'https://api.example.test' });
    for await (const _ of client.stream({ timeout: 90, limit: 25, account: true })) { /* none */ }
    const { url, opts } = fetchFn.calls[0];
    expect(url).toContain('clawtell-sse.fly.dev/v1/stream');
    expect(url).toContain('timeout=90');
    expect(url).toContain('limit=25');
    expect(url).toContain('account=true');
    expect(opts.headers.Authorization).toBe('Bearer claw_test_x');
  });

  it('sends Last-Event-ID header when provided', async () => {
    const fetchFn = mockFetch(() => sseResponse('event: timeout\ndata: \n\n'));
    global.fetch = fetchFn;
    const client = new ClawTell({ apiKey: 'claw_test_x', baseUrl: 'https://api.example.test' });
    for await (const _ of client.stream({ lastEventId: 'msg_999' })) { /* none */ }
    expect(fetchFn.calls[0].opts.headers['Last-Event-ID']).toBe('msg_999');
  });

  it('dedups duplicates within window', async () => {
    const dupBody =
      'event: message\ndata: {"id":"m1","from":"x","body":"a","subject":"","createdAt":"2026-05-26T00:00:00Z","autoReplyEligible":true}\n\n' +
      'event: message\ndata: {"id":"m1","from":"x","body":"a","subject":"","createdAt":"2026-05-26T00:00:00Z","autoReplyEligible":true}\n\n' +
      'event: timeout\ndata: \n\n';
    global.fetch = mockFetch(() => sseResponse(dupBody));
    const client = new ClawTell({ apiKey: 'claw_test_x', baseUrl: 'https://api.example.test' });
    const got = [];
    for await (const msg of client.stream()) got.push(msg);
    expect(got.length).toBe(1);
  });

  it('throws AuthenticationError on 401', async () => {
    global.fetch = mockFetch(() => jsonResponse(401, { error: 'unauthorized' }));
    const client = new ClawTell({ apiKey: 'claw_bad', baseUrl: 'https://api.example.test' });
    await expect(async () => {
      for await (const _ of client.stream()) { /* */ }
    }).rejects.toThrow(/invalid api key/i);
  });

  it('throws ClawTellError on 5xx', async () => {
    global.fetch = mockFetch(() => jsonResponse(503, { error: 'down' }));
    const client = new ClawTell({ apiKey: 'claw_test_x', baseUrl: 'https://api.example.test' });
    await expect(async () => {
      for await (const _ of client.stream()) { /* */ }
    }).rejects.toThrow(/sse server error/i);
  });

  it('forcePoll routes through poll() instead of SSE', async () => {
    let fetched = false;
    global.fetch = mockFetch(() => { fetched = true; return sseResponse('event: timeout\ndata: \n\n'); });
    const client = new ClawTell({ apiKey: 'claw_test_x', baseUrl: 'https://api.example.test' });
    client.poll = async () => ({
      messages: [{
        id: 'p1', from: 'x', body: 'y', subject: '',
        createdAt: 'now', autoReplyEligible: true,
      }],
    });
    const it = client.stream({ forcePoll: true });
    const { value } = await it.next();
    expect(value.id).toBe('p1');
    expect(fetched).toBe(false);
  });

  it('honors CLAWTELL_FORCE_POLL env var', async () => {
    process.env.CLAWTELL_FORCE_POLL = '1';
    try {
      let fetched = false;
      global.fetch = mockFetch(() => { fetched = true; return sseResponse('event: timeout\ndata: \n\n'); });
      const client = new ClawTell({ apiKey: 'claw_test_x', baseUrl: 'https://api.example.test' });
      let polled = false;
      client.poll = async () => { polled = true; return { messages: [] }; };
      const arr = [];
      for await (const m of client.stream()) arr.push(m);
      expect(polled).toBe(true);
      expect(fetched).toBe(false);
    } finally {
      delete process.env.CLAWTELL_FORCE_POLL;
    }
  });
});
