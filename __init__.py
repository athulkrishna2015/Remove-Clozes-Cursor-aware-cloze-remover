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

from typing import TYPE_CHECKING, Any, List

from aqt import mw
from aqt.editor import Editor
from aqt.gui_hooks import editor_did_init_buttons, webview_will_set_content

if TYPE_CHECKING:
    from aqt.webview import WebContent

MODULE_ADDON = __name__.split(".")[0]


def inject_editor_script(web_content: "WebContent", context: Any):
    if isinstance(context, Editor):
        web_content.head += (
            f"""<script src="/_addons/{MODULE_ADDON}/web/editor.js"></script>"""
        )


def remove_clozes(editor: "Editor"):
    """Remove cloze markers and hints from selected text"""
    if not editor.web:
        return
    editor.web.eval("removeClozes();")


def add_remove_clozes_button(buttons: List[str], editor: "Editor"):
    config = editor.mw.addonManager.getConfig(__name__)
    hotkey = config["hotkey"] if config else "Ctrl+Alt+Shift+R"
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
