#!/usr/bin/env bash
# PreToolUse (Edit|Write|MultiEdit): block edits to secrets and local data.
# Blocks: .env and .env.* (except *.example/*.sample) anywhere, and the repo-root data/ dir (app.db, backups).
# Fails closed: if the payload can't be parsed, the edit is blocked (exit 2).
input=$(cat)
f=$(printf '%s' "$input" | jq -er '.tool_input.file_path // empty') || { echo "protect-files: could not parse hook input" >&2; exit 2; }
f=${f//$'\r'/}
[ -z "$f" ] && exit 0
bs='\'
p=${f//"$bs"//}
root=${CLAUDE_PROJECT_DIR:-}
root=${root//"$bs"//}
[ -n "$root" ] && p=${p#"$root"/}
case "$p" in
  *.example|*.sample) exit 0 ;;
esac
if printf '%s' "$p" | grep -Eq '(^|/)\.env(\.[^/]*)?$|^data/'; then
  echo "Blocked: $p is a secrets/local-data path (.env*, data/). Edit it manually." >&2
  exit 2
fi
exit 0
