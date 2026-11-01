#!/usr/bin/env bash
# 由 systemd 调用：把 daemon 的 stdout/stderr 全部写进日志文件再 exec。
# 用脚本而不是 systemd 的 StandardOutput= 是因为这台 WSL 的 systemd 版本
# 不认 append:/file: 这些写法，结果崩了也看不到原因。
set -u
SERVER="/mnt/e/AI/feiyu-voice/server"
LOG="$SERVER/.runtime/daemon.log"
PY="/root/.local/share/feiyu-voice/cuda/tts/venv/bin/python"

mkdir -p "$(dirname "$LOG")"
cd "$SERVER" || exit 1
exec "$PY" -B -u feiyu_runtime/daemon.py \
  --package "$SERVER/models/FeiyuVoice-CosyVoice3" \
  --profile "$SERVER/configs/runtime.tts.cuda.local.json" \
  --port 9881 >> "$LOG" 2>&1
