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
        public int? Lap;
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
        }
        private readonly object gate = new object();
        private readonly Dictionary<string, Car> cars = new Dictionary<string, Car>(StringComparer.Ordinal);
        private string session, segment;
        private double lastTime = -1, lastSent = -1;
        private long? lastTick;
        private int cursor;
        public int CarCount { get { lock(gate) return cars.Count; } }
        public int StoredLapCount { get { lock(gate) return cars.Values.Sum(c=>c.Laps.Count); } }
        public int PointCount { get { lock(gate) return cars.Values.Sum(c => new[] {c.Current,c.Last,c.Best}.Where(t=>t!=null).Sum(t=>t.Points.Count(p=>p!=null))); } }
        public void Reset() { lock(gate) { cars.Clear(); session=null; segment=null; lastTime=-1; lastSent=-1; lastTick=null; cursor=0; } }
        public static double? Number(double? n, double min, double max)
        { return n.HasValue && !double.IsNaN(n.Value) && !double.IsInfinity(n.Value) && n >= min && n <= max ? n : null; }
        public static double?[] Sectors(double?[] sectors, double? lap)
        {
            lap=Number(lap,0.001,86400);
            if (lap==null || sectors==null || sectors.Length!=3 || sectors.Any(s=>Number(s,0.001,86400)==null)) return null;
            return Math.Abs(sectors.Sum(s=>s.Value)-lap.Value) <= 0.100000001 ? sectors : null;
        }
        private static Trace NewTrace(int lap) { return new Trace {Lap=lap}; }
        public void Observe(string observedSession, double? time, long? tick, IEnumerable<PaceObservation> observations)
        {
            lock(gate)
            {
                if (string.IsNullOrEmpty(observedSession) || observedSession.Length>64 || Number(time,0,86400)==null) { Reset(); return; }
                if(session!=observedSession || (lastTime>=0 && time<lastTime-0.000001)) { Reset(); session=observedSession; segment=Guid.NewGuid().ToString("N"); }
                if (lastTime>=0 && (time-lastTime < 0.099999 || (tick.HasValue && tick==lastTick))) return;
                lastTime=time.Value; lastTick=tick;
                var input=observations.Where(o=>o!=null && !string.IsNullOrEmpty(o.Id) && o.Id.Length<=64)
                    .OrderBy(o=>o.IsPlayer?0:o.Position==1?1:2).ThenBy(o=>o.Id,StringComparer.Ordinal).Take(MaxCars).ToArray();
                var active=new HashSet<string>(input.Select(o=>o.Id),StringComparer.Ordinal);
                foreach(var old in cars.Keys.Where(id=>!active.Contains(id)).ToArray()) cars.Remove(old);
                foreach(var o in input)
                {
                    Car c;
                    if(!cars.TryGetValue(o.Id,out c)) { if(cars.Count>=MaxCars) continue; cars[o.Id]=c=new Car(); }
                    var m=o.Metric;
                    if(m!=null)
                    {
                        var last=Sectors(m.LastLapSectorSeconds,o.LastLapSeconds);
                        var best=Sectors(m.BestLapSectorSeconds,o.BestLapSeconds);
                        var bad=(m.LastLapSectorSeconds!=null && last==null) || (m.BestLapSectorSeconds!=null && best==null);
                        var signature=string.Join("/",(m.LastLapSectorSeconds??new double?[0]).Concat(m.BestLapSectorSeconds??new double?[0]).Select(v=>v.ToString()))+o.LastLapSeconds+"/"+o.BestLapSeconds;
                        if(!bad) c.LastMismatch=null;
                        if(bad && signature!=c.LastMismatch) { c.Mismatches++; c.LastMismatch=signature; }
                        m.LastLapSectorSeconds=last; m.BestLapSectorSeconds=best;
                        m.LastLapSeconds=o.LastLapSeconds; m.BestLapSeconds=o.BestLapSeconds;
                        m.SectorMismatchCount=c.Mismatches; m.Id=o.Id; m.ObservedSessionTimeSeconds=time.Value;
                        c.Metric=m;
                    }
                    var p=c.Previous; var dt=time.Value-c.Time;
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
                                c.Laps.Enqueue(new PaceLap {Id=o.Id,Lap=p.Lap.Value,Seconds=o.LastLapSeconds.Value,ObservedSessionTimeSeconds=time.Value,ObservationId=segment+":"+p.Lap.Value});
                                while(c.Laps.Count>MaxLaps) c.Laps.Dequeue();
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
                // Alternating own / leader / round-robin. Chunks are repeated, never ACKed as durable.
                int turn=cursor++; int index=turn%3==0?0:turn%3==1?Math.Min(1,ids.Length-1):(turn/3)%ids.Length;
                var id=ids[index]; var c=cars[id];
                var traces=new[] {c.Current,c.Last,c.Best}.Where(t=>t!=null).Distinct().ToArray();
                var chunks=new List<PaceChunk>();
                if(traces.Length>0)
                {
                    int round=turn/(Math.Max(1,ids.Length)); var trace=traces[(round/4)%traces.Length]; int part=round%4;
                    var pts=trace.Points.Skip(part*32).Take(32).Where(p=>p!=null).ToArray();
                    if(pts.Length>0) chunks.Add(new PaceChunk {Id=id,TraceId=trace.TraceId,Lap=trace.Lap,ChunkIndex=part,FinalChunk=trace.Seconds.HasValue,
                        AnchorSessionTimeMs=trace.Anchor,AnchorUncertaintyMs=trace.Uncertainty,LapSeconds=trace.Seconds,
                        SpeedUnit=pts.Any(p=>p[2].HasValue)?"km/h":null,Points=pts});
                }
                return new PaceCaptureFrame {ObservedSessionId=session,SegmentId=segment,OpponentMetrics=c.Metric==null?new PaceMetric[0]:new[]{c.Metric},OpponentLaps=c.Laps.Reverse().Skip((turn/4%5)*4).Take(4).Reverse().ToArray(),TraceChunks=chunks.ToArray()};
            }
        }
        public static string AppendWithinBudget(string body,PaceCaptureFrame capture,int bodyCap=24000)
        {
            if(capture==null || string.IsNullOrEmpty(body)) return body;
            string json;
            using(var stream=new MemoryStream()) { new DataContractJsonSerializer(typeof(PaceCaptureFrame)).WriteObject(stream,capture); json=Encoding.UTF8.GetString(stream.ToArray()); }
            var member="\"paceCapture\":"+json;
            if(Encoding.UTF8.GetByteCount(member)>4096 || Encoding.UTF8.GetByteCount(body)+Encoding.UTF8.GetByteCount(member)+1>bodyCap) return body;
            return body.Substring(0,body.Length-1)+","+member+"}";
        }
    }
}
