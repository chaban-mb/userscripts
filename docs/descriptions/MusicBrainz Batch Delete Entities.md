Batch deletes supported MusicBrainz entities (releases, recordings, areas, instruments, genres).

You can trigger batch deletion from the sidebar link, via hotkeys (`D` in [MusicBrainz: Hotkeys for selected entities](https://github.com/chaban-mb/userscripts/blob/main/src/MusicBrainz%20Hotkeys%20for%20selected%20entities.user.js)), or via bookmarklet:

MusicBrainz: Batch Delete Entities<br>
`javascript:(()=>{const items=Array.from(document.querySelectorAll('input[name="add-to-merge"]:checked, input[name="remove"]:checked'),b=>(b.closest('tr,li')||b.parentElement)?.querySelector('a[href]')?.href).filter(Boolean);if(document.dispatchEvent(new CustomEvent('UserJS:MusicBrainz',{detail:{action:'delete',items},bubbles:!0,cancelable:!0})))alert('MusicBrainz: Batch Delete Entities userscript is not active on this page.');})();`

### Features
- **Modal Dialog Interface:** Provides a batch delete popup with input for entity URLs or MBIDs and a required edit note.
- **Real-time Status Streaming:** Displays progress logs, success/error statuses, and summary reporting for each entry processed.
- **Custom Event Integration:** Listens for `UserJS:MusicBrainz` custom events triggered from hotkeys or bookmarklets.
- **Error Recovery:** Supports aborting ongoing processing, retrying failed deletion requests, or cancelling created deletion edits.
