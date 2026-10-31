using System;

// TEST-ONLY stub van het SimHub-type dat FlagService.cs nodig heeft.
//
// FlagService.cs (0.7.1.2) gebruikt uit GameReaderCommon alleen StatusDataBase en
// daarvan uitsluitend de Flag_*-leden. Door die leden hier te definieren kan de
// bestaande vlagcode in deze harness compileren, zodat de baseline de ECHTE oude
// implementatie vergelijkt en niet een handmatige kopie daarvan.
//
// Dit bestand hoort bij de baseline (fase 1). Zodra FlagService.cs vervangen is door
// SessionFlagReader.cs verdwijnt deze stub.
namespace GameReaderCommon
{
    public class StatusDataBase
    {
        public string Flag_Name { get; set; }
        public int Flag_Checkered { get; set; }
        public int Flag_Yellow { get; set; }
        public int Flag_White { get; set; }
        public int Flag_Green { get; set; }
    }
}
