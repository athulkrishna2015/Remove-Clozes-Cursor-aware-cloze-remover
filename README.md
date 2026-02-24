# [Remove Clozes — Cursor‑aware and Selection-based cloze remover ](https://github.com/athulkrishna2015/Remove-Clozes-Cursor-aware-cloze-remover)

[install via anki web](https://ankiweb.net/shared/info/232855722)

A small Anki editor enhancement that removes cloze formatting around the caret or within a selection, correctly handling nested clozes and optional hints while preserving inline formatting and native undo support. 
Pairs well with [Edit Field During Review (Cloze)](https://ankiweb.net/shared/info/385888438) for in-review field editing workflows.

## Features
- Removes all clozes found within a selected block of text.
- Removes only the innermost cloze that contains the caret if no text is selected. 
- Correctly skips over nested clozes to find the matching closing braces for the current cloze. 
- Treats the caret inside the opener `{{cN::` as inside that cloze, not the parent. 
- Drops optional hint/comments (e.g., `::hint`) at the current cloze level. 
- Preserves inline formatting inside the cloze’s main text. 
- Performs a single atomic edit using insertHTML so Ctrl+Z works as expected. 

## Usage
- **Selection**: Select a block of text and use the hotkey to remove all clozes within that selection.
- **Caret**: Place the caret anywhere inside the cloze to remove only that cloze; for nested clozes, the innermost one is removed first. 
- Default hotkey: Ctrl+Alt+Shift+R. 
- Works when the caret is placed on the opener token `{{cN::`, targeting that cloze instead of the parent. 

## Configuration
- The default hotkey can be customized in `config.json`. 
- See `config.md` for the configuration key documentation. 

## Notes on behavior
- Optional hints are recognized only at depth 1 of the currently targeted cloze, so `{{c1::text::hint}}` becomes `text`. 
- Nested clozes are preserved when removing an outer cloze that encloses them if only the caret is used, but are removed if they are part of a larger selection.
- The editor is notified of changes and native undo is supported via a single insertHTML operation. 

## Appropriate Legal Notices (Attribution)
Based on the Anki add‑on Cloze Overlapper by Glutanimate. [Click here to support Glutanimate’s work.](https://glutanimate.com/support-my-work/) 
- “Cloze Overlapper” must link to https://github.com/glutanimate/cloze-overlapper/ per the Additional Terms. 
- The support link must point to https://glutanimate.com/support-my-work/ per the Additional Terms. 

## License
This project is licensed under the GNU Affero General Public License v3, with Additional Terms under Section 7 as included in `LICENSE.txt`; when conveying this work, include the full license text and preserve all notices. 
If you modify and convey this project, mark your changes with a prominent “modified by + date” notice in the modified source files and keep all legal notices and attributions intact. 

## Changelog
### 2026-02-24
- Fixed paragraph/newline loss when removing a cloze at the start of a line.
- Improved undo stability.
- Ignored key-repeat so one hotkey press triggers one removal.
- Added compatibility for cloze-removal hotkey while editing fields during review with [Edit Field During Review (Cloze)](https://ankiweb.net/shared/info/385888438), with safe fallback when that add-on is not installed.
- Reworked selection-based removal to use DOM-preserving cloze unwrapping instead of HTML-string regex replacement.
- Restricted review-screen script injection to active [Edit Field During Review (Cloze)](https://ankiweb.net/shared/info/385888438) environments.
- Tightened editable-element detection to avoid operating on non-editor root containers.

### 2026-02-18
- Added support for removing all clozes within a text selection.

### 2025-11-02
- Implemented cursor‑aware, nested‑safe cloze removal with native undo; opener‑caret targets the correct cloze. 

## Acknowledgments
Original work and licensing by Glutanimate (see header in `web/editor.js`) and `LICENSE.txt` for AGPLv3 + Additional Terms. 
