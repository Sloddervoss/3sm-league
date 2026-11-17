using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.Serialization;
using System.Runtime.Serialization.Json;
using System.IO;
using System.Text;

namespace ThreeSM.EnduranceConnector
{
    [DataContract]
    public sealed class PaceCaptureFrame
    {
        [DataMember(Name="schemaRevision")] public int SchemaRevision = 1;
        [DataMember(Name="observedSessionId")] public string ObservedSessionId;
        [DataMember(Name="segmentId")] public string SegmentId;
        [DataMember(Name="opponentMetrics")] public PaceMetric[] OpponentMetrics;
        [DataMember(Name="opponentLaps")] public PaceLap[] OpponentLaps;
        [DataMember(Name="traceChunks")] public PaceChunk[] TraceChunks;
        // Additive v1 extension. Absent on frames without live sectors, so the old
        // byte shape of main telemetry is unchanged.
        [DataMember(Name="sectorUpdates", EmitDefaultValue=false)] public PaceSectorUpdate[] SectorUpdates;
    }
    [DataContract]
    public sealed class PaceSectorUpdate
    {
        public const string Provisional="provisional", Verified="verified", Invalidated="invalidated";
        [DataMember(Name="id")] public string Id;
        [DataMember(Name="lap")] public int Lap;
        [DataMember(Name="sectorIndex")] public int SectorIndex;
        [DataMember(Name="sectorCount")] public int SectorCount;
        [DataMember(Name="seconds")] public double? Seconds;
        [DataMember(Name="completedSessionTimeSeconds")] public double CompletedSessionTimeSeconds;
        [DataMember(Name="observedSessionTimeSeconds")] public double ObservedSessionTimeSeconds;
        [DataMember(Name="revision")] public long Revision;
        [DataMember(Name="status")] public string Status;
        [DataMember(Name="referenceSeconds")] public double? ReferenceSeconds;
    }
    [DataContract]
    public sealed class PaceMetric
    {
        [DataMember(Name="id")] public string Id;
        [DataMember(Name="observedSessionTimeSeconds")] public double ObservedSessionTimeSeconds;
        [DataMember(Name="lastLapSeconds")] public double? LastLapSeconds;
        [DataMember(Name="bestLapSeconds")] public double? BestLapSeconds;
        [DataMember(Name="lastLapSectorSeconds")] public double?[] LastLapSectorSeconds;
        [DataMember(Name="bestLapSectorSeconds")] public double?[] BestLapSectorSeconds;
        [DataMember(Name="bestSectorSeconds")] public double?[] BestSectorSeconds;
        [DataMember(Name="bestLapDeltaToFieldBestSeconds")] public double? BestLapDeltaToFieldBestSeconds;
        [DataMember(Name="bestLapDeltaToPlayerSeconds")] public double? BestLapDeltaToPlayerSeconds;
        [DataMember(Name="lapValid")] public bool? LapValid;
        [DataMember(Name="lapHighPrecision")] public double? LapHighPrecision;
        [DataMember(Name="trackPositionPercentRaw")] public double? TrackPositionPercentRaw;
        [DataMember(Name="sectorMismatchCount")] public long SectorMismatchCount;
        [DataMember(Name="sectorCount", EmitDefaultValue=false)] public int? SectorCount;
        [DataMember(Name="sectorSource", EmitDefaultValue=false)] public string SectorSource;
        [DataMember(Name="sectorLap", EmitDefaultValue=false)] public int? SectorLap;
        [DataMember(Name="sectorErrorSeconds", EmitDefaultValue=false)] public double? SectorErrorSeconds;
        [DataMember(Name="bestSectorSource", EmitDefaultValue=false)] public string BestSectorSource;
        [DataMember(Name="bestSectorErrorSeconds", EmitDefaultValue=false)] public double? BestSectorErrorSeconds;
        [DataMember(Name="sectorDiagnostic", EmitDefaultValue=false)] public SectorDiagnostic SectorDiagnostic;
        public PaceMetric Copy() { return (PaceMetric)MemberwiseClone(); }
    }
    [DataContract]
    public sealed class SectorDiagnostic
    {
        [DataMember(Name="source")] public string Source;
        [DataMember(Name="count")] public int Count;
        [DataMember(Name="sumSeconds")] public double? SumSeconds;
        [DataMember(Name="reportedSeconds")] public double? ReportedSeconds;
        [DataMember(Name="errorSeconds")] public double? ErrorSeconds;
        [DataMember(Name="reason")] public string Reason;
        public SectorDiagnostic Copy() { return (SectorDiagnostic)MemberwiseClone(); }
    }

    /// <summary>Boundary interpolation in source session time, never wall time.
    /// Every seam needs consecutive, on-track samples; incomplete laps stay empty.
    /// Sectors are published provisionally as soon as both ends are genuinely
    /// observed, then revised to verified or invalidated by the whole-lap gate.</summary>
    public sealed class SectorMeasurement
    {
        private const int MaxSnapshotStates = 48, MaxChangedUpdates = 64;
        private double[] starts, crossings, pending, pendingEnds, verified, best;
        private double?[] sectorBest;
        private PaceObservation previous;
        private double time, pendingAt;
        private int pendingLap, verifiedLap, completed, openLap;
        private bool pendingActive, openValid;
        private bool firstCompleteDiagnostic, sampleDiagnostic;
        private bool[] published;
        private long revision;
        private readonly List<PaceSectorUpdate> changed = new List<PaceSectorUpdate>();
        private readonly List<PaceSectorUpdate> latest = new List<PaceSectorUpdate>();
        private readonly Dictionary<long, PaceSectorUpdate> latestByKey = new Dictionary<long, PaceSectorUpdate>();
        public SectorMeasurement() { }
        public SectorMeasurement(long revisionBase) { revision = revisionBase < 0 ? 0 : revisionBase; }
        public bool DiagnosticReady { get { return Diagnostic!=null && time-pendingAt>=2; } }
        private double? verifiedReported, bestReported;
        public SectorDiagnostic Diagnostic { get; private set; }
        public double? Error { get; private set; }
        public double? BestError { get; private set; }
        public long Revision { get { return revision; } }
        public int SnapshotCount { get { return latest.Count; } }
        public static double[] Layout(double[] value)
        {
            if (value == null || value.Length < 1 || value.Length > 16 || value[0] != 0) return null;
            for (int i=0;i<value.Length;i++)
                if (double.IsNaN(value[i]) || double.IsInfinity(value[i]) || value[i]<0 || value[i]>=1 || i>0 && value[i]<=value[i-1]) return null;
            return value;
        }
        public double?[] Last(PaceObservation o)
        { return verified != null && o.Lap == verifiedLap+1 && o.LastLapSeconds == verifiedReported ? verified.Select(v=>(double?)v).ToArray() : null; }
        public double?[] Best(PaceObservation o)
        { return best != null && o.BestLapSeconds == bestReported ? best.Select(v=>(double?)v).ToArray() : null; }
        public void Observe(double now, PaceObservation o, double[] layout)
        {
            if (!PrepareLayout(layout)) { time=now; return; }
            // Validation has its own delayed-last-lap grace; a later gap or pit on the
            // next lap must never erase an already finished, still-valid measurement.
            if (pendingActive) ResolvePending(now,o);
            bool usable=o!=null && o.Connected && !o.InPit && o.Lap.HasValue && o.Lap.Value>=1 && o.Lap.Value<=100000
                && PaceCaptureBuffer.Number(o.Distance,0,1).HasValue && (o.Metric==null || o.Metric.LapValid!=false);
            if(!usable) { InvalidateOpenLap(now); previous=null; crossings=null; time=now; return; }
            double dt=now-time;
            if(previous!=null)
            {
                double from=previous.Distance.Value, to=o.Distance.Value;
                bool wrap=o.Lap==previous.Lap+1 && from>0.98 && to<0.02;
                bool forward=o.Lap==previous.Lap && to>=from;
                double travel=wrap ? 1-from+to : to-from;
                if(dt<=0 || dt>0.25 || (!wrap && !forward) || travel>2.0/127)
                {
                    // A gap/pit/reset makes the open lap discontinuous. Already
                    // verified laps and an earlier pending finish are left alone.
                    InvalidateOpenLap(now); crossings=null;
                    previous=o; time=now; return;
                }
                if(travel>0)
                {
                    double end=wrap ? 1+to : to;
                    if(wrap) HandleWrap(from,to,time,now,o,travel);
                    else { Cross(from,end,time,now); PublishCrossed(o.Id,now); }
                }
            }
            previous=o; time=now;
        }
        private bool PrepareLayout(double[] layout)
        {
            layout=Layout(layout);
            if(layout==null) { ClearState(); return false; }
            if(starts==null || !starts.SequenceEqual(layout))
            {
                ClearState();
                starts=(double[])layout.Clone();
                sectorBest=new double?[starts.Length];
            }
            return true;
        }
        private void ClearState()
        {
            starts=null; crossings=null; pending=null; pendingEnds=null; verified=null; best=null;
            previous=null; Diagnostic=null; firstCompleteDiagnostic=false; sampleDiagnostic=false;
            Error=null; BestError=null; pendingActive=false; pendingLap=0; pendingAt=0;
            verifiedLap=0; openLap=0; openValid=false; published=null;
            sectorBest=null; changed.Clear(); latest.Clear(); latestByKey.Clear();
        }
        private void HandleWrap(double from,double to,double begin,double now,PaceObservation o,double travel)
        {
            // A pending validation older than the delayed window must not survive
            // another full lap.
            if(pendingActive) InvalidatePending(now);
            int finishedLap=previous.Lap.HasValue ? previous.Lap.Value : openLap;
            double finish=begin+(now-begin)*(1-from)/travel;
            Cross(from,1,begin,finish);
            double[] candidate=null;
            double[] ends=null;
            if(openValid && published!=null && openLap==finishedLap)
            {
                PublishAllCompleted(o.Id,finish,now);
                if(crossings!=null && crossings.All(v=>!double.IsNaN(v)))
                {
                    candidate=Enumerable.Range(0,starts.Length)
                        .Select(i=>(i+1<starts.Length?crossings[i+1]:finish)-crossings[i]).ToArray();
                    ends=Enumerable.Range(0,starts.Length)
                        .Select(i=>(i+1<starts.Length?crossings[i+1]:finish)).ToArray();
                }
                if(candidate==null) InvalidateOpenLap(now);
            }
            pending=candidate; pendingEnds=ends;
            pendingLap=finishedLap; pendingAt=now; pendingActive=pending!=null;
            verified=null; Error=null;
            completed++;
            sampleDiagnostic=completed==1 || completed%20==0 || (!firstCompleteDiagnostic && pending!=null);
            if(pending!=null) firstCompleteDiagnostic=true;
            if(sampleDiagnostic)
                Diagnostic=new SectorDiagnostic { Source="measured", Count=starts.Length, Reason="incomplete", ReportedSeconds=o.LastLapSeconds };
            // Finish first, then boundaries of the next lap, even with very short sectors.
            crossings=Enumerable.Repeat(double.NaN,starts.Length).ToArray(); crossings[0]=finish;
            openLap=o.Lap.HasValue ? o.Lap.Value : finishedLap+1;
            openValid=true; published=new bool[starts.Length];
            Cross(0,to,finish,now);
            if(pendingActive) ResolvePending(now,o);
        }
        private void PublishCrossed(string id,double now)
        {
            if(!openValid || crossings==null || published==null) return;
            for(int i=1;i<starts.Length;i++)
            {
                if(published[i-1] || double.IsNaN(crossings[i]) || double.IsNaN(crossings[i-1])) continue;
                PublishSector(openLap,i-1,crossings[i-1],crossings[i],id,now);
            }
        }
        private void PublishAllCompleted(string id,double finish,double now)
        {
            if(!openValid || crossings==null || published==null) return;
            for(int i=0;i<starts.Length;i++)
            {
                if(published[i]) continue;
                double start=i==0 ? crossings[0] : crossings[i];
                double end=i+1<starts.Length ? crossings[i+1] : finish;
                if(double.IsNaN(start) || double.IsNaN(end)) continue;
                PublishSector(openLap,i,start,end,id,now);
            }
        }
        private void PublishSector(int lap,int index,double start,double end,string id,double now)
        {
            if(published==null || index<0 || index>=starts.Length || published[index]) return;
            double seconds=end-start;
            if(!(seconds>0) || seconds>86400) return;
            double? reference=sectorBest!=null && index<sectorBest.Length ? sectorBest[index] : null;
            Emit(new PaceSectorUpdate {
                Id=id, Lap=lap, SectorIndex=index, SectorCount=starts.Length, Seconds=seconds,
                CompletedSessionTimeSeconds=end, ObservedSessionTimeSeconds=now,
                Status=PaceSectorUpdate.Provisional, ReferenceSeconds=reference
            });
            published[index]=true;
        }
        private void ResolvePending(double now,PaceObservation o)
        {
            if(!pendingActive) return;
            // The only invalidation on the clock is the explicit delayed-lap grace.
            if(now-pendingAt>2.000001) { InvalidatePending(now); return; }
            if(o==null || !o.Lap.HasValue || o.Lap.Value!=pendingLap+1) return;
            if(o.ReportedLap.HasValue && o.ReportedLap.Value!=pendingLap) return;
            double? reported=PaceCaptureBuffer.Number(o.LastLapSeconds,0.001,86400);
            double sum=pending.Sum();
            Error=reported.HasValue ? (double?)(sum-reported.Value) : null;
            if(Diagnostic!=null && sampleDiagnostic)
            {
                Diagnostic.SumSeconds=sum; Diagnostic.ReportedSeconds=o.LastLapSeconds; Diagnostic.ErrorSeconds=Error;
                Diagnostic.Reason=Error.HasValue ? (Math.Abs(Error.Value)<=0.100000001 ? "valid" : "sum_mismatch") : "missing_lap";
            }
            // A stale LastLapTime may still arrive inside the grace window: retry
            // instead of invalidating a mismatch on its first sighting.
            if(Error.HasValue && Math.Abs(Error.Value)<=0.100000001 && pending.All(v=>v>0))
                VerifyPending(now,o);
        }
        private void VerifyPending(double now,PaceObservation o)
        {
            int lap=pendingLap;
            double[] values=pending;
            double[] ends=pendingEnds;
            for(int i=0;i<values.Length;i++)
            {
                double? reference=ReferenceFor(lap,i);
                Emit(new PaceSectorUpdate {
                    Id=o.Id, Lap=lap, SectorIndex=i, SectorCount=values.Length, Seconds=values[i],
                    CompletedSessionTimeSeconds=ends!=null && i<ends.Length ? ends[i] : now,
                    ObservedSessionTimeSeconds=now, Status=PaceSectorUpdate.Verified,
                    ReferenceSeconds=reference
                });
                // Freeze the next lap's reference only after this lap is proven.
                if(sectorBest==null || sectorBest.Length!=values.Length) sectorBest=new double?[values.Length];
                if(!sectorBest[i].HasValue || values[i]<sectorBest[i].Value) sectorBest[i]=values[i];
            }
            verified=values; verifiedLap=lap; verifiedReported=o.LastLapSeconds;
            if(o.BestLapSeconds.HasValue && o.LastLapSeconds.HasValue && Math.Abs(o.BestLapSeconds.Value-o.LastLapSeconds.Value)<0.000001)
            { best=(double[])values.Clone(); bestReported=o.BestLapSeconds; BestError=Error; }
            pending=null; pendingEnds=null; pendingActive=false;
        }
        private void InvalidatePending(double now)
        {
            if(!pendingActive) return;
            int lap=pendingLap;
            for(int i=0;i<starts.Length;i++) InvalidateIdentity(lap,i,now);
            pending=null; pendingEnds=null; pendingActive=false;
        }
        private void InvalidateOpenLap(double now)
        {
            if(openValid && published!=null)
                for(int i=0;i<published.Length;i++)
                    if(published[i]) InvalidateIdentity(openLap,i,now);
            published=null; openLap=0; openValid=false;
        }
        private void InvalidateIdentity(int lap,int index,double now)
        {
            PaceSectorUpdate existing;
            if(!latestByKey.TryGetValue(Key(lap,index),out existing)) return;
            if(existing.Status!=PaceSectorUpdate.Provisional) return;
            Emit(new PaceSectorUpdate {
                Id=existing.Id, Lap=lap, SectorIndex=index, SectorCount=existing.SectorCount,
                Seconds=null, CompletedSessionTimeSeconds=existing.CompletedSessionTimeSeconds,
                ObservedSessionTimeSeconds=now, Status=PaceSectorUpdate.Invalidated,
                ReferenceSeconds=existing.ReferenceSeconds
            });
        }
        private double? ReferenceFor(int lap,int index)
        {
            PaceSectorUpdate existing;
            if(latestByKey.TryGetValue(Key(lap,index),out existing)) return existing.ReferenceSeconds;
            return sectorBest!=null && index<sectorBest.Length ? sectorBest[index] : null;
        }
        private void Emit(PaceSectorUpdate update)
        {
            update.Revision=++revision;
            Store(update);
        }
        private void Store(PaceSectorUpdate update)
        {
            long key=Key(update.Lap,update.SectorIndex);
            PaceSectorUpdate existing;
            if(latestByKey.TryGetValue(key,out existing))
            {
                // A later lower revision may never replace newer state.
                if(existing.Revision>update.Revision) return;
                int at=latest.IndexOf(existing);
                if(at>=0) latest[at]=update; else latest.Add(update);
                latestByKey[key]=update;
            }
            else
            {
                latestByKey[key]=update;
                latest.Add(update);
            }
            int changedAt=-1;
            for(int i=0;i<changed.Count;i++)
                if(Key(changed[i].Lap,changed[i].SectorIndex)==key) { changedAt=i; break; }
            if(changedAt>=0) changed[changedAt]=update;
            else
            {
                changed.Add(update);
                while(changed.Count>MaxChangedUpdates) changed.RemoveAt(0);
            }
            while(latest.Count>MaxSnapshotStates)
            {
                int oldest=0;
                for(int i=1;i<latest.Count;i++)
                    if(latest[i].Lap<latest[oldest].Lap || latest[i].Lap==latest[oldest].Lap && latest[i].SectorIndex<latest[oldest].SectorIndex) oldest=i;
                var drop=latest[oldest];
                latest.RemoveAt(oldest);
                latestByKey.Remove(Key(drop.Lap,drop.SectorIndex));
            }
        }
        public PaceSectorUpdate TakeChanged()
        {
            if(changed.Count==0) return null;
            var update=changed[0]; changed.RemoveAt(0); return update;
        }
        public PaceSectorUpdate SnapshotAt(int offset)
        {
            if(latest.Count==0) return null;
            int at=offset%latest.Count; if(at<0) at+=latest.Count;
            return latest[at];
        }
        private static long Key(int lap,int index) { return ((long)lap<<8)|(uint)index; }
        private void Cross(double from,double to,double begin,double end)
        {
            if(crossings==null || to<=from) return;
            for(int i=1;i<starts.Length;i++)
                if(double.IsNaN(crossings[i]) && starts[i]>from && starts[i]<=to)
                    crossings[i]=begin+(end-begin)*(starts[i]-from)/(to-from);
        }
    }

    [DataContract]
    public sealed class PaceLap
    {
        [DataMember(Name="id")] public string Id;
        [DataMember(Name="lap")] public int Lap;
        [DataMember(Name="seconds")] public double Seconds;
        [DataMember(Name="observedSessionTimeSeconds")] public double ObservedSessionTimeSeconds;
        [DataMember(Name="quality")] public string Quality = "sampled";
        [DataMember(Name="observationId")] public string ObservationId;
    }
    [DataContract]
    public sealed class PaceChunk
    {
        [DataMember(Name="id")] public string Id;
        [DataMember(Name="traceId")] public string TraceId;
        [DataMember(Name="lap")] public int Lap;
        [DataMember(Name="chunkIndex")] public int ChunkIndex;
        [DataMember(Name="finalChunk")] public bool FinalChunk;
        [DataMember(Name="anchorSessionTimeMs")] public int? AnchorSessionTimeMs;
        [DataMember(Name="anchorUncertaintyMs")] public int? AnchorUncertaintyMs;
        [DataMember(Name="lapSeconds")] public double? LapSeconds;
        [DataMember(Name="provenance")] public string Provenance = "simhub-opponent-sampled";
        [DataMember(Name="speedUnit")] public string SpeedUnit;
        [DataMember(Name="points")] public int?[][] Points;
    }
    public sealed class PaceObservation
    {
        public string Id;
        public int? Lap, ReportedLap;
        public string LapSource;
        public double? Distance, SpeedKph, LastLapSeconds, BestLapSeconds;
        public bool InPit, Connected, IsPlayer;
        public int? Position;
        public PaceMetric Metric;
    }

    /// <summary>Pure, bounded capture. Session clock only; no guessed lap clock or wallclock.</summary>
    public sealed class PaceCaptureBuffer
    {
        public const int MaxCars = 40, Bins = 128, MaxLaps = 20;
        private sealed class Trace
        {
            public int Lap;
            public string TraceId = Guid.NewGuid().ToString("N");
            public int? Anchor, Uncertainty;
            public double? Seconds;
            public readonly int?[][] Points = new int?[Bins][];
        }
        private sealed class Car
        {
            public PaceObservation Previous;
            public double Time;
            public Trace Current, Last, Best;
            public PaceMetric Metric;
            public readonly Queue<PaceLap> Laps = new Queue<PaceLap>();
            public long Mismatches;
            public string LastMismatch;
            public SectorDiagnostic EmittedDiagnostic;
            public int? PendingHistoryLap;
            public double PendingHistoryAt;
            public int SnapshotCursor;
            public readonly SectorMeasurement Sectors;
            public Car(long revisionBase=0) { Sectors=new SectorMeasurement(revisionBase); }
        }
        private readonly object gate = new object();
        private readonly Dictionary<string, Car> cars = new Dictionary<string, Car>(StringComparer.Ordinal);
        private string session, segment;
        private double lastTime = -1, lastSent = -1;
        private long? lastTick;
        private int cursor, metricCursor, sectorChangeCursor, snapshotCarCursor;
        private double[] activeLayout;
        public int CarCount { get { lock(gate) return cars.Count; } }
        public int StoredLapCount { get { lock(gate) return cars.Values.Sum(c=>c.Laps.Count); } }
        public int StoredSectorUpdateCount { get { lock(gate) return cars.Values.Sum(c=>c.Sectors.SnapshotCount); } }
        public int PointCount { get { lock(gate) return cars.Values.Sum(c => new[] {c.Current,c.Last,c.Best}.Where(t=>t!=null).Sum(t=>t.Points.Count(p=>p!=null))); } }
        public void Reset() { lock(gate) { cars.Clear(); session=null; segment=null; lastTime=-1; lastSent=-1; lastTick=null; cursor=0; metricCursor=0; sectorChangeCursor=0; snapshotCarCursor=0; activeLayout=null; } }
        public static double? Number(double? n, double min, double max)
        { return n.HasValue && !double.IsNaN(n.Value) && !double.IsInfinity(n.Value) && n >= min && n <= max ? n : null; }
        public static double?[] Sectors(double?[] sectors, double? lap)
        {
            lap=Number(lap,0.001,86400);
            if (lap==null || sectors==null || sectors.Length<1 || sectors.Length>16 || sectors.Any(s=>Number(s,0.001,86400)==null)) return null;
            return Math.Abs(sectors.Sum(s=>s.Value)-lap.Value) <= 0.100000001 ? sectors : null;
        }
        private static Trace NewTrace(int lap) { return new Trace {Lap=lap}; }
        public void Observe(string observedSession, double? time, long? tick, IEnumerable<PaceObservation> observations, double[] sectorStarts = null)
        {
            lock(gate)
            {
                if (string.IsNullOrEmpty(observedSession) || observedSession.Length>64 || Number(time,0,86400)==null) { Reset(); return; }
                if(session!=observedSession || (lastTime>=0 && time<lastTime-0.000001)) { Reset(); session=observedSession; segment=Guid.NewGuid().ToString("N"); }
                // A different measured layout is a new namespace, never a merge of
                // sectors from two geometries.
                var layout=SectorMeasurement.Layout(sectorStarts);
                if(activeLayout!=null && (layout==null || !activeLayout.SequenceEqual(layout)))
                { Reset(); session=observedSession; segment=Guid.NewGuid().ToString("N"); }
                if(layout==null) activeLayout=null;
                else if(activeLayout==null || !activeLayout.SequenceEqual(layout)) activeLayout=(double[])layout.Clone();
                if (lastTime>=0 && (time-lastTime < 0.049999 || (tick.HasValue && tick==lastTick))) return;
                var input=observations.Where(o=>o!=null && !string.IsNullOrEmpty(o.Id) && o.Id.Length<=64)
                    .OrderBy(o=>o.IsPlayer?0:o.Position==1?1:2).ThenBy(o=>o.Id,StringComparer.Ordinal).Take(MaxCars).ToArray();
                // A restart can reset lap counters while SessionTime continues advancing.
                // A source tick rollback is also a new epoch, never an interpolation seam.
                if ((tick.HasValue && lastTick.HasValue && tick<lastTick) || input.Any(o=>o.IsPlayer && cars.ContainsKey(o.Id) && o.Lap.HasValue && cars[o.Id].Previous?.Lap > o.Lap))
                { Reset(); session=observedSession; segment=Guid.NewGuid().ToString("N"); }
                lastTime=time.Value; lastTick=tick;
                var active=new HashSet<string>(input.Select(o=>o.Id),StringComparer.Ordinal);
                foreach(var old in cars.Keys.Where(id=>!active.Contains(id)).ToArray()) cars.Remove(old);
                foreach(var o in input)
                {
                    Car c;
                    if(!cars.TryGetValue(o.Id,out c)) { if(cars.Count>=MaxCars) continue; cars[o.Id]=c=new Car(); }
                    if(c.Previous?.Lap > o.Lap) cars[o.Id]=c=new Car(c.Sectors.Revision);
                    c.Sectors.Observe(time.Value,o,sectorStarts);
                    var m=o.Metric;
                    if(m!=null)
                    {
                        int? count=SectorMeasurement.Layout(sectorStarts)==null ? (int?)null : sectorStarts.Length;
                        // Legacy senders with no layout retain their existing three-field path.
                        var last=count.HasValue && m.LastLapSectorSeconds?.Length!=count ? null : Sectors(m.LastLapSectorSeconds,o.LastLapSeconds);
                        var best=count.HasValue && m.BestLapSectorSeconds?.Length!=count ? null : Sectors(m.BestLapSectorSeconds,o.BestLapSeconds);
                        var measured=c.Sectors.Last(o); var measuredBest=c.Sectors.Best(o);
                        m.SectorCount=count;
                        m.SectorLap=o.Lap>1 ? o.Lap-1 : null;
                        m.SectorSource=measured!=null ? "measured" : last!=null ? "simhub" : null;
                        m.SectorErrorSeconds=measured!=null ? c.Sectors.Error : last!=null ? (double?)(last.Sum(v=>v.Value)-o.LastLapSeconds.Value) : c.Sectors.Error;
                        m.BestSectorSource=measuredBest!=null ? "measured" : best!=null ? "simhub" : null;
                        m.BestSectorErrorSeconds=measuredBest!=null ? c.Sectors.BestError : best!=null ? (double?)(best.Sum(v=>v.Value)-o.BestLapSeconds.Value) : null;
                        m.SectorDiagnostic=c.Sectors.Diagnostic;
                        if(o.Metric.LapValid==false || !o.Connected || o.InPit || o.ReportedLap.HasValue && o.Lap!=o.ReportedLap+1) { last=null; measured=null; m.SectorSource=null; }

                        var bad=(m.LastLapSectorSeconds!=null && last==null) || (m.BestLapSectorSeconds!=null && best==null);
                        var signature=string.Join("/",(m.LastLapSectorSeconds??new double?[0]).Concat(m.BestLapSectorSeconds??new double?[0]).Select(v=>v.ToString()))+o.LastLapSeconds+"/"+o.BestLapSeconds;
                        if(!bad) c.LastMismatch=null;
                        if(bad && signature!=c.LastMismatch) { c.Mismatches++; c.LastMismatch=signature; }
                        m.LastLapSectorSeconds=measured??last; m.BestLapSectorSeconds=measuredBest??best;
                        m.LastLapSeconds=o.LastLapSeconds; m.BestLapSeconds=o.BestLapSeconds;
                        m.SectorMismatchCount=c.Mismatches; m.Id=o.Id; m.ObservedSessionTimeSeconds=time.Value;
                        c.Metric=m;
                    }
                    var p=c.Previous; var dt=time.Value-c.Time;
                    if(p!=null && o.Lap==p.Lap+1) { c.PendingHistoryLap=p.Lap; c.PendingHistoryAt=time.Value; }
                    if(c.PendingHistoryLap.HasValue && o.Lap==c.PendingHistoryLap+1 && (!o.ReportedLap.HasValue || o.ReportedLap==c.PendingHistoryLap) && time.Value-c.PendingHistoryAt>=0.25 && time.Value-c.PendingHistoryAt<=2
                        && Number(o.LastLapSeconds,0.001,86400).HasValue && o.Metric?.LapValid!=false)
                    {
                        c.Laps.Enqueue(new PaceLap {Id=o.Id,Lap=c.PendingHistoryLap.Value,Seconds=o.LastLapSeconds.Value,ObservedSessionTimeSeconds=time.Value,ObservationId=segment+":"+c.PendingHistoryLap.Value});
                        while(c.Laps.Count>MaxLaps) c.Laps.Dequeue();
                        c.PendingHistoryLap=null;
                    }

                    var usable=o.Connected && !o.InPit && o.Lap.HasValue && Number(o.Distance,0,1).HasValue;
                    var previousUsable=p!=null && p.Connected && !p.InPit && p.Lap.HasValue && Number(p.Distance,0,1).HasValue;
                    if(!usable) { c.Current=null; c.Previous=null; c.Time=time.Value; continue; }
                    if(c.Current==null) c.Current=NewTrace(o.Lap.Value);
                    if(previousUsable && dt>0 && dt<=0.25)
                    {
                        if(o.Lap==p.Lap && o.Distance>=p.Distance && o.Distance-p.Distance<=2.0/127)
                        {
                            Fill(c.Current,p.Distance.Value,o.Distance.Value,c.Time,time.Value,p.SpeedKph,o.SpeedKph);
                        }
                        else if(o.Lap==p.Lap+1 && p.Distance>0.98 && o.Distance<0.02 && 1-p.Distance+o.Distance<=2.0/127)
                        {
                            var anchor=(int)Math.Round(1000*(c.Time+dt*(1-p.Distance.Value)/(1-p.Distance.Value+o.Distance.Value)));
                            var old=c.Current;
                            Fill(old,p.Distance.Value,1,c.Time,anchor/1000.0,p.SpeedKph,o.SpeedKph);
                            if(old.Anchor.HasValue && old.Uncertainty.HasValue && o.Metric!=null && o.Metric.LapValid!=false && Number(o.LastLapSeconds,0.001,86400).HasValue
                                && Math.Abs((anchor-old.Anchor.Value)/1000.0-o.LastLapSeconds.Value)<=0.25)
                            {
                                old.Seconds=o.LastLapSeconds;
                                c.Last=old;
                                if(old.Points.All(v=>v!=null) && (c.Best==null || old.Seconds<c.Best.Seconds)) c.Best=old;

                            }
                            c.Current=NewTrace(o.Lap.Value); c.Current.Anchor=anchor; c.Current.Uncertainty=(int)Math.Ceiling(dt*1000);
                            Fill(c.Current,0,o.Distance.Value,anchor/1000.0,time.Value,p.SpeedKph,o.SpeedKph);
                        }
                        else c.Current=NewTrace(o.Lap.Value); // discontinuity: no invented seam
                    }
                    else if(previousUsable) c.Current=NewTrace(o.Lap.Value); // gap: invalidate anchor
                    c.Previous=o; c.Time=time.Value;
                }
            }
        }
        private static void Fill(Trace trace,double from,double to,double start,double end,double? speedA,double? speedB)
        {
            if(trace==null || to<=from) return;
            for(int b=(int)Math.Ceiling(from*127);b<=Math.Floor(to*127) && b<Bins;b++)
            {
                if(trace.Points[b]!=null) continue;
                var ratio=(b/127.0-from)/(to-from);
                var speed=Number(speedA,0,600).HasValue && Number(speedB,0,600).HasValue ? (int?)Math.Round(10*(speedA.Value+ratio*(speedB.Value-speedA.Value))) : null;
                trace.Points[b]=new int?[] {b,(int)Math.Round(1000*(start+ratio*(end-start))),speed};
            }
        }
        public PaceCaptureFrame NextFrame()
        {
            lock(gate)
            {
                if(session==null || cars.Count==0 || lastTime-lastSent<1) return null;
                lastSent=lastTime;
                var ids=cars.OrderBy(k=>k.Value.Previous!=null && k.Value.Previous.IsPlayer?0:k.Value.Previous!=null && k.Value.Previous.Position==1?1:2).ThenBy(k=>k.Key,StringComparer.Ordinal).Select(k=>k.Key).ToArray();
                int n=ids.Length;
                // Heavy trace round-robin is deliberately independent from changed
                // sector delivery; both use fair rotating cursors over all cars.
                int turn=cursor++; int index=turn%3==0?0:turn%3==1?Math.Min(1,n-1):(turn/3)%n;
                var traceCar=cars[ids[index]];
                var traces=new[] {traceCar.Current,traceCar.Last,traceCar.Best}.Where(t=>t!=null).Distinct().ToArray();
                var chunks=new List<PaceChunk>();
                if(traces.Length>0)
                {
                    int round=turn/Math.Max(1,n); var trace=traces[(round/4)%traces.Length]; int part=round%4;
                    var pts=trace.Points.Skip(part*32).Take(32).Where(p=>p!=null).ToArray();
                    if(pts.Length>0) chunks.Add(new PaceChunk {Id=ids[index],TraceId=trace.TraceId,Lap=trace.Lap,ChunkIndex=part,FinalChunk=trace.Seconds.HasValue,
                        AnchorSessionTimeMs=trace.Anchor,AnchorUncertaintyMs=trace.Uncertainty,LapSeconds=trace.Seconds,
                        SpeedUnit=pts.Any(p=>p[2].HasValue)?"km/h":null,Points=pts});
                }
                // Up to four metrics per frame, in a pure rotation: own/leader get no
                // permanent slot at the expense of other cars.
                var metrics=new List<PaceMetric>();
                int metricScanned=0;
                for(int k=0;k<n && metrics.Count<4;k++)
                {
                    metricScanned++;
                    var candidate=cars[ids[(metricCursor+k)%n]];
                    var metric=candidate.Metric?.Copy();
                    if(metric==null) continue;
                    var diagnostic=metric.SectorDiagnostic;
                    // First completed lap, then every twentieth. Emit only after the
                    // delayed-lap window; one attempt, no retransmit/outbox/ACK pressure.
                    metric.SectorDiagnostic=diagnostic!=null && diagnostic!=candidate.EmittedDiagnostic && candidate.Sectors.DiagnosticReady ? diagnostic.Copy() : null;
                    if(metric.SectorDiagnostic!=null) candidate.EmittedDiagnostic=diagnostic;
                    metrics.Add(metric);
                }
                if(n>0) metricCursor=(metricCursor+Math.Max(1,metricScanned))%n;
                // Changed sectors first, one per car per pass, so a 40-car burst is
                // spread evenly instead of one car monopolising all eight slots.
                var updates=new List<PaceSectorUpdate>();
                var seen=new HashSet<string>(StringComparer.Ordinal);
                if(n>0)
                {
                    int start=sectorChangeCursor%n, next=start;
                    for(int pass=0;pass<8 && updates.Count<8;pass++)
                    {
                        bool took=false;
                        for(int k=0;k<n && updates.Count<8;k++)
                        {
                            int at=(start+k)%n; next=(at+1)%n;
                            var update=cars[ids[at]].Sectors.TakeChanged();
                            if(update==null) continue;
                            updates.Add(update); took=true;
                            seen.Add(update.Id+"/"+update.Lap+"/"+update.SectorIndex);
                        }
                        if(!took) break;
                    }
                    sectorChangeCursor=next;
                    // Repeat/background snapshots fill the remaining slots for loss
                    // recovery. Identical revisions are idempotent for the server.
                    if(updates.Count<8)
                    {
                        int snapStart=snapshotCarCursor%n, snapNext=snapStart;
                        for(int k=0;k<n && updates.Count<8;k++)
                        {
                            int at=(snapStart+k)%n; snapNext=(at+1)%n;
                            var car=cars[ids[at]];
                            var update=car.Sectors.SnapshotAt(car.SnapshotCursor);
                            if(update==null) continue;
                            car.SnapshotCursor++;
                            var key=update.Id+"/"+update.Lap+"/"+update.SectorIndex;
                            if(!seen.Add(key)) continue;
                            updates.Add(update);
                        }
                        snapshotCarCursor=snapNext;
                    }
                }
                return new PaceCaptureFrame {ObservedSessionId=session,SegmentId=segment,
                    OpponentMetrics=metrics.ToArray(),
                    OpponentLaps=traceCar.Laps.Reverse().Skip((turn/4%5)*4).Take(4).Reverse().ToArray(),
                    TraceChunks=chunks.ToArray(),
                    SectorUpdates=updates.Count==0?null:updates.ToArray()};
            }
        }
        private static PaceCaptureFrame TrimFrame(PaceCaptureFrame source,int updateCount,int metricCount,int lapCount,bool traces,bool diagnostics)
        {
            var frame=new PaceCaptureFrame {ObservedSessionId=source.ObservedSessionId,SegmentId=source.SegmentId};
            var sourceUpdates=source.SectorUpdates??new PaceSectorUpdate[0];
            frame.SectorUpdates=sourceUpdates.Take(Math.Max(0,Math.Min(updateCount,sourceUpdates.Length))).ToArray();
            var sourceMetrics=source.OpponentMetrics??new PaceMetric[0];
            var metrics=new List<PaceMetric>();
            for(int i=0;i<sourceMetrics.Length && metrics.Count<metricCount;i++)
            {
                var metric=sourceMetrics[i].Copy();
                if(!diagnostics) metric.SectorDiagnostic=null;
                metrics.Add(metric);
            }
            frame.OpponentMetrics=metrics.ToArray();
            var sourceLaps=source.OpponentLaps??new PaceLap[0];
            frame.OpponentLaps=sourceLaps.Take(Math.Max(0,lapCount)).ToArray();
            frame.TraceChunks=traces ? (source.TraceChunks??new PaceChunk[0]) : new PaceChunk[0];
            return frame;
        }
        private static bool TryAppendMember(string body,PaceCaptureFrame capture,int bodyCap,out string result)
        {
            result=null;
            string json;
            using(var stream=new MemoryStream()) { new DataContractJsonSerializer(typeof(PaceCaptureFrame)).WriteObject(stream,capture); json=Encoding.UTF8.GetString(stream.ToArray()); }
            var member="\"paceCapture\":"+json;
            if(Encoding.UTF8.GetByteCount(member)>4096) return false;
            if(Encoding.UTF8.GetByteCount(body)+Encoding.UTF8.GetByteCount(member)+1>bodyCap) return false;
            result=body.Substring(0,body.Length-1)+(body.Trim()=="{}"?"":",")+member+"}";
            return true;
        }
        private static int[] DescendingCounts(int maximum,int[] wanted)
        {
            if(maximum<=0) return new[]{0};
            var result=new List<int>();
            foreach(var value in wanted)
            {
                int bounded=Math.Min(maximum,value);
                if(bounded>0 && !result.Contains(bounded)) result.Add(bounded);
            }
            result.Sort(); result.Reverse();
            return result.ToArray();
        }
        private static string AppendLiveWithinBudget(string body,PaceCaptureFrame capture,int bodyCap)
        {
            // Priority: keep every possible changed sector, then metrics, then lap
            // extras, traces and diagnostics. Never mutate the capture owned by the
            // sampler; each candidate is a fresh shallow view.
            var updateCounts=DescendingCounts(Math.Min(8,capture.SectorUpdates.Length),new[]{8,4,2,1});
            var metricCounts=new List<int>(DescendingCounts(capture.OpponentMetrics==null?0:Math.Min(4,capture.OpponentMetrics.Length),new[]{4,2,1,0}));
            // Metrics are existing core PACE, so zero is only a final fallback.
            if(metricCounts.Count==0 || metricCounts[metricCounts.Count-1]!=0) metricCounts.Add(0);
            int[][] optional={ new[]{4,1,1}, new[]{4,0,1}, new[]{2,0,1}, new[]{0,0,1}, new[]{0,0,0} };
            foreach(var updates in updateCounts)
                foreach(var metrics in metricCounts)
                    foreach(var level in optional)
                    {
                        string result;
                        if(TryAppendMember(body,TrimFrame(capture,updates,metrics,level[0],level[1]!=0,level[2]!=0),bodyCap,out result)) return result;
                    }
            return body;
        }
        public static string AppendWithinBudget(string body,PaceCaptureFrame capture,int bodyCap=24000)
        {
            if(capture==null || string.IsNullOrEmpty(body)) return body;
            if(capture.SectorUpdates!=null && capture.SectorUpdates.Length==0)
            {
                // An explicitly empty array is the same optional absence on the wire.
                capture=new PaceCaptureFrame {
                    ObservedSessionId=capture.ObservedSessionId,SegmentId=capture.SegmentId,
                    OpponentMetrics=capture.OpponentMetrics,OpponentLaps=capture.OpponentLaps,
                    TraceChunks=capture.TraceChunks,SectorUpdates=null
                };
            }
            if(capture.SectorUpdates!=null && capture.SectorUpdates.Length>0)
                return AppendLiveWithinBudget(body,capture,bodyCap);
            string json;
            using(var stream=new MemoryStream()) { new DataContractJsonSerializer(typeof(PaceCaptureFrame)).WriteObject(stream,capture); json=Encoding.UTF8.GetString(stream.ToArray()); }
            // Diagnostics have the lowest budget priority. Strip only the optional member
            // from this serialization, never mutate the capture shared with the sampler.
            var member="\"paceCapture\":"+json;
            if(Encoding.UTF8.GetByteCount(member)>4096 || Encoding.UTF8.GetByteCount(body)+Encoding.UTF8.GetByteCount(member)+1>bodyCap)
            {
                json=System.Text.RegularExpressions.Regex.Replace(json, ",?\"sectorDiagnostic\":\\{[^{}]*\\}", "");
                member="\"paceCapture\":"+json;
            }
            if(Encoding.UTF8.GetByteCount(member)>4096 || Encoding.UTF8.GetByteCount(body)+Encoding.UTF8.GetByteCount(member)+1>bodyCap) return body;
            return body.Substring(0,body.Length-1)+(body.Trim()=="{}"?"":",")+member+"}";
        }
    }
}
