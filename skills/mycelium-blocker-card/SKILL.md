---
name: mycelium-blocker-card
description: Use when a Mycelium worker is blocked by a decision, permission, access grant, product call, architecture call, or missing information that someone else must resolve.
---

# Mycelium Blocker Card

## Overview

A blocker needs two things: a canonical Mycelium record that can be resolved, and a visible explanation that gets the right person to respond. Use a gadget only as the visual card; the decision/work/access object is the source of truth.

## When to Use

Use when work cannot continue until someone decides, approves, grants access, clarifies requirements, or authorizes a restricted/production change.

Do not use for ordinary progress updates or blockers the worker can resolve alone.

## Workflow

1. **Identify the blocked context**
   - Current activity/work item/handover id.
   - Blocked worker/agent.
   - Orchestrator, if known.
   - Decider/approver, usually `@Nigel Thorne` when unclear.

2. **Create the canonical Mycelium object**
   - Decision needed: use `raise({ kind: "decision", ... })`.
   - Access/credential needed: use `request_access(...)` when a gated resource denied access.
   - Non-access task/blocker: use `raise({ kind: "task" | "issue", ... })`.

3. **Notify in the right thread**
   - Use `send_message({ activityId, content })` for the activity/work thread.
   - `@` mention the orchestrator if known; otherwise mention `@Nigel Thorne`.
   - Include the canonical id, what is blocked, options, risk, and the exact response needed.

4. **Publish a visual blocker gadget when helpful**
   - Use `publish_gadget` with a self-contained HTML blocker card.
   - The gadget must display the canonical decision/work/access id; it is not the source of truth.
   - Attach/embed it to the activity/page if useful with `attach_to_activity` or `embed_in_page`.

## Decision object pattern

```ts
raise({
  kind: "decision",
  title: "Decide: <short decision needed>",
  awaitingDecisionFrom: "@Nigel Thorne",
  question: [
    "Blocked worker: <agent>",
    "Blocked work: <activity/work id + short label>",
    "Decision needed: <specific yes/no/options>",
    "Options: A) ... B) ...",
    "Recommendation: ...",
    "Impact if delayed: ...",
  ].join("\n"),
});
```

## Activity-thread notification pattern

```ts
send_message({
  activityId: "activity:...",
  content: [
    "@Nigel Thorne decision needed to unblock <worker/work>.",
    "Canonical decision: decision:...",
    "Needed response: choose A/B or approve/deny <specific action>.",
    "Worker is blocked until this lands.",
  ].join("\n"),
});
```

## Gadget pattern

Use `publish_gadget` for a visible card with:

- Status: BLOCKED
- Blocked worker
- Blocked work/activity
- Decision/access needed
- Owner/decider to `@` mention
- Options and recommendation
- Canonical id (`decision:...`, `task:...`, grant id, etc.)
- Thread/activity id
- “What happens after approval”

Include a **canonical object preview inside the opened gadget** for the object that resolves the blocker. Important limitation: the outer Mycelium gadget tile in chat currently shows the platform's generic gadget preview (icon, title, "Interactive gadget", Open button). `publish_gadget` does not currently let the publisher customize that collapsed tile preview.

To make the blocker legible before opening, put the essential preview in the message caption or activity-thread notification:

- `BLOCKED: <worker/work>`
- `Decision/access needed: <specific ask>`
- `Owner: @orchestrator or @Nigel Thorne`
- `Canonical id: decision:... / grant id / task:...`
- `Needed response: approve/deny/choose option`

Inside the opened gadget, show a richer canonical object preview with:

- Object kind: Decision / Access request / Task / Issue
- Object status: Open / Pending / Active / Done
- Title
- Canonical id
- Owner/decider
- Blocked worker/work
- Needed response
- Activity/thread id

Optional workaround: attach a static screenshot/image preview alongside the gadget message if the collapsed chat feed needs a visual preview. Keep gadget HTML self-contained. No external network calls.

## Common Mistakes

- Publishing only a gadget and not raising a decision/work/access object.
- Posting in main chat instead of the activity/work thread.
- Failing to mention the decider, so nobody is notified.
- Asking vague questions like “what should I do?” instead of giving options and a recommended path.
- Treating an access grant as a decision instead of using `request_access`.
