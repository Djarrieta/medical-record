#!/usr/bin/env bash
set -e
sudo git pull
sudo docker compose up -d --build
