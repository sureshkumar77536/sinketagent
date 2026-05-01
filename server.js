const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { exec, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const CONFIG_PATH = path.join(__dirname, 'config.json');
const WORKSPACE = path.join(__dirname, 'workspace');
const UPLOADS = path.join(__dirname, 'uploads');
const DATA_DIR = path.join(__dirname, 'data');

if (!fs.existsSync(WORKSPACE)) fs.mkdirSync(WORKSPACE, { recursive: true });
if (!fs.existsSync(UPLOADS)) fs.mkdirSync(UPLOADS, { recursive: true });
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ─── JSON File Database ───
class JsonDB {
  constructor(name) {
    this.path = path.join(DATA_DIR, `${name}.json`);
    this.data = this._load();
  }
  _load() {
    try {
      if (fs.existsSync(this.path)) return JSON.parse(fs.readFileSync(this.path, 'utf-8'));
    } catch {}
    return {};
  }
  _save() {
    fs.writeFileSync(this.path, JSON.stringify(this.data, null, 2));
  }
  get(key, fallback = null) { return this.data[key] !== undefined ? this.data[key] : fallback; }
  set(key, value) { this.data[key] = value; this._save(); }
  getAll() { return this.data; }
  delete(key) { delete this.data[key]; this._save(); }
}

const chatDB = new JsonDB('chats');
const filesDB = new JsonDB('ai_files');
const tunnelDB = new JsonDB('tunnel');
const metaDB = new JsonDB('meta');

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  } catch {}
  return {
    providers: [],
    activeProvider: 0,
    streaming: true,
    terminalAccess: true,
    port: 3000
  };
}

function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

let config = loadConfig();
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  pingTimeout: 120000,
  pingInterval: 15000,
  transports: ['websocket', 'polling']
});

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOADS));

const upload = multer({
  dest: UPLOADS,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only images allowed'));
  }
});

// ─── Config API ───
app.get('/api/config', (req, res) => {
  const c = loadConfig();
  const safe = {
    providers: c.providers.map(p => ({
      name: p.name,
      baseUrl: p.baseUrl,
      model: p.model,
      hasToken: !!p.token,
      streaming: p.streaming !== false
    })),
    activeProvider: c.activeProvider || 0,
    streaming: c.streaming,
    terminalAccess: c.terminalAccess
  };
  res.json(safe);
});

app.post('/api/config', (req, res) => {
  const c = loadConfig();
  if (req.body.providers) c.providers = req.body.providers;
  if (req.body.activeProvider !== undefined) c.activeProvider = req.body.activeProvider;
  if (req.body.streaming !== undefined) c.streaming = req.body.streaming;
  saveConfig(c);
  config = c;
  res.json({ ok: true });
});

// ─── Image Upload ───
app.post('/api/upload', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const ext = path.extname(req.file.originalname) || '.png';
  const newName = req.file.filename + ext;
  const newPath = path.join(UPLOADS, newName);
  fs.renameSync(req.file.path, newPath);
  res.json({ url: `/uploads/${newName}`, filename: req.file.originalname });
});

// ─── File Browser (AI-created files only in workspace mode) ───
app.get('/api/files', (req, res) => {
  const dir = req.query.path || WORKSPACE;
  const onlyAiFiles = req.query.aiOnly === 'true';
  const safePath = path.resolve(dir);
  try {
    const items = fs.readdirSync(safePath, { withFileTypes: true });
    let result = items.map(item => ({
      name: item.name,
      type: item.isDirectory() ? 'directory' : 'file',
      path: path.join(safePath, item.name),
      size: item.isFile() ? fs.statSync(path.join(safePath, item.name)).size : null
    }));

    if (onlyAiFiles && safePath.startsWith(WORKSPACE)) {
      const aiFiles = filesDB.get('created', []);
      result = result.filter(item => {
        if (item.type === 'directory') return true;
        return aiFiles.some(f => item.path === f || item.path.startsWith(f));
      });
    }

    res.json({ path: safePath, items: result });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/files/read', (req, res) => {
  const filePath = req.query.path;
  if (!filePath) return res.status(400).json({ error: 'No path' });
  try {
    const stat = fs.statSync(filePath);
    if (stat.size > 1024 * 1024) return res.status(400).json({ error: 'File too large (>1MB)' });
    const content = fs.readFileSync(filePath, 'utf-8');
    res.json({ path: filePath, content });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ─── Chat History API ───
app.get('/api/chats', (req, res) => {
  const chats = chatDB.get('sessions', []);
  res.json({ chats });
});

app.post('/api/chats/save', (req, res) => {
  const { chatId, messages, title } = req.body;
  const sessions = chatDB.get('sessions', []);
  const idx = sessions.findIndex(s => s.id === chatId);
  const session = {
    id: chatId || Date.now().toString(),
    title: title || 'Chat ' + new Date().toLocaleString(),
    messages: messages || [],
    updatedAt: Date.now()
  };
  if (idx >= 0) sessions[idx] = session;
  else sessions.push(session);
  chatDB.set('sessions', sessions);
  res.json({ ok: true, chatId: session.id });
});

app.delete('/api/chats/:id', (req, res) => {
  const sessions = chatDB.get('sessions', []);
  const filtered = sessions.filter(s => s.id !== req.params.id);
  chatDB.set('sessions', filtered);
  res.json({ ok: true });
});

// ─── Tunnel URL API ───
app.get('/api/tunnel', (req, res) => {
  // Re-read from disk since start.sh writes the file after server starts
  const tunnelPath = path.join(DATA_DIR, 'tunnel.json');
  try {
    if (fs.existsSync(tunnelPath)) {
      const data = JSON.parse(fs.readFileSync(tunnelPath, 'utf-8'));
      res.json({ url: data.url || '', lastUpdate: data.lastUpdate || null });
      return;
    }
  } catch {}
  res.json({ url: '', lastUpdate: null });
});

app.post('/api/tunnel', (req, res) => {
  const { url } = req.body;
  if (url) {
    tunnelDB.set('url', url);
    tunnelDB.set('lastUpdate', Date.now());
  }
  res.json({ ok: true });
});

// ─── AI Files Tracking ───
app.get('/api/ai-files', (req, res) => {
  const files = filesDB.get('created', []);
  res.json({ files });
});

// ─── Execute Command (for AI agent) ───
function execCommand(command, timeout = 30000) {
  return new Promise((resolve) => {
    const proc = exec(command, {
      cwd: WORKSPACE,
      timeout,
      maxBuffer: 1024 * 1024,
      env: { ...process.env, TERM: 'xterm-256color' }
    }, (error, stdout, stderr) => {
      let output = '';
      if (stdout) output += stdout;
      if (stderr) output += (output ? '\n' : '') + stderr;
      if (error && !output) output = error.message;
      resolve(output || '(no output)');
    });
  });
}

// ─── Tool Execution ───
async function executeTool(name, args) {
  switch (name) {
    case 'execute_command': {
      if (!config.terminalAccess) return 'Terminal access is disabled.';
      const output = await execCommand(args.command, 60000);
      return output.substring(0, 8000);
    }
    case 'read_file': {
      try {
        const p = path.resolve(args.path);
        const content = fs.readFileSync(p, 'utf-8');
        return content.substring(0, 8000);
      } catch (e) { return `Error: ${e.message}`; }
    }
    case 'write_file': {
      try {
        const p = path.resolve(args.path);
        const dir = path.dirname(p);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(p, args.content);
        // Track AI-created files
        const aiFiles = filesDB.get('created', []);
        if (!aiFiles.includes(p)) {
          aiFiles.push(p);
          filesDB.set('created', aiFiles);
        }
        return `File written: ${p}`;
      } catch (e) { return `Error: ${e.message}`; }
    }
    case 'browse_url': {
      try {
        const output = await execCommand(`curl -sL "${args.url}" | head -c 6000`, 15000);
        return output;
      } catch (e) { return `Error: ${e.message}`; }
    }
    case 'list_files': {
      try {
        const dir = args.path || WORKSPACE;
        const output = await execCommand(`ls -la "${dir}"`, 5000);
        return output;
      } catch (e) { return `Error: ${e.message}`; }
    }
    default:
      return `Unknown tool: ${name}`;
  }
}

// ─── AI Tools Definition ───
const AI_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'execute_command',
      description: 'Execute a shell command on the server. Use for installing packages, running scripts, system info, etc.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell command to execute' }
        },
        required: ['command']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read contents of a file from disk',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute or relative file path' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Create or overwrite a file on disk',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path to write' },
          content: { type: 'string', description: 'File content' }
        },
        required: ['path', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'browse_url',
      description: 'Fetch and read content from a URL',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to fetch' }
        },
        required: ['url']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: 'List files and directories',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory path (default: workspace)' }
        }
      }
    }
  }
];

const SYSTEM_PROMPT = `You are Sinket Code, an AI coding assistant integrated into a server environment with full shell access.

You have direct access to the server's terminal. You execute commands by outputting tool calls in a special format.

To execute a tool, output this exact XML format in your response:

<tool_call>
{"name": "TOOL_NAME", "arguments": {"key": "value"}}
</tool_call>

Available tools:
1. execute_command - Run any shell command. Args: {"command": "shell command here"}
2. read_file - Read a file. Args: {"path": "file path"}
3. write_file - Write/create a file. Args: {"path": "file path", "content": "file content"}
4. browse_url - Fetch a webpage. Args: {"url": "https://..."}
5. list_files - List directory contents. Args: {"path": "directory path"}

CRITICAL RULES:
- When asked to run a command, ALWAYS output a <tool_call> block. The system will execute it and return the result.
- NEVER say "I cannot execute commands" or "I don't have access" — you DO have access through <tool_call>.
- You can explain what you're doing alongside the tool call.
- The workspace directory is: ${WORKSPACE}`;

const FEW_SHOT_EXAMPLES = [
  { role: 'user', content: 'Show me what files are in the current directory' },
  { role: 'assistant', content: 'I\'ll list the files in the current directory for you.\n\n<tool_call>\n{"name": "execute_command", "arguments": {"command": "ls -la"}}\n</tool_call>' },
  { role: 'user', content: '[Tool Result for execute_command]:\ntotal 48\ndrwxr-xr-x 4 root root 4096 May 1 10:00 .\ndrwxr-xr-x 3 root root 4096 May 1 09:55 ..\n-rw-r--r-- 1 root root  220 May 1 09:55 .bashrc\n-rw-r--r-- 1 root root 1200 May 1 10:00 server.js\ndrwxr-xr-x 2 root root 4096 May 1 10:00 public' },
  { role: 'assistant', content: 'Here are the files in the current directory:\n\n- `.bashrc` — Shell configuration file\n- `server.js` — Main server file (1.2 KB)\n- `public/` — Public directory\n\nThe directory contains a Node.js project setup. Would you like me to look at any of these files?' }
];

function parseTextToolCalls(text) {
  const calls = [];
  const regex = /<tool_call>\s*(\{[\s\S]*?\})\s*<\/tool_call>/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);
      calls.push({
        name: parsed.name,
        arguments: parsed.arguments || parsed.args || {},
        rawMatch: match[0]
      });
    } catch {}
  }
  return calls;
}

// ─── Chat API with Agent Loop (SSE) ───
app.post('/api/chat', async (req, res) => {
  const { messages, imageUrl } = req.body;
  const cfg = loadConfig();
  const provider = cfg.providers[cfg.activeProvider || 0];

  if (!provider || !provider.baseUrl) {
    res.status(400).json({ error: 'No API provider configured. Go to Settings.' });
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  const sendEvent = (type, data) => {
    res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const allMessages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...FEW_SHOT_EXAMPLES,
    ...messages.map(m => ({ ...m }))
  ];

  if (imageUrl) {
    const lastMsg = allMessages[allMessages.length - 1];
    if (lastMsg.role === 'user') {
      lastMsg.content = [
        { type: 'text', text: typeof lastMsg.content === 'string' ? lastMsg.content : '' },
        { type: 'image_url', image_url: { url: imageUrl } }
      ];
    }
  }

  let loopCount = 0;
  const MAX_LOOPS = 15;
  let toolsFallbackMode = false;

  try {
    while (loopCount < MAX_LOOPS) {
      loopCount++;
      sendEvent('status', { type: 'thinking' });

      const apiBody = {
        model: provider.model,
        messages: allMessages,
        temperature: 0.7,
        max_tokens: 4096,
        stream: provider.streaming !== false
      };

      if (config.terminalAccess !== false && loopCount === 1 && !toolsFallbackMode) {
        apiBody.tools = AI_TOOLS;
        apiBody.tool_choice = 'auto';
      }

      const baseUrl = provider.baseUrl.replace(/\/+$/, '');
      const url = `${baseUrl}/chat/completions`;

      const headers = { 'Content-Type': 'application/json' };
      // Support empty API keys - only add Authorization if token exists
      if (provider.token && provider.token.trim()) {
        headers['Authorization'] = `Bearer ${provider.token}`;
      }

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(apiBody)
      });

      if (!response.ok) {
        const errText = await response.text();
        let msg = errText;
        try { msg = JSON.parse(errText).error?.message || msg; } catch {}

        // If tools caused the error, retry without tools
        if (loopCount === 1 && !toolsFallbackMode && apiBody.tools) {
          toolsFallbackMode = true;
          allMessages.length = 0;
          allMessages.push({ role: 'system', content: SYSTEM_PROMPT }, ...FEW_SHOT_EXAMPLES, ...messages.map(m => ({ ...m })));
          if (imageUrl) {
            const lastMsg = allMessages[allMessages.length - 1];
            if (lastMsg.role === 'user') {
              const textContent = typeof lastMsg.content === 'string' ? lastMsg.content : (Array.isArray(lastMsg.content) ? (lastMsg.content.find(c => c.type === 'text')?.text || '') : '');
              lastMsg.content = [
                { type: 'text', text: textContent },
                { type: 'image_url', image_url: { url: imageUrl } }
              ];
            }
          }
          loopCount = 0;
          continue;
        }

        sendEvent('error', { message: `API Error (${response.status}): ${msg}` });
        break;
      }

      if (provider.streaming !== false) {
        // ─── Streaming Response ───
        let textContent = '';
        const toolCalls = {};
        let finishReason = '';

        const reader = response.body;
        const decoder = new TextDecoder();
        let buffer = '';

        for await (const chunk of reader) {
          buffer += decoder.decode(chunk, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.startsWith('data:')) continue;
            const raw = line.slice(5).trim();
            if (!raw || raw === '[DONE]') continue;

            try {
              const json = JSON.parse(raw);
              const choice = json.choices?.[0];
              if (!choice) continue;

              if (choice.delta?.content) {
                textContent += choice.delta.content;
                sendEvent('content', { text: choice.delta.content });
              }

              if (choice.delta?.tool_calls) {
                for (const tc of choice.delta.tool_calls) {
                  const idx = tc.index;
                  if (!toolCalls[idx]) {
                    toolCalls[idx] = { id: '', name: '', arguments: '' };
                  }
                  if (tc.id) toolCalls[idx].id = tc.id;
                  if (tc.function?.name) toolCalls[idx].name = tc.function.name;
                  if (tc.function?.arguments) toolCalls[idx].arguments += tc.function.arguments;
                }
              }

              if (choice.finish_reason) {
                finishReason = choice.finish_reason;
              }
            } catch {}
          }
        }

        const toolCallArr = Object.values(toolCalls).filter(tc => tc.name);

        if (toolCallArr.length > 0) {
          const assistantMsg = {
            role: 'assistant',
            content: textContent || null,
            tool_calls: toolCallArr.map(tc => ({
              id: tc.id,
              type: 'function',
              function: { name: tc.name, arguments: tc.arguments }
            }))
          };
          allMessages.push(assistantMsg);

          for (const tc of toolCallArr) {
            let args = {};
            try { args = JSON.parse(tc.arguments); } catch {}
            sendEvent('tool_start', { name: tc.name, args });
            const result = await executeTool(tc.name, args);
            sendEvent('tool_result', { name: tc.name, output: result });
            allMessages.push({ role: 'tool', tool_call_id: tc.id, content: result });
          }
          continue;
        }

        // ─── Fallback: parse text-based tool calls ───
        if (textContent) {
          const textCalls = parseTextToolCalls(textContent);
          if (textCalls.length > 0) {
            const cleanText = textContent.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '').trim();
            allMessages.push({ role: 'assistant', content: cleanText || null });
            for (const tc of textCalls) {
              sendEvent('tool_start', { name: tc.name, args: tc.arguments });
              const result = await executeTool(tc.name, tc.arguments);
              sendEvent('tool_result', { name: tc.name, output: result });
              allMessages.push({ role: 'user', content: `[Tool Result for ${tc.name}]:\n${result}` });
            }
            continue;
          }

          if (loopCount === 1 && !toolsFallbackMode && apiBody.tools) {
            toolsFallbackMode = true;
            allMessages.length = 0;
            allMessages.push({ role: 'system', content: SYSTEM_PROMPT }, ...FEW_SHOT_EXAMPLES, ...messages.map(m => ({ ...m })));
            if (imageUrl) {
              const lastMsg = allMessages[allMessages.length - 1];
              if (lastMsg.role === 'user') {
                const txt = typeof lastMsg.content === 'string' ? lastMsg.content : (Array.isArray(lastMsg.content) ? (lastMsg.content.find(c => c.type === 'text')?.text || '') : '');
                lastMsg.content = [
                  { type: 'text', text: txt },
                  { type: 'image_url', image_url: { url: imageUrl } }
                ];
              }
            }
            loopCount = 0;
            continue;
          }

          allMessages.push({ role: 'assistant', content: textContent });
        }
        break;

      } else {
        // ─── Non-Streaming Response ───
        const json = await response.json();
        const choice = json.choices?.[0];

        if (choice?.message?.tool_calls && choice.message.tool_calls.length > 0) {
          allMessages.push(choice.message);
          for (const tc of choice.message.tool_calls) {
            let args = {};
            try { args = JSON.parse(tc.function.arguments); } catch {}
            sendEvent('tool_start', { name: tc.function.name, args });
            const result = await executeTool(tc.function.name, args);
            sendEvent('tool_result', { name: tc.function.name, output: result });
            allMessages.push({ role: 'tool', tool_call_id: tc.id, content: result });
          }
          continue;
        }

        if (choice?.message?.content) {
          const msgText = choice.message.content;
          sendEvent('content', { text: msgText });

          const textCalls = parseTextToolCalls(msgText);
          if (textCalls.length > 0) {
            const cleanText = msgText.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '').trim();
            allMessages.push({ role: 'assistant', content: cleanText || null });
            for (const tc of textCalls) {
              sendEvent('tool_start', { name: tc.name, args: tc.arguments });
              const result = await executeTool(tc.name, tc.arguments);
              sendEvent('tool_result', { name: tc.name, output: result });
              allMessages.push({ role: 'user', content: `[Tool Result for ${tc.name}]:\n${result}` });
            }
            continue;
          }
          allMessages.push({ role: 'assistant', content: msgText });
        }
        break;
      }
    }
  } catch (err) {
    sendEvent('error', { message: err.message || 'Unknown error' });
  }

  sendEvent('done', {});
  res.end();
});

// ─── Terminal WebSocket ───
let pty;
try {
  pty = require('node-pty');
} catch {
  pty = null;
}

io.on('connection', (socket) => {
  // Heartbeat - keep connection alive
  const heartbeat = setInterval(() => {
    socket.emit('heartbeat', { ts: Date.now() });
  }, 10000);

  socket.on('heartbeat_ack', () => {});

  if (!config.terminalAccess) {
    socket.emit('output', 'Terminal access is disabled.\r\n');
    socket.on('disconnect', () => clearInterval(heartbeat));
    return;
  }

  if (pty) {
    const shell = pty.spawn('bash', [], {
      name: 'xterm-256color',
      cols: 120,
      rows: 40,
      cwd: WORKSPACE,
      env: { ...process.env, TERM: 'xterm-256color' }
    });

    shell.onData((data) => socket.emit('output', data));
    shell.onExit(() => socket.emit('output', '\r\n[Process exited]\r\n'));

    socket.on('input', (data) => shell.write(data));
    socket.on('resize', ({ cols, rows }) => shell.resize(cols, rows));
    socket.on('disconnect', () => {
      clearInterval(heartbeat);
      shell.kill();
    });
  } else {
    socket.emit('output', 'Welcome to Sinket Code Terminal\r\n$ ');
    let cwd = WORKSPACE;

    socket.on('input', (data) => {
      if (!socket._inputBuffer) socket._inputBuffer = '';

      if (data === '\r' || data === '\n') {
        const cmd = socket._inputBuffer.trim();
        socket._inputBuffer = '';
        socket.emit('output', '\r\n');

        if (!cmd) {
          socket.emit('output', '$ ');
          return;
        }

        if (cmd.startsWith('cd ')) {
          const target = cmd.slice(3).trim();
          const newDir = path.resolve(cwd, target);
          if (fs.existsSync(newDir) && fs.statSync(newDir).isDirectory()) {
            cwd = newDir;
            socket.emit('output', `$ `);
          } else {
            socket.emit('output', `cd: ${target}: No such directory\r\n$ `);
          }
          return;
        }

        const proc = exec(cmd, {
          cwd,
          timeout: 30000,
          maxBuffer: 512 * 1024,
          env: { ...process.env, TERM: 'xterm-256color' }
        }, (error, stdout, stderr) => {
          let output = '';
          if (stdout) output += stdout.replace(/\n/g, '\r\n');
          if (stderr) output += stderr.replace(/\n/g, '\r\n');
          if (error && !stdout && !stderr) output = error.message.replace(/\n/g, '\r\n');
          socket.emit('output', output + '\r\n$ ');
        });
      } else if (data === '\x7f' || data === '\b') {
        if (socket._inputBuffer.length > 0) {
          socket._inputBuffer = socket._inputBuffer.slice(0, -1);
          socket.emit('output', '\b \b');
        }
      } else if (data === '\x03') {
        socket._inputBuffer = '';
        socket.emit('output', '^C\r\n$ ');
      } else {
        socket._inputBuffer += data;
        socket.emit('output', data);
      }
    });

    socket.on('disconnect', () => clearInterval(heartbeat));
  }
});

// ─── GitHub Webhook Auto-Update ───
app.post('/api/webhook/update', (req, res) => {
  res.json({ status: 'updating' });
  const appDir = __dirname;
  exec(`cd "${appDir}" && git pull origin $(git rev-parse --abbrev-ref HEAD) && npm install --production`, {
    timeout: 60000
  }, (error, stdout, stderr) => {
    if (error) {
      console.error('Auto-update failed:', error.message);
      metaDB.set('lastSyncError', error.message);
      metaDB.set('lastSyncAt', Date.now());
      return;
    }
    console.log('Auto-update done:', stdout);
    metaDB.set('lastSyncAt', Date.now());
    metaDB.set('lastSyncStatus', 'success');
    metaDB.set('lastSyncOutput', stdout);
    console.log('Restarting server...');
    process.exit(0);
  });
});

// ─── Manual Update / Sync Check ───
app.get('/api/update', (req, res) => {
  const appDir = __dirname;
  exec(`cd "${appDir}" && git pull origin $(git rev-parse --abbrev-ref HEAD) && npm install --production`, {
    timeout: 60000
  }, (error, stdout, stderr) => {
    if (error) {
      metaDB.set('lastSyncError', error.message);
      metaDB.set('lastSyncAt', Date.now());
      res.json({ status: 'error', message: error.message });
      return;
    }
    metaDB.set('lastSyncAt', Date.now());
    metaDB.set('lastSyncStatus', 'success');
    res.json({ status: 'updated', output: stdout });
    setTimeout(() => process.exit(0), 1000);
  });
});

// ─── Sync Status ───
app.get('/api/sync-status', (req, res) => {
  res.json({
    lastSyncAt: metaDB.get('lastSyncAt', null),
    lastSyncStatus: metaDB.get('lastSyncStatus', null),
    lastSyncError: metaDB.get('lastSyncError', null),
    tunnelUrl: tunnelDB.get('url', '')
  });
});

// ─── Health / Keep Alive ───
app.get('/api/health', (req, res) => {
  res.json({ status: 'alive', uptime: process.uptime(), timestamp: Date.now() });
});

// ─── Keep Alive - prevent process from sleeping ───
setInterval(() => {
  // Active heartbeat to keep Node.js event loop alive
  metaDB.set('lastHeartbeat', Date.now());
}, 30000);

// ─── Startup: Auto-sync from GitHub ───
(function startupSync() {
  const appDir = __dirname;
  exec(`cd "${appDir}" && git remote get-url origin 2>/dev/null`, { timeout: 5000 }, (err, stdout) => {
    if (!err && stdout.trim()) {
      console.log('Startup: Checking for updates from GitHub...');
      exec(`cd "${appDir}" && git pull origin $(git rev-parse --abbrev-ref HEAD) 2>&1`, { timeout: 30000 }, (error, pullOut) => {
        if (!error) {
          console.log('Startup sync:', pullOut.trim());
          metaDB.set('lastSyncAt', Date.now());
          metaDB.set('lastSyncStatus', 'success');
        }
      });
    }
  });
})();

// ─── Start Server ───
const PORT = config.port || process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  ╔══════════════════════════════════════╗`);
  console.log(`  ║        🚀 Sinket Code Running        ║`);
  console.log(`  ║  http://localhost:${PORT}               ║`);
  console.log(`  ╚══════════════════════════════════════╝\n`);
});
