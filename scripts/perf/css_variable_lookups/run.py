"""Measure CSS custom-property lookups performed by bokehjs visual properties.

Every scalar visual property read on ``VisualProperties`` consults the CSS
cascade for a ``--bk-*`` override before falling back to the model value. This
harness counts those lookups and the time spent inside the CSS engine, so the
cost can be compared across bokehjs bundles.

See README.md for usage and measured numbers.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import tempfile

from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).parent

# Must be installed before bokehjs loads, so that every lookup is counted.
INSTRUMENT = r"""
window.__stats = {gcs: 0, gpv: 0, gpv_bk: 0, ms: 0, names: {}};
const _gcs = window.getComputedStyle;
window.getComputedStyle = function(...args) {
  window.__stats.gcs++;
  const t0 = performance.now();
  const decl = _gcs.apply(window, args);
  window.__stats.ms += performance.now() - t0;
  return decl;
};
const _gpv = CSSStyleDeclaration.prototype.getPropertyValue;
CSSStyleDeclaration.prototype.getPropertyValue = function(name) {
  const s = window.__stats;
  s.gpv++;
  if (name.startsWith("--bk-") || name.startsWith("--bokeh-")) {
    s.gpv_bk++;
    s.names[name] = (s.names[name] || 0) + 1;
  }
  const t0 = performance.now();
  const r = _gpv.call(this, name);
  s.ms += performance.now() - t0;
  return r;
};
window.__reset_stats = function() {
  Object.assign(window.__stats, {gcs: 0, gpv: 0, gpv_bk: 0, ms: 0, names: {}});
};
"""

# Drives `frames` steady-state data updates at `hz`, optionally dirtying styles
# each frame, and reports the stats accumulated over the window.
DRIVE = r"""
async ([frames, hz, dirty]) => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const raf = () => new Promise(r => requestAnimationFrame(() => r()));
  window.__reset_stats();
  const t0 = performance.now();
  let busy = 0, longest = 0;
  for (let i = 0; i < frames; i++) {
    const a = performance.now();
    if (dirty) window.__dirty_styles();
    window.__push_frame();
    await raf(); await raf();
    const d = performance.now() - a;
    busy += d;
    if (d > longest) longest = d;
    const rest = (1000 / hz) - d;
    if (rest > 0) await sleep(rest);
  }
  const s = window.__stats;
  return {gcs: s.gcs, gpv: s.gpv, gpv_bk: s.gpv_bk, css_ms: s.ms, names: s.names,
          wall_ms: performance.now() - t0, busy_ms: busy, longest_ms: longest,
          frames};
}
"""


def measure(bundle: pathlib.Path, frames: int, hz: float, dirty: bool,
            settle_ms: int = 3000) -> dict:
    """Load `bundle` in headless Chromium and report CSS-lookup statistics.

    `bundle` is a path to bokeh.js; bokeh-api.js is taken from the same
    directory.
    """
    bundle = bundle.resolve()
    api = bundle.with_name("bokeh-api.js")
    html = (
        (HERE / "page.html")
        .read_text()
        .replace("__BOKEH_JS__", bundle.as_uri())
        .replace("__BOKEH_API_JS__", api.as_uri())
    )

    with tempfile.TemporaryDirectory() as tmp:
        page_file = pathlib.Path(tmp) / "page.html"
        page_file.write_text(html)

        with sync_playwright() as pw:
            browser = pw.chromium.launch(args=["--no-sandbox", "--disable-dev-shm-usage"])
            page = browser.new_page(viewport={"width": 1000, "height": 800})
            errors: list[str] = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.add_init_script(INSTRUMENT)
            page.goto(page_file.as_uri())
            page.wait_for_function("window.__ready === true", timeout=30000)
            page.wait_for_timeout(settle_ms)
            version = page.evaluate("Bokeh.version")
            result = page.evaluate(DRIVE, [frames, hz, dirty])
            browser.close()

    result["bokeh_version"] = version
    result["errors"] = errors[:3]
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bundle", required=True, type=pathlib.Path,
                        help="path to bokeh.js (bokeh-api.js taken from alongside it)")
    parser.add_argument("--frames", type=int, default=20)
    parser.add_argument("--hz", type=float, default=1.0)
    parser.add_argument("--dirty-styles", action="store_true",
                        help="invalidate styles each frame, so getComputedStyle "
                             "cannot be served from the browser's style cache")
    parser.add_argument("--json", action="store_true", help="dump the raw result")
    args = parser.parse_args()

    r = measure(args.bundle, args.frames, args.hz, args.dirty_styles)
    if args.json:
        print(json.dumps(r, indent=2))
        return

    frames = r["frames"]
    print(f"bokeh {r['bokeh_version']}  {frames} frames at {args.hz} Hz"
          f"{' (styles dirtied each frame)' if args.dirty_styles else ''}")
    print(f"  --bk-* lookups     : {r['gpv_bk']} total, {r['gpv_bk'] / frames:.0f}/frame")
    print(f"  distinct names     : {len(r['names'])}")
    print(f"  getComputedStyle   : {r['gcs']}")
    print(f"  ms in CSS engine   : {r['css_ms']:.1f}")
    print(f"  main-thread busy   : {r['busy_ms']:.1f} ms")
    print(f"  share of busy time : {100 * r['css_ms'] / r['busy_ms']:.1f} %")
    if r["errors"]:
        print(f"  page errors        : {r['errors']}")


if __name__ == "__main__":
    main()
