# Greasy Fork GitHub Webhook Sync & Changelog Behavior

Primary source: [`JasonBarnabe/greasyfork`](https://github.com/JasonBarnabe/greasyfork)

## Findings

### 1. Push Webhook Commit Aggregation (`lib/github.rb`)
In `Github.info_from_push_event(params)` ([`lib/github.rb`](https://github.com/JasonBarnabe/greasyfork/blob/main/lib/github.rb)):
- Greasy Fork iterates over every commit `c` in `params[:commits]` (all commits included in that single GitHub `push` event).
- For each file path `m` in `c[:modified]`:
  - `changed_files[m][:commit]` is overwritten with `c[:id]` — so Greasy Fork only fetches the **most recent commit** in the push for the file's code.
  - `changed_files[m][:messages]` **appends** `c[:message]` — so Greasy Fork keeps **all** commit messages from all commits in that push that modified `m`.
- Note: `Github.info_from_push_event` only inspects `c[:modified]` (not `c[:added]`).

### 2. ScriptVersion Creation & Changelog Formatting (`app/controllers/concerns/webhooks.rb`)
In `Webhooks#process_webhook_changes` ([`app/controllers/concerns/webhooks.rb`](https://github.com/JasonBarnabe/greasyfork/blob/main/app/controllers/concerns/webhooks.rb)):
- Greasy Fork creates **one** `ScriptVersion` per modified script per push webhook event using the content at the latest commit (`info[:commit]`).
- The `changelog` field is built by joining all collected `info[:messages]` from that push:
  ```ruby
  sv = script.script_versions.build(
    code: contents,
    changelog: info[:messages].join((changelog_markup == 'markdown') ? "\n\n" : ', '),
    changelog_markup:
  )
  ```
- Therefore, if a single push to `dist` contains two commits modifying the same script (`feat(...): X` followed by `chore(...): bump version to 0.4.0`), Greasy Fork creates **one** version (`0.4.0`) with **both** commit messages joined together (e.g. `feat(...): X, chore(...): bump version to 0.4.0` for plain text, or separated by `\n\n` for markdown).
- Conversely, if `dist` receives two *separate* pushes (first `feat(...)`, then later `chore(...): bump version`), Greasy Fork processes two separate webhook events.

## Sources
- [`lib/github.rb`](https://github.com/JasonBarnabe/greasyfork/blob/main/lib/github.rb) (`Github.info_from_push_event`)
- [`app/controllers/concerns/webhooks.rb`](https://github.com/JasonBarnabe/greasyfork/blob/main/app/controllers/concerns/webhooks.rb) (`Webhooks#process_webhook_changes`)
