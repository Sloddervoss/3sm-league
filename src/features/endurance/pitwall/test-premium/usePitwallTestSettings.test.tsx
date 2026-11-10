import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { usePitwallTestSettings } from "./usePitwallTestSettings";

/**
 * De hook mag een bewuste keuze niet verliezen wanneer hij zijn eigen
 * `?pitwallView`-parameter opruimt en localStorage geweigerd is. Externe
 * navigatie (waaronder browser back) moet de URL-override wél toepassen.
 */

function Harness() {
  const { view, chooseView, overridden } = usePitwallTestSettings();
  const navigate = useNavigate();
  return (
    <>
      <span data-testid="view">{view}</span>
      <span data-testid="override">{overridden ? "yes" : "no"}</span>
      <button type="button" onClick={() => chooseView("classic")}>Klassiek</button>
      <button type="button" onClick={() => chooseView("premium")}>Nieuw</button>
      <button type="button" onClick={() => navigate(-1)}>Terug</button>
    </>
  );
}

const renderHarness = () =>
  render(
    <MemoryRouter
      initialEntries={["/admin/pitwall-test?pitwallView=classic", "/admin/pitwall-test?pitwallView=classic"]}
      initialIndex={1}
    >
      <Harness />
    </MemoryRouter>,
  );

let originalStorage: PropertyDescriptor | undefined;

beforeEach(() => {
  originalStorage = Object.getOwnPropertyDescriptor(window, "localStorage");
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    get: () => {
      throw new Error("storage blocked");
    },
  });
});

afterEach(() => {
  if (originalStorage) Object.defineProperty(window, "localStorage", originalStorage);
});

describe("pitwall-test instellingen — geweigerde opslag", () => {
  it("houdt een bewuste klassieke keuze vast en laat Nieuw en browser back werken", () => {
    renderHarness();

    expect(screen.getByTestId("view").textContent).toBe("classic");
    expect(screen.getByTestId("override").textContent).toBe("yes");

    // Opruimen van de URL-param mag de keuze niet naar de (geweigerde) opslag terugzetten.
    fireEvent.click(screen.getByRole("button", { name: "Klassiek" }));
    expect(screen.getByTestId("view").textContent).toBe("classic");
    expect(screen.getByTestId("override").textContent).toBe("no");

    fireEvent.click(screen.getByRole("button", { name: "Nieuw" }));
    expect(screen.getByTestId("view").textContent).toBe("premium");

    // Browser back naar de vorige URL met noodoverride wint weer.
    fireEvent.click(screen.getByRole("button", { name: "Terug" }));
    expect(screen.getByTestId("view").textContent).toBe("classic");
    expect(screen.getByTestId("override").textContent).toBe("yes");
  });
});
