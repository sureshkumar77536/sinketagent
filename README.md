# 🚀 Sinket Code

**Self-hosted AI coding agent with full terminal access, file browser, and web UI.**

Sinket Code is a powerful AI-powered tool that runs on your VPS. It connects to any OpenAI-compatible API and gives the AI full terminal access to your server — install packages, run scripts, browse the web, create files, and more.

![Sinket Code](https://img.shields.io/badge/Sinket_Code-v2.0-purple)
![Node.js](https://img.shields.io/badge/Node.js-18%2B-green)
![License](https://img.shields.io/badge/License-MIT-blue)

---

## ✨ Features

- **🤖 AI Agent with Terminal Access** — AI can execute commands, install packages, write code, and manage files
- **💬 Beautiful Chat UI** — Dark theme with 3D glass design, streaming responses, inline command execution display
- **🖥️ Web Terminal** — Full terminal access from your browser (xterm.js) with auto-reconnect
- **📁 Smart Workspace** — Browse and manage only AI-created files, separate from system files
- **🖼️ Image Upload** — Send images to multimodal AI models
- **🔧 Multi-Provider** — Add multiple OpenAI-compatible API providers and switch between them
- **📡 Streaming SSE** — Real-time streaming responses with typewriter effect
- **🌐 Cloudflare Tunnel** — Free public URL via Cloudflare with persistent URL storage
- **♾️ Always Active** — Auto-restart on crash, heartbeat system prevents inactivity shutdown
- **⚡ Fast Terminal** — Lightweight Node.js backend, instant command execution, WebSocket-first transport
- **🔄 GitHub Auto-Sync** — Automatic updates from GitHub on startup and via webhook
- **💾 Database Storage** — Chat history, AI files, tunnel URL, and settings all persisted in JSON database
- **📱 Mobile Optimized** — Hamburger navigation menu with Settings, Terminal, Workspace, and Sync options
- **🔑 Flexible API** — Supports empty API keys for proxy endpoints that don't require authentication

---

## 🚀 Quick Install

### One-Line Install

```bash
git clone https://github.com/sureshkumar77536/sinketagent.git && cd sinketagent && bash setup.sh
```

### Step by Step

```bash
# 1. Clone the repo
git clone https://github.com/sureshkumar77536/sinketagent.git

# 2. Go to directory
cd sinketagent

# 3. Run setup
bash setup.sh
```

The setup wizard will ask you:
1. **API Base URL** — Your OpenAI-compatible API endpoint (e.g., `https://api.openai.com/v1`)
2. **Model Name** — Model to use (e.g., `gpt-4`, `deepseek-chat`, `anthropic/claude-sonnet-4`)
3. **API Token** — Your API key (leave empty if proxy doesn't need one)
4. **Enable Streaming** — Yes/No (recommended: Yes)
5. **Terminal Access** — Grant AI terminal access (required)
6. **Port** — Server port (default: 3000)

---

## 📋 Requirements

- **VPS/Server** with Linux (Ubuntu/Debian/CentOS)
- **Node.js 18+** (auto-installed by setup)
- **OpenAI-compatible API** key (OpenAI, DeepSeek, Anthropic, local models, etc.)

---

## 🎯 Usage

### Start

```bash
./start.sh
```

This starts:
- Node.js server on your configured port
- Cloudflare tunnel (gives you a public URL, saved to database)
- Keep-alive monitor (auto-restarts on crash, pings every 15s)
- Auto-sync from GitHub (pulls latest code on startup)

### Stop

```bash
./stop.sh
```

### View Logs

```bash
# Server logs
tail -f server.log

# Tunnel logs
tail -f tunnel.log
```

---

## ⚙️ Configuration

### Via Web UI
Click the **☰ Menu** button in the top-left to access:
- **Chat** — AI chat interface
- **Terminal** — Full terminal access
- **Workspace** — AI-created files browser
- **API Settings** — Add/remove API providers, change models, tokens
- **Sync & Update** — Pull latest code from GitHub

### Via config.json
```json
{
  "providers": [
    {
      "name": "OpenAI",
      "baseUrl": "https://api.openai.com/v1",
      "model": "gpt-4",
      "token": "sk-...",
      "streaming": true
    },
    {
      "name": "Claude Proxy",
      "baseUrl": "http://185.14.92.127:3001/api/openai/v1",
      "model": "anthropic/claude-sonnet-4",
      "token": "",
      "streaming": true
    }
  ],
  "activeProvider": 0,
  "terminalAccess": true,
  "port": 3000
}
```

### Empty API Key Support
Some API proxies don't require an API key. Simply leave the token field empty in Settings or during setup. Sinket Code will send requests without an Authorization header.

---

## 🏗️ Architecture

```
sinketagent/
├── server.js          # Express backend (API proxy, terminal, file browser, database)
├── public/
│   └── index.html     # Frontend (chat, terminal, files, settings, hamburger menu)
├── setup.sh           # Interactive setup wizard
├── start.sh           # Start server + tunnel (auto-generated)
├── stop.sh            # Stop server + tunnel (auto-generated)
├── config.json        # Configuration (auto-generated)
├── data/              # Persistent database (auto-generated)
│   ├── chats.json     # Chat history storage
│   ├── ai_files.json  # AI-created files tracking
│   ├── tunnel.json    # Cloudflare tunnel URL persistence
│   └── meta.json      # Sync status and metadata
├── workspace/         # AI workspace directory
├── uploads/           # Uploaded images
├── package.json
├── README.md
└── .gitignore
```

### AI Tools
The AI has access to these tools via function calling:
| Tool | Description |
|------|-------------|
| `execute_command` | Run any shell command |
| `read_file` | Read file contents |
| `write_file` | Create/write files (tracked in database) |
| `browse_url` | Fetch web pages |
| `list_files` | List directory contents |

---

## 🔧 Supported API Providers

Any OpenAI-compatible API works:
- **OpenAI** (`https://api.openai.com/v1`)
- **Anthropic (via proxy)** (`http://your-proxy/api/openai/v1` with `anthropic/claude-sonnet-4`)
- **DeepSeek** (`https://api.deepseek.com/v1`)
- **Together AI** (`https://api.together.xyz/v1`)
- **Groq** (`https://api.groq.com/openai/v1`)
- **OpenRouter** (`https://openrouter.ai/api/v1`)
- **Local models** (Ollama, LM Studio, vLLM, etc.)
- Any other OpenAI-compatible endpoint (with or without API key)

---

## 🔄 Auto-Sync & Updates

### GitHub Auto-Sync
- On every `./start.sh`, Sinket Code automatically pulls the latest code from GitHub
- Server restarts itself after successful update
- GitHub webhook endpoint at `/api/webhook/update` for CI/CD integration

### Manual Update
```bash
cd sinketagent
./stop.sh
git pull
npm install
./start.sh
```

Or use the **Sync & Update** option from the hamburger menu in the web UI.

### GitHub Webhook Setup
1. Go to your GitHub repo → Settings → Webhooks
2. Add webhook URL: `https://your-cloudflare-url/api/webhook/update`
3. Content type: `application/json`
4. Events: Just the `push` event

---

## 💾 Database

All data is stored in the `data/` directory as JSON files:
- **chats.json** — Complete chat history, auto-saved after each message
- **ai_files.json** — Tracks all files created by the AI agent
- **tunnel.json** — Stores the Cloudflare tunnel URL for persistence
- **meta.json** — Sync status, heartbeat, and metadata

The database survives restarts and is excluded from git via `.gitignore`.

---

## 📱 Mobile UI

The hamburger menu (☰) provides full navigation:
- **Chat** — Main AI chat
- **Terminal** — Full terminal with touch support
- **Workspace** — Only AI-created files (no system files)
- **API Settings** — Provider configuration
- **Sync & Update** — GitHub sync

All components use the 3D glass UI design for a premium look.

---

## 📝 License

MIT License — free to use, modify, and distribute.

---

**Made with 💜 by Sinket Code**
