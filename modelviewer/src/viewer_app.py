"""
3DMigoto Mod Viewer - Desktop App
---------------------------------
Native window app: pick any 3DMigoto mod folder and preview all meshes in 3D.
Mesh data is built in-memory (no OBJ/MTL/PNG files written to disk).

Install:  pip install pywebview Pillow
Run:      python viewer_app.py

This module is only the entry point. The application lives in the `app`
package and the user interface in `web/`.
"""

import argparse
import sys

try:
    import webview
except ImportError:
    print("Missing dependency.  Run:  pip install pywebview")
    raise

from app.bridge.api import ModViewerAPI
from app.runtime import server, webview2

__all__ = ["ModViewerAPI", "main", "parse_args"]


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description="WZMM 3D Viewer")
    parser.add_argument(
        "mod_folder",
        nargs="?",
        help="Mod folder to open on startup",
    )
    parser.add_argument(
        "--disabled-ini",
        action="store_true",
        help="Open the startup mod using DISABLED INIs",
    )
    parser.add_argument(
        "--theme",
        default=None,
        help="Active theme name",
    )
    parser.add_argument(
        "--lang",
        default=None,
        help="Active language code",
    )
    return parser.parse_args(argv)


def main(argv=None):
    args = parse_args(argv)
    if not webview2.is_installed():
        webview2.report_missing()
        return 1

    api = ModViewerAPI(
        startup_mod=args.mod_folder,
        startup_disabled_ini=args.disabled_ini,
    )
    window = webview.create_window(
        "WZMM 3D Viewer",
        url=server.start(theme=args.theme, lang=args.lang),
        js_api=api,
        width=1400,
        height=900,
        min_size=(900, 600),
    )
    api._window = window

    def _activate_window():
        try:
            from PyQt6 import QtWidgets
            app = QtWidgets.QApplication.instance()
            if app:
                for widget in app.topLevelWidgets():
                    if isinstance(widget, QtWidgets.QMainWindow):
                        widget.show()
                        widget.raise_()
                        widget.activateWindow()
                        central = widget.centralWidget()
                        if central and hasattr(central, "setFocus"):
                            central.setFocus()
        except Exception:
            pass

    try:
        from PyQt6 import QtCore
        QtCore.QTimer.singleShot(150, _activate_window)
        QtCore.QTimer.singleShot(450, _activate_window)
        QtCore.QTimer.singleShot(900, _activate_window)
    except Exception:
        pass

    webview.start()
    return 0


if __name__ == "__main__":
    sys.exit(main())
