using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Runtime.Serialization.Json;
using System.Text;
using System.Text.Json;
using ThreeSM.EnduranceConnector;

/// <summary>Red/green proof for the additive 0.7.6.4 live-sector producer.
/// All scenarios are synthetic source samples; they do not claim live accuracy.</summary>
internal static class LiveSectorUpdateTests
{
    private const double Hz = 20;
    private static readonly double[] Three = {0,0.3,0.7};
    private static readonly double[] Six = {0,0.175453,0.371582,0.477953,0.624897,0.814373};
    private static readonly double[] Sixteen = Enumerable.Range(0,16).Select(i=>i/16.0).ToArray();

    private sealed class Capture
    {
        public readonly List<PaceSectorUpdate> Updates = new List<PaceSectorUpdate>();
        public readonly List<PaceCaptureFrame> Frames = new List<PaceCaptureFrame>();
        public PaceCaptureBuffer Buffer;
        public double LastTime;
        public long LastTick;
        public PaceObservation LastObservation;
    }

    private static Func<int,double> Constant(double seconds) { return lap => seconds; }
    private static void Locate(double t, Func<int,double> lapTime, out int lap, out double distance)
    {
        lap = 1; double left = t;
        while (lap < 100000)
        {
            double length = lapTime(lap);
            if (left < length) break;
            left -= length; lap++;
        }
        distance = left / lapTime(lap);
        if (distance >= 1) distance = 0.999999;
    }
    private static PaceObservation Sample(string id, int lap, double distance, double? lastLap, double? bestLap, bool inPit)
    {
        return new PaceObservation {
            Id=id, Lap=lap, Distance=distance, SpeedKph=180, Connected=true, IsPlayer=false,
            Position=1, InPit=inPit, LastLapSeconds=lastLap, BestLapSeconds=bestLap,
            Metric=new PaceMetric { LapValid=!inPit }
        };
    }
    private static Capture Drive(double[] starts, int laps, Func<int,double> lapTime, Func<int,double?> reported=null,
        double startOffset=0, bool gap=false, bool pit=false, int targetLap=0, double from=0.35, double to=0.45, double margin=0.6, string id="car", bool missingMetadata=false, bool missingOpponent=false)
    {
        var capture = new Capture { Buffer = new PaceCaptureBuffer() };
        double total = 0;
        for (int lap=1; lap<=laps; lap++) total += lapTime(lap);
        total += margin * lapTime(laps+1);
        double begin = startOffset * lapTime(1);
        long tick = 0;
        for (double t=begin; t<=total; t+=1.0/Hz)
        {
            tick++;
            int lap; double distance; Locate(t,lapTime,out lap,out distance);
            if (gap && lap==targetLap && distance>=from && distance<to) continue;
            bool inPit = pit && lap==targetLap && distance>=from && distance<to;
            double? last = lap>=2 ? (reported!=null ? reported(lap-1) : lapTime(lap-1)) : (reported!=null ? reported(1) : lapTime(1));
            double? best = null;
            for (int done=1; done<lap; done++)
            {
                double? value = reported!=null ? reported(done) : lapTime(done);
                if (value.HasValue && (!best.HasValue || value.Value<best.Value)) best=value;
            }
            if (!best.HasValue) best=last;
            var observation = Sample(id,lap,distance,last,best,inPit);
            capture.Buffer.Observe("live-sector-session",t,tick,missingOpponent && tick==6000?new PaceObservation[0]:new[]{observation},missingMetadata && tick==6200?null:starts);
            capture.LastTime=t; capture.LastTick=tick; capture.LastObservation=observation;
            var frame = capture.Buffer.NextFrame();
            if (frame==null) continue;
            capture.Frames.Add(frame);
            if (frame.SectorUpdates!=null) capture.Updates.AddRange(frame.SectorUpdates);
        }
        return capture;
    }
    private static string Serialize(PaceCaptureFrame frame)
    {
        using (var stream=new MemoryStream())
        {
            new DataContractJsonSerializer(typeof(PaceCaptureFrame)).WriteObject(stream,frame);
            return Encoding.UTF8.GetString(stream.ToArray());
        }
    }
    private static string Inner(string wire)
    {
        using (var document=JsonDocument.Parse(wire))
            return document.RootElement.GetProperty("paceCapture").GetRawText();
    }
    private static int MemberBytes(string wire)
    {
        int at=wire.IndexOf("\"paceCapture\":",StringComparison.Ordinal);
        return at<0 ? int.MaxValue : Encoding.UTF8.GetByteCount(wire.Substring(at,wire.Length-1-at));
    }

    public static int Run(Action<string,bool,string> check)
    {
        int n=0; void Check(string id,bool ok,string detail) { check("LIVE-"+id,ok,detail); n++; }

        // 3/6/16 measured layouts, provisional before finish, verified only after
        // the whole-lap sum gate. The first observed (joined) lap is never invented.
        foreach (var layout in new[]{Three,Six,Sixteen})
        {
            string tag=layout.Length+"s";
            var capture=Drive(layout,3,Constant(123.05));
            var all=capture.Updates;
            // Background snapshots repeat states by design; distinct by sector identity
            // before counting the producer's state transitions.
            var verified=all.Where(u=>u.Lap==2 && u.Status==PaceSectorUpdate.Verified)
                .GroupBy(u=>u.SectorIndex).Select(g=>g.OrderByDescending(u=>u.Revision).First())
                .OrderBy(u=>u.SectorIndex).ToArray();
            Check("count-"+tag,all.Count>0 && all.All(u=>u.SectorCount==layout.Length),"every update carries the actual layout count "+layout.Length);
            var diag=capture.Frames.SelectMany(f=>f.OpponentMetrics).Select(m=>m.SectorDiagnostic).LastOrDefault(d=>d!=null);
            Check("indices-"+tag,verified.Length==layout.Length && verified.Select(u=>u.SectorIndex).SequenceEqual(Enumerable.Range(0,layout.Length)),"verified sector indices are complete and unique; all="+all.Count+" ("+string.Join(",",all.GroupBy(u=>u.Lap+":"+u.Status).Select(g=>g.Key+"="+g.Count()))+") diag="+(diag==null?"none":diag.Reason+" sum="+diag.SumSeconds+" reported="+diag.ReportedSeconds+" err="+diag.ErrorSeconds));
            Check("sum-"+tag,verified.Length==layout.Length && Math.Abs(verified.Sum(u=>u.Seconds.Value)-123.05)<=0.001,"whole-lap sum gate: "+(verified.Length==layout.Length?verified.Sum(u=>u.Seconds.Value).ToString("F6"):"missing"));
            Check("provisional-"+tag,all.Any(u=>u.Lap==2 && u.Status==PaceSectorUpdate.Provisional),"provisional sector emitted before the finish");
            Check("no-first-partial-"+tag,all.All(u=>u.Lap>=2),"joined lap 1 is never invented");
            Check("time-"+tag,all.All(u=>u.CompletedSessionTimeSeconds>=0 && u.ObservedSessionTimeSeconds>=u.CompletedSessionTimeSeconds-0.000001 && u.ObservedSessionTimeSeconds<=86400),"sector-end source time never exceeds its observation");
            Check("status-"+tag,all.All(u=>u.Status==PaceSectorUpdate.Provisional || u.Status==PaceSectorUpdate.Verified || u.Status==PaceSectorUpdate.Invalidated),"only the three contract statuses");
            Check("bounded-"+tag,capture.Buffer.StoredSectorUpdateCount<=48,"per-car snapshot buffer stays bounded: "+capture.Buffer.StoredSectorUpdateCount);
        }

        // Joining mid-lap must not produce a partial first sector.
        var joined=Drive(Three,2,Constant(123.05),null,0.55);
        Check("mid-lap-none",joined.Updates.All(u=>u.Lap>=2),"no update for the partially observed entry lap");
        Check("mid-lap-first",joined.Updates.Count>0 && joined.Updates[0].Lap==2 && joined.Updates[0].SectorIndex==0,"first measured update is the first full sector");

        // A changed geometry resets the namespace instead of mixing layouts.
        var layoutBuffer=new PaceCaptureBuffer();
        for(int i=0;i<=400;i++) { double t=i/20.0; int lap=1+(int)(t/123.05); double distance=(t%123.05)/123.05;
            layoutBuffer.Observe("layout-session",t,i,new[]{Sample("layout-car",lap,distance,123.05,123.05,false)},Six); }
        var beforeLayout=layoutBuffer.NextFrame();
        for(int i=401;i<=440;i++) { double t=i/20.0; int lap=1+(int)(t/123.05); double distance=(t%123.05)/123.05;
            layoutBuffer.Observe("layout-session",t,i,new[]{Sample("layout-car",lap,distance,123.05,123.05,false)},Three); }
        var afterLayout=layoutBuffer.NextFrame();
        Check("layout-reset",beforeLayout!=null && afterLayout!=null && beforeLayout.SegmentId!=afterLayout.SegmentId
            && afterLayout.OpponentMetrics.Length==1 && afterLayout.OpponentMetrics[0].SectorCount==3
            && (afterLayout.SectorUpdates==null || afterLayout.SectorUpdates.All(u=>u.SectorCount==3)),
            "layout change starts a new segment and only the new sector count remains");

        // Frozen previous verified reference: lap 3 keeps lap 2's best even when
        foreach(bool metadata in new[]{true,false})
        {
            var transient=Drive(Three,3,Constant(123.05),null,0,false,false,0,0.35,0.45,0.2,"transient-car",metadata,!metadata);
            string kind=metadata?"metadata":"opponent";
            Check("transient-"+kind+"-namespace",transient.Frames.Select(f=>f.SegmentId).Distinct().Count()==1,"a single missing source row does not replace the session namespace");
            Check("transient-"+kind+"-verified",transient.Updates.Where(u=>u.Lap==3 && u.Status==PaceSectorUpdate.Verified).Select(u=>u.SectorIndex).Distinct().Count()==3,"brief omission preserves anchors and permits the actual full-lap gate");
            Check("transient-"+kind+"-reference",transient.Updates.Where(u=>u.Lap==3 && u.Status==PaceSectorUpdate.Verified).Any() && transient.Updates.Where(u=>u.Lap==3 && u.Status==PaceSectorUpdate.Verified).All(u=>u.ReferenceSeconds.HasValue),"verified personal references survive a brief omission");
        }
        var churn=new PaceCaptureBuffer();
        for(int i=0;i<100;i++)churn.Observe("churn",i*0.05,i,new[]{Sample("churn-"+i,1,0.1,123.05,123.05,false)},Three);
        var retired=(System.Collections.IDictionary)typeof(PaceCaptureBuffer).GetField("retiredSectors",System.Reflection.BindingFlags.Instance|System.Reflection.BindingFlags.NonPublic).GetValue(churn);
        Check("transient-bounded",churn.CarCount+retired.Count<=PaceCaptureBuffer.MaxCars,"active and retired sector states remain jointly bounded during id churn");

        // Frozen previous verified reference: lap 3 keeps lap 2's best even when
        // lap 3 becomes a new PB. Lap 4 then freezes lap 3.
        Func<int,double> faster = lap => lap<=1 ? 123.05 : lap==2 ? 120 : lap==3 ? 118 : 117;
        var reference=Drive(Six,3,faster,null,0,false,false,0,0,0,0.55);
        var lap2=reference.Updates.Where(u=>u.Lap==2 && u.Status==PaceSectorUpdate.Verified)
            .GroupBy(u=>u.SectorIndex).Select(g=>g.OrderByDescending(u=>u.Revision).First())
            .OrderBy(u=>u.SectorIndex).Select(u=>u.Seconds.Value).ToArray();
        var lap3=reference.Updates.Where(u=>u.Lap==3 && u.Status==PaceSectorUpdate.Verified)
            .GroupBy(u=>u.SectorIndex).Select(g=>g.OrderByDescending(u=>u.Revision).First())
            .OrderBy(u=>u.SectorIndex).Select(u=>u.Seconds.Value).ToArray();
        var lap4Provisional=reference.Updates.Where(u=>u.Lap==4 && u.Status==PaceSectorUpdate.Provisional)
            .GroupBy(u=>u.SectorIndex).Select(g=>g.OrderByDescending(u=>u.Revision).First())
            .OrderBy(u=>u.SectorIndex).ToArray();
        Check("ref-first-null",lap2.Length==Six.Length && reference.Updates.Where(u=>u.Lap==2 && u.Status==PaceSectorUpdate.Verified).All(u=>u.ReferenceSeconds==null),"first verified lap has no invented personal best");
        Check("ref-frozen",lap3.Length==Six.Length && reference.Updates.Where(u=>u.Lap==3 && u.Status==PaceSectorUpdate.Verified).All(u=>u.ReferenceSeconds.HasValue && Math.Abs(u.ReferenceSeconds.Value-lap2[u.SectorIndex])<0.000001),"verified revision keeps the reference frozen at first completion");
        Check("ref-next-pb",lap4Provisional.Length>0 && lap4Provisional.All(u=>u.ReferenceSeconds.HasValue && u.SectorIndex<lap3.Length && Math.Abs(u.ReferenceSeconds.Value-lap3[u.SectorIndex])<0.000001),"next lap uses the newly verified sector best, not its own provisional time");
        Check("ref-not-zero",lap4Provisional.All(u=>u.Seconds.HasValue && u.ReferenceSeconds.HasValue && Math.Abs(u.Seconds.Value-u.ReferenceSeconds.Value)>0.001),"a new PB does not collapse the delta to zero");

        // Gap and pit invalidate only the open lap's provisional results.
        var gap=Drive(Six,3,Constant(123.05),null,0,true,false,3,0.35,0.45);
        var gapLap=gap.Updates.Where(u=>u.Lap==3).ToArray();
        Check("gap-provisional",gapLap.Any(u=>u.Status==PaceSectorUpdate.Provisional),"sector before the gap was published provisionally");
        Check("gap-invalidated",gapLap.Any(u=>u.Status==PaceSectorUpdate.Invalidated && u.Seconds==null),"gap invalidates the already emitted provisional sector");
        Check("gap-no-verified",!gapLap.Any(u=>u.Status==PaceSectorUpdate.Verified),"discontinuous lap is never promoted");
        Check("gap-prior-lap",gap.Updates.Where(u=>u.Lap==2 && u.Status==PaceSectorUpdate.Verified).Select(u=>u.SectorIndex).Distinct().Count()==Six.Length,"an unrelated future gap keeps the prior verified lap");

        var pit=Drive(Six,3,Constant(123.05),null,0,false,true,3,0.35,0.45);
        var pitLap=pit.Updates.Where(u=>u.Lap==3).ToArray();
        Check("pit-invalidated",pitLap.Any(u=>u.Status==PaceSectorUpdate.Invalidated && u.Seconds==null),"pit invalidates the open lap's provisional sectors");
        Check("pit-no-verified",!pitLap.Any(u=>u.Status==PaceSectorUpdate.Verified),"pit lap is never promoted");

        // Failed and timed-out finishes invalidate the provisional lap.
        Func<int,double?> wrong = lap => lap==3 ? (double?)130.0 : 123.05;
        var failed=Drive(Six,3,Constant(123.05),wrong);
        var failedLap=failed.Updates.Where(u=>u.Lap==3).ToArray();
        Check("finish-fail",failedLap.Where(u=>u.Status==PaceSectorUpdate.Invalidated).Select(u=>u.SectorIndex).Distinct().Count()==Six.Length,"sum-mismatch finish invalidates every emitted sector");
        Check("finish-fail-none",!failedLap.Any(u=>u.Status==PaceSectorUpdate.Verified),"failed finish never verifies");
        Check("finish-fail-prov",failedLap.Any(u=>u.Status==PaceSectorUpdate.Provisional),"provisional existed before the failed finish");

        Func<int,double?> missing = lap => lap==3 ? (double?)null : 123.05;
        var timedOut=Drive(Six,3,Constant(123.05),missing);
        var timeoutLap=timedOut.Updates.Where(u=>u.Lap==3).ToArray();
        Check("finish-timeout",timeoutLap.Any(u=>u.Status==PaceSectorUpdate.Invalidated && u.Seconds==null),"missing LastLapTime invalidates after the 2 s grace");
        Check("finish-timeout-none",!timeoutLap.Any(u=>u.Status==PaceSectorUpdate.Verified),"timed-out finish never verifies");

        // Ordering/idempotence: no lower revision, no duplicate revision with a
        // different state, and a repeated source tick emits nothing.
        var ordered=Drive(Six,3,Constant(123.05));
        bool monotonic=true, consistent=true;
        foreach (var group in ordered.Updates.GroupBy(u=>u.Id+"/"+u.Lap+"/"+u.SectorIndex))
        {
            long previous=0;
            foreach (var update in group)
            {
                if (update.Revision<previous) monotonic=false;
                previous=update.Revision;
            }
            foreach (var same in group.GroupBy(u=>u.Revision))
                if (same.Select(u=>u.Status+"/"+u.Seconds).Distinct().Count()!=1) consistent=false;
        }
        Check("order-monotonic",monotonic,"revisions never go backwards for an identity");
        Check("order-idempotent",consistent,"one revision always means one state");
        int before=ordered.Updates.Count;
        ordered.Buffer.Observe("live-sector-session",ordered.LastTime,ordered.LastTick,new[]{ordered.LastObservation},Six);
        var duplicateFrame=ordered.Buffer.NextFrame();
        Check("duplicate-tick",duplicateFrame==null && ordered.Updates.Count==before,"a repeated source tick emits no duplicate update");

        // A stale lap counter on an opponent (not the player's global epoch reset)
        // must continue the per-car revision sequence, never restart it.
        var staleBuffer=new PaceCaptureBuffer();
        var staleUpdates=new List<PaceSectorUpdate>();
        long staleTick=0;
        for(int i=0;i<=5000;i++)
        {
            double t=i/20.0; int lap=1+(int)(t/123.05); double distance=(t%123.05)/123.05;
            staleBuffer.Observe("stale-session",t,staleTick++,new[]{Sample("stale-car",lap,distance,123.05,123.05,false)},Three);
            var frame=staleBuffer.NextFrame();
            if(frame?.SectorUpdates!=null) staleUpdates.AddRange(frame.SectorUpdates);
        }
        long revisionBefore=staleUpdates.Count==0?0:staleUpdates.Max(u=>u.Revision);
        int beforeStale=staleUpdates.Count;
        for(double t=250.0;t<=250.0+2.2*123.05;t+=1.0/Hz)
        {
            int lap=1+(int)((t-250.0)/123.05); double distance=((t-250.0)%123.05)/123.05;
            staleBuffer.Observe("stale-session",t,staleTick++,new[]{Sample("stale-car",lap,distance,123.05,123.05,false)},Three);
            var frame=staleBuffer.NextFrame();
            if(frame?.SectorUpdates!=null) staleUpdates.AddRange(frame.SectorUpdates);
        }
        var afterStale=staleUpdates.Skip(beforeStale).ToArray();
        Check("stale-revision",afterStale.Length>0 && afterStale.Min(u=>u.Revision)>revisionBefore,"a stale lap regression keeps per-car revisions monotonic");

        // 40-car burst: fair changed delivery, <=4 metrics, <=8 sectors/frame and
        // a real serialized PACE block inside both caps.
        var burstFrame=DriveMany(Three,2);
        Check("40-cap-sectors",burstFrame.Frames.All(f=>f.SectorUpdates==null || f.SectorUpdates.Length<=8),"never more than eight sector updates per frame");
        Check("40-cap-metrics",burstFrame.Frames.All(f=>f.OpponentMetrics.Length<=4),"never more than four metrics per frame");
        var firstForty=burstFrame.Frames.SelectMany(f=>f.SectorUpdates??new PaceSectorUpdate[0]).Take(40).Select(u=>u.Id).Distinct().Count();
        Check("40-fair",firstForty==40,"first forty changed slots cover forty distinct cars ("+firstForty+")");
        var metricIds=burstFrame.Frames.Take(10).SelectMany(f=>f.OpponentMetrics).Select(m=>m.Id).Distinct().Count();
        Check("40-metrics",metricIds==40,"ten frames rotate all forty metrics ("+metricIds+")");
        var dto=V3PayloadFixtureTests.BuildRepresentativeFrame();
        dto.SchemaRevision=1; dto.Capabilities=V3Capabilities.From(ConnectorCapabilities.Implemented());
        int coreOpponents=dto.Opponents==null?0:dto.Opponents.Length;
        var core=V3PayloadFixtureTests.Serialize(dto);
        int tested=0;
        foreach (var frame in burstFrame.Frames.Where(f=>f.SectorUpdates!=null && f.SectorUpdates.Length>0).Take(6))
        {
            var wire=PaceCaptureBuffer.AppendWithinBudget(core,frame);
            using (var document=JsonDocument.Parse(wire))
            {
                var pace=document.RootElement.GetProperty("paceCapture");
                Check("40-budget-"+tested,Encoding.UTF8.GetByteCount(wire)<=24000 && MemberBytes(wire)<=4096,"frame "+tested+" total="+Encoding.UTF8.GetByteCount(wire)+" pace="+MemberBytes(wire));
                Check("40-kept-"+tested,pace.GetProperty("sectorUpdates").GetArrayLength()>=1,"sector updates survive the budget");
                Check("40-core-"+tested,document.RootElement.GetProperty("opponents").GetArrayLength()==coreOpponents,"mandatory core telemetry is intact");
            }
            tested++;
        }
        Check("40-tested",tested>=1,"at least one burst frame had real sector bytes");

        // Actual serializer budget for 16 sectors with four full metrics: trimming
        // may reduce the batch but must keep the changed prefix and never exceed 4096.
        var heavy=Drive(Sixteen,3,Constant(123.05));
        var heavyFrame=heavy.Frames.FirstOrDefault(f=>f.SectorUpdates!=null && f.SectorUpdates.Length>=8 && f.OpponentMetrics.Length>=1);
        if (heavyFrame==null) Check("16-budget-missing",false,"no heavy frame found");
        else
        {
            var source=heavyFrame.SectorUpdates.ToArray();
            var wire=PaceCaptureBuffer.AppendWithinBudget("{}",heavyFrame);
            using (var document=JsonDocument.Parse(wire))
            {
                var kept=document.RootElement.GetProperty("paceCapture").GetProperty("sectorUpdates");
                Check("16-budget",MemberBytes(wire)<=4096,"PACE member stays <=4096: "+MemberBytes(wire));
                Check("16-prefix",kept.GetArrayLength()>=1 && kept.GetArrayLength()<=source.Length,"trimmed batch remains a changed-first prefix");
                bool prefix=true;
                for (int i=0;i<kept.GetArrayLength();i++)
                {
                    var item=kept[i];
                    if (item.GetProperty("id").GetString()!=source[i].Id || item.GetProperty("lap").GetInt32()!=source[i].Lap
                        || item.GetProperty("sectorIndex").GetInt32()!=source[i].SectorIndex) prefix=false;
                }
                Check("16-prefix-order",prefix,"first changed updates are the ones retained");
            }
            Check("16-no-mutation",heavyFrame.SectorUpdates.Length==source.Length,"AppendWithinBudget does not mutate the sampler frame");
        }

        // Old PACE shape is byte-compatible when no sector update exists.
        var legacy=new PaceCaptureFrame {
            ObservedSessionId="legacy-session",SegmentId="legacy-segment",
            OpponentMetrics=new[]{new PaceMetric {Id="car",ObservedSessionTimeSeconds=10,LastLapSeconds=100,BestLapSeconds=99,LastLapSectorSeconds=new double?[]{30,30,40},BestLapSectorSeconds=new double?[]{30,30,40},SectorMismatchCount=0}},
            OpponentLaps=new PaceLap[0],TraceChunks=new PaceChunk[0]
        };
        var legacyWire=PaceCaptureBuffer.AppendWithinBudget("{}",legacy);
        Check("compat-exact",legacyWire=="{\"paceCapture\":"+Serialize(legacy)+"}","legacy serialization is unchanged");
        Check("compat-field",!legacyWire.Contains("sectorUpdates"),"optional member is absent when empty");
        var emptySectors=new PaceCaptureFrame {ObservedSessionId=legacy.ObservedSessionId,SegmentId=legacy.SegmentId,
            OpponentMetrics=legacy.OpponentMetrics,OpponentLaps=legacy.OpponentLaps,TraceChunks=legacy.TraceChunks,SectorUpdates=new PaceSectorUpdate[0]};
        var emptyWire=PaceCaptureBuffer.AppendWithinBudget("{}",emptySectors);
        Check("compat-empty",emptyWire=="{\"paceCapture\":"+Serialize(legacy)+"}","an explicit empty sector array is omitted byte-identically");

        // Exported serializer fixtures: actual DataContractJsonSerializer output for
        // 3/6/16 sectors, all three statuses in the combined primary fixture.
        var exported=BuildExportFrames();
        foreach (var entry in exported.Where(e=>e.Key!="combined"))
        {
            var wire=PaceCaptureBuffer.AppendWithinBudget("{}",entry.Value);
            int expected=entry.Key.StartsWith("16")?8:int.Parse(entry.Key);
            using (var document=JsonDocument.Parse(wire))
            {
                var pace=document.RootElement.GetProperty("paceCapture");
                Check("export-"+entry.Key,MemberBytes(wire)<=4096 && pace.GetProperty("sectorUpdates").GetArrayLength()==expected,
                    entry.Key+" retains all "+expected+" sectors in "+MemberBytes(wire)+" PACE bytes");
            }
        }
        var combined=exported["combined"];
        Check("export-status",combined.SectorUpdates.Select(u=>u.Status).Distinct().OrderBy(s=>s).SequenceEqual(new[]{"invalidated","provisional","verified"}),"combined fixture covers all contract statuses");
        Check("export-count",combined.SectorUpdates.Select(u=>u.SectorCount).Distinct().OrderBy(x=>x).SequenceEqual(new[]{3,6,16}),"combined fixture covers 3/6/16 layouts");
        return n;
    }

    private sealed class Burst { public readonly List<PaceCaptureFrame> Frames = new List<PaceCaptureFrame>(); }
    private static Burst DriveMany(double[] starts, int laps)
    {
        var burst=new Burst();
        var buffer=new PaceCaptureBuffer();
        Func<int,double> lapTime=Constant(123.05);
        double total=laps*lapTime(1);
        long tick=0;
        for(double t=0;t<=total;t+=1.0/Hz)
        {
            tick++;
            int lap; double distance; Locate(t,lapTime,out lap,out distance);
            var observations=Enumerable.Range(0,40).Select(i=>new PaceObservation {
                Id="burst-"+i, Lap=lap, Distance=distance, SpeedKph=180, Connected=true, IsPlayer=i==0,
                Position=i+1, InPit=false, LastLapSeconds=lap>=2?(double?)123.05:null, BestLapSeconds=lap>=2?(double?)123.05:null,
                Metric=new PaceMetric {LapValid=true}
            }).ToArray();
            buffer.Observe("burst-session",t,tick,observations,starts);
            var frame=buffer.NextFrame();
            if(frame!=null) burst.Frames.Add(frame);
        }
        return burst;
    }

    public static Dictionary<string,PaceCaptureFrame> BuildExportFrames()
    {
        var result=new Dictionary<string,PaceCaptureFrame>(StringComparer.Ordinal);
        foreach (object[] item in new object[]{new object[]{Three,"3"},new object[]{Six,"6"},new object[]{Sixteen,"16"}})
        {
            var layout=(double[])item[0]; string name=(string)item[1];
            var capture=Drive(layout,3,Constant(123.05),null,0,false,false,0,0,0,0.2,"c"+layout.Length);
            var verified=capture.Updates.Where(u=>u.Lap==2 && u.Status==PaceSectorUpdate.Verified)
                .GroupBy(u=>u.SectorIndex).Select(g=>g.OrderByDescending(u=>u.Revision).First())
                .OrderBy(u=>u.SectorIndex).ToArray();
            // A wire block carries at most eight updates. A 16-sector lap is exported
            // as two contract-legal frames, exactly as the producer sends it.
            int parts=layout.Length>8?2:1;
            for(int part=0;part<parts;part++)
            {
                string key=parts==1?name:name+(part==0?"a":"b");
                result[key]=new PaceCaptureFrame {
                    ObservedSessionId="export-session",SegmentId="export-"+layout.Length+"-"+part,
                    OpponentMetrics=new PaceMetric[0],OpponentLaps=new PaceLap[0],TraceChunks=new PaceChunk[0],
                    SectorUpdates=verified.Skip(part*8).Take(8).ToArray()
                };
            }
        }
        Func<int,double> exportLap = lap => lap==3 ? 120 : 123.05;
        var provisional=Drive(Six,3,exportLap,null,0,false,false,0,0,0,0.2,"c6")
            .Updates.Where(u=>u.Lap==3 && u.Status==PaceSectorUpdate.Provisional).OrderBy(u=>u.SectorIndex).FirstOrDefault();
        var invalidated=Drive(Sixteen,3,Constant(123.05),null,0,true,false,3,0.3,0.4,0.6,"c16")
            .Updates.Where(u=>u.Lap==3 && u.Status==PaceSectorUpdate.Invalidated).OrderBy(u=>u.SectorIndex).FirstOrDefault();
        var combinedUpdates=new List<PaceSectorUpdate>();
        combinedUpdates.Add(result["3"].SectorUpdates[0]);
        if (provisional!=null) combinedUpdates.Add(provisional); else combinedUpdates.Add(result["6"].SectorUpdates[0]);
        if (invalidated!=null) combinedUpdates.Add(invalidated); else combinedUpdates.Add(result["16a"].SectorUpdates[0]);
        result["combined"]=new PaceCaptureFrame {
            ObservedSessionId="export-session",SegmentId="export-combined",
            OpponentMetrics=new[]{new PaceMetric {Id="export-car-3",ObservedSessionTimeSeconds=369.15,SectorMismatchCount=0}},
            OpponentLaps=new PaceLap[0],TraceChunks=new PaceChunk[0],
            SectorUpdates=combinedUpdates.ToArray()
        };
        return result;
    }

    public static void ExportFixtures(string directory)
    {
        Directory.CreateDirectory(directory);
        var frames=BuildExportFrames();
        var bundle=new List<object>();
        string primary=null;
        foreach (var entry in frames.OrderBy(e=>e.Key,StringComparer.Ordinal))
        {
            var wire=PaceCaptureBuffer.AppendWithinBudget("{}",entry.Value);
            var inner=Inner(wire);
            if (entry.Key=="combined") primary=inner;
            bundle.Add(new {
                name=entry.Key,
                wire=wire,
                paceBytes=MemberBytes(wire),
                sectorCounts=entry.Value.SectorUpdates.Select(u=>u.SectorCount).Distinct().OrderBy(x=>x).ToArray(),
                statuses=entry.Value.SectorUpdates.Select(u=>u.Status).Distinct().OrderBy(x=>x).ToArray(),
                captured=entry.Key!="combined"
            });
        }
        File.WriteAllText(Path.Combine(directory,"pace-live-sectors.json"),primary);
        var options=new JsonSerializerOptions { WriteIndented=true };
        File.WriteAllText(Path.Combine(directory,"pace-live-sectors-bundle.json"),JsonSerializer.Serialize(new {
            producer="3SM.EnduranceConnector 0.7.6.4",
            serializer="System.Runtime.Serialization.Json.DataContractJsonSerializer",
            schemaRevision=1,
            note="Synthetic producer scenarios; exact C# wire bytes for TS parser and SQL merge interop.",
            frames=bundle
        },options));
        // Actual NextFrame sequences, not manually assembled DTO batches. Keep
        // namespace/ordering/serializer bytes exactly as produced and label the
        // input samples synthetic (not a live accuracy claim).
        var streams=new List<object>();
        foreach (var count in new[]{3,6,16})
        {
            var layout=count==3?Three:count==6?Six:Sixteen;
            foreach (bool gap in count==3?new[]{false,true}:new[]{false})
            {
                var run=Drive(layout,3,lap=>lap==3?120:123.05,null,0,gap,false,3,0.35,0.45,0.2,"stream-car");
                var revisions=new Dictionary<string,int>(StringComparer.Ordinal);
                var wires=new List<string>();
                foreach (var frame in run.Frames)
                {
                    if (frame.SectorUpdates==null) continue;
                    var wire=PaceCaptureBuffer.AppendWithinBudget("{}",frame);
                    using (var parsed=JsonDocument.Parse(wire))
                    {
                        JsonElement pace,updates;
                        if (!parsed.RootElement.TryGetProperty("paceCapture",out pace) || !pace.TryGetProperty("sectorUpdates",out updates)) continue;
                        bool changed=false;
                        foreach (var update in updates.EnumerateArray())
                        {
                            string key=update.GetProperty("id").GetString()+"/"+update.GetProperty("lap").GetInt32()+"/"+update.GetProperty("sectorIndex").GetInt32();
                            int revision=update.GetProperty("revision").GetInt32(),previous;
                            if (!revisions.TryGetValue(key,out previous) || revision>previous) { changed=true; revisions[key]=revision; }
                        }
                        if (changed) wires.Add(wire);
                    }
                }
                streams.Add(new {sectorCount=count,kind=gap?"gap":"clean",wires=wires});
            }
        }
        File.WriteAllText(Path.Combine(directory,"pace-live-sector-streams.json"),JsonSerializer.Serialize(new {
            note="Synthetic samples through actual Observe, NextFrame and AppendWithinBudget; no live accuracy claim.",streams=streams
        },options));
    }
}
