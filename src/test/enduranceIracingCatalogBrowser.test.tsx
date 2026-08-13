import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IRacingEventCatalog } from "@/features/endurance/calendar/IRacingEventCatalog";

const mutateAsync = vi.fn(async () => "local-event-portimao");
const localClassIds = { current: ["GTP", "LMP2", "GT3"] };

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "manager" }, isSuperAdmin: false, isEnduranceManager: true }) }));
vi.mock("@/features/endurance/calendar/InviteePicker", () => ({ InviteePicker: () => <div>Uitnodigingen</div> }));
vi.mock("@/features/endurance/repository/iracingEventsRepository", () => ({
  useIRacingEnduranceCatalog: () => ({
    data: [{
      id: "event-portimao", source_key: "iracing:6578", name: "Portimão 1000", year: 2026,
      circuit: "Algarve International Circuit", configuration: "Grand Prix", event_start_date: "2026-08-14",
      event_end_date: "2026-08-15", duration_minutes: null, class_ids: ["HPD", "GT1", "GT2"], local_class_ids: localClassIds.current,
      local_car_ids: ["hpd-arx-01c", "chevrolet-corvette-c6r", "aston-martin-dbr9-gt1", "ford-gt-gt2-gt3"],
      cars: [{ sourceKey: "hrc-arx01c-feature", name: "HPD ARX-01c", imageUrl: null, officialClassId: "HPD" }], team_event: true,
      official_url: "https://www.iracing.com/special-events/", poster_url: null, availability_status: "exact_slots",
      source_updated_at: null, last_seen_at: "2026-08-13T08:00:00Z", active: true, selectedEventId: null, selectedSlotId: null,
      slots: ["00:00", "09:00", "14:00", "18:00", "22:00"].map((label, index) => ({
        id: `slot-${index}`, catalog_event_id: "event-portimao", source_slot_key: `slot-${index}`,
        session_start_at: `2026-08-15T${label}:00Z`, practice_start_at: null, practice_duration_minutes: 30,
        qualifying_start_at: null, qualifying_duration_minutes: 8, transition_duration_minutes: null,
        estimated_race_start_at: null, race_duration_minutes: null, race_lap_limit: 215,
        session_timing_status: "partial", label, active: true,
      })),
    }], isLoading: false, isError: false, error: null,
  }),
  useActivateIRacingEnduranceSlot: () => ({ mutateAsync, isPending: false }),
  useIRacingInterestSummary: () => ({ data: [], isLoading: false }),
  useSetIRacingInterest: () => ({ mutate: vi.fn(), isPending: false }),
}));

describe("iRacing Endurance catalogus browserflow", () => {
  beforeEach(() => { mutateAsync.mockClear(); localClassIds.current = ["GTP", "LMP2", "GT3"]; });

  it("rendert één kaart met vijf slots en opent de managerbevestiging", async () => {
    render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><IRacingEventCatalog /></MemoryRouter>);
    expect(screen.getByRole("button", { name: "Details voor Portimão 1000 bekijken" })).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Details voor Portimão 1000 bekijken" })); });
    expect(screen.getAllByRole("heading", { name: "Portimão 1000" })).toHaveLength(2);
    expect(screen.getAllByText("Officieel timeslot")).toHaveLength(5);
    expect(screen.getByText("HPD · GT1 · GT2")).toBeInTheDocument();

    await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: "Deze gaan we rijden" })[2]); });
    expect(screen.getByRole("heading", { name: "Bevestig dit 3SM-timeslot" })).toBeInTheDocument();
    expect(screen.getByText(/Geen vaste voorlooptijd/)).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Bevestigen en inschrijving openen" })); });
    expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      catalogEventId: "event-portimao", catalogSlotId: "slot-2", registrationDeadline: null,
    }));
  });

  it("blokkeert activatie zichtbaar zolang geen expliciete lokale klassemapping bestaat", () => {
    localClassIds.current = [];
    render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><IRacingEventCatalog /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Details voor Portimão 1000 bekijken" }));
    expect(screen.getByText(/Activatie geblokkeerd/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Deze gaan we rijden" })).not.toBeInTheDocument();
  });
});
