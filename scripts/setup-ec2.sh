#!/bin/bash

set -e

sudo apt update
sudo apt install -y curl git build-essential postgresql-client nginx certbot python3-certbot-nginx

export NVM_DIR="$HOME/.nvm"
if [ ! -d "$NVM_DIR" ]; then
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
fi

. "$NVM_DIR/nvm.sh"

nvm install 20
nvm alias default 20
nvm use 20

npm install -g pm2

sudo mkdir -p /var/www/careconnect
sudo chown -R "$USER":"$USER" /var/www/careconnect

# After your domain points to this EC2 instance, run:
# sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com
