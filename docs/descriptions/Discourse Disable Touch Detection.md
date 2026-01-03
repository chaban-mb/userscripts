This script prevents Discourse from hiding editor toolbar functions on touch-capable devices.

It works by spoofing the browser APIs that Discourse uses for touch detection, ensuring the full desktop toolbar is always visible. The script is designed to be robust, supporting both recent and old versions of Discourse.

By default, this script only runs on the [MetaBrainz Community Discourse](https://community.metabrainz.org/). To use it on other forums, you can add more `@match` directives in the script's settings.

Before:
![Before](https://greasyfork.org/rails/active_storage/blobs/redirect/eyJfcmFpbHMiOnsiZGF0YSI6MTg2NzE1LCJwdXIiOiJibG9iX2lkIn19--1f30dc15e4d8a31ebde67eafa83390a30a855ea3/Screenshot%202025-08-25%2018.06.05.png)

After:
![After](https://greasyfork.org/rails/active_storage/blobs/redirect/eyJfcmFpbHMiOnsiZGF0YSI6MTg2NzE0LCJwdXIiOiJibG9iX2lkIn19--d769e44c4fa0dbc674c3390dd59e24d4f108e50e/Screenshot%202025-08-25%2018.06.09.png)


See also
"[Why so many options in the gear editor menu? - UX - Discourse Meta](https://meta.discourse.org/t/why-so-many-options-in-the-gear-editor-menu/239497)"