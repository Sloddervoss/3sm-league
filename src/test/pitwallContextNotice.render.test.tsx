import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PitwallContextNotice } from "@/features/endurance/pitwall/PitwallContextNotice";

/**
 * De melding is het enige deel van fase 1 dat de gebruiker ziet. Deze test legt
 * vast dat de goedgekeurde tekst werkelijk in de DOM komt en dat een geldige
 * racekoppeling niets toont.
 */
describe("PitwallContextNotice", () => {
  it("toont de goedgekeurde tekst bij een afgesloten event", () => {
    render(
      <PitwallContextNotice
        notice={{ tone: "warning", message: "Dit event is afgesloten. Er is geen live race meer om te tonen." }}
      />,
    );
    const melding = screen.getByRole("status");
    expect(melding.textContent).toBe("Dit event is afgesloten. Er is geen live race meer om te tonen.");
    expect(melding.getAttribute("data-pitwall-context-notice")).toBe("warning");
  });

  it("toont niets als er geen melding is", () => {
    const { container } = render(<PitwallContextNotice notice={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("gebruikt een neutrale toon voor een ontbrekende koppeling", () => {
    render(
      <PitwallContextNotice
        notice={{ tone: "info", message: "Dit apparaat is nog niet aan een race gekoppeld." }}
      />,
    );
    expect(screen.getByRole("status").getAttribute("data-pitwall-context-notice")).toBe("info");
  });
});
