#!/bin/bash

# ╔══════════════════════════════════════╗
# ║         Sinket Code Setup            ║
# ╚══════════════════════════════════════╝

set -e

BOLD='\033[1m'
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
PURPLE='\033[0;35m'
NC='\033[0m'

clear
echo -e "${PURPLE}${BOLD}"
echo "  ╔══════════════════════════════════════╗"
echo "  ║                                      ║"
echo "  ║     🚀 Welcome to Sinket Code        ║"
echo "  ║     AI Agent with Terminal Access     ║"
echo "  ║                                      ║"
echo "  ╚══════════════════════════════════════╝"
echo -e "${NC}"
echo ""

# ─── Check Node.js ───
echo -e "${CYAN}[1/6] Checking Node.js...${NC}"
if ! command -v node &> /dev/null; then
    echo -e "${YELLOW}Node.js not found. Installing...${NC}"
    if command -v apt-get &> /dev/null; then
        curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
        sudo apt-get install -y nodejs
    elif command -v yum &> /dev/null; then
        curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
        sudo yum install -y nodejs
    elif command -v dnf &> /dev/null; then
        curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
        sudo dnf install -y nodejs
    else
        echo -e "${RED}Cannot install Node.js automatically. Please install Node.js 18+ manually.${NC}"
        exit 1
    fi
fi
NODE_VERSION=$(node -v)
echo -e "${GREEN}✓ Node.js ${NODE_VERSION}${NC}"

# ─── API Configuration ───
echo ""
echo -e "${CYAN}[2/6] API Configuration${NC}"
echo -e "${BOLD}Configure your OpenAI-compatible API provider:${NC}"
echo ""

read -p "  API Base URL (e.g., https://api.openai.com/v1): " API_URL
read -p "  Model Name (e.g., gpt-4, deepseek-chat, claude-3-opus): " MODEL_NAME
echo -e "  ${YELLOW}(Leave empty if your API proxy doesn't require a key)${NC}"
read -sp "  API Token: " API_TOKEN
echo ""

# Provider name
read -p "  Provider Name (e.g., OpenAI, DeepSeek): " PROVIDER_NAME
PROVIDER_NAME=${PROVIDER_NAME:-"Default"}

# ─── Streaming ───
echo ""
read -p "  Enable Streaming? (yes/no) [yes]: " STREAMING
STREAMING=${STREAMING:-yes}
if [ "$STREAMING" = "yes" ] || [ "$STREAMING" = "y" ]; then
    STREAMING_VAL="true"
    echo -e "${GREEN}✓ Streaming enabled${NC}"
else
    STREAMING_VAL="false"
    echo -e "${YELLOW}✓ Streaming disabled${NC}"
fi

# ─── Terminal Access ───
echo ""
echo -e "${YELLOW}${BOLD}⚠  TERMINAL ACCESS${NC}"
echo -e "  This gives the AI full access to run commands on this server."
echo -e "  The AI can install packages, create files, and execute scripts."
echo ""
read -p "  Grant terminal access to AI? (yes/no) [yes]: " TERMINAL_ACCESS
TERMINAL_ACCESS=${TERMINAL_ACCESS:-yes}
if [ "$TERMINAL_ACCESS" = "no" ] || [ "$TERMINAL_ACCESS" = "n" ]; then
    echo -e "${RED}Terminal access denied. Sinket Code requires terminal access to function.${NC}"
    echo -e "${RED}Exiting setup.${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Terminal access granted${NC}"

# ─── Port ───
echo ""
read -p "  Server Port [3000]: " PORT
PORT=${PORT:-3000}

# ─── Install Dependencies ───
echo ""
echo -e "${CYAN}[3/6] Installing dependencies...${NC}"
cd "$(dirname "$0")"
npm install --production 2>&1 | tail -5
echo -e "${GREEN}✓ Dependencies installed${NC}"

# ─── Install build tools for node-pty ───
echo ""
echo -e "${CYAN}[4/6] Setting up terminal support...${NC}"
if command -v apt-get &> /dev/null; then
    sudo apt-get install -y build-essential python3 2>/dev/null || true
fi
npm rebuild node-pty 2>/dev/null || echo -e "${YELLOW}  node-pty not available, using fallback terminal${NC}"
echo -e "${GREEN}✓ Terminal ready${NC}"

# ─── Write Config ───
echo ""
echo -e "${CYAN}[5/6] Writing configuration...${NC}"
cat > config.json << CONFIGEOF
{
  "providers": [
    {
      "name": "${PROVIDER_NAME}",
      "baseUrl": "${API_URL}",
      "model": "${MODEL_NAME}",
      "token": "${API_TOKEN}",
      "streaming": ${STREAMING_VAL}
    }
  ],
  "activeProvider": 0,
  "streaming": ${STREAMING_VAL},
  "terminalAccess": true,
  "port": ${PORT}
}
CONFIGEOF
echo -e "${GREEN}✓ Config saved${NC}"

# ─── Cloudflare Tunnel ───
echo ""
echo -e "${CYAN}[6/6] Setting up Cloudflare Tunnel...${NC}"
if ! command -v cloudflared &> /dev/null; then
    echo -e "${YELLOW}Installing cloudflared...${NC}"
    if [ "$(uname -m)" = "x86_64" ]; then
        curl -sL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /tmp/cloudflared
    elif [ "$(uname -m)" = "aarch64" ]; then
        curl -sL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64 -o /tmp/cloudflared
    else
        curl -sL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /tmp/cloudflared
    fi
    chmod +x /tmp/cloudflared
    sudo mv /tmp/cloudflared /usr/local/bin/cloudflared
fi
echo -e "${GREEN}✓ Cloudflared ready${NC}"

# ─── Start ───
echo ""
echo -e "${PURPLE}${BOLD}"
echo "  ╔══════════════════════════════════════╗"
echo "  ║      Starting Sinket Code...         ║"
echo "  ╚══════════════════════════════════════╝"
echo -e "${NC}"

# Create data directory
mkdir -p data

# Create start script
cat > start.sh << 'STARTEOF'
#!/bin/bash
cd "$(dirname "$0")"

PORT=$(node -e "try{console.log(require('./config.json').port||3000)}catch{console.log(3000)}")

# Kill any existing instances
pkill -f "node server.js" 2>/dev/null || true
pkill -f "cloudflared tunnel" 2>/dev/null || true
sleep 1

# Auto-sync from GitHub on start
echo "Checking for updates from GitHub..."
git pull origin $(git rev-parse --abbrev-ref HEAD) 2>/dev/null && npm install --production 2>/dev/null

# Start Node server
echo "Starting Sinket Code server on port $PORT..."
nohup node server.js > server.log 2>&1 &
SERVER_PID=$!
echo "Server PID: $SERVER_PID"

# Wait for server to start
sleep 2

# Start Cloudflare tunnel
echo "Starting Cloudflare tunnel..."
nohup cloudflared tunnel --url http://localhost:$PORT > tunnel.log 2>&1 &
TUNNEL_PID=$!
echo "Tunnel PID: $TUNNEL_PID"

# Wait for tunnel URL
sleep 8
TUNNEL_URL=$(grep -oP 'https://[a-zA-Z0-9-]+\.trycloudflare\.com' tunnel.log | head -1)

# Save tunnel URL to database
if [ -n "$TUNNEL_URL" ]; then
    mkdir -p data
    echo "{\"url\":\"$TUNNEL_URL\",\"lastUpdate\":$(date +%s)000}" > data/tunnel.json
fi

echo ""
echo -e "\033[0;35m\033[1m"
echo "  ╔══════════════════════════════════════════════════════╗"
echo "  ║            🚀 Sinket Code is LIVE!                   ║"
echo "  ╠══════════════════════════════════════════════════════╣"
echo "  ║                                                      ║"
echo "  ║  Local:  http://localhost:$PORT                       "
if [ -n "$TUNNEL_URL" ]; then
echo "  ║  Public: $TUNNEL_URL"
fi
echo "  ║                                                      ║"
echo "  ╚══════════════════════════════════════════════════════╝"
echo -e "\033[0m"

# Keep alive - ALWAYS running, never stops
echo "Sinket Code is running PERMANENTLY. Press Ctrl+C to stop."
echo "Server log: server.log | Tunnel log: tunnel.log"

# Trap SIGTERM/SIGINT for clean shutdown
trap "echo 'Shutting down...'; kill $SERVER_PID $TUNNEL_PID 2>/dev/null; exit 0" SIGTERM SIGINT

RESTART_COUNT=0

# Keep-alive loop (runs forever - no inactivity stop)
while true; do
    # Check if server is still running
    if ! kill -0 $SERVER_PID 2>/dev/null; then
        RESTART_COUNT=$((RESTART_COUNT + 1))
        echo "$(date): Server crashed (restart #$RESTART_COUNT). Restarting..."
        nohup node server.js >> server.log 2>&1 &
        SERVER_PID=$!
        sleep 3
    fi
    # Check if tunnel is still running
    if ! kill -0 $TUNNEL_PID 2>/dev/null; then
        echo "$(date): Tunnel crashed. Restarting..."
        nohup cloudflared tunnel --url http://localhost:$PORT > tunnel.log 2>&1 &
        TUNNEL_PID=$!
        sleep 10
        NEW_URL=$(grep -oP 'https://[a-zA-Z0-9-]+\.trycloudflare\.com' tunnel.log | tail -1)
        if [ -n "$NEW_URL" ]; then
            mkdir -p data
            echo "{\"url\":\"$NEW_URL\",\"lastUpdate\":$(date +%s)000}" > data/tunnel.json
            echo "$(date): New tunnel URL: $NEW_URL"
        fi
    fi
    # Ping server to keep it alive and prevent any idle timeout
    curl -s http://localhost:$PORT/api/health > /dev/null 2>&1 || true
    sleep 10
done
STARTEOF
chmod +x start.sh

# Create stop script
cat > stop.sh << 'STOPEOF'
#!/bin/bash
echo "Stopping Sinket Code..."
pkill -f "node server.js" 2>/dev/null
pkill -f "cloudflared tunnel" 2>/dev/null
echo "Stopped."
STOPEOF
chmod +x stop.sh

echo ""
echo -e "${GREEN}${BOLD}Setup complete!${NC}"
echo ""
echo -e "  ${BOLD}To start Sinket Code:${NC}"
echo -e "    ${CYAN}./start.sh${NC}"
echo ""
echo -e "  ${BOLD}To stop:${NC}"
echo -e "    ${CYAN}./stop.sh${NC}"
echo ""

# Auto-start
read -p "  Start Sinket Code now? (yes/no) [yes]: " START_NOW
START_NOW=${START_NOW:-yes}
if [ "$START_NOW" = "yes" ] || [ "$START_NOW" = "y" ]; then
    exec ./start.sh
fi
