/* ============================================================================
   SCRIPT.JS — everything the Wind Trend Animator DOES.

   THE BIG PICTURE, explained like you're five years old:

   1. Somewhere there is a big table of numbers. Each ROW is one moment in
      time (like "8pm on Tuesday"). Each COLUMN is one position (like
      "sensor #12"). We call one cell "a value".

   2. The page keeps a clock, `t`, that slides smoothly from the first row
      to the last row and back again, like a video playing. 60 times every
      second, the browser calls our `frame()` function and asks "what do
      things look like right now?" We answer by:
        a. figuring out the numbers for the exact moment `t` (blending
           between the row before and the row after — see `valuesAt`),
        b. drawing a bar for every column at that moment ("Values at this
           time"),
        c. drawing a big colour-coded grid showing EVERY row and column at
           once, so you can see the whole story in one picture ("Whole
           period").

   3. Everything is drawn on <canvas> elements. A canvas is like a blank
      sheet of paper — there are no bars or lines "built in"; we compute
      the exact pixel coordinates and paint rectangles and lines ourselves,
      every single frame. That is why this file has a lot of small maths
      (`PAD.l`, `top`, `bot`, etc.) — that maths is simply "where on the
      paper does this number belong?"

   4. Three extra features live in this file on top of the original app:
        - An axis adjuster, so YOU can type the top/bottom of the left
          axis on the "Values at this time" chart instead of the computer
          always picking it for you.
        - A picker so you can choose which columns to compare on their own
          line chart, underneath the "Whole period" heat map.
        - Colour pickers so you can choose which colour means "big
          positive" and which means "big negative" — and because both
          charts read their colours from the same shared CSS variables,
          changing the picker instantly repaints both charts.
   ========================================================================== */
(function(){

/* $ is just a shorter way to write document.getElementById. Instead of
   typing document.getElementById('play') everywhere, we type $('play'). */
const $ = id => document.getElementById(id);
const root = document.documentElement; // the <html> tag — CSS variables live here
const PAD = {l:96, r:16}; // pixels of empty space we always leave on the Left/Right of a chart, for axis labels

/* Some people ask their operating system to "reduce motion" (for comfort,
   or to save battery, or because animation makes them feel sick). If they
   did, we respect that by starting the animation paused instead of
   auto-playing. */
const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------------------------------------------------------------------
   THE APP'S "STATE" — every box of information the app needs to remember
   between frames. Nothing here is secret; it's just named so the rest of
   the file can say `rows` instead of re-explaining what it is every time.
   --------------------------------------------------------------------- */
let rows = [];      // one entry per time step: {label: "08 Nov 24 16:00", vals: [12.3, -4.5, ...]}
let cols = [];       // which column NUMBERS (0-based, into vals[]) are actually shown (empty/all-zero ones can be hidden)
let n = 0;           // how many rows (time steps) we have
let vmax = 1;         // the biggest absolute value in the data — used to size the default axis and the heat-map colour scale
let t = 0;            // the "clock": a fractional row index, e.g. 3.4 means 40% of the way from row 3 to row 4
let hold = 0;         // a short pause (in seconds) we sit on the last frame before looping back to the start
let playing = !reduce, speed = 1, xname = 'Position', unit = '';
let hoverIdx = -1, curVals = [], lastStep = -1, heatGeom = null;
let C = {}; // a cache of the current theme's CSS colours, refreshed every frame (see readTheme)

/* --- Feature 3: axis adjuster state -----------------------------------
   axisAuto: true = the computer keeps picking the top/bottom of the left
   axis for you (like the original app always did). false = it uses
   whatever numbers you typed into the min/max boxes.
   axisMin/axisMax: the actual numbers currently used to draw the axis. */
let axisAuto = true, axisMin = -1, axisMax = 1;

/* --- Feature 4: "Multiple choice" comparison state ----------------------
   compareMode: false = the app behaves exactly like the original —
   the bar chart animates, clicking a heat-map row jumps the clock there.
   true = the bar chart instead shows one semi-transparent bar layer per
   ROW you've picked, all stacked on the same axes so you can compare
   several moments directly; clicking a heat-map row adds/removes it from
   that comparison instead of jumping the clock, and playback is paused
   and disabled because the chart is busy showing the comparison.
   selectedRows remembers which row numbers (indexes into `rows`) are
   currently picked. A Set can't hold duplicates, so clicking the same row
   twice cleanly adds it then removes it, and — because JavaScript Sets
   remember the ORDER items were added — the first row you pick always
   keeps the first colour, the second row the second colour, and so on,
   no matter what order you click them in. */
let compareMode = false;
let selectedRows = new Set();
/* A fixed list of easy-to-tell-apart colours for the comparison overlay.
   This is deliberately different from --pos/--neg (which mean "big" vs
   "small" value) — here, colour just means "which picked moment is this".
   If you pick more rows than colours, the list simply starts over (see
   the % in compareColor). */
const COMPARE_PALETTE = ['#8e44ad','#16a085','#c0392b','#2980b9','#d35400','#27ae60','#7f8c8d','#e67e22','#2c3e50','#f1c40f'];
function compareColor(orderIndex){ return COMPARE_PALETTE[orderIndex % COMPARE_PALETTE.length]; }

/* readTheme copies the *current* values of our CSS colour variables (the
   ones defined in style.css, like --pos and --neg) into the plain
   JavaScript object C. We do this every frame because those variables can
   change at any time — either automatically (the visitor's OS switches to
   dark mode) or because the visitor just used a colour picker. Reading
   them fresh each frame means the canvas drawings are NEVER out of date. */
function readTheme(){
  const cs = getComputedStyle(root);
  ['--pos','--neg','--ink','--muted','--grid','--panel','--ghost'].forEach(k => C[k] = cs.getPropertyValue(k).trim());
  C.font = cs.getPropertyValue('--sans').trim();
}

/* rgb() turns a colour like "#1f6fb2" into the three numbers [31, 111, 178]
   (red, green, blue, each 0-255). We need this because to FADE between two
   colours (for the heat map) we have to blend their red parts together,
   their green parts together, and their blue parts together — you can't
   blend two colour *names*, only two colour *numbers*. */
function rgb(hex){
  hex = hex.replace('#','');
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join(''); // "abc" -> "aabbcc"
  const v = parseInt(hex, 16); // read the 6 hex digits as one big number
  return [v >> 16 & 255, v >> 8 & 255, v & 255]; // pull the red/green/blue bytes back out
}

/* -----------------------------------------------------------------------
   PARSING: turning pasted spreadsheet text into rows/cols.

   The algorithm, step by step:
     1. Split the pasted text into lines (one line = one row of the table).
     2. For each line, figure out what separates the "time" label from the
        numbers. Spreadsheets usually paste with TAB characters between
        cells, so we look for a tab first. If there's no tab, we try a
        semicolon (some European spreadsheets use that). If there's
        neither, we fall back to: find something that looks like a time
        ("16:00") and treat everything before it as the label, everything
        after as numbers separated by plain spaces.
     3. Turn each remaining piece of text into a real number. Some locales
        write "12,5" instead of "12.5" for twelve-and-a-half, so we swap
        any comma for a dot before asking JavaScript to parse it.
     4. Throw away any line that didn't produce at least one valid number
        (blank lines, headers, typos, etc.) — this keeps bad paste jobs
        from crashing the chart.
   ----------------------------------------------------------------------- */
function parse(text){
  const out = [];
  text.split(/\r?\n/).forEach(line => {
    if (!line.trim()) return; // skip blank lines
    let label, rest;
    if (line.indexOf('\t') >= 0) { const f = line.split('\t'); label = f[0].trim(); rest = f.slice(1); }
    else if (line.indexOf(';') >= 0) { const f = line.split(';'); label = f[0].trim(); rest = f.slice(1); }
    else {
      const m = line.match(/^\s*(.*?\d{1,2}:\d{2}(?::\d{2})?)\s+(.*)$/);
      if (m) { label = m[1]; rest = m[2].split(/\s+/); }
      else { const f = line.trim().split(/\s+/); label = f[0]; rest = f.slice(1); }
    }
    const vals = rest.map(s => s.trim()).filter(s => s !== '').map(s => Number(s.replace(',', '.')));
    if (vals.length && vals.every(v => isFinite(v))) out.push({label, vals});
  });
  return out;
}

/* niceCeil rounds a number UP to a "friendly" round number for an axis —
   the same trick graphing software uses so your axis says "20" and "40"
   instead of "19.83" and "41.07". The algorithm:
     1. Find the power of ten just at-or-below x (e.g. for x=37, that's 10).
     2. Divide x by that power to get a "how far past the last power of
        ten are we" number between 1 and 10 (37/10 = 3.7).
     3. Round that up to the nearest friendly step: 1, 2, 2.5, 4, 5 or 10.
     4. Multiply back by the power of ten (4 * 10 = 40). */
function niceCeil(x){
  const e = Math.pow(10, Math.floor(Math.log10(x)));
  const f = x / e;
  const s = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 4 ? 4 : f <= 5 ? 5 : 10;
  return s * e;
}
/* shortLabel squashes a long timestamp like "08 Nov 24 16:00" down so it
   fits next to a skinny heat-map row without wrapping or overlapping. */
function shortLabel(s){
  const m = s.match(/^(\d{1,2})\s+([A-Za-z]{3,})\s+\d{2,4}\s+(\d{1,2}:\d{2})/);
  return m ? `${m[1]} ${m[2].slice(0,3)} ${m[3]}` : (s.length > 13 ? s.slice(0, 13) : s);
}
function num(v){ const r = Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1); return (v > 0 ? '+' : '') + r; }
function fmt(v){ return num(v) + (unit ? ' ' + unit : ''); }

/* -----------------------------------------------------------------------
   Feature 4 — "Multiple choice" comparison mode.

   setCompareMode(on) is called when you click the "Multiple choice"
   button. It flips every switch that mode needs:
     - remembers the new mode in `compareMode`,
     - relabels/re-styles the button so it's obvious whether it's on,
     - rewrites the instructions above the heat map,
     - pauses the animation and disables the playback controls (Play,
       ◀ ▶, the slider, the speed picker) — turning them back on again if
       you switch comparison off,
     - clears any previous picks, since turning the mode on or off (or
       loading a new dataset) always starts the comparison fresh,
     - refreshes the little legend under the bar chart to match.
   ----------------------------------------------------------------------- */
function setCompareMode(on){
  compareMode = on;
  selectedRows.clear();
  const btn = $('multiBtn');
  btn.classList.toggle('primary', on);
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  btn.textContent = on ? 'Stop comparing' : 'Multiple choice';
  $('heatNote').textContent = on
    ? 'Multiple choice is on: click one or more rows below to compare those moments on the "Values at this time" chart above. Click "Stop comparing" to go back to playback.'
    : 'Rows are times, columns are positions. Stronger colour means a larger value. Click a row to jump to that time.';
  if (on) setPlaying(false);
  setPlaybackControlsEnabled(!on);
  updateProfileLegend();
}
/* While comparing, the bar chart is busy showing the picked moments
   instead of the live animation, so scrubbing time wouldn't do anything
   useful — we disable the whole playback cluster rather than leaving
   controls on screen that quietly do nothing. */
function setPlaybackControlsEnabled(enabled){
  ['play', 'prev', 'next', 'slider', 'speed'].forEach(id => { $(id).disabled = !enabled; });
}

/* toggleRow adds or removes one heat-map row from the comparison, then
   refreshes the legend so it always lists exactly what's currently
   picked (in the same colour order the chart will draw them). */
function toggleRow(r){
  if (selectedRows.has(r)) selectedRows.delete(r); else selectedRows.add(r);
  updateProfileLegend();
}

/* updateProfileLegend rebuilds the little legend under "Values at this
   time" so it always matches what that chart is currently showing:
     - normal mode: the original Positive / Negative / One-step-earlier key,
     - comparison mode with nothing picked yet: a short hint,
     - comparison mode with picks: one swatch + timestamp per picked row,
       using the exact same colours drawProfile()'s comparison branch
       paints its bar layers with. */
function updateProfileLegend(){
  const el = $('profileLegend');
  if (!compareMode) {
    el.innerHTML = `<span><span class="sw" style="background:var(--pos)"></span>Positive</span>`
      + `<span><span class="sw" style="background:var(--neg)"></span>Negative</span>`
      + `<span><span class="dash"></span>One step earlier</span>`;
    return;
  }
  if (!selectedRows.size) {
    el.innerHTML = `<span class="msg">Click one or more rows in "Whole period" below to compare them here.</span>`;
    return;
  }
  el.innerHTML = Array.from(selectedRows).map((r, orderIndex) =>
    `<span><span class="sw" style="background:${compareColor(orderIndex)}"></span>${rows[r].label}</span>`
  ).join('');
}

/* -----------------------------------------------------------------------
   load(): reads whatever text is in the big textarea, parses it, and
   resets every part of the app (axis range, chips, selection) so it
   matches the NEW dataset instead of the old one.
   ----------------------------------------------------------------------- */
function load(){
  const parsed = parse($('raw').value);
  if (parsed.length < 2) { $('msg').textContent = 'Paste at least two rows: a time, then numbers.'; return; }
  const k = Math.max(...parsed.map(r => r.vals.length));
  parsed.forEach(r => { while (r.vals.length < k) r.vals.push(0); }); // pad short rows with 0 so every row has the same width
  const hide = $('hidezero').checked;
  const c = [];
  for (let j = 0; j < k; j++) if (!hide || parsed.some(r => r.vals[j] !== 0)) c.push(j); // keep a column only if some row has a non-zero value (or the "hide" box is unticked)
  if (!c.length) { $('msg').textContent = 'Every value is 0. Untick "Hide columns that are always 0" or paste other data.'; return; }
  rows = parsed; cols = c; n = rows.length;
  let mx = 0;
  rows.forEach(r => cols.forEach(j => { mx = Math.max(mx, Math.abs(r.vals[j])); }));
  vmax = niceCeil(mx || 1);
  xname = $('xname').value.trim() || 'Position';
  unit = $('unit').value.trim();
  const hidden = k - cols.length;
  $('msg').textContent = `Loaded ${n} times and ${k} columns` + (hidden ? ` (${hidden} empty columns hidden)` : '') + '.';
  $('slider').max = n - 1;
  t = 0; hold = 0; lastStep = -1;
  $('lmin').textContent = fmt(-vmax);
  $('lmax').textContent = fmt(vmax);

  /* Feature 3: whenever new data loads, snap the axis boxes back to the
     computer-chosen range, and keep them fresh even while "auto" stays
     ticked (see computeAxisRange, which runs every frame). */
  $('axisMinInput').value = round2(-vmax);
  $('axisMaxInput').value = round2(vmax);

  /* Feature 4: a new dataset has different rows, so any old comparison
     picks (which are just row numbers) no longer point at the right
     moments — leaving comparison mode resets them safely. */
  setCompareMode(false);
}
function round2(v){ return Math.round(v * 100) / 100; }

/* -----------------------------------------------------------------------
   valuesAt(tt): the heart of the animation. Given a fractional time `tt`
   (like 3.4), it returns one number per column describing "what the chart
   should show right now".

   The algorithm ("smoothstep" interpolation):
     1. Split tt into a whole row index `i` (3) and a leftover fraction `f`
        (0.4) — i.e. "40% of the way between row 3 and row 4".
     2. Instead of moving at a constant speed (which looks robotic — a bar
        would jerk to a stop the instant it arrives), we bend that 0-to-1
        fraction through the curve f*f*(3-2f). This S-shaped curve starts
        and ends slower than the middle, so motion eases in and eases out
        — the same trick used in most animation software.
     3. For every column, blend row i's value and row (i+1)'s value using
        that eased fraction: value = a + (b - a) * easedFraction. When
        f=0 we get exactly row i; when f=1 we get exactly row i+1; in
        between we get a smooth blend. */
function valuesAt(tt){
  const i = Math.max(0, Math.min(n - 1, Math.floor(tt)));
  const j = Math.min(n - 1, i + 1);
  let f = Math.max(0, Math.min(1, tt - i));
  f = f * f * (3 - 2 * f); // smoothstep easing curve
  const a = rows[i].vals, b = rows[j].vals;
  return cols.map(c => a[c] + (b[c] - a[c]) * f);
}

/* -----------------------------------------------------------------------
   fit(): makes a <canvas> look crisp on high-resolution ("Retina") screens.

   A canvas has two sizes: its CSS size (how many pixels it takes up on
   your screen) and its internal drawing resolution (how many little dots
   it actually has to draw with). If we only set the CSS size, the canvas
   would use exactly that many dots — which looks blurry on a screen that
   physically has, say, 2 real pixels for every 1 CSS pixel. So:
     1. Ask the browser `window.devicePixelRatio` — "how many real pixels
        per CSS pixel does this screen have?" (usually 1 or 2).
     2. Make the canvas's real drawing surface that many times bigger than
        its CSS size.
     3. Tell the drawing context to SCALE everything we draw by that same
        ratio, so our drawing code can keep using plain, simple CSS-pixel
        coordinates without needing to know or care about the ratio. */
function fit(c, h){
  const d = window.devicePixelRatio || 1;
  const w = c.clientWidth;
  const W = Math.round(w * d), H = Math.round(h * d);
  if (c.width !== W || c.height !== H) { c.width = W; c.height = H; c.style.height = h + 'px'; }
  const ctx = c.getContext('2d');
  ctx.setTransform(d, 0, 0, d, 0, 0);
  return {ctx, w, h};
}

/* xLabels draws the small column-number labels (and the axis name) along
   the bottom of the bar chart and the heat map. `every` decides how many
   labels to SKIP so they don't overlap when there are lots of columns
   squeezed into a narrow chart. */
function xLabels(ctx, w, y, cw){
  const k = cols.length;
  const every = Math.max(1, Math.ceil(k / Math.max(1, (w - PAD.l - PAD.r) / 30)));
  ctx.fillStyle = C['--muted'];
  ctx.font = `12px ${C.font}`;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'center';
  for (let i = 0; i < k; i++) if (i % every === 0) ctx.fillText(String(cols[i] + 1), PAD.l + (i + .5) * cw, y);
  ctx.textAlign = 'right';
  ctx.fillText(xname, PAD.l - 10, y);
}

/* -----------------------------------------------------------------------
   Feature 3 — computeAxisRange(): decides what the TOP and BOTTOM of the
   left axis on "Values at this time" should be, right before we draw it.

   - If "Auto" is ticked, we use the same rule the app always used: a
     range that is symmetric around zero, from -vmax to +vmax, so the
     biggest value in the whole dataset always just fits.
   - If "Auto" is unticked, we trust whatever the visitor typed into the
     two number boxes instead. We only guard against nonsense (an empty
     box, letters, or max <= min) by quietly falling back to something
     sane, so the chart can never divide by zero or draw upside-down.
   ----------------------------------------------------------------------- */
function computeAxisRange(){
  if (axisAuto) {
    axisMin = -vmax; axisMax = vmax;
    $('axisMinInput').value = round2(axisMin);
    $('axisMaxInput').value = round2(axisMax);
    return;
  }
  let lo = parseFloat($('axisMinInput').value);
  let hi = parseFloat($('axisMaxInput').value);
  if (!isFinite(lo)) lo = -vmax;
  if (!isFinite(hi)) hi = vmax;
  if (hi <= lo) hi = lo + 1; // never let the axis collapse to zero height
  axisMin = lo; axisMax = hi;
}

/* -----------------------------------------------------------------------
   drawProfile(): the "Values at this time" chart.

   It draws the axis and gridlines the same way no matter what, then does
   ONE of two things with the bars themselves:
     - normal mode: one bar per column reaching that column's value RIGHT
       NOW, plus a faint dashed line tracing where values were one step
       earlier (so you can see whether things are rising or falling).
     - Feature 4, comparison mode: instead of "now", we loop over every
       row you've picked from the heat map and draw ITS bars too, using
       that row's own comparison colour at partial transparency
       (globalAlpha). Because they're semi-transparent and all anchored to
       the same zero line, overlapping bars blend together instead of
       hiding one another — you can still see a shorter bar poking out
       from behind a taller one, and where two overlap you see a mixed
       colour. This is the "stack them with different colour and opacity"
       idea, done with plain alpha-blended rectangles rather than a
       traditional stacked bar chart (which would add values together).
   ----------------------------------------------------------------------- */
function drawProfile(vals, prev){
  const H = window.innerWidth < 560 ? 240 : 300;
  const {ctx, w, h} = fit($('profile'), H);
  ctx.clearRect(0, 0, w, h);
  const top = 10, bot = h - 30, ph = bot - top, pw = w - PAD.l - PAD.r, k = cols.length, cw = pw / k;

  /* Y(v) is the single most important line in this function: it converts
     a DATA value (like -8.2) into a PIXEL row on screen. It works by
     asking "what fraction of the way from axisMin to axisMax is v?", then
     flipping that fraction upside down (because pixel row 0 is the TOP of
     the canvas, but the smallest axis value belongs at the BOTTOM). */
  const Y = v => top + (1 - (v - axisMin) / (axisMax - axisMin)) * ph;
  const clampY = y => Math.max(top, Math.min(bot, y)); // keep bars/lines from drawing outside the chart when a value is beyond your chosen range

  ctx.font = `12px ${C.font}`;
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  const steps = 4;
  for (let s = 0; s <= steps; s++) {
    const v = axisMin + (axisMax - axisMin) * (s / steps);
    const y = Math.round(Y(v)) + .5; // the +.5 keeps 1px lines crisp instead of blurry between two pixel rows
    ctx.strokeStyle = C['--grid'];
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(w - PAD.r, y); ctx.stroke();
    ctx.fillStyle = C['--muted'];
    ctx.fillText((v > 0 ? '+' : '') + (+v.toFixed(2)), PAD.l - 10, y);
  }
  /* Draw an extra, slightly bolder "zero" line whenever zero actually sits
     inside the chosen range — this is the natural baseline bars grow up
     or down from, so it deserves to stand out from the plain grid. */
  if (axisMin < 0 && axisMax > 0) {
    const y0l = Math.round(Y(0)) + .5;
    ctx.strokeStyle = C['--muted']; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(PAD.l, y0l); ctx.lineTo(w - PAD.r, y0l); ctx.stroke();
  }

  const bw = Math.max(1, cw * .72);
  const y0 = clampY(Y(0)); // bars grow from the zero line (or from the nearest visible edge if 0 is off-screen)

  if (compareMode) {
    /* One alpha-blended bar layer per picked row, oldest pick first so
       later picks paint on top — order only affects which bar's edge is
       "on top" where two are the exact same height, since alpha blending
       itself doesn't care about order. */
    Array.from(selectedRows).forEach((r, orderIndex) => {
      ctx.fillStyle = compareColor(orderIndex);
      for (let i = 0; i < k; i++) {
        const v = rows[r].vals[cols[i]], x = PAD.l + i * cw + (cw - bw) / 2, y1 = clampY(Y(v));
        ctx.globalAlpha = (hoverIdx < 0 || hoverIdx === i ? .62 : .28);
        ctx.fillRect(x, Math.min(y0, y1), bw, Math.max(1, Math.abs(y1 - y0)));
      }
    });
    ctx.globalAlpha = 1;
  } else {
    for (let i = 0; i < k; i++) {
      const v = vals[i], x = PAD.l + i * cw + (cw - bw) / 2, y1 = clampY(Y(v));
      ctx.fillStyle = v >= 0 ? C['--pos'] : C['--neg'];
      ctx.globalAlpha = hoverIdx < 0 || hoverIdx === i ? 1 : .55; // fade out every bar except the one you're hovering
      ctx.fillRect(x, Math.min(y0, y1), bw, Math.max(1, Math.abs(y1 - y0)));
    }
    ctx.globalAlpha = .6;
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = C['--ghost']; ctx.lineWidth = 1.5;
    ctx.beginPath();
    prev.forEach((v, i) => { const x = PAD.l + (i + .5) * cw, y = clampY(Y(v)); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 1;
  }
  xLabels(ctx, w, bot + 8, cw);
}

/* -----------------------------------------------------------------------
   drawHeat(): the "Whole period" colour map — every row (time) and every
   column (position) painted as one coloured rectangle, all at once.

   The colour algorithm for one cell:
     1. Pick the "end colour": var(--pos) if the value is positive/zero,
        var(--neg) if it's negative. This is exactly the palette chosen by
        feature 5's colour pickers.
     2. Work out how INTENSE that colour should be: a = |value| / vmax,
        clamped to at most 1. A value at the very edge of the data's range
        gets full-strength colour (a=1); a value of 0 gets none (a=0).
     3. Raise `a` to the power 0.7 before using it. Raw linear intensity
        makes small-but-real values look almost invisible (because our
        eyes don't perceive colour brightness in a straight line) — the
        power curve boosts the visibility of small values a little so the
        map doesn't look mostly blank.
     4. Blend the panel's own background colour towards the end colour by
        that intensity, channel by channel (red, green, blue separately):
        finalChannel = panelChannel + (endChannel - panelChannel) * a.
        That is a linear interpolation ("lerp"), the standard way to blend
        between two colours by a 0-to-1 amount.
   ----------------------------------------------------------------------- */
function drawHeat(){
  const rh = n > 40 ? Math.max(5, Math.floor(600 / n)) : 16; // shrink row height for long datasets so the whole map still fits
  const top = 2, h = top + n * rh + 28;
  const {ctx, w} = fit($('heat'), h);
  ctx.clearRect(0, 0, w, h);
  const pw = w - PAD.l - PAD.r, k = cols.length, cw = pw / k;
  const P = rgb(C['--pos']), N = rgb(C['--neg']), M = rgb(C['--panel']);
  for (let r = 0; r < n; r++) {
    const vals = rows[r].vals;
    for (let i = 0; i < k; i++) {
      const v = vals[cols[i]];
      const e = v >= 0 ? P : N;
      const a = Math.pow(Math.min(1, Math.abs(v) / vmax), .7);
      ctx.fillStyle = `rgb(${M[0] + (e[0] - M[0]) * a | 0},${M[1] + (e[1] - M[1]) * a | 0},${M[2] + (e[2] - M[2]) * a | 0})`;
      const x0 = Math.floor(PAD.l + i * cw), x1 = Math.floor(PAD.l + (i + 1) * cw);
      ctx.fillRect(x0, top + r * rh, Math.max(1, x1 - x0), rh);
    }
  }
  const cr = Math.round(t);
  const every = Math.max(1, Math.ceil(14 / rh));
  ctx.font = `12px ${C.font}`;
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let r = 0; r < n; r++) {
    if (r !== cr && r % every !== 0) continue;
    if (r !== cr && Math.abs(r - cr) < every) continue;
    ctx.fillStyle = r === cr ? C['--ink'] : C['--muted'];
    ctx.font = (r === cr ? '600 ' : '') + `12px ${C.font}`;
    ctx.fillText(shortLabel(rows[r].label), PAD.l - 10, top + r * rh + rh / 2);
  }
  if (hoverIdx >= 0) {
    ctx.strokeStyle = C['--ink']; ctx.globalAlpha = .45; ctx.lineWidth = 1;
    ctx.strokeRect(Math.floor(PAD.l + hoverIdx * cw) + .5, top + .5, Math.max(1, Math.floor(cw)) - 1, n * rh - 1);
    ctx.globalAlpha = 1;
  }
  if (compareMode) {
    /* Feature 4: outline every picked row in its own comparison colour —
       the same colour drawProfile() paints its bars with and
       updateProfileLegend() shows in the legend — so it's obvious at a
       glance which row on the map corresponds to which layer up above. */
    Array.from(selectedRows).forEach((r, orderIndex) => {
      ctx.strokeStyle = compareColor(orderIndex); ctx.lineWidth = 2;
      ctx.strokeRect(PAD.l - 1 + .5, top + r * rh + .5, pw + 1, rh - 1);
    });
  } else {
    /* Outside comparison mode, outline + arrow the row the animation
       clock is currently on — this has no meaning while comparing, since
       playback is paused and the bar chart isn't showing "now" anymore. */
    ctx.strokeStyle = C['--ink']; ctx.lineWidth = 2;
    ctx.strokeRect(PAD.l - 1, top + cr * rh, pw + 2, rh);
    const yy = top + (t + .5) * rh;
    ctx.fillStyle = C['--ink'];
    ctx.beginPath(); ctx.moveTo(w - PAD.r + 3, yy); ctx.lineTo(w - 2, yy - 5); ctx.lineTo(w - 2, yy + 5); ctx.closePath(); ctx.fill();
  }
  ctx.font = `12px ${C.font}`;
  xLabels(ctx, w, top + n * rh + 8, cw);
  heatGeom = {top, rh, cw};
}

function updateText(){
  const cr = Math.round(t);
  if (cr === lastStep) return;
  lastStep = cr;
  $('clock').textContent = rows[cr].label;
  $('stepno').textContent = `Step ${cr + 1} of ${n}`;
  const v = cols.map(c => rows[cr].vals[c]);
  let hi = 0, lo = 0;
  v.forEach((x, i) => { if (x > v[hi]) hi = i; if (x < v[lo]) lo = i; });
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const parts = [];
  if (v[hi] > 0) parts.push(`Strongest positive <b>${fmt(v[hi])}</b> at ${xname.toLowerCase()} ${cols[hi] + 1}`);
  if (v[lo] < 0) parts.push(`Strongest negative <b>${fmt(v[lo])}</b> at ${xname.toLowerCase()} ${cols[lo] + 1}`);
  parts.push(`Average <b>${fmt(mean)}</b>`);
  $('facts').innerHTML = parts.map(p => `<span>${p}</span>`).join('');
}

/* -----------------------------------------------------------------------
   THE ANIMATION LOOP.

   requestAnimationFrame(frame) asks the browser: "the next time you're
   about to repaint the screen (usually ~60 times a second), please call
   my `frame` function." Inside frame() we:
     1. Work out `dt`, how many seconds passed since the last call (this
        makes the animation speed consistent even if the frame rate
        wobbles — we move the clock by "seconds elapsed × speed", not by
        "one fixed step per frame").
     2. If playing, nudge the clock `t` forward. When it reaches the last
        row, wait briefly (`hold`), then snap back to the start — that's
        the little pause-then-loop you see.
     3. Recompute the interpolated values for "right now" and redraw both
        charts plus the on-screen text.
     4. Ask for another frame, forever — this is how the animation keeps
        going without us writing a manual timer loop. */
let last = performance.now();
function frame(now){
  const dt = Math.min(.05, (now - last) / 1000);
  last = now;
  if (n) {
    readTheme();
    if (playing) {
      if (t >= n - 1) { hold += dt; if (hold > 1.4) { t = 0; hold = 0; } }
      else t = Math.min(n - 1, t + dt * speed);
      $('slider').value = t;
    }
    computeAxisRange();
    curVals = valuesAt(t);
    drawProfile(curVals, valuesAt(Math.max(0, t - 1)));
    drawHeat();
    updateText();
  }
  requestAnimationFrame(frame);
}

function setPlaying(p){ playing = p; $('play').textContent = p ? 'Pause' : 'Play'; }
function jump(step){ setPlaying(false); t = Math.max(0, Math.min(n - 1, step)); $('slider').value = t; }

/* ---- Playback controls -------------------------------------------------- */
$('play').addEventListener('click', () => { if (!playing && t >= n - 1) t = 0; setPlaying(!playing); });
$('prev').addEventListener('click', () => jump(Math.round(t) - 1));
$('next').addEventListener('click', () => jump(Math.round(t) + 1));
$('slider').addEventListener('input', e => { setPlaying(false); t = +e.target.value; });
$('speed').addEventListener('change', e => { speed = +e.target.value; });
$('load').addEventListener('click', () => { load(); });
document.addEventListener('keydown', e => {
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'textarea' || tag === 'input' || tag === 'select') return;
  if (compareMode) return; // playback shortcuts are meaningless while the chart is showing a comparison
  if (e.key === ' ') { e.preventDefault(); $('play').click(); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); jump(Math.round(t) - 1); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); jump(Math.round(t) + 1); }
});

/* ---- Feature 3: axis adjuster wiring ------------------------------------
   The two number boxes are only meant to be edited when "Auto" is OFF —
   we disable them while auto is on, purely so it's visually obvious which
   mode you're in, but their values still get refreshed each frame (see
   computeAxisRange) so if you switch auto off, you start from whatever
   the automatic range currently is instead of an old stale number. */
$('axisAuto').addEventListener('change', e => {
  axisAuto = e.target.checked;
  $('axisMinInput').disabled = axisAuto;
  $('axisMaxInput').disabled = axisAuto;
});
$('axisMinInput').disabled = axisAuto;
$('axisMaxInput').disabled = axisAuto;

/* ---- Feature 4: "Multiple choice" toggle wiring -------------------------
   One button flips compareMode on/off (see setCompareMode above). Which
   row-clicks on the heat map DO — jump the clock, or add/remove a
   comparison pick — is decided later, in the #heat 'click' listener,
   simply by checking compareMode at click time. */
$('multiBtn').addEventListener('click', () => setCompareMode(!compareMode));

/* ---- Feature 5: colour palette pickers ----------------------------------
   These two <input type="color"> boxes are wired straight to the CSS
   variables --pos and --neg on the <html> element. Setting an inline
   style on the root element beats every other CSS rule (including the
   dark-mode media query), so this override "just works" regardless of
   the visitor's OS theme. Every drawing function reads --pos/--neg fresh
   every frame via readTheme(), and the .sw/.grad swatches in the HTML
   read the same variables through plain CSS — so one change here repaints
   the bar chart, the heat map AND every legend swatch at once, with no
   extra plumbing needed. */
function applyPalette(){
  root.style.setProperty('--pos', $('colorMax').value);
  root.style.setProperty('--neg', $('colorMin').value);
  paintGradientBar();
}
function paintGradientBar(){
  $('grad').style.background = `linear-gradient(90deg, ${$('colorMin').value}, ${getComputedStyle(root).getPropertyValue('--panel').trim()}, ${$('colorMax').value})`;
}
$('colorMax').addEventListener('input', applyPalette);
$('colorMin').addEventListener('input', applyPalette);
paintGradientBar();

/* ---- Hover tooltips ------------------------------------------------------
   Small floating label that follows the mouse and shows the exact number
   under the cursor — for the bar chart and the heat map. */
const tip = $('tip');
function showTip(html, e){
  tip.innerHTML = html;
  tip.style.opacity = 1;
  const x = Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 8);
  const y = Math.max(8, e.clientY - tip.offsetHeight - 10);
  tip.style.transform = `translate(${x}px, ${y}px)`;
}
function hideTip(){ tip.style.opacity = 0; hoverIdx = -1; }
function colAt(canvas, e){
  const r = canvas.getBoundingClientRect();
  const cw = (r.width - PAD.l - PAD.r) / cols.length;
  const i = Math.floor((e.clientX - r.left - PAD.l) / cw);
  return {i, y: e.clientY - r.top};
}
$('profile').addEventListener('pointermove', e => {
  const {i} = colAt($('profile'), e);
  if (i < 0 || i >= cols.length) { hideTip(); return; }
  hoverIdx = i;
  if (compareMode && selectedRows.size) {
    /* In comparison mode there's no single "current value" any more — show
       every picked row's value at this column instead, each labelled in
       its own comparison colour so the tooltip reads like the legend. */
    const lines = Array.from(selectedRows).map((r, orderIndex) =>
      `<span style="color:${compareColor(orderIndex)}">${shortLabel(rows[r].label)}: <b>${fmt(rows[r].vals[cols[i]])}</b></span>`
    ).join('<br>');
    showTip(`${xname} ${cols[i] + 1}<br>${lines}`, e);
  } else {
    showTip(`${xname} ${cols[i] + 1}<br><b>${fmt(curVals[i])}</b>`, e);
  }
});
$('profile').addEventListener('pointerleave', hideTip);
$('heat').addEventListener('pointermove', e => {
  if (!heatGeom) return;
  const {i, y} = colAt($('heat'), e);
  const r = Math.floor((y - heatGeom.top) / heatGeom.rh);
  if (i < 0 || i >= cols.length || r < 0 || r >= n) { hideTip(); $('heat').style.cursor = 'default'; return; }
  $('heat').style.cursor = 'pointer';
  hoverIdx = i;
  const picked = compareMode && selectedRows.has(r) ? ' (picked)' : '';
  showTip(`${rows[r].label}${picked}<br>${xname} ${cols[i] + 1}: <b>${fmt(rows[r].vals[cols[i]])}</b>`, e);
});
$('heat').addEventListener('pointerleave', hideTip);
/* Feature 4: what a row-click DOES depends on compareMode — normally it
   jumps the clock there (as it always did); while "Multiple choice" is on,
   it instead adds or removes that row from the comparison. */
$('heat').addEventListener('click', e => {
  if (!heatGeom) return;
  const y = e.clientY - $('heat').getBoundingClientRect().top;
  const r = Math.floor((y - heatGeom.top) / heatGeom.rh);
  if (r < 0 || r >= n) return;
  if (compareMode) toggleRow(r);
  else jump(r);
});

/* ---- First paint ---------------------------------------------------------
   Set the Play/Pause button's starting label, load the example data that's
   already sitting in the textarea, then kick off the animation loop. */
setPlaying(playing);
load();
requestAnimationFrame(frame);

})();
