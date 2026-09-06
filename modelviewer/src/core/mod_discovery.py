"""Filesystem-only discovery of selected INI files for a mod folder."""

import os
import re

from .ini.sections import parse_sections

_MAX_INI_FILES = 10
_MAX_INI_DEPTH = 2
_DRAW_RE = re.compile(r"^drawindexed\s*=", re.I)
_IB_RE = re.compile(r"^ib\s*=", re.I)


def _ini_names(folder, *, disabled=False):
    try:
        names = os.listdir(folder)
    except OSError:
        return []
    selected = []
    for name in sorted(names):
        is_disabled = name.upper().startswith("DISABLED")
        if is_disabled != disabled or not name.lower().endswith(".ini"):
            continue
        if os.path.isfile(os.path.join(folder, name)):
            selected.append(name)
    return selected


def _has_geometry_sections(path):
    """Return whether an INI looks like a mod root without resolving geometry.

    Discovery must not call the full draw/mesh analyzer.  The root anchor only
    decides whether bounded nested INIs belong to this selection, so a
    conservative command-shape check is sufficient and avoids the old
    ``core.ini.sections -> core.ini.parser`` dependency.  Missing buffers are allowed;
    geometry loading reports those later.
    """
    try:
        sections = parse_sections(path)
    except (OSError, UnicodeError):
        return False
    has_draw = False
    has_index = False
    for name, lines in sections.items():
        if name.lower().startswith("textureoverride"):
            for raw in lines:
                line = str(raw).strip()
                if _DRAW_RE.match(line):
                    has_draw = True
                elif _IB_RE.match(line):
                    has_index = True
        elif name.lower().startswith("commandlist"):
            for raw in lines:
                if _IB_RE.match(str(raw).strip()):
                    has_index = True
    return has_draw or has_index


def discover_ini_paths(mod_dir, *, disabled=False):
    direct = [os.path.join(mod_dir, name)
              for name in _ini_names(mod_dir, disabled=disabled)]
    if not direct and not disabled:
        direct = [os.path.join(mod_dir, name)
                  for name in _ini_names(mod_dir, disabled=True)]

    found = list(direct)
    for base, dirs, _files in os.walk(mod_dir):
        rel = os.path.relpath(base, mod_dir)
        depth = 0 if rel == os.curdir else len(rel.split(os.sep))
        dirs[:] = sorted(dirs) if depth < _MAX_INI_DEPTH else []
        if depth == 0:
            continue
        sub_inis = _ini_names(base, disabled=disabled)
        if not sub_inis and not disabled:
            sub_inis = _ini_names(base, disabled=True)
        for name in sub_inis:
            p = os.path.join(base, name)
            if p not in found:
                found.append(p)
            if len(found) >= _MAX_INI_FILES * 2:
                break
        if len(found) >= _MAX_INI_FILES * 2:
            break

    geom_inis = [p for p in found if _has_geometry_sections(p)]
    if geom_inis:
        non_geom = [p for p in found if p not in geom_inis]
        result = geom_inis + non_geom
        return result[:_MAX_INI_FILES]

    parent_dir = os.path.dirname(os.path.abspath(mod_dir))
    parent_name = os.path.basename(parent_dir).lower()
    if parent_name in ("mods", "dismods"):
        mod_name = os.path.basename(mod_dir)
        mv_dir = os.path.join(os.path.dirname(parent_dir), "modvars", mod_name)
        if os.path.isdir(mv_dir):
            mv_found = discover_ini_paths(mv_dir, disabled=disabled)
            if any(_has_geometry_sections(p) for p in mv_found):
                return mv_found

    return found[:_MAX_INI_FILES]
