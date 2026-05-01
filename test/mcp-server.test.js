'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const McpHttpServer = require('../src/main/mcp-server');

async function postJsonRpc({ port, token, body }) {
  const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

test('tools/call dispatches to the registered tool handler with the given arguments', async (t) => {
  const calls = [];
  const tools = {
    echo: {
      description: 'echoes its input',
      inputSchema: {
        type: 'object',
        properties: { msg: { type: 'string' } },
        required: ['msg'],
      },
      handler: async (args) => {
        calls.push(args);
        return { content: [{ type: 'text', text: `you said: ${args.msg}` }] };
      },
    },
  };

  const server = new McpHttpServer({ tools });
  const { port, token } = await server.start();
  t.after(() => server.stop());

  // Sanity check: unauthenticated request is rejected (server enforces bearer auth).
  const unauth = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
  });
  assert.equal(unauth.status, 401, 'requests without a bearer token must be 401');

  // Authenticated tools/call should reach the handler and return its result.
  const { status, body } = await postJsonRpc({
    port,
    token,
    body: {
      jsonrpc: '2.0',
      id: 42,
      method: 'tools/call',
      params: { name: 'echo', arguments: { msg: 'hello' } },
    },
  });

  assert.equal(status, 200);
  assert.deepEqual(calls, [{ msg: 'hello' }], 'handler should be invoked exactly once with the forwarded arguments');
  assert.equal(body.jsonrpc, '2.0');
  assert.equal(body.id, 42);
  assert.deepEqual(body.result, {
    content: [{ type: 'text', text: 'you said: hello' }],
  });

  // Calling an unregistered tool surfaces an MCP-style error result, not a JSON-RPC error.
  const unknown = await postJsonRpc({
    port,
    token,
    body: {
      jsonrpc: '2.0',
      id: 43,
      method: 'tools/call',
      params: { name: 'nope', arguments: {} },
    },
  });
  assert.equal(unknown.status, 200);
  assert.equal(unknown.body.result.isError, true);
  assert.match(unknown.body.result.content[0].text, /Unknown tool: nope/);
});
