#!/usr/bin/env node
import {
  __require
} from "./chunk-Y6FXYEAI.mjs";

// src/cli.ts
import * as fs from "fs";
import * as path from "path";
var WEBHOOK_HANDLER_TS = `import express from 'express';
import { ClawTell } from '@clawtell/sdk';

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
const { ClawTell } = require('@clawtell/sdk');

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
var PACKAGE_JSON_TEMPLATE = (name, useTs) => JSON.stringify({
  name,
  version: "1.0.0",
  description: "ClawTell agent",
  main: useTs ? "dist/index.js" : "index.js",
  scripts: {
    start: useTs ? "ts-node webhook_handler.ts" : "node webhook_handler.js",
    dev: useTs ? "ts-node-dev webhook_handler.ts" : "node webhook_handler.js",
    ...useTs ? { build: "tsc" } : {}
  },
  dependencies: {
    "@clawtell/sdk": ">=0.2.5",
    "express": "^4.18.0",
    ...useTs ? { "ts-node": "^10.9.0", "ts-node-dev": "^2.0.0" } : {}
  },
  devDependencies: useTs ? {
    "@types/express": "^4.17.0",
    "@types/node": "^20.0.0",
    "typescript": "^5.0.0"
  } : {}
}, null, 2);
var TSCONFIG = JSON.stringify({
  compilerOptions: {
    target: "ES2020",
    module: "commonjs",
    lib: ["ES2020"],
    outDir: "./dist",
    rootDir: ".",
    strict: true,
    esModuleInterop: true,
    skipLibCheck: true,
    forceConsistentCasingInFileNames: true,
    resolveJsonModule: true
  },
  include: ["./**/*.ts"],
  exclude: ["node_modules", "dist"]
}, null, 2);
function printUsage() {
  console.log(`
\u{1F43E} ClawTell CLI

Usage:
  clawtell init <directory> [options]
  clawtell setup-clawdbot

Commands:
  init <dir>       Create a new ClawTell agent project
  setup-clawdbot   Install Clawdbot channel plugin (for webhook delivery)

Options:
  --js        Use JavaScript instead of TypeScript (default: TypeScript)
  --help, -h  Show this help message

Examples:
  clawtell init my-agent          # Create TypeScript project
  clawtell init my-agent --js     # Create JavaScript project
  clawtell setup-clawdbot         # Install Clawdbot plugin
  npx @clawtell/sdk init my-agent
`);
}
function setupClawdbot() {
  const os = __require("os");
  const CLAWDBOT_DIR = path.join(os.homedir(), ".clawdbot");
  const EXTENSIONS_DIR = path.join(CLAWDBOT_DIR, "extensions");
  const PLUGIN_DIR = path.join(EXTENSIONS_DIR, "clawtell");
  const PLUGIN_JSON = {
    id: "clawtell",
    channels: ["clawtell"],
    configSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        name: { type: "string", description: "Your ClawTell name" },
        apiKey: { type: "string", description: "Your ClawTell API key" },
        pollIntervalMs: { type: "number", default: 3e4 }
      }
    }
  };
  const INDEX_TS = `import type { ClawdbotPluginApi } from "clawdbot/plugin-sdk";
import { emptyPluginConfigSchema } from "clawdbot/plugin-sdk";

const plugin = {
  id: "clawtell",
  name: "ClawTell",
  description: "ClawTell channel - agent-to-agent messaging",
  configSchema: emptyPluginConfigSchema(),
  register(api: ClawdbotPluginApi) {
    api.registerChannel({
      plugin: {
        id: "clawtell",
        name: "ClawTell",
        async probe(config: any) {
          if (!config.apiKey) return { ok: false, error: "Missing apiKey" };
          const res = await fetch("https://www.clawtell.com/api/me", {
            headers: { "Authorization": \`Bearer \${config.apiKey}\` }
          });
          if (!res.ok) return { ok: false, error: "Invalid API key" };
          const data = await res.json();
          return { ok: true, detail: \`Connected as tell/\${data.name}\` };
        },
        async send(config: any, message: any) {
          const res = await fetch("https://www.clawtell.com/api/messages/send", {
            method: "POST",
            headers: {
              "Authorization": \`Bearer \${config.apiKey}\`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              to: message.to || config.name,
              body: message.text || message.body
            })
          });
          if (!res.ok) throw new Error(\`Send failed: \${res.status}\`);
          return { ok: true };
        },
        async poll(config: any) {
          const res = await fetch("https://www.clawtell.com/api/messages/inbox?unread=true", {
            headers: { "Authorization": \`Bearer \${config.apiKey}\` }
          });
          if (!res.ok) return [];
          const data = await res.json();
          return (data.messages || []).map((m: any) => ({
            id: m.id, from: m.from_name, text: m.body, timestamp: new Date(m.sent_at)
          }));
        }
      }
    });
  },
};
export default plugin;
`;
  if (!fs.existsSync(CLAWDBOT_DIR)) {
    console.log("\u274C Clawdbot not found at ~/.clawdbot/");
    console.log("   Install Clawdbot first: npm install -g clawdbot");
    process.exit(1);
  }
  console.log("\u{1F43E} Installing ClawTell channel plugin for Clawdbot...");
  if (!fs.existsSync(EXTENSIONS_DIR)) {
    fs.mkdirSync(EXTENSIONS_DIR, { recursive: true });
  }
  if (!fs.existsSync(PLUGIN_DIR)) {
    fs.mkdirSync(PLUGIN_DIR, { recursive: true });
  }
  fs.writeFileSync(path.join(PLUGIN_DIR, "clawdbot.plugin.json"), JSON.stringify(PLUGIN_JSON, null, 2));
  fs.writeFileSync(path.join(PLUGIN_DIR, "index.ts"), INDEX_TS);
  console.log("\u2705 Plugin installed to ~/.clawdbot/extensions/clawtell/");
  console.log("");
  console.log("\u{1F4DD} Add this to your Clawdbot config (~/.clawdbot/clawdbot.json):");
  console.log("");
  console.log('   "channels": {');
  console.log('     "clawtell": {');
  console.log('       "enabled": true,');
  console.log('       "name": "YOUR_NAME",');
  console.log('       "apiKey": "claw_xxx_yyy"');
  console.log("     }");
  console.log("   }");
  console.log("");
  console.log("Then restart Clawdbot: clawdbot gateway restart");
}
function init(targetDir, useJs) {
  const fullPath = path.resolve(targetDir);
  const dirName = path.basename(fullPath);
  if (!fs.existsSync(fullPath)) {
    fs.mkdirSync(fullPath, { recursive: true });
  }
  const useTs = !useJs;
  const handlerFile = useTs ? "webhook_handler.ts" : "webhook_handler.js";
  const handlerContent = useTs ? WEBHOOK_HANDLER_TS : WEBHOOK_HANDLER_JS;
  fs.writeFileSync(path.join(fullPath, handlerFile), handlerContent);
  fs.writeFileSync(path.join(fullPath, ".env.example"), ENV_EXAMPLE);
  fs.writeFileSync(path.join(fullPath, "package.json"), PACKAGE_JSON_TEMPLATE(dirName, useTs));
  if (useTs) {
    fs.writeFileSync(path.join(fullPath, "tsconfig.json"), TSCONFIG);
  }
  fs.writeFileSync(path.join(fullPath, ".gitignore"), `node_modules/
.env
dist/
`);
  console.log(`
\u{1F43E} ClawTell project created at ${fullPath}

Files created:
  ${handlerFile}    Webhook handler ready to receive messages
  .env.example      Environment template
  package.json      Dependencies
  .gitignore        Git ignore file${useTs ? "\n  tsconfig.json     TypeScript config" : ""}

Next steps:
  cd ${targetDir}
  cp .env.example .env
  # Add your CLAWTELL_API_KEY to .env
  npm install
  npm run dev

Your agent will be listening at http://localhost:3000/webhook
`);
}
var args = process.argv.slice(2);
if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
  printUsage();
  process.exit(0);
}
var command = args[0];
if (command === "init") {
  const targetDir = args[1];
  if (!targetDir) {
    console.error("Error: Please specify a directory name");
    console.error("Usage: clawtell init <directory>");
    process.exit(1);
  }
  const useJs = args.includes("--js");
  init(targetDir, useJs);
} else if (command === "setup-clawdbot") {
  setupClawdbot();
} else {
  console.error(`Unknown command: ${command}`);
  printUsage();
  process.exit(1);
}
