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

if (!fs.existsSync(WORKSPACE)) fs.mkdirSync(WORKSPACE, { recursive: true });
if (!fs.existsSync(UPLOADS)) fs.mkdirSync(UPLOADS, { recursive: true });

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  } catch (e) {}
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
const io = new Server(server, { cors: { origin: '*' } });

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

// ─── File Browser ───
app.get('/api/files', (req, res) => {
  const dir = req.query.path || WORKSPACE;
  const safePath = path.resolve(dir);
  try {
    const items = fs.readdirSync(safePath, { withFileTypes: true });
    const result = items.map(item => ({
      name: item.name,
      type: item.isDirectory() ? 'directory' : 'file',
      path: path.join(safePath, item.name),
      size: item.isFile() ? fs.statSync(path.join(safePath, item.name)).size : null
    }));
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

const SYSTEM_PROMPT = `You are Sinket Code — a powerful AI coding assistant with FULL terminal/shell access on this server.

You can:
1. Execute ANY shell command (install packages, run scripts, manage files, etc.)
2. Read and write files on the server
3. Browse URLs and fetch web content
4. Create, compile, and run code

IMPORTANT RULES:
- You HAVE terminal access. Use your tools to execute commands when needed.
- When the user asks to install something, run a command, or do any system task — DO IT using execute_command.
- Show your work: explain what you're doing and why.
- Be proactive: if a task requires multiple steps, execute them one by one.
- For coding tasks: write the code, save it to a file, and optionally run it.
- Keep responses focused and technical.
- When showing code, use markdown code blocks.
- The workspace directory is: ${WORKSPACE}`;

// ─── Chat API with Agent Loop (SSE) ───
app.post('/api/chat', async (req, res) => {
  const { messages, imageUrl } = req.body;
  const cfg = loadConfig();
  const provider = cfg.providers[cfg.activeProvider || 0];

  if (!provider || !provider.token) {
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
    ...messages
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

  try {
    while (loopCount < MAX_LOOPS) {
      loopCount++;
      sendEvent('status', { type: 'thinking' });

      const useTools = config.terminalAccess !== false;
      const apiBody = {
        model: provider.model,
        messages: allMessages,
        temperature: 0.7,
        max_tokens: 4096,
        stream: provider.streaming !== false
      };

      if (useTools) {
        apiBody.tools = AI_TOOLS;
        apiBody.tool_choice = 'auto';
      }

      const baseUrl = provider.baseUrl.replace(/\/+$/, '');
      const url = `${baseUrl}/chat/completions`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${provider.token}`
        },
        body: JSON.stringify(apiBody)
      });

      if (!response.ok) {
        const errText = await response.text();
        let msg = errText;
        try { msg = JSON.parse(errText).error?.message || msg; } catch {}
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

        if (textContent) {
          allMessages.push({ role: 'assistant', content: textContent });
        }
        break;

      } else {
        // ─── Non-Streaming Response ───
        const json = await response.json();
        const choice = json.choices?.[0];

        if (choice?.message?.tool_calls) {
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
          sendEvent('content', { text: choice.message.content });
          allMessages.push({ role: 'assistant', content: choice.message.content });
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
  if (!config.terminalAccess) {
    socket.emit('output', 'Terminal access is disabled.\r\n');
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
    socket.on('disconnect', () => shell.kill());
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
  }
});

// ─── Keep Alive ───
setInterval(() => {}, 30000);

// ─── Start Server ───
const PORT = config.port || process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  ╔══════════════════════════════════════╗`);
  console.log(`  ║        🚀 Sinket Code Running        ║`);
  console.log(`  ║  http://localhost:${PORT}               ║`);
  console.log(`  ╚══════════════════════════════════════╝\n`);
});
