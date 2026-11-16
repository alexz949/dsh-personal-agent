#!/usr/bin/env node
// MCP server (stdio) that gives Claude Code the same Apple and notification tools as the DSH preset.
// It reuses the DSH tool definitions. The confirmation card becomes an MCP elicitation when the
// client supports it, and otherwise nothing is created. With `--confirm=permission` the host's own
// permission prompt for the create tools is the confirmation instead: the Claude desktop app
// advertises elicitation but answers without showing the form. Edits to the tool files are picked
// up without restarting the session.
import { statSync, watch } from 'node:fs';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const SERVER = { name: 'personal-agent', version: '0.21.6' };
const SOURCES = ['../src/apple.js', '../src/notify.js', '../src/arxiv.js', '../src/bib.js', '../src/log.js', '../src/config.js'].map(path => new URL(path, import.meta.url));

/** Load the tool modules; a new version string imports a fresh copy of files that were edited. */
export async function loadTools(questions, version = '') {
  const query = version ? `?v=${encodeURIComponent(version)}` : '';
  const [{ appleTools, todoTool, completeTool, changeTools }, { notifyTool }, { arxivTool }, { bibTool }, { actionLogger, withLog }, { loadSettings }] = await Promise.all(SOURCES.map(url => import(url.href + query)));
  const settings = loadSettings();
  const notify = notifyTool();
  notify.description = 'Show a macOS notification banner with a sound on this Mac, for example when the user asks to be told when work is done. Success means macOS accepted the banner, not that the user saw it.';
  const bib = settings.bibLibrary ? [bibTool({ library: settings.bibLibrary })] : [];
  return withLog([...appleTools({ questions, notesFolder: settings.notesFolder }), todoTool({ list: settings.todoList }), completeTool({ questions, list: settings.todoList }), ...changeTools({ questions }), notify, arxivTool(), ...bib], actionLogger({ path: settings.actionLog }));
}

export function startServer({ input = process.stdin, output = process.stdout, makeTools = loadTools, confirm = 'elicitation', sources = SOURCES, watchSources = true } = {}) {
  const send = message => output.write(`${JSON.stringify(message)}\n`);
  let clientCapabilities = {};
  let initialized = false;
  let nextRequest = 1;
  const pending = new Map();
  const running = new Map();

  /** Ask the client something and wait for its answer. */
  const request = (method, params) => {
    const id = `server-${nextRequest++}`;
    const answer = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    send({ jsonrpc: '2.0', id, method, params });
    return answer;
  };

  // The user already approved this call in the host's permission prompt; options[0] is 创建.
  const approved = { ask: async ({ questions: [question] }) => ({ answers: [{ id: question.id, selected: [question.options[0].label] }] }) };

  // DSH's userQuestions.ask, answered through an MCP elicitation form with the same choices.
  const questions = () => confirm === 'permission' ? approved : clientCapabilities.elicitation === undefined ? undefined : {
    async ask({ questions: [question] }) {
      const labels = question.options.map(option => option.label);
      const result = await request('elicitation/create', {
        message: `${question.question}\n\n${question.detail}`,
        requestedSchema: {
          type: 'object',
          properties: {
            choice: { type: 'string', title: question.header, enum: labels, enumNames: labels, default: labels[0] },
            change: { type: 'string', title: '想修改的地方（可不填）' },
          },
          required: ['choice'],
        },
      });
      if (result?.action !== 'accept') throw Object.assign(new Error('the user closed the confirmation'), { code: 'ASK_CANCELLED' });
      const change = typeof result.content?.change === 'string' ? result.content.change.trim() : '';
      return { answers: [{ id: question.id, selected: change ? [] : [result.content?.choice], ...change ? { custom: change } : {} }] };
    },
  };

  // The loaded tools are tagged with their files' modification times. When those change, the files
  // are imported again and the client is told the tool list changed; a file caught mid-edit that
  // fails to load leaves the previous tools in place.
  let tools = new Map(), loadedVersion, loading = Promise.resolve();
  const versionNow = () => { try { return sources.map(url => statSync(url).mtimeMs).join(','); } catch { return loadedVersion; } };
  async function refresh() {
    const version = versionNow();
    if (version === loadedVersion) return;
    try {
      const list = await makeTools(questions, version);
      const reloaded = loadedVersion !== undefined;
      tools = new Map(list.map(tool => [tool.name, tool]));
      loadedVersion = version;
      if (reloaded && initialized) send({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' });
    } catch (error) {
      process.stderr.write(`tool reload failed: ${error?.message ?? error}\n`);
      if (loadedVersion === undefined) throw error;
    }
  }
  const reload = () => (loading = loading.catch(() => {}).then(refresh));
  reload().catch(() => {});
  if (watchSources) {
    let timer;
    for (const dir of new Set(sources.map(url => new URL('.', url).href))) {
      watch(new URL(dir), () => {
        clearTimeout(timer);
        timer = setTimeout(() => reload().catch(() => {}), 200);
        timer.unref();
      }).unref();
    }
  }

  async function callTool(id, { name, arguments: args = {} }) {
    const tool = tools.get(name);
    if (tool === undefined) return send({ jsonrpc: '2.0', id, error: { code: -32602, message: `unknown tool ${name}` } });
    const controller = new AbortController();
    running.set(id, controller);
    try {
      const value = await tool.execute(args, { agent: undefined, signal: controller.signal });
      send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(value) }] } });
    } catch (error) {
      send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: error?.message ?? String(error) }], isError: true } });
    } finally {
      running.delete(id);
    }
  }

  function handle(message) {
    const { id, method, params } = message;
    if (method === undefined) {
      // A reply to one of our requests.
      const waiter = pending.get(id);
      pending.delete(id);
      if (waiter) message.error ? waiter.reject(new Error(message.error.message)) : waiter.resolve(message.result);
      return;
    }
    switch (method) {
      case 'initialize':
        clientCapabilities = params?.capabilities ?? {};
        return send({ jsonrpc: '2.0', id, result: {
          protocolVersion: PROTOCOLS.includes(params?.protocolVersion) ? params.protocolVersion : PROTOCOLS[0],
          capabilities: { tools: { listChanged: true } },
          serverInfo: SERVER,
        } });
      case 'notifications/initialized':
        initialized = true;
        return;
      case 'ping':
        return send({ jsonrpc: '2.0', id, result: {} });
      case 'tools/list':
        return void reload().then(
          () => send({ jsonrpc: '2.0', id, result: { tools: [...tools.values()].map(tool => ({ name: tool.name, description: tool.description, inputSchema: tool.parameters })) } }),
          error => send({ jsonrpc: '2.0', id, error: { code: -32603, message: `the tool code failed to load: ${error?.message ?? error}` } }),
        );
      case 'tools/call':
        return void reload().catch(() => {}).then(() => callTool(id, params ?? {}));
      case 'notifications/cancelled':
        return void running.get(params?.requestId)?.abort();
      default:
        if (id !== undefined) send({ jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${method}` } });
    }
  }

  return createInterface({ input }).on('line', line => {
    if (line.trim() === '') return;
    let message;
    try { message = JSON.parse(line); } catch { return process.stderr.write('ignored a line that is not JSON\n'); }
    handle(message);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const confirm = process.argv.includes('--confirm=permission') ? 'permission' : 'elicitation';
  startServer({ confirm }).on('close', () => process.exit(0));
}
