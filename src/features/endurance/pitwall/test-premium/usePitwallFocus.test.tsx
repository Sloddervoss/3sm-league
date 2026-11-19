import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePitwallFocus } from "./usePitwallFocus";

/**
 * De focus-hook is presentatie: geen queries, geen apparaat. Deze tests bewijzen
 * de browserranden die je in de echte pagina niet snel met de hand raakt —
 * Esc, native fullscreen, een geweigerde aanvraag en het opruimen bij unmount.
 */

function Harness() {
  const focus = usePitwallFocus();
  const entryRef = useRef<HTMLButtonElement | null>(null);
  return (
    <div>
      <button
        ref={entryRef}
        type="button"
        data-pitwall-focus-entry="true"
        onClick={(event) => focus.enter(event.currentTarget)}
      >
        Focus mode
      </button>
      <button type="button" onClick={() => focus.enter(entryRef.current)}>
        Focus via ref
      </button>
      <div
        ref={focus.shellRef}
        data-ptp-focus-shell={focus.active ? "true" : undefined}
        data-ptp-focus={focus.active ? "true" : undefined}
        tabIndex={-1}
      >
        <button type="button" data-testid="exit" ref={focus.exitButtonRef} onClick={focus.exit}>
          Focus verlaten
        </button>
        <button type="button" onClick={() => void focus.toggleFullscreen()}>
          Volledig scherm
        </button>
        <p data-testid="state">
          {focus.active ? "focus" : "normal"}|{focus.fullscreen ? "fullscreen" : "window"}
        </p>
        {focus.message && <p role="status" data-testid="message">{focus.message}</p>}
      </div>
    </div>
  );
}

const originalRequest = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "requestFullscreen");
const originalExit = Object.getOwnPropertyDescriptor(document, "exitFullscreen");
const originalElement = Object.getOwnPropertyDescriptor(document, "fullscreenElement");
const originalEnabled = Object.getOwnPropertyDescriptor(document, "fullscreenEnabled");

const restore = () => {
  if (originalRequest) Object.defineProperty(HTMLElement.prototype, "requestFullscreen", originalRequest);
  else delete (HTMLElement.prototype as { requestFullscreen?: unknown }).requestFullscreen;
  if (originalExit) Object.defineProperty(document, "exitFullscreen", originalExit);
  else delete (document as { exitFullscreen?: unknown }).exitFullscreen;
  if (originalElement) Object.defineProperty(document, "fullscreenElement", originalElement);
  else delete (document as { fullscreenElement?: unknown }).fullscreenElement;
  if (originalEnabled) Object.defineProperty(document, "fullscreenEnabled", originalEnabled);
  else delete (document as { fullscreenEnabled?: unknown }).fullscreenEnabled;
};

let fullscreenElement: Element | null = null;
let exitFullscreen: ReturnType<typeof vi.fn>;
let requestFullscreen: ReturnType<typeof vi.fn>;

const installFullscreen = (request: (this: Element) => Promise<void>) => {
  fullscreenElement = null;
  requestFullscreen = vi.fn(request);
  exitFullscreen = vi.fn(async () => {
    fullscreenElement = null;
    document.dispatchEvent(new Event("fullscreenchange"));
  });
  Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
    configurable: true,
    writable: true,
    value: requestFullscreen,
  });
  Object.defineProperty(document, "exitFullscreen", {
    configurable: true,
    writable: true,
    value: exitFullscreen,
  });
  Object.defineProperty(document, "fullscreenElement", {
    configurable: true,
    get: () => fullscreenElement,
  });
  Object.defineProperty(document, "fullscreenEnabled", {
    configurable: true,
    value: true,
  });
};

beforeEach(() => {
  restore();
  fullscreenElement = null;
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
});

afterEach(() => {
  restore();
  vi.restoreAllMocks();
});

describe("usePitwallFocus", () => {
  it("opent de focus, zet de focus op de expliciete uitgang en herstelt scroll en focus", async () => {
    Object.defineProperty(window, "scrollY", { configurable: true, value: 420 });
    render(<Harness />);
    const entry = screen.getByRole("button", { name: "Focus mode" });
    entry.focus();
    fireEvent.click(entry);

    expect(screen.getByTestId("state")).toHaveTextContent("focus|window");
    expect(screen.getByTestId("exit")).toHaveFocus();

    fireEvent.click(screen.getByTestId("exit"));
    expect(screen.getByTestId("state")).toHaveTextContent("normal|window");
    await waitFor(() => expect(entry).toHaveFocus());
    expect(window.scrollTo).toHaveBeenCalledWith(0, 420);
  });

  it("verlaat de focus met Escape en laat invoervelden met rust", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Focus mode" }));
    expect(screen.getByTestId("state")).toHaveTextContent("focus|window");

    const input = document.createElement("input");
    document.body.append(input);
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.getByTestId("state")).toHaveTextContent("focus|window");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByTestId("state")).toHaveTextContent("normal|window");
    input.remove();
  });

  it("valt terug op een bruikbare focus als fullscreen niet ondersteund wordt", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Focus mode" }));
    fireEvent.click(screen.getByRole("button", { name: "Volledig scherm" }));

    expect(screen.getByTestId("state")).toHaveTextContent("focus|window");
    expect(screen.getByTestId("message")).toHaveTextContent(/niet ondersteund/i);
    // De expliciete uitgang blijft gewoon werken.
    fireEvent.click(screen.getByTestId("exit"));
    expect(screen.getByTestId("state")).toHaveTextContent("normal|window");
  });

  it("meldt een geweigerde fullscreenaanvraag zonder de focus te verliezen", async () => {
    installFullscreen(async () => {
      throw new Error("denied");
    });
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Focus mode" }));
    fireEvent.click(screen.getByRole("button", { name: "Volledig scherm" }));

    await waitFor(() => expect(screen.getByTestId("message")).toHaveTextContent(/geweigerd/i));
    expect(screen.getByTestId("state")).toHaveTextContent("focus|window");
  });

  it("volgt fullscreenchange en laat de focus staan als de browser fullscreen sluit", async () => {
    installFullscreen(async () => {
      fullscreenElement = document.querySelector('[data-ptp-focus-shell="true"]');
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Focus mode" }));
    const shell = screen.getByTestId("exit").parentElement as HTMLElement;
    fireEvent.click(screen.getByRole("button", { name: "Volledig scherm" }));

    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("focus|fullscreen"));
    expect(requestFullscreen).toHaveBeenCalledTimes(1);
    expect(requestFullscreen.mock.instances[0]).toBe(shell);

    // Esc in native fullscreen is van de browser; de hook mag de focus niet
    // als tweede laag sluiten voordat fullscreenchange is geweest.
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByTestId("state")).toHaveTextContent("focus|fullscreen");

    // Daarna sluit de browser fullscreen, de focus blijft.
    fullscreenElement = null;
    document.dispatchEvent(new Event("fullscreenchange"));
    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("focus|window"));

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByTestId("state")).toHaveTextContent("normal|window");
    expect(exitFullscreen).not.toHaveBeenCalled();
  });

  it("verlaat native fullscreen mee met de expliciete uitgang", async () => {
    installFullscreen(async () => {
      fullscreenElement = document.querySelector('[data-ptp-focus-shell="true"]');
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Focus mode" }));
    fireEvent.click(screen.getByRole("button", { name: "Volledig scherm" }));
    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("focus|fullscreen"));

    fireEvent.click(screen.getByTestId("exit"));
    expect(screen.getByTestId("state")).toHaveTextContent("normal|window");
    expect(exitFullscreen).toHaveBeenCalledTimes(1);
  });

  it("ruimt fullscreen op wanneer de pagina verdwijnt", async () => {
    installFullscreen(async () => {
      fullscreenElement = document.querySelector('[data-ptp-focus-shell="true"]');
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    const view = render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Focus mode" }));
    fireEvent.click(screen.getByRole("button", { name: "Volledig scherm" }));
    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("focus|fullscreen"));

    view.unmount();
    expect(exitFullscreen).toHaveBeenCalledTimes(1);
  });
});
