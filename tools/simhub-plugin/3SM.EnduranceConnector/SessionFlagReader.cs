using System;
using System.Collections.Generic;

namespace ThreeSM.EnduranceConnector
{
    /// <summary>
    /// Ruwe iRacing-vlaggen voor één tick. Geen instellingen, geen kleuren, geen
    /// presentatiekeuze: alleen wat de sim (of SimHub's doorgeefluik daarvan) zegt.
    /// Null betekent "deze bron ontbreekt", niet "de vlag staat uit".
    /// </summary>
    public sealed class SessionFlagInput
    {
        /// <summary>DataCorePlugin.GameRawData.Telemetry.SessionFlags. Null = kanaal ontbreekt.</summary>
        public uint? SessionFlags;

        // Losse SimHub-properties; alleen fallback als het bitmasker ontbreekt.
        public bool? WhiteFlag;
        public bool? CheckeredFlag;
        public bool? GreenFlag;

        // SessionFlagsDetails.*; ook alleen fallback zonder bitmasker.
        public bool? DetailRed;
        public bool? DetailYellow;
        public bool? DetailService;

        // IRacingExtraProperties.iRacing_SlowCarAhead + SessionTypeName (Lone Qualify).
        public bool? SlowCarAhead;
        public string SessionTypeName;
    }

    /// <summary>
    /// Leest de iRacing-vlaggen en vertaalt ze naar de wire-vocabulaire van
    /// <c>session.flags</c>. Bewust dom en toestandloos:
    ///
    ///  - geen kleuren, thema's, presets, LED-layouts of animaties;
    ///  - geen presentatieprioriteit en geen "primaire vlag";
    ///  - geen latch- of anti-flikker-vensters: die maakten van een displayvoorkeur
    ///    racetelemetrie. Eén aanroep = de stand van deze tick;
    ///  - geen masker op gebruikersinstellingen. Een uitgezette vlag in een dashboard
    ///    mag niet betekenen dat de server hem nooit ziet.
    ///
    /// De uitvoer is exact dezelfde lijst namen als 0.7.1.2 voor dezelfde SDK-toestand
    /// opleverde (zie FlagMappingTests, dat de oude en nieuwe mapping op alle
    /// combinaties vergelijkt), inclusief de volgorde: checkered, red, yellow, white,
    /// green, meatball.
    /// </summary>
    public static class SessionFlagReader
    {
        // iRacing SessionFlags-bits (irsdk_flags). Alleen deze bits bepalen een wire-naam.
        public const uint BitCheckered = 0x1u;
        public const uint BitGreen = 0x4u;
        public const uint BitYellowWaving = 0x8u;
        public const uint BitRed = 0x10u;
        public const uint BitYellow = 0x100u;
        public const uint BitServicible = 0x40000u;

        public const string Checkered = "checkered";
        public const string Red = "red";
        public const string Yellow = "yellow";
        public const string White = "white";
        public const string Green = "green";
        public const string Meatball = "meatball";

        /// <summary>De namen die de server in session.flags accepteert (en die wij produceren).</summary>
        public static readonly string[] WireVocabulary = { Checkered, Red, Yellow, White, Green, Meatball };

        /// <summary>
        /// De vlaggen van deze tick, of null als er geen vlag is. Null (en geen lege
        /// array) houdt het bestaande contract: session.flags blijft null zonder vlag.
        /// </summary>
        public static string[] Read(SessionFlagInput input)
        {
            if (input == null) return null;
            var bitmask = input.SessionFlags;
            var checkered = bitmask.HasValue ? (bitmask.Value & BitCheckered) != 0u : IsTrue(input.CheckeredFlag);
            var red = bitmask.HasValue ? (bitmask.Value & BitRed) != 0u : IsTrue(input.DetailRed);
            var yellow = bitmask.HasValue
                ? (bitmask.Value & (BitYellow | BitYellowWaving)) != 0u
                : IsTrue(input.DetailYellow);
            var green = bitmask.HasValue ? (bitmask.Value & BitGreen) != 0u : IsTrue(input.GreenFlag);
            var meatball = bitmask.HasValue ? (bitmask.Value & BitServicible) != 0u : IsTrue(input.DetailService);
            // Wit komt niet uit het bitmasker: iRacing meldt het als losse Flag_White,
            // en "slow car ahead" telt alleen buiten een Lone Qualify-sessie.
            var white = IsTrue(input.WhiteFlag)
                || (IsTrue(input.SlowCarAhead) && !string.Equals(input.SessionTypeName, "Lone Qualify", StringComparison.Ordinal));

            var names = new List<string>(6);
            if (checkered) names.Add(Checkered);
            if (red) names.Add(Red);
            if (yellow) names.Add(Yellow);
            if (white) names.Add(White);
            if (green) names.Add(Green);
            if (meatball) names.Add(Meatball);
            return names.Count == 0 ? null : names.ToArray();
        }

        /// <summary>De eerste naam volgens de vaste volgorde; null als er geen vlag is.</summary>
        public static string Primary(string[] names)
        {
            return names == null || names.Length == 0 ? null : names[0];
        }

        /// <summary>Alleen voor diagnose/logging: "yellow,white" of "geen".</summary>
        public static string Describe(string[] names)
        {
            return names == null || names.Length == 0 ? "geen" : string.Join(",", names);
        }

        private static bool IsTrue(bool? value) { return value.HasValue && value.Value; }
    }
}
