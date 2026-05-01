'use strict';

const http = require('node:http');
const crypto = require('node:crypto');

class McpHttpServer {
  constructor({ tools, host = '127.0.0.1' }) {
    this.tools = tools;
    this.host = host;
    this.token = crypto.randomBytes(24).toString('hex');
    this.port = 0;
    this.server = http.createServer((req, res) => this._handle(req, res));
  }

  start() {
    return new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(0, this.host, () => {
        const addr = this.server.address();
        this.port = addr.port;
        this.server.removeAllListeners('error');
        resolve({ port: this.port, token: this.token });
      });
    });
  }

  stop() {
    return new Promise((resolve) => this.server.close(() => resolve()));
  }

  _readBody(req) {
    return new Promise((resolve, reject) => {
      let body = '';
      req.setEncoding('utf8');
      req.on('data', (chunk) => {
        body += chunk;
        if (body.length > 5 * 1024 * 1024) {
          reject(new Error('payload too large'));
          req.destroy();
        }
      });
      req.on('end', () => resolve(body));
      req.on('error', reject);
    });
  }

  async _handle(req, res) {
    try {
      // CORS preflight (Claude Code shouldn't need this, but be permissive on localhost)
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'authorization, content-type, mcp-session-id',
          'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
        });
        res.end();
        return;
      }

      // Health check
      if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      const url = req.url || '';
      if (!url.startsWith('/mcp')) {
        res.writeHead(404).end();
        return;
      }

      const auth = req.headers['authorization'] || '';
      if (auth !== `Bearer ${this.token}`) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'unauthorized' }));
        return;
      }

      // GET /mcp without a body — used by some clients to probe SSE; respond empty.
      if (req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      if (req.method !== 'POST') {
        res.writeHead(405).end();
        return;
      }

      const raw = await this._readBody(req);
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch (_) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }));
        return;
      }

      // Batched requests
      if (Array.isArray(msg)) {
        const responses = await Promise.all(msg.map((m) => this._dispatch(m)));
        const filtered = responses.filter((r) => r !== null);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(filtered));
        return;
      }

      const response = await this._dispatch(msg);
      if (response === null) {
        // Notification — no response body
        res.writeHead(202).end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(response));
    } catch (e) {
      console.error('[mcp-server] handler error:', e);
      try {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32603, message: 'Internal error' } }));
      } catch (_) {}
    }
  }

  async _dispatch(msg) {
    const id = msg && Object.prototype.hasOwnProperty.call(msg, 'id') ? msg.id : null;
    const method = msg && msg.method;

    // Notifications (no id) → no response
    const isNotification = id === null && method && method.startsWith('notifications/');

    if (method === 'initialize') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'anthology', version: '0.1.0' },
        },
      };
    }
    if (isNotification) {
      return null;
    }
    if (method === 'ping') {
      return { jsonrpc: '2.0', id, result: {} };
    }
    if (method === 'tools/list') {
      const tools = Object.entries(this.tools).map(([name, t]) => ({
        name,
        description: t.description,
        inputSchema: t.inputSchema,
      }));
      return { jsonrpc: '2.0', id, result: { tools } };
    }
    if (method === 'tools/call') {
      const params = msg.params || {};
      const tool = this.tools[params.name];
      if (!tool) {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: `Unknown tool: ${params.name}` }],
            isError: true,
          },
        };
      }
      try {
        const result = await tool.handler(params.arguments || {});
        // Tool handlers return { content: [...], isError? } already
        return { jsonrpc: '2.0', id, result };
      } catch (e) {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: `Error: ${e && e.message ? e.message : String(e)}` }],
            isError: true,
          },
        };
      }
    }

    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    };
  }
}

module.exports = McpHttpServer;
