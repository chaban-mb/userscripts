This script will make it easier to submit edits and ISRCs to MusicBrainz from supported sites (MagicISRC and ISRC Hunt) from multiple tabs at once.
Also it can automatically close the tab after submitting a merge edit (when it was opened in a new tab).

You can use it either from the script's context menu or via bookmarklets.

MusicBrainz: Submit Edit (All Tabs)<br>
`javascript:(function(){ new BroadcastChannel('mb_edit_channel').postMessage('submit-edit'); })();`

MagicISRC: Submit ISRCs (All Tabs)<br>
`javascript:(function(){ new BroadcastChannel('magicisrc_submit_channel').postMessage('submit-isrcs'); })();`

ISRC Hunt: Submit ISRCs (All Tabs)<br>
`javascript:(function(){ new BroadcastChannel('isrc_hunt_submit_channel').postMessage('submit-isrcs'); })();`