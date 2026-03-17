### `hotkey`

(string): Hotkey used to trigger cloze removal on selected text. Needs to be a valid key sequence. Default: `Ctrl+Alt+Shift+R`

### `strip_pasted_clozes_in_non_cloze_fields`

(boolean): Automatically remove cloze markup from pasted content when the target field does not use the `cloze:` filter. Default: `true`

### `process_clozes_inside_mathjax`

(boolean): When enabled, the add-on attempts to process and remove clozes found inside MathJax formulas. Disabling this can prevent certain rendering artifacts (like duplication on Undo) in some Anki versions. Default: `true`

### `safe_backend_mode`

(boolean): When enabled, cloze removal for selections is handled by Python using the field HTML instead of DOM edits. Collapsed selections fall back to the JS cursor-aware remover. This avoids MathJax preview duplication at the cost of native undo and selection preservation for selections. Default: `false`

---
