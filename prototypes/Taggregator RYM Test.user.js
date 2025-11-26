// ==UserScript==
// @name         MusicBrainz: Taggregator RYM Test
// @namespace    https://musicbrainz.org/user/chaban
// @version      0.1
// @description  Tests RYM tag extraction with choice: Background Tab vs. Simple Popup
// @author       chaban
// @match        *://musicbrainz.org/artist/*
// @match        *://musicbrainz.org/release/*
// @match        *://musicbrainz.org/release-group/*
// @match        *://rateyourmusic.com/*
// @grant        GM_openInTab
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addValueChangeListener
// @grant        GM_removeValueChangeListener
// @grant        window.close
// ==/UserScript==

(function() {
    'use strict';

    const STORAGE_KEY = 'RYM_TAGS_CACHE';

    // ============================================================================
    // PART 1: LOGIC ON RATEYOURMUSIC.COM
    // ============================================================================
    if (window.location.hostname.includes("rateyourmusic.com")) {

        // Function to extract tags
        const scrapeTags = () => {
            const tags = [];
            document.querySelectorAll("a.genre").forEach((element) => {
                const tag = element.textContent.trim();
                if (tag) tags.push(tag);
            });
            return tags;
        };

        // Case A: We are in the Popup (opened via window.open)
        if (window.opener) {
            window.addEventListener('load', () => {
                const tags = scrapeTags();
                console.log("[RYM Popup] Tags:", tags);

                // Send message to the opening window
                window.opener.postMessage({
                    type: "RYM_TAGS_RESULT",
                    url: window.location.href,
                    tags: tags
                }, "*");

                // Close the popup
                setTimeout(() => window.close(), 100);
            });
        }
        // Case B: We are in the Background Tab (opened via GM_openInTab)
        else {
            // Check if we were opened "freshly" (simplified here)
            window.addEventListener('load', () => {
                const tags = scrapeTags();
                if (tags.length > 0) {
                    console.log("[RYM Tab] Tags:", tags);
                    // Write to userscript storage
                    GM_setValue(STORAGE_KEY, {
                        url: window.location.href,
                        tags: tags,
                        timestamp: Date.now()
                    });
                    setTimeout(() => window.close(), 500);
                }
            });
        }

        return; // Stops further execution on RYM
    }

    // ============================================================================
    // PART 2: LOGIC ON MUSICBRAINZ.ORG
    // ============================================================================

    // --- METHOD 1: Background Tab (GM_openInTab) ---
    function runMethod1_Background(url, btn) {
        const originalText = btn.textContent;
        btn.disabled = true;
        btn.textContent = "Loading (Tab)...";

        // Listener for the response from storage
        const listenerId = GM_addValueChangeListener(STORAGE_KEY, function(name, oldVal, newVal, remote) {
            if (!newVal) return;

            // Check if the URL matches (path comparison)
            if (url.includes(new URL(newVal.url).pathname)) {
                GM_removeValueChangeListener(listenerId);

                if (newVal.tags && newVal.tags.length > 0) {
                    alert(`[Background Tab] Success!\n${newVal.tags.length} Tags:\n\n${newVal.tags.join(", ")}`);
                    btn.textContent = "Success";
                }
                btn.disabled = false;
            }
        });

        // Open tab in background
        GM_openInTab(url, { active: false, insert: true, setParent: true });

        // Timeout
        setTimeout(() => {
            if (btn.disabled) {
                GM_removeValueChangeListener(listenerId);
                btn.disabled = false;
                btn.textContent = "Timeout";
                alert("Timeout (Background Tab).\nA Captcha might be waiting in the opened background tab.");
            }
        }, 45000);
    }

    // --- METHOD 2: Simple Popup (window.open) ---
    function runMethod2_Popup(url, btn) {
        const originalText = btn.textContent;
        btn.disabled = true;
        btn.textContent = "Loading (Popup)...";

        // Simple, centered popup
        const w = 800;
        const h = 600;
        const left = (screen.width / 2) - (w / 2);
        const top = (screen.height / 2) - (h / 2);

        const popup = window.open(
            url,
            "RYM_Popup_Test",
            `width=${w},height=${h},top=${top},left=${left},toolbar=0,location=0,menubar=0`
        );

        if (!popup) {
            alert("Popup was blocked! Please allow popups for MusicBrainz.");
            btn.disabled = false;
            btn.textContent = originalText;
            return;
        }

        // Listener for postMessage
        const messageListener = (event) => {
            if (event.origin.includes("rateyourmusic.com") && event.data.type === "RYM_TAGS_RESULT") {
                window.removeEventListener("message", messageListener);

                const tags = event.data.tags;
                if (tags.length > 0) {
                    alert(`[Popup] Success!\n${tags.length} Tags:\n\n${tags.join(", ")}`);
                    btn.textContent = "Success";
                } else {
                    alert("[Popup] No tags found.");
                    btn.textContent = "No Tags";
                }
                btn.disabled = false;
            }
        };

        window.addEventListener("message", messageListener);

        // Timeout
        setTimeout(() => {
            if (btn.disabled) {
                window.removeEventListener("message", messageListener);
                btn.disabled = false;
                btn.textContent = "Timeout";
            }
        }, 60000);
    }

    // --- UI ---
    function init() {
        const externalLinks = document.querySelectorAll(".external_links li a");
        externalLinks.forEach(link => {
            if (link.href.includes("rateyourmusic.com")) {
                const container = document.createElement("span");
                container.style.marginLeft = "10px";

                // Button 1
                const btnBg = document.createElement("button");
                btnBg.textContent = "Test (Background)";
                btnBg.style.fontSize = "0.8em";
                btnBg.style.marginRight = "5px";
                btnBg.style.cursor = "pointer";
                btnBg.addEventListener("click", (e) => {
                    e.preventDefault();
                    runMethod1_Background(link.href, btnBg);
                });

                // Button 2
                const btnPop = document.createElement("button");
                btnPop.textContent = "Test (Popup)";
                btnPop.style.fontSize = "0.8em";
                btnPop.style.cursor = "pointer";
                btnPop.addEventListener("click", (e) => {
                    e.preventDefault();
                    runMethod2_Popup(link.href, btnPop);
                });

                container.appendChild(btnBg);
                container.appendChild(btnPop);
                link.parentNode.appendChild(container);
            }
        });
    }

    if (document.readyState === "complete" || document.readyState === "interactive") {
        init();
    } else {
        window.addEventListener("load", init);
    }
})();
