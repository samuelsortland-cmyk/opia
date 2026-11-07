#!/usr/bin/env node
'use strict';
// Opia bridge: a tiny, dependency-free stdio MCP server with two tools.
//
// `see_screen` returns a screenshot of the user's screen (the display under their cursor),
// fetched from Opia's localhost HTTP server, so Claude can see what the user is looking at.
//
// Claude Code calls the `approve` tool (via --permission-prompt-tool mcp__opia__approve)
// whenever a tool needs permission. We forward the request to Opia's localhost HTTP
// server (inside agent.js) and return its decision as the text JSON Claude Code expects:
//   {"behavior":"allow","updatedInput":{...}}  or  {"behavior":"deny","message":"..."}
//
// Env: OPIA_PERM_URL (e.g. http://127.0.0.1:12345/approve), OPIA_SCREEN_URL, OPIA_TEAM_URL, OPIA_CREW_URL, OPIA_PERM_TOKEN.
// Protocol: JSON-RPC 2.0, one message per line on stdin/stdout. Logs go to stderr only.

const URL_ = process.env.OPIA_PERM_URL;
const SCREEN_URL = process.env.OPIA_SCREEN_URL;
const TEAM_URL = process.env.OPIA_TEAM_URL;
const ROLE = process.env.OPIA_ROLE || 'solo'; // 'lead' (may call in helpers), 'helper', or 'solo'
const MAX_HELPERS = Number(process.env.OPIA_MAX_HELPERS || 3);

const TEAM_TOOLS = [
  {
    name: 'spawn_helpers',
    description: `Call in up to ${MAX_HELPERS} helper Opias to work on independent parts of a long task IN PARALLEL, then wait for all of them and get their results. ` +
      'Each helper is another Opia with the same tools (its own hidden browser, this computer\'s files) and can\'t see this chat, so give each a complete, self-contained task. ' +
      'Helpers coordinate on the team board. Use only for long tasks that split into independent parts.',
    inputSchema: {
      type: 'object',
      properties: {
        goal: { type: 'string', description: 'The overall goal, in one or two sentences (all helpers see it).' },
        helpers: {
          type: 'array', minItems: 1, maxItems: MAX_HELPERS,
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Short name for this part, 2-4 words (shown on screen).' },
              task: { type: 'string', description: 'Complete, self-contained instructions for this helper: what to do and what to report back.' },
            },
            required: ['name', 'task'],
          },
        },
      },
      required: ['goal', 'helpers'],
    },
  },
  {
    name: 'team_board_read',
    description: 'Read the team board: notes posted by the main Opia and the helpers (shared facts, decisions, what is already covered).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'team_board_post',
    description: 'Post a short note on the team board for the main Opia and the other helpers (key facts, decisions, what you have covered).',
    inputSchema: { type: 'object', properties: { note: { type: 'string', description: 'The note, 1-4 sentences.' } }, required: ['note'] },
  },
];
function teamTools() {
  if (!TEAM_URL) return [];
  if (ROLE === 'lead') return TEAM_TOOLS;
  if (ROLE === 'helper') return TEAM_TOOLS.slice(1);
  return [];
}
async function teamCall(name, args) {
  const action = { spawn_helpers: 'spawn', team_board_read: 'board_read', team_board_post: 'board_post' }[name];
  try {
    const r = await postJson(TEAM_URL, { action, args: args || {} });
    if (!r || r.error) return { content: [{ type: 'text', text: (r && r.error) || 'The team tool failed.' }], isError: true };
    return { content: [{ type: 'text', text: String(r.text || '') }] };
  } catch (e) {
    return { content: [{ type: 'text', text: e.message }], isError: true };
  }
}
// Crew Board tools (docs/CREW.md): only the main Opia gets them, and only while the Crew Board is on
// (agent.js sets OPIA_CREW_URL then). Same names and arguments as Amir's crew tools.
const CREW_URL = process.env.OPIA_CREW_URL;
const CREW_TOOLS = [
  {
    name: 'crew_read',
    description: 'Read the Crew Board: the shared message board of the user\'s AI agent apps on this PC (Opia, Amir, ...). ' +
      'Returns the transcript for the current crew prompt (or the given prompt id).',
    inputSchema: { type: 'object', properties: { promptId: { type: 'string', description: 'A prompt id (default: the current crew prompt).' } } },
  },
  {
    name: 'crew_post',
    description: 'Post a message on the Crew Board for the current crew prompt: a plan (which part you take), a note (a key finding), ' +
      'a question to another agent, or a result (your outcome; to "user" for the final combined answer).',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The message, short and concrete.' },
        to: { type: 'string', description: 'Who it is for: "all" (default), "user", or an agent id like "amir".' },
        kind: { type: 'string', enum: ['plan', 'note', 'question', 'result'], description: 'Message kind (default "note").' },
      },
      required: ['text'],
    },
  },
  {
    name: 'crew_wait',
    description: 'Wait for new Crew Board messages from the other agents on the current crew prompt (returns as soon as any arrive). ' +
      'Use it to see the others\' plans, answers and results.',
    inputSchema: { type: 'object', properties: { seconds: { type: 'number', description: 'How long to wait at most, 1-300 (default 30).' } } },
  },
  {
    name: 'crew_agents',
    description: 'Who is on the Crew Board: each agent app, whether it is online, what it is doing, and its strengths.',
    inputSchema: { type: 'object', properties: {} },
  },
];
function crewTools() { return CREW_URL ? CREW_TOOLS : []; }
async function crewCall(name, args) {
  try {
    const r = await postJson(CREW_URL, { action: name.replace(/^crew_/, ''), args: args || {} });
    if (!r || r.error) return { content: [{ type: 'text', text: (r && r.error) || 'The crew tool failed.' }], isError: true };
    return { content: [{ type: 'text', text: String(r.text || '') }] };
  } catch (e) {
    return { content: [{ type: 'text', text: e.message }], isError: true };
  }
}

const TOKEN = process.env.OPIA_PERM_TOKEN || '';
const http = require('http');

const TOOL = {
  name: 'approve',
  description: 'Ask the Opia desktop pet user whether a tool call may run.',
  inputSchema: {
    type: 'object',
    properties: {
      tool_name: { type: 'string', description: 'Name of the tool asking for permission' },
      input: { type: 'object', description: 'Input the tool will run with' },
      tool_use_id: { type: 'string' },
    },
    required: ['tool_name', 'input'],
  },
};

const SCREEN_TOOL = {
  name: 'see_screen',
  description: 'Take a screenshot of the user\'s screen (the display under their mouse cursor) and look at it. ' +
    'Use this whenever the user refers to what is on their screen ("this", "this page", "this question", "what I\'m looking at"), ' +
    'or when seeing their screen would help. It is a still image; call it again for a fresh view. Opia\'s own windows are hidden from it.',
  inputSchema: {
    type: 'object',
    properties: {
      display: { type: 'string', enum: ['cursor', 'primary'], description: 'Which display: the one under the cursor (default) or the primary one.' },
    },
  },
};

function postJson(urlStr, payload) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(urlStr); } catch { return reject(new Error('Opia bridge is not configured.')); }
    const body = JSON.stringify(payload || {});
    const req = http.request({
      hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), 'x-opia-token': TOKEN },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new Error('Opia returned an unreadable answer.')); }
      });
    });
    req.on('error', (e) => reject(new Error('Opia is not reachable: ' + e.message)));
    req.end(body);
  });
}

async function seeScreen(args) {
  if (!SCREEN_URL) return { content: [{ type: 'text', text: 'Screen access is not set up in this Opia.' }], isError: true };
  try {
    const r = await postJson(SCREEN_URL, args || {});
    if (!r || r.error || !r.data) return { content: [{ type: 'text', text: (r && r.error) || 'Could not capture the screen.' }], isError: true };
    const info = `Screenshot of the user's screen (${r.width}x${r.height}${r.displays > 1 ? `, display ${r.displayIndex + 1} of ${r.displays}` : ''}).` +
      (r.cursor ? ` Their mouse cursor is at about (${r.cursor.x}, ${r.cursor.y}) in this image.` : '') +
      (r.note ? ' ' + r.note : '');
    return { content: [{ type: 'image', data: r.data, mimeType: r.mimeType || 'image/jpeg' }, { type: 'text', text: info }] };
  } catch (e) {
    return { content: [{ type: 'text', text: e.message }], isError: true };
  }
}

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

function log(...a) {
  process.stderr.write('[opia-perm] ' + a.join(' ') + '\n');
}

function ask(args) {
  return new Promise((resolve) => {
    const deny = (message) => resolve({ behavior: 'deny', message });
    if (!URL_) return deny('Opia permission bridge is not configured.');
    let u;
    try { u = new URL(URL_); } catch { return deny('Bad OPIA_PERM_URL.'); }
    const body = JSON.stringify({
      tool_name: args.tool_name,
      input: args.input || {},
      tool_use_id: args.tool_use_id || null,
    });
    const req = http.request({
      hostname: u.hostname,
      port: u.port,
      path: u.pathname,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
        'x-opia-token': TOKEN,
      },
    }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try {
          const d = JSON.parse(data);
          if (d && d.behavior === 'allow') {
            resolve({ behavior: 'allow', updatedInput: d.updatedInput || args.input || {} });
          } else {
            deny((d && d.message) || 'The user denied this action.');
          }
        } catch {
          deny('Opia returned an unreadable permission answer.');
        }
      });
    });
    req.on('error', (e) => { log('request failed:', e.message); deny('Opia is not reachable to approve this.'); });
    req.end(body);
  });
}

async function handle(msg) {
  const { id, method, params } = msg;
  const isRequest = id !== undefined && id !== null;
  switch (method) {
    case 'initialize':
      return isRequest && send({
        jsonrpc: '2.0', id,
        result: {
          protocolVersion: (params && params.protocolVersion) || '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'opia', version: '5.5.0' },
        },
      });
    case 'ping':
      return isRequest && send({ jsonrpc: '2.0', id, result: {} });
    case 'tools/list':
      return send({ jsonrpc: '2.0', id, result: { tools: [TOOL, SCREEN_TOOL, ...teamTools(), ...crewTools()] } });
    case 'tools/call': {
      const name = params && params.name;
      if (teamTools().some((t) => t.name === name)) {
        return send({ jsonrpc: '2.0', id, result: await teamCall(name, (params && params.arguments) || {}) });
      }
      if (crewTools().some((t) => t.name === name)) {
        return send({ jsonrpc: '2.0', id, result: await crewCall(name, (params && params.arguments) || {}) });
      }
      if (name === 'see_screen') {
        return send({ jsonrpc: '2.0', id, result: await seeScreen((params && params.arguments) || {}) });
      }
      if (name !== 'approve') {
        return send({ jsonrpc: '2.0', id, error: { code: -32602, message: `Unknown tool: ${name}` } });
      }
      const decision = await ask((params && params.arguments) || {});
      return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(decision) }] } });
    }
    default:
      if (isRequest) send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
  }
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch {
      send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
      continue;
    }
    handle(msg).catch((e) => {
      log('handler error:', e && e.message);
      if (msg.id !== undefined) send({ jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: String(e && e.message) } });
    });
  }
});
process.stdin.on('end', () => process.exit(0));
