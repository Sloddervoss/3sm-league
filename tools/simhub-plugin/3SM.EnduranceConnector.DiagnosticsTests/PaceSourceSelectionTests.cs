using System;
using ThreeSM.EnduranceConnector;
internal static class PaceSourceSelectionTests
{
    public static int Run(Action<string,bool,string> check)
    {
        int n=0; void Check(string id,bool ok,string detail) {check("PACESRC-"+id,ok,detail); n++;}

        // 01: een geldige rechtstreekse tijd wint altijd, ook als SimHub iets anders zegt.
        var selector=new PaceSourceSelector();
        var choice=selector.Choose("car-1",122.684,121.9,1,2,999,999,2);
        Check("01",choice.LastLapSeconds==122.684 && choice.LastLapSource==PaceSourceSelector.SourceDirect && choice.ReportedLap==1,
            "directe tijd wint: "+choice.LastLapSeconds+" / "+choice.LastLapSource+" / ronde "+choice.ReportedLap);

        // 02: de fout van 0.7.3.0 - index gevonden, directe tijd ontbreekt, SimHub heeft hem wel.
        //     Na een aangetoonde ronde-overgang (1 -> 2) wordt de SimHub-tijd overgenomen.
        selector=new PaceSourceSelector();
        selector.Choose("car-1",null,null,null,1,0,null,1);              // eerste waarneming: nog geen bewijs
        choice=selector.Choose("car-1",null,null,null,2,122.684,null,2); // teller schuift op, tijd is nieuw
        Check("02",choice.LastLapSeconds==122.684 && choice.LastLapSource==PaceSourceSelector.SourceSimHub && choice.ReportedLap==1,
            "terugval met rondebewijs: "+choice.LastLapSeconds+" / "+choice.LastLapSource+" / ronde "+choice.ReportedLap);

        // 03: eerste waarneming zonder geschiedenis geeft geen waarde - nooit gokken.
        selector=new PaceSourceSelector();
        choice=selector.Choose("car-1",null,null,null,2,122.684,null,2);
        Check("03",choice.LastLapSeconds==null && choice.LastLapSource==null,"eerste waarneming blijft leeg");

        // 04: dezelfde teller en dezelfde tijd mag niet nog eens aan een ronde worden geplakt.
        selector=new PaceSourceSelector();
        selector.Choose("car-1",null,null,null,1,0,null,1);
        choice=selector.Choose("car-1",null,null,null,2,122.684,null,2);
        var again=selector.Choose("car-1",null,null,null,2,122.684,null,2);
        Check("04",again.LastLapSeconds==null,"onveranderde tijd wordt niet hergebruikt");

        // 05: een sprong van meer dan een ronde (reset, pit, herstart) is geen bewijs.
        selector=new PaceSourceSelector();
        selector.Choose("car-1",null,null,null,1,0,null,1);
        choice=selector.Choose("car-1",null,null,null,5,122.684,null,5);
        Check("05",choice.LastLapSeconds==null,"ronde-sprong geeft geen tijd");

        // 06: een andere auto erft het bewijs van een andere niet.
        selector=new PaceSourceSelector();
        selector.Choose("car-1",null,null,null,1,0,null,1);
        choice=selector.Choose("car-2",null,null,null,2,122.684,null,2);
        Check("06",choice.LastLapSeconds==null,"geschiedenis is per auto");

        // 07: nul, -1 en NaN zijn geen rondetijd - ook niet via de terugval.
        foreach(var bad in new double?[]{0,-1,double.NaN,double.PositiveInfinity})
        {
            selector=new PaceSourceSelector();
            selector.Choose("car-1",null,null,null,1,bad,null,1);
            choice=selector.Choose("car-1",null,null,null,2,bad,null,2);
            Check("07-"+bad,choice.LastLapSeconds==null && choice.BestLapSeconds==null,"ongeldige SimHub-waarde blijft leeg: "+bad);
        }

        // 08: de beste ronde mag uit de andere bron komen, mits de auto bekend is.
        selector=new PaceSourceSelector();
        choice=selector.Choose("car-1",null,0,1,2,130.0,120.9,2);
        Check("08",choice.BestLapSeconds==120.9 && choice.BestLapSource==PaceSourceSelector.SourceSimHub,
            "beste ronde valt terug op SimHub: "+choice.BestLapSeconds+" / "+choice.BestLapSource);

        // 09: zonder ronde teller is er geen auto-identiteit en dus geen terugval.
        selector=new PaceSourceSelector();
        selector.Choose("car-1",null,null,null,null,0,null,null);
        choice=selector.Choose("car-1",null,null,null,null,122.684,null,null);
        Check("09",choice.LastLapSeconds==null,"geen teller, geen terugval");

        // 10: directe ongeldige waarde met geldige SimHub-waarde en rondebewijs werkt ook.
        selector=new PaceSourceSelector();
        selector.Choose("car-1",0,-1,0,1,0,null,1);
        choice=selector.Choose("car-1",-1,0,0,2,122.684,121.0,2);
        Check("10",choice.LastLapSeconds==122.684 && choice.ReportedLap==1,"directe sentinel valt terug op SimHub");

        // 11: Reset() gooit de geschiedenis weg; daarna is er weer geen bewijs.
        selector=new PaceSourceSelector();
        selector.Choose("car-1",null,null,null,1,0,null,1);
        selector.Reset();
        choice=selector.Choose("car-1",null,null,null,2,122.684,null,2);
        Check("11",choice.LastLapSeconds==null && selector.CarCount==1,"reset wist het bewijs");

        // 12: tegenproef - de oude regel (index gevonden => alleen direct) geeft op
        //     precies dit frame null, terwijl de nieuwe regel 122,684 teruggeeft.
        //     Zo is vastgelegd dat de reparatie het gemeten geval verandert.
        selector=new PaceSourceSelector();
        selector.Choose("car-1",null,null,null,1,0,null,1);
        choice=selector.Choose("car-1",null,null,null,2,122.684,null,2);
        var oldRule = (bool hasIndex, double? directLast) => hasIndex ? directLast : (double?)122.684;
        Check("12",oldRule(true,null)==null && choice.LastLapSeconds==122.684,
            "oude regel gaf null, nieuwe regel geeft "+choice.LastLapSeconds);

        return n;
    }
}
