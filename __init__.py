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


def _configured_hotkey() -> str:
    default = "Ctrl+Alt+Shift+R"
    config = mw.addonManager.getConfig(__name__) or {}
    hotkey = config.get("hotkey", default)
    if isinstance(hotkey, str) and hotkey.strip():
        return hotkey
    return default


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


def inject_editor_script(web_content: "WebContent", context: Any):
    hotkey = _configured_hotkey()
    should_inject = isinstance(context, Editor)
    if not should_inject and _efdrc_enabled():
        should_inject = isinstance(context, _review_contexts())

    if should_inject:
        web_content.head += (
            f"""<script>window.RemoveClozesHotkey = {json.dumps(hotkey)};</script>"""
            f"""<script src="/_addons/{MODULE_ADDON}/web/editor.js"></script>"""
        )


def remove_clozes(editor: "Editor"):
    """Remove cloze markers and hints from selected text"""
    if not editor.web:
        return
    editor.web.eval("removeClozes();")


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
