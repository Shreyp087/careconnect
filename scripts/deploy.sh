#!/bin/bash

set -e

npm run build

sudo mkdir -p /var/www/careconnect
sudo rm -rf /var/www/careconnect/dist
sudo cp -r client/dist /var/www/careconnect/

pm2 restart careconnect || pm2 start src/server.js --name careconnect
sudo nginx -t && sudo systemctl reload nginx

echo "Deploy complete"
