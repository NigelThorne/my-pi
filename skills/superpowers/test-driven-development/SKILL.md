---
name: test-driven-development
description: Use when implementing or changing behaviour, adding a regression test, or deciding how to test a code change.
---

# Test-driven development

Test observable behaviour through an appropriate public interface. Follow the project's conventions and risk policy. Documentation-only edits need document checks, not an artificial application test.

## Red, green, refactor

1. Identify the expected behaviour and the interface under test. Use agreed acceptance criteria and existing test conventions. Ask when the intended behaviour or testing boundary is genuinely unresolved.
2. Write a focused failing test. Run it and confirm that it fails for the intended missing behaviour, not a typo, broken fixture, or unrelated setup problem.
3. Implement the smallest change that makes it pass. Avoid speculative features and unrelated cleanup.
4. Run the focused test and relevant regression checks.
5. Refactor while green when it improves the code within the agreed scope. Re-run affected checks.

Repeat in small behaviour slices, rather than writing a large batch of speculative tests.

## Test quality

Use independent expected results from the spec or worked examples. Prefer tests that survive internal refactoring. Mock external boundaries when needed, not internal calls merely to mirror the implementation. See `testing-anti-patterns.md` when introducing mocks or test utilities.

Coverage should follow behaviours and risk, not a requirement to test every private function separately. Test failure paths and important invariants, especially for permissions, persistence, and concurrency.

## When tests come late

Preserve existing work. Do not delete code or user changes to recreate a test-first history.

Add the missing regression test, then prove that it catches the defect. In an isolated fixture or disposable copy, exercise the known-bad implementation and confirm failure, then run against the fix and confirm success. If demonstrating sensitivity requires temporarily changing code, preserve the exact patch and avoid touching shared or concurrent work. Prefer an isolated reproduction.

Report honestly that the test was added after implementation. If sensitivity cannot be established, say what remains unproven.

## Exceptions and completion

For throwaway prototypes, generated code, configuration, or environments without a suitable test seam, choose a proportionate validation method under the project's policy. Explain material gaps and get a decision when risk or acceptance criteria require one.

Before declaring success, inspect the diff and run the relevant final checks. Read `verification-before-completion` when making completion claims. A test that passed once does not establish untested behaviour.
