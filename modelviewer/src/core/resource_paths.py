import functools
import ntpath
import os


_MAX_ESCAPE_DEPTH = 1


def _canonical(path):
    return os.path.normcase(os.path.realpath(os.path.abspath(path)))


def _within(target, root):
    try:
        return os.path.commonpath([target, root]) == root
    except ValueError:
        return False


@functools.lru_cache(maxsize=256)
def _dir_entries_ci(dir_path):
    try:
        return {entry.name.lower(): entry.name for entry in os.scandir(dir_path)}
    except OSError:
        return {}


def _resolve_case_insensitive(target_path):
    if os.path.exists(target_path):
        return target_path

    curr = target_path
    missing_parts = []
    while curr and not os.path.exists(curr):
        parent, name = os.path.split(curr)
        if parent == curr or not name:
            break
        missing_parts.append(name)
        curr = parent

    if not os.path.isdir(curr):
        return target_path

    missing_parts.reverse()
    for part in missing_parts:
        entries = _dir_entries_ci(curr)
        match = entries.get(part.lower())
        if match is None:
            return target_path
        curr = os.path.join(curr, match)

    return curr


def safe_resource_path(mod_dir, relative_path):
    if not relative_path:
        return None
    try:
        relative_path = os.fspath(relative_path)
    except TypeError:
        return None
    if not isinstance(relative_path, str):
        return None
    if (os.path.isabs(relative_path)
            or ntpath.isabs(relative_path)
            or os.path.splitdrive(relative_path)[0]
            or ntpath.splitdrive(relative_path)[0]):
        return None
    root_path = os.path.abspath(mod_dir)
    root = _canonical(root_path)
    clean_rel = os.path.normpath(relative_path.replace("\\", "/"))
    target_path = os.path.abspath(os.path.join(root_path, clean_rel))
    target = _canonical(target_path)
    ceiling = root
    if not _within(target, root):
        for _ in range(_MAX_ESCAPE_DEPTH):
            ceiling = os.path.dirname(ceiling)
        if not _within(target, ceiling):
            return None
    resolved = _resolve_case_insensitive(target_path)
    if resolved != target_path:
        resolved_canon = _canonical(resolved)
        if not _within(resolved_canon, ceiling):
            return target_path
    return resolved
