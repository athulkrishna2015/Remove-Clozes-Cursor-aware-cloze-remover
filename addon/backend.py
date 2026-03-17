from __future__ import annotations

import json
from typing import Any

from aqt.editor import Editor


def remove_clozes_backend(editor: Editor) -> None:
    if not editor.web or not editor.note:
        return

    def after_saved() -> None:
        if not editor.web:
            return

        editor.web.evalWithCallback(
            "window.removeClozesBackend && window.removeClozesBackend();",
            lambda result: apply_backend_result(editor, result),
        )

    editor.saveNow(after_saved, keepFocus=True)


def apply_backend_result(editor: Editor, result: Any) -> None:
    if not editor.web or not editor.note:
        return
    if not isinstance(result, dict):
        return

    if not result.get("changed"):
        if result.get("reason") == "selection-collapsed":
            editor.web.eval("removeClozes();")
        return

    if result.get("kind") == "textarea":
        text = result.get("text")
        if isinstance(text, str):
            editor.web.eval(
                f"window.applyRemoveClozesTextarea({json.dumps(text)});"
            )
        return

    field_index = result.get("fieldIndex")
    html = result.get("html")
    if not isinstance(field_index, int) or not isinstance(html, str):
        return

    if field_index < 0 or field_index >= len(editor.note.fields):
        return

    editor.note.fields[field_index] = html
    if not editor.addMode:
        editor._save_current_note()
    editor.loadNoteKeepingFocus()
