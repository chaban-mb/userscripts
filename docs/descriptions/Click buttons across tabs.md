Synchronizes button clicks and form submissions across multiple open tabs.

This will make it easier to submit edits and ISRCs to MusicBrainz from supported sites (MagicISRC and ISRC Hunt) from multiple tabs at once.
It can also automatically close the tab after submitting a merge edit (when it was opened in a new tab).

You can use it either from the script's context menu or via bookmarklets.

MusicBrainz: Submit Edit (All Tabs)<br>
`javascript:(function(){ new BroadcastChannel('mb_edit_channel').postMessage('submit-edit'); })();`

MagicISRC: Submit ISRCs (All Tabs)<br>
`javascript:(function(){ new BroadcastChannel('magicisrc_submit_channel').postMessage('submit-isrcs'); })();`

ISRC Hunt: Submit ISRCs (All Tabs)<br>
`javascript:(function(){ new BroadcastChannel('isrc_hunt_submit_channel').postMessage('submit-isrcs'); })();`

### Features
- **Cross-Tab Sync:** Will click the same button in all open tabs to trigger the same action in other tabs.
- **Rate Limiting:** Has a configurable rate limit to prevent errors during bulk submissions.
- **Auto-Close:** Can automatically close tabs after a successful submission.