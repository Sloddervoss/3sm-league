import { describe, expect, it } from "vitest";
import { createEnduranceSeed } from "./seed";
import { allowedEnduranceCarsForClass, enduranceCarsForClass, getEnduranceCar, IRACING_ENDURANCE_CARS, IRACING_ENDURANCE_CLASSES } from "./carCatalog";
import { getEventVehicleVotes, recommendedVehicle } from "./vehicleVoting";
import { reduceEnduranceState } from "./actions";

describe("iRacing endurance vehicle voting", () => {
  it("keeps one central, unique catalog for modern and mapped legacy endurance classes", () => {
    expect(IRACING_ENDURANCE_CLASSES).toEqual(["GTP", "LMP2", "GT3", "HPD", "GT1", "GT2"]);
    expect(new Set(IRACING_ENDURANCE_CARS.map((car) => car.id)).size).toBe(IRACING_ENDURANCE_CARS.length);
    expect(enduranceCarsForClass("GTP")).toHaveLength(5);
    expect(enduranceCarsForClass("LMP2").map((car) => car.name)).toEqual(["Dallara P217"]);
    expect(enduranceCarsForClass("HPD").map((car) => car.name)).toEqual(["HPD ARX-01c"]);
    expect(enduranceCarsForClass("GT1")).toHaveLength(2);
    expect(enduranceCarsForClass("GT2").map((car) => car.name)).toEqual(["Ford GT GT2/GT3"]);
    expect(enduranceCarsForClass("GT3")).toHaveLength(11);
    expect(getEnduranceCar("porsche-911-gt3-r-992")?.name).toBe("Porsche 911 GT3 R (992)");
    expect(allowedEnduranceCarsForClass("GT3", null)).toHaveLength(11);
    expect(allowedEnduranceCarsForClass("GT3", [])).toHaveLength(0);
  });

  it("uses active registrations as votes and requires a unique winner", () => {
    const state = createEnduranceSeed();
    const votes = getEventVehicleVotes(state.registrations, state.events[0].id);
    expect(votes.totalVoters).toBe(4);
    expect(votes.classVotes[0]).toMatchObject({ id: "GT3", votes: 4, percentage: 100 });
    expect(votes.carVotes[0]).toMatchObject({ id: "porsche-911-gt3-r-992", votes: 2, percentage: 50 });
    expect(recommendedVehicle(state.registrations, state.events[0].id)).toMatchObject({ classId: "GT3", carId: "porsche-911-gt3-r-992", tied: false });

    const tied = state.registrations.map((registration, index) => index < 2 ? { ...registration, preferredCarId: "porsche-911-gt3-r-992" } : { ...registration, preferredCarId: "bmw-m4-gt3-evo" });
    expect(recommendedVehicle(tied, state.events[0].id)).toMatchObject({ classId: "GT3", carId: null, tied: true });
  });

  it("lets only an event manager confirm a majority winner and updates every event team atomically", () => {
    const state = createEnduranceSeed();
    const mismatchedTeams = { ...state, teams: state.teams.map((team) => team.eventId === state.events[0].id ? { ...team, carId: "bmw-m4-gt3-evo" } : team) };
    const selected = reduceEnduranceState(mismatchedTeams, { type: "select_event_vehicle", eventId: state.events[0].id, classId: "GT3", carId: "porsche-911-gt3-r-992" });
    expect(selected.events[0]).toMatchObject({ selectedClassId: "GT3", selectedCarId: "porsche-911-gt3-r-992" });
    expect(selected.teams.filter((team) => team.eventId === state.events[0].id).every((team) => team.carId === "porsche-911-gt3-r-992")).toBe(true);

    const driverState = reduceEnduranceState(state, { type: "set_active_persona", personaId: "user-jaimy" });
    expect(reduceEnduranceState(driverState, { type: "select_event_vehicle", eventId: state.events[0].id, classId: "GT3", carId: "porsche-911-gt3-r-992" })).toBe(driverState);
    expect(reduceEnduranceState(state, { type: "select_event_vehicle", eventId: state.events[0].id, classId: "GT3", carId: "ferrari-296-gt3" })).toBe(state);
    expect(reduceEnduranceState(state, { type: "select_event_vehicle", eventId: state.events[0].id, classId: "GTP", carId: "ferrari-296-gt3" })).toBe(state);
  });
});
