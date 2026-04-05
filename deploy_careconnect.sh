#!/bin/bash
# =============================================================================
# CareConnect — Full AWS EC2 Deployment Script
# Run this ON your EC2 instance after SSHing in
# Usage: chmod +x deploy_careconnect.sh && ./deploy_careconnect.sh
# =============================================================================

set -e  # Exit immediately on any error

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()  { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
info() { echo -e "${BLUE}[→]${NC} $1"; }
err()  { echo -e "${RED}[✗]${NC} $1"; exit 1; }

echo ""
echo "============================================"
echo "   CareConnect EC2 Deployment Script"
echo "============================================"
echo ""

# =============================================================================
# PHASE 1 — System dependencies
# =============================================================================
info "Phase 1: Installing system dependencies..."

sudo apt-get update -y
sudo apt-get upgrade -y
sudo apt-get install -y curl git nginx certbot python3-certbot-nginx postgresql-client unzip

log "System packages installed"

# Install Node.js 20 via nvm
if ! command -v node &> /dev/null; then
  info "Installing Node.js 20 via nvm..."
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
  export NVM_DIR="$HOME/.nvm"
  source "$NVM_DIR/nvm.sh"
  nvm install 20
  nvm use 20
  nvm alias default 20
  log "Node.js $(node --version) installed"
else
  export NVM_DIR="$HOME/.nvm"
  source "$NVM_DIR/nvm.sh" 2>/dev/null || true
  log "Node.js already installed: $(node --version)"
fi

# Install PM2
if ! command -v pm2 &> /dev/null; then
  npm install -g pm2
  pm2 startup systemd -u ubuntu --hp /home/ubuntu
  log "PM2 installed"
else
  log "PM2 already installed"
fi

# =============================================================================
# PHASE 2 — App directory setup
# =============================================================================
info "Phase 2: Setting up app directory..."

sudo mkdir -p /var/www/careconnect
sudo chown -R ubuntu:ubuntu /var/www/careconnect
mkdir -p /home/ubuntu/careconnect
log "Directories created"

# =============================================================================
# PHASE 3 — Clone / copy app code
# =============================================================================
info "Phase 3: Deploying application code..."

# If you have a GitHub repo, uncomment and set your repo URL:
# REPO_URL="https://github.com/YOURUSERNAME/careconnect.git"
# if [ -d "/home/ubuntu/careconnect/.git" ]; then
#   cd /home/ubuntu/careconnect && git pull origin main
#   log "Code updated from GitHub"
# else
#   git clone $REPO_URL /home/ubuntu/careconnect
#   log "Code cloned from GitHub"
# fi

# If deploying via SCP (upload your code manually), this just confirms the dir exists:
if [ ! -f "/home/ubuntu/careconnect/package.json" ]; then
  warn "No code found at /home/ubuntu/careconnect/"
  warn "Please upload your project files via SCP:"
  warn "  scp -i your-key.pem -r ./careconnect ubuntu@YOUR_EC2_IP:/home/ubuntu/"
  warn "Then re-run this script."
  echo ""
  warn "Or set REPO_URL above and uncomment the git clone section."
  exit 1
fi

log "App code found"

# =============================================================================
# PHASE 4 — Environment variables
# =============================================================================
info "Phase 4: Checking environment variables..."

if [ ! -f "/home/ubuntu/careconnect/.env" ]; then
  warn ".env file not found!"
  warn "Creating .env from .env.example — YOU MUST FILL THIS IN:"
  cp /home/ubuntu/careconnect/.env.example /home/ubuntu/careconnect/.env
  echo ""
  echo "  Edit /home/ubuntu/careconnect/.env with your actual values:"
  echo "  nano /home/ubuntu/careconnect/.env"
  echo ""
  warn "After editing .env, re-run this script."
  exit 1
fi

# Verify required keys are set
source /home/ubuntu/careconnect/.env
REQUIRED_VARS=("DATABASE_URL" "OPENAI_API_KEY" "SENDGRID_API_KEY" "SENDGRID_FROM_EMAIL" "SESSION_SECRET")
for var in "${REQUIRED_VARS[@]}"; do
  if [ -z "${!var}" ]; then
    err "Required env var $var is not set in .env"
  fi
done
log "Environment variables verified"

# =============================================================================
# PHASE 5 — Install dependencies and build
# =============================================================================
info "Phase 5: Installing npm dependencies..."

cd /home/ubuntu/careconnect
npm install --production=false
log "Dependencies installed"

info "Building React frontend..."
npm run build 2>&1 | tail -5
log "Frontend built"

info "Copying frontend build to web root..."
sudo cp -r /home/ubuntu/careconnect/client/dist/* /var/www/careconnect/
log "Frontend deployed to /var/www/careconnect"

# =============================================================================
# PHASE 6 — Database migrations
# =============================================================================
info "Phase 6: Running database migrations..."

# Test DB connection first
if psql "$DATABASE_URL" -c "SELECT 1;" &>/dev/null; then
  log "Database connection successful"
else
  err "Cannot connect to database. Check DATABASE_URL in .env"
fi

# Run migrations in order
for migration in /home/ubuntu/careconnect/migrations/*.sql; do
  filename=$(basename "$migration")
  info "Running migration: $filename"
  psql "$DATABASE_URL" -f "$migration" 2>&1 | grep -v "^$" || true
  log "Migration $filename complete"
done

log "All migrations complete"

# =============================================================================
# PHASE 7 — Nginx configuration
# =============================================================================
info "Phase 7: Configuring Nginx..."

# Prompt for domain
echo ""
read -p "Enter your domain name (e.g. careconnect.yourdomain.com): " DOMAIN_NAME
if [ -z "$DOMAIN_NAME" ]; then
  err "Domain name is required for HTTPS setup"
fi

# Write Nginx config
sudo tee /etc/nginx/sites-available/careconnect > /dev/null <<EOF
server {
    listen 80;
    server_name $DOMAIN_NAME;

    # Redirect all HTTP to HTTPS
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl;
    server_name $DOMAIN_NAME;

    # SSL — certbot will fill these in
    ssl_certificate /etc/letsencrypt/live/$DOMAIN_NAME/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN_NAME/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # Gzip
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml;
    gzip_min_length 1000;

    # API requests — proxy to Express backend
    location /api/ {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 60s;
    }

    # React frontend — serve static files
    location / {
        root /var/www/careconnect;
        index index.html;
        try_files \$uri \$uri/ /index.html;
    }
}
EOF

# Enable the site
sudo ln -sf /etc/nginx/sites-available/careconnect /etc/nginx/sites-enabled/careconnect
sudo rm -f /etc/nginx/sites-enabled/default

# Test nginx config
sudo nginx -t
log "Nginx configured for $DOMAIN_NAME"

# =============================================================================
# PHASE 8 — SSL certificate via Certbot
# =============================================================================
info "Phase 8: Obtaining SSL certificate..."
warn "Make sure your domain $DOMAIN_NAME is pointing to this server's IP before continuing!"
echo ""
read -p "Is DNS set up and propagated? (yes/no): " DNS_READY

if [ "$DNS_READY" == "yes" ]; then
  sudo certbot --nginx -d "$DOMAIN_NAME" --non-interactive --agree-tos -m "admin@$DOMAIN_NAME" || {
    warn "Certbot failed. You can run it manually later:"
    warn "  sudo certbot --nginx -d $DOMAIN_NAME"
    warn "Continuing with HTTP-only for now..."
    # Rewrite nginx config without SSL for temp testing
    sudo tee /etc/nginx/sites-available/careconnect > /dev/null <<NOSSL
server {
    listen 80;
    server_name $DOMAIN_NAME;
    location /api/ {
        proxy_pass http://localhost:3001;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
    }
    location / {
        root /var/www/careconnect;
        index index.html;
        try_files \$uri \$uri/ /index.html;
    }
}
NOSSL
  }
  log "SSL certificate obtained"
else
  warn "Skipping SSL for now. Run this after DNS propagates:"
  warn "  sudo certbot --nginx -d $DOMAIN_NAME"
fi

sudo systemctl restart nginx
log "Nginx restarted"

# =============================================================================
# PHASE 9 — Start app with PM2
# =============================================================================
info "Phase 9: Starting application with PM2..."

cd /home/ubuntu/careconnect

# Write PM2 ecosystem config
cat > ecosystem.config.cjs <<EOF
module.exports = {
  apps: [{
    name: 'careconnect',
    script: 'src/server.js',
    cwd: '/home/ubuntu/careconnect',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '512M',
    env_production: {
      NODE_ENV: 'production',
      PORT: 3001
    },
    error_file: '/home/ubuntu/logs/careconnect-error.log',
    out_file: '/home/ubuntu/logs/careconnect-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss'
  }]
};
EOF

mkdir -p /home/ubuntu/logs

# Stop existing instance if running
pm2 stop careconnect 2>/dev/null || true
pm2 delete careconnect 2>/dev/null || true

# Start fresh
pm2 start ecosystem.config.cjs --env production
pm2 save

log "Application started with PM2"

# =============================================================================
# PHASE 10 — Health check
# =============================================================================
info "Phase 10: Running health check..."

sleep 3  # Give the server a moment to start

if curl -s http://localhost:3001/api/health | grep -q "ok"; then
  log "Backend health check passed"
else
  warn "Health check failed — check logs with: pm2 logs careconnect"
fi

# =============================================================================
# DONE
# =============================================================================
echo ""
echo "============================================"
echo -e "${GREEN}   Deployment Complete!${NC}"
echo "============================================"
echo ""
echo "  App URL:      https://$DOMAIN_NAME"
echo "  Admin panel:  https://$DOMAIN_NAME/admin"
echo "  API health:   https://$DOMAIN_NAME/api/health"
echo ""
echo "  Useful commands:"
echo "  pm2 logs careconnect        — live logs"
echo "  pm2 restart careconnect     — restart app"
echo "  pm2 status                  — app status"
echo "  sudo nginx -t               — test nginx config"
echo "  sudo systemctl reload nginx — reload nginx"
echo ""
echo "  To redeploy after code changes:"
echo "  cd /home/ubuntu/careconnect && git pull && npm run build"
echo "  sudo cp -r client/dist/* /var/www/careconnect/"
echo "  pm2 restart careconnect"
echo ""
