/**
 * Ordbok-UI: oppslagspanel (vises ved markert ord) og en flyttbar
 * ordbok-boks med søkefelt. Begge viser artikler fra Bokmålsordboka og
 * Nynorskordboka med faner, bøyning, eksempler og opplesing.
 *
 * Kreditering av UiB og Språkrådet er et lisenskrav og ligger i bunnteksten.
 */
import type { DictArticle, DictDef } from "@skrivestotte/writing";

export interface DictLookupResult {
  bm: DictArticle[];
  nn: DictArticle[];
}

export type Theme = "standard" | "dark";

export interface DictUIDeps {
  lookup: (word: string) => Promise<DictLookupResult>;
  speak: (text: string) => void;
  /** Brukeren lukket ordbok-boksen med ✕ (så innstillingen kan skrus av) */
  onBoxClosed?: () => void;
}

/**
 * Farger som CSS-variabler, med to eksplisitte temaer.
 *
 * Mørk modus følger anerkjent praksis: ingen ren svart bakgrunn eller ren hvit
 * tekst (gir halo-effekt og tretthet), lysere flate = høyere «elevasjon»,
 * dempet blåtone som aksent, og all tekst godt over 4,5:1 i kontrast.
 *
 * VIKTIG: knapper arver ikke color fra forelderen — uten `color: inherit` får
 * de nettleserens svarte standardfarge (det gjorde ✕ usynlig i mørk modus).
 */
const PANEL_CSS = `
  * { box-sizing: border-box; }
  /* Variablene på :host, ikke .card — da arver også den frittstående
     «Les opp»-knappen (søsken til kortet) samme tema. */
  :host {
    --bg: #ffffff; --fg: #1a2330; --muted: #5a6b7d; --line: #cbd5e1;
    --head: #f1f5f9; --field: #ffffff; --accent: #2563eb; --accent-fg: #ffffff;
    --hover: #e2e8f0; --shadow: 0 6px 24px rgb(0 0 0 / 22%);
  }
  :host(.dark) {
    --bg: #1c2128; --fg: #e6edf3; --muted: #a3aeb9; --line: #3d444d;
    --head: #262c36; --field: #12161c; --accent: #4493f8; --accent-fg: #0d1117;
    --hover: #333b45; --shadow: 0 6px 24px rgb(0 0 0 / 55%);
  }
  .card {
    font: 14px/1.5 system-ui, sans-serif; background: var(--bg); color: var(--fg);
    border: 1px solid var(--line); border-radius: 12px; overflow: hidden;
    box-shadow: var(--shadow); width: 340px; display: flex;
    flex-direction: column; max-height: 420px;
  }
  .head {
    display: flex; align-items: center; gap: 6px; padding: 8px 10px;
    background: var(--head); border-bottom: 1px solid var(--line); cursor: default;
  }
  .head.grab { cursor: grab; }
  .title { font-weight: 700; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tabs { display: flex; gap: 4px; }
  .tab {
    font: 12px/1 system-ui, sans-serif; border: 1px solid var(--line);
    background: var(--bg); color: inherit;
    border-radius: 999px; padding: 4px 10px; cursor: pointer;
  }
  .tab.on { background: var(--accent); border-color: var(--accent); color: var(--accent-fg); }
  .icon {
    border: none; background: none; color: inherit; cursor: pointer; font-size: 15px;
    padding: 2px 5px; border-radius: 6px; line-height: 1;
  }
  .icon:hover { background: var(--hover); }
  .icon:focus-visible, .tab:focus-visible, .search:focus-visible {
    outline: 2px solid var(--accent); outline-offset: 1px;
  }
  .body { overflow-y: auto; padding: 10px 12px; user-select: text; }
  .selchip {
    position: fixed; z-index: 2147483647; font: 12px/1 system-ui, sans-serif;
    padding: 6px 10px; border-radius: 999px; border: none; cursor: pointer;
    background: var(--accent); color: var(--accent-fg); box-shadow: var(--shadow);
  }
  .search {
    width: 100%; font: 14px system-ui, sans-serif; padding: 7px 10px; margin-bottom: 8px;
    border: 1px solid var(--line); border-radius: 8px;
    background: var(--field); color: inherit;
  }
  .art { margin-bottom: 12px; }
  .lemma { font-weight: 700; font-size: 15px; }
  .wc { color: var(--muted); font-size: 12px; margin-left: 6px; }
  .infl { color: var(--muted); font-size: 12px; margin: 2px 0 4px; }
  ol { margin: 4px 0 4px 18px; padding: 0; }
  li { margin: 3px 0; }
  .ex { color: var(--muted); font-style: italic; font-size: 13px; display: block; }
  .empty { color: var(--muted); padding: 8px 0; }
  .foot {
    font-size: 10.5px; color: var(--muted); padding: 6px 12px;
    border-top: 1px solid var(--line);
  }
`;

const ATTRIBUTION =
  "Bokmålsordboka og Nynorskordboka © Universitetet i Bergen og Språkrådet";

function el<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderDef(doc: Document, def: DictDef, list: HTMLOListElement): void {
  const li = doc.createElement("li");
  if (def.t) li.appendChild(doc.createTextNode(def.t));
  for (const ex of def.e ?? []) li.appendChild(el(doc, "span", "ex", ex));
  if (def.u?.length) {
    const sub = doc.createElement("ol");
    for (const u of def.u) renderDef(doc, u, sub);
    li.appendChild(sub);
  }
  list.appendChild(li);
}

function renderArticles(doc: Document, container: HTMLElement, articles: DictArticle[]): void {
  container.textContent = "";
  if (articles.length === 0) {
    container.appendChild(el(doc, "div", "empty", "Ingen treff i denne målformen."));
    return;
  }
  for (const art of articles) {
    const box = el(doc, "div", "art");
    const head = el(doc, "div");
    head.appendChild(el(doc, "span", "lemma", art.w.join(", ")));
    if (art.k) head.appendChild(el(doc, "span", "wc", art.k));
    box.appendChild(head);
    if (art.b?.length) box.appendChild(el(doc, "div", "infl", `Bøyning: ${art.b.join(", ")}`));
    const list = doc.createElement("ol");
    for (const def of art.d) renderDef(doc, def, list);
    box.appendChild(list);
    container.appendChild(box);
  }
}

/**
 * Innledningen til opplesing: kun ordet, ordklassen og bøyningen.
 * Definisjonene leses bare når brukeren selv markerer tekst i panelet
 * og velger «Les opp» — samme mønster som ellers i systemet.
 */
function introToSpeech(word: string, articles: DictArticle[]): string {
  const art = articles[0];
  const parts: string[] = [word + "."];
  if (art?.k) parts.push(art.k + ".");
  if (art?.b?.length) parts.push("Bøyning: " + art.b.join(", ") + ".");
  return parts.join(" ").slice(0, 400);
}

class DictCard {
  host: HTMLDivElement;
  private card: HTMLDivElement;
  private body: HTMLDivElement;
  private title: HTMLSpanElement;
  private tabBm: HTMLButtonElement;
  private tabNn: HTMLButtonElement;
  private results: HTMLDivElement;
  private selChip!: HTMLButtonElement;
  private shadowRef: ShadowRoot;
  private lang: "bm" | "nn" = "bm";
  private data: DictLookupResult = { bm: [], nn: [] };
  private word = "";

  constructor(
    private doc: Document,
    private deps: DictUIDeps,
    opts: { draggable?: boolean; searchField?: boolean; onClose: () => void },
  ) {
    this.host = el(doc, "div");
    this.host.style.cssText = "position: fixed; z-index: 2147483647; display: none;";
    const shadow = this.host.attachShadow({ mode: "closed" });
    this.shadowRef = shadow;
    const style = el(doc, "style");
    style.textContent = PANEL_CSS;

    this.card = el(doc, "div", "card");
    const head = el(doc, "div", "head" + (opts.draggable ? " grab" : ""));
    this.title = el(doc, "span", "title", "Ordbok");
    const tabs = el(doc, "div", "tabs");
    this.tabBm = el(doc, "button", "tab on", "Bokmål");
    this.tabNn = el(doc, "button", "tab", "Nynorsk");
    tabs.append(this.tabBm, this.tabNn);
    const speakBtn = el(doc, "button", "icon", "🔊");
    speakBtn.title = "Les opp";
    const closeBtn = el(doc, "button", "icon", "✕");
    closeBtn.title = "Lukk";
    head.append(this.title, tabs, speakBtn, closeBtn);

    this.body = el(doc, "div", "body");
    if (opts.searchField) {
      const input = el(doc, "input", "search") as HTMLInputElement;
      input.type = "search";
      input.placeholder = "Søk i ordboka …";
      let timer: ReturnType<typeof setTimeout> | undefined;
      input.addEventListener("input", () => {
        clearTimeout(timer);
        timer = setTimeout(() => void this.lookup(input.value.trim()), 250);
      });
      input.addEventListener("keydown", (e) => e.stopPropagation());
      this.body.appendChild(input);
    }
    this.results = el(doc, "div");
    this.body.appendChild(this.results);

    const foot = el(doc, "div", "foot", ATTRIBUTION);
    this.card.append(head, this.body, foot);
    shadow.append(style, this.card);
    doc.documentElement.appendChild(this.host);

    this.tabBm.addEventListener("click", () => this.setLang("bm"));
    this.tabNn.addEventListener("click", () => this.setLang("nn"));
    closeBtn.addEventListener("click", () => opts.onClose());
    speakBtn.addEventListener("click", () => {
      const arts = this.data[this.lang];
      if (this.word && arts.length) this.deps.speak(introToSpeech(this.word, arts));
    });

    // Markér tekst i panelet → liten «Les opp»-knapp ved markeringen.
    // (Sidens vanlige flyteknapp ser ikke markeringer inne i shadow DOM.)
    this.selChip = el(doc, "button", "selchip", "🔊 Les opp");
    this.selChip.style.display = "none";
    shadow.appendChild(this.selChip);
    this.selChip.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const text = this.shadowSelectionText();
      if (text) this.deps.speak(text);
      this.selChip.style.display = "none";
    });
    const updateChip = (): void => {
      // Vent til markeringen er ferdig oppdatert
      setTimeout(() => {
        const sel = this.shadowSelection();
        const text = sel?.toString().trim() ?? "";
        if (!text || sel!.rangeCount === 0) {
          this.selChip.style.display = "none";
          return;
        }
        const rect = sel!.getRangeAt(0).getBoundingClientRect();
        const vw = doc.defaultView ?? window;
        this.selChip.style.left = `${Math.min(rect.right, vw.innerWidth - 110)}px`;
        this.selChip.style.top = `${Math.min(rect.bottom + 6, vw.innerHeight - 40)}px`;
        this.selChip.style.display = "block";
      }, 0);
    };
    this.body.addEventListener("mouseup", updateChip);
    this.body.addEventListener("keyup", updateChip);

    if (opts.draggable) {
      let drag: { dx: number; dy: number } | null = null;
      head.addEventListener("pointerdown", (e) => {
        if ((e.target as HTMLElement).tagName === "BUTTON") return;
        const r = this.host.getBoundingClientRect();
        drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
        head.setPointerCapture(e.pointerId);
      });
      head.addEventListener("pointermove", (e) => {
        if (!drag) return;
        this.host.style.left = `${Math.max(0, e.clientX - drag.dx)}px`;
        this.host.style.top = `${Math.max(0, e.clientY - drag.dy)}px`;
        this.host.style.right = "auto";
        this.host.style.bottom = "auto";
      });
      head.addEventListener("pointerup", () => (drag = null));
    }
  }

  /**
   * Markeringen inne i (lukket) shadow DOM. document.getSelection() ser den
   * ikke — Chromium-baserte nettlesere (Edge) eksponerer den via
   * shadowRoot.getSelection().
   */
  private shadowSelection(): Selection | null {
    const sr = this.shadowRef as ShadowRoot & { getSelection?(): Selection | null };
    return sr.getSelection?.() ?? this.doc.getSelection();
  }

  private shadowSelectionText(): string {
    return this.shadowSelection()?.toString().trim() ?? "";
  }

  private setLang(lang: "bm" | "nn"): void {
    this.lang = lang;
    this.tabBm.classList.toggle("on", lang === "bm");
    this.tabNn.classList.toggle("on", lang === "nn");
    renderArticles(this.doc, this.results, this.data[lang]);
  }

  async lookup(word: string): Promise<void> {
    this.word = word;
    this.title.textContent = word || "Ordbok";
    if (!word) {
      this.data = { bm: [], nn: [] };
      this.results.textContent = "";
      return;
    }
    this.results.textContent = "";
    this.results.appendChild(el(this.doc, "div", "empty", "Slår opp …"));
    this.data = await this.deps.lookup(word);
    // Vis målformen som har treff hvis den valgte er tom
    if (this.data[this.lang].length === 0) {
      const other = this.lang === "bm" ? "nn" : "bm";
      if (this.data[other].length > 0) {
        this.setLang(other);
        return;
      }
    }
    this.setLang(this.lang);
  }

  setTheme(theme: Theme): void {
    this.host.classList.toggle("dark", theme === "dark");
  }

  get visible(): boolean {
    return this.host.style.display !== "none";
  }

  show(): void {
    this.host.style.display = "block";
  }

  hide(): void {
    this.host.style.display = "none";
    this.selChip.style.display = "none";
  }
}

export interface DictUI {
  /** Slå opp et ord og vis panelet nær et punkt på siden */
  showLookup(word: string, x: number, y: number): void;
  /** Vis/skjul den vedvarende ordbok-boksen */
  setBoxVisible(visible: boolean): void;
  hideLookup(): void;
  setTheme(theme: Theme): void;
}

export function createDictUI(doc: Document, deps: DictUIDeps): DictUI {
  let lookupCard: DictCard | null = null;
  let boxCard: DictCard | null = null;
  let theme: Theme = "standard";

  doc.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && lookupCard?.visible) lookupCard.hide();
  });

  return {
    showLookup(word, x, y) {
      if (!lookupCard) {
        lookupCard = new DictCard(doc, deps, { onClose: () => lookupCard?.hide() });
        lookupCard.setTheme(theme);
      }
      const vw = doc.defaultView ?? window;
      lookupCard.host.style.left = `${Math.max(8, Math.min(x, vw.innerWidth - 360))}px`;
      lookupCard.host.style.top = `${Math.max(8, Math.min(y, vw.innerHeight - 300))}px`;
      lookupCard.show();
      void lookupCard.lookup(word);
    },
    setBoxVisible(visible) {
      if (visible) {
        if (!boxCard) {
          boxCard = new DictCard(doc, deps, {
            draggable: true,
            searchField: true,
            onClose: () => {
              boxCard?.hide();
              deps.onBoxClosed?.();
            },
          });
          // Startposisjon settes KUN ved opprettelse — har brukeren dratt
          // boksen et annet sted, skal den bli der ved neste visning
          boxCard.host.style.right = "16px";
          boxCard.host.style.bottom = "16px";
          boxCard.setTheme(theme);
        }
        boxCard.show();
      } else {
        boxCard?.hide();
      }
    },
    hideLookup() {
      lookupCard?.hide();
    },
    setTheme(next) {
      theme = next;
      lookupCard?.setTheme(next);
      boxCard?.setTheme(next);
    },
  };
}
