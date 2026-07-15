import type { EnduranceState } from "./types";
import { ENDURANCE_SCHEMA_VERSION } from "./types";

const eventId = "event-road-america-6h";
const teamOrange = "team-orange-31";
const teamGraphite = "team-graphite-73";

export const createEnduranceSeed = (): EnduranceState => ({
  schemaVersion: ENDURANCE_SCHEMA_VERSION,
  activePersonaId: "user-vincent",
  personas: [
    { id: "user-vincent", name: "Vincent", role: "endurance_admin", timezone: "Europe/Amsterdam" },
    { id: "user-jaimy", name: "Jaimy Peters", role: "driver", timezone: "Europe/Amsterdam" },
    { id: "user-ricky", name: "Ricky", role: "team_manager", timezone: "Europe/Amsterdam" },
    { id: "user-sven", name: "Sven", role: "driver", timezone: "Europe/Amsterdam" },
    { id: "user-milan", name: "Milan", role: "reserve", timezone: "Europe/Amsterdam" },
    { id: "user-guest", name: "Niet-aangemeld lid", role: "driver", timezone: "Europe/Amsterdam" },
  ],
  events: [{
    id: eventId,
    name: "6 Hours of Road America",
    circuit: "Road America",
    configuration: "Full Course",
    startAt: "2026-07-25T11:00:00.000Z",
    endAt: "2026-07-25T17:00:00.000Z",
    briefingStartAt: "2026-07-25T10:00:00.000Z",
    expectedEndAt: "2026-07-25T17:30:00.000Z",
    registrationDeadline: "2026-07-20T21:59:00.000Z",
    slots: [
      { id: "slot-0800", startAt: "2026-07-25T06:00:00.000Z", label: "08:00" },
      { id: "slot-1300", startAt: "2026-07-25T11:00:00.000Z", label: "13:00" },
      { id: "slot-1800", startAt: "2026-07-25T16:00:00.000Z", label: "18:00" },
    ],
    classIds: ["GTP", "LMP2", "GT3"],
    selectedClassId: "GT3",
    selectedCarId: "porsche-911-gt3-r-992",
    maxDriversPerCar: 4,
    visibility: "open",
    status: "planning",
    source: "manual",
    invitedUserIds: ["user-milan"],
    managerIds: ["user-vincent"],
    createdAt: "2026-07-10T18:00:00.000Z",
    updatedAt: "2026-07-14T20:00:00.000Z",
  }],
  registrations: [
    { id: "reg-jaimy", eventId, userId: "user-jaimy", status: "confirmed", classPreference: "GT3", preferredCarId: "porsche-911-gt3-r-992", slotId: "slot-1300", maxStints: 3, nightDriving: true, willingToStart: true, willingToFinish: false, notes: "Kan de start nemen.", registeredAt: "2026-07-11T18:00:00.000Z" },
    { id: "reg-ricky", eventId, userId: "user-ricky", status: "confirmed", classPreference: "GT3", preferredCarId: "bmw-m4-gt3-evo", slotId: "slot-1300", maxStints: 3, nightDriving: true, willingToStart: false, willingToFinish: true, notes: "Teammanager auto 31.", registeredAt: "2026-07-11T19:00:00.000Z" },
    { id: "reg-sven", eventId, userId: "user-sven", status: "confirmed", classPreference: "GT3", preferredCarId: "porsche-911-gt3-r-992", slotId: "slot-1300", maxStints: 3, nightDriving: false, willingToStart: false, willingToFinish: true, notes: "Vanaf 14:30 beschikbaar.", registeredAt: "2026-07-12T10:00:00.000Z" },
    { id: "reg-milan", eventId, userId: "user-milan", status: "reserve", classPreference: "GT3", preferredCarId: "ferrari-296-gt3", slotId: "slot-1300", maxStints: 2, nightDriving: true, willingToStart: true, willingToFinish: true, notes: "Stand-by als reserve.", registeredAt: "2026-07-12T12:00:00.000Z" },
  ],
  availability: [
    { id: "av-jaimy-1", eventId, userId: "user-jaimy", startAt: "2026-07-25T10:00:00.000Z", endAt: "2026-07-25T14:00:00.000Z", type: "preferred", note: "Graag eerste helft." },
    { id: "av-jaimy-2", eventId, userId: "user-jaimy", startAt: "2026-07-25T15:30:00.000Z", endAt: "2026-07-25T17:30:00.000Z", type: "available", note: "Opnieuw inzetbaar." },
    { id: "av-ricky-1", eventId, userId: "user-ricky", startAt: "2026-07-25T10:00:00.000Z", endAt: "2026-07-25T17:30:00.000Z", type: "available", note: "Volledige race aanwezig." },
    { id: "av-sven-1", eventId, userId: "user-sven", startAt: "2026-07-25T12:30:00.000Z", endAt: "2026-07-25T17:30:00.000Z", type: "preferred", note: "Na werk beschikbaar." },
    { id: "av-milan-1", eventId, userId: "user-milan", startAt: "2026-07-25T11:00:00.000Z", endAt: "2026-07-25T17:00:00.000Z", type: "uncertain", note: "Reserve, bevestigt op racedag." },
  ],
  paceEntries: [
    { id: "pace-jaimy", eventId, userId: "user-jaimy", circuit: "Road America", configuration: "Full Course", car: "Porsche 911 GT3 R (992)", conditions: "dry", averageLapSeconds: 128.42, medianLapSeconds: 128.31, bestLapSeconds: 127.74, bestFiveAverageSeconds: 127.98, consistencySeconds: 0.64, validLaps: 52, incidents: 3, averageStintMinutes: 48, recordedAt: "2026-07-12T20:00:00.000Z", source: "csv", notes: "Race fuel." },
    { id: "pace-ricky", eventId, userId: "user-ricky", circuit: "Road America", configuration: "Full Course", car: "Porsche 911 GT3 R (992)", conditions: "dry", averageLapSeconds: 128.88, medianLapSeconds: 128.76, bestLapSeconds: 128.12, bestFiveAverageSeconds: 128.35, consistencySeconds: 0.58, validLaps: 67, incidents: 2, averageStintMinutes: 52, recordedAt: "2026-07-13T20:00:00.000Z", source: "manual", notes: "Consistente long run." },
    { id: "pace-sven", eventId, userId: "user-sven", circuit: "Road America", configuration: "Full Course", car: "Porsche 911 GT3 R (992)", conditions: "dry", averageLapSeconds: 130.11, medianLapSeconds: 129.96, bestLapSeconds: 129.2, bestFiveAverageSeconds: 129.54, consistencySeconds: 0.89, validLaps: 23, incidents: 4, averageStintMinutes: 44, recordedAt: "2026-07-11T20:00:00.000Z", source: "manual", notes: "Nog weinig data." },
  ],
  teams: [
    { id: teamOrange, eventId, name: "3SM Orange", carId: "porsche-911-gt3-r-992", carNumber: "31", managerId: "user-ricky", livery: "3SM Endurance Orange" },
    { id: teamGraphite, eventId, name: "3SM Graphite", carId: "porsche-911-gt3-r-992", carNumber: "73", managerId: "user-vincent", livery: "3SM Endurance Graphite" },
  ],
  teamMembers: [
    { id: "tm-jaimy", teamId: teamOrange, userId: "user-jaimy", role: "driver" },
    { id: "tm-ricky", teamId: teamOrange, userId: "user-ricky", role: "manager" },
    { id: "tm-sven", teamId: teamOrange, userId: "user-sven", role: "driver" },
    { id: "tm-milan", teamId: teamOrange, userId: "user-milan", role: "reserve" },
  ],
  stints: [
    { id: "stint-1", eventId, teamId: teamOrange, driverId: "user-jaimy", originalStartAt: "2026-07-25T11:00:00.000Z", originalEndAt: "2026-07-25T12:30:00.000Z", actualStartAt: "2026-07-25T11:00:00.000Z", actualEndAt: "2026-07-25T12:30:00.000Z", expectedLaps: 42, fuelLitres: 102, tyreChange: false, doubleStint: true, notes: "Startstint", status: "confirmed" },
    { id: "stint-2", eventId, teamId: teamOrange, driverId: "user-ricky", originalStartAt: "2026-07-25T12:30:00.000Z", originalEndAt: "2026-07-25T14:00:00.000Z", actualStartAt: "2026-07-25T12:30:00.000Z", actualEndAt: "2026-07-25T14:00:00.000Z", expectedLaps: 42, fuelLitres: 102, tyreChange: true, doubleStint: true, notes: "Middenfase", status: "confirmed" },
    { id: "stint-3", eventId, teamId: teamOrange, driverId: "user-sven", originalStartAt: "2026-07-25T14:00:00.000Z", originalEndAt: "2026-07-25T15:30:00.000Z", actualStartAt: "2026-07-25T14:00:00.000Z", actualEndAt: "2026-07-25T15:30:00.000Z", expectedLaps: 41, fuelLitres: 102, tyreChange: true, doubleStint: true, notes: "Derde stint", status: "draft" },
    { id: "stint-4", eventId, teamId: teamOrange, driverId: "user-ricky", originalStartAt: "2026-07-25T15:30:00.000Z", originalEndAt: "2026-07-25T17:00:00.000Z", actualStartAt: "2026-07-25T15:30:00.000Z", actualEndAt: "2026-07-25T17:00:00.000Z", expectedLaps: 42, fuelLitres: 102, tyreChange: true, doubleStint: true, notes: "Finishstint", status: "draft" },
  ],
  planningVersions: [],
  confirmations: [],
  notifications: [
    { id: "notif-plan", userId: "user-jaimy", eventId, type: "plan_changed", title: "Planning bijgewerkt", message: "Controleer je toegewezen stints voor Road America.", privatePath: `/endurance/races/${eventId}/stints`, read: false, createdAt: "2026-07-14T20:00:00.000Z", discordStatus: "disabled" },
  ],
  auditLog: [],
});
