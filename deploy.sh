#!/bin/bash
set -e
cd /root/apps/control-panel
git pull --ff-only || true
npm install
set -a
. /root/.panel-env/control-panel.env
set +a
pm2 restart control-panel --update-env
pm2 save
curl -s http://127.0.0.1:3010/health || true
