"""Produce a bokeh.js variant with the CSS custom-property path removed.

Rewrites ``VisualProperties._get_css_value`` to ``return ""``, which is what a
complete fast path would amount to on a page that defines no ``--bk-*``
variables. Running the harness against the result establishes the floor: the
cost that remains once the CSS lookups are gone entirely.

The output is a measurement aid, not a proposed patch -- it drops the CSS
theming feature rather than gating it.
"""

from __future__ import annotations

import argparse
import pathlib
import shutil

NEEDLE = "_get_css_value(name) {"


def _method_extent(text: str, start: int) -> int:
    """Return the index just past the method body opening at `start`."""
    depth = 0
    for i in range(text.index("{", start), len(text)):
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
            if depth == 0:
                return i + 1
    raise ValueError("unbalanced braces in _get_css_value")


def patch(bundle: pathlib.Path, out_dir: pathlib.Path) -> pathlib.Path:
    text = bundle.read_text()
    if NEEDLE not in text:
        raise SystemExit(f"{NEEDLE!r} not found in {bundle} -- minified or renamed?")

    start = text.index(NEEDLE)
    end = _method_extent(text, start)
    patched = text[:start] + '_get_css_value(name) { return ""; }' + text[end:]

    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / "bokeh.js"
    out.write_text(patched)
    # the harness loads bokeh-api.js from alongside bokeh.js
    shutil.copy(bundle.with_name("bokeh-api.js"), out_dir / "bokeh-api.js")
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bundle", required=True, type=pathlib.Path,
                        help="path to an unminified bokeh.js")
    parser.add_argument("--out-dir", required=True, type=pathlib.Path)
    args = parser.parse_args()
    print(f"wrote {patch(args.bundle, args.out_dir)}")


if __name__ == "__main__":
    main()
