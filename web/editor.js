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
  const removeClozesConfig = window.RemoveClozesConfig || {};
  const stripPastedClozesInNonClozeFields =
    removeClozesConfig.stripPastedClozesInNonClozeFields !== false;
  const reviewClozeFieldNames = Array.isArray(removeClozesConfig.reviewClozeFieldNames)
    ? new Set(removeClozesConfig.reviewClozeFieldNames)
    : null;
  let editorClozeFields = null;

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
    const parsed = parseShortcut(window.RemoveClozesHotkey);
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
    if (!reviewClozeFieldNames) return null;

    const field = getClosestMatchingNode(editable, "[data-EFDRCfield]");
    if (!field) return null;

    const encodedFieldName = field.getAttribute("data-EFDRCfield");
    return reviewClozeFieldNames.has(decodeBase64Unicode(encodedFieldName));
  }

  function shouldStripPastedClozes(editable) {
    if (!stripPastedClozesInNonClozeFields || !editable) return false;

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
    if (active && active.isContentEditable) {
      return active;
    }
    return root.querySelector('[contenteditable="true"]');
  }

  function mapIndexToNodeOffset(container, idx) {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
    let node = walker.nextNode();
    let remaining = idx;
    while (node) {
      const len = node.textContent.length;
      // At exact text-node boundaries, prefer the next text node start.
      // This avoids expanding replacements into previous paragraphs/lines.
      if (remaining < len) {
        return { node, offset: remaining };
      }
      remaining -= len;
      node = walker.nextNode();
    }
    return { node: container, offset: container.childNodes.length };
  }

  function getCursorIndexInText(container, selection) {
    if (!selection || selection.rangeCount === 0) return -1;

    // Avoid inserting temporary marker text into the DOM; that can pollute undo history.
    const startNode =
      container && container.nodeType === Node.DOCUMENT_NODE
        ? (container.body || container.documentElement)
        : container;
    if (!startNode) return -1;

    const range = selection.getRangeAt(0);
    const preCaretRange = range.cloneRange();
    preCaretRange.selectNodeContents(startNode);
    try {
      preCaretRange.setEnd(range.startContainer, range.startOffset);
    } catch (e) {
      return -1;
    }

    const tmp = document.createElement("div");
    tmp.appendChild(preCaretRange.cloneContents());
    return (tmp.textContent || "").length;
  }

  function findAllClozeRanges(text) {
    const ranges = [];
    const stack = [];

    for (let i = 0; i < text.length; i++) {
      if (text.startsWith("{{c", i)) {
        const mm = text.slice(i).match(/^\{\{c\d+::/);
        if (mm) {
          stack.push({
            openStart: i,
            textStart: i + mm[0].length,
            hintStart: null,
          });
          i += mm[0].length - 1;
          continue;
        }
      }

      if (stack.length && text.startsWith("::", i)) {
        const top = stack[stack.length - 1];
        if (top.hintStart === null) {
          top.hintStart = i;
        }
        i++;
        continue;
      }

      if (stack.length && text.startsWith("}}", i)) {
        const top = stack.pop();
        const textEnd = top.hintStart !== null ? top.hintStart : i;
        ranges.push({
          openStart: top.openStart,
          textStart: top.textStart,
          textEnd,
          closeEnd: i + 2,
        });
        i++;
      }
    }

    return ranges;
  }

  function unwrapClozeInContainerByBounds(container, bounds) {
    const { openStart, textStart, textEnd, closeEnd } = bounds;
    const innerStartPos = mapIndexToNodeOffset(container, textStart);
    const innerEndPos = mapIndexToNodeOffset(container, textEnd);
    const outerStartPos = mapIndexToNodeOffset(container, openStart);
    const outerEndPos = mapIndexToNodeOffset(container, closeEnd);

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

  function removeAllClozesFromContainer(container) {
    let replaced = false;

    while (true) {
      const text = container.textContent || "";
      const ranges = findAllClozeRanges(text);
      if (!ranges.length) break;

      // Right-most first keeps indices stable as we unwrap repeatedly.
      let next = ranges[0];
      for (let i = 1; i < ranges.length; i++) {
        if (ranges[i].openStart > next.openStart) {
          next = ranges[i];
        }
      }

      if (!unwrapClozeInContainerByBounds(container, next)) {
        break;
      }
      replaced = true;
    }

    return replaced;
  }

  function stripClozesFromHTML(html) {
    if (!html || !html.includes("{{c")) return null;

    const tmpDiv = document.createElement("div");
    tmpDiv.innerHTML = html;
    if (!findAllClozeRanges(tmpDiv.textContent || "").length) {
      return null;
    }

    return removeAllClozesFromContainer(tmpDiv) ? tmpDiv.innerHTML : null;
  }

  function stripClozesFromText(text) {
    if (!text || !text.includes("{{c")) return null;

    const tmpDiv = document.createElement("div");
    tmpDiv.textContent = text;
    if (!findAllClozeRanges(tmpDiv.textContent || "").length) {
      return null;
    }

    return removeAllClozesFromContainer(tmpDiv) ? (tmpDiv.textContent || "") : null;
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

  function replaceClozeByBounds(root, editable, bounds) {
    const { openStart, textStart, textEnd, closeEnd } = bounds;

    const innerStartPos = mapIndexToNodeOffset(editable, textStart);
    const innerEndPos = mapIndexToNodeOffset(editable, textEnd);
    const outerStartPos = mapIndexToNodeOffset(editable, openStart);
    const outerEndPos = mapIndexToNodeOffset(editable, closeEnd);

    const innerRange = document.createRange();
    innerRange.setStart(innerStartPos.node, innerStartPos.offset);
    innerRange.setEnd(innerEndPos.node, innerEndPos.offset);
    const innerFrag = innerRange.cloneContents();
    const tmpDiv = document.createElement("div");
    tmpDiv.appendChild(innerFrag);
    const innerHTML = tmpDiv.innerHTML;

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
      // Fallback (may not integrate with undo)
      outerRange.deleteContents();
      const frag = outerRange.createContextualFragment(innerHTML);
      outerRange.insertNode(frag);
      if (editSel.removeAllRanges) {
        editSel.removeAllRanges();
        const endIdx = openStart + (textEnd - textStart);
        const caretPos = mapIndexToNodeOffset(editable, endIdx);
        const caretRange = document.createRange();
        caretRange.setStart(caretPos.node, caretPos.offset);
        caretRange.collapse(true);
        editSel.addRange(caretRange);
      }
    }

    return true;
  }

  // Find the innermost cloze whose opener/contents contain `pos`
  // Returns { openStart, textStart, textEnd, closeEnd } or null
  function findInnermostClozeAt(text, pos) {
    const openRe = /\{\{c(\d+)::/g;
    let candidates = [];
    // Collect openers up to the cursor position by openStart (not textStart)
    for (let m; (m = openRe.exec(text)); ) {
      const openStart = m.index;
      const textStart = openRe.lastIndex; // just after '::'
      if (openStart > pos) break; // any further opener starts after cursor
      candidates.push({ openStart, textStart });
    }
    // Test candidates from inner to outer
    for (let i = candidates.length - 1; i >= 0; i--) {
      const { openStart, textStart } = candidates[i];
      let depth = 1;
      let hintStart = null;
      for (let j = textStart; j < text.length; j++) {
        // Detect nested openers {{c<digits>::...
        if (text.startsWith("{{c", j)) {
          const mm = text.slice(j).match(/^\{\{c\d+::/);
          if (mm) {
            depth++;
            j += mm[0].length - 1;
            continue;
          }
        }
        // Detect top-level hint separator :: at depth 1
        if (depth === 1 && text.startsWith("::", j)) {
          if (hintStart === null) {
            hintStart = j;
          }
          j++; // skip second ':'
          continue;
        }
        // Detect closers }}
        if (text.startsWith("}}", j)) {
          depth--;
          if (depth === 0) {
            const closeEnd = j + 2;
            // Treat positions inside opener (openStart..textStart) as inside this cloze
            const contains = pos >= openStart && pos <= closeEnd;
            if (contains) {
              const textEnd = hintStart !== null ? hintStart : j;
              return { openStart, textStart, textEnd, closeEnd };
            } else {
              break; // cursor not inside this candidate
            }
          }
          j++; // skip second '}'
        }
      }
    }
    return null;
  }

  function removeClozeAtCursor() {
    const root = getActiveRoot();
    const editable = getEditableDiv(root);
    if (!editable) return;

    if (editable.focus) editable.focus();

    const sel = root.getSelection ? root.getSelection() : document.getSelection();
    if (!sel || sel.rangeCount === 0) return;

    // Collapse selection to start to avoid deleting parent cloze when nested
    let range = sel.getRangeAt(0);
    if (!range.collapsed) {
      const tmp = range.cloneRange();
      tmp.collapse(true);
      sel.removeAllRanges();
      sel.addRange(tmp);
      range = tmp;
    }

    const pos = getCursorIndexInText(editable, sel);
    if (pos < 0) return;

    const text = editable.textContent;
    const bounds = findInnermostClozeAt(text, pos);
    if (!bounds) return;

    const replaced = replaceClozeByBounds(root, editable, bounds);
    if (!replaced) return;

    // Notify Anki
    notifyInput(editable);
  }

  function removeClozesInSelection() {
    const root = getActiveRoot();
    const editable = getEditableDiv(root);
    if (!editable) return;

    if (editable.focus) editable.focus();

    const sel = root.getSelection ? root.getSelection() : document.getSelection();
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

    if (!findAllClozeRanges(tmpDiv.textContent || "").length) {
      // No clozes fully inside the selection; fall back to cursor-based removal.
      removeClozeAtCursor();
      return;
    }

    const replaced = removeAllClozesFromContainer(tmpDiv);
    if (!replaced) return;

    const replacementHTML = tmpDiv.innerHTML;
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

  interceptWindowFunction("setClozeFields", function (fields) {
    editorClozeFields = Array.isArray(fields) ? fields.map(Boolean) : null;
  });

  // Public API expected by the add-on’s Python side and hotkey
  window.removeClozes = function () {
    removeClozesInSelection();
  };

  installPasteHandlerIfNeeded();
  installReviewShortcutIfNeeded();
})();
