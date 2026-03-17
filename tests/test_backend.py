import importlib.util
import sys
import types
import unittest
from pathlib import Path


def load_backend_module():
    aqt = types.ModuleType("aqt")
    editor_mod = types.ModuleType("aqt.editor")

    class Editor:
        pass

    editor_mod.Editor = Editor
    sys.modules["aqt"] = aqt
    sys.modules["aqt.editor"] = editor_mod

    module_path = Path(__file__).resolve().parents[1] / "addon" / "backend.py"
    spec = importlib.util.spec_from_file_location("backend_module_under_test", module_path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class FakeWeb:
    def __init__(self):
        self.eval_calls = []
        self.eval_with_callback_calls = []
        self.callback_result = None

    def eval(self, js):
        self.eval_calls.append(js)

    def evalWithCallback(self, js, cb):
        self.eval_with_callback_calls.append(js)
        if cb is not None:
            cb(self.callback_result)


class FakeNote:
    def __init__(self, fields):
        self.fields = list(fields)


class FakeEditor:
    def __init__(self, fields, add_mode=False):
        self.web = FakeWeb()
        self.note = FakeNote(fields)
        self.addMode = add_mode
        self.saved = 0
        self.loaded = 0
        self.save_now_calls = []

    def _save_current_note(self):
        self.saved += 1

    def loadNoteKeepingFocus(self):
        self.loaded += 1

    def saveNow(self, callback, keepFocus=False):
        self.save_now_calls.append(keepFocus)
        callback()


class BackendTests(unittest.TestCase):
    def setUp(self):
        self.backend = load_backend_module()

    def test_apply_backend_selection_collapsed_fallback(self):
        editor = FakeEditor(["a"])
        self.backend.apply_backend_result(
            editor, {"changed": False, "reason": "selection-collapsed"}
        )
        self.assertTrue(any("removeClozes()" in call for call in editor.web.eval_calls))

    def test_apply_backend_textarea(self):
        editor = FakeEditor(["a"])
        self.backend.apply_backend_result(
            editor, {"changed": True, "kind": "textarea", "text": "abc"}
        )
        self.assertTrue(
            any("applyRemoveClozesTextarea" in call for call in editor.web.eval_calls)
        )
        self.assertEqual(editor.note.fields, ["a"])
        self.assertEqual(editor.saved, 0)

    def test_apply_backend_field_update(self):
        editor = FakeEditor(["one", "two"])
        self.backend.apply_backend_result(
            editor, {"changed": True, "fieldIndex": 1, "html": "<b>x</b>"}
        )
        self.assertEqual(editor.note.fields[1], "<b>x</b>")
        self.assertEqual(editor.saved, 1)
        self.assertEqual(editor.loaded, 1)

    def test_apply_backend_add_mode_does_not_save(self):
        editor = FakeEditor(["one", "two"], add_mode=True)
        self.backend.apply_backend_result(
            editor, {"changed": True, "fieldIndex": 0, "html": "<i>y</i>"}
        )
        self.assertEqual(editor.note.fields[0], "<i>y</i>")
        self.assertEqual(editor.saved, 0)
        self.assertEqual(editor.loaded, 1)

    def test_apply_backend_invalid_payload(self):
        editor = FakeEditor(["one"])
        self.backend.apply_backend_result(editor, {"changed": True, "fieldIndex": 9, "html": "x"})
        self.assertEqual(editor.note.fields[0], "one")
        self.assertEqual(editor.saved, 0)
        self.assertEqual(editor.loaded, 0)

    def test_remove_clozes_backend_calls_save_now(self):
        editor = FakeEditor(["one"])
        editor.web.callback_result = {"changed": False}
        self.backend.remove_clozes_backend(editor)
        self.assertEqual(editor.save_now_calls, [True])
        self.assertTrue(
            any("removeClozesBackend" in call for call in editor.web.eval_with_callback_calls)
        )


if __name__ == "__main__":
    unittest.main()
