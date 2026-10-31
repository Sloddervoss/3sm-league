using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Text.Json;
using ThreeSM.EnduranceConnector;

// FASE 1 (baseline): legt de HUIDIGE V3-payload vast.
//
// Twee lagen:
//  1. een gouden bestand (Fixtures/v3-frame-baseline.json) dat byte-voor-byte gelijk
//     moet blijven voor een representatief frame;
//  2. expliciete veldassertions per pad, zodat een afwijking leesbaar wordt in plaats
//     van "één lange regel tekst verschilt".
//
// Elke latere wijziging aan de capture wordt hier zichtbaar. Bewust wijzigen betekent:
// fixture opnieuw genereren met `--dump-v3` en de payloaddelta in de commit beschrijven.
internal static class V3PayloadFixtureTests
{
    internal static string GoldenFileName { get { return Path.Combine(AppContext.BaseDirectory, "Fixtures", "v3-frame-baseline.json"); } }

    public static int Run(Action<string, bool, string> check)
    {
        var count = 0;
        void Check(string id, bool ok, string evidence)
        {
            check(id, ok, evidence);
            count++;
        }

        var frame = BuildRepresentativeFrame();
        var json = Serialize(frame);
        var golden = File.Exists(GoldenFileName) ? File.ReadAllText(GoldenFileName, Encoding.UTF8).Trim() : null;

        Check("P01", golden != null, "gouden fixture aanwezig: " + GoldenFileName);
        Check("P02", golden != null && string.Equals(golden, json, StringComparison.Ordinal),
            golden == null
                ? "geen fixture"
                : (string.Equals(golden, json, StringComparison.Ordinal) ? "representatief frame is byte-identiek aan de baseline" : FirstDifference(golden, json)));

        // Veld-voor-veld: de waarden die de server vandaag ontvangt.
        var fields = new[]
        {
            ("protocolVersion", "3"), ("sequence", "4242"),
            ("source.simHubVersion", "\"9.3.1\""), ("source.connectorVersion", "\"0.8.0.0\""),
            ("identity.currentDriverId", "\"user-jaimy\""), ("identity.currentDriverName", "\"Jaimy Smit\""),
            ("identity.carId", "\"car-mercedes-gt3\""), ("identity.carName", "\"Mercedes-AMG GT3 2020\""),
            ("identity.trackName", "\"Road America\""), ("identity.trackConfig", "\"Full Course\""), ("identity.trackId", "42"),
            ("session.isInCar", "true"), ("session.sessionTimeSeconds", "3725.5"),
            ("session.sessionTimeRemainingSeconds", "5400.25"), ("session.sessionLapsRemaining", "87"),
            ("session.flags", "[\"checkered\",\"yellow\"]"), ("session.sessionState", "\"racing\""),
            ("session.startLights", "2"), ("session.pitLaneOpen", "true"),
            ("session.primaryFlag", "\"none\""), ("session.flagColour", "\"#000000\""),
            ("timing.currentLapElapsedSeconds", "96.125"), ("timing.lastLapTimeSeconds", "118.437"),
            ("timing.bestLapTimeSeconds", "117.903"), ("timing.completedLaps", "31"),
            ("position.position", "4"), ("position.classPosition", "2"), ("position.gapToLeaderSeconds", "12.375"),
            ("track.lapDistancePct", "0.6127"), ("track.trackSurface", "\"unknown\""), ("track.onPitRoad", "true"),
            ("fuel.fuelLitres", "48.75"), ("fuel.fuelPct", "0.5417"), ("fuel.fuelPerLapLitres", "3.412"),
            ("fuel.lapsRemaining", "14.3"), ("fuel.fuelCapacityLitres", "90"),
            ("raceState.incidents", "9"), ("raceState.incidentLimit", "25"),
            ("pitService.pitServiceFlagsRaw", "48"), ("pitService.requiredRepairSeconds", "12.3"),
            ("pitService.optionalRepairSeconds", "0"),
            ("vehicle.speedKph", "187.4"), ("vehicle.throttlePct", "82.5"), ("vehicle.brakePct", "0"),
            ("vehicle.rpm", "7120"), ("vehicle.gear", "\"4\""), ("vehicle.tyreDataMode", "\"last_available\""),
            ("vehicle.pressureUnit", "\"kPa\""), ("vehicle.temperatureUnit", "\"C\""),
            ("vehicle.frontLeft.wearPercent", "41.2"), ("vehicle.frontLeft.temperature", "84.5"),
            ("vehicle.frontLeft.pressure", "172.3"),
            ("vehicle.brakeLinePressureBar.frontLeft", "62.5"), ("vehicle.brakeLinePressureBar.frontRight", "61"),
            ("vehicle.steeringWheelAngleDeg", "-70.7"), ("vehicle.latAccelG", "1.274"), ("vehicle.longAccelG", "-0.841"),
            ("tyres.trigger", "\"sim_refresh\""), ("tyres.lap", "31"), ("tyres.sessionTimeSeconds", "3725.5"),
            ("tyres.compoundId", "4"),
            ("tyres.wearPercent.frontLeft", "[95.81,42.5,0]"),
            ("tyres.wearPercent.rearRight", "[11.25,9.5,7.75]"),
            ("tyres.carcassTempC.frontRight", "[71.5,72.25,72]"),
            ("tyres.sets.used", "2"), ("tyres.sets.available", "3"), ("tyres.sets.frontLeft", "2"),
            ("tyres.environment.trackTempC", "31.5"), ("tyres.environment.airTempC", "21.25"),
            ("tyres.environment.rubberState", "\"moderate usage\""),
            ("tyres.pitEntry.setsUsed", "1"), ("tyres.pitEntry.wearPercent.frontLeft", "[88.5,31.25,0]"),
            ("opponents[0].id", "\"user-rival\""), ("opponents[0].carNumber", "\"31\""),
            ("opponents[0].inPit", "false"), ("opponents[0].isPlayer", "false"), ("opponents[0].connected", "true"),
        };
        using (var document = JsonDocument.Parse(json))
        {
            var index = 0;
            foreach (var field in fields)
            {
                index++;
                var actual = ReadPath(document.RootElement, field.Item1);
                var ok = actual == field.Item2;
                Check("P" + (10 + index).ToString("00"), ok,
                    field.Item1 + " = " + (actual ?? "<ontbreekt>") + (ok ? string.Empty : " (verwacht " + field.Item2 + ")"));
            }
        }

        // EmitDefaultValue=false op een niet-nullable: false en 0 vallen weg uit de payload.
        using (var document = JsonDocument.Parse(json))
        {
            var session = document.RootElement.GetProperty("session");
            Check("P30", !session.TryGetProperty("isStartSequence", out _), "isStartSequence=false valt weg uit de payload");
            Check("P31", !session.TryGetProperty("flagSeverity", out _), "flagSeverity=0 valt weg uit de payload");
        }

        // Ontbrekende blokken: EmitDefaultValue=false betekent "sleutel weg", niet "null".
        var minimal = Serialize(BuildMinimalFrame());
        using (var document = JsonDocument.Parse(minimal))
        {
            Check("P40", !document.RootElement.TryGetProperty("vehicle", out _), "zonder meting staat het vehicle-blok niet in de payload");
            Check("P41", !document.RootElement.TryGetProperty("tyres", out _), "zonder meting staat het tyres-blok niet in de payload");
            Check("P42", !document.RootElement.TryGetProperty("source", out _), "zonder versies staat het source-blok niet in de payload");
            Check("P43", document.RootElement.GetProperty("session").GetProperty("flags").ValueKind == JsonValueKind.Null,
                "geen vlag = expliciete null in session.flags");
        }

        // Bewijs dat de baseline echt één-veld-gevoelig is: elke mutatie moet de gouden
        // string veranderen. Zonder deze test zou een te losse fixture niets vastleggen.
        var mutations = new (string label, Action<TelemetryEnvelopeV3> mutate)[]
        {
            ("fuel", f => f.Fuel.FuelLitres = 48.751),
            ("wear", f => f.Tyres.WearPercent.FrontLeft[0] = 95.8100001),
            ("pitService", f => f.PitService.PitServiceFlagsRaw = 49),
            ("source", f => f.Source.ConnectorVersion = "0.8.0.1"),
            ("onPitRoad", f => f.Track.OnPitRoad = false),
            ("flags", f => f.Session.Flags = new[] { "checkered", "green" }),
            ("tyres.environment", f => f.Tyres.Environment.AirTempC = 21.26),
        };
        foreach (var mutation in mutations)
        {
            var mutated = BuildRepresentativeFrame();
            mutation.mutate(mutated);
            Check("P5-" + mutation.label, !string.Equals(Serialize(mutated), json, StringComparison.Ordinal),
                "één veld wijzigen (" + mutation.label + ") verandert de payload");
        }
        return count;
    }

    // Serialiseert precies zoals de plugin dat doet (DataContractJsonSerializer, geen
    // extra instellingen), zodat de fixture de echte draadnotatie vastlegt.
    internal static string Serialize(TelemetryEnvelopeV3 value) { return SerializeObject(value, typeof(TelemetryEnvelopeV3)); }

    internal static string SerializeObject(object value, Type type)
    {
        var serializer = new System.Runtime.Serialization.Json.DataContractJsonSerializer(type);
        using (var stream = new MemoryStream())
        {
            serializer.WriteObject(stream, value);
            return Encoding.UTF8.GetString(stream.ToArray());
        }
    }

    private static string FirstDifference(string golden, string actual)
    {
        var limit = Math.Min(golden.Length, actual.Length);
        for (var i = 0; i < limit; i++)
            if (golden[i] != actual[i])
                return "eerste verschil op teken " + i + ": baseline[" + Excerpt(golden, i) + "] vs nu[" + Excerpt(actual, i) + "]";
        return "lengte verschilt: baseline=" + golden.Length + " nu=" + actual.Length;
    }

    private static string Excerpt(string text, int index)
    {
        var start = Math.Max(0, index - 40);
        var length = Math.Min(90, text.Length - start);
        return text.Substring(start, length);
    }

    private static string ReadPath(JsonElement root, string path)
    {
        var current = root;
        foreach (var segment in path.Split('.'))
        {
            var name = segment;
            var bracket = name.IndexOf('[');
            if (bracket >= 0)
            {
                var close = name.IndexOf(']', bracket);
                if (close < 0) return null;
                var position = int.Parse(name.Substring(bracket + 1, close - bracket - 1));
                name = name.Substring(0, bracket);
                if (name.Length > 0 && !current.TryGetProperty(name, out current)) return null;
                if (current.ValueKind != JsonValueKind.Array || position >= current.GetArrayLength()) return null;
                current = current[position];
            }
            else if (name.Length > 0 && !current.TryGetProperty(name, out current)) return null;
        }
        return current.GetRawText();
    }

    // Eén representatief endurance-frame: pitstraat, gebruikte banden, reparatie open,
    // alle optionele blokken gevuld.
    internal static TelemetryEnvelopeV3 BuildRepresentativeFrame()
    {
        return new TelemetryEnvelopeV3
        {
            ProtocolVersion = 3,
            Sequence = 4242,
            CapturedAt = "2026-10-31T09:15:00.0000000Z",
            TransportSessionId = "simhub-0123456789abcdef0123456789abcdef",
            Source = new V3Source { SimHubVersion = "9.3.1", ConnectorVersion = "0.8.0.0" },
            Identity = new V3Identity
            {
                TrackId = 42,
                CurrentDriverId = "user-jaimy",
                CurrentDriverName = "Jaimy Smit",
                CarId = "car-mercedes-gt3",
                CarName = "Mercedes-AMG GT3 2020",
                TrackName = "Road America",
                TrackConfig = "Full Course",
            },
            Session = new V3Session
            {
                IsInCar = true,
                SessionTimeSeconds = 3725.5,
                SessionTimeRemainingSeconds = 5400.25,
                SessionLapsRemaining = 87,
                Flags = new[] { "checkered", "yellow" },
                SessionState = "racing",
                PrimaryFlag = "none",
                FlagColour = "#000000",
                FlagSeverity = 0,
                StartLights = 2,
                PitLaneOpen = true,
                IsStartSequence = false,
            },
            Timing = new V3Timing
            {
                CurrentLapElapsedSeconds = 96.125,
                LastLapTimeSeconds = 118.437,
                BestLapTimeSeconds = 117.903,
                CompletedLaps = 31,
            },
            Position = new V3Position { Position = 4, ClassPosition = 2, GapToLeaderSeconds = 12.375 },
            Track = new V3Track { LapDistancePct = 0.6127, TrackSurface = "unknown", OnPitRoad = true },
            Fuel = new V3Fuel
            {
                FuelLitres = 48.75,
                FuelPct = 0.5417,
                FuelPerLapLitres = 3.412,
                LapsRemaining = 14.3,
                FuelCapacityLitres = 90,
            },
            RaceState = new V3RaceState { Incidents = 9, IncidentLimit = 25 },
            PitService = new V3PitService { PitServiceFlagsRaw = 48, RequiredRepairSeconds = 12.3, OptionalRepairSeconds = 0 },
            Opponents = new[]
            {
                new V3Opponent
                {
                    Id = "user-rival", CarNumber = "31", DriverName = "Rival Driver", TeamName = "Team Blue",
                    CarClass = "GT3", CarClassId = "4011", Position = 5, ClassPosition = 3, Lap = 31,
                    LapDistancePct = 0.5881, GapToPlayerSeconds = -2.5, GapToLeaderSeconds = 9.875,
                    LastLapSeconds = 119.062, BestLapSeconds = 118.114, InPit = false, SpeedKph = 182.5,
                    Connected = true, IsPlayer = false,
                },
            },
            Vehicle = new V3Vehicle
            {
                SpeedKph = 187.4, ThrottlePct = 82.5, BrakePct = 0, Rpm = 7120, Gear = "4",
                Sector1Seconds = 38.125, Sector2Seconds = 41.5, Sector3Seconds = 38.812,
                TyreDataMode = "last_available", PressureUnit = "kPa", TemperatureUnit = "C",
                FrontLeft = new V3Tyre { WearPercent = 41.2, Temperature = 84.5, Pressure = 172.3 },
                FrontRight = new V3Tyre { WearPercent = 38.75, Temperature = 85.25, Pressure = 171.8 },
                RearLeft = new V3Tyre { WearPercent = 33.5, Temperature = 79.5, Pressure = 168.4 },
                RearRight = new V3Tyre { WearPercent = 31.25, Temperature = 80.25, Pressure = 167.9 },
                BrakeLinePressureBar = new V3WheelValues { FrontLeft = 62.5, FrontRight = 61.0 },
                SteeringWheelAngleDeg = -70.7,
                LatAccelG = 1.274,
                LongAccelG = -0.841,
            },
            Tyres = new V3Tyres
            {
                ObservedAt = "2026-10-31T09:14:55.0000000Z",
                SessionTimeSeconds = 3725.5,
                Lap = 31,
                Trigger = "sim_refresh",
                WearPercent = new V3TyreZones
                {
                    FrontLeft = new double?[] { 95.81, 42.5, 0 },
                    FrontRight = new double?[] { 61.25, 60.75, 60.5 },
                    RearLeft = new double?[] { 18.5, 17.25, 16.75 },
                    RearRight = new double?[] { 11.25, 9.5, 7.75 },
                },
                CarcassTempC = new V3TyreZones
                {
                    FrontLeft = new double?[] { 70.5, 71.25, 71 },
                    FrontRight = new double?[] { 71.5, 72.25, 72 },
                    RearLeft = new double?[] { 66.25, 66.75, 66.5 },
                    RearRight = new double?[] { 65.5, 65.75, 65.5 },
                },
                Sets = new V3TyreSets { Used = 2, Available = 3, FrontLeft = 2, FrontRight = 2, RearLeft = 2, RearRight = 2 },
                CompoundId = 4,
                Environment = new V3TyreEnvironment { TrackTempC = 31.5, AirTempC = 21.25, RubberState = "moderate usage" },
                PitEntry = new V3TyrePitEntry
                {
                    ObservedAt = "2026-10-31T09:10:00.0000000Z",
                    SessionTimeSeconds = 3430.0,
                    Lap = 28,
                    SetsUsed = 1,
                    WearPercent = new V3TyreZones
                    {
                        FrontLeft = new double?[] { 88.5, 31.25, 0 },
                        FrontRight = new double?[] { 55.5, 54.75, 54.5 },
                        RearLeft = new double?[] { 15.25, 14.5, 14 },
                        RearRight = new double?[] { 9.75, 8.5, 7 },
                    },
                    CarcassTempC = new V3TyreZones
                    {
                        FrontLeft = new double?[] { 68.5, 69.25, 69 },
                        FrontRight = new double?[] { 69.5, 70.25, 70 },
                        RearLeft = new double?[] { 64.25, 64.75, 64.5 },
                        RearRight = new double?[] { 63.5, 63.75, 63.5 },
                    },
                },
            },
        };
    }

    // Zelfde frame zonder de optionele blokken (0.6.1.1-vorm): die sleutels horen volledig
    // te verdwijnen, niet als null te verschijnen.
    internal static TelemetryEnvelopeV3 BuildMinimalFrame()
    {
        var frame = BuildRepresentativeFrame();
        frame.Source = null;
        frame.Vehicle = null;
        frame.Tyres = null;
        frame.Opponents = null;
        frame.Session.Flags = null;
        return frame;
    }
}
