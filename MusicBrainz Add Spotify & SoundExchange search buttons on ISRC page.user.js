// ==UserScript==
// @name         MusicBrainz: Add Spotify & SoundExchange search buttons on ISRC page
// @namespace    https://musicbrainz.org/user/chaban
// @version      3.2
// @description  Adds buttons to search for the ISRC on Spotify and SoundExchange
// @tag          ai-created
// @author       rinsuki, chaban
// @license      MIT
// @match        *://*.musicbrainz.org/isrc/*
// @icon         https://musicbrainz.org/static/images/favicons/android-chrome-512x512.png
// @grant        none
// ==/UserScript==

(() => {
    const pathParts = document.location.pathname.split('/');
    const isrcPart = pathParts[2];

    if (isrcPart) {
        const searchLinks = [
            {
                label: "Search on Spotify",
                url: `https://open.spotify.com/search/isrc:${isrcPart}/tracks`
            },
            {
                label: "Search on SoundExchange",
                url: `https://isrc.soundexchange.com/?tab="code"&isrcCode="${isrcPart}"`
            }
        ];

        const buttonStyle = `
            display: inline-block;
            padding: 0.3em 0.6em;
            border: 1px solid #0073aa;
            background-color: #f0f8ff;
            color: #0073aa;
            cursor: pointer;
            text-decoration: none;
            margin-right: 0.5em;
        `;

        const header = document.querySelector('#page > h1:has(a[href^="/isrc/"])');
        if (header && header.parentElement) {
            const buttonContainer = document.createElement("div");
            buttonContainer.style.marginTop = "0.5em";

            searchLinks.forEach((linkInfo, index) => {
                const buttonLink = document.createElement("a");
                buttonLink.href = linkInfo.url.replace('{isrcPart}', isrcPart);
                buttonLink.target = "_blank";
                buttonLink.textContent = linkInfo.label;
                buttonLink.style.cssText = buttonStyle;
                if (index === searchLinks.length - 1) {
                    buttonLink.style.marginRight = "0";
                }
                buttonContainer.appendChild(buttonLink);
            });

            header.parentElement.insertBefore(buttonContainer, header.nextSibling);
        }
    }
})();