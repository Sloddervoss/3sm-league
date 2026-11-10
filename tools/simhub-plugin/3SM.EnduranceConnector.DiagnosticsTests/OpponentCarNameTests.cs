using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Runtime.Serialization.Json;
using System.Text;
using System.Text.Json;
using ThreeSM.EnduranceConnector;

// Bewijst de automodel-kolom per tegenstander end-to-end op het niveau dat hier
// zonder SimHub-DLL te draaien is: oude en nieuwe frames, de bronvelden
// (CarScreenName/CarScreenNameShort), de YAML-route, veilige match en de
// bedrading in de plugin. De net48-build zelf gebeurt op Beest.
internal static class OpponentCarNameTests
{
    private static object SnapshotWithYaml(string yaml)
    {
        return new { RawData = new { SessionData = yaml } };
    }

    private static object SnapshotWithDrivers(params object[] drivers)
    {
        return new { RawData = new { SessionData = new { DriverInfo = new { Drivers = drivers } } } };
    }

    private static string Serialize(object value)
    {
        var serializer = new DataContractJsonSerializer(value.GetType());
        using (var stream = new MemoryStream())
        {
            serializer.WriteObject(stream, value);
            return Encoding.UTF8.GetString(stream.ToArray());
        }
    }

    private static string FixturePath()
    {
        return Path.Combine(AppContext.BaseDirectory, "Fixtures", "driver-info-session.yml");
    }

    private static string FindSource(string relative)
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory != null)
        {
            var candidate = Path.Combine(directory.FullName, relative);
            if (File.Exists(candidate)) return candidate;
            directory = directory.Parent;
        }
        return null;
    }

    private static TelemetryEnvelopeV3 BudgetFrame(int teamPadding)
    {
        var frame = V3PayloadFixtureTests.BuildRepresentativeFrame();
        frame.Opponents = Enumerable.Range(0, 41).Select(i => new V3Opponent
        {
            Id = i == 0 ? "player" : "opponent-" + i,
            CarNumber = (i + 1).ToString(),
            DriverName = "Driver Name " + i,
            TeamName = "Team " + i + (teamPadding > 0 ? " " + new string('T', teamPadding) : string.Empty),
            CarClass = "GT3",
            CarClassId = "4011",
            Position = i + 1,
            ClassPosition = i + 1,
            Lap = 10,
            LapDistancePct = 0.123456789,
            GapToPlayerSeconds = i == 0 ? (double?)null : i * 1.234,
            GapToLeaderSeconds = i * 1.234,
            LastLapSeconds = 100.123,
            BestLapSeconds = 99.456,
            SpeedKph = 199.123456,
            InPit = false,
            Connected = true,
            IsPlayer = i == 0,
            CarName = new string('M', OpponentCarName.MaxLength),
        }).ToArray();
        return frame;
    }

    public static int Run(Action<string, bool, string> check)
    {
        var count = 0;
        void Check(string id, bool ok, string detail) { check("CARNAME-" + id, ok, detail); count++; }

        // Oud frame: geen carName-sleutel, framing en protocolVersion onveranderd.
        var oldFrame = new TelemetryEnvelopeV3
        {
            ProtocolVersion = 3,
            Sequence = 7,
            Opponents = new[]
            {
                new V3Opponent { Id = "rival", CarNumber = "31", DriverName = "Rival Driver", Connected = true }
            }
        };
        var oldJson = Serialize(oldFrame);
        Check("old-frame", oldJson.Contains("\"protocolVersion\":3") && oldJson.Contains("\"opponents\"")
            && !oldJson.Contains("\"carName\""), "oud frame blijft protocol 3 en bevat geen carName");

        // Nieuw frame: exacte contractnaam, additive naast de bestaande leden.
        var namedFrame = new TelemetryEnvelopeV3
        {
            ProtocolVersion = 3,
            Sequence = 7,
            Opponents = new[]
            {
                new V3Opponent
                {
                    Id = "rival", CarNumber = "31", DriverName = "Rival Driver",
                    CarName = "Mercedes-AMG GT3 2020", Connected = true
                }
            }
        };
        var namedJson = Serialize(namedFrame);
        using (var document = JsonDocument.Parse(namedJson))
        {
            var opponent = document.RootElement.GetProperty("opponents")[0];
            var wireName = opponent.TryGetProperty("carName", out var carName) ? carName.GetString() : null;
            Check("new-frame", document.RootElement.GetProperty("protocolVersion").GetInt32() == 3
                && wireName == "Mercedes-AMG GT3 2020",
                "nieuw frame houdt protocol 3 en draagt opponents[].carName exact");
        }

        // De producent begrenst op 120 tekens; een langere naam wordt niet afgekapt
        // (afkappen zou een andere auto suggereren) maar weggelaten.
        var exactly120 = new string('M', OpponentCarName.MaxLength);
        var tooLong = new string('M', OpponentCarName.MaxLength + 1);
        Check("clean-boundary", OpponentCarName.Clean(exactly120) == exactly120
            && OpponentCarName.Clean(tooLong) == null
            && OpponentCarName.Clean("  ") == null
            && OpponentCarName.Clean("unknown") == null
            && OpponentCarName.Clean("bad\nname") == null,
            "max 120 tekens; leeg/unknown/control worden null en niets wordt stil afgekapt");

        Check("prefer-screen", OpponentCarName.Select("Mercedes-AMG GT3 2020", "Mercedes AMG GT3") == "Mercedes-AMG GT3 2020"
            && OpponentCarName.Select(" unknown ", "Ferrari 488 GT3 Evo") == "Ferrari 488 GT3 Evo"
            && OpponentCarName.Select(null, null) == null,
            "CarScreenName eerst, CarScreenNameShort als terugval; geen klasse of devnaam");

        // Bestandsbewijs: dit is een echte sessie-YAML-vorm met DriverInfo onder
        // SessionData, niet een reflectieboom. De fixture staat in de testoutput.
        var fixture = FixturePath();
        Check("fixture-present", File.Exists(fixture), "sessie-YAML-fixture aanwezig: " + fixture);
        if (File.Exists(fixture))
        {
            var yaml = File.ReadAllText(fixture, Encoding.UTF8);
            var identities = OpponentCarName.ParseDriverInfoYaml(yaml);
            Check("yaml-parse", identities.Count == 3
                && identities[0].CarNumber == "07" && identities[0].UserName == "Vincent deVos"
                && identities[0].CarName == "Mercedes-AMG GT3 2020"
                && identities[1].CarNumber == "31" && identities[1].CarName == "Ferrari 488 GT3 Evo"
                && identities[2].CarNumber == "42" && identities[2].CarName == null,
                "YAML: 3 rijders, schermnaam + korte naam-terugval, geen CarPath/CarClass als model");

            var ratings = new RawChannelReader(SnapshotWithYaml(yaml), null).ReadDriverRatings();
            Check("yaml-reader", ratings.Count == 3
                && ratings["07"].CarName == "Mercedes-AMG GT3 2020"
                && ratings["31"].CarName == "Ferrari 488 GT3 Evo"
                && ratings["42"].CarName == null
                && ratings["07"].IRating == null,
                "bestaande reader gebruikt de YAML-route in plaats van stil null via reflectie");

            var cache1 = OpponentCarName.ParseDriverInfoYamlCached(yaml);
            var cache2 = OpponentCarName.ParseDriverInfoYamlCached(yaml);
            var changed = yaml.Replace("Mercedes-AMG GT3 2020", "Mercedes-AMG GT3 Evo");
            var cache3 = OpponentCarName.ParseDriverInfoYamlCached(changed);
            Check("yaml-cache", ReferenceEquals(cache1, cache2)
                && !ReferenceEquals(cache1, cache3)
                && cache3[0].CarName == "Mercedes-AMG GT3 Evo",
                "YAML-parse wordt per identieke sessietekst gecachet en rijderswissel/sessiewijziging herparseert");
        }

        // Objectboom blijft de primaire route en levert dezelfde schermnaam.
        var objectReader = new RawChannelReader(SnapshotWithDrivers(new
        {
            CarNumber = "07", UserName = "Vincent deVos",
            CarScreenName = "Mercedes-AMG GT3 2020", CarScreenNameShort = "Mercedes AMG GT3",
            CarPath = "mercedesamggt3", CarClassShortName = "GT3"
        }), null);
        var objectRatings = objectReader.ReadDriverRatings();
        Check("object-source", objectRatings["07"].CarName == "Mercedes-AMG GT3 2020",
            "objectboom levert CarScreenName en gebruikt CarPath/CarClass niet als model");

        // Veilige match: autonummer exact, coureur exact (wel trim/case-ongevoelig
        // zoals de bestaande ratingmatch), anders geen model.
        Check("safe-match", OpponentCarName.Resolve(objectRatings, "07", "Vincent deVos") == "Mercedes-AMG GT3 2020"
            && OpponentCarName.Resolve(objectRatings, "07", "Andere Coureur") == null
            && OpponentCarName.Resolve(objectRatings, "7", "Vincent deVos") == null
            && OpponentCarName.Resolve(objectRatings, null, "Vincent deVos") == null,
            "CarNumber exact en UserName match; verkeerde auto of coureur geeft null");

        // ambiguïteit: twee DriverInfo-rijen voor hetzelfde autonummer mogen nooit
        // willekeurig een model kiezen.
        var ambiguousYaml = "DriverInfo:\n Drivers:\n"
            + " - CarNumber: \"07\"\n   UserName: Eerste Coureur\n   CarScreenName: Auto A\n"
            + " - CarNumber: \"07\"\n   UserName: Tweede Coureur\n   CarScreenName: Auto B\n";
        var ambiguousRatings = new RawChannelReader(SnapshotWithYaml(ambiguousYaml), null).ReadDriverRatings();
        Check("ambiguous", ambiguousRatings.Count == 0
            && OpponentCarName.Resolve(ambiguousRatings, "07", "Eerste Coureur") == null,
            "dubbel autonummer wordt ambigu en levert geen model of rating");

        var dictionary = new Dictionary<string, object>
        {
            { "RawData", new Dictionary<string, object>
                {
                    { "SessionData", new Dictionary<string, object>
                        {
                            { "DriverInfo", new Dictionary<string, object>
                                {
                                    { "Drivers", new[] { new Dictionary<string, object>
                                        {
                                            { "CarNumber", "42" }, { "UserName", "Dictionary Driver" },
                                            { "CarScreenName", "Porsche 911 GT3 R" }
                                        } } }
                                }
                            }
                        }
                    }
                }
            }
        };
        Check("dictionary-source", new RawChannelReader(dictionary, null).ReadDriverRatings()["42"].CarName == "Porsche 911 GT3 R",
            "bestaande dictionaryvorm van de sessiebron werkt ook voor carName");

        // Worst-case veldgroei: 40 rijen met elk 120 tekens blijft binnen het
        // bestaande producentbudget; het veld is één string en geen expansie.
        var opponents = new List<V3Opponent>();
        for (var i = 0; i < 40; i++)
            opponents.Add(new V3Opponent
            {
                Id = "opponent-" + i, CarNumber = (i + 1).ToString(), DriverName = "Driver " + i,
                CarName = new string('M', OpponentCarName.MaxLength), Connected = true
            });
        var budgetFrame = new TelemetryEnvelopeV3 { ProtocolVersion = 3, Sequence = 1, Opponents = opponents.ToArray() };
        var budgetBytes = Encoding.UTF8.GetByteCount(Serialize(budgetFrame));
        Check("payload-bound", budgetBytes <= 24000,
            "40 x 120 tekens blijft binnen 24000 B: " + budgetBytes + " B");

        // 40 tegenstanders + de eigen auto (player), elk met 120 modeltekens, in een
        // volledig frame met banden/vehicle/pit-anker. De modellen zijn optioneel: als
        // het budget krap is gaan ze eerst naar null en blijven de opponentstabel, de
        // player-rij en de core/telemeterie staan. Het budget zelf blijft 24000.
        var fullFrame = BudgetFrame(110);
        var fullBefore = Encoding.UTF8.GetByteCount(Serialize(fullFrame));
        var limited = V3PayloadBudget.Trim(fullFrame, frame => Serialize(frame), 24000);
        var fullAfter = Encoding.UTF8.GetByteCount(limited.Body);
        using (var document = JsonDocument.Parse(limited.Body))
        {
            var rows = document.RootElement.GetProperty("opponents");
            var player = rows.EnumerateArray().FirstOrDefault(row =>
                row.TryGetProperty("id", out var id) && id.GetString() == "player");
            var namesPresent = rows.EnumerateArray().Any(row => row.TryGetProperty("carName", out _));
            Check("budget-40-plus-player", fullBefore > 24000 && fullAfter <= 24000
                && rows.GetArrayLength() == 41 && !namesPresent
                && limited.Stages.Count == 1 && limited.Stages[0] == "carName"
                && player.ValueKind == JsonValueKind.Object
                && player.GetProperty("isPlayer").GetBoolean()
                && player.GetProperty("position").GetInt32() == 1
                && player.GetProperty("bestLapSeconds").GetDouble() > 99
                && document.RootElement.TryGetProperty("timing", out _)
                && document.RootElement.TryGetProperty("fuel", out _)
                && document.RootElement.TryGetProperty("vehicle", out _)
                && document.RootElement.GetProperty("tyres").TryGetProperty("pitEntry", out _)
                && document.RootElement.GetProperty("tyres").TryGetProperty("carcassTempC", out _),
                "40 opponenten + player x 120: " + fullBefore + " B -> " + fullAfter
                + " B; stages=" + string.Join("+", limited.Stages)
                + "; rijen=" + rows.GetArrayLength() + "; player en core-telemeterie behouden");
        }

        // Zelfs wanneer het frame mét modellen nog onder 24000 past, mogen de
        // optionele namen de vaste 4096 B pace-ruimte niet opeten. Dit frame is
        // 23,5 kB met namen; zonder namen blijft er ruimte voor de pace-root.
        var paceFrame = BudgetFrame(0);
        var unTrimmedCore = Serialize(paceFrame);
        var paceBefore = Encoding.UTF8.GetByteCount(unTrimmedCore);
        var paceLimited = V3PayloadBudget.Trim(paceFrame, frame => Serialize(frame), 24000);
        var paceAfter = Encoding.UTF8.GetByteCount(paceLimited.Body);
        using (var document = JsonDocument.Parse(paceLimited.Body))
        {
            var rows = document.RootElement.GetProperty("opponents");
            var namesPresent = rows.EnumerateArray().Any(row => row.TryGetProperty("carName", out _));
            Check("pace-reserve", paceBefore <= 24000
                && paceBefore > 24000 - V3PayloadBudget.PaceReserveBytes
                && paceAfter <= 24000 - V3PayloadBudget.PaceReserveBytes
                && paceLimited.Stages.Count == 1
                && paceLimited.Stages[0] == "carName" && !namesPresent
                && rows.GetArrayLength() == 41,
                "23,5 kB met namen -> " + paceAfter + " B; 4096 B pace-ruimte blijft gereserveerd");
        }

        // Dezelfde frame-keuze met een echte meetrij: zonder de model-snoei past de
        // ACK/meetrij niet meer naast de 23,5 kB kern; met de snoei past hij wel.
        var temp = Path.Combine(Path.GetTempPath(), "carname-budget-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(temp);
        try
        {
            var outbox = new MeasurementOutbox(Path.Combine(temp, "outbox.json"));
            var ids = new MeasurementIdFactory();
            outbox.Enqueue(MeasurementTransportTests.Event(ids, "wear_value_changed", 90, new string('n', 2000)), out string _);
            var sender = new MeasurementSender(outbox, new HttpClient(),
                () => ConnectorCapabilities.Implemented().ToJson(),
                new MeasurementLimits { MaxFrameBodyBytes = 24000 });
            var now = new DateTime(2026, 11, 10, 22, 0, 0, DateTimeKind.Utc);
            MeasurementBatchPlan beforePlan;
            sender.BuildBody(unTrimmedCore, Encoding.UTF8.GetByteCount(unTrimmedCore), now, out beforePlan);
            MeasurementBatchPlan afterPlan;
            sender.BuildBody(paceLimited.Body, paceAfter, now, out afterPlan);
            Check("measurement-survives", beforePlan.Batch.Events.Count == 0
                && afterPlan.Batch.Events.Count == 1 && afterPlan.DeferredEvents == 0,
                "meetrij past alleen na model-snoei: voor=" + beforePlan.Batch.Events.Count
                + " na=" + afterPlan.Batch.Events.Count);
        }
        finally { Directory.Delete(temp, true); }

        // Bedrading: zonder deze regels zouden de tests groen zijn maar de plugin
        // de nieuwe kolom nooit vullen. Bronnen worden hieronder expliciet gelezen.
        var pluginPath = FindSource(Path.Combine("3SM.EnduranceConnector", "EnduranceConnectorPlugin.cs"));
        var contractPath = FindSource(Path.Combine("3SM.EnduranceConnector", "TelemetryContractsV3.cs"));
        var readerPath = FindSource(Path.Combine("3SM.EnduranceConnector", "RawChannelReader.cs"));
        var pluginProjectPath = FindSource(Path.Combine("3SM.EnduranceConnector", "3SM.EnduranceConnector.csproj"));
        var testProjectPath = FindSource(Path.Combine("3SM.EnduranceConnector.DiagnosticsTests", "3SM.EnduranceConnector.DiagnosticsTests.csproj"));
        var releasePath = FindSource("release.sh");
        Check("wiring-files", pluginPath != null && contractPath != null && readerPath != null
            && pluginProjectPath != null && testProjectPath != null && releasePath != null,
            "bronbestanden voor bedrading gevonden");

        if (pluginPath != null && contractPath != null && readerPath != null
            && pluginProjectPath != null && testProjectPath != null && releasePath != null)
        {
            var plugin = File.ReadAllText(pluginPath);
            var contract = File.ReadAllText(contractPath);
            var reader = File.ReadAllText(readerPath);
            var pluginProject = File.ReadAllText(pluginProjectPath);
            var testProject = File.ReadAllText(testProjectPath);
            var release = File.ReadAllText(releasePath);

            Check("wiring-contract", contract.Contains("[DataMember(Name = \"carName\", Order = 22, EmitDefaultValue = false)]"),
                "V3Opponent draagt carName met EmitDefaultValue=false");
            Check("wiring-call", plugin.Contains("BuildOpponentSnapshot(snapshot, rawChannels)"),
                "CaptureV3 geeft de bestaande lezer (met SessionData-propertypad) mee");
            Check("wiring-resolver", plugin.Contains("CarName = OpponentCarName.Resolve("),
                "BuildOpponentSnapshot vult CarName via de veilige match");
            Check("wiring-reader", reader.Contains("CarScreenName") && reader.Contains("ParseDriverInfoYamlCached"),
                "RawChannelReader leest CarScreenName en de YAML-route");
            Check("wiring-plugin-csproj", pluginProject.Contains("<Compile Include=\"OpponentCarName.cs\" />"),
                "nieuw puur bestand staat in de plugin-csproj");
            Check("wiring-test-csproj", testProject.Contains("OpponentCarName.cs"),
                "nieuw puur bestand wordt in de net8-tests gecompileerd");
            Check("wiring-release", release.Contains("OpponentCarName.cs"),
                "release-sync naar Beest neemt het nieuwe bestand mee");
            Check("wiring-budget", plugin.Contains("V3PayloadBudget.Trim")
                && pluginProject.Contains("<Compile Include=\"V3PayloadBudget.cs\" />")
                && testProject.Contains("V3PayloadBudget.cs")
                && release.Contains("V3PayloadBudget.cs"),
                "plugin en tests gebruiken dezelfde budgetvolgorde; release-sync neemt die mee");
        }

        return count;
    }
}
