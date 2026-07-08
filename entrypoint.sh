#!/bin/sh
set -e

# Decrypt secrets.yaml if age key is mounted
if [ -f /run/secrets/age.key ] && [ -f /workspace/secrets.enc.yaml ]; then
    echo "Decrypting secrets.yaml..."
    age --decrypt --identity /run/secrets/age.key \
        --output /workspace/common/secrets.yaml \
        /workspace/secrets.enc.yaml
fi

exec "$@"
