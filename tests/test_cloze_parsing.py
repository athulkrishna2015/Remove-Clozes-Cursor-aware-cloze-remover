import importlib.util
import sys
import types
import unittest
from pathlib import Path

def load_addon_module(config: dict | None = None):
    aqt = types.ModuleType("aqt")
    qt = types.ModuleType("aqt.qt")
    utils = types.ModuleType("aqt.utils")
    gui_hooks = types.ModuleType("aqt.gui_hooks")

    # Mock Editor
    editor = types.ModuleType("aqt.editor")
    class Editor:
        pass
    editor.Editor = Editor
    sys.modules["aqt.editor"] = editor

    # Mock Reviewer
    reviewer = types.ModuleType("aqt.reviewer")
    class Reviewer:
        pass
    reviewer.Reviewer = Reviewer
    sys.modules["aqt.reviewer"] = reviewer

    # Mock Browser/Previewer
    browser = types.ModuleType("aqt.browser")
    previewer = types.ModuleType("aqt.browser.previewer")
    class MultiCardPreviewer:
        pass
    previewer.MultiCardPreviewer = MultiCardPreviewer
    sys.modules["aqt.browser"] = browser
    sys.modules["aqt.browser.previewer"] = previewer

    class DummyAction:
        def __init__(self, *args, **kwargs):
            pass

    class DummyAddonManager:
        def __init__(self, cfg):
            self._cfg = cfg

        def getConfig(self, _name):
            return self._cfg

        def setConfigAction(self, _name, _callback):
            return None

        def writeConfig(self, _name, cfg):
            self._cfg = cfg
            
        def setWebExports(self, *args, **kwargs):
            pass

    qt.QAction = DummyAction
    utils.tooltip = lambda *_args, **_kwargs: None
    gui_hooks.editor_did_init_buttons = []
    gui_hooks.webview_will_set_content = []
    aqt.mw = types.SimpleNamespace(addonManager=DummyAddonManager(config or {}))

    sys.modules["aqt"] = aqt
    sys.modules["aqt.qt"] = qt
    sys.modules["aqt.utils"] = utils
    sys.modules["aqt.gui_hooks"] = gui_hooks

    module_path = Path(__file__).resolve().parents[1] / "addon" / "__init__.py"
    module_name = "addon_module_under_test"
    spec = importlib.util.spec_from_file_location(
        module_name, module_path, submodule_search_locations=[str(module_path.parent)]
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    assert spec.loader is not None
    # Mock .config import since it might fail in test env
    sys.modules[f"{module_name}.config"] = types.ModuleType("config")
    sys.modules[f"{module_name}.config"].init_config = lambda: None
    
    spec.loader.exec_module(module)
    return module

class ClozeParsingTests(unittest.TestCase):
    def test_module_loads(self):
        mod = load_addon_module()
        self.assertIsNotNone(mod)
        self.assertEqual(len(sys.modules["aqt.gui_hooks"].editor_did_init_buttons), 1)
        self.assertEqual(len(sys.modules["aqt.gui_hooks"].webview_will_set_content), 1)

    def test_default_hotkey(self):
        mod = load_addon_module()
        self.assertEqual(mod._configured_hotkey(), "Ctrl+Alt+Shift+R")

    def test_custom_hotkey(self):
        mod = load_addon_module({"hotkey": "Ctrl+F10"})
        self.assertEqual(mod._configured_hotkey(), "Ctrl+F10")

if __name__ == "__main__":
    unittest.main()
