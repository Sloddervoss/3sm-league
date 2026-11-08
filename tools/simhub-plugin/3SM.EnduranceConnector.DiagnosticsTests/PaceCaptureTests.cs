using System;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.IO;
using System.Net.Http;
using ThreeSM.EnduranceConnector;
internal static class PaceCaptureTests
{
    private static PaceObservation Car(int index,int lap,double distance,bool pit=false)
    {
        return new PaceObservation {Id="car-"+index,Lap=lap,Distance=distance,SpeedKph=180,Connected=true,IsPlayer=index==0,Position=index+1,InPit=pit,
          LastLapSeconds=100,BestLapSeconds=100,Metric=new PaceMetric {LastLapSectorSeconds=new double?[]{30,30,40},BestLapSectorSeconds=new double?[]{30,30,40},LapValid=true}};
    }
    public static int Run(Action<string,bool,string> check)
    {
        int n=0; void Check(string id,bool ok,string detail) {check("PACE-"+id,ok,detail); n++;}
        Check("01",PaceCaptureBuffer.Sectors(new double?[]{21.86,18,13.9},105.168)==null,"verkeerde som wordt null");
        Check("02",PaceCaptureBuffer.Sectors(new double?[]{30,30,40},100)!=null,"coherente seconden blijven staan");
        foreach(var bad in new double?[]{null,0,-1,double.NaN,double.PositiveInfinity})
            Check("03-"+bad,PaceCaptureBuffer.Sectors(new double?[]{bad,30,40},100)==null,"geen gedeeltelijk triplet");
        var buffer=new PaceCaptureBuffer();
        int plateau=0;
        for(int tick=0;tick<30000;tick++)
        {
            var time=tick*0.1; var lap=1+(int)(time/100); var distance=(time%100)/100;
            buffer.Observe("session",time,tick,Enumerable.Range(0,45).Select(i=>Car(i,lap,distance)));
            if(tick==9999) plateau=buffer.PointCount;
        }
        Check("04",buffer.CarCount==40,"45 aangeboden, maximaal 40 slots");
        Check("05",buffer.PointCount<=40*3*128,"drie begrensde sporen per auto: "+buffer.PointCount);
        Check("05b",buffer.PointCount==plateau && buffer.StoredLapCount==40*20,"30 ronden: punten blijven op plateau; 20 rondetijden per auto: "+buffer.StoredLapCount);
        var frame=buffer.NextFrame();
        Check("06",frame!=null && frame.TraceChunks.Length>0,"echt tijd-afstandspoor");
        Check("07",frame.OpponentLaps.Length<=4,"wire-rondetijden hebben eigen cap");
        Check("08",frame.TraceChunks.All(c=>c.Points.Length<=32),"wire-chunks maximaal 32 punten");
        var dto=V3PayloadFixtureTests.BuildRepresentativeFrame();
        dto.Opponents=Enumerable.Range(0,40).Select(i=>new V3Opponent {Id="car-"+i,CarNumber=(i+1).ToString(),DriverName="Test Driver "+i,TeamName="Test Team "+i,CarClass="GT3",CarClassId="0",Position=i+1,ClassPosition=i+1,Lap=10,LapDistancePct=0.123456789,LastLapSeconds=100.123,BestLapSeconds=99.456,GapToPlayerSeconds=i==0?(double?)null:i*1.234,GapToLeaderSeconds=i*1.234,SpeedKph=199.123456,Connected=true,IsPlayer=i==0,InPit=false}).ToArray();
        dto.SchemaRevision=1; dto.Capabilities=V3Capabilities.From(ConnectorCapabilities.Implemented());
        var core=V3PayloadFixtureTests.Serialize(dto);
        var packed=PaceCaptureBuffer.AppendWithinBudget(core,frame);
        Check("09",Encoding.UTF8.GetByteCount(packed)<=24000,"40-auto werkelijk geserialiseerd frame: core="+Encoding.UTF8.GetByteCount(core)+" eind="+Encoding.UTF8.GetByteCount(packed));
        using(var doc=JsonDocument.Parse(packed)) Check("10",doc.RootElement.GetProperty("opponents").GetArrayLength()==40,"core behoudt alle 40 rijen");
        var full="{\"padding\":\""+new string('x',23900)+"\"}";
        Check("11",PaceCaptureBuffer.AppendWithinBudget(full,frame)==full,"pace verdringt nooit kern/meetbatch");
        var unicode=new string('漢',7900); var unicodeBody="{\"padding\":\""+unicode+"\"}";
        Check("12",Encoding.UTF8.GetByteCount(PaceCaptureBuffer.AppendWithinBudget(unicodeBody,frame))<=24000,"UTF-8, niet aantal tekens");
        var before=buffer.PointCount;
        buffer.Observe("session",2999.9,29999,Enumerable.Range(0,40).Select(i=>Car(i,30,0.999)));
        Check("13",buffer.PointCount==before,"dubbele tick doet niets");
        buffer.Observe("other-session",1000.1,10001,new[]{Car(0,1,0.5)});
        Check("14",buffer.CarCount==1 && buffer.PointCount==0,"sessiewissel wist oude sporen");
        buffer.Observe("other-session",1000.3,10003,new[]{Car(0,1,0.6,true)});
        Check("15",buffer.PointCount==0,"pit is geen doorgaand spoor");
        buffer.Observe("other-session",1000.5,10005,new[]{Car(0,1,0.9)});
        buffer.Observe("other-session",1000.7,10007,new[]{Car(0,1,0.1)});
        Check("16",buffer.PointCount==0,"teleport geen verbindingslijn");
        buffer.Observe("other-session",null,null,new[]{Car(0,1,0.2)});
        Check("17",buffer.CarCount==0,"geen klok, geen capture");
        var broken=Car(0,1,0.1); broken.Metric.LastLapSectorSeconds=new double?[]{1,2,3};
        buffer.Observe("diagnostic",1,1,new[]{broken});
        var diagnostic=buffer.NextFrame().OpponentMetrics[0];
        Check("18",diagnostic.LastLapSectorSeconds==null && diagnostic.SectorMismatchCount==1,"zelfcontrole en zichtbare teller");
        var temp=Path.Combine(Path.GetTempPath(),"pace-budget-"+Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(temp);
        try
        {
            var outbox=new MeasurementOutbox(Path.Combine(temp,"outbox.json")); var ids=new MeasurementIdFactory();
            for(int i=0;i<30;i++) outbox.Enqueue(MeasurementTransportTests.Event(ids,"wear_value_changed",90),out string _);
            for(int i=0;i<6;i++) outbox.EnqueueLap(MeasurementTransportTests.Lap(ids,i+1),out string _);
            var sender=new MeasurementSender(outbox,new HttpClient(),()=>ConnectorCapabilities.Implemented().ToJson(),new MeasurementLimits { MaxFrameBodyBytes=24000 });
            MeasurementBatchPlan plan;
            var measured=sender.BuildBody(core,Encoding.UTF8.GetByteCount(core),new DateTime(2026,10,31,14,0,0,DateTimeKind.Utc),out plan) ?? core;
            var end=PaceCaptureBuffer.AppendWithinBudget(measured,frame);
            Check("19",Encoding.UTF8.GetByteCount(end)<=24000,"40 autos + echte meetplanner: metingen="+Encoding.UTF8.GetByteCount(measured)+" eind="+Encoding.UTF8.GetByteCount(end)+" events="+plan.Batch.Events.Count+" laps="+plan.Batch.Laps.Count);
            using(var beforeDoc=JsonDocument.Parse(measured)) using(var afterDoc=JsonDocument.Parse(end))
                Check("20",beforeDoc.RootElement.GetProperty("measurementEvents").GetRawText()==afterDoc.RootElement.GetProperty("measurementEvents").GetRawText(),"pace verandert geen geplande meetbatch");
        }
        finally {Directory.Delete(temp,true);}
        // Artifact is synthetic and explicitly not a 40-car live capture.
        var output=Environment.GetEnvironmentVariable("PACE_FRAME_OUTPUT");
        if(!string.IsNullOrEmpty(output)) File.WriteAllText(output,packed);
        n+=SectorMeasurementTests.Run(check);
        n+=SectorStartParsingTests.Run(check);
        return n;
    }
}
