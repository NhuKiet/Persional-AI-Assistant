"""Runs one script of a coding session with the variables its earlier
successful runs left behind, then keeps the variables it ends with.

This file runs INSIDE the executor container, passed as `python -c` (see
`_docker_run_argv` in execution.py), so it may use only the standard
library and what Dockerfile.executor installs, and stays ASCII-only for the
command line. The host never unpickles state.pkl; it reads only the
state.json summary written next to it (session_state.py).

A failed run saves nothing, so every debug attempt starts from the same
variables as the first one. A script that ends with sys.exit() also saves
nothing: its globals are gone by the time the exit reaches this runner.
"""
import json
import os
import pickle
import runpy
import sys
import traceback
import types

STATE_DIR = ".king"
STATE_FILE = "state.pkl"
MANIFEST_FILE = "state.json"
MAX_VALUE_BYTES = 50 * 1024 * 1024
MAX_TOTAL_BYTES = 100 * 1024 * 1024
MAX_NAMES = 200
MAX_COLUMNS = 12

try:
    # By value, so functions, lambdas and classes the script defined survive.
    import cloudpickle as pickler
except ImportError:
    pickler = pickle


def load_state(state_dir):
    """The saved variables, or {} on a first run or an unreadable file. One
    value that no longer loads (its library went away) doesn't lose the rest."""
    try:
        with open(os.path.join(state_dir, STATE_FILE), "rb") as handle:
            blobs = pickle.load(handle)
    except Exception:
        return {}
    if not isinstance(blobs, dict):
        return {}
    values = {}
    for name, blob in blobs.items():
        try:
            values[name] = pickle.loads(blob)
        except Exception:
            pass
    return values


def _is_import(value):
    """Modules, and functions or classes that came from another module: the
    next script imports those itself, and listing them is noise."""
    if isinstance(value, types.ModuleType):
        return True
    if isinstance(value, (type, types.FunctionType, types.BuiltinFunctionType)):
        return getattr(value, "__module__", None) != "__main__"
    return False


def _estimated_bytes(value):
    """Size of a big array or table without pickling it, so a value far over
    the limit is skipped before it doubles the container's memory."""
    nbytes = getattr(value, "nbytes", None)
    if isinstance(nbytes, int):
        return nbytes
    usage = getattr(value, "memory_usage", None)
    if callable(usage):
        try:
            total = usage(deep=False)
            return int(total.sum() if hasattr(total, "sum") else total)
        except Exception:
            return 0
    return 0


def describe(value):
    """One line telling the next run's code generator what this value is."""
    kind = type(value).__name__
    if isinstance(value, type):
        return "class"
    if isinstance(value, types.FunctionType):
        return "function"
    shape = getattr(value, "shape", None)
    if shape == ():
        # A numpy scalar, e.g. the int64 that df["col"].sum() returns.
        return (kind + " = " + str(value))[:80]
    if isinstance(shape, tuple) and all(isinstance(n, int) for n in shape):
        text = kind + " " + "x".join(str(n) for n in shape)
        columns = getattr(value, "columns", None)
        if columns is not None:
            names = [str(c) for c in list(columns)[:MAX_COLUMNS]]
            more = ", ..." if len(columns) > MAX_COLUMNS else ""
            text += ", columns: " + ", ".join(names) + more
        else:
            dtype = getattr(value, "dtype", None)
            if dtype is not None:
                text += ", dtype " + str(dtype)
        return text
    if isinstance(value, (bool, int, float, complex)):
        return (kind + " = " + repr(value))[:80]
    if isinstance(value, str):
        return "str (%d chars) = %r" % (len(value), value[:40])
    if isinstance(value, (list, tuple, set, frozenset, dict)):
        return "%s of %d" % (kind, len(value))
    return kind


def collect(namespace):
    """(blobs to save, variables kept, variables skipped with the reason)."""
    blobs, kept, skipped = {}, [], []
    total = 0
    for name, value in namespace.items():
        if name.startswith("_") or _is_import(value):
            continue
        if len(kept) >= MAX_NAMES:
            skipped.append({"name": name, "reason": "too_many"})
            continue
        if _estimated_bytes(value) > MAX_VALUE_BYTES:
            skipped.append({"name": name, "reason": "too_large"})
            continue
        try:
            blob = pickler.dumps(value)
        except Exception:
            skipped.append({"name": name, "reason": "not_picklable"})
            continue
        if len(blob) > MAX_VALUE_BYTES or total + len(blob) > MAX_TOTAL_BYTES:
            skipped.append({"name": name, "reason": "too_large"})
            continue
        total += len(blob)
        blobs[name] = blob
        kept.append({"name": name, "summary": describe(value)})
    return blobs, kept, skipped


def _write_atomic(path, data):
    temporary = path + ".tmp"
    with open(temporary, "wb") as handle:
        handle.write(data)
    os.replace(temporary, path)


def save_state(state_dir, namespace):
    blobs, kept, skipped = collect(namespace)
    os.makedirs(state_dir, exist_ok=True)
    _write_atomic(os.path.join(state_dir, STATE_FILE), pickle.dumps(blobs))
    manifest = {"variables": kept, "skipped": skipped}
    _write_atomic(os.path.join(state_dir, MANIFEST_FILE), json.dumps(manifest).encode("utf-8"))


def _print_script_traceback(error, script):
    """The traceback as if the script had run on its own: frames from this
    runner and runpy would only distract the debug step that reads it."""
    tb = error.__traceback__
    while tb is not None and tb.tb_frame.f_code.co_filename != script:
        tb = tb.tb_next
    traceback.print_exception(type(error), error, tb)


def main():
    script = os.path.abspath(sys.argv[1])
    state_dir = os.path.join(os.path.dirname(script), STATE_DIR)
    sys.argv = [script]
    sys.path[0] = os.path.dirname(script)
    try:
        namespace = runpy.run_path(script, init_globals=load_state(state_dir), run_name="__main__")
    except SystemExit:
        raise
    except BaseException as error:
        _print_script_traceback(error, script)
        sys.exit(1)
    try:
        save_state(state_dir, namespace)
    except Exception as error:
        print("[KiNg] Could not keep variables for the next run: %s" % error, file=sys.stderr)


if __name__ == "__main__":
    main()
