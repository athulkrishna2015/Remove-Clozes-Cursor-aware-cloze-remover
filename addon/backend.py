from __future__ import annotations

import json
from typing import Any

from aqt.editor import Editor
from . import logger


def remove_clozes_backend(editor: Editor) -> None:
    if not editor.web or not editor.note:
        return

    logger.log("Initiating Python backend-driven cloze removal workflow...")

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
            logger.log("Selection is collapsed; falling back to cursor-based JavaScript removal.")
            editor.web.eval("removeClozes();")
        else:
            logger.log("No clozes detected or changed in selection.")
        return

    if result.get("kind") == "textarea":
        text = result.get("text")
        if isinstance(text, str):
            logger.log("Applying safe-mode cloze removal updates to MathJax Editor textarea.")
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
    logger.log(f"Successfully processed backend result and removed clozes from field index {field_index}.")
    if not editor.addMode:
        editor._save_current_note()
    editor.loadNoteKeepingFocus()
