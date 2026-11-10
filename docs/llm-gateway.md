# LLM gateway (CLIProxyAPI)

## What and why
- OpenAI/Codex subscription ended (Nov 2026).
- All LLM calls now go through a local gateway.
- Gateway uses the Claude subscription (OAuth).
- Tools talk OpenAI or Anthropic API to it. One place to change models.

## Diagram
```
 pi / pixi / time_manager / NigelsPA ...
          |  (key: local)
          v
 CLIProxyAPI  127.0.0.1:8317   (loopback only)
          |  tier alias -> real model
          v
 Claude (subscription OAuth)
```

## Tiers
| Tier | Model | Thinking |
|---|---|---|
| fast | claude-haiku-5-5 | off by default |
| coding | claude-sonnet-5-5 | not available on this path |
| smart | claude-opus-5-5 | on by default |

- smart: use `max_tokens >= 2000`, or send `thinking: {type: disabled}`.
- fast: send `thinking {type: enabled, budget_tokens: 2000}` to turn on.
- Default rule: `requests.payload.default-raw` in config.yaml.

## Point a tool at it
| Client | Setting |
|---|---|
| OpenAI SDK | `base_url=http://127.0.0.1:8317/v1`, `api_key=local` |
| Anthropic SDK | `base_url=http://127.0.0.1:8317`, `x-api-key: local` |
| pi | provider `cpa`, model `fast`/`coding`/`smart` |
| curl | `curl -H "Authorization: Bearer local" http://127.0.0.1:8317/v1/models` |

Endpoints: `/v1/chat/completions`, `/v1/responses`, `/v1/messages`.
Tools, streaming, json_schema, image input all verified.

## Machines
| Machine | Gateway | Service | Used by |
|---|---|---|---|
| Mac | 127.0.0.1:8317 | LaunchAgent `com.nigelthorne.cliproxyapi` | pi, time_manager, NigelsPA, threadkeeper, delivery scanner |
| Raspberry Pi (`ssh pix`) | same config | systemd `cliproxyapi.service` | pix_server, pixi |

## Where things live
| What | Path |
|---|---|
| Config | `~/.cli-proxy-api/config.yaml` |
| Docs | `~/.cli-proxy-api/README.md` |
| Scripts | `status.sh`, `verify-tiers.sh` |
| Backups | `~/.cli-proxy-api/backups/` |
| Logs | `~/Library/Logs/cliproxyapi/{out,err}.log` |
| pi provider | `~/.pi/agent/models.json` (`cpa`, api `anthropic-messages`) |
| Agents | `agents/*.md` |

## Operations
| Task | Command |
|---|---|
| Status | `~/.cli-proxy-api/status.sh` |
| Verify tiers | `~/.cli-proxy-api/verify-tiers.sh` |
| Restart | `launchctl kickstart -k gui/$(id -u)/com.nigelthorne.cliproxyapi` |
| Re-login | `cliproxyapi --config ~/.cli-proxy-api/config.yaml --claude-login` |
| Change tier | edit `name` in `oauth.model-alias.claude`, restart |
| Add tier | add an alias entry, restart |
| Rollback | copy a file from `backups/` over config.yaml, restart |

Pi: `systemctl status cliproxyapi` over `ssh pix`.

## Agent tiers
- coding: worker, remover, visual-tester
- smart: planner, reviewer, anthropologist
- fast: scout

## Limits and gaps
- Usage limit arrives as HTTP 429. No fallback.
- One Claude account only.
- No embeddings (404), no Whisper (404), no TTS (400).
- Replies may say they are "Claude Code".
- Logs are not rotated.

## Security
- Never expose beyond loopback.
- Key `local` is a dummy, not a secret.
- Never read `~/.cli-proxy-api/auths`.
- No credentials in the repo.

## Migrated tools
| Tool | Knobs |
|---|---|
| pi agents | `cpa/fast`, `cpa/coding`, `cpa/smart` |
| time_manager | `OPENAI_BASE_URL=http://127.0.0.1:8317/v1`, `OPENAI_API_KEY=local`, `OPENAI_MODEL=smart` |
| NigelsPA | pi provider `cpa`, model `smart` |
| threadkeeper | default `cpa/fast` |
| delivery scanner | model `coding` |
| pix (Pi) | `PIX_LLM_BASE_URL`, `PIX_LLM_API_KEY` |
| pixi (Pi) | `PIXI_LLM_BASE_URL`, `PIXI_LLM_API_KEY`, `PIXI_EMAIL_MODEL` |

Retired: `codex` CLI moved to `~/.local/bin/disabled/`.
