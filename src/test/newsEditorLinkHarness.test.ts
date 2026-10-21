import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import ImageExtension from "@tiptap/extension-image";
import LinkExtension from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { Table } from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import HorizontalRule from "@tiptap/extension-horizontal-rule";
import { FontSize, TextStyle } from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";

// Spiegel van de extensielijst in src/pages/NewsEditorPage.tsx. De image-extensie
// is hier de kale ImageExtension; de pagina erft daar alleen attrs van.
const buildExtensions = () => [
  StarterKit.configure({ horizontalRule: false, link: false }),
  ImageExtension.configure({ inline: false, allowBase64: false }),
  LinkExtension.configure({ openOnClick: false, autolink: true, defaultProtocol: "https" }),
  Placeholder.configure({ placeholder: "test" }),
  Table.configure({ resizable: true }),
  TableRow,
  TableHeader,
  TableCell,
  HorizontalRule,
  TextStyle,
  FontSize,
  Color,
];

let editor: Editor;
let host: HTMLElement;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  editor = new Editor({
    element: host,
    extensions: buildExtensions(),
    content: "<p>Een stukje tekst om te linken</p>",
  });
});

afterEach(() => {
  editor?.destroy();
  host?.remove();
});

const linkMarks = () => {
  const marks: Array<{ href: string; from: number; to: number }> = [];
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText) return;
    node.marks.forEach((mark) => {
      if (mark.type.name === "link") marks.push({ href: mark.attrs.href, from: pos, to: pos + node.nodeSize });
    });
  });
  return marks;
};

const selectWord = (word: string) => {
  let from = -1;
  editor.state.doc.descendants((node, pos) => {
    if (!node.isTextblock) return;
    const text = node.textBetween(0, node.content.size, " ");
    const index = text.indexOf(word);
    if (index >= 0 && from < 0) from = pos + 1 + index;
  });
  expect(from).toBeGreaterThan(-1);
  // +1 omdat de cursor na het focus()-commando in de tekst staat
  editor.commands.setTextSelection({ from, to: from + word.length });
  return { from, to: from + word.length };
};

describe("nieuwseditor zonder StarterKit-link", () => {
  it("registreert precies één link-extensie, met de opties van de pagina", () => {
    const links = editor.extensionManager.extensions.filter((extension) => extension.name === "link");
    expect(links).toHaveLength(1);
    expect(links[0].options.openOnClick).toBe(false);
    expect(links[0].options.autolink).toBe(true);
    expect(links[0].options.defaultProtocol).toBe("https");
    expect(links[0].options.linkOnPaste).toBe(true);
  });

  it("levert geen tweede link-extensie via StarterKit", () => {
    const starterKitEditor = new Editor({ element: document.createElement("div"), extensions: [StarterKit.configure({ link: false })], content: "<p>x</p>" });
    expect(starterKitEditor.extensionManager.extensions.some((extension) => extension.name === "link")).toBe(false);
    // en zonder de config zou StarterKit er wél een meebrengen (de reden voor link:false)
    const plainStarterKit = new Editor({ element: document.createElement("div"), extensions: [StarterKit], content: "<p>x</p>" });
    expect(plainStarterKit.extensionManager.extensions.filter((extension) => extension.name === "link")).toHaveLength(1);
    starterKitEditor.destroy();
    plainStarterKit.destroy();
  });

  it("zet een link via dezelfde chain als de toolbar (setLink)", () => {
    const { from, to } = selectWord("stukje");
    editor.chain().focus().extendMarkRange("link").setLink({ href: "https://example.com/nieuws" }).run();

    const marks = linkMarks();
    expect(marks).toHaveLength(1);
    expect(marks[0].href).toBe("https://example.com/nieuws");
    expect(marks[0].from).toBeLessThanOrEqual(from + 10);
    expect(marks[0].to).toBeGreaterThanOrEqual(to);
    expect(editor.getHTML()).toContain('<a target="_blank" rel="noopener noreferrer nofollow" href="https://example.com/nieuws">');
    expect(editor.getAttributes("link").href).toBe("https://example.com/nieuws");
  });

  it("autolinkt een getypte URL met https-protocol", () => {
    editor.commands.setContent("<p>Zie</p>");
    editor.commands.focus("end");
    const { to } = editor.state.selection;
    // typen: spatie + URL + spatie (de spatie sluit het woord af)
    editor.view.dispatch(editor.state.tr.insertText(" www.example.com ", to));

    const marks = linkMarks();
    expect(marks).toHaveLength(1);
    expect(marks[0].href).toBe("https://www.example.com");
    expect(marks[0].to - marks[0].from).toBe("www.example.com".length);
    expect(editor.getHTML()).toContain('href="https://www.example.com"');
    expect(editor.getHTML()).toContain(">www.example.com</a>");
  });

  it("autolinkt ook een volledige https-URL en stopt bij de spatie", () => {
    editor.commands.setContent("<p>Bron:</p>");
    editor.commands.focus("end");
    const { to } = editor.state.selection;
    editor.view.dispatch(editor.state.tr.insertText(" https://3sm.example.org/race ", to));

    const marks = linkMarks();
    expect(marks).toHaveLength(1);
    expect(marks[0].href).toBe("https://3sm.example.org/race");
    expect(marks[0].to - marks[0].from).toBe("https://3sm.example.org/race".length);
    expect(editor.getHTML()).toContain(">https://3sm.example.org/race</a> ");
  });

  it("verwijdert een link met unsetLink", () => {
    selectWord("stukje");
    editor.chain().focus().extendMarkRange("link").setLink({ href: "https://example.com" }).run();
    expect(linkMarks()).toHaveLength(1);

    editor.chain().focus().extendMarkRange("link").unsetLink().run();
    expect(linkMarks()).toHaveLength(0);
    expect(editor.getHTML()).not.toContain("<a ");
  });

  it("leest bestaande links uit opgeslagen content en schrijft ze terug", () => {
    editor.commands.setContent('<p>Lees <a href="https://example.com/oud" target="_blank">dit</a> eens</p>');
    expect(linkMarks().map((mark) => mark.href)).toEqual(["https://example.com/oud"]);

    const existing = linkMarks()[0];
    editor.commands.setTextSelection({ from: existing.from, to: existing.to });
    editor.commands.extendMarkRange("link");
    expect(editor.isActive("link")).toBe(true);
    expect(editor.getAttributes("link").href).toBe("https://example.com/oud");
    expect(editor.getHTML()).toContain('href="https://example.com/oud"');
  });

  it("houdt alle commands die de pagina gebruikt beschikbaar", () => {
    const used = [
      "setContent", "setImage", "unsetLink", "extendMarkRange", "setLink", "updateAttributes",
      "setFontSize", "setColor", "unsetAllMarks", "clearNodes", "toggleBold", "toggleItalic",
      "toggleHeading", "toggleBlockquote", "toggleBulletList", "toggleOrderedList",
      "insertTable", "setHorizontalRule", "toggleCodeBlock", "deleteSelection",
      "addRowBefore", "addRowAfter", "deleteRow", "addColumnBefore", "addColumnAfter",
      "deleteColumn", "mergeCells", "splitCell", "deleteTable", "undo", "redo",
    ];
    const missing = used.filter((name) => typeof (editor.commands as unknown as Record<string, unknown>)[name] !== "function");
    expect(missing).toEqual([]);
    // link-commands komen nu uit de losse LinkExtension
    expect(editor.can().chain().focus().setLink({ href: "https://example.com" }).run()).toBe(true);
    expect(editor.can().chain().focus().unsetLink().run()).toBe(true);
  });

  it("houdt de losse HorizontalRule werkend na horizontalRule:false in StarterKit", () => {
    editor.commands.setContent("<p>a</p>");
    editor.commands.focus("end");
    editor.chain().focus().setHorizontalRule().run();
    expect(editor.getHTML()).toContain("<hr>");
    expect(editor.extensionManager.extensions.filter((extension) => extension.name === "horizontalRule")).toHaveLength(1);
  });

  it("blijft de pagina-configuratie gelijk aan dit harnas", () => {
    const page = readFileSync("src/pages/NewsEditorPage.tsx", "utf8");
    expect(page).toContain("StarterKit.configure({ horizontalRule: false, link: false })");
    expect(page).toContain('LinkExtension.configure({ openOnClick: false, autolink: true, defaultProtocol: "https" })');
    expect(page.match(/LinkExtension\.configure/g)).toHaveLength(1);
    expect(page).not.toContain("StarterKit.configure({ link: false })");
  });
});
