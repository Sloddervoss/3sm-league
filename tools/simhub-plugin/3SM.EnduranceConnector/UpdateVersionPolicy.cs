using System;

namespace ThreeSM.EnduranceConnector
{
    /// <summary>
    /// De enige plek waar "is er een nieuwere versie?" wordt beslist. Puur en zonder
    /// SimHub, zodat de regel te testen is zonder plugin, updater of SimHub.
    ///
    /// De regel is bewust exact dezelfde als die vóór 0.8 in de plugin stond:
    /// <c>Version.TryParse</c> en daarna <b>strikt groter</b> dan de geladen assemblyversie.
    /// Niet groter of gelijk, niet "anders": een gelijke versie levert nooit een update op,
    /// en een onleesbare versie is geen update.
    ///
    /// Versies worden als vier delen verwacht (0.8.0.0). Dat is geen eis van deze klasse
    /// maar van het updatepad zelf: de externe updater vergelijkt de bestands- en
    /// assemblyversie van de gedownloade DLL met het aangekondigde versienummer, en
    /// <c>0.8</c> is niet gelijk aan <c>0.8.0.0</c>. release.sh leest de versie uit
    /// AssemblyVersion("x.y.z.w"), dus de aangekondigde versie heeft altijd vier delen.
    /// </summary>
    public static class UpdateVersionPolicy
    {
        /// <summary>Leest een versienummer zoals de plugin dat uit het manifest krijgt.</summary>
        public static bool TryParse(string text, out Version version)
        {
            return Version.TryParse(text, out version);
        }

        /// <summary>Strikt nieuwer dan de geïnstalleerde versie. Null telt nooit als nieuwer.</summary>
        public static bool IsNewer(Version remote, Version installed)
        {
            return remote != null && remote > installed;
        }

        /// <summary>
        /// Leest en toetst in één stap: true alleen als <paramref name="text"/> leesbaar is
        /// én nieuwer is. Dit is de regel die de plugin gebruikte op de plekken waar een
        /// onleesbare of gelijke versie een gewone "geen update"-situatie is.
        /// </summary>
        public static bool TryParseNewer(string text, Version installed, out Version version)
        {
            version = null;
            Version parsed;
            if (!Version.TryParse(text, out parsed)) return false;
            if (!IsNewer(parsed, installed)) return false;
            version = parsed;
            return true;
        }

        /// <summary>
        /// De tekst die naar de updater gaat (<c>--version</c>) en die de staging-map naam
        /// geeft. Bewust <see cref="Version.ToString()"/>: de updater vergelijkt die tekst
        /// met de bestandsversie van de DLL.
        /// </summary>
        public static string Format(Version version)
        {
            return version == null ? null : version.ToString();
        }
    }
}
