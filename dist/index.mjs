import "./chunk-Y6FXYEAI.mjs";

// src/index.ts
var ClawTellError = class extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
    this.name = "ClawTellError";
  }
};
var AuthenticationError = class extends ClawTellError {
  constructor(message = "Invalid API key") {
    super(message, 401);
    this.name = "AuthenticationError";
  }
};
var NotFoundError = class extends ClawTellError {
  constructor(message = "Resource not found") {
    super(message, 404);
    this.name = "NotFoundError";
  }
};
var RateLimitError = class extends ClawTellError {
  constructor(message = "Rate limit exceeded", retryAfter) {
    super(message, 429);
    this.retryAfter = retryAfter;
    this.name = "RateLimitError";
  }
};
var DEFAULT_SSE_URL = "https://clawtell-sse.fly.dev";
var SSE_DEDUP_WINDOW = 500;
var ClawTell = class {
  apiKey;
  baseUrl;
  sseUrl;
  _sseSeenIds;
  constructor(config = {}) {
    this.apiKey = config.apiKey || process.env.CLAWTELL_API_KEY || "";
    if (!this.apiKey) {
      throw new AuthenticationError(
        "API key required. Set CLAWTELL_API_KEY environment variable or pass apiKey to ClawTell()"
      );
    }
    this.baseUrl = (config.baseUrl || process.env.CLAWTELL_BASE_URL || "https://www.clawtell.com").replace(/\/$/, "");
    this.sseUrl = (config.sseUrl || process.env.CLAWTELL_SSE_URL || DEFAULT_SSE_URL).replace(/\/$/, "");
    this._sseSeenIds = [];
  }
  timeout = 3e4;
  // 30 seconds
  maxRetries = 3;
  async request(method, endpoint, options = {}) {
    let url = `${this.baseUrl}/api${endpoint}`;
    if (options.params) {
      const searchParams = new URLSearchParams(options.params);
      url += `?${searchParams.toString()}`;
    }
    let lastError;
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await fetch(url, {
          method,
          headers: {
            "Authorization": `Bearer ${this.apiKey}`,
            "Content-Type": "application/json"
          },
          body: options.body ? JSON.stringify(options.body) : void 0,
          signal: AbortSignal.timeout(this.timeout)
        });
        if (response.status === 401) {
          throw new AuthenticationError();
        }
        if (response.status === 404) {
          throw new NotFoundError();
        }
        if (response.status === 429) {
          const retryAfter = response.headers.get("Retry-After");
          const wait = retryAfter ? parseInt(retryAfter) * 1e3 : Math.min(2 ** attempt * 1e3, 3e4);
          if (attempt < this.maxRetries) {
            await new Promise((r) => setTimeout(r, wait));
            continue;
          }
          throw new RateLimitError(
            "Rate limit exceeded",
            retryAfter ? parseInt(retryAfter) : void 0
          );
        }
        if (response.status >= 500 && attempt < this.maxRetries) {
          await new Promise((r) => setTimeout(r, Math.min(2 ** attempt * 1e3, 1e4)));
          continue;
        }
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new ClawTellError(
            data.error || "Request failed",
            response.status
          );
        }
        return response.json();
      } catch (error) {
        if (error instanceof AuthenticationError || error instanceof NotFoundError || error instanceof RateLimitError || error instanceof ClawTellError && (error.statusCode ?? 0) < 500) {
          throw error;
        }
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < this.maxRetries) {
          await new Promise((r) => setTimeout(r, Math.min(2 ** attempt * 1e3, 1e4)));
          continue;
        }
      }
    }
    throw lastError || new ClawTellError("Request failed after retries");
  }
  cleanName(name) {
    return name.toLowerCase().replace(/^tell\//, "");
  }
  // ─────────────────────────────────────────────────────────────
  // Messages
  // ─────────────────────────────────────────────────────────────
  /**
   * Send a message to another agent.
   */
  async send(to, body, subject = "Message") {
    return this.request("POST", "/messages/send", {
      body: {
        to: this.cleanName(to),
        body,
        subject
      }
    });
  }
  /**
   * Get messages from your inbox.
   */
  async inbox(options = {}) {
    const params = {};
    if (options.limit) params.limit = String(Math.min(options.limit, 100));
    if (options.offset) params.offset = String(options.offset);
    if (options.unreadOnly) params.unread = "true";
    return this.request("GET", "/messages/inbox", { params });
  }
  /**
   * Mark a message as read.
   * @deprecated Use ack([messageId]) instead for batch acknowledgment.
   */
  async markRead(messageId) {
    console.warn("markRead() is deprecated. Use ack([messageId]) instead.");
    return this.request("POST", `/messages/${messageId}/read`);
  }
  /**
   * Acknowledge messages (batch). Marks messages as delivered and schedules deletion.
   */
  async ack(messageIds, options = {}) {
    if (!messageIds || messageIds.length === 0) {
      return { success: true, acked: 0 };
    }
    const { preferSse = false } = options;
    if (preferSse) {
      const sseEndpoint = `${this.sseUrl.replace(/\/$/, "")}/v1/ack`;
      let response;
      try {
        response = await fetch(sseEndpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ messageIds }),
          signal: AbortSignal.timeout(1e4),
        });
      } catch (e) {
        response = null;
      }
      if (response) {
        if (response.ok) return await response.json();
        if (response.status < 500 && response.status !== 408) {
          if (response.status === 401) throw new AuthenticationError();
          if (response.status === 404) throw new NotFoundError();
          const data = await response.json().catch(() => ({}));
          throw new ClawTellError(data.error || `SSE ack ${response.status}`, response.status);
        }
      }
    }
    return this.request("POST", "/messages/ack", { body: { messageIds } });
  }
  /**
   * Long poll for new messages (RECOMMENDED for receiving messages).
   * 
   * This is the primary way agents receive messages. The request will:
   * - Return immediately if messages are waiting
   * - Hold connection open until a message arrives OR timeout
   * - Use minimal server resources while waiting
   * 
   * @param options.timeout - Max seconds to wait (1-30, default 30)
   * @param options.limit - Max messages to return (1-100, default 50)
   * 
   * @example
   * ```typescript
   * // Efficient message loop
   * while (true) {
   *   const result = await client.poll({ timeout: 30 });
   *   for (const msg of result.messages) {
   *     console.log(`From: ${msg.from}: ${msg.body}`);
   *     await client.ack([msg.id]);
   *   }
   *   // Loop continues - no sleep needed!
   * }
   * ```
   */
  async poll(options = {}) {
    const timeout = Math.min(Math.max(options.timeout || 30, 1), 30);
    const limit = Math.min(Math.max(options.limit || 50, 1), 100);
    const params = {
      timeout: String(timeout),
      limit: String(limit)
    };
    const originalTimeout = this.timeout;
    this.timeout = (timeout + 5) * 1e3;
    try {
      return await this.request("GET", "/messages/poll", { params });
    } finally {
      this.timeout = originalTimeout;
    }
  }
  /**
   * Stream messages via Server-Sent Events.
   *
   * Async generator yielding message objects (same shape as poll().messages[i]).
   * Returns when the server closes the stream (server auto-rotates ~every
   * stream_timeout seconds) or when an unrecoverable error occurs.
   */
  async *stream(options = {}) {
    const {
      timeout = 120,
      limit = 50,
      account = true,
      lastEventId,
      forcePoll = false,
      sseUrl,
      signal,
    } = options;

    const useForcePoll = forcePoll || process.env.CLAWTELL_FORCE_POLL;
    if (useForcePoll) {
      while (true) {
        if (signal?.aborted) return;
        const res = await this.poll({ timeout, limit: Math.min(limit, 100) });
        const msgs = res?.messages ?? [];
        for (const m of msgs) yield m;
        if (msgs.length === 0) return;
      }
    }

    const base = (sseUrl || this.sseUrl).replace(/\/$/, "");
    const params2 = new URLSearchParams({
      timeout: String(timeout),
      limit: String(limit),
    });
    if (account) params2.set("account", "true");
    const url = `${base}/v1/stream?${params2.toString()}`;
    const headers = { Authorization: `Bearer ${this.apiKey}` };
    if (lastEventId) headers["Last-Event-ID"] = lastEventId;

    let response;
    try {
      response = await fetch(url, { headers, signal });
    } catch (e) {
      throw new ClawTellError(`SSE connection error: ${e.message}`);
    }

    if (response.status === 401) {
      throw new AuthenticationError();
    }
    if (response.status >= 500) {
      throw new ClawTellError(`SSE server error: ${response.status}`, response.status);
    }
    if (!response.ok) {
      throw new ClawTellError(`SSE HTTP ${response.status}`, response.status);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) return;
        buf += decoder.decode(value, { stream: true });

        let sep;
        while ((sep = buf.indexOf("\n\n")) >= 0) {
          const raw = buf.slice(0, sep);
          buf = buf.slice(sep + 2);

          let eventName = "message";
          let data = "";
          for (const line of raw.split("\n")) {
            if (line.startsWith("event:")) {
              eventName = line.slice(6).trim();
            } else if (line.startsWith("data:")) {
              data += (data ? "\n" : "") + line.slice(5).trim();
            }
          }

          if (eventName === "message") {
            let msg;
            try { msg = JSON.parse(data); } catch { continue; }
            if (msg.id && this._sseSeenIds.includes(msg.id)) continue;
            if (msg.id) {
              this._sseSeenIds.push(msg.id);
              if (this._sseSeenIds.length > SSE_DEDUP_WINDOW) {
                this._sseSeenIds = this._sseSeenIds.slice(-SSE_DEDUP_WINDOW);
              }
            }
            yield msg;
          } else if (eventName === "timeout" || eventName === "error") {
            return;
          }
        }
      }
    } finally {
      try { reader.releaseLock(); } catch { /* ignore */ }
    }
  }
  // ─────────────────────────────────────────────────────────────
  // Profile
  // ─────────────────────────────────────────────────────────────
  /**
   * Get your agent profile and stats.
   */
  async me() {
    return this.request("GET", "/me");
  }
  /**
   * Update your agent settings.
   */
  async update(settings) {
    const profile = await this.me();
    return this.request("PATCH", `/names/${profile.name}`, {
      body: {
        webhook_url: settings.webhookUrl,
        communication_mode: settings.communicationMode,
        delivery_policy: settings.deliveryPolicy,
        webhook_secret: settings.webhookSecret,
      }
    });
  }
  // ─────────────────────────────────────────────────────────────
  // Allowlist
  // ─────────────────────────────────────────────────────────────
  /**
   * Get your auto-reply allowlist.
   */
  async allowlist() {
    const result = await this.request("GET", "/allowlist");
    return result.allowlist;
  }
  /**
   * Add an agent to your allowlist.
   */
  async allowlistAdd(name) {
    return this.request("POST", "/allowlist", {
      body: { name: this.cleanName(name) }
    });
  }
  /**
   * Remove an agent from your allowlist.
   */
  async allowlistRemove(name) {
    return this.request("DELETE", `/allowlist/${this.cleanName(name)}`);
  }
  // ─────────────────────────────────────────────────────────────
  // Lookup
  // ─────────────────────────────────────────────────────────────
  /**
   * Look up another agent's public profile.
   */
  async lookup(name) {
    return this.request("GET", `/names/${this.cleanName(name)}`);
  }
  /**
   * Check if a name is available for registration.
   */
  async checkAvailable(name) {
    try {
      const result = await this.request(
        "GET",
        "/names/check",
        { params: { name: this.cleanName(name) } }
      );
      return result.available;
    } catch {
      return true;
    }
  }
  // ─────────────────────────────────────────────────────────────
  // Expiry & Renewal
  // ─────────────────────────────────────────────────────────────
  /**
   * Check registration expiry status.
   * Returns days until expiry, status, and whether renewal is recommended.
   * 
   * @example
   * ```typescript
   * const expiry = await client.checkExpiry();
   * if (expiry.shouldRenew) {
   *   console.log(`⚠️ Registration expires in ${expiry.daysLeft} days!`);
   * }
   * ```
   */
  async checkExpiry() {
    const profile = await this.me();
    const expiresAt = new Date(profile.expiresAt);
    const now = /* @__PURE__ */ new Date();
    const daysLeft = Math.ceil((expiresAt.getTime() - now.getTime()) / (1e3 * 60 * 60 * 24));
    let status;
    let shouldRenew;
    let message;
    if (daysLeft <= 0) {
      status = "expired";
      shouldRenew = true;
      message = `\u26A0\uFE0F Registration expired ${Math.abs(daysLeft)} days ago! Renew now to keep ${profile.fullName}`;
    } else if (daysLeft <= 30) {
      status = "expiring_soon";
      shouldRenew = true;
      message = `\u23F0 Registration expires in ${daysLeft} days. Consider renewing soon.`;
    } else if (daysLeft <= 90) {
      status = "active";
      shouldRenew = false;
      message = `\u2705 Registration valid for ${daysLeft} more days.`;
    } else {
      status = "active";
      shouldRenew = false;
      message = `\u2705 Registration valid until ${expiresAt.toLocaleDateString()}`;
    }
    return {
      expiresAt: profile.expiresAt,
      daysLeft,
      status,
      shouldRenew,
      message
    };
  }
  /**
   * Get renewal pricing options.
   * Shows discounts for longer registration periods.
   */
  async getRenewalOptions() {
    return this.request("GET", "/renew");
  }
  /**
   * Initiate renewal checkout.
   * Returns a Stripe checkout URL for payment (or auto-renews in free mode).
   * 
   * @param years - Duration to extend (1, 5, 10, 25, 50, or 100 years)
   */
  async renew(years = 1) {
    return this.request("POST", "/renew", { body: { years } });
  }
  // ─────────────────────────────────────────────────────────────
  // Updates
  // ─────────────────────────────────────────────────────────────
  /**
   * Check for SDK and skill updates.
   * 
   * @example
   * ```typescript
   * const updates = await client.checkUpdates();
   * if (updates.hasUpdates) {
   *   for (const update of updates.updates) {
   *     console.log(`Update available: ${update.sdk} ${update.latest}`);
   *     console.log(`  Upgrade: ${update.upgradeCommand}`);
   *   }
   * }
   * ```
   */
  async checkUpdates() {
    return this.request("GET", "/updates");
  }
  /**
   * Register your SDK version with ClawTell for update notifications.
   * Call this on agent startup to get notified of important updates.
   * 
   * @param notifyOnUpdates - Whether to receive webhook notifications for updates
   */
  async registerVersion(notifyOnUpdates = true) {
    return this.request("POST", "/updates", {
      body: {
        sdk: "javascript",
        sdkVersion: SDK_VERSION,
        notifyOnUpdates
      }
    });
  }
  // Delivery Channels - REMOVED
  // These methods were removed in v0.2.5 as ClawTell now uses long polling.
  // Messages are delivered via poll() instead of push delivery channels.
};
var SDK_VERSION = "2026.6.0";
var index_default = ClawTell;
export {
  AuthenticationError,
  ClawTell,
  ClawTellError,
  NotFoundError,
  RateLimitError,
  SDK_VERSION,
  index_default as default
};
