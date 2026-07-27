---
name: buildkite-investigator-cli
description: Use when investigating broken Buildkite builds, failed CI jobs, annotations, artifacts, or logs from a terminal session, especially for PatientNotes pipelines.
---

# Buildkite Investigator CLI

Use this skill when a Buildkite build is failing and you need fast terminal access to builds, jobs, logs, env, annotations, and artifacts.

## Command

Preferred wrapper:

```bash
bk
```

Also available as:

```bash
buildkite-investigator
```

## Default org hint

If the user does not specify an org and the task appears to be for PatientNotes, try:

```bash
patientnotes
```

Ask only if there is a real ambiguity.

## Auth

The CLI reads auth from either:

1. `BUILDKITE_API_TOKEN`
2. macOS Keychain item:
   - service: `buildkite-investigator-cli`
   - account: `BUILDKITE_API_TOKEN`

## Common commands

### Help

```bash
bk help
```

### List orgs

```bash
bk orgs --json
```

### List pipelines for PatientNotes

```bash
bk pipelines patientnotes --json
```

### List recent failed builds for a pipeline

```bash
bk builds patientnotes <pipeline> --state failed --per-page 10 --json
```

### Inspect a single build

```bash
bk build patientnotes <pipeline> <build-number> --json
```

### Get a failed job log

```bash
bk job-log patientnotes <pipeline> <build-number> <job-id>
```

### Get job env

```bash
bk job-env patientnotes <pipeline> <build-number> <job-id> --json
```

### List annotations

```bash
bk annotations patientnotes <pipeline> <build-number> --json
```

### List artifacts

```bash
bk artifacts patientnotes <pipeline> <build-number> --json
```

### Generate an AI-friendly investigation summary

```bash
bk investigate patientnotes <pipeline> <build-number>
```

JSON form:

```bash
bk investigate patientnotes <pipeline> <build-number> --log-lines 120 --json
```

## Recommended workflow

When debugging a broken build:

1. List recent failed builds for the pipeline.
2. Inspect the target build JSON.
3. Run `bk investigate patientnotes <pipeline> <build-number>`.
4. If needed, fetch specific job logs, env, and artifacts.

Prefer `--json` when another AI tool will consume the output.
