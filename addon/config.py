from pathlib import Path
from aqt import mw
from aqt.qt import *
from aqt.utils import showInfo
from aqt.gui_hooks import profile_did_open

from .config_general import create_general_tab
from .tab_support import create_support_tab
from . import logger

ADDON_NAME = __name__.split(".")[0]

class ConfigDialog(QDialog):
    def __init__(self, parent):
        super().__init__(parent)
        self.setWindowTitle("Remove Clozes Configuration")
        self.setMinimumSize(450, 550)
        self.config = mw.addonManager.getConfig(ADDON_NAME) or {}
        
        logger.log("Configuration dialog opened.")
        self.setup_ui()

    def setup_ui(self):
        layout = QVBoxLayout()
        self.tabs = QTabWidget()

        self.tabs.addTab(create_general_tab(self), "General")
        self.tabs.addTab(create_support_tab(self), "Support")
        self.tabs.addTab(self.create_logs_tab(), "Logs")

        layout.addWidget(self.tabs)

        # Buttons
        button_box = QDialogButtonBox(QDialogButtonBox.StandardButton.Save | QDialogButtonBox.StandardButton.Cancel)
        button_box.accepted.connect(self.save_config)
        button_box.rejected.connect(self.reject)
        layout.addWidget(button_box)

        self.setLayout(layout)

    def create_logs_tab(self) -> QWidget:
        tab = QWidget()
        layout = QVBoxLayout()

        self.log_viewer = QPlainTextEdit()
        self.log_viewer.setReadOnly(True)
        self.log_viewer.setPlainText("\n".join(logger.get_logs()))
        self.log_viewer.moveCursor(QTextCursor.MoveOperation.End)

        layout.addWidget(self.log_viewer)
        tab.setLayout(layout)

        logger.add_listener(self.on_log_added)
        return tab

    def on_log_added(self, formatted_message: str):
        self.log_viewer.appendPlainText(formatted_message)
        self.log_viewer.moveCursor(QTextCursor.MoveOperation.End)

    def accept(self):
        logger.remove_listener(self.on_log_added)
        super().accept()

    def reject(self):
        logger.remove_listener(self.on_log_added)
        super().reject()

    def copy_to_clipboard(self, text):
        mw.app.clipboard().setText(text)
        showInfo(f"Copied: {text}", parent=self)
        logger.log(f"Copied address to clipboard: {text}")

    def save_config(self):
        self.config["hotkey"] = self.hotkey_input.text()
        self.config["strip_pasted_clozes_in_non_cloze_fields"] = self.strip_cb.isChecked()
        self.config["process_clozes_inside_mathjax"] = self.mathjax_cb.isChecked()
        self.config["backend_mode"] = self.backend_mode_combo.currentData()
        self.config["donated"] = self.donated_cb.isChecked()
        self.config.pop("safe_backend_mode", None)
        self.config.pop("safe_backend_auto_mode", None)
        mw.addonManager.writeConfig(ADDON_NAME, self.config)
        logger.log("Configuration saved successfully.")
        self.accept()

    def _normalized_backend_mode(self) -> str:
        mode = self.config.get("backend_mode")
        if isinstance(mode, str) and mode in {"auto", "javascript", "python"}:
            return mode

        legacy_safe = self.config.get("safe_backend_mode", False)
        legacy_auto = self.config.get("safe_backend_auto_mode", True)
        if isinstance(legacy_safe, bool) and legacy_safe:
            if isinstance(legacy_auto, bool) and legacy_auto:
                return "auto"
            return "python"
        return "javascript"

def get_current_version() -> str:
    try:
        version_path = Path(__file__).parent / "VERSION"
        return version_path.read_text(encoding="utf-8").strip()
    except Exception:
        return "2.8.0"

def auto_open_support_on_update():
    config = mw.addonManager.getConfig(ADDON_NAME) or {}
    current_version = get_current_version()
    last_version = config.get("last_version", "")
    donated = config.get("donated", False)

    if last_version != current_version:
        config["last_version"] = current_version
        mw.addonManager.writeConfig(ADDON_NAME, config)
        
        if not donated:
            logger.log(f"First startup on v{current_version}. Opening Support tab.")
            dialog = ConfigDialog(mw)
            dialog.tabs.setCurrentIndex(1)  # Index 1 is Support tab
            dialog.exec()
        else:
            logger.log(f"First startup on v{current_version}. Support tab skipped since 'I have donated' is checked.")

def on_profile_did_open():
    QTimer.singleShot(2000, auto_open_support_on_update)

def on_config():
    ConfigDialog(mw).exec()

def init_config():
    mw.addonManager.setConfigAction(ADDON_NAME, on_config)
    profile_did_open.append(on_profile_did_open)
