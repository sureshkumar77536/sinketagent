# 🚀 Sinket Code

**Self-hosted AI coding agent with full terminal access, file browser, and web UI.**

Sinket Code is a powerful AI-powered tool that runs on your VPS. It connects to any OpenAI-compatible API and gives the AI full terminal access to your server — install packages, run scripts, browse the web, create files, and more.

![Sinket Code](https://img.shields.io/badge/Sinket_Code-v1.0-purple)
![Node.js](https://img.shields.io/badge/Node.js-18%2B-green)
![License](https://img.shields.io/badge/License-MIT-blue)

---

## ✨ Features

- **🤖 AI Agent with Terminal Access** — AI can execute commands, install packages, write code, and manage files
- **💬 Beautiful Chat UI** — Dark theme, streaming responses, inline command execution display
- **🖥️ Web Terminal** — Full terminal access from your browser (xterm.js)
- **📁 File Browser** — Browse, view, and manage files on your VPS
- **🖼️ Image Upload** — Send images to multimodal AI models
- **🔧 Multi-Provider** — Add multiple OpenAI-compatible API providers and switch between them
- **📡 Streaming SSE** — Real-time streaming responses with typewriter effect
- **🌐 Cloudflare Tunnel** — Free public URL via Cloudflare (no domain needed)
- **♾️ Keep Alive** — Auto-restart if server or tunnel crashes, prevents sleep
- **⚡ Fast** — Lightweight Node.js backend, instant command execution

---

## 🚀 Quick Install

### One-Line Install

```bash
git clone https://github.com/sureshkumar77536/sinket-code.git && cd sinket-code && bash setup.sh
```

### Step by Step

```bash
# 1. Clone the repo
git clone https://github.com/sureshkumar77536/sinket-code.git

# 2. Go to directory
cd sinket-code

# 3. Run setup
bash setup.sh
```

The setup wizard will ask you:
1. **API Base URL** — Your OpenAI-compatible API endpoint (e.g., `https://api.openai.com/v1`)
2. **Model Name** — Model to use (e.g., `gpt-4`, `deepseek-chat`, `claude-3`)
3. **API Token** — Your API key
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
- Cloudflare tunnel (gives you a public URL)
- Keep-alive monitor (auto-restarts on crash)

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
Click the **☰ Settings** button in the top-left to:
- Add/remove API providers
- Switch between providers
- Change model, base URL, token
- Enable/disable streaming

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
      "name": "DeepSeek",
      "baseUrl": "https://api.deepseek.com/v1",
      "model": "deepseek-chat",
      "token": "sk-...",
      "streaming": true
    }
  ],
  "activeProvider": 0,
  "terminalAccess": true,
  "port": 3000
}
```

---

## 🏗️ Architecture

```
sinket-code/
├── server.js          # Express backend (API proxy, terminal, file browser)
├── public/
│   └── index.html     # Frontend (chat, terminal, files, settings)
├── setup.sh           # Interactive setup wizard
├── start.sh           # Start server + tunnel (auto-generated)
├── stop.sh            # Stop server + tunnel (auto-generated)
├── config.json        # Configuration (auto-generated)
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
| `write_file` | Create/write files |
| `browse_url` | Fetch web pages |
| `list_files` | List directory contents |

---

## 🔧 Supported API Providers

Any OpenAI-compatible API works:
- **OpenAI** (`https://api.openai.com/v1`)
- **DeepSeek** (`https://api.deepseek.com/v1`)
- **Together AI** (`https://api.together.xyz/v1`)
- **Groq** (`https://api.groq.com/openai/v1`)
- **OpenRouter** (`https://openrouter.ai/api/v1`)
- **Local models** (Ollama, LM Studio, vLLM, etc.)
- Any other OpenAI-compatible endpoint

---

## 🔄 Update

```bash
cd sinket-code
./stop.sh
git pull
npm install
./start.sh
```

---

## 📝 License

MIT License — free to use, modify, and distribute.

---

**Made with 💜 by Sinket Code**
