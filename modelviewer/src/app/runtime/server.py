"""Localhost HTTP server for the web UI.

The UI is loaded into WebView2 over http://127.0.0.1:<port> rather than
pushed in as an HTML string -- NavigateToString gives the document an opaque
origin, which blocks relative `<script src>` and ES-module imports, and caps
the content at ~2 MB (Three.js alone exceeds that). Serving over a real
origin lets index.html, the stylesheet and the JS modules be ordinary files.

Two roots are exposed:
    /            the web/ directory (index.html, css/, js/)
    /vendor/     the vendored Three.js copy, when build.py has fetched it
    /texture/    opaque URLs for the active load's native DDS or PNG textures

index.html is rendered rather than served verbatim, so the importmap points at
the vendored WebGPU and TSL entry points.
"""

import functools
import base64
import http.server
import os
import sys
import secrets
import socketserver
import shutil
import threading
import uuid
from dataclasses import dataclass

from core.textures.dds import DDSInfo, native_dds_info
from core.textures import (render_texture_png, normalize_texture_role,
                           normalize_texture_transform)
from core.textures.profiles import texture_profile_for
from app.settings import features, paths

THREE_VERSION = "0.185.0"
REPO_URL = "https://github.com/drelymk/mod_viewer"

_VENDOR_PREFIX = "/vendor/"
_GEOMETRY_PREFIX = "/geometry/"
_TEXTURE_PREFIX = "/texture/"
_MAX_GEOMETRY_BYTES = 512 * 1024 * 1024
_TEXTURE_ENCODE_CONCURRENCY = 2
_geometry_lock = threading.RLock()
_geometry_blobs = {}
_texture_lock = threading.RLock()
_texture_publications = {}
_active_texture_publication = None
_texture_encode_semaphore = threading.BoundedSemaphore(
    _TEXTURE_ENCODE_CONCURRENCY)


@dataclass(frozen=True)
class TextureSource:
    """One filesystem source registered in a committed texture publication."""

    path: str
    role: str = "diffuse"
    max_size: int = 2048
    preserve_alpha: bool = False
    transform: str = "passthrough"
    native_dds: bool = False
    dds_info: DDSInfo | None = None


class TexturePublication:
    """Transactional, opaque URL registry for one application model load."""

    def __init__(self, mod_dir=None):
        self.token = uuid.uuid4().hex
        self.mod_dir = (os.path.normcase(os.path.abspath(mod_dir))
                        if mod_dir else None)
        self._sources = {}
        self._dedupe = {}
        self._state = "pending"
        self.game_profile = "unknown"

    def set_game_profile(self, game):
        """Set the default recipe used by later manual texture requests."""
        self.game_profile = texture_profile_for(game).name
        return self.game_profile

    def register(self, path, role=None, max_size=2048, preserve_alpha=False,
                 validate=False, transform=None):
        """Publish a source once and return its opaque same-origin URL.

        The caller has already resolved the path through the core sandbox. The
        registry still requires a real file and never exposes that path in the
        URL, so browser requests can only address sources registered here.
        ``validate=True`` is reserved for explicit manual picks and performs
        one immediate render so corrupt files return an error before they are
        persisted in viewer metadata.
        """
        if not path:
            return None
        path = os.path.abspath(path)
        if not os.path.isfile(path):
            return None
        role = normalize_texture_role(role)
        if transform is None:
            transform = texture_profile_for(self.game_profile).recipe_for(role)
        transform = normalize_texture_transform(transform)
        try:
            max_size = int(max_size)
        except (TypeError, ValueError):
            return None
        if max_size <= 0:
            return None
        preserve_alpha = bool(preserve_alpha)
        dedupe_key = (os.path.normcase(path), role, max_size, preserve_alpha,
                      transform)
        existing_source = None
        with _texture_lock:
            if (_texture_publications.get(self.token) is not self
                    or self._state == "discarded"):
                return None
            source_id = self._dedupe.get(dedupe_key)
            if source_id is not None:
                existing_source = self._sources[source_id]
                if not validate:
                    return _texture_url(self.token, source_id, existing_source)

        dds_info = native_dds_info(path, max_size, transform)
        source = existing_source or TextureSource(
            path=path, role=role, max_size=max_size,
            preserve_alpha=preserve_alpha, transform=transform,
            dds_info=dds_info, native_dds=dds_info is not None)
        if validate and _render_texture_source(source) is None:
            return None

        with _texture_lock:
            if (_texture_publications.get(self.token) is not self
                    or self._state == "discarded"):
                return None
            source_id = self._dedupe.get(dedupe_key)
            if source_id is None:
                source_id = str(len(self._sources))
                self._dedupe[dedupe_key] = source_id
                self._sources[source_id] = source
            return _texture_url(self.token, source_id, source)

    def commit(self, *, replace=True):
        """Commit a publication, optionally retaining the active one."""
        global _active_texture_publication
        with _texture_lock:
            if self._state == "discarded":
                return False
            if replace:
                _texture_publications.clear()
            _texture_publications[self.token] = self
            if replace:
                _active_texture_publication = self
            self._state = "committed"
            return True

    def release(self):
        """Retire a committed auxiliary publication after session removal."""
        global _active_texture_publication
        with _texture_lock:
            _texture_publications.pop(self.token, None)
            if _active_texture_publication is self:
                _active_texture_publication = None
            self._sources.clear()
            self._dedupe.clear()
            self._state = "discarded"
            return True

    def discard(self):
        """Drop only this unfinished publication, preserving the active one."""
        with _texture_lock:
            if self._state == "committed":
                return False
            _texture_publications.pop(self.token, None)
            self._state = "discarded"
            self._sources.clear()
            self._dedupe.clear()
            return True


def begin_texture_publication(mod_dir=None):
    """Create a pending texture publication without changing the active one."""
    publication = TexturePublication(mod_dir)
    with _texture_lock:
        _texture_publications[publication.token] = publication
    return publication


def active_texture_publication(mod_dir=None):
    """Return the committed publication for ``mod_dir``, if it matches."""
    with _texture_lock:
        publication = _active_texture_publication
        if publication is None:
            return None
        if mod_dir is not None:
            requested = os.path.normcase(os.path.abspath(mod_dir))
            if publication.mod_dir != requested:
                return None
        return publication


def _lookup_texture(token, source_id):
    with _texture_lock:
        publication = _texture_publications.get(token)
        if publication is None:
            return None
        return publication._sources.get(source_id)


def _texture_url(token, source_id, source):
    suffix = ".dds" if source.native_dds else ".png"
    return f"{_TEXTURE_PREFIX}{token}/{source_id}{suffix}"


def _render_texture_source(source):
    """Render one source while bounding concurrent image decode/encoding."""
    with _texture_encode_semaphore:
        return render_texture_png(
            source.path,
            max_size=source.max_size,
            preserve_alpha=source.preserve_alpha,
            texture_role=source.role,
            texture_transform=source.transform,
        )


def _render_texture_request(token, source_id, source):
    """Render a request only if its publication is still active."""
    with _texture_encode_semaphore:
        if _lookup_texture(token, source_id) is not source:
            return None
        return render_texture_png(
            source.path,
            max_size=source.max_size,
            preserve_alpha=source.preserve_alpha,
            texture_role=source.role,
            texture_transform=source.transform,
        )


def publish_geometry(blob, *, replace=True):
    """Publish packed geometry, optionally retaining prior load blobs."""
    if len(blob) > _MAX_GEOMETRY_BYTES:
        raise ValueError("Generated geometry exceeds the 512 MiB safety limit.")
    token = uuid.uuid4().hex
    with _geometry_lock:
        if replace:
            _geometry_blobs.clear()
        _geometry_blobs[token] = bytes(blob)
    return f"{_GEOMETRY_PREFIX}{token}"


def publish_payload_geometry(payload, geometry=None, *, replace=True):
    """Publish the structured payload's packed geometry and its references.

    Normal loads pass the builder's append-only blob, so no encoded geometry
    string is created or decoded.  The structured mesh map also supports a
    base64-to-blob fallback for tests that deliberately exercise the direct
    builder form.
    """
    meshes = payload.setdefault("meshes", {})
    if geometry is not None:
        blob = (geometry.to_bytes() if hasattr(geometry, "to_bytes")
                else bytes(geometry))
        if blob:
            payload["geometry"] = {
                "url": publish_geometry(blob, replace=replace),
                "length": len(blob),
            }
        else:
            payload["geometry"] = None
        return

    blob = bytearray()
    for _name, entry in meshes.items():
        if not isinstance(entry, dict) or entry.get("error"):
            continue
        for field in ("pos", "uv", "idx", "normal"):
            encoded = entry.get(field)
            if not isinstance(encoded, str):
                continue
            raw = base64.b64decode(encoded)
            offset = len(blob)
            blob.extend(raw)
            entry[field] = {"offset": offset, "length": len(raw)}
        for target in entry.get("shape_targets") or []:
            for field in ("pos", "low_pos"):
                encoded = target.get(field)
                if not isinstance(encoded, str):
                    continue
                raw = base64.b64decode(encoded)
                offset = len(blob)
                blob.extend(raw)
                target[field] = {"offset": offset, "length": len(raw)}
    if blob:
        payload["geometry"] = {
            "url": publish_geometry(blob, replace=replace),
            "length": len(blob),
        }
    else:
        payload["geometry"] = None


def release_texture_publication(publication):
    """Retire one auxiliary texture publication without touching the active one."""
    if publication is None:
        return False
    return publication.release()


def release_geometry(url):
    """Release an unpublished geometry blob by its opaque URL."""
    if not isinstance(url, str) or not url.startswith(_GEOMETRY_PREFIX):
        return False
    token = url[len(_GEOMETRY_PREFIX):]
    if not token or "/" in token:
        return False
    with _geometry_lock:
        return _geometry_blobs.pop(token, None) is not None


class _Handler(http.server.SimpleHTTPRequestHandler):
    """Serves web/ with two extras: a /vendor/ mount and a rendered index.html."""

    vendor_root = ""
    template_vars: dict = {}
    csp_nonce = ""

    def end_headers(self):
        script_src = "'self' 'unsafe-eval'"
        if self.csp_nonce:
            script_src += f" 'nonce-{self.csp_nonce}'"
        self.send_header("Content-Security-Policy",
                         f"default-src 'self'; script-src {script_src}; "
                         "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
                         "font-src 'self' data: https://fonts.gstatic.com; "
                         "img-src 'self' data: blob:; connect-src 'self'; "
                         "object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Frame-Options", "DENY")
        super().end_headers()

    def do_GET(self):
        path = self._request_path()
        if path in ("/", "/index.html"):
            return self._send_index()
        if path.startswith(_GEOMETRY_PREFIX):
            return self._send_geometry(path[len(_GEOMETRY_PREFIX):])
        if path.startswith(_TEXTURE_PREFIX):
            return self._send_texture(path[len(_TEXTURE_PREFIX):])
        return super().do_GET()

    def translate_path(self, path):
        rel = self._request_path()
        if rel.startswith(_VENDOR_PREFIX):
            return self._safe_join(self.vendor_root, rel[len(_VENDOR_PREFIX):])
        return super().translate_path(path)

    def guess_type(self, path):
        # ES modules must be served with a JS MIME type or the browser refuses
        # to execute them.
        if path.endswith(".js"):
            return "text/javascript"
        return super().guess_type(path)

    def log_message(self, *args):
        pass

    # -- helpers ---------------------------------------------------------

    def _request_path(self):
        return self.path.split("?", 1)[0].split("#", 1)[0]

    @staticmethod
    def _safe_join(root, rel):
        """Resolve `rel` under `root`, refusing to escape it via `..`."""
        root = os.path.abspath(root)
        target = os.path.abspath(os.path.join(root, rel.lstrip("/")))
        if target != root and not target.startswith(root + os.sep):
            return root   # traversal attempt -> a directory, which 404s
        return target

    def _send_index(self):
        index = os.path.join(self.directory, "index.html")
        try:
            with open(index, encoding="utf-8") as fh:
                html = fh.read()
        except OSError:
            self.send_error(404, "index.html not found")
            return
        for placeholder, value in self.template_vars.items():
            html = html.replace(placeholder, value)
        body = html.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        # The UI is regenerated per launch; a cached copy across runs would
        # silently serve a stale build.
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _send_geometry(self, token):
        with _geometry_lock:
            blob = _geometry_blobs.pop(token, None)
        if blob is None:
            self.send_error(404, "Geometry load expired")
            return
        self.send_response(200)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Content-Length", str(len(blob)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(blob)

    def _send_texture(self, address):
        """Serve one registered native DDS or PNG fallback."""
        parts = address.split("/")
        if len(parts) != 2 or not all(parts):
            self.send_error(404, "Texture not found")
            return
        token, requested_id = parts
        if requested_id.endswith(".dds"):
            suffix = "dds"
            source_id = requested_id[:-4]
        elif requested_id.endswith(".png"):
            suffix = "png"
            source_id = requested_id[:-4]
        else:
            # Extensionless URLs remain a PNG compatibility path for direct
            # fixtures and older payloads during the transport migration.
            suffix = "png"
            source_id = requested_id
        if not source_id:
            self.send_error(404, "Texture not found")
            return
        source = _lookup_texture(token, source_id)
        if source is None:
            self.send_error(404, "Texture not found")
            return
        if suffix == "dds":
            if not source.native_dds:
                self.send_error(404, "Texture not found")
                return
            return self._send_native_dds(token, source_id, source)
        png = _render_texture_request(token, source_id, source)
        if png is None:
            self.send_error(404, "Texture unavailable")
            return
        self.send_response(200)
        self.send_header("Content-Type", "image/png")
        self.send_header("Content-Length", str(len(png)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(png)

    def _send_native_dds(self, token, source_id, source):
        """Stream the registered DDS without entering the PNG semaphore."""
        try:
            stream = open(source.path, "rb")
            size = os.fstat(stream.fileno()).st_size
        except OSError:
            self.send_error(404, "Texture unavailable")
            return
        try:
            if _lookup_texture(token, source_id) is not source:
                self.send_error(404, "Texture unavailable")
                return
            self.send_response(200)
            self.send_header("Content-Type", "image/vnd-ms.dds")
            self.send_header("Content-Length", str(size))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            shutil.copyfileobj(stream, self.wfile, length=1024 * 1024)
        finally:
            stream.close()


class _ThreadingTCPServer(socketserver.ThreadingTCPServer):
    """Serve independent browser requests without serializing the UI."""

    daemon_threads = True


_I18N = {
    "ru": {
        "title": "WZMM 3D Viewer",
        "no_model_selected": "Модель не выбрана",
        "model_not_loaded": "Модель не загружена",
        "select_mod_hint": "Выберите мод в менеджере модов.",
        "meshes_panel": "Сетки и детали",
        "variations_tab": "Вариации",
        "inspector_tab": "Инспектор",
        "inspector_empty": "Ничего не выбрано",
        "inspector_empty_desc": "Выберите деталь модели для инспекции.",
        "help_controls": "ЛКМ: Вращение · ПКМ: Панорама · Колесо: Зум",
        "cinema_title": "Кинематографичный вид (скрыть интерфейс)",
        "cinema_aria": "Скрыть интерфейс",
        "env_title": "Окружение и свет",
        "env_aria": "Окружение",
        "env_presets_aria": "Пресеты окружения",
        "loading": "Загрузка…",
        "changed": "Изменено",
        "quick_close_title": "Быстрое закрытие (Esc)",
        "quick_close_aria": "Закрыть 3D Viewer",
        "webgpu_title": "WebGPU недоступен",
        "webgpu_detail": "Для этой версии Mod Viewer требуется WebGPU или совместимый бэкенд.",
        "view_gizmo_title": "Потяните для вращения · Нажмите на ось для выравнивания · Колесо: зум",
        "view_gizmo_aria": "Гизмо навигации камеры",
        "tab_meshes": "Сетки",
        "tab_library": "Библиотека",
        "tab_assets": "Ассеты",
        "asset_fill_title": "Добавить исходные компоненты ассета, не затронутые этим модом",
        "asset_fill_aria": "Загрузить недостающие части",
        "reset_visibility_title": "Сбросить видимость сеток",
        "orientation_title": "Ориентация",
        "reset": "Сброс",
        "turn": "Поворот",
        "tilt": "Наклон",
        "reset_view_title": "Сбросить вид",
        "turn_title": "Повернуть модель на 90 градусов",
        "tilt_title": "Наклонить модель на 90 градусов",
        "wire_title": "Каркасный режим: выкл",
        "outline_title": "Силуэтная обводка: выкл",
        "ao_title": "Рассеянное затенение: 0%",
        "bloom_title": "Свечение (Bloom): выкл",
        "glossy_title": "Глянцевые материалы: выкл",
        "toon_title": "Toon тени: выкл",
        "grid_title": "Сетка: вкл",
        "shading_title": "Сглаживание нормалей: вкл",
        "texture_title": "Текстуры: все карты",
        "light_title": "Основной свет: 67%",
        "trackball_title": "Гизмо навигации: вкл",
        "present_title": "Пресеты",
        "more_present_actions": "Дополнительные действия с пресетами",
        "add_present": "Добавить пресет",
        "edit_key_binding": "Изменить клавишу",
        "remove_present_key": "Удалить клавишу пресета",
        "key_toggle_title": "Переключатели",
        "add_toggle": "Добавить переключатель",
        "menu_toggle_title": "Меню мода",
        "key_light_label": "Основной свет",
        "ao_label": "Рассеянное затенение",
        "manage_textures": "Управление текстурами",
        "add_texture": "Добавить текстуру…",
        "close": "Закрыть",
        "cancel": "Отмена",
        "save": "Сохранить",
        "add": "Добавить",
        "browse": "Обзор",
        "type_field": "Тип",
        "folder_field": "Папка",
        "name_field": "Название",
        "folder_path_field": "Путь к папке",
        "key_field": "Клавиша",
        "back_key_field": "Клавиша назад (необязательно)",
        "ini_file_field": "INI-файл",
        "var_name_field": "Имя переменной",
        "values_field": "Значения (через запятую)",
        "default_val_field": "Значение по умолчанию (необязательно)",
        "ini_diagnostics_title": "Диагностика INI",
        "filter_all": "Все",
        "filter_errors": "Ошибки",
        "filter_conditions": "Условия",
        "filter_resources": "Ресурсы",
        "filter_files": "Файлы",
        "ini_editor_title": "Редактор INI",
        "ini_editor_status": "Изменения сохраняются в памяти до экспорта.",
        "save_to_texture_title": "Сохранить в текстуру",
        "open_mod": "Открыть мод",
        "add_mod_folder": "Добавить папку модов",
        "add_asset_folder": "Добавить папку ассетов",
        "ini_contents_label": "Содержимое INI-файла",
        "details_panels_aria": "Панели сведений",
        "viewer_panels_aria": "Панели просмотрщика",
    },
    "en": {
        "title": "WZMM 3D Viewer",
        "no_model_selected": "No model selected",
        "model_not_loaded": "Model not loaded",
        "select_mod_hint": "Select a mod in the mod manager.",
        "meshes_panel": "Meshes & Parts",
        "variations_tab": "Variations",
        "inspector_tab": "Inspector",
        "inspector_empty": "Nothing selected",
        "inspector_empty_desc": "Select a model part to inspect.",
        "help_controls": "LMB: Orbit · RMB: Pan · Wheel: Zoom",
        "cinema_title": "Cinematic view (toggle UI)",
        "cinema_aria": "Toggle UI",
        "env_title": "Environment & Lighting",
        "env_aria": "Environment",
        "env_presets_aria": "Environment presets",
        "loading": "Loading…",
        "changed": "Changed",
        "quick_close_title": "Quick Close (Esc)",
        "quick_close_aria": "Close 3D Viewer",
        "webgpu_title": "WebGPU unavailable",
        "webgpu_detail": "WebGPU is required by this version of Mod Viewer.",
        "view_gizmo_title": "Drag to orbit · Click an axis to snap · Scroll to zoom",
        "view_gizmo_aria": "Camera navigation gizmo",
        "tab_meshes": "Meshes",
        "tab_library": "Library",
        "tab_assets": "Assets",
        "asset_fill_title": "Add original Asset components not handled by this mod.",
        "asset_fill_aria": "Load missing parts",
        "reset_visibility_title": "Reset mesh visibility",
        "orientation_title": "Orientation",
        "reset": "Reset",
        "turn": "Turn",
        "tilt": "Tilt",
        "reset_view_title": "Reset view",
        "turn_title": "Turn model 90 degrees",
        "tilt_title": "Tilt model 90 degrees",
        "wire_title": "Wireframe rendering: off",
        "outline_title": "Silhouette outlines: off",
        "ao_title": "Ambient occlusion: 0%",
        "bloom_title": "Emission bloom: off",
        "glossy_title": "Glossy materials: off",
        "toon_title": "Toon shadows: off",
        "grid_title": "Grid visibility: on",
        "shading_title": "Smooth shading: on",
        "texture_title": "Textures: all maps",
        "light_title": "Key light: 67%",
        "trackball_title": "Toggle navigation gizmo: on",
        "present_title": "Present",
        "more_present_actions": "More PRESENT actions",
        "add_present": "Add PRESENT",
        "edit_key_binding": "Edit key binding",
        "remove_present_key": "Remove PRESENT key",
        "key_toggle_title": "Key Toggle",
        "add_toggle": "Add toggle",
        "menu_toggle_title": "Menu Toggle",
        "key_light_label": "Key light",
        "ao_label": "Ambient occlusion",
        "manage_textures": "Manage Textures",
        "add_texture": "Add texture…",
        "close": "Close",
        "cancel": "Cancel",
        "save": "Save",
        "add": "Add",
        "browse": "Browse",
        "type_field": "Type",
        "folder_field": "Folder",
        "name_field": "Name",
        "folder_path_field": "Folder path",
        "key_field": "Key",
        "back_key_field": "Back key (optional)",
        "ini_file_field": "Ini file",
        "var_name_field": "Variable name",
        "values_field": "Values (comma-separated)",
        "default_val_field": "Default value (optional)",
        "ini_diagnostics_title": "INI Diagnostics",
        "filter_all": "All",
        "filter_errors": "Errors",
        "filter_conditions": "Conditions",
        "filter_resources": "Resources",
        "filter_files": "Files",
        "ini_editor_title": "INI Editor",
        "ini_editor_status": "Changes stay in memory until Export.",
        "save_to_texture_title": "Save to Texture",
        "open_mod": "Open Mod",
        "add_mod_folder": "Add Mod Folder",
        "add_asset_folder": "Add Asset Folder",
        "ini_contents_label": "INI file contents",
        "details_panels_aria": "Details panels",
        "viewer_panels_aria": "Viewer panels",
    },
}


def _resolve_lang(lang=None):
    if not lang:
        lang = os.environ.get("WZMM_LANG")
    if not lang:
        try:
            import json
            home = os.path.expanduser("~")
            cfg_dir = os.path.join(os.environ.get("APPDATA", os.path.join(home, "AppData", "Roaming")), "wzmm") if sys.platform == "win32" else os.path.join(home, ".config", "wzmm")
            sp = os.path.join(cfg_dir, "settings.json")
            if os.path.isfile(sp):
                with open(sp, "r", encoding="utf-8") as f:
                    cfg = json.load(f)
                    lang = cfg.get("language")
        except Exception:
            pass
    if lang not in ("ru", "en"):
        lang = "en"
    return lang


def _resolve_theme(theme=None):
    if not theme:
        theme = os.environ.get("WZMM_THEME")
    if not theme:
        try:
            import json
            home = os.path.expanduser("~")
            cfg_dir = os.path.join(os.environ.get("APPDATA", os.path.join(home, "AppData", "Roaming")), "wzmm") if sys.platform == "win32" else os.path.join(home, ".config", "wzmm")
            sp = os.path.join(cfg_dir, "settings.json")
            if os.path.isfile(sp):
                with open(sp, "r", encoding="utf-8") as f:
                    cfg = json.load(f)
                    theme = cfg.get("theme")
        except Exception:
            pass
    if not theme:
        theme = "amber"

    themes_dir = os.environ.get("WZMM_THEMES_DIR")
    possible_files = []
    if themes_dir:
        possible_files.append(os.path.join(themes_dir, f"{theme}.css"))
    possible_files.extend([
        os.path.abspath(os.path.join(paths.app_root(), "..", "..", "themes", f"{theme}.css")),
        os.path.abspath(os.path.join(paths.app_root(), "..", "themes", f"{theme}.css")),
        os.path.abspath(os.path.join(paths.app_root(), "web", "themes", f"{theme}.css")),
        os.path.abspath(os.path.join(paths.app_root(), "themes", f"{theme}.css")),
    ])

    css = ""
    for tf in possible_files:
        if os.path.isfile(tf):
            try:
                with open(tf, "r", encoding="utf-8") as f:
                    css = f.read()
                if css:
                    break
            except Exception:
                pass
    return theme, css


def start(theme=None, lang=None):
    if not paths.has_vendored_three():
        raise RuntimeError("Vendored Three.js assets are required; run src/build.py to fetch them.")
    csp_nonce = secrets.token_urlsafe(32)
    three_url = f"{_VENDOR_PREFIX}three.webgpu.js"
    tsl_url = f"{_VENDOR_PREFIX}three.tsl.js"
    addons_url = f"{_VENDOR_PREFIX}addons/"

    flags = features.get_features()
    body_classes = []
    if not flags["export"]:
        body_classes.append("feature-export-off")
    if not flags["modify_toggle"]:
        body_classes.append("feature-modify-toggle-off")
    if not flags["open_disabled_mod"]:
        body_classes.append("feature-open-disabled-mod-off")

    theme_name, theme_css = _resolve_theme(theme)
    app_lang = _resolve_lang(lang)
    i18n = _I18N.get(app_lang, _I18N["en"])

    template_vars = {
        "__THREE_URL__": three_url,
        "__THREE_TSL_URL__": tsl_url,
        "__ADDONS_URL__": addons_url,
        "__BODY_CLASS__": " ".join(body_classes),
        "__APP_VERSION__": paths.APP_VERSION,
        "__REPO_URL__": REPO_URL,
        "__CSP_NONCE__": csp_nonce,
        "__THEME_NAME__": theme_name,
        "__THEME_CSS__": theme_css,
        "__LANG__": app_lang,
        "__STR_TITLE__": i18n["title"],
        "__STR_NO_MODEL__": i18n["no_model_selected"],
        "__STR_MODEL_NOT_LOADED__": i18n["model_not_loaded"],
        "__STR_SELECT_MOD_HINT__": i18n["select_mod_hint"],
        "__STR_MESHES_PANEL__": i18n["meshes_panel"],
        "__STR_VARIATIONS_TAB__": i18n["variations_tab"],
        "__STR_INSPECTOR_TAB__": i18n["inspector_tab"],
        "__STR_INSPECTOR_EMPTY__": i18n["inspector_empty"],
        "__STR_INSPECTOR_EMPTY_DESC__": i18n["inspector_empty_desc"],
        "__STR_HELP_CONTROLS__": i18n["help_controls"],
        "__STR_CINEMA_TITLE__": i18n["cinema_title"],
        "__STR_CINEMA_ARIA__": i18n["cinema_aria"],
        "__STR_ENV_TITLE__": i18n["env_title"],
        "__STR_ENV_ARIA__": i18n["env_aria"],
        "__STR_LOADING__": i18n["loading"],
        "__STR_CHANGED__": i18n["changed"],
    }
    for k, v in i18n.items():
        template_vars[f"__STR_{k.upper()}__"] = v

    launch_handler = type(
        "_LaunchHandler", (_Handler,), {
            "vendor_root": paths.vendor_dir(),
            "template_vars": template_vars,
            "csp_nonce": csp_nonce,
        })
    handler = functools.partial(launch_handler, directory=paths.web_dir())

    httpd = _ThreadingTCPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return f"http://127.0.0.1:{httpd.server_address[1]}"
