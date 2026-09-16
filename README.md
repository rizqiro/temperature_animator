# Wind Trend Animator

An animated, single-page viewer for wind data over time. Open `index.html` in any browser; no install or build step needed.

## Files

- `index.html` — the page structure (what's on the page)
- `style.css` — all colours, spacing and layout (how it looks)
- `script.js` — all behaviour: parsing data, animating, drawing the charts (how it works)

Every file is heavily commented, explaining not just what each part does but *why*, including the algorithms used (smoothstep interpolation for the animation, canvas DPI scaling, the heat map's colour-blending formula, and the "nice round number" axis-rounding trick).

## What it shows

- **Values at this time**: a bar chart that glides smoothly between time steps, with a dashed line for the previous step. The left axis has an **Auto** toggle — untick it to type your own min/max so the axis stays fixed instead of rescaling per dataset.
- **Whole period**: a colour map (rows = times, columns = positions). Click a row to jump to that time. Two colour pickers next to the scale let you choose the colour for the maximum and minimum ends of the scale — changing them repaints the heat map *and* the bar chart, since both read the same shared colours.
- **Compare positions**: tick any number of position "chips" under the heat map to draw them as separate coloured lines on their own chart, so you can compare several positions' trends over the whole period at once.

Controls: play/pause, step buttons, time slider, speed. Keyboard: `Space` plays/pauses, `←` / `→` step through time.

## Using your own data

Open **Use your own data** at the bottom of the page and paste cells copied from Excel:

- First column: the time (for example `08 Nov 24 16:00`)
- Other columns: one value per position
- Tabs, semicolons or spaces work as separators; commas or dots work as decimal marks

Then set the column name and unit and click **Update chart**.

To change the built-in example data, edit the text inside `<textarea id="raw">` in `index.html`.

## Publish it online (GitHub Pages)

In the repository: **Settings → Pages → Build and deployment → Source: Deploy from a branch**, choose `main` and `/ (root)`, then save. The page appears at `https://<your-username>.github.io/<repo-name>/` after a minute or two.
