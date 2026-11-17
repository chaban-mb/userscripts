---
trigger: model_decision
description: Handling OAuth, SSO, and automatic login redirects during browser or Chrome DevTools automation.
---

# Browser Automation: OAuth & Auto-Login Redirects

When navigating to an authenticated page triggers an OAuth or SSO redirect (for example `*/oauth2/authorize*`, `/login`, or an identity provider URL):
- Do **not** immediately stop and ask the user to log in manually.
- Wait and poll briefly (using `wait_for` for expected destination content or checking `list_pages` URLs over ~5–10 seconds) for an active browser session to auto-login and redirect back to the target page.
- Only ask the user for manual login if the page remains on a login/consent form after the redirect settles.
