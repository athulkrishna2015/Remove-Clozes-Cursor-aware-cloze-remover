# -*- coding: utf-8 -*-

# Remove Clozes Add-on for Anki
#
# Copyright (C) 2016-2022  Aristotelis P. <https//glutanimate.com/>
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU Affero General Public License as
# published by the Free Software Foundation, either version 3 of the
# License, or (at your option) any later version, with the additions
# listed at the end of the accompanied license file.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU Affero General Public License for more details.
#
# You should have received a copy of the GNU Affero General Public License
# along with this program.  If not, see <https://www.gnu.org/licenses/>.
#
# NOTE: This program is subject to certain additional terms pursuant to
# Section 7 of the GNU Affero General Public License.  You should have
# received a copy of these additional terms immediately following the
# terms and conditions of the GNU Affero General Public License which
# accompanied this program.
#
# If not, please request a copy through one of the means of contact
# listed here: <https://glutanimate.com/contact/>.
#
# Any modifications to this file must keep this entire header intact.

import json
from pathlib import Path
from typing import TYPE_CHECKING, Any, List, Optional, Tuple

from aqt import mw
from aqt.editor import Editor
from aqt.gui_hooks import editor_did_init_buttons, webview_will_set_content

from .config import init_config
from .backend import (
    apply_backend_result as _apply_backend_result_backend,
    remove_clozes_backend as _remove_clozes_backend_impl,
)
init_config()

try:
    from aqt.reviewer import Reviewer
except ImportError:
    Reviewer = None  # type: ignore

try:
    from aqt.browser.previewer import MultiCardPreviewer
except ImportError:
    MultiCardPreviewer = None  # type: ignore

if TYPE_CHECKING:
    from aqt.webview import WebContent

MODULE_ADDON = __name__.split(".")[0]
EFDRC_ADDON_ID = "385888438"
_EFDRC_ENABLED_CACHE: Optional[bool] = None


def _addon_config() -> dict[str, Any]:
    config = mw.addonManager.getConfig(MODULE_ADDON) or {}
    return config if isinstance(config, dict) else {}


def _configured_hotkey() -> str:
    default = "Ctrl+Alt+Shift+R"
    config = _addon_config()
    hotkey = config.get("hotkey", default)
    if isinstance(hotkey, str) and hotkey.strip():
        return hotkey
    return default


def _configured_bool(key: str, default: bool) -> bool:
    value = _addon_config().get(key, default)
    return value if isinstance(value, bool) else default


def _backend_mode() -> str:
    config = _addon_config()
    mode = config.get("backend_mode")
    if isinstance(mode, str):
        mode = mode.lower()
        if mode in {"auto", "javascript", "python"}:
            return mode

    legacy_safe = config.get("safe_backend_mode", False)
    legacy_auto = config.get("safe_backend_auto_mode", True)
    if isinstance(legacy_safe, bool) and legacy_safe:
        if isinstance(legacy_auto, bool) and legacy_auto:
            return "auto"
        return "python"
    return "javascript"

def _review_contexts() -> Tuple[type, ...]:
    contexts: List[type] = []
    if Reviewer is not None:
        contexts.append(Reviewer)
    if MultiCardPreviewer is not None:
        contexts.append(MultiCardPreviewer)
    return tuple(contexts)


def _efdrc_enabled() -> bool:
    global _EFDRC_ENABLED_CACHE
    if _EFDRC_ENABLED_CACHE is not None:
        return _EFDRC_ENABLED_CACHE

    enabled = False
    try:
        addon_dir = Path(mw.addonManager.addonsFolder()) / EFDRC_ADDON_ID
        if addon_dir.exists():
            meta_path = addon_dir / "meta.json"
            if meta_path.exists():
                meta = json.loads(meta_path.read_text(encoding="utf-8"))
                enabled = not bool(meta.get("disabled", False))
            else:
                enabled = True
    except Exception:
        enabled = False

    _EFDRC_ENABLED_CACHE = enabled
    return enabled


def _review_cloze_field_names(context: Any) -> Optional[List[str]]:
    card = None
    if Reviewer is not None and isinstance(context, Reviewer):
        card = getattr(context, "card", None)
    elif MultiCardPreviewer is not None and isinstance(context, MultiCardPreviewer):
        card_getter = getattr(context, "card", None)
        if callable(card_getter):
            card = card_getter()

    if card is None:
        return None

    try:
        note = card.note()
        note_type = note.note_type()
        if note_type is None:
            return None

        cloze_ords = set(mw.col.models.cloze_fields(note.mid))
        return [
            field["name"]
            for field in note_type["flds"]
            if field.get("ord") in cloze_ords
        ]
    except Exception:
        return None


def inject_editor_script(web_content: "WebContent", context: Any):
    config = {
        "hotkey": _configured_hotkey(),
        "stripPastedClozesInNonClozeFields": _configured_bool(
            "strip_pasted_clozes_in_non_cloze_fields", True
        ),
        "processClozesInsideMathjax": _configured_bool(
            "process_clozes_inside_mathjax", True
        ),
        "backendMode": _backend_mode(),
        "reviewClozeFieldNames": _review_cloze_field_names(context),
    }
    should_inject = isinstance(context, Editor)
    if not should_inject and _efdrc_enabled():
        should_inject = isinstance(context, _review_contexts())

    if should_inject:
        config_json = json.dumps(config)
        web_content.js += f"window.RemoveClozesConfig = {config_json};"
        web_content.head += (
            f"""<script id="remove-clozes-config" type="application/json">{config_json}</script>"""
            f"""<script src="/_addons/{MODULE_ADDON}/web/editor.js"></script>"""
        )


def remove_clozes(editor: "Editor"):
    """Remove cloze markers and hints from selected text"""
    if not editor.web:
        return
    mode = _backend_mode()
    if mode == "javascript":
        editor.web.eval("removeClozes();")
        return
    if mode == "python":
        remove_clozes_backend(editor)
        return

    def on_decision(result: Any) -> None:
        if isinstance(result, dict) and result.get("useBackend"):
            remove_clozes_backend(editor)
        else:
            editor.web.eval("removeClozes();")

    editor.web.evalWithCallback(
        "window.removeClozesShouldUseBackend && window.removeClozesShouldUseBackend();",
        on_decision,
    )


def remove_clozes_backend(editor: "Editor"):
    # Backwards-compatible wrapper for older references.
    _remove_clozes_backend_impl(editor)


def _apply_backend_result(editor: "Editor", result: Any) -> None:
    # Backwards-compatible wrapper for older references.
    _apply_backend_result_backend(editor, result)


def add_remove_clozes_button(buttons: List[str], editor: "Editor"):
    hotkey = _configured_hotkey()
    b = editor.addButton(
        None,
        "RemoveClozes",
        remove_clozes,
        f"Remove clozes in selected text ({hotkey})",
        label="RC",
        keys=hotkey,
    )
    buttons.append(b)
    return buttons


mw.addonManager.setWebExports(__name__, r"web.*")  # type: ignore
editor_did_init_buttons.append(add_remove_clozes_button)  # type: ignore
webview_will_set_content.append(inject_editor_script)
