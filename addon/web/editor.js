/* 
Remove Clozes Add-on for Anki


Copyright (C) 2016-2022  Aristotelis P. <https//glutanimate.com/>


This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version, with the additions
listed at the end of the accompanied license file.


This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.


You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <https://www.gnu.org/licenses/>.


NOTE: This program is subject to certain additional terms pursuant to
Section 7 of the GNU Affero General Public License.  You should have
received a copy of these additional terms immediately following the
terms and conditions of the GNU Affero General Public License which
accompanied this program.


If not, please request a copy through one of the means of contact
listed here: <https://glutanimate.com/contact/>.


Any modifications to this file must keep this entire header intact.
*/

/* Modified by https://github.com/athulkrishna2015/ on 2025‑11‑02: 
   Implemented cursor‑aware, nested‑safe cloze removal with native undo. */

/*
Cursor-aware, nested-safe cloze remover with native undo
- Removes only the innermost cloze that encloses the cursor (or selection start)
- Correctly skips nested {{c…::…}} while finding the matching }}
- Drops optional ::hint/comments
- Uses a single insertHTML command to create one undo step
- Fix: if caret is on the opener {{cN::, delete that cloze, not the parent
*/

(function () {
  // ==========================================
  // 1. CONFIGURATION & STATE
  // ==========================================
  function readRemoveClozesConfig() {
    if (window.RemoveClozesConfig && typeof window.RemoveClozesConfig === "object") {
      return window.RemoveClozesConfig;
    }

    const configTag = document.getElementById("remove-clozes-config");
    if (configTag && configTag.textContent) {
      try {
        const parsed = JSON.parse(configTag.textContent);
        if (parsed && typeof parsed === "object") {
          window.RemoveClozesConfig = parsed;
          return parsed;
        }
      } catch (e) {}
    }

    return {};
  }

  function getRemoveClozesConfig() {
    return readRemoveClozesConfig();
  }

  function getStripPastedClozesInNonClozeFields() {
    const config = getRemoveClozesConfig();
    return config.stripPastedClozesInNonClozeFields !== false;
  }

  function getProcessClozesInsideMathjax() {
    const config = getRemoveClozesConfig();
    return config.processClozesInsideMathjax !== false;
  }

  function getConfiguredHotkey() {
    const config = getRemoveClozesConfig();
    return typeof config.hotkey === "string" && config.hotkey.trim()
      ? config.hotkey
      : "Ctrl+Alt+Shift+R";
  }

  let cachedReviewClozeFieldNames = null;
  let cachedReviewClozeFieldNamesKey = null;

  function getReviewClozeFieldNames() {
    const config = getRemoveClozesConfig();
    const names = config.reviewClozeFieldNames;
    if (!Array.isArray(names)) {
      cachedReviewClozeFieldNames = null;
      cachedReviewClozeFieldNamesKey = null;
      return null;
    }

    const key = names.join("\u0000");
    if (key !== cachedReviewClozeFieldNamesKey) {
      cachedReviewClozeFieldNamesKey = key;
      cachedReviewClozeFieldNames = new Set(names);
    }
    return cachedReviewClozeFieldNames;
  }

  let editorClozeFields = null;

  // ==========================================
  // 2. SHORTCUTS & HOTKEYS
  // ==========================================
  function parseShortcut(shortcut) {
    if (!shortcut || typeof shortcut !== "string") return null;
    const keys = shortcut.toLowerCase().split(/[+]/).map((k) => k.trim()).filter(Boolean);
    if (!keys.length) return null;
    const main = keys[keys.length - 1];
    const mod = {
      ctrl: keys.includes("ctrl") || keys.includes("cmd") || keys.includes("meta"),
      shift: keys.includes("shift"),
      alt: keys.includes("alt"),
      key: main,
    };
    return mod;
  }

  function shortcutMatches(event, parsed) {
    if (!parsed) return false;
    if ((event.ctrlKey || event.metaKey) !== parsed.ctrl) return false;
    if (!!event.shiftKey !== parsed.shift) return false;
    if (!!event.altKey !== parsed.alt) return false;

    const code = (event.code || "").toLowerCase();
    const key = (event.key || "").toLowerCase();
    const main = parsed.key;

    if (main.length === 1) {
      if (/[a-z]/.test(main)) return code === `key${main}` || key === main;
      if (/\d/.test(main)) return code === `digit${main}` || key === main;
      return key === main;
    }

    return key === main || code === main;
  }

  function isEFDRCEditingContext() {
    if (!window.EFDRC) return false;
    const active = document.activeElement;
    if (!active) return false;
    return !!active.closest("[data-EFDRCfield]");
  }

  function installReviewShortcutIfNeeded() {
    const parsed = parseShortcut(getConfiguredHotkey());
    if (!parsed) return;
    if (window.__removeClozesReviewShortcutBound) return;

    window.addEventListener("keydown", function (event) {
      if (event.repeat) return;
      if (!isEFDRCEditingContext()) return;
      if (!shortcutMatches(event, parsed)) return;
      removeClozesInSelection();
      event.preventDefault();
      event.stopPropagation();
    }, true);

    window.__removeClozesReviewShortcutBound = true;
  }

  // ==========================================
  // 3. UTILITIES & HELPERS
  // ==========================================
  function interceptWindowFunction(name, beforeCall) {
    const wrap = function (fn) {
      if (typeof fn !== "function" || fn.__removeClozesWrapped) {
        return fn;
      }

      const wrapped = function (...args) {
        beforeCall(...args);
        return fn.apply(this, args);
      };
      wrapped.__removeClozesWrapped = true;
      return wrapped;
    };

    let current = wrap(window[name]);
    try {
      Object.defineProperty(window, name, {
        configurable: true,
        get() {
          return current;
        },
        set(value) {
          current = wrap(value);
        },
      });
    } catch (e) {
      if (typeof current === "function") {
        window[name] = current;
      }
    }
  }

  function decodeBase64Unicode(value) {
    if (!value) return "";
    try {
      return decodeURIComponent(
        window.atob(value)
          .split("")
          .map(function (char) {
            return `%${(`00${char.charCodeAt(0).toString(16)}`).slice(-2)}`;
          })
          .join("")
      );
    } catch (e) {
      return "";
    }
  }

  // ==========================================
  // 4. DOM & SELECTION HELPERS
  // ==========================================
  function getRootSelection(root) {
    return root && root.getSelection ? root.getSelection() : document.getSelection();
  }

  function canUseCommand(name) {
    return typeof document.queryCommandSupported === "function"
      ? document.queryCommandSupported(name)
      : true;
  }

  function collapseSelectionToEnd(selection) {
    if (selection && selection.collapseToEnd) {
      try {
        selection.collapseToEnd();
      } catch (e) {}
    }
  }

  function notifyInput(editable) {
    try {
      editable.dispatchEvent(new InputEvent("input", { bubbles: true }));
    } catch (e) {
      const evt = document.createEvent("Event");
      evt.initEvent("input", true, false);
      editable.dispatchEvent(evt);
    }
  }

  function stripRenderedMathjax(container) {
    if (!container || !container.querySelectorAll) return;
    const mathjaxNodes = container.querySelectorAll("anki-mathjax");
    if (!mathjaxNodes.length) return;

    mathjaxNodes.forEach((node) => {
      if (node.hasAttribute("data-formula") || node.hasAttribute("data-mathjax")) {
        // Prevent serialized HTML from capturing rendered MathJax nodes.
        node.innerHTML = "";
      }
    });
  }

  function getMathjaxFormulaText(node) {
    if (!node) return "";
    return node.getAttribute("data-formula") ||
      node.getAttribute("data-mathjax") ||
      node.textContent ||
      "";
  }

  function serializeHTMLWithMathjax(container, serializeMathjax) {
    if (!container) return "";

    const clone = container.cloneNode(true);
    const mathjaxNodes = clone.querySelectorAll
      ? clone.querySelectorAll("anki-mathjax")
      : [];
    const replacements = [];

    mathjaxNodes.forEach((node, index) => {
      const marker = "__REMOVE_CLOZES_MATHJAX_" + index + "__";
      replacements.push({
        marker: "<!--" + marker + "-->",
        value: serializeMathjax(node),
      });
      node.replaceWith(document.createComment(marker));
    });

    let html = clone.innerHTML;
    replacements.forEach((replacement) => {
      html = html.split(replacement.marker).join(replacement.value);
    });
    return html;
  }

  function serializeMathjaxSource(node) {
    const formula = getMathjaxFormulaText(node);
    return node.classList.contains("mjx-block")
      ? "\\[" + formula + "\\]"
      : "\\(" + formula + "\\)";
  }

  function serializeMathjaxElementHTML(node) {
    const clone = node.cloneNode(false);
    if (
      node.childNodes &&
      node.childNodes.length === 1 &&
      node.firstChild &&
      node.firstChild.nodeType === Node.TEXT_NODE
    ) {
      clone.textContent = node.textContent || "";
    }
    return clone.outerHTML;
  }

  function serializeReplacementHTML(container) {
    return serializeHTMLWithMathjax(container, serializeMathjaxElementHTML);
  }

  function serializeFieldHTML(container) {
    return serializeHTMLWithMathjax(container, serializeMathjaxSource);
  }

  function getActiveFieldIndex(editable) {
    const container = getClosestMatchingNode(editable, ".field-container");
    if (!container) return null;
    const rawIndex = container.getAttribute("data-index") || "";
    const fieldIndex = Number.parseInt(rawIndex, 10);
    return Number.isNaN(fieldIndex) ? null : fieldIndex;
  }

  function getSourceIndexForBoundary(container, node, offset) {
    const processClozesInsideMathjax = getProcessClozesInsideMathjax();
    let current = node;
    while (current && current !== container) {
      const root = current.getRootNode ? current.getRootNode() : null;
      if (root && root.nodeType === Node.DOCUMENT_FRAGMENT_NODE && root.host) {
        const host = root.host;
        if (host.tagName && host.tagName.toUpperCase() === "ANKI-MATHJAX") {
          const lightRange = document.createRange();
          lightRange.setStartBefore(container.firstChild || container);
          lightRange.setEndBefore(host);
          const frag = lightRange.cloneContents();
          const offsetBefore = getEditableSourceText(frag).length;
          return processClozesInsideMathjax ? offsetBefore + 2 : offsetBefore;
        }
        current = host;
      } else {
        break;
      }
    }

    const range = document.createRange();
    try {
      range.setStartBefore(container.firstChild || container);
      range.setEnd(node, offset);
    } catch (e) {
      return -1;
    }
    const frag = range.cloneContents();
    return getEditableSourceText(frag).length;
  }

  function getClosestMatchingNode(node, selector) {
    let current = node && node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    while (current) {
      if (current.matches && current.matches(selector)) {
        return current;
      }
      if (current.closest) {
        const match = current.closest(selector);
        if (match) return match;
      }
      const root = current.getRootNode ? current.getRootNode() : null;
      current = root && root.host ? root.host : null;
    }
    return null;
  }

  function getEditableFromEvent(event) {
    if (event && typeof event.composedPath === "function") {
      const path = event.composedPath();
      for (const node of path) {
        if (node && node.nodeType === Node.ELEMENT_NODE && node.isContentEditable) {
          return node;
        }
      }
    }

    const root = getActiveRoot();
    return getEditableDiv(root);
  }

  // ==========================================
  // 5. FIELD & CONTEXT CHECKING
  // ==========================================
  function editorFieldUsesClozeFilter(editable) {
    if (!Array.isArray(editorClozeFields)) return null;

    const container = getClosestMatchingNode(editable, ".field-container");
    if (!container) return null;

    const rawIndex = container.getAttribute("data-index") || "";
    const fieldIndex = Number.parseInt(rawIndex, 10);
    if (Number.isNaN(fieldIndex)) return null;
    return !!editorClozeFields[fieldIndex];
  }

  function reviewFieldUsesClozeFilter(editable) {
    const reviewClozeFieldNames = getReviewClozeFieldNames();
    if (!reviewClozeFieldNames) return null;

    const field = getClosestMatchingNode(editable, "[data-EFDRCfield]");
    if (!field) return null;

    const encodedFieldName = field.getAttribute("data-EFDRCfield");
    return reviewClozeFieldNames.has(decodeBase64Unicode(encodedFieldName));
  }

  function shouldStripPastedClozes(editable) {
    if (!getStripPastedClozesInNonClozeFields() || !editable) return false;

    const reviewFieldIsCloze = reviewFieldUsesClozeFilter(editable);
    if (reviewFieldIsCloze !== null) {
      return !reviewFieldIsCloze;
    }

    const editorFieldIsCloze = editorFieldUsesClozeFilter(editable);
    if (editorFieldIsCloze !== null) {
      return !editorFieldIsCloze;
    }

    return false;
  }

  function getActiveRoot() {
    const el = document.activeElement;
    if (!el) return document;
    return el.shadowRoot || document;
  }

  function getEditableDiv(root) {
    if (!root) return null;
    const active = root.activeElement || document.activeElement;
    if (active && (active.isContentEditable || active.tagName === "TEXTAREA")) {
      return active;
    }
    return root.querySelector('[contenteditable="true"]') || root.querySelector('textarea');
  }

  // ==========================================
  // 6. SOURCE TEXT & MAPPING (MATHJAX)
  // ==========================================
  function getEditableSourceText(container) {
    const processClozesInsideMathjax = getProcessClozesInsideMathjax();
    let text = "";
    const walker = document.createTreeWalker(
      container,
      NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
      {
        acceptNode(node) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            const tag = node.tagName.toUpperCase();
            if (tag === "ANKI-MATHJAX" || tag === "BR") return NodeFilter.FILTER_ACCEPT;
            return NodeFilter.FILTER_SKIP;
          }
          return NodeFilter.FILTER_ACCEPT;
        },
      }
    );

    let node;
    while ((node = walker.nextNode())) {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent;
      } else if (node.tagName.toUpperCase() === "ANKI-MATHJAX") {
        if (processClozesInsideMathjax) {
          const formula = node.getAttribute("data-formula") || node.getAttribute("data-mathjax") || "";
          if (node.classList.contains("mjx-block")) {
            text += "\\[" + formula + "\\]";
          } else {
            text += "\\(" + formula + "\\)";
          }
        } else {
          // Treat as a single atomic character placeholder to keep indices stable
          text += "\uFFFC"; 
        }
      } else if (node.tagName.toUpperCase() === "BR") {
        text += "\n";
      }
    }
    return text;
  }

  function mapSourceIndexToNodeOffset(container, idx, favorEnd = false) {
    const processClozesInsideMathjax = getProcessClozesInsideMathjax();
    const walker = document.createTreeWalker(
      container,
      NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
      {
        acceptNode(node) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            const tag = node.tagName.toUpperCase();
            if (tag === "ANKI-MATHJAX" || tag === "BR") return NodeFilter.FILTER_ACCEPT;
            return NodeFilter.FILTER_SKIP;
          }
          return NodeFilter.FILTER_ACCEPT;
        },
      }
    );

    let node;
    let remaining = idx;
    const nodes = [];
    while ((node = walker.nextNode())) {
      nodes.push(node);
    }

    for (const node of nodes) {
      let len = 0;
      const tag = node.nodeType === Node.ELEMENT_NODE ? node.tagName.toUpperCase() : "";
      if (node.nodeType === Node.TEXT_NODE) {
        len = node.textContent.length;
      } else if (tag === "ANKI-MATHJAX") {
        if (processClozesInsideMathjax) {
          const formula = node.getAttribute("data-formula") || node.getAttribute("data-mathjax") || "";
          const delimLen = 4; // \( and \) or \[ and \]
          len = formula.length + delimLen;
        } else {
          len = 1; // Length of the \uFFFC placeholder
        }
      } else if (tag === "BR") {
        len = 1;
      }

      if (favorEnd ? (remaining <= len && (len > 0 || remaining === 0)) : remaining < len) {
        if (node.nodeType === Node.TEXT_NODE) {
          return { node, offset: remaining };
        }
        if (tag === "ANKI-MATHJAX") {
          return { node, offset: remaining };
        }
        // For other atomic elements (BR), return position before/after based on remaining
        const parent = node.parentNode;
        const index = Array.from(parent.childNodes).indexOf(node);
        return { node: parent, offset: remaining === 0 ? index : index + 1 };
      }
      remaining -= len;
    }
    return { node: container, offset: container.childNodes.length };
  }

  function getCursorIndexInSource(container, selection) {
    if (!selection || selection.rangeCount === 0) return -1;
    const processClozesInsideMathjax = getProcessClozesInsideMathjax();

    let range = selection.getRangeAt(0);
    let node = range.startContainer;
    let offset = range.startOffset;

    // Handle Shadow DOM (Rendered MathJax)
    // Standard Ranges cannot cross shadow boundaries. If we are inside, we climb to host.
    let current = node;
    while (current && current !== container) {
      const root = current.getRootNode ? current.getRootNode() : null;
      if (root && root.nodeType === Node.DOCUMENT_FRAGMENT_NODE && root.host) {
        const host = root.host;
        if (host.tagName.toUpperCase() === "ANKI-MATHJAX") {
          // We are inside rendered math. Map cursor to just after delimiter or placeholder.
          const lightRange = document.createRange();
          lightRange.setStartBefore(container.firstChild || container);
          lightRange.setEndBefore(host);
          const frag = lightRange.cloneContents();
          const offsetBefore = getEditableSourceText(frag).length;
          return processClozesInsideMathjax ? offsetBefore + 2 : offsetBefore;
        }
        current = host;
      } else {
        break;
      }
    }

    const preCaretRange = range.cloneRange();
    try {
      preCaretRange.setStartBefore(container.firstChild || container);
      preCaretRange.setEnd(node, offset);
    } catch (e) {
      return -1;
    }

    const frag = preCaretRange.cloneContents();
    return getEditableSourceText(frag).length;
  }

  // ==========================================
  // 7. STRING PARSING & CLOZE MATH
  // ==========================================
  function findAllClozeRanges(text) {
    const ranges = [];
    let i = 0;
    while (i < text.length) {
      if (text.toLowerCase().startsWith("{{c", i)) {
        const mm = text.slice(i).match(/^\{\{c(\d+)::/i);
        if (mm) {
          const start = i;
          let j = i + mm[0].length;
          let depth = 0;
          let hintStart = null;
          while (j < text.length) {
            if (depth === 0 && text.startsWith("::", j) && hintStart === null) {
              hintStart = j;
              j += 2;
              continue;
            }
            if (depth === 0 && text.startsWith("}}", j)) {
              ranges.push({
                openStart: start,
                textStart: start + mm[0].length,
                textEnd: hintStart !== null ? hintStart : j,
                closeEnd: j + 2,
                clozeNum: parseInt(mm[1], 10),
              });
              // Do not jump i to j+1, because it will skip entirely any clozes
              // inside this cloze!
              // Instead, we can safely jump over the start tag `{{c...::`
              i += mm[0].length - 1;
              break;
            }
            const ch = text[j];
            if (ch === "{") depth++;
            else if (ch === "}" && depth > 0) depth--;
            j++;
          }
        }
      }
      i++;
    }
    return ranges;
  }

  function findInnermostClozeAt(text, pos) {
    const all = findAllClozeRanges(text);
    const candidates = all.filter(r => pos >= r.openStart && pos <= r.closeEnd);
    if (!candidates.length) return null;
    return candidates.reduce((a, b) => (b.closeEnd - b.openStart < a.closeEnd - a.openStart ? b : a));
  }

  // ==========================================
  // 8. ACTION & REPLACEMENT LOGIC
  // ==========================================
  function removeAiHint(container, clozeNum) {
    if (!container || !clozeNum) return;
    const aiHintsDiv = container.querySelector("div.ai-hints-json");
    if (!aiHintsDiv) return;

    try {
      const text = aiHintsDiv.textContent.trim();
      if (!text) return;
      const data = JSON.parse(text);
      const key = "c" + clozeNum;
      if (data.hasOwnProperty(key)) {
        delete data[key];
        if (Object.keys(data).length === 0) {
          aiHintsDiv.remove();
        } else {
          aiHintsDiv.textContent = JSON.stringify(data, null, 2);
        }
      }
    } catch (e) {
      console.error("Error updating AI hints:", e);
    }
  }

  function unwrapClozeInContainerByBounds(container, bounds) {
    const { openStart, textStart, textEnd, closeEnd } = bounds;
    const innerStartPos = mapSourceIndexToNodeOffset(container, textStart, false);
    const innerEndPos = mapSourceIndexToNodeOffset(container, textEnd, true);
    const outerStartPos = mapSourceIndexToNodeOffset(container, openStart, false);
    const outerEndPos = mapSourceIndexToNodeOffset(container, closeEnd, true);

    const innerRange = document.createRange();
    innerRange.setStart(innerStartPos.node, innerStartPos.offset);
    innerRange.setEnd(innerEndPos.node, innerEndPos.offset);
    const innerFrag = innerRange.cloneContents();

    const outerRange = document.createRange();
    outerRange.setStart(outerStartPos.node, outerStartPos.offset);
    outerRange.setEnd(outerEndPos.node, outerEndPos.offset);

    outerRange.deleteContents();
    outerRange.insertNode(innerFrag);
    if (container.normalize) {
      container.normalize();
    }
    return true;
  }

  function replaceClozeByBoundsInContainer(container, bounds) {
    const { openStart, textStart, textEnd, closeEnd } = bounds;
    const processClozesInsideMathjax = getProcessClozesInsideMathjax();

    const startInfo = mapSourceIndexToNodeOffset(container, openStart);
    const mathjax = processClozesInsideMathjax ? getClosestMatchingNode(startInfo.node, "anki-mathjax") : null;
    if (mathjax) {
      const formula = mathjax.getAttribute("data-formula") || mathjax.getAttribute("data-mathjax") || "";
      const source = getEditableSourceText(container);
      const fullRepr = mathjax.classList.contains("mjx-block") 
                       ? "\\[" + formula + "\\]" 
                       : "\\(" + formula + "\\)";
      const mjIdx = source.indexOf(fullRepr, Math.max(0, openStart - fullRepr.length - 10));
      
      if (mjIdx !== -1) {
        const formulaContentStartInSource = mjIdx + 2;
        const relOpen = openStart - formulaContentStartInSource;
        const relText = textStart - formulaContentStartInSource;
        const relEnd = textEnd - formulaContentStartInSource;
        const relClose = closeEnd - formulaContentStartInSource;

        if (relOpen >= 0 && relClose <= formula.length) {
          const newFormula = formula.slice(0, relOpen) + 
                             formula.slice(relText, relEnd) + 
                             formula.slice(relClose);
          
          const newEl = mathjax.cloneNode(true);
          newEl.setAttribute("data-formula", newFormula);
          if (newEl.hasAttribute("data-mathjax")) newEl.setAttribute("data-mathjax", newFormula);
          // Clear internal HTML to prevent duplicate rendering artifacts in undo stack
          newEl.innerHTML = "";
          if (newEl.textContent === formula) newEl.textContent = newFormula;

          mathjax.replaceWith(newEl);
          stripRenderedMathjax(container);
          if (bounds.clozeNum) {
            removeAiHint(container, bounds.clozeNum);
          }
          return true;
        }
      }
    }

    if (!unwrapClozeInContainerByBounds(container, bounds)) {
      return false;
    }
    stripRenderedMathjax(container);
    if (bounds.clozeNum) {
      removeAiHint(container, bounds.clozeNum);
    }
    return true;
  }

  function removeClozeRangesFromContainer(container, ranges) {
    if (!ranges.length) return false;
    const sorted = ranges.slice().sort((a, b) => b.openStart - a.openStart);
    let replaced = false;

    for (const next of sorted) {
      if (!replaceClozeByBoundsInContainer(container, next)) {
        continue;
      }
      replaced = true;
    }

    if (replaced) {
      stripRenderedMathjax(container);
    }

    return replaced;
  }

  function removeClozesInContainerBySelection(container, start, end) {
    if (start < 0 || end < 0) return false;
    const text = getEditableSourceText(container);
    const minPos = Math.min(start, end);
    const maxPos = Math.max(start, end);

    if (minPos === maxPos) {
      const bounds = findInnermostClozeAt(text, minPos);
      if (!bounds) return false;
      return replaceClozeByBoundsInContainer(container, bounds);
    }

    const ranges = findAllClozeRanges(text).filter(
      (r) => r.openStart >= minPos && r.closeEnd <= maxPos
    );
    if (!ranges.length) {
      const fallback = findInnermostClozeAt(text, minPos);
      if (!fallback) return false;
      return replaceClozeByBoundsInContainer(container, fallback);
    }

    return removeClozeRangesFromContainer(container, ranges);
  }

  function removeAllClozesFromContainer(container) {
    const removedClozeNums = [];
    const processClozesInsideMathjax = getProcessClozesInsideMathjax();

    while (true) {
      const text = getEditableSourceText(container);
      const ranges = findAllClozeRanges(text);
      if (!ranges.length) break;

      // Process the right-most cloze to keep indices stable for the next iteration
      let next = ranges[0];
      for (let i = 1; i < ranges.length; i++) {
        if (ranges[i].openStart > next.openStart) {
          next = ranges[i];
        }
      }

      // Check if this cloze is inside a MathJax element
      const startInfo = mapSourceIndexToNodeOffset(container, next.openStart);
      const mathjax = processClozesInsideMathjax ? getClosestMatchingNode(startInfo.node, "anki-mathjax") : null;

      if (mathjax) {
        const formula = mathjax.getAttribute("data-formula") || mathjax.getAttribute("data-mathjax") || "";
        const source = getEditableSourceText(container);
        const fullRepr = mathjax.classList.contains("mjx-block") 
                         ? "\\[" + formula + "\\]" 
                         : "\\(" + formula + "\\)";
        const mjIdx = source.indexOf(fullRepr, Math.max(0, next.openStart - fullRepr.length - 10));
        
        if (mjIdx !== -1) {
          const formulaContentStartInSource = mjIdx + 2;
          const relOpen = next.openStart - formulaContentStartInSource;
          const relText = next.textStart - formulaContentStartInSource;
          const relEnd = next.textEnd - formulaContentStartInSource;
          const relClose = next.closeEnd - formulaContentStartInSource;

          if (relOpen >= 0 && relClose <= formula.length) {
            const newFormula = formula.slice(0, relOpen) + 
                               formula.slice(relText, relEnd) + 
                               formula.slice(relClose);
            
            const newEl = mathjax.cloneNode(true);
            newEl.setAttribute("data-formula", newFormula);
            if (newEl.hasAttribute("data-mathjax")) newEl.setAttribute("data-mathjax", newFormula);
            // Clear internal HTML to prevent rendering duplication in undo stack
            newEl.innerHTML = "";
            if (newEl.textContent === formula) newEl.textContent = newFormula;
            
            mathjax.replaceWith(newEl);
            if (next.clozeNum) {
              removedClozeNums.push(next.clozeNum);
              removeAiHint(container, next.clozeNum);
            }
            continue;
          }
        }
      }

      // Fallback: standard plain-text unwrapping
      if (!unwrapClozeInContainerByBounds(container, next)) {
        break;
      }
      if (next.clozeNum) {
        removedClozeNums.push(next.clozeNum);
        removeAiHint(container, next.clozeNum);
      }
    }

    if (removedClozeNums.length > 0) {
      stripRenderedMathjax(container);
    }

    return removedClozeNums;
  }

  function stripClozesFromHTML(html) {
    if (!html || !html.toLowerCase().includes("{{c")) return null;

    const tmpDiv = document.createElement("div");
    tmpDiv.innerHTML = html;
    if (!findAllClozeRanges(getEditableSourceText(tmpDiv)).length) {
      return null;
    }

    return removeAllClozesFromContainer(tmpDiv).length > 0 ? serializeReplacementHTML(tmpDiv) : null;
  }

  function stripClozesFromText(text) {
    if (!text || !text.toLowerCase().includes("{{c")) return null;

    const tmpDiv = document.createElement("div");
    tmpDiv.textContent = text;
    if (!findAllClozeRanges(getEditableSourceText(tmpDiv)).length) {
      return null;
    }

    return removeAllClozesFromContainer(tmpDiv).length > 0 ? (tmpDiv.textContent || "") : null;
  }

  function insertPasteReplacement(root, range, replacement) {
    const selection = getRootSelection(root);
    if (!selection) return false;

    selection.removeAllRanges();
    selection.addRange(range);

    if (Object.prototype.hasOwnProperty.call(replacement, "html")) {
      if (canUseCommand("insertHTML")) {
        document.execCommand("insertHTML", false, replacement.html);
        collapseSelectionToEnd(selection);
        return true;
      }

      range.deleteContents();
      const frag = range.createContextualFragment(replacement.html);
      const lastNode = frag.lastChild;
      range.insertNode(frag);
      if (lastNode) {
        range.setStartAfter(lastNode);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
      }
      return true;
    }

    if (canUseCommand("insertText")) {
      document.execCommand("insertText", false, replacement.text);
      collapseSelectionToEnd(selection);
      return true;
    }

    range.deleteContents();
    const textNode = document.createTextNode(replacement.text);
    range.insertNode(textNode);
    range.setStartAfter(textNode);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  }

  function handlePasteStripClozes(event) {
    if (event.defaultPrevented) return;

    const editable = getEditableFromEvent(event);
    if (!shouldStripPastedClozes(editable)) return;

    const clipboard = event.clipboardData || window.clipboardData;
    if (!clipboard || typeof clipboard.getData !== "function") return;

    const html = clipboard.getData("text/html") || "";
    const text = clipboard.getData("text/plain") || "";

    let replacement = null;
    const strippedHTML = stripClozesFromHTML(html);
    if (strippedHTML !== null) {
      replacement = { html: strippedHTML };
    } else {
      const strippedText = stripClozesFromText(text);
      if (strippedText === null) return;
      replacement = { text: strippedText };
    }

    const root = editable && editable.getRootNode ? editable.getRootNode() : getActiveRoot();
    const selection = getRootSelection(root);
    if (!selection || selection.rangeCount === 0) return;

    event.preventDefault();
    event.stopPropagation();

    const range = selection.getRangeAt(0).cloneRange();
    if (!insertPasteReplacement(root, range, replacement)) return;
    notifyInput(editable);
  }

  function installPasteHandlerIfNeeded() {
    if (window.__removeClozesPasteHandlerBound) return;

    document.addEventListener("paste", handlePasteStripClozes, true);
    window.__removeClozesPasteHandlerBound = true;
  }

  // ==========================================
  // 8. ACTION & REPLACEMENT LOGIC
  // ==========================================
  function replaceClozeByBounds(root, editable, bounds) {
    const { openStart, textStart, textEnd, closeEnd } = bounds;
    const processClozesInsideMathjax = getProcessClozesInsideMathjax();

    const startInfo = mapSourceIndexToNodeOffset(editable, openStart, false);
    
    const mathjax = processClozesInsideMathjax ? getClosestMatchingNode(startInfo.node, "anki-mathjax") : null;
    if (mathjax) {
      const formula = mathjax.getAttribute("data-formula") || mathjax.getAttribute("data-mathjax") || "";
      const source = getEditableSourceText(editable);
      const fullRepr = mathjax.classList.contains("mjx-block") 
                       ? "\\[" + formula + "\\]" 
                       : "\\(" + formula + "\\)";
      const mjIdx = source.indexOf(fullRepr, Math.max(0, openStart - fullRepr.length - 10));
      
      if (mjIdx !== -1) {
        const formulaContentStartInSource = mjIdx + 2;
        const relOpen = openStart - formulaContentStartInSource;
        const relText = textStart - formulaContentStartInSource;
        const relEnd = textEnd - formulaContentStartInSource;
        const relClose = closeEnd - formulaContentStartInSource;

        if (relOpen >= 0 && relClose <= formula.length) {
          const newFormula = formula.slice(0, relOpen) + 
                             formula.slice(relText, relEnd) + 
                             formula.slice(relClose);
          
          const newEl = mathjax.cloneNode(true);
          newEl.setAttribute("data-formula", newFormula);
          if (newEl.hasAttribute("data-mathjax")) newEl.setAttribute("data-mathjax", newFormula);
          // Clear internal HTML to prevent duplicate rendering artifacts in undo stack
          newEl.innerHTML = "";
          if (newEl.textContent === formula) newEl.textContent = newFormula;

          const range = document.createRange();
          range.setStartBefore(mathjax);
          range.setEndAfter(mathjax);
          
          const sel = getRootSelection(root);
          sel.removeAllRanges();
          sel.addRange(range);

          if (canUseCommand("insertHTML")) {
            document.execCommand("insertHTML", false, newEl.outerHTML);
          } else {
            mathjax.replaceWith(newEl);
          }
          return true;
        }
      }
    }

    const innerStartPos = mapSourceIndexToNodeOffset(editable, textStart, false);
    const innerEndPos = mapSourceIndexToNodeOffset(editable, textEnd, true);
    const outerStartPos = mapSourceIndexToNodeOffset(editable, openStart, false);
    const outerEndPos = mapSourceIndexToNodeOffset(editable, closeEnd, true);

    const innerRange = document.createRange();
    innerRange.setStart(innerStartPos.node, innerStartPos.offset);
    innerRange.setEnd(innerEndPos.node, innerEndPos.offset);
    const innerFrag = innerRange.cloneContents();
    const tmpDiv = document.createElement("div");
    tmpDiv.appendChild(innerFrag);
    const innerHTML = serializeReplacementHTML(tmpDiv);

    const outerRange = document.createRange();
    outerRange.setStart(outerStartPos.node, outerStartPos.offset);
    outerRange.setEnd(outerEndPos.node, outerEndPos.offset);

    const editSel = getRootSelection(root);
    if (!editSel) return false;
    editSel.removeAllRanges();
    editSel.addRange(outerRange);

    if (canUseCommand("insertHTML")) {
      document.execCommand("insertHTML", false, innerHTML);
      collapseSelectionToEnd(editSel);
    } else {
      outerRange.deleteContents();
      const frag = outerRange.createContextualFragment(innerHTML);
      outerRange.insertNode(frag);
      // Fallback caret positioning (simple)
      editSel.removeAllRanges();
    }

    return true;
  }

  function removeClozeAtCursor() {
    const root = getActiveRoot();
    const editable = getEditableDiv(root);
    if (!editable) return;
    const processClozesInsideMathjax = getProcessClozesInsideMathjax();
    if (editable.tagName === "TEXTAREA" && !processClozesInsideMathjax) return;

    if (editable.focus) editable.focus();

    const sel = root.getSelection ? root.getSelection() : document.getSelection();
    if (!sel || sel.rangeCount === 0) return;

    let range = sel.getRangeAt(0);

    // Collapse selection to start to avoid deleting parent cloze when nested
    if (!range.collapsed) {
      const tmp = range.cloneRange();
      tmp.collapse(true);
      sel.removeAllRanges();
      sel.addRange(tmp);
      range = tmp;
    }

    const pos = editable.tagName === "TEXTAREA" ? editable.selectionStart : getCursorIndexInSource(editable, sel);
    if (pos < 0) return;

    const text = editable.tagName === "TEXTAREA" ? editable.value : getEditableSourceText(editable);
    const bounds = findInnermostClozeAt(text, pos);
    if (!bounds) return;

    if (editable.tagName === "TEXTAREA") {
      const start = bounds.openStart;
      const end = bounds.closeEnd;
      const content = text.slice(bounds.textStart, bounds.textEnd);
      
      // Standard textarea replacement
      const before = editable.value.slice(0, start);
      const after = editable.value.slice(end);
      editable.value = before + content + after;
      editable.selectionStart = editable.selectionEnd = start + content.length;
    } else {
      const replaced = replaceClozeByBounds(root, editable, bounds);
      if (!replaced) return;
      if (bounds.clozeNum) {
        removeAiHint(editable, bounds.clozeNum);
      }
    }

    // Notify Anki
    notifyInput(editable);
  }

  function removeClozesInSelection() {
    const root = getActiveRoot();
    const editable = getEditableDiv(root);
    if (!editable) return;
    const processClozesInsideMathjax = getProcessClozesInsideMathjax();
    if (editable.tagName === "TEXTAREA" && !processClozesInsideMathjax) return;

    if (editable.focus) editable.focus();

    const sel = root.getSelection ? root.getSelection() : document.getSelection();
    
    // Handle Textarea (MathJax Editor Popup)
    if (editable.tagName === "TEXTAREA") {
      const start = editable.selectionStart;
      const end = editable.selectionEnd;
      if (start === end) {
        removeClozeAtCursor();
        return;
      }
      
      const selectionText = editable.value.slice(start, end);
      const tmpDiv = document.createElement("div");
      tmpDiv.textContent = selectionText;
      
      const removedClozeNums = removeAllClozesFromContainer(tmpDiv);
      if (!removedClozeNums || !removedClozeNums.length) return;
      
      const before = editable.value.slice(0, start);
      const after = editable.value.slice(end);
      const newContent = tmpDiv.textContent;
      editable.value = before + newContent + after;
      editable.selectionStart = start;
      editable.selectionEnd = start + newContent.length;
      
      notifyInput(editable);
      return;
    }

    if (!sel || sel.rangeCount === 0) return;

    let range = sel.getRangeAt(0);
    if (range.collapsed) {
      removeClozeAtCursor();
      return;
    }

    // Work on a detached fragment to preserve structure, then replace selection once.
    const frag = range.cloneContents();
    const tmpDiv = document.createElement("div");
    tmpDiv.appendChild(frag);

    if (!findAllClozeRanges(getEditableSourceText(tmpDiv)).length) {
      // No clozes fully inside the selection; fall back to cursor-based removal.
      removeClozeAtCursor();
      return;
    }

    const removedClozeNums = removeAllClozesFromContainer(tmpDiv);
    if (!removedClozeNums || !removedClozeNums.length) return;

    for (const clozeNum of removedClozeNums) {
      removeAiHint(editable, clozeNum);
    }

    const replacementHTML = serializeReplacementHTML(tmpDiv);
    const editSel = getRootSelection(root);
    if (!editSel) return;
    editSel.removeAllRanges();
    editSel.addRange(range);

    if (canUseCommand("insertHTML")) {
      document.execCommand("insertHTML", false, replacementHTML);
      collapseSelectionToEnd(editSel);
    } else {
      range.deleteContents();
      const newFrag = range.createContextualFragment(replacementHTML);
      const lastNode = newFrag.lastChild;
      range.insertNode(newFrag);
      if (lastNode) {
        range.setStartAfter(lastNode);
        range.collapse(true);
        editSel.removeAllRanges();
        editSel.addRange(range);
      }
    }

    // Notify Anki
    notifyInput(editable);
  }

  // ==========================================
  // 9. EVENT LISTENERS & SETUP
  // ==========================================
  interceptWindowFunction("setClozeFields", function (fields) {
    editorClozeFields = Array.isArray(fields) ? fields.map(Boolean) : null;
  });

  // Public API expected by the add-on’s Python side and hotkey
  window.removeClozes = function () {
    removeClozesInSelection();
  };

  window.removeClozesBackend = function () {
    const root = getActiveRoot();
    const editable = getEditableDiv(root);
    if (!editable) return { changed: false };

    const selection = root.getSelection ? root.getSelection() : document.getSelection();
    if (!selection || selection.rangeCount === 0) return { changed: false };

    if (editable.tagName === "TEXTAREA") {
      const start = editable.selectionStart;
      const end = editable.selectionEnd;
      if (start === null || end === null) return { changed: false };
      if (start === end) return { changed: false, reason: "selection-collapsed" };

      const tmpDiv = document.createElement("div");
      tmpDiv.textContent = editable.value;
      const changed = removeClozesInContainerBySelection(tmpDiv, start, end);
      if (!changed) return { changed: false };
      return { changed: true, kind: "textarea", text: tmpDiv.textContent || "" };
    }

    const range = selection.getRangeAt(0);
    if (range.collapsed) return { changed: false, reason: "selection-collapsed" };
    const startIndex = getSourceIndexForBoundary(editable, range.startContainer, range.startOffset);
    const endIndex = getSourceIndexForBoundary(editable, range.endContainer, range.endOffset);
    if (startIndex < 0 || endIndex < 0) return { changed: false };

    const tmpDiv = document.createElement("div");
    tmpDiv.innerHTML = editable.innerHTML;
    const changed = removeClozesInContainerBySelection(tmpDiv, startIndex, endIndex);
    if (!changed) return { changed: false };

    const fieldIndex = getActiveFieldIndex(editable);
    if (fieldIndex === null) return { changed: false };
    return { changed: true, fieldIndex, html: serializeFieldHTML(tmpDiv) };
  };

  window.removeClozesShouldUseBackend = function () {
    if (!getProcessClozesInsideMathjax()) {
      return { useBackend: false, reason: "mathjax-processing-disabled" };
    }

    const root = getActiveRoot();
    const editable = getEditableDiv(root);
    if (!editable) return { useBackend: false, reason: "no-editable" };

    const selection = root.getSelection ? root.getSelection() : document.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return { useBackend: false, reason: "no-selection" };
    }

    const range = selection.getRangeAt(0);
    if (range.collapsed) {
      return { useBackend: false, reason: "selection-collapsed" };
    }

    if (getClosestMatchingNode(range.startContainer, "anki-mathjax")) {
      return { useBackend: true, reason: "start-in-mathjax" };
    }
    if (getClosestMatchingNode(range.endContainer, "anki-mathjax")) {
      return { useBackend: true, reason: "end-in-mathjax" };
    }

    const frag = range.cloneContents();
    if (frag && frag.querySelector && frag.querySelector("anki-mathjax")) {
      return { useBackend: true, reason: "selection-contains-mathjax" };
    }

    return { useBackend: false, reason: "no-mathjax" };
  };

  window.applyRemoveClozesTextarea = function (value) {
    const root = getActiveRoot();
    const editable = getEditableDiv(root);
    if (!editable || editable.tagName !== "TEXTAREA") return false;
    if (typeof value !== "string") return false;
    editable.value = value;
    notifyInput(editable);
    return true;
  };

  // Export internal functions for unit testing
  window._RemoveClozesTestAPI = {
    findAllClozeRanges,
    findInnermostClozeAt,
    getEditableSourceText,
    getCursorIndexInSource,
    mapSourceIndexToNodeOffset,
    serializeFieldHTML,
    serializeReplacementHTML,
    stripClozesFromHTML,
    stripClozesFromText,
    removeAllClozesFromContainer,
    replaceClozeByBounds,
    replaceClozeByBoundsInContainer,
    removeAiHint,
  };

  installPasteHandlerIfNeeded();
  installReviewShortcutIfNeeded();
})();
