#!/bin/sh
set -eu

superset db upgrade

if ! superset fab list-users 2>/dev/null | grep -qF "$SUPERSET_ADMIN_USERNAME"; then
  superset fab create-admin \
    --username "$SUPERSET_ADMIN_USERNAME" \
    --firstname "Open" \
    --lastname "Lakehouse" \
    --email "admin@localhost" \
    --password "$SUPERSET_ADMIN_PASSWORD"
fi

superset init
