using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Text.Json;
using ThreeSM.EnduranceConnector;

internal static class SectorMeasurementTests
{
    private static readonly double[] Six={0,0.175453,0.371582,0.477953,0.624897,0.814373};
    private static PaceObservation Sample(double t,double reported=123.05)
    {
        var progress=(t+0.019)/123.05;
        return new PaceObservation {Id="car",Lap=1+(int)progress,Distance=progress-Math.Floor(progress),LastLapSeconds=reported,BestLapSeconds=reported,
            Connected=true,IsPlayer=true,Metric=new PaceMetric {LapValid=true}};
    }
    private static PaceMetric Drive(double[] starts, double reported=123.05, bool gap=false, bool reset=false, double hz=20)
    {
        var b=new PaceCaptureBuffer();
        for(int i=0;i<=(int)(247*hz);i++)
        {
            double t=i/hz;
            if(gap && t>180 && t<181) continue;
            var o=Sample(t,reported);
            if(reset && t>=180) { o.Lap=1; o.Distance=(t-180)/123.05; }
            b.Observe("session",t,i,new[]{o},starts);
        }
        return b.NextFrame().OpponentMetrics[0];
    }
    public static int Run(Action<string,bool,string> check)
    {
        int n=0; void Check(string id,bool ok,string detail) {check("SECTOR-"+id,ok,detail);n++;}
        foreach(double hz in new[]{10.0,20.0})
        {
            var m=Drive(Six,hz:hz);
            var expected=Six.Select((v,i)=>((i+1<Six.Length?Six[i+1]:1)-v)*123.05).ToArray();
            Check("accuracy-"+hz,m.LastLapSectorSeconds!=null && m.LastLapSectorSeconds.Select((v,i)=>Math.Abs(v.Value-expected[i])).Max()<0.00001,"niet-tickuitgelijnde grenzen/finish: interpolatiefout <0,01 ms, "+hz+" Hz");
            Check("sum-"+hz,m.SectorSource=="measured" && Math.Abs(m.SectorErrorSeconds.Value)<0.00001,"zes sectoren tellen op tot onafhankelijke ronde");
            Check("best-"+hz,m.BestLapSectorSeconds?.Length==6 && m.BestSectorSource=="measured","beste ronde blijft één gecontroleerde ronde");
        }
        Check("three",Drive(new[]{0.0,0.3,0.7}).LastLapSectorSeconds?.Length==3,"baan met drie werkelijke sectoren");
        var mismatch=Drive(Six,125.5);
        Check("mismatch",mismatch.LastLapSectorSeconds==null && mismatch.SectorSource==null,"som 2,45 s fout: geen enkele sector publiceren");
        Check("gap",Drive(Six,gap:true).LastLapSectorSeconds==null,"gat midden in ronde maakt hele sectorreeks ongeldig");
        Check("restart",Drive(Six,reset:true).LastLapSectorSeconds==null,"lapreset bij doorlopende klok: geen ronde over de herstart");
        foreach(var layout in new double[][] {null,new double[0],new[]{0.1,0.5},new[]{0.0,0.5,0.4},new[]{0.0,double.NaN},new[]{0.0,1.0},Enumerable.Range(0,17).Select(i=>i/17.0).ToArray()})
            Check("bad-layout-"+n,SectorMeasurement.Layout(layout)==null,"geen veronderstelde drie sectoren bij ontbrekende/verkeerde metadata");
        var b=new PaceCaptureBuffer();
        var sim=Sample(1);sim.Metric.LastLapSectorSeconds=new double?[]{30,40,53.05};
        sim.Metric.BestLapSectorSeconds=new double?[]{30,40,53.05};
        b.Observe("fallback",1,1,new[]{sim},new[]{0.0,0.3,0.7});
        var selected=b.NextFrame().OpponentMetrics[0];
        Check("fallback",selected.SectorSource=="simhub" && selected.LastLapSectorSeconds.Length==3,"SimHub is tweede gecontroleerde bron zonder volledige eigen ronde");
        b.Reset();sim=Sample(1);sim.Metric.LastLapSectorSeconds=new double?[]{30,40,53.05};
        b.Observe("six",1,1,new[]{sim},Six);
        Check("count",b.NextFrame().OpponentMetrics[0].LastLapSectorSeconds==null,"drie SimHub-sectoren zijn geen zes iRacing-sectoren, ook niet bij passende som");
        b.Reset();
        for(int i=0;i<=5000;i++) {var t=i*0.05;b.Observe("delayed",t,i,new[]{Sample(t,t<246.3?120:123.05)},Six);}
        Check("delayed",b.NextFrame().OpponentMetrics[0].SectorSource=="measured","vertraagde LastLapTime valideert alleen de afwachtende finish binnen 2 s");
        b.Observe("delayed",0,0,new[]{Sample(0)},Six);
        Check("clock-reset",b.StoredLapCount==0 && b.NextFrame().OpponentMetrics[0].LastLapSectorSeconds==null,"teruglopende sessieklok wist sectoren en historie");
        var snapshot=new {RawData=new {SessionData=new {SessionInfo=new {SplitTimeInfo=new {Sectors=Six.Select(v=>new {SectorStartPct=v}).ToArray()},WeekendInfo=new {TrackID=3,TrackName="Suzuka",TrackConfigName="GP"},DriverInfo=new {Drivers=new[]{new {CarIdx=7,CarNumber="007"}}}}}}};
        var reader=new RawChannelReader(snapshot,null);
        Check("yaml",reader.ReadSectorStarts().SequenceEqual(Six) && reader.ReadTrackConfiguration()=="3:Suzuka:GP","bestaand RawData.SessionData.SessionInfo-pad, zes echte grenzen en configuratie");
        Check("identity",reader.ReadCarIndices().ContainsKey("007") && reader.ReadCarIndices()["007"]==7,"SDK-arrayidentiteit op exact autonummer, niet naam/volgorde");
        object splitDictionary=new Dictionary<string,object>{{"Sectors",new[]{new Dictionary<string,object>{{"SectorStartPct",0.0}},new Dictionary<string,object>{{"SectorStartPct",0.5}}}}};
        object sessionDictionary=new Dictionary<string,object>{{"SplitTimeInfo",splitDictionary}};
        object dataDictionary=new Dictionary<string,object>{{"SessionInfo",sessionDictionary}};
        object rawDictionary=new Dictionary<string,object>{{"SessionData",dataDictionary}};
        var dict=new Dictionary<string,object>{{"RawData",rawDictionary}};
        Check("dictionary",new RawChannelReader(dict,null).ReadSectorStarts()?.Length==2,"dictionary-YAML is ook leesbaar");
        // A diagnostic is privacy-limited and removable before sacrificing the actual pace frame.
        var frame=new PaceCaptureFrame {ObservedSessionId="s",SegmentId="g",OpponentLaps=new PaceLap[0],TraceChunks=new PaceChunk[0],OpponentMetrics=new[]{new PaceMetric {Id="car",SectorCount=6,SectorDiagnostic=new SectorDiagnostic {Source="measured",Count=6,SumSeconds=123.05,ReportedSeconds=125,ErrorSeconds=-1.95,Reason="sum_mismatch"}}}};
        string wire=PaceCaptureBuffer.AppendWithinBudget("{}",frame);
        Check("diagnostic",wire.Contains("sum_mismatch") && !wire.Contains("device"),"compacte diagnostiek bevat bron/aantal/som/ronde/fout/reden, geen apparaat-id");
        int cap=Encoding.UTF8.GetByteCount(wire)-40;
        string trimmed=PaceCaptureBuffer.AppendWithinBudget("{}",frame,cap);
        using(var parsed=JsonDocument.Parse(trimmed)) Check("budget",trimmed.Contains("paceCapture") && !trimmed.Contains("sectorDiagnostic"),"diagnostiek vervalt eerst bij krap budget; JSON blijft geldig");
        var sampled=new PaceCaptureBuffer();int diagnosticFrames=0;bool sawValid=false,sawIncomplete=false;
        for(int i=0;i<=5000;i++)
        {
            double t=i*0.05;sampled.Observe("sampled",t,i,new[]{Sample(t)},Six);
            var f=sampled.NextFrame();var d=f?.OpponentMetrics.FirstOrDefault()?.SectorDiagnostic;
            if(d!=null) {diagnosticFrames++;sawValid|=d.Reason=="valid";sawIncomplete|=d.Reason=="incomplete";}
        }
        Check("sample-once",diagnosticFrames==2 && sawValid && sawIncomplete,"eerste onvolledige en eerste volledige ronde elk precies één diagnostiek, daarna 1 op 20");
        var wrongEpoch=new PaceCaptureBuffer();
        for(int i=0;i<=5000;i++) {double t=i*0.05;var o=Sample(t);o.ReportedLap=0;wrongEpoch.Observe("stale-lap",t,i,new[]{o},Six);}
        Check("reported-lap",wrongEpoch.NextFrame().OpponentMetrics[0].LastLapSectorSeconds==null && wrongEpoch.StoredLapCount==0,"stale SDK-rondenummer kan geen nieuwe sectoren of historie goedkeuren, zelfs bij identieke rondetijd");
        // Uneven speed: compare interpolation to an independently inverted distance law.
        var variable=new PaceCaptureBuffer();
        for(int i=0;i<=5000;i++)
        {
            double t=i*0.05, phase=(t+0.019)/123.05;
            double distance=phase+0.08*Math.Sin(2*Math.PI*phase)/(2*Math.PI);
            var o=Sample(t);o.Lap=1+(int)distance;o.Distance=distance-Math.Floor(distance);
            variable.Observe("variable",t,i,new[]{o},Six);
        }
        var variableMetric=variable.NextFrame().OpponentMetrics[0];
        Func<double,double> inverse=d=> {double lo=0,hi=1;for(int i=0;i<60;i++){double mid=(lo+hi)/2;if(mid+0.08*Math.Sin(2*Math.PI*mid)/(2*Math.PI)<d)lo=mid;else hi=mid;}return (lo+hi)/2*123.05;};
        var ideal=Six.Select((v,i)=>inverse(i+1<Six.Length?Six[i+1]:1)-inverse(v)).ToArray();
        double maximum=variableMetric.LastLapSectorSeconds==null ? double.PositiveInfinity : variableMetric.LastLapSectorSeconds.Select((v,i)=>Math.Abs(v.Value-ideal[i])).Max();
        Check("uneven-speed",maximum<0.001,"wisselende snelheid, 20 Hz: maximale sectorfout "+maximum.ToString("F8",System.Globalization.CultureInfo.InvariantCulture)+" s < 1 ms (synthetisch)");
        // Real byte parser, not a mocked ReadNumber: indexed float array plus bounds.
        var image=new byte[IrSdkImage.HeaderSize+IrSdkImage.VariableHeaderSize+16];
        Action<int,int> write=(at,v)=>Array.Copy(BitConverter.GetBytes(v),0,image,at,4);
        write(0,2);write(4,1);write(8,60);write(24,1);write(28,IrSdkImage.HeaderSize);write(32,1);write(36,16);write(48,123);write(52,IrSdkImage.HeaderSize+IrSdkImage.VariableHeaderSize);
        write(IrSdkImage.HeaderSize,IrSdkImage.TypeFloat);write(IrSdkImage.HeaderSize+4,0);write(IrSdkImage.HeaderSize+8,4);
        Array.Copy(Encoding.ASCII.GetBytes("CarIdxLastLapTime"),0,image,IrSdkImage.HeaderSize+16,"CarIdxLastLapTime".Length);
        for(int i=0;i<4;i++)Array.Copy(BitConverter.GetBytes(100.0f+i),0,image,IrSdkImage.HeaderSize+IrSdkImage.VariableHeaderSize+i*4,4);
        var indexed=IrSdkImage.Parse(image,image.Length);
        Check("sdk-array",indexed?.ReadNumber("CarIdxLastLapTime",3)==103 && indexed.ReadNumber("CarIdxLastLapTime",0)==100,"CarIdxLastLapTime leest de juiste auto-index");
        Check("sdk-bounds",indexed.ReadNumber("CarIdxLastLapTime",4)==null && indexed.ReadNumber("CarIdxLastLapTime",-1)==null,"array-index buiten bereik blijft null");
        var generated=Environment.GetEnvironmentVariable("PACE_SECTOR_FRAME_OUTPUT");
        if(!string.IsNullOrEmpty(generated))
        {
            frame.OpponentMetrics=new[]{Drive(Six)};
            System.IO.File.WriteAllText(generated,PaceCaptureBuffer.AppendWithinBudget("{}",frame));
        }
        return n;
    }
}
