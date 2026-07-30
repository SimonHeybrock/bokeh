# CSS custom-property lookups in visual properties

Measurement harness for [bokeh/bokeh#15286](https://github.com/bokeh/bokeh/issues/15286).

Every scalar visual property read on `VisualProperties` consults the CSS cascade
for a `--bk-*` override before falling back to the model value
(`bokehjs/src/lib/core/visuals/visual.ts`). `doit` alone costs three CSS-engine
reads, and it is consulted before every stroke/fill/text operation, per visual,
per layout and paint pass, per frame. On a page that defines no `--bk-*`
variables — the common case — every one of those lookups returns the empty
string.

This harness counts the lookups and the time spent inside the CSS engine, so the
cost can be compared across bundles.

## Contents

| file | purpose |
|---|---|
| `repro.html` | self-contained repro; open in a browser, results print at the top |
| `run.py` | Playwright A/B harness, for comparing local builds |
| `page.html` | the page `run.py` drives |
| `make_floor_bundle.py` | patches `_get_css_value` to `return ""`, to establish the floor |

## Usage

`repro.html` needs nothing but a browser. Edit the two script tags to change
version.

The A/B harness needs `playwright` and a Chromium install:

```sh
python run.py --bundle ../../../bokehjs/build/js/bokeh.js
python run.py --bundle /path/to/other/bokeh.js --dirty-styles
```

`--dirty-styles` invalidates styles every frame, so `getComputedStyle` cannot be
served from the browser's style cache. This emulates a page where something else
is mutating styles continuously; it does not change the lookup count, only the
cost per lookup.

To measure the floor:

```sh
python make_floor_bundle.py --bundle ../../../bokehjs/build/js/bokeh.js --out-dir /tmp/floor
python run.py --bundle /tmp/floor/bokeh.js
```

## Measured

Four figures (line + scatter), steady-state updates at 1 Hz, 20-frame windows,
headless Chromium 140, no `--bk-*` variable defined anywhere in the page.

| bundle | lookups/frame | `getComputedStyle` calls | ms in CSS engine | share of main-thread busy |
|---|---|---|---|---|
| 3.9.1 (released) | 1425 | 29840 | 180.5 | 18.9% |
| `branch-4.0` @ d6699c44a | 670 | 14740 | 35.1 | 4.1% |
| floor (`_get_css_value` → `""`) | 0 | 1340 | 2.7 | 0.4% |

These numbers come from `repro.html`. `page.html`, which `run.py` drives, carries
the style-churn hook and sets explicit glyph colors, so its absolute counts run
somewhat higher (800/frame rather than 670 on `branch-4.0`); compare bundles with
one or the other, not across the two.

Counts are deterministic across runs; timings are not. The 86 distinct property
names span axis, grid, outline, band and border visuals — text, line, hatch and
fill. Glyph rendering is unaffected, since `VisualUniforms` has no CSS path.

d6699c44a ([#15205](https://github.com/bokeh/bokeh/pull/15205)) added a
per-microtask cache, which accounts for the middle row. The residual is
structural: the cache is per-`VisualProperties` instance and released at the
microtask checkpoint, so every render pass re-sweeps every property of every
visual.
