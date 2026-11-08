using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.Serialization.Json;
using System.Text;
using ThreeSM.EnduranceConnector;

internal static class DriverRatingTests
{
    private static object Snapshot(params object[] drivers)
    {
        return new { RawData = new { SessionData = new { SessionInfo = new { }, DriverInfo = new { Drivers = drivers } } } };
    }

    public static int Run(Action<string, bool, string> check)
    {
        int count = 0;
        void Check(string id, bool ok, string detail) { check("RATING-" + id, ok, detail); count++; }
        var driver = new { CarNumber = "007", CarIdx = 7, UserName = "Test Driver", IRating = 3240, LicLevel = 18, LicSubLevel = 345 };
        var ratings = new RawChannelReader(Snapshot(driver), null).ReadDriverRatings();
        var rating = ratings["007"];
        Check("read", rating.IRating == 3240 && rating.SafetyRating == 3.45 && rating.LicenseClass == "A", "sessiedata bevat iRating, licentieklasse en SR/100");
        Check("identity", rating.Matches("Test Driver") && !rating.Matches("Next Driver") && !rating.Matches(null) && !ratings.ContainsKey("7"), "autonummer blijft exact; andere of ontbrekende coureur krijgt geen oude rating");
        Check("car-index", new RawChannelReader(Snapshot(driver), null).ReadCarIndices()["007"] == 7, "ReadCarIndices leest het echte SessionData.DriverInfo-pad");

        var legacy = new { RawData = new { SessionData = new { SessionInfo = new { DriverInfo = new { Drivers = new[] { driver } } } } } };
        var legacyReader = new RawChannelReader(legacy, null);
        Check("legacy", legacyReader.ReadDriverRatings()["007"].IRating == 3240 && legacyReader.ReadCarIndices()["007"] == 7, "oud genest DriverInfo-pad blijft terugval voor beide lezers");

        var stale = new { CarNumber = "007", CarIdx = 3, UserName = "Old Driver", IRating = 900, LicLevel = 5, LicSubLevel = 200 };
        var mixed = new { RawData = new { SessionData = new { DriverInfo = new { Drivers = new[] { driver } }, SessionInfo = new { DriverInfo = new { Drivers = new[] { stale } } } } } };
        var mixedReader = new RawChannelReader(mixed, null);
        Check("primary-first", mixedReader.ReadDriverRatings()["007"].Matches("Test Driver") && mixedReader.ReadCarIndices()["007"] == 7, "SDK-pad krijgt voorrang boven verouderde geneste gegevens");
        var emptyPrimary = new { RawData = new { SessionData = new { DriverInfo = new { Drivers = new object[0] }, SessionInfo = new { DriverInfo = new { Drivers = new[] { stale } } } } } };
        var emptyReader = new RawChannelReader(emptyPrimary, null);
        Check("empty-primary", emptyReader.ReadDriverRatings().Count == 0 && emptyReader.ReadCarIndices().Count == 0, "lege actuele lijst valt niet terug op oude rijderdata");

        var next = new { CarNumber = "007", UserName = "Next Driver", IRating = 1940, LicLevel = 13, LicSubLevel = 287 };
        var fresh = new RawChannelReader(Snapshot(next), null).ReadDriverRatings()["007"];
        Check("swap", fresh.Matches("Next Driver") && !fresh.Matches("Test Driver") && fresh.IRating == 1940 && fresh.SafetyRating == 2.87 && fresh.LicenseClass == "B", "rijderswissel leest nieuwe gegevens zonder cache");
        Check("missing", new RawChannelReader(Snapshot(), null).ReadDriverRatings().Count == 0 && new RawChannelReader(null, null).ReadDriverRatings().Count == 0, "verdwenen sessiedata neemt geen rating uit vorig frame mee");
        Check("ambiguous", new RawChannelReader(Snapshot(driver, next, driver), null).ReadDriverRatings().Count == 0, "dubbele auto-identiteit kiest nooit willekeurig een rijder");

        var classes = new[] { "R", "D", "C", "B", "A", "Pro", "WC" };
        for (int level = 1; level <= 28; level++)
        {
            var sample = new { CarNumber = "1", UserName = "Driver", LicLevel = level, LicSubLevel = 499, IRating = 1 };
            var mapped = new RawChannelReader(Snapshot(sample), null).ReadDriverRatings()["1"];
            Check("license-" + level, mapped.LicenseClass == classes[(level - 1) / 4] && mapped.SafetyRating == 4.99, "licentiegroep en bovengrens SR");
        }
        var invalid = new { CarNumber = "1", UserName = "Driver", IRating = double.NaN, LicLevel = 29, LicSubLevel = 500 };
        var bad = new RawChannelReader(Snapshot(invalid), null).ReadDriverRatings()["1"];
        Check("invalid", bad.IRating == null && bad.SafetyRating == null && bad.LicenseClass == null, "ongeldige ratings blijven onbekend");
        var zero = new { CarNumber = "1", UserName = "Driver", IRating = 0, LicLevel = 1, LicSubLevel = 0 };
        var rookie = new RawChannelReader(Snapshot(zero), null).ReadDriverRatings()["1"];
        Check("zero", rookie.IRating == null && rookie.SafetyRating == 0 && rookie.LicenseClass == "R", "rookie iRating 0 is onbekend; SR 0.00 is een echte waarde");
        var absent = new { CarNumber = "1", UserName = "Driver" };
        var absentRating = new RawChannelReader(Snapshot(absent), null).ReadDriverRatings()["1"];
        Check("old-source", absentRating.IRating == null && absentRating.SafetyRating == null && absentRating.LicenseClass == null, "oude of ontbrekende getters leveren alleen onbekende ratings");

        object dictionary = new Dictionary<string, object> {
            {"RawData", new Dictionary<string, object> {{"SessionData", new Dictionary<string, object> {
                {"DriverInfo", new Dictionary<string, object> {
                    {"Drivers", new[] {new Dictionary<string, object> {{"CarNumber", "42"}, {"UserName", "Dictionary Driver"}, {"IRating", 2500}, {"LicLevel", 9}, {"LicSubLevel", 312}}}}
                }}
            }}}}
        };
        var dictRating = new RawChannelReader(dictionary, null).ReadDriverRatings()["42"];
        Check("dictionary", dictRating.IRating == 2500 && dictRating.LicenseClass == "C" && dictRating.SafetyRating == 3.12, "dictionaryvorm van de bestaande sessiebron werkt ook");

        var serializer = new DataContractJsonSerializer(typeof(V3Opponent));
        using (var stream = new MemoryStream())
        {
            serializer.WriteObject(stream, new V3Opponent { Id = "car", IRating = rating.IRating, SafetyRating = rating.SafetyRating, LicenseClass = rating.LicenseClass });
            var wire = Encoding.UTF8.GetString(stream.ToArray());
            Check("wire", wire.Contains("\"irating\":3240") && wire.Contains("\"safetyRating\":3.45") && wire.Contains("\"licenseClass\":\"A\""), "productie-DTO publiceert de drie velden met contractnamen");
        }
        return count;
    }
}
