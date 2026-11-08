using System;
using System.Linq;
using ThreeSM.EnduranceConnector;

/// <summary>
/// De sessie-YAML komt bij sommige SimHub-versies als tekst binnen in plaats van als
/// objectboom. Deze tests leggen vast dat de terugvalroute exact dezelfde grenzen
/// oplevert en dat een onbruikbaar blok null geeft in plaats van een gok.
/// </summary>
internal static class SectorStartParsingTests
{
    private const string Realistic = @"---
WeekendInfo:
 TrackID: 341
 TrackName: Suzuka
SessionInfo:
 Sessions:
 - SessionNum: 0
   SessionType: Race
DriverInfo:
 Drivers:
 - CarIdx: 0
SplitTimeInfo:
 Sectors:
 - SectorNum: 0
   SectorStartPct: 0.0
 - SectorNum: 1
   SectorStartPct: 0.333333
 - SectorNum: 2
   SectorStartPct: 0.666667
";

    public static int Run(Action<string, bool, string> check)
    {
        var n = 0;
        var three = RawChannelReader.ParseSectorStartsFromYaml(Realistic);
        check("yaml: drie sectoren", three != null && three.Length == 3, three == null ? "null" : string.Join(",", three.Select(v => v.ToString("0.######"))));
        check("yaml: eerste grens is 0", three != null && three[0] == 0, three == null ? "null" : three[0].ToString());
        check("yaml: grenzen oplopend", three != null && three[1] > 0 && three[1] < three[2] && three[2] < 1, three == null ? "null" : string.Join(",", three));
        n += 3;

        var windows = RawChannelReader.ParseSectorStartsFromYaml(Realistic.Replace("\n", "\r\n"));
        check("yaml: CRLF levert hetzelfde", windows != null && windows.Length == 3 && Math.Abs(windows[1] - 0.333333) < 1e-9, windows == null ? "null" : string.Join(",", windows));
        n++;

        var quoted = RawChannelReader.ParseSectorStartsFromYaml("SplitTimeInfo:\n Sectors:\n - SectorNum: 0\n   SectorStartPct: '0.0'\n - SectorNum: 1\n   SectorStartPct: \"0.5\"\n");
        check("yaml: quotes toegestaan", quoted != null && quoted.Length == 2 && quoted[1] == 0.5, quoted == null ? "null" : string.Join(",", quoted));
        n++;

        check("yaml: zonder SplitTimeInfo is null", RawChannelReader.ParseSectorStartsFromYaml("WeekendInfo:\n TrackID: 1\n") == null, "verwacht null");
        check("yaml: lege tekst is null", RawChannelReader.ParseSectorStartsFromYaml("") == null, "verwacht null");
        check("yaml: eerste grens niet 0 is null", RawChannelReader.ParseSectorStartsFromYaml("SplitTimeInfo:\n Sectors:\n - SectorStartPct: 0.2\n - SectorStartPct: 0.6\n") == null, "verwacht null");
        check("yaml: niet-oplopend is null", RawChannelReader.ParseSectorStartsFromYaml("SplitTimeInfo:\n Sectors:\n - SectorStartPct: 0.0\n - SectorStartPct: 0.6\n - SectorStartPct: 0.4\n") == null, "verwacht null");
        check("yaml: grens buiten 0..1 is null", RawChannelReader.ParseSectorStartsFromYaml("SplitTimeInfo:\n Sectors:\n - SectorStartPct: 0.0\n - SectorStartPct: 1.4\n") == null, "verwacht null");
        check("yaml: onleesbaar getal is null", RawChannelReader.ParseSectorStartsFromYaml("SplitTimeInfo:\n Sectors:\n - SectorStartPct: 0.0\n - SectorStartPct: abc\n") == null, "verwacht null");
        n += 5;

        var metAndereSleutels = RawChannelReader.ParseSectorStartsFromYaml(
            "SplitTimeInfo:\n Sectors:\n - SectorNum: 0\n   SectorStartPct: 0.0\n   Extra: 7\n - SectorNum: 1\n   SectorStartPct: 0.25\nOtherSection:\n - SectorStartPct: 0.9\n");
        check("yaml: andere sleutels negeren", metAndereSleutels != null && metAndereSleutels.Length == 2 && metAndereSleutels[1] == 0.25, metAndereSleutels == null ? "null" : string.Join(",", metAndereSleutels));
        n++;

        return n;
    }
}
