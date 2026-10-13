// Runs the simulator page script (index.html, or the given file) in Node.js with a minimal mock DOM and loads every preset through the
// preset selector: catches runtime errors in the drawing code. Usage: node smoke_ui.mjs
//
// For beginners: a "smoke test" only checks that nothing breaks (no error, no "NaN" or "undefined" in the output);
// it does not check the numbers (test_solver.mjs does). DOM = Document Object Model, the browser's view of the page.
// Node.js has no DOM, so this file fakes the few parts the page uses (getElementById, innerHTML, event handlers).
// Steps: cut the <script type="module"> out of the page -> point its imports to absolute file URLs -> write it to
// .smoke_page.mjs and import it (this runs the page script) -> select every preset by calling the "change" handler
// of the preset list -> check status text and drawings. Side effect: writes .smoke_page.mjs next to this file.
import { readFileSync, writeFileSync } from "node:fs";
const pageFile = process.argv[2] || "index.html";      // also: node smoke_ui.mjs standalone.html
const html = readFileSync(new URL("./" + pageFile, import.meta.url), "utf8");
const script = html.split('<script type="module">')[1].split("</script>")[0]
  .replace('from "./solver.mjs"', `from "${new URL("./solver.mjs", import.meta.url).href}"`)
  .replace('from "./explain.mjs"', `from "${new URL("./explain.mjs", import.meta.url).href}"`);
const els = {}, handlers = {};          // fake elements by id; event handlers by "id:event"
/** A fake DOM element: stores value, text, innerHTML and the event handlers the page registers. */
const mk = (id) => ({ id, value: "", checked: false, hidden: false, textContent: "", className: "", dataset: {},
  _html: "", set innerHTML(v) { this._html = v; }, get innerHTML() { return this._html; },
  addEventListener(t, fn) { (handlers[id + ":" + t] ||= []).push(fn); }, querySelectorAll: () => [], appendChild() {}, setAttribute() {} });
globalThis.document = { getElementById: (id) => (els[id] ||= mk(id)), querySelectorAll: () => [], createElement: () => mk("tmp") };
globalThis.localStorage = { setItem() {}, getItem: () => null };
globalThis.fetch = async () => ({ json: async () => JSON.parse(readFileSync(new URL("./presets.json", import.meta.url))) });
const tmp = new URL("./.smoke_page.mjs", import.meta.url);
writeFileSync(tmp, script);
await import(tmp.href);
await new Promise((r) => setTimeout(r, 50));     // let the page's async start-up (loading the presets) finish
const presets = JSON.parse(readFileSync(new URL("./presets.json", import.meta.url)));
let bad = 0;
for (const p of presets) {
  els.preset.value = p.code;
  handlers["preset:change"].forEach((fn) => fn({ target: els.preset }));
  const st = els.status.textContent, svg = els.sld.innerHTML + els.phasor.innerHTML;
  const ex = els.explain.innerHTML;
  const ok = st.startsWith("Load flow converged") && svg.includes("<svg") && !svg.includes("NaN") && !svg.includes("undefined")
    && ex.includes("<h3>The pair: ") && ex.includes(p.code) && !/NaN|undefined/.test(ex);
  if (!ok) { bad++; console.log("FAIL", p.code, st.slice(0, 80)); }
}
for (const rule of ["invert"]) { els.rule.value = rule; handlers["rule:change"].forEach((fn) => fn({ target: els.rule })); }
console.log(`${presets.length} presets rendered, ${bad} failures; last status: ${els.status.textContent}`);
process.exit(bad ? 1 : 0);
