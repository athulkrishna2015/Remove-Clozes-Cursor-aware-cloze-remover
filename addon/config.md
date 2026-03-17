### `hotkey`

(string): Hotkey used to trigger cloze removal on selected text. Needs to be a valid key sequence. Default: `Ctrl+Alt+Shift+R`

### `strip_pasted_clozes_in_non_cloze_fields`

(boolean): Automatically remove cloze markup from pasted content when the target field does not use the `cloze:` filter. Default: `true`

### `process_clozes_inside_mathjax`

(boolean): When enabled, the add-on attempts to process and remove clozes found inside MathJax formulas. Disabling this can prevent certain rendering artifacts (like duplication on Undo) in some Anki versions. Default: `true`

### `backend_mode`

(string): Controls which backend handles cloze removal.

- `auto` (default): Uses Python only when the current selection touches MathJax, otherwise uses JavaScript.
- `javascript`: Always use JavaScript (best native undo and cursor preservation).
- `python`: Always use Python (avoids MathJax duplication but loses native undo for selections).

Legacy keys `safe_backend_mode` and `safe_backend_auto_mode` are still respected if `backend_mode` is not set.

---
