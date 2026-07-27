#!/usr/bin/env bash
#
# Pi Token Audit — standalone script for daily usage reports
#
# Usage:
#   ./audit.sh              # Today's usage
#   ./audit.sh yesterday    # Yesterday
#   ./audit.sh week         # Last 7 days
#   ./audit.sh month        # Last 30 days
#   ./audit.sh all          # All time
#   ./audit.sh 2026-03-15   # Specific date
#
# Cron example (daily report at 9am):
#   0 9 * * * /Users/nigelthorne/.pi/agent/extensions/token-audit/audit.sh yesterday
#
# Pipe to mail:
#   0 9 * * * /Users/nigelthorne/.pi/agent/extensions/token-audit/audit.sh yesterday | mail -s "Pi Token Audit" you@example.com

set -euo pipefail

SESSIONS_DIR="${HOME}/.pi/agent/sessions"
PERIOD="${1:-today}"

if [[ ! -d "$SESSIONS_DIR" ]]; then
  echo "No sessions directory found at $SESSIONS_DIR"
  exit 1
fi

# Determine time range as epoch seconds
now_epoch=$(date +%s)
today_start=$(date -j -f "%Y-%m-%d %H:%M:%S" "$(date +%Y-%m-%d) 00:00:00" +%s 2>/dev/null || date -d "$(date +%Y-%m-%d) 00:00:00" +%s)

case "$PERIOD" in
  today)
    start_epoch=$today_start
    end_epoch=$now_epoch
    label="Today ($(date +%Y-%m-%d))"
    ;;
  yesterday)
    start_epoch=$((today_start - 86400))
    end_epoch=$today_start
    label="Yesterday ($(date -j -v-1d +%Y-%m-%d 2>/dev/null || date -d "yesterday" +%Y-%m-%d))"
    ;;
  week)
    start_epoch=$((today_start - 7 * 86400))
    end_epoch=$now_epoch
    label="Last 7 days"
    ;;
  month)
    start_epoch=$((today_start - 30 * 86400))
    end_epoch=$now_epoch
    label="Last 30 days"
    ;;
  all)
    start_epoch=0
    end_epoch=$now_epoch
    label="All time"
    ;;
  20[0-9][0-9]-[0-1][0-9]-[0-3][0-9])
    # Specific date
    start_epoch=$(date -j -f "%Y-%m-%d %H:%M:%S" "$PERIOD 00:00:00" +%s 2>/dev/null || date -d "$PERIOD 00:00:00" +%s)
    end_epoch=$((start_epoch + 86400))
    label="$PERIOD"
    ;;
  *)
    echo "Usage: $0 [today|yesterday|week|month|all|YYYY-MM-DD]"
    exit 1
    ;;
esac

# Convert to milliseconds for comparison with session timestamps
start_ms=$((start_epoch * 1000))
end_ms=$((end_epoch * 1000))

# Extract all assistant messages with usage in the time range using python3
python3 - "$SESSIONS_DIR" "$start_ms" "$end_ms" "$label" << 'PYEOF'
import sys, os, json, glob

sessions_dir = sys.argv[1]
start_ms = int(sys.argv[2])
end_ms = int(sys.argv[3])
label = sys.argv[4]

records = []

for proj_dir in os.listdir(sessions_dir):
    proj_path = os.path.join(sessions_dir, proj_dir)
    if not os.path.isdir(proj_path):
        continue

    for fname in os.listdir(proj_path):
        if not fname.endswith(".jsonl"):
            continue

        fpath = os.path.join(proj_path, fname)
        try:
            with open(fpath, "r") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        entry = json.loads(line)
                        if (
                            entry.get("type") == "message"
                            and entry.get("message", {}).get("role") == "assistant"
                            and entry.get("message", {}).get("usage")
                        ):
                            msg = entry["message"]
                            ts = msg.get("timestamp", 0)
                            if start_ms <= ts < end_ms:
                                usage = msg["usage"]
                                cost = usage.get("cost", {})
                                records.append({
                                    "model": msg.get("model", "unknown"),
                                    "provider": msg.get("provider", "unknown"),
                                    "input": usage.get("input", 0),
                                    "output": usage.get("output", 0),
                                    "cacheRead": usage.get("cacheRead", 0),
                                    "cacheWrite": usage.get("cacheWrite", 0),
                                    "totalTokens": usage.get("totalTokens", 0),
                                    "cost": cost.get("total", 0),
                                    "project": proj_dir,
                                })
                    except json.JSONDecodeError:
                        pass
        except Exception:
            pass

def fmt_tokens(n):
    if n >= 1_000_000:
        return f"{n/1_000_000:.1f}M"
    if n >= 1_000:
        return f"{n/1_000:.1f}K"
    return str(n)

def fmt_cost(n):
    if n < 0.01:
        return f"${n:.4f}"
    return f"${n:.2f}"

print(f"📊 Pi Token Audit — {label}")
print("=" * 50)

if not records:
    print("  No usage found for this period.")
    sys.exit(0)

# Totals
total_requests = len(records)
total_input = sum(r["input"] for r in records)
total_output = sum(r["output"] for r in records)
total_cache_read = sum(r["cacheRead"] for r in records)
total_cache_write = sum(r["cacheWrite"] for r in records)
total_tokens = sum(r["totalTokens"] for r in records)
total_cost = sum(r["cost"] for r in records)

print()
print(f"  Requests:      {total_requests}")
print(f"  Total tokens:  {fmt_tokens(total_tokens)}")
print(f"    Input:       {fmt_tokens(total_input)}")
print(f"    Output:      {fmt_tokens(total_output)}")
print(f"    Cache read:  {fmt_tokens(total_cache_read)}")
print(f"    Cache write: {fmt_tokens(total_cache_write)}")
print(f"  Total cost:    {fmt_cost(total_cost)}")

# By model
models = {}
for r in records:
    key = f"{r['provider']}/{r['model']}"
    if key not in models:
        models[key] = {"requests": 0, "tokens": 0, "cost": 0}
    models[key]["requests"] += 1
    models[key]["tokens"] += r["totalTokens"]
    models[key]["cost"] += r["cost"]

print()
print("  By Model:")
print("  " + "─" * 48)
for key in sorted(models, key=lambda k: models[k]["cost"], reverse=True):
    m = models[key]
    print(f"    {key}")
    print(f"      {m['requests']} requests · {fmt_tokens(m['tokens'])} tokens · {fmt_cost(m['cost'])}")

# By project (top 10)
projects = {}
for r in records:
    p = r["project"].lstrip("-").rstrip("-").replace("--", "/")
    if p not in projects:
        projects[p] = {"requests": 0, "tokens": 0, "cost": 0}
    projects[p]["requests"] += 1
    projects[p]["tokens"] += r["totalTokens"]
    projects[p]["cost"] += r["cost"]

print()
print("  By Project:")
print("  " + "─" * 48)
sorted_projects = sorted(projects.items(), key=lambda x: x[1]["cost"], reverse=True)
for name, p in sorted_projects[:10]:
    short = ("…" + name[-39:]) if len(name) > 40 else name
    print(f"    {short}")
    print(f"      {p['requests']} requests · {fmt_tokens(p['tokens'])} tokens · {fmt_cost(p['cost'])}")

if len(sorted_projects) > 10:
    print(f"    ... and {len(sorted_projects) - 10} more projects")
PYEOF
