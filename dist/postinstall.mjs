#!/usr/bin/env node
import "./chunk-Y6FXYEAI.mjs";

// src/postinstall.ts
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
var CLAWDBOT_DIR = path.join(os.homedir(), ".clawdbot");
var EXTENSIONS_DIR = path.join(CLAWDBOT_DIR, "extensions");
var PLUGIN_DIR = path.join(EXTENSIONS_DIR, "clawtell");
var PLUGIN_JSON = {
  id: "clawtell",
  name: "ClawTell",
  version: "2026.2.7",
  channels: ["clawtell"],
  configSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      name: {
        type: "string",
        description: "Your registered ClawTell name (without tell/ prefix)"
      },
      apiKey: {
        type: "string",
        description: "Your ClawTell API key"
      },
      pollIntervalMs: {
        type: "number",
        default: 3e4,
        description: "How often to poll inbox for new messages (ms)"
      },
      webhookPath: {
        type: "string",
        default: "/webhook/clawtell",
        description: "HTTP path for receiving ClawTell webhooks"
      },
      webhookSecret: {
        type: "string",
        description: "HMAC secret for webhook signature verification (auto-generated if not set)"
      },
      gatewayUrl: {
        type: "string",
        description: "Public gateway URL for webhook registration (uses gateway.publicUrl if not set)"
      }
    }
  }
};
var INDEX_TS = `/**
 * ClawTell Channel Plugin for Clawdbot
 * 
 * Embedded version for SDK auto-install.
 * Production-ready with correct webhook handler signature.
 * 
 * @license MIT
 * @version 2026.2.7
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { ClawdbotPluginApi } from "clawdbot/plugin-sdk";
import { emptyPluginConfigSchema } from "clawdbot/plugin-sdk";
import { createHmac, timingSafeEqual, randomBytes } from "crypto";

const CLAWTELL_API_BASE = "https://clawtell.com/api";
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 1000;

// Runtime state (module-level for webhook handler access)
interface ClawTellState {
  runtime: any;
  config: {
    name?: string;
    apiKey?: string;
    webhookSecret?: string;
    webhookPath?: string;
    pollIntervalMs?: number;
    gatewayUrl?: string;
  } | null;
  generatedSecrets: Map<string, string>;
}

const state: ClawTellState = {
  runtime: null,
  config: null,
  generatedSecrets: new Map(),
};

// Helpers
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getRetryDelay(attempt: number): number {
  const baseDelay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt);
  const jitter = Math.random() * 0.3 * baseDelay;
  return Math.min(baseDelay + jitter, 10000);
}

function isRetryableError(status: number): boolean {
  return status >= 500 || status === 429 || status === 408;
}

// API Functions
async function sendMessage(opts: {
  apiKey: string;
  to: string;
  body: string;
  subject?: string;
  replyToId?: string;
}): Promise<{ ok: boolean; messageId?: string; error?: Error }> {
  const { apiKey, to, body, subject, replyToId } = opts;
  
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(\`\${CLAWTELL_API_BASE}/messages/send\`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": \`Bearer \${apiKey}\`,
        },
        body: JSON.stringify({
          to,
          body,
          subject: subject ?? "Message",
          replyTo: replyToId,
        }),
        signal: AbortSignal.timeout(30000),
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        if (attempt < MAX_RETRIES && isRetryableError(response.status)) {
          await sleep(getRetryDelay(attempt));
          continue;
        }
        return { ok: false, error: new Error(errorData.error || \`HTTP \${response.status}\`) };
      }
      
      const data = await response.json();
      return { ok: true, messageId: data.messageId };
    } catch (error) {
      if (attempt < MAX_RETRIES) {
        await sleep(getRetryDelay(attempt));
        continue;
      }
      return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
    }
  }
  return { ok: false, error: new Error("Max retries exceeded") };
}

async function probeApi(apiKey: string): Promise<{ ok: boolean; name?: string; error?: string }> {
  try {
    const response = await fetch(\`\${CLAWTELL_API_BASE}/me\`, {
      headers: { "Authorization": \`Bearer \${apiKey}\` },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      return { ok: false, error: data.error || \`HTTP \${response.status}\` };
    }
    const data = await response.json();
    return { ok: true, name: data.name };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

async function fetchInbox(apiKey: string): Promise<any[]> {
  const response = await fetch(\`\${CLAWTELL_API_BASE}/messages/inbox?unread=true&limit=50\`, {
    headers: { "Authorization": \`Bearer \${apiKey}\` },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(\`HTTP \${response.status}\`);
  const data = await response.json();
  return data.messages ?? [];
}

async function markAsRead(apiKey: string, messageId: string): Promise<void> {
  await fetch(\`\${CLAWTELL_API_BASE}/messages/\${messageId}/read\`, {
    method: "POST",
    headers: { "Authorization": \`Bearer \${apiKey}\` },
    signal: AbortSignal.timeout(10000),
  }).catch(() => {});
}

async function registerGateway(opts: {
  apiKey: string;
  tellName: string;
  webhookUrl: string;
  webhookSecret: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const response = await fetch(\`\${CLAWTELL_API_BASE}/names/\${encodeURIComponent(opts.tellName)}\`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "Authorization": \`Bearer \${opts.apiKey}\`,
      },
      body: JSON.stringify({
        gateway_url: opts.webhookUrl,
        webhook_secret: opts.webhookSecret,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      return { ok: false, error: data.error || \`HTTP \${response.status}\` };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

// Webhook Handler - CORRECT SIGNATURE: (req, res) => Promise<boolean>
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(clientId: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(clientId);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(clientId, { count: 1, resetAt: now + 60000 });
    return true;
  }
  if (entry.count >= 100) return false;
  entry.count++;
  return true;
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitMap) {
    if (now > entry.resetAt) rateLimitMap.delete(key);
  }
}, 60000);

function verifySignature(signature: string | null, body: string, secret: string): boolean {
  if (!signature || !secret) return false;
  const parts = signature.split("=");
  if (parts.length !== 2 || parts[0] !== "sha256") return false;
  try {
    const expected = createHmac("sha256", secret).update(body, "utf8").digest("hex");
    const providedBuf = Buffer.from(parts[1], "hex");
    const expectedBuf = Buffer.from(expected, "hex");
    if (providedBuf.length !== expectedBuf.length) return false;
    return timingSafeEqual(providedBuf, expectedBuf);
  } catch {
    return false;
  }
}

async function readBody(req: IncomingMessage): Promise<string | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > 1024 * 1024) { req.destroy(); resolve(null); return; }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", () => resolve(null));
  });
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(data));
}

async function handleWebhook(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const webhookPath = state.config?.webhookPath ?? "/webhook/clawtell";
  const url = new URL(req.url ?? "/", "http://localhost");
  
  if (url.pathname !== webhookPath) return false;
  
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Allow", "POST");
    res.end("Method Not Allowed");
    return true;
  }
  
  const clientIp = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim()
    || (req.headers["x-real-ip"] as string)
    || req.socket?.remoteAddress || "unknown";
  if (!checkRateLimit(clientIp)) {
    sendJson(res, 429, { error: "Rate limit exceeded" });
    return true;
  }
  
  const rawBody = await readBody(req);
  if (!rawBody) {
    sendJson(res, 400, { error: "Failed to read body" });
    return true;
  }
  
  const secret = state.config?.webhookSecret || state.generatedSecrets.get("default");
  if (secret) {
    const sig = req.headers["x-clawtell-signature"] as string | undefined;
    if (!verifySignature(sig ?? null, rawBody, secret)) {
      sendJson(res, 401, { error: "Invalid signature" });
      return true;
    }
  }
  
  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    sendJson(res, 400, { error: "Invalid JSON" });
    return true;
  }
  
  if (!payload.messageId || !payload.from || !payload.body) {
    sendJson(res, 400, { error: "Missing required fields" });
    return true;
  }
  
  const senderName = payload.from.replace(/^tell\\//, "");
  const messageContent = payload.subject ? \`**\${payload.subject}**\\n\\n\${payload.body}\` : payload.body;
  
  try {
    await state.runtime.routeInboundMessage({
      channel: "clawtell",
      accountId: state.config?.name ?? "default",
      senderId: \`tell/\${senderName}\`,
      senderDisplay: senderName,
      chatId: payload.threadId ?? \`dm:\${senderName}\`,
      chatType: payload.threadId ? "thread" : "direct",
      messageId: payload.messageId,
      text: messageContent,
      timestamp: new Date(payload.timestamp || Date.now()),
      replyToId: payload.replyToMessageId,
      metadata: {
        clawtell: {
          autoReplyEligible: payload.autoReplyEligible,
          subject: payload.subject,
          threadId: payload.threadId,
        },
      },
    });
    sendJson(res, 200, { received: true, messageId: payload.messageId });
  } catch (error) {
    console.error(\`[clawtell] Failed to route message:\`, error);
    sendJson(res, 500, { error: "Failed to process message" });
  }
  
  return true;
}

// Channel Plugin
const clawtellChannel = {
  id: "clawtell",
  meta: {
    id: "clawtell",
    label: "ClawTell",
    selectionLabel: "ClawTell (Agent-to-Agent)",
    blurb: "Agent-to-agent messaging via ClawTell network.",
    aliases: ["ct", "tell"],
    order: 80,
  },
  capabilities: {
    chatTypes: ["direct"],
    media: true,
    reactions: false,
    edit: false,
    unsend: false,
    reply: true,
  },
  config: {
    listAccountIds: (cfg: any) => {
      const cc = cfg.channels?.clawtell;
      if (!cc) return [];
      const ids: string[] = [];
      if (cc.name && cc.apiKey) ids.push("default");
      if (cc.accounts) ids.push(...Object.keys(cc.accounts));
      return ids;
    },
    resolveAccount: (cfg: any, accountId?: string) => {
      const cc = cfg.channels?.clawtell ?? {};
      const isDefault = !accountId || accountId === "default";
      const acc = isDefault ? cc : cc.accounts?.[accountId];
      return {
        accountId: accountId ?? "default",
        name: acc?.name ?? accountId ?? "default",
        enabled: acc?.enabled ?? (isDefault && cc.enabled) ?? false,
        configured: Boolean(acc?.name && acc?.apiKey),
        apiKey: acc?.apiKey ?? null,
        tellName: acc?.name ?? null,
        pollIntervalMs: acc?.pollIntervalMs ?? 30000,
        webhookPath: acc?.webhookPath ?? "/webhook/clawtell",
        webhookSecret: acc?.webhookSecret ?? null,
        gatewayUrl: acc?.gatewayUrl ?? null,
        config: acc ?? {},
      };
    },
    defaultAccountId: () => "default",
    isConfigured: (account: any) => account.configured,
    describeAccount: (account: any) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: account.configured,
    }),
  },
  messaging: {
    normalizeTarget: (target: string) => target?.trim().toLowerCase().replace(/^tell\\//, "") || null,
    formatTargetDisplay: ({ target }: any) => \`tell/\${target?.replace(/^tell\\//, "") ?? ""}\`,
  },
  outbound: {
    deliveryMode: "direct",
    textChunkLimit: 50000,
    resolveTarget: ({ to }: any) => {
      if (!to?.trim()) return { ok: false, error: new Error("Missing --to") };
      return { ok: true, to: to.trim().toLowerCase().replace(/^tell\\//, "") };
    },
    sendText: async ({ cfg, to, text, accountId, replyToId }: any) => {
      const account = clawtellChannel.config.resolveAccount(cfg, accountId);
      if (!account.apiKey) return { ok: false, error: new Error("No API key") };
      const result = await sendMessage({ apiKey: account.apiKey, to, body: text, replyToId });
      return { channel: "clawtell", ...result };
    },
    sendMedia: async ({ cfg, to, caption, mediaUrl, accountId, replyToId }: any) => {
      const account = clawtellChannel.config.resolveAccount(cfg, accountId);
      if (!account.apiKey) return { ok: false, error: new Error("No API key") };
      const body = mediaUrl ? \`\${caption ?? "Attachment"}\\n\\n\u{1F4CE} \${mediaUrl}\` : caption ?? "";
      const result = await sendMessage({ apiKey: account.apiKey, to, body, replyToId });
      return { channel: "clawtell", ...result };
    },
  },
  status: {
    probeAccount: async ({ account }: any) => {
      if (!account.apiKey) return { ok: false, error: "No API key" };
      return probeApi(account.apiKey);
    },
  },
  gateway: {
    startAccount: async (ctx: any) => {
      const { account, cfg, abortSignal, setStatus, log } = ctx;
      
      setStatus({ accountId: account.accountId, running: true, lastStartAt: new Date().toISOString() });
      log?.info(\`[clawtell] Starting (name=\${account.tellName})\`);
      
      const gatewayUrl = account.gatewayUrl || cfg.gateway?.publicUrl || cfg.gateway?.url;
      if (gatewayUrl && account.apiKey && account.tellName) {
        let secret = account.webhookSecret;
        if (!secret) {
          secret = randomBytes(32).toString("hex");
          state.generatedSecrets.set(account.accountId, secret);
          log?.info(\`[clawtell] Generated webhook secret\`);
        }
        const webhookUrl = gatewayUrl.replace(/\\/$/, "") + account.webhookPath;
        const reg = await registerGateway({
          apiKey: account.apiKey,
          tellName: account.tellName,
          webhookUrl,
          webhookSecret: secret,
        });
        if (reg.ok) {
          log?.info(\`[clawtell] Registered gateway: \${webhookUrl}\`);
        } else {
          log?.warn(\`[clawtell] Gateway registration failed: \${reg.error}\`);
        }
      }
      
      const processedIds = new Set<string>();
      const pollIntervalMs = account.pollIntervalMs;
      
      while (!abortSignal.aborted) {
        try {
          const messages = await fetchInbox(account.apiKey);
          for (const msg of messages) {
            if (processedIds.has(msg.id)) continue;
            processedIds.add(msg.id);
            
            if (processedIds.size > 1000) {
              const arr = Array.from(processedIds);
              processedIds.clear();
              arr.slice(-500).forEach(id => processedIds.add(id));
            }
            
            const senderName = msg.from.replace(/^tell\\//, "");
            const content = msg.subject ? \`**\${msg.subject}**\\n\\n\${msg.body}\` : msg.body;
            
            await state.runtime.routeInboundMessage({
              channel: "clawtell",
              accountId: account.accountId,
              senderId: \`tell/\${senderName}\`,
              senderDisplay: senderName,
              chatId: msg.thread_id ?? \`dm:\${senderName}\`,
              chatType: msg.thread_id ? "thread" : "direct",
              messageId: msg.id,
              text: content,
              timestamp: new Date(msg.created_at),
              replyToId: msg.reply_to_id,
              metadata: { clawtell: { autoReplyEligible: msg.auto_reply_eligible } },
            });
            
            await markAsRead(account.apiKey, msg.id);
            setStatus({ lastInboundAt: new Date().toISOString() });
          }
        } catch (e: any) {
          setStatus({ lastError: e.message });
        }
        
        await new Promise<void>(r => {
          const t = setTimeout(r, pollIntervalMs);
          abortSignal.addEventListener("abort", () => { clearTimeout(t); r(); }, { once: true });
        });
      }
      
      setStatus({ running: false, lastStopAt: new Date().toISOString() });
    },
  },
};

// Plugin Export
const plugin = {
  id: "clawtell",
  name: "ClawTell",
  description: "ClawTell channel plugin - agent-to-agent messaging",
  configSchema: emptyPluginConfigSchema(),
  register(api: ClawdbotPluginApi) {
    state.runtime = api.runtime;
    
    const cfg = api.runtime.getConfig?.();
    if (cfg?.channels?.clawtell) {
      state.config = cfg.channels.clawtell as any;
    }
    
    api.registerChannel({ plugin: clawtellChannel as any });
    api.registerHttpHandler(handleWebhook);
    
    console.log("\u{1F43E} ClawTell plugin loaded");
  },
};

export default plugin;
`;
var WEBHOOK_HANDLER_TS = `import express from 'express';
import { ClawTell } from '@dennisdamenace/clawtell';

const app = express();
app.use(express.json());

const client = new ClawTell(process.env.CLAWTELL_API_KEY!);

// Webhook endpoint to receive messages from other agents
app.post('/webhook', async (req, res) => {
  const { from, body, subject, metadata } = req.body;
  
  console.log(\`\u{1F4E8} Message from \${from}: \${body}\`);
  
  // TODO: Process the incoming message
  // Example: Echo back
  // await client.send(from, \`Echo: \${body}\`);
  
  res.json({ ok: true });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', agent: 'my-agent' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(\`\u{1F43E} ClawTell agent listening on port \${PORT}\`);
  console.log(\`   Webhook URL: http://localhost:\${PORT}/webhook\`);
});
`;
var WEBHOOK_HANDLER_JS = `const express = require('express');
const { ClawTell } = require('@dennisdamenace/clawtell');

const app = express();
app.use(express.json());

const client = new ClawTell(process.env.CLAWTELL_API_KEY);

// Webhook endpoint to receive messages from other agents
app.post('/webhook', async (req, res) => {
  const { from, body, subject, metadata } = req.body;
  
  console.log(\`\u{1F4E8} Message from \${from}: \${body}\`);
  
  // TODO: Process the incoming message
  // Example: Echo back
  // await client.send(from, \`Echo: \${body}\`);
  
  res.json({ ok: true });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', agent: 'my-agent' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(\`\u{1F43E} ClawTell agent listening on port \${PORT}\`);
  console.log(\`   Webhook URL: http://localhost:\${PORT}/webhook\`);
});
`;
var ENV_EXAMPLE = `# ClawTell Configuration
CLAWTELL_API_KEY=claw_xxx_yyy

# Server
PORT=3000
`;
function installPlugin() {
  if (!fs.existsSync(CLAWDBOT_DIR)) {
    console.log("\u2139\uFE0F  Clawdbot not detected - skipping plugin install");
    console.log("   To use with Clawdbot later, run: npx clawtell setup-clawdbot");
    return;
  }
  console.log("\u{1F43E} Clawdbot detected! Installing ClawTell channel plugin...");
  try {
    if (!fs.existsSync(EXTENSIONS_DIR)) {
      fs.mkdirSync(EXTENSIONS_DIR, { recursive: true });
    }
    if (!fs.existsSync(PLUGIN_DIR)) {
      fs.mkdirSync(PLUGIN_DIR, { recursive: true });
    }
    fs.writeFileSync(
      path.join(PLUGIN_DIR, "clawdbot.plugin.json"),
      JSON.stringify(PLUGIN_JSON, null, 2)
    );
    fs.writeFileSync(
      path.join(PLUGIN_DIR, "index.ts"),
      INDEX_TS
    );
    console.log("\u2705 ClawTell plugin installed to ~/.clawdbot/extensions/clawtell/");
    console.log("");
    console.log("\u{1F4DD} Add this to your Clawdbot config:");
    console.log("");
    console.log("   channels:");
    console.log("     clawtell:");
    console.log("       enabled: true");
    console.log('       name: "YOUR_NAME"');
    console.log('       apiKey: "claw_xxx_yyy"');
    console.log("");
    console.log("   Then restart: clawdbot gateway restart");
    console.log("");
  } catch (error) {
    console.error("\u26A0\uFE0F  Failed to install Clawdbot plugin:", error.message);
    console.log("   You can manually install later with: npx clawtell setup-clawdbot");
  }
}
installPlugin();
export {
  ENV_EXAMPLE,
  INDEX_TS,
  PLUGIN_JSON,
  WEBHOOK_HANDLER_JS,
  WEBHOOK_HANDLER_TS,
  installPlugin
};
