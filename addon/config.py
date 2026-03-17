from os.path import dirname, join
from aqt import mw
from aqt.qt import *
from aqt.utils import showInfo

ADDON_NAME = __name__.split(".")[0]

class ConfigDialog(QDialog):
    def __init__(self, parent):
        super().__init__(parent)
        self.setWindowTitle("Remove Clozes Configuration")
        self.setMinimumSize(450, 550)
        self.config = mw.addonManager.getConfig(ADDON_NAME) or {}

        self.setup_ui()

    def setup_ui(self):
        layout = QVBoxLayout()
        self.tabs = QTabWidget()

        self.tabs.addTab(self.create_general_tab(), "General")
        self.tabs.addTab(self.create_support_tab(), "Support")

        layout.addWidget(self.tabs)

        # Buttons
        button_box = QDialogButtonBox(QDialogButtonBox.StandardButton.Save | QDialogButtonBox.StandardButton.Cancel)
        button_box.accepted.connect(self.save_config)
        button_box.rejected.connect(self.reject)
        layout.addWidget(button_box)

        self.setLayout(layout)

    def create_general_tab(self):
        tab = QWidget()
        layout = QVBoxLayout()

        # Hotkey
        hotkey_layout = QHBoxLayout()
        hotkey_layout.addWidget(QLabel("Hotkey:"))
        self.hotkey_input = QLineEdit(self.config.get("hotkey", "Ctrl+Alt+Shift+R"))
        hotkey_layout.addWidget(self.hotkey_input)
        layout.addLayout(hotkey_layout)

        # Strip pasted clozes
        self.strip_cb = QCheckBox("Strip pasted clozes in non-cloze fields")
        self.strip_cb.setChecked(self.config.get("strip_pasted_clozes_in_non_cloze_fields", True))
        layout.addWidget(self.strip_cb)

        # Process MathJax clozes
        self.mathjax_cb = QCheckBox("Process clozes inside MathJax elements")
        self.mathjax_cb.setChecked(self.config.get("process_clozes_inside_mathjax", True))
        layout.addWidget(self.mathjax_cb)

        layout.addStretch()
        tab.setLayout(layout)
        return tab

    def create_support_tab(self):
        tab = QWidget()
        layout = QVBoxLayout()

        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        content = QWidget()
        content_layout = QVBoxLayout(content)

        # Support data
        support_items = [
            ("UPI", "athulkrishnasv2015-2@okhdfcbank", "UPI.jpg"),
            ("Bitcoin (BTC)", "bc1qrrek3m7sr33qujjrktj949wav6mehdsk057cfx", "BTC.jpg"),
            ("Ethereum (ETH)", "0xce6899e4903EcB08bE5Be65E44549fadC3F45D27", "ETH.jpg"),
        ]

        for title, address, img_file in support_items:
            group = QGroupBox(title)
            group_layout = QVBoxLayout()

            # QR Code
            qr_label = QLabel()
            img_path = join(dirname(__file__), "Support", img_file)
            pixmap = QPixmap(img_path)
            if not pixmap.isNull():
                qr_label.setPixmap(pixmap.scaled(250, 250, Qt.AspectRatioMode.KeepAspectRatio, Qt.TransformationMode.SmoothTransformation))
                qr_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
            else:
                qr_label.setText("QR Code not found")
            group_layout.addWidget(qr_label)

            # Address + Copy
            addr_layout = QHBoxLayout()
            addr_edit = QLineEdit(address)
            addr_edit.setReadOnly(True)
            addr_layout.addWidget(addr_edit)

            copy_btn = QPushButton("Copy")
            copy_btn.clicked.connect(lambda checked, a=address: self.copy_to_clipboard(a))
            addr_layout.addWidget(copy_btn)

            group_layout.addLayout(addr_layout)
            group.setLayout(group_layout)
            content_layout.addWidget(group)

        content.setLayout(content_layout)
        scroll.setWidget(content)
        layout.addWidget(scroll)

        tab.setLayout(layout)
        return tab

    def copy_to_clipboard(self, text):
        mw.app.clipboard().setText(text)
        showInfo(f"Copied: {text}", parent=self)

    def save_config(self):
        self.config["hotkey"] = self.hotkey_input.text()
        self.config["strip_pasted_clozes_in_non_cloze_fields"] = self.strip_cb.isChecked()
        self.config["process_clozes_inside_mathjax"] = self.mathjax_cb.isChecked()
        mw.addonManager.writeConfig(ADDON_NAME, self.config)
        self.accept()

def on_config():
    ConfigDialog(mw).exec()

def init_config():
    mw.addonManager.setConfigAction(ADDON_NAME, on_config)
