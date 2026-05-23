from aqt.qt import *

def create_general_tab(dialog) -> QWidget:
    tab = QWidget()
    layout = QVBoxLayout()
    backend_mode = dialog._normalized_backend_mode()

    # Hotkey
    hotkey_layout = QHBoxLayout()
    hotkey_layout.addWidget(QLabel("Hotkey:"))
    dialog.hotkey_input = QLineEdit(dialog.config.get("hotkey", "Ctrl+Alt+Shift+R"))
    hotkey_layout.addWidget(dialog.hotkey_input)
    layout.addLayout(hotkey_layout)

    # Strip pasted clozes
    dialog.strip_cb = QCheckBox("Strip pasted clozes in non-cloze fields")
    dialog.strip_cb.setChecked(dialog.config.get("strip_pasted_clozes_in_non_cloze_fields", True))
    layout.addWidget(dialog.strip_cb)

    # Process MathJax clozes
    dialog.mathjax_cb = QCheckBox("Process clozes inside MathJax elements")
    dialog.mathjax_cb.setChecked(dialog.config.get("process_clozes_inside_mathjax", True))
    layout.addWidget(dialog.mathjax_cb)

    # Backend mode
    backend_layout = QHBoxLayout()
    backend_layout.addWidget(QLabel("Backend mode:"))
    dialog.backend_mode_combo = QComboBox()
    dialog.backend_mode_combo.addItem("Auto (MathJax selections only)", "auto")
    dialog.backend_mode_combo.addItem("JavaScript (native undo)", "javascript")
    dialog.backend_mode_combo.addItem("Python (safe backend)", "python")
    dialog.backend_mode_combo.setCurrentIndex(
        max(0, dialog.backend_mode_combo.findData(backend_mode))
    )
    backend_layout.addWidget(dialog.backend_mode_combo)
    layout.addLayout(backend_layout)

    layout.addStretch()
    tab.setLayout(layout)
    return tab
