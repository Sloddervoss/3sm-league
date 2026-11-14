using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using ThreeSM.EnduranceConnector;

// Real reader on synthetic SDK-format bytes, not an SDK replacement. No live sim claim.
internal static class ResetTowSourceTests
{
    private static readonly DateTime Start = new DateTime(2026, 11, 14, 10, 0, 0, DateTimeKind.Utc);
    private static readonly ObservationPairingBinding Binding = new ObservationPairingBinding(
        "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", "11111111-2222-4333-8444-555555555555", 7, true);
    private static readonly ObservationLapContext Context = new ObservationLapContext("car", 123, "Track", "GP", 42, 3);
    private static readonly string[] Names = { "PlayerCarTowTime", "IsOnTrack", "IsOnTrackCar", "PlayerTrackSurface", "SessionTime", "Lap" };
    private static readonly int[] Types = { 4, 1, 1, 2, 5, 2 };
    private const int Data = 104 + 6 * 144;

    private static void Int(byte[] bytes, int offset, int value) { Array.Copy(BitConverter.GetBytes(value), 0, bytes, offset, 4); }
    private static IrSdkImage Image(int step, string mode)
    {
        var bytes = new byte[Data + 64];
        Int(bytes, 0, 2); Int(bytes, 4, mode == "disconnected" ? 0 : 1); Int(bytes, 8, 60);
        Int(bytes, 24, 6); Int(bytes, 28, 104); Int(bytes, 32, 1); Int(bytes, 36, 64);
        Int(bytes, 48, 100 + step * 6); Int(bytes, 52, Data);
        for (var i = 0; i < Names.Length; i++)
        {
            var header = 104 + i * 144;
            Int(bytes, header, i == 0 && mode == "wrong-type" ? 2 : Types[i]);
            Int(bytes, header + 4, i == 0 && mode == "bad-offset" ? 1000 : i * 8);
            Int(bytes, header + 8, i == 0 && mode == "array" ? 2 : 1);
            var name = i == 0 && mode == "missing" ? "AbsentTow" : Names[i];
            Array.Copy(Encoding.ASCII.GetBytes(name), 0, bytes, header + 16, name.Length);
        }
        var tow = mode == "tow" ? 15f : mode == "negative" ? -1f : mode == "large" ? 86401f
            : mode == "nan" ? float.NaN : mode == "infinity" ? float.PositiveInfinity : 0f;
        Array.Copy(BitConverter.GetBytes(tow), 0, bytes, Data, 4);
        bytes[Data + 8] = mode == "not-in-car" ? (byte)0 : mode == "invalid-bool" ? (byte)2 : (byte)1;
        bytes[Data + 16] = mode == "no-physics" ? (byte)0 : (byte)1;
        Int(bytes, Data + 24, mode == "surface" ? -1 : mode == "surface-range" ? 4 : 3);
        var clock = mode == "source-clock-reset" ? 90 : 100 + step * 0.1;
        if (mode == "source-clock-gap") clock += 2;
        if (mode == "source-clock-null") clock = double.NaN;
        Array.Copy(BitConverter.GetBytes(clock), 0, bytes, Data + 32, 8);
        Int(bytes, Data + 40, mode == "source-lap-reset" ? 0 : mode == "source-lap-invalid" ? -1 : 1);
        if (mode == "tick-reset") Int(bytes, 48, 1);
        return IrSdkImage.Parse(bytes, bytes.Length);
    }

    private static TelemetrySample Sample(int step, string mode)
    {
        var image = mode == "null-sdk" ? null : Image(step, mode);
        var sample = new TelemetrySample
        {
            ObservedAtUtc = Start.AddMilliseconds(step * 100 + (mode == "gap" ? 2000 : 0)),
            SdkTick = image == null || !image.Connected ? (long?)null : image.TickCount,
            SessionTimeSeconds = mode == "lifecycle-clock-reset" ? 90 : 100 + step * 0.1,
            LapNumber = mode == "lifecycle-lap-reset" ? 0 : 1,
            SegmentId = "segment", ObservedSessionId = "session",
            CurrentDriverId = mode == "driver" ? "other" : "driver",
            CurrentDriverName = "Driver", ObservationSchemaVersion = 2,
            ObservationPairingBinding = Binding,
            ObservationLapContext = mode == "context" ? new ObservationLapContext("other", 123, "Track", "GP", 42, 3) : Context,
            OnPitRoad = false, FuelLitres = 60 - step * 0.01,
            TrackTempC = 30, AirTempC = 20, LatAccelG = 1, LongAccelG = -0.2
        };
        IrSdkImage.PopulateResetEvidence(sample, image);
        return sample;
    }

    private static void CheckRow(Action<string, bool, string> check, string name, LapAggregate lap, bool? expected)
    {
        var result = lap == null ? null : lap.ObservationResult;
        var json = result == null ? null : result.ToJson();
        var literal = expected.HasValue ? (expected.Value ? "true" : "false") : "null";
        // Check serialized bytes as well as the DTO; old hardcoded-null path fails clean/tow.
        check("reset-source-" + name, result != null && result.HasObservation
            && result.Observation.FuelQuality.ResetOrTow == expected
            && json.Contains("\"resetOrTow\":" + literal), json ?? "no observation");
        var directory = Environment.GetEnvironmentVariable("RESET_TOW_FIXTURES");
        if (!string.IsNullOrEmpty(directory) && json != null)
        {
            Directory.CreateDirectory(directory);
            File.WriteAllText(Path.Combine(directory, name + ".observation.json"), json);
        }
    }

    public static int Run(Action<string, bool, string> check)
    {
        var count = 0;
        foreach (var mode in new[] { "clean", "tow", "source-clock-reset", "source-lap-reset", "tick-reset",
            "missing", "null-sdk", "disconnected", "negative", "large", "nan", "infinity", "wrong-type",
            "bad-offset", "array", "not-in-car", "no-physics", "invalid-bool", "surface", "surface-range",
            "source-clock-null", "source-clock-gap", "source-lap-invalid", "gap", "context", "driver" })
        {
            var sampler = new TelemetrySampler(new SamplerOptions { ObservationCaptureEnabled = true });
            sampler.BeginSession("segment", "session");
            var steps = mode == "clean" ? 600 : 6;
            for (var i = 0; i < steps; i++)
            {
                var selected = i == 2 ? mode : "clean";
                var sample = Sample(i, selected);
                // Keep UTC increasing after the gap; safe tail cannot erase the hole.
                if (mode == "gap" && i > 2) sample.ObservedAtUtc = sample.ObservedAtUtc.AddSeconds(2);
                if (mode == "source-clock-gap" && i > 2) sample.ResetSourceTime += 2;
                sampler.Offer(sample);
            }
            var boundary = Sample(steps, "clean"); boundary.LapNumber = 2;
            if (mode == "gap") boundary.ObservedAtUtc = boundary.ObservedAtUtc.AddSeconds(2);
            sampler.Offer(boundary);
            var closed = sampler.Drain();
            bool? expected = mode == "clean" ? (bool?)false : mode == "tow" || mode == "source-clock-reset"
                || mode == "source-lap-reset" || mode == "tick-reset" ? (bool?)true : null;
            CheckRow(check, mode, closed.Count == 0 ? null : closed[0], expected); count++;
        }
        foreach (var mode in new[] { "lifecycle-clock-reset", "lifecycle-lap-reset" })
        {
            var sampler = new TelemetrySampler(new SamplerOptions { ObservationCaptureEnabled = true });
            sampler.BeginSession("segment", "session");
            sampler.Offer(Sample(0, "clean")); sampler.Offer(Sample(1, "clean"));
            sampler.Offer(Sample(2, mode));
            var old = sampler.Drain();
            CheckRow(check, mode, old.Count == 0 ? null : old[0], true); count++;
            sampler.Offer(Sample(3, mode));
            CheckRow(check, mode + "-tail", sampler.Close("test_end")[0], true); count++;
        }
        var path = Path.Combine(Path.GetTempPath(), "reset-tow-" + Guid.NewGuid().ToString("N"), "outbox.json");
        string row = null;
        var pipeline = new MeasurementPipeline(new MeasurementOutbox(path),
            new MeasurementIdFactory(() => new Guid("12345678-1234-4234-8234-123456789012")),
            new SamplerOptions { ObservationCaptureEnabled = true }, lap =>
            {
                row = lap.ToObservationSummary("99999999-8888-4777-8666-555555555555", "lap-1").ToJson();
                return true;
            });
        for (var i = 0; i < 600; i++) pipeline.Observe(Sample(i, "clean"));
        var next = Sample(600, "clean"); next.LapNumber = 2; pipeline.Observe(next);
        check("reset-source-real-pipeline-row", row != null && row.Contains("\"resetOrTow\":false")
            && row.Contains("\"complete\":true"), row ?? "no row"); count++;
        var export = Environment.GetEnvironmentVariable("RESET_TOW_FIXTURES");
        if (!string.IsNullOrEmpty(export) && row != null) File.WriteAllText(Path.Combine(export, "pipeline.row.json"), row);
        return count;
    }
}
