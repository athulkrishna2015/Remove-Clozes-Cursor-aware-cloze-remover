from os.path import dirname, join
from aqt import mw
from aqt.qt import *
from aqt.webview import AnkiWebView

def create_support_tab(dialog) -> QWidget:
    tab = QWidget()
    layout = QVBoxLayout()

    scroll = QScrollArea()
    scroll.setWidgetResizable(True)
    content = QWidget()
    content_layout = QVBoxLayout(content)

    # Ko-fi Widget (Embedded Script)
    dialog.support_webview = AnkiWebView(tab)
    dialog.support_webview.setFixedHeight(40)  # Enough for the widget button if not floating, but here it's floating
    # For a floating widget, we need the script in a page. 
    # The widget itself is fixed/absolute positioned by the script.
    kofi_html = f"""
    <html>
    <head>
    <style>
      body {{ background-color: transparent; margin: 0; padding: 0; overflow: hidden; }}
    </style>
    <script type='text/javascript' src='https://storage.ko-fi.com/cdn/widget/Widget_2.js'></script>
    <script type='text/javascript'>
      kofiwidget2.init('Support me on Ko-fi', '#72a4f2', 'D1D01W6NQT');
      kofiwidget2.draw();
    </script>
    </head>
    <body></body>
    </html>
    """
    dialog.support_webview.setHtml(kofi_html)
    layout.addWidget(dialog.support_webview)

    # Donated check box
    dialog.donated_cb = QCheckBox("I have donated")
    dialog.donated_cb.setChecked(dialog.config.get("donated", False))
    content_layout.addWidget(dialog.donated_cb)

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
        copy_btn.clicked.connect(lambda checked, a=address: dialog.copy_to_clipboard(a))
        addr_layout.addWidget(copy_btn)

        group_layout.addLayout(addr_layout)
        group.setLayout(group_layout)
        content_layout.addWidget(group)

    content.setLayout(content_layout)
    scroll.setWidget(content)
    layout.addWidget(scroll)

    tab.setLayout(layout)
    return tab
