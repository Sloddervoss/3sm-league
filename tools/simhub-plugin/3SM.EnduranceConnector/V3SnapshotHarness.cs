using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.Serialization.Json;
using System.Text;

namespace ThreeSM.EnduranceConnector.Harness
{
    // Standalone harness: builds V3 snapshots from hardcoded test data (through the
    // real EnduranceConnectorPlugin.CreateFromRaw mapping) and serializes them with
    // DataContractJsonSerializer. Prints the Phase A JSON to stdout and writes it to
    // /tmp/v3-output.json. Run on a machine with the plugin build (no .NET needed on
    // the CI server); the golden fixtures are validated cross-language by vitest.
    internal static class Program
    {
        private static int Main()
        {
            var full = EnduranceConnectorPlugin.CreateFromRaw(BuildRawFull(), 0);
            full.TransportSessionId = "connector-session-guid-0001";
            full.Sequence = 12345;
            full.CapturedAt = "2026-09-02T14:35:00.000Z";

            var json = Serialize(full);
            Console.WriteLine("V3 SNAPSHOT (protocolVersion=3):");
            Console.WriteLine(json);
            try
            {
                File.WriteAllText("/tmp/v3-output.json", json, new UTF8Encoding(false));
                Console.WriteLine("Wrote /tmp/v3-output.json");
            }
            catch (Exception error)
            {
                Console.Error.WriteLine("harness: kan /tmp/v3-output.json niet schrijven: " + error.Message);
                return 1;
            }
            return 0;
        }

        private static Dictionary<string, object> BuildRawFull()
        {
            var raw = new Dictionary<string, object>
            {
                ["__isInCar"] = true,
                ["DataCorePlugin.GameData.NewData.DriverId"] = "302911",
                ["DataCorePlugin.GameData.NewData.CurrentDriverName"] = "Vincent",
                ["DataCorePlugin.GameData.NewData.CarId"] = "GT3-911",
                ["DataCorePlugin.GameData.NewData.CarName"] = "Porsche 911 GT3 R",
                ["DataCorePlugin.GameData.NewData.TrackName"] = "Zandvoort",
                ["DataCorePlugin.GameData.NewData.TrackConfig"] = "Grand Prix",
                ["DataCorePlugin.GameData.NewData.SessionTime"] = 1234.56,
                ["DataCorePlugin.GameData.NewData.SessionTimeRemain"] = 3600.0,
                ["DataCorePlugin.GameData.NewData.SessionLapsRemainEx"] = 42,
                ["DataCorePlugin.GameData.NewData.Fuel"] = 52.67,
                ["DataCorePlugin.GameData.NewData.FuelLevelPct"] = 0.48,
                ["DataCorePlugin.GameData.NewData.PlayerCarDriverIncidentCount"] = 6,
                ["DataCorePlugin.GameData.NewData.PitSvFlags"] = 0,
                ["DataCorePlugin.GameData.NewData.PitRepairLeft"] = 12.5,
                ["DataCorePlugin.GameData.NewData.Flag"] = "green, yellow",
                ["DataCorePlugin.GameData.NewData.CarIdxLapDistPct"] = new[] { 0.375, 0.9 },
                ["DataCorePlugin.GameData.NewData.CarIdxPosition"] = new[] { 4, 1 },
                ["DataCorePlugin.GameData.NewData.CarIdxClassPosition"] = new[] { 2, 1 },
                ["DataCorePlugin.GameData.NewData.CarIdxF2Time"] = new[] { 3.75, 0.0 },
                ["DataCorePlugin.GameData.NewData.CarIdxLastLapTime"] = new[] { 121.25, 120.0 },
                ["DataCorePlugin.GameData.NewData.CarIdxBestLapTime"] = new[] { 120.98, 118.4 },
                ["DataCorePlugin.GameData.NewData.CarIdxLapCurrentLapTime"] = new[] { 45.12, 67.0 },
                ["DataCorePlugin.GameData.NewData.CarIdxOnPitRoad"] = new[] { false, false },
            };
            return raw;
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
    }
}