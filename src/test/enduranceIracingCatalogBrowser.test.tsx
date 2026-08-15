import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IRacingEventCatalog } from "@/features/endurance/calendar/IRacingEventCatalog";
import { LanguageProvider } from "@/i18n/LanguageContext";

const mutateAsync = vi.fn(async () => "local-event-portimao");
const setSlotInterest = vi.fn();
const setEventInterest = vi.fn();
const localClassIds = { current: ["GTP", "LMP2", "GT3"] };
const authRoles = { isSuperAdmin: false, isEnduranceManager: true };
const officialPosterUrl = "https://www.iracing.com/wp-content/uploads/2025/12/iRSE-2026-Portimao-1000.png";

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "member" }, ...authRoles }) }));
vi.mock("@/features/endurance/calendar/InviteePicker", () => ({ InviteePicker: () => <div>Uitnodigingen</div> }));
vi.mock("@/features/endurance/repository/iracingEventsRepository", () => ({
  useIRacingEnduranceCatalog: () => ({
    data: [{
      id: "event-portimao", source_key: "iracing:2026:portimao-1000", name: "Portimão 1000", year: 2026,
      circuit: "Algarve International Circuit", configuration: "Grand Prix", event_start_date: "2026-08-14",
      event_end_date: "2026-08-15", duration_minutes: null, class_ids: ["HPD", "GT1", "GT2"], local_class_ids: localClassIds.current,
      local_car_ids: ["hpd-arx-01c", "chevrolet-corvette-c6r", "aston-martin-dbr9-gt1", "ford-gt-gt2-gt3"],
      cars: [{ sourceKey: "hrc-arx01c-feature", name: "HPD ARX-01c", imageUrl: null, officialClassId: "HPD" }], team_event: true,
      official_url: "https://www.iracing.com/special-events/", poster_url: officialPosterUrl, availability_status: "exact_slots",
      source_updated_at: null, last_seen_at: "2026-08-13T08:00:00Z", active: true, selectedEventId: null, selectedSlotId: null,
      slots: ["00:00", "09:00", "14:00", "18:00", "22:00"].map((label, index) => ({
        id: `slot-${index}`, catalog_event_id: "event-portimao", source_slot_key: `slot-${index}`,
        session_start_at: `2099-08-15T${label}:00Z`, practice_start_at: null, practice_duration_minutes: 30,
        qualifying_start_at: null, qualifying_duration_minutes: 8, transition_duration_minutes: null,
        estimated_race_start_at: null, race_duration_minutes: null, race_lap_limit: 215,
        session_duration_minutes: null, session_timing_status: "partial", label, active: true,
      })),
    }, {
      id: "event-southern", source_key: "iracing:2026:southern-500", name: "Southern 500", year: 2026,
      circuit: "Darlington Raceway", configuration: null, event_start_date: "2026-09-02", event_end_date: "2026-09-07",
      duration_minutes: null, class_ids: ["NASCAR CUP SERIES"], local_class_ids: [], local_car_ids: [], cars: [], team_event: false,
      official_url: "https://www.iracing.com/special-events/", poster_url: null, availability_status: "date_only",
      source_updated_at: null, last_seen_at: "2026-08-13T08:00:00Z", active: true, selectedEventId: null, selectedSlotId: null, slots: [],
    }], isLoading: false, isError: false, error: null,
  }),
  useActivateIRacingEnduranceSlot: () => ({ mutateAsync, isPending: false }),
  useIRacingSlotInterestSummary: () => ({ data: [
    { catalog_event_id: "event-portimao", catalog_slot_id: "slot-0", interested_count: 2, is_current_user_interested: true },
    { catalog_event_id: "event-portimao", catalog_slot_id: "slot-1", interested_count: 1, is_current_user_interested: false },
  ] }),
  useIRacingSlotInterestMembers: () => ({ data: [
    { catalog_slot_id: "slot-0", user_id: "driver-a", iracing_name: "Driver A", display_name: "A" },
    { catalog_slot_id: "slot-0", user_id: "driver-b", iracing_name: null, display_name: "Driver B" },
  ] }),
  useSetIRacingSlotInterest: () => ({ mutate: setSlotInterest, isPending: false, variables: undefined }),
  useIRacingEventInterestSummary: () => ({ data: [{ catalog_event_id: "event-southern", interested_count: 3, is_current_user_interested: false }] }),
  useSetIRacingEventInterest: () => ({ mutate: setEventInterest, isPending: false }),
  useIRacingManagerInterestOverview: () => ({ data: [
    { catalog_event_id: "event-portimao", interested_count: 2 },
    { catalog_event_id: "event-southern", interested_count: 3 },
  ] }),
}));

const renderCatalog = (language: "nl" | "en" = "nl") => {
  localStorage.setItem("3sm-language", language);
  return render(<LanguageProvider><MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><IRacingEventCatalog /></MemoryRouter></LanguageProvider>);
};

describe("iRacing Endurance catalogus browserflow", () => {
  beforeEach(() => {
    mutateAsync.mockClear(); setSlotInterest.mockClear(); setEventInterest.mockClear();
    localClassIds.current = ["GTP", "LMP2", "GT3"]; localStorage.clear();
    authRoles.isSuperAdmin = false; authRoles.isEnduranceManager = true;
  });

  it("scrollt automatisch naar het bevestigingspaneel bij tijdslotkeuze (vele slots)", async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    renderCatalog();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Details voor Portimão 1000 bekijken" })); });
    expect(scrollIntoView).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: "Deze gaan we rijden" })[4]); });
    // De modal moet naar het (onderaan geplaatste) bevestigingspaneel scrollen
    // zodra een tijdslot wordt gekozen, zodat een manager met veel sloten het
    // formulier direct ziet in plaats van erheen te moeten scrollen.
    expect(scrollIntoView).toHaveBeenCalled();
  });

  it("rendert de catalogusgrid in volgorde van het eerstvolgende startmoment", () => {
    renderCatalog();
    // Southern 500 (event_start 2026-09-02, geen slots) valt terug op zijn datum;
    // Portimão heeft slots in 2099. Southern's eerstvolgende moment is dus eerder,
    // dus Southern moet vóór Portimão in de grid staan.
    const southern = screen.getByRole("button", { name: "Details voor Southern 500 bekijken" });
    const portimao = screen.getByRole("button", { name: "Details voor Portimão 1000 bekijken" });
    const position = southern.compareDocumentPosition(portimao);
    // DOCUMENT_POSITION_FOLLOWING (4): southern staat eerder in de DOM dan portimao.
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("rendert eventkaarten, vijf tijdsloten en opent de managerbevestiging", async () => {
    renderCatalog();
    expect(screen.getByRole("button", { name: "Details voor Portimão 1000 bekijken" })).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Details voor Portimão 1000 bekijken" })); });
    expect(screen.getAllByRole("heading", { name: "Portimão 1000" })).toHaveLength(2);
    expect(screen.getAllByText("Officieel tijdslot")).toHaveLength(5);
    expect(screen.getByText((_, element) => element?.textContent === "2 coureurs kunnen dit tijdslot")).toBeInTheDocument();
    expect(screen.getByText(/Driver A, Driver B/)).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: "Ik kan dit tijdslot" })[0]); });
    expect(setSlotInterest).toHaveBeenCalledWith({ catalogSlotId: "slot-1", interested: true });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Ik kan dit tijdslot niet meer" })); });
    expect(setSlotInterest).toHaveBeenCalledWith({ catalogSlotId: "slot-0", interested: false });
    await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: "Deze gaan we rijden" })[2]); });
    expect(screen.getByRole("heading", { name: "Bevestig dit 3SM-tijdslot" })).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Bevestigen en inschrijving openen" })); });
    expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ catalogEventId: "event-portimao", catalogSlotId: "slot-2", registrationDeadline: null }));
  });

  it("rendert de officiële poster en valt terug op het lokale officiële logo", () => {
    renderCatalog();
    const poster = screen.getByRole("img", { name: "Originele iRacing-eventvisual voor Portimão 1000" });
    expect(poster).toHaveAttribute("src", officialPosterUrl);
    fireEvent.error(poster);
    expect(screen.getByRole("img", { name: "Officieel iRacing-logo voor Portimão 1000" })).toHaveAttribute("src", "/endurance-assets/official/iracing-2026-portimao-1000.png");
  });

  it("toont de technische activatieblokkade pas bij de beheerhandeling", () => {
    localClassIds.current = [];
    renderCatalog();
    fireEvent.click(screen.getByRole("button", { name: "Details voor Portimão 1000 bekijken" }));
    expect(screen.queryByText(/Activatie geblokkeerd/)).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Deze gaan we rijden" })[0]);
    expect(screen.getByText(/Activatie geblokkeerd/)).toBeInTheDocument();
  });

  it("toont managers unieke animo en biedt zonder tijdsloten hartinteresse", () => {
    renderCatalog();
    expect(screen.getByLabelText("2 geïnteresseerde coureurs")).toHaveTextContent("2");
    expect(screen.getByLabelText("3 geïnteresseerde coureurs")).toHaveTextContent("3");
    fireEvent.click(screen.getByRole("button", { name: "Details voor Southern 500 bekijken" }));
    fireEvent.click(screen.getByRole("button", { name: "Ik heb interesse in dit event" }));
    expect(setEventInterest).toHaveBeenCalledWith({ catalogEventId: "event-southern", interested: true });
  });

  it("schakelt de nieuwe interesseflow volledig naar Engels", () => {
    renderCatalog("en");
    expect(screen.getByText("5 time slots")).toBeInTheDocument();
    expect(screen.getByLabelText("2 interested drivers")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "View details for Southern 500" }));
    expect(screen.getByRole("heading", { name: "All time slots" })).toBeInTheDocument();
    expect(screen.getByText(/No times published yet/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "I am interested in this event" })).toBeInTheDocument();
    expect(screen.queryByText(/tijdslot/i)).not.toBeInTheDocument();
  });

  it("verbergt de personenbadge voor gewone leden maar houdt hartinteresse beschikbaar", () => {
    authRoles.isEnduranceManager = false;
    renderCatalog();
    expect(screen.queryByLabelText("3 geïnteresseerde coureurs")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Details voor Southern 500 bekijken" }));
    expect(screen.getByRole("button", { name: "Ik heb interesse in dit event" })).toBeInTheDocument();
  });
});
