# [Remove Clozes — Cursor‑aware and Selection-based cloze remover ](https://github.com/athulkrishna2015/Remove-Clozes-Cursor-aware-cloze-remover)

[Install via AnkiWeb (Add-on ID 836994508)](https://ankiweb.net/shared/info/836994508)

A powerful Anki editor enhancement that removes cloze formatting around the caret or within a selection. It correctly handles nested clozes, MathJax, and can strip cloze markup from pasted content in non-cloze fields.

## Features
- **Cursor-Aware**: Removes only the innermost cloze enclosing the caret.
- **Selection-Based**: Removes all clozes found within a selected block of text.
- **MathJax Support**: Works inside MathJax elements (e.g., `\({{c1::text}}\)`). Handles complex MathJax with nested braces (`\text{...{...}}`) by using depth-aware parsing.
- **Rendered MathJax Awareness**: Correctly targets clozes even when "MathJax Preview" is enabled. It escapes the Shadow DOM and maps the selection to the underlying TeX source automatically.
- **Nested-Safe**: Correctly handles nested `{{c1::...{{c2::...}}...}}` structures.
- **Case-Insensitive**: Supports both `{{c1::...}}` and `{{C1::...}}`.
- **Paste Strip**: Automatically removes cloze markup when pasting into non-cloze fields.
- **Native Undo**: Uses atomic operations so `Ctrl+Z` works perfectly.
- **Backend Mode**: Choose JavaScript, Python, or Auto (MathJax-only Python) behavior.
- **Configuration UI**: Built-in settings dialog for hotkeys and options.
- **Support Tab**: Integrated support page with QR codes for donations.

## Usage
- **Hotkey**: Default is `Ctrl+Alt+Shift+R`. Customize it in the Add-on Config.
- **Caret**: Place the cursor inside a cloze and press the hotkey to unwrap it.
- **Selection**: Select multiple clozes and press the hotkey to remove all of them at once.
- **MathJax**: Works seamlessly with rendered MathJax in the editor.
- **Paste**: Pasting `{{c1::text}}` into a normal field (without `cloze:`) automatically converts it to `text`.
- **Backend Mode (Auto, default)**: Uses Python only if the selection touches MathJax; otherwise JavaScript.
- **Backend Mode (JavaScript)**: Always use JS (best native undo and cursor preservation).
- **Backend Mode (Python)**: Always use Python (avoids MathJax duplication but no native undo for selections).

## Configuration
Access the configuration via **Tools -> Add-ons -> Remove Clozes -> Config**.
- **General Tab**: Change the hotkey, toggle paste-stripping, toggle MathJax processing, and select Backend Mode (Auto/JavaScript/Python).
- **Support Tab**: View QR codes for UPI, BTC, and ETH to support the developer.

## Support

If you find this add-on useful, please consider supporting its development:

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/D1D01W6NQT)

## Known Issues
- **MathJax `<` / `>` Escaped on Cloze Removal**: When removing clozes from a field that contains MathJax, `<` and `>` characters inside MathJax formulas are replaced with `&lt;` and `&gt;` respectively — even if the MathJax is outside the selected text. This happens because the browser's `innerHTML` serialization HTML-escapes text nodes created from MathJax formulas.
- **MathJax Duplication on Undo**: In some Anki versions, using "Undo" after removing many clozes (e.g., "Select All") can duplicate rendered MathJax. This release strips rendered MathJax HTML from replacement content, but if you still encounter this:
  - Disable "MathJax Preview" from the card editor cog wheel.
  - Or disable "Process clozes inside MathJax elements" from the Add-on Config.
  - Or switch Backend Mode to **Python** or **Auto**.

## Changelog
### 2026-04-01
- **Bug: MathJax `<` / `>` Escaped on Cloze Removal**: Identified issue where `<` and `>` inside MathJax formulas (e.g., `\langle`, `x < y`) are replaced with `&lt;` and `&gt;` when removing clozes, even when the MathJax is outside the selected text.

### 2026-03-17
- **Improved MathJax Support**: Implemented source-aware mapping and depth-tracking parser to handle complex LaTeX formulas with nested braces (`\text{...{...}}`) and multiple clozes per formula.
- **Mitigated MathJax Undo Duplication**: Strips rendered MathJax HTML from replacement content to reduce duplicate renders on Undo.
- **Case-Insensitivity**: Added support for both lowercase `{{c1::` and uppercase `{{C1::` clozes.
- **New Configuration UI**: Added a graphical settings window with General and Support tabs.
- **Project Refactor**: Moved all core files to `addon/` subfolder and improved build scripts.
- **Integrated Support**: Added a Support tab in Config with QR codes and copy buttons for UPI/BTC/ETH.

### 2026-03-07
- Added automatic cloze stripping for pasted content in fields that do not use the `cloze:` filter.
- Made the paste cleanup configurable with `strip_pasted_clozes_in_non_cloze_fields`, enabled by default.

### 2026-02-24
- Fixed paragraph/newline loss when removing a cloze at the start of a line.
- Improved undo stability.
- Added compatibility for [Edit Field During Review (Cloze)](https://ankiweb.net/shared/info/385888438).

## Appropriate Legal Notices (Attribution)
Based on the Anki add‑on Cloze Overlapper by Glutanimate. [Click here to support Glutanimate’s work.](https://glutanimate.com/support-my-work/) 
- “Cloze Overlapper” must link to https://github.com/glutanimate/cloze-overlapper/ per the Additional Terms. 
- The support link must point to https://glutanimate.com/support-my-work/ per the Additional Terms. 

## License
This project is licensed under the GNU Affero General Public License v3, with Additional Terms under Section 7 as included in `LICENSE.txt`.

## Acknowledgments
Original work and licensing by Glutanimate (see header in `addon/web/editor.js`) and `LICENSE.txt`.
