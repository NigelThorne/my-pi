---
name: brainstorming
description: Use when the user explicitly asks to brainstorm, or when requirements are still fuzzy enough that design exploration is needed before implementation.
---

# Brainstorming Ideas Into Designs

## Overview

Help turn ideas into fully formed designs and specs through natural collaborative dialogue.

This skill is optional by default. Use it when the user asks to brainstorm, explore options, or shape a design before implementation. Do not force it for every feature request.

Start by understanding the current project context, then ask questions one at a time to refine the idea. Once the direction is clear, present a short design or diagram and confirm any unresolved decisions. Follow the current user request and repository risk policy.

## When to Use

Use this skill when:
- the user says things like "let's brainstorm this", "help me think this through", or "what are our options?"
- the requirements are genuinely unclear and multiple plausible designs need comparison
- the user wants to explore trade-offs before writing code

Do not use this skill when:
- the user gives a direct implementation request and wants you to just do it
- the task is a straightforward bugfix or targeted edit
- design exploration would slow down obvious execution

## The Process

**Understanding the idea:**
- Check out the current project state first (files, docs, recent commits)
- Ask questions one at a time to refine the idea
- Prefer multiple choice questions when possible, but open-ended is fine too
- Only one question per message - if a topic needs more exploration, break it into multiple questions
- Focus on understanding: purpose, constraints, success criteria

**Exploring approaches:**
- Propose 2-3 different approaches with trade-offs
- Present options conversationally with your recommendation and reasoning
- Lead with your recommended option and explain why

**Presenting the design:**
- Once you believe you understand what you're building, present the design
- Use short sections or a diagram, with detail only where the decision needs it
- Ask about genuine decisions rather than repeatedly approving settled requirements
- Cover: architecture, components, data flow, error handling, testing
- Be ready to go back and clarify if something doesn't make sense

## After the Design

**Documentation:**
- Save working design notes with `write_artifact`
- Record durable project decisions in the repository's existing docs when that is part of the agreed outcome
- Follow repository policy for commits; a design discussion does not itself authorise publication

**Implementation (if continuing):**
- Continue with implementation when already requested and the material decisions are settled
- Use a worktree only when isolation is useful and permitted by the repository
- Read `writing-plans` when the work needs a multi-step plan; do not invoke user-selected execution workflows automatically

## Key Principles

- **One question at a time** - Don't overwhelm with multiple questions
- **Multiple choice preferred** - Easier to answer than open-ended when possible
- **YAGNI ruthlessly** - Remove unnecessary features from all designs
- **Explore alternatives** - Always propose 2-3 approaches before settling
- **Incremental validation** - Present design in sections, validate each
- **Be flexible** - Go back and clarify when something doesn't make sense
