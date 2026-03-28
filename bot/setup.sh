#!/bin/bash
# 3SM Discord Bot — eerste keer opzetten op de LXC
# Uitvoeren als root: bash /opt/3sm/bot/setup.sh
set -e

BOT_DIR="/opt/3sm/bot"

echo "→ Controleren of Node.js beschikbaar is..."
node --version || { echo "Node.js niet gevonden, installeer eerst Node.js 20+"; exit 1; }

echo "→ Dependencies installeren..."
cd "$BOT_DIR"
npm install

echo "→ .env aanmaken..."
if [ ! -f "$BOT_DIR/.env" ]; then
  cp "$BOT_DIR/.env.example" "$BOT_DIR/.env"
  echo ""
  echo "  !! Vul nu de waarden in: nano $BOT_DIR/.env"
  echo "  !! Daarna opnieuw uitvoeren of: systemctl start 3sm-bot"
  echo ""
fi

echo "→ Systemd service aanmaken..."
cat > /etc/systemd/system/3sm-bot.service << 'EOF'
[Unit]
Description=3SM Discord Bot
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/3sm/bot
ExecStart=/usr/bin/node index.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable 3sm-bot

if grep -q "your_bot_token_here" "$BOT_DIR/.env"; then
  echo ""
  echo "⚠️  Vul eerst je gegevens in: nano $BOT_DIR/.env"
  echo "   Daarna starten met: systemctl start 3sm-bot"
else
  systemctl start 3sm-bot
  echo "✓ Bot gestart! Status: systemctl status 3sm-bot"
fi
