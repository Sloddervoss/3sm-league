namespace ThreeSM.EnduranceConnector
{
    using System;

    /// <summary>
    /// De iRacing-kanalen die SimHub's <c>GameRawData</c> níet doorgeeft, maar die de
    /// gedeelde iRacing-SDK-memory wél live bevat. Eén plek voor de naadstringen: een typefout
    /// hier is een stille <c>null</c>, dus de namen staan bewust bij elkaar en niet verspreid
    /// over de plugin en de researchlaag.
    ///
    /// Volgorde per array is [frontLeft, frontRight, rearLeft, rearRight] — dezelfde
    /// hoekvolgorde als het bandenblok.
    /// </summary>
    public static class IrSdkChannels
    {
        // LET OP: LFspeed/RFspeed/LRspeed/RRspeed staan NIET in de live-telemetrie van
        // iRacing (gecontroleerd tegen alle 334 variabelen). Ze zijn hier alleen nog
        // gedocumenteerd omdat de researchsampler ze leest; het vehicle-blok in de
        // plugin stuurt geen wielsnelheid meer mee.
        public const string LfSpeed = "LFspeed";
        public const string RfSpeed = "RFspeed";
        public const string LrSpeed = "LRspeed";
        public const string RrSpeed = "RRspeed";

        public const string LfBrakeLinePress = "LFbrakeLinePress";
        public const string RfBrakeLinePress = "RFbrakeLinePress";
        public const string LrBrakeLinePress = "LRbrakeLinePress";
        public const string RrBrakeLinePress = "RRbrakeLinePress";

        /// <summary>Stuurwielhoek in radialen (iRacing-eenheid "rad").</summary>
        public const string SteeringWheelAngle = "SteeringWheelAngle";

        /// <summary>Laterale versnelling in m/s² (iRacing-eenheid "m/s^2").</summary>
        public const string LatAccel = "LatAccel";

        /// <summary>Longitudinale versnelling in m/s² (iRacing-eenheid "m/s^2").</summary>
        public const string LongAccel = "LongAccel";

        /// <summary>Wielsnelheid per hoek, m/s. Bestaat niet in de iRacing-live-telemetrie;
        /// alleen de researchsampler leest deze namen nog.</summary>
        public static readonly string[] WheelSpeed = { LfSpeed, RfSpeed, LrSpeed, RrSpeed };

        /// <summary>Remleidingdruk per hoek, bar.</summary>
        public static readonly string[] BrakeLinePressure = { LfBrakeLinePress, RfBrakeLinePress, LrBrakeLinePress, RrBrakeLinePress };
    }

    /// <summary>
    /// Omrekening van de SDK-eenheden naar de wire-eenheden van het vehicle-blok:
    /// m/s -> km/h, rad -> graden, m/s² -> g. Eén definitie, zodat de plugin en de tests
    /// niet elk hun eigen afrondings- of factorfout kunnen hebben.
    /// </summary>
    public static class IrSdkUnits
    {
        public const double MetersPerSecondToKph = 3.6;
        public const double RadiansToDegrees = 180.0 / Math.PI;
        public const double StandardGravity = 9.80665;

        public static double MpsToKph(double metersPerSecond)
        {
            return metersPerSecond * MetersPerSecondToKph;
        }

        public static double RadToDeg(double radians)
        {
            return radians * RadiansToDegrees;
        }

        public static double Mps2ToG(double metersPerSecondSquared)
        {
            return metersPerSecondSquared / StandardGravity;
        }
    }
}
