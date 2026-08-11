/**
 * Skrivestøtte i tekstfelt: viser forslags-panel ved skrivemarkøren i
 * <textarea>, <input> og contenteditable-elementer, med tastaturvalg.
 * Ingen chrome-API-er her — brukes både av utvidelsen og demo-siden.
 */
/**
 * Forslagskilde: lokal Predictor (synkron) eller en fjernkilde som spør
 * en annen kontekst via meldinger (asynkron) — begge deler støttes.
 */
export interface SuggestSource {
  suggest(prefix: string, max?: number): string[] | Promise<string[]>;
}

export interface AttachOptions {
  minPrefix?: number;
  maxSuggestions?: number;
  /** Kalles når et forslag settes inn (til f.eks. opplesing) */
  onAccept?: (word: string) => void;
  /** Kalles når et forslag markeres med piltastene (til opplesing før valg) */
  onHighlight?: (word: string) => void;
  /** Slå av/på uten å fjerne lyttere */
  isEnabled?: () => boolean;
  /**
   * Stavekontroll: kalles når et ord fullføres (mellomrom/skilletegn).
   * Returner forslag («Mente du …?») — tomt array betyr at ordet er OK.
   */
  checkWord?: (word: string) => Promise<string[]> | string[];
}

const WORD_TAIL_RE = /[\p{L}\p{N}][\p{L}\p{N}'-]*$/u;

type EditableTarget = HTMLTextAreaElement | HTMLInputElement | HTMLElement;

function isTextInput(el: Element): el is HTMLTextAreaElement | HTMLInputElement {
  if (el instanceof HTMLTextAreaElement) return true;
  return (
    el instanceof HTMLInputElement &&
    ["text", "search", "email", "url"].includes(el.type)
  );
}

function isEditable(el: Element): el is EditableTarget {
  if (isTextInput(el)) return true;
  return el instanceof HTMLElement && el.isContentEditable;
}

/* ---------- Markørposisjon ---------- */

const MIRROR_PROPS = [
  "boxSizing", "width", "height",
  "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
  "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
  "fontFamily", "fontSize", "fontWeight", "fontStyle", "letterSpacing",
  "lineHeight", "textTransform", "wordSpacing", "textIndent",
] as const;

function textInputCaretPoint(el: HTMLTextAreaElement | HTMLInputElement): { x: number; y: number } {
  const doc = el.ownerDocument;
  const div = doc.createElement("div");
  const style = getComputedStyle(el);
  for (const prop of MIRROR_PROPS) {
    div.style[prop as never] = style[prop as never];
  }
  div.style.position = "fixed";
  div.style.top = "0";
  div.style.left = "-9999px";
  div.style.visibility = "hidden";
  if (el instanceof HTMLTextAreaElement) {
    div.style.whiteSpace = "pre-wrap";
    div.style.overflowWrap = "break-word";
  } else {
    div.style.whiteSpace = "pre";
  }
  div.textContent = el.value.slice(0, el.selectionStart ?? 0);
  const marker = doc.createElement("span");
  marker.textContent = "​";
  div.appendChild(marker);
  doc.body.appendChild(div);
  const rect = el.getBoundingClientRect();
  const lineHeight =
    parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.4 || 20;
  const x = rect.left + marker.offsetLeft - el.scrollLeft;
  const y = rect.top + marker.offsetTop - el.scrollTop + lineHeight;
  div.remove();
  return { x: Math.min(x, rect.right), y: Math.min(y, rect.bottom + 24) };
}

function contentEditableCaretPoint(doc: Document): { x: number; y: number } | null {
  const sel = doc.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0).cloneRange();
  range.collapse(true);
  const rects = range.getClientRects();
  if (rects.length > 0) {
    return { x: rects[0].left, y: rects[0].bottom };
  }
  const el =
    range.startContainer instanceof Element
      ? range.startContainer
      : range.startContainer.parentElement;
  const rect = el?.getBoundingClientRect();
  return rect ? { x: rect.left, y: rect.bottom } : null;
}

/* ---------- Gjeldende ord før markøren ---------- */

function currentPrefix(target: EditableTarget, doc: Document): string | null {
  if (isTextInput(target)) {
    const pos = target.selectionStart;
    if (pos == null || pos !== target.selectionEnd) return null;
    const m = target.value.slice(0, pos).match(WORD_TAIL_RE);
    return m ? m[0] : null;
  }
  const sel = doc.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return null;
  const node = sel.anchorNode;
  if (!node || node.nodeType !== Node.TEXT_NODE) return null;
  const m = (node.textContent ?? "").slice(0, sel.anchorOffset).match(WORD_TAIL_RE);
  return m ? m[0] : null;
}

/* ---------- Innsetting ---------- */

function insertCompletion(target: EditableTarget, doc: Document, prefix: string, word: string): void {
  if (isTextInput(target)) {
    const completion = `${word} `;
    const pos = target.selectionStart ?? 0;
    target.setRangeText(completion, pos - prefix.length, pos, "end");
    target.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: completion }));
    return;
  }
  // Riktekst-editorer (Word online m.fl.) overstyrer markeringsendringer,
  // så å markere prefikset og erstatte det gir dobbel tekst («mysmystisk»).
  // I stedet settes kun RESTEN av ordet inn ved markøren — prefikset
  // brukeren alt har skrevet får stå.
  const remainder = `${word.slice(prefix.length)} `;
  // execCommand er formelt utdatert, men er fortsatt det som fungerer bredest
  // i contenteditable-editorer (bevarer undo-historikk og utløser input-events)
  doc.execCommand("insertText", false, remainder);
}

/* ---------- Panel ---------- */

type PanelMode = "predict" | "spell";

class SuggestionPanel {
  private host: HTMLDivElement;
  private list: HTMLDivElement;
  private header: HTMLDivElement;
  private items: string[] = [];
  /** Hva panelet viser NÅ — kilden til sannhet når brukeren velger */
  private mode: PanelMode = "predict";
  selectedIndex = -1;

  constructor(private doc: Document, private onPick: (word: string, mode: PanelMode) => void) {
    this.host = doc.createElement("div");
    this.host.style.cssText =
      "position: fixed; z-index: 2147483647; display: none;";
    const shadow = this.host.attachShadow({ mode: "closed" });
    const style = doc.createElement("style");
    style.textContent = `
      .panel {
        font: 14px/1.5 system-ui, sans-serif; background: white; color: #1a2330;
        border: 1px solid #cbd5e1; border-radius: 10px; overflow: hidden;
        box-shadow: 0 4px 16px rgb(0 0 0 / 18%); min-width: 160px;
      }
      .header {
        padding: 5px 12px 3px; font-size: 12px; font-weight: 700; color: #b45309;
        background: #fffbeb; border-bottom: 1px solid #fde68a; display: none;
      }
      .item { padding: 6px 12px; cursor: pointer; display: flex; gap: 8px; }
      .item:hover { background: #eff6ff; }
      .item.selected { background: #dbeafe; }
      .n { color: #94a3b8; min-width: 1em; }
      @media (prefers-color-scheme: dark) {
        .panel { background: #1e293b; color: #e2e8f0; border-color: #475569; }
        .header { background: #451a03; color: #fbbf24; border-color: #78350f; }
        .item:hover { background: #334155; }
        .item.selected { background: #1e40af; }
      }
    `;
    this.list = doc.createElement("div");
    this.list.className = "panel";
    this.header = doc.createElement("div");
    this.header.className = "header";
    this.list.appendChild(this.header);
    shadow.append(style, this.list);
    doc.documentElement.appendChild(this.host);
  }

  get visible(): boolean {
    return this.host.style.display !== "none";
  }

  get selected(): string | null {
    return this.items[this.selectedIndex] ?? null;
  }

  get first(): string | null {
    return this.items[0] ?? null;
  }

  show(items: string[], x: number, y: number, opts: { header?: string; mode: PanelMode }): void {
    this.items = items;
    this.mode = opts.mode;
    this.selectedIndex = -1;
    this.list.textContent = "";
    this.list.appendChild(this.header);
    this.header.textContent = opts.header ?? "";
    this.header.style.display = opts.header ? "block" : "none";
    items.forEach((word, i) => {
      const row = this.doc.createElement("div");
      row.className = "item";
      const n = this.doc.createElement("span");
      n.className = "n";
      n.textContent = String(i + 1);
      row.append(n, this.doc.createTextNode(word));
      // mousedown, ikke click: unngå at feltet mister fokus før innsetting.
      // Moduset leses fra panelet selv, så et valg alltid tolkes som det
      // brukeren faktisk ser — ikke som en tilstand som kan ha endret seg
      // mens et asynkront svar var underveis.
      row.addEventListener("mousedown", (e) => {
        e.preventDefault();
        this.onPick(word, this.mode);
      });
      this.list.appendChild(row);
    });
    const vw = this.doc.defaultView ?? window;
    this.host.style.left = `${Math.max(4, Math.min(x, vw.innerWidth - 200))}px`;
    this.host.style.top = `${Math.min(y + 4, vw.innerHeight - 40 - items.length * 30)}px`;
    this.host.style.display = "block";
  }

  move(delta: number): void {
    if (this.items.length === 0) return;
    // Sykler gjennom tilstandene -1 (ingen valgt), 0, 1, …, n-1
    const states = this.items.length + 1;
    this.selectedIndex = ((this.selectedIndex + 1 + delta + states) % states) - 1;
    this.list.querySelectorAll(".item").forEach((el, i) => {
      el.classList.toggle("selected", i === this.selectedIndex);
    });
  }

  hide(): void {
    this.host.style.display = "none";
    this.items = [];
    this.selectedIndex = -1;
  }

  destroy(): void {
    this.host.remove();
  }
}

/* ---------- Hovedinngang ---------- */

export interface WritingSupport {
  destroy(): void;
}

/**
 * Aktiver skrivestøtte for hele dokumentet: lytter på fokus i redigerbare
 * felt og viser ordforslag mens man skriver.
 */
export function enableWritingSupport(
  doc: Document,
  predictor: SuggestSource,
  opts: AttachOptions = {},
): WritingSupport {
  const minPrefix = opts.minPrefix ?? 2;
  const maxSuggestions = opts.maxSuggestions ?? 5;
  const enabled = opts.isEnabled ?? (() => true);

  let active: EditableTarget | null = null;
  let activePrefix = "";
  let spellContext: { word: string; wordStart: number; node?: Text } | null = null;
  const panel = new SuggestionPanel(doc, (word, mode) =>
    mode === "spell" ? replaceLastWord(word) : accept(word),
  );

  // Feltet kan allerede ha fokus når støtten aktiveres (lat lasting)
  const initial = doc.activeElement;
  if (initial && isEditable(initial)) active = initial;

  function accept(word: string): void {
    if (!active) return;
    insertCompletion(active, doc, activePrefix, word);
    panel.hide();
    opts.onAccept?.(word);
  }

  /**
   * Tekst før markøren, med tekstnoden den kom fra.
   *
   * Noden MÅ lagres: i riktekst-editorer peker markeringen ofte til en helt
   * annen node i det brukeren klikker på forslaget, og offsets beregnet her
   * gjelder da ikke lenger (ga IndexSizeError på setStart/setEnd).
   */
  function caretContext(t: EditableTarget): { text: string; node?: Text } {
    if (isTextInput(t)) {
      return { text: t.value.slice(0, t.selectionStart ?? t.value.length) };
    }
    const sel = doc.getSelection();
    const node = sel?.anchorNode;
    if (!node || node.nodeType !== Node.TEXT_NODE) return { text: "" };
    const textNode = node as Text;
    return { text: textNode.data.slice(0, sel!.anchorOffset), node: textNode };
  }

  /** Bytt ut ordet stavekontrollen fant med det valgte forslaget. */
  function replaceLastWord(replacement: string): void {
    if (!active || !spellContext) return;
    const { word, wordStart, node } = spellContext;

    if (isTextInput(active)) {
      active.setRangeText(replacement, wordStart, wordStart + word.length, "preserve");
      active.dispatchEvent(
        new InputEvent("input", { bubbles: true, inputType: "insertText", data: replacement }),
      );
    } else if (node?.isConnected) {
      // Finn ordet på nytt i noden — editoren kan ha flyttet innholdet siden
      // kontrollen kjørte. Vi skriver aldri med offsets vi ikke har bekreftet.
      let start = wordStart;
      if (node.data.slice(start, start + word.length) !== word) {
        start = node.data.lastIndexOf(word);
      }
      if (start < 0 || start + word.length > node.data.length) {
        panel.hide();
        return;
      }
      try {
        const sel = doc.getSelection();
        const range = doc.createRange();
        range.setStart(node, start);
        range.setEnd(node, start + word.length);
        sel?.removeAllRanges();
        sel?.addRange(range);
        doc.execCommand("insertText", false, replacement);
      } catch {
        panel.hide();
        return;
      }
    }
    spellContext = null;
    panel.hide();
    opts.onAccept?.(replacement);
  }

  /** Kjør stavekontroll på et ord og vis «Mente du …?» hvis noe foreslås. */
  async function checkAndShow(
    word: string,
    wordStart: number,
    node: Text | undefined,
    seq: number,
  ): Promise<void> {
    if (!opts.checkWord) return;
    let suggestions: string[];
    try {
      suggestions = await opts.checkWord(word);
    } catch {
      return;
    }
    if (seq !== refreshSeq || !active || !suggestions?.length) return;
    spellContext = { word, wordStart, node };
    const point = isTextInput(active)
      ? textInputCaretPoint(active)
      : contentEditableCaretPoint(doc);
    if (!point) return;
    panel.show(suggestions, point.x, point.y, {
      header: `Mente du? («${word}»)`,
      mode: "spell",
    });
  }

  /** Sjekk ordet som nettopp ble fullført (mellomrom/skilletegn). */
  async function spellCheckLastWord(): Promise<void> {
    if (!active || !opts.checkWord || !enabled()) return;
    const { text: before, node } = caretContext(active);
    const m = before.match(/([\p{L}][\p{L}'’-]*)([^\p{L}\p{N}]*)$/u);
    if (!m || m[1].length < 2) return;
    await checkAndShow(m[1], before.length - m[0].length, node, ++refreshSeq);
  }

  let refreshSeq = 0;

  async function refresh(): Promise<void> {
    if (!active || !enabled()) {
      panel.hide();
      return;
    }
    const prefix = currentPrefix(active, doc);
    if (!prefix || prefix.length < minPrefix) {
      panel.hide();
      return;
    }
    const seq = ++refreshSeq;
    let suggestions: string[];
    try {
      suggestions = await predictor.suggest(prefix, maxSuggestions);
    } catch {
      panel.hide();
      return;
    }
    // Har brukeren rukket å skrive mer, er dette svaret utdatert
    if (seq !== refreshSeq) return;
    if (!active) {
      panel.hide();
      return;
    }
    if (suggestions.length === 0) {
      // Ingen ordbokord starter med dette — da er ordet enten ferdig eller
      // feilstavet. Tilby retting med en gang, uten å vente på mellomrom.
      panel.hide();
      if (opts.checkWord && prefix.length >= 4) {
        const { text: before, node } = caretContext(active);
        await checkAndShow(prefix, before.length - prefix.length, node, seq);
      }
      return;
    }
    activePrefix = prefix;
    const point = isTextInput(active)
      ? textInputCaretPoint(active)
      : contentEditableCaretPoint(doc);
    if (!point) {
      panel.hide();
      return;
    }
    panel.show(suggestions, point.x, point.y, { mode: "predict" });
  }

  const onFocusIn = (e: FocusEvent): void => {
    const t = e.target;
    if (t instanceof Element && isEditable(t)) {
      active = t;
    } else {
      active = null;
      panel.hide();
    }
  };

  const onInput = (e: Event): void => {
    if (!active || e.target !== active) return;
    // Tilstandsbasert, ikke hendelsesbasert: teksten før markøren avgjør.
    // Da fungerer det likt for enkelttastetrykk, liming, mobiltastatur
    // og editorer som slår sammen input-hendelser.
    const endsWithSeparator = /[\s,;:.!?][\s,;:.!?»)"']*$/u.test(caretContext(active).text);
    if (endsWithSeparator && opts.checkWord) {
      panel.hide();
      void spellCheckLastWord();
    } else {
      void refresh();
    }
  };

  // Enkelte hjelpemidler/virtuelle tastaturer sender tom e.key — fall
  // tilbake på keyCode for tastene vi bryr oss om
  const KEYCODE_MAP: Record<number, string> = {
    9: "Tab", 13: "Enter", 27: "Escape", 38: "ArrowUp", 40: "ArrowDown",
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (!panel.visible || e.target !== active) return;
    // stopImmediatePropagation: hindrer at andre lyttere (inkl. en duplisert
    // instans av oss selv) håndterer samme tastetrykk én gang til
    switch (e.key || KEYCODE_MAP[e.keyCode]) {
      case "ArrowDown":
        e.preventDefault();
        e.stopImmediatePropagation();
        panel.move(1);
        if (panel.selected) opts.onHighlight?.(panel.selected);
        break;
      case "ArrowUp":
        e.preventDefault();
        e.stopImmediatePropagation();
        panel.move(-1);
        if (panel.selected) opts.onHighlight?.(panel.selected);
        break;
      case "Tab":
        e.preventDefault();
        e.stopImmediatePropagation();
        accept(panel.selected ?? panel.first!);
        break;
      case "Enter":
        if (panel.selected) {
          e.preventDefault();
          e.stopImmediatePropagation();
          accept(panel.selected);
        } else {
          panel.hide();
        }
        break;
      case "Escape":
        e.preventDefault();
        e.stopImmediatePropagation();
        panel.hide();
        break;
    }
  };

  const onFocusOut = (): void => panel.hide();
  const onScroll = (): void => panel.hide();

  doc.addEventListener("focusin", onFocusIn);
  doc.addEventListener("input", onInput);
  doc.addEventListener("keydown", onKeyDown, true);
  doc.addEventListener("focusout", onFocusOut);
  doc.addEventListener("scroll", onScroll, true);

  return {
    destroy() {
      doc.removeEventListener("focusin", onFocusIn);
      doc.removeEventListener("input", onInput);
      doc.removeEventListener("keydown", onKeyDown, true);
      doc.removeEventListener("focusout", onFocusOut);
      doc.removeEventListener("scroll", onScroll, true);
      panel.destroy();
    },
  };
}
