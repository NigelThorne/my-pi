# Credentials

Store credentials for repository-owned helpers in macOS Keychain, not in source files, `.env` files, fixtures, session artifacts, or Git history. Commit only Keychain service/account identifiers. Keep provider-managed login credentials under the provider's control; do not copy existing OAuth tokens into the repository or invent a second credential store for them.

Use Security.framework from application code. For shell helpers, capture a Keychain lookup directly into the consuming command's environment:

```sh
SERVICE_API_KEY="$(security find-generic-password -a "$USER" -s 'my-pi/service-name' -w)" || exit 1
export SERVICE_API_KEY
service-command
unset SERVICE_API_KEY
```

Never run the lookup by itself in an agent-visible terminal. Do not enable shell tracing, print the resulting environment, or pass a secret in command-line arguments. Add credentials through Keychain Access or a helper using Security.framework. Do not place a secret in a `security add-generic-password -w ...` shell command where it can enter history or process arguments.

The Gemini image helper uses macOS Keychain through Security.framework and disables the upstream client's disk cookie cache. Other helpers should follow the same storage rule.

## Diagnostics and commits

- Do not save full `env` or `printenv` output. Print only explicitly selected non-secret fields, or report whether a credential is present without its value.
- A variable named `DONT_USE__...` can still contain a real credential. Its name does not make it safe to publish.
- Check staged files and unpublished history before pushing. `.gitignore` does not protect files already tracked or secret-bearing files with other names.
- If GitHub blocks a push for a secret, remove it from every affected unpublished commit. Deleting it in the latest commit is insufficient. Do not bypass push protection.
- Rotate any exposed credential that is still active. Do not test unknown credentials against a remote service just to determine whether they work.
- After local history cleanup, old objects can remain in reflogs. Push only the cleaned branch, never recovery refs or `--mirror`. Do not broadly expire reflogs or prune objects while other sessions may need them.
