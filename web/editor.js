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
  function getActiveRoot() {
    const el = document.activeElement;
    if (!el) return document;
    return el.shadowRoot || document;
  }

  function getEditableDiv(root) {
    if (!root) return null;
    return root.querySelector('[contenteditable="true"]') || root;
  }

  function mapIndexToNodeOffset(container, idx) {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
    let node = walker.nextNode();
    let remaining = idx;
    while (node) {
      const len = node.textContent.length;
      if (remaining <= len) {
        return { node, offset: remaining };
      }
      remaining -= len;
      node = walker.nextNode();
    }
    return { node: container, offset: container.childNodes.length };
  }

  function getCursorIndexInText(container, selection) {
    const range = selection.getRangeAt(0);
    const MARK = "\uE000CURSOR\uE001";
    const marker = document.createTextNode(MARK);
    range.insertNode(marker);
    const text = container.textContent;
    const pos = text.indexOf(MARK);
    if (marker.parentNode) {
      marker.parentNode.removeChild(marker);
    }
    return pos;
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

    const { openStart, textStart, textEnd, closeEnd } = bounds;

    // Prepare inner HTML (preserve formatting) and select outer wrapper
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

    // Select outer range and replace using insertHTML for proper undo
    const editSel = root.getSelection ? root.getSelection() : document.getSelection();
    editSel.removeAllRanges();
    editSel.addRange(outerRange);

    const canInsertHTML =
      typeof document.queryCommandSupported === "function"
        ? document.queryCommandSupported("insertHTML")
        : true;

    if (canInsertHTML) {
      document.execCommand("insertHTML", false, innerHTML);
      if (editSel.collapseToEnd) {
        try { editSel.collapseToEnd(); } catch (e) {}
      }
    } else {
      // Fallback (may not integrate with undo)
      outerRange.deleteContents();
      const frag = document.createRange().createContextualFragment(innerHTML);
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

    // Notify Anki
    try {
      editable.dispatchEvent(new InputEvent("input", { bubbles: true }));
    } catch (e) {
      const evt = document.createEvent("Event");
      evt.initEvent("input", true, false);
      editable.dispatchEvent(evt);
    }
  }

  // Public API expected by the add-on’s Python side and hotkey
  window.removeClozes = function () {
    removeClozeAtCursor();
  };
})();
