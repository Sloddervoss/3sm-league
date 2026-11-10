using System;
using System.Collections.Generic;
using System.Text;

namespace ThreeSM.EnduranceConnector
{
    /// <summary>Uitkomst van één budgetbeslissing; de plugin logt alleen de stages.</summary>
    public sealed class V3PayloadBudgetResult
    {
        public string Body { get; set; }
        public List<string> Stages { get; set; }
        public int OriginalBytes { get; set; }
        public int FinalBytes { get; set; }
    }

    /// <summary>
    /// Pure snoeiregel voor het V3-frame. Geen SimHub-referentie, zodat de net8-tests
    /// precies dezelfde volgorde bewijzen als de net48-plugin gebruikt.
    ///
    /// Volgorde is bewust: eerst de optionele automodellen (additief, cosmetisch),
    /// daarna pas karkastemperaturen en het pitEntry-anker. De opponentstabel, de
    /// player-rij, de core/telemeterie en de meet-/ACK-batch worden nooit verwijderd of
    /// ingekort. Het budget zelf wordt niet verhoogd; de aanroeper levert de grens.
    /// </summary>
    public static class V3PayloadBudget
    {
        /// <summary>
        /// Vaste ruimte die voor de pace-root gereserveerd blijft. De pace-capture
        /// wordt na de envelope toegevoegd en heeft een eigen wire-limiet van 4096 B;
        /// optionele automodellen mogen die ruimte niet opeten.
        /// </summary>
        public const int PaceReserveBytes = 4096;

        public static V3PayloadBudgetResult Trim(
            TelemetryEnvelopeV3 envelope,
            Func<TelemetryEnvelopeV3, string> serialize,
            int maxBytes)
        {
            if (envelope == null) throw new ArgumentNullException("envelope");
            if (serialize == null) throw new ArgumentNullException("serialize");
            if (maxBytes <= 0) throw new ArgumentOutOfRangeException("maxBytes");

            var body = serialize(envelope);
            var original = Encoding.UTF8.GetByteCount(body);
            var result = new V3PayloadBudgetResult
            {
                Body = body,
                Stages = new List<string>(),
                OriginalBytes = original,
                FinalBytes = original,
            };

            // 1. Optionele modelstrings. Eén begrensde string per rij (max 120 in de
            // producent); nullen kost geen rij, geen player en geen meting. Ook als
            // het frame nog net onder maxBytes past, mogen de namen de vaste
            // pace-reserve niet verkleinen.
            var hasCarNames = false;
            if (envelope.Opponents != null)
            {
                for (var i = 0; i < envelope.Opponents.Length; i++)
                {
                    var opponent = envelope.Opponents[i];
                    if (opponent != null && opponent.CarName != null) { hasCarNames = true; break; }
                }
            }
            var carNameLimit = maxBytes > PaceReserveBytes ? maxBytes - PaceReserveBytes : 0;
            if (original <= maxBytes && (!hasCarNames || original <= carNameLimit)) return result;

            if (hasCarNames)
            {
                for (var i = 0; i < envelope.Opponents.Length; i++)
                {
                    if (envelope.Opponents[i] != null) envelope.Opponents[i].CarName = null;
                }
                body = serialize(envelope);
                result.Stages.Add("carName");
                if (Encoding.UTF8.GetByteCount(body) <= maxBytes)
                    return Finish(result, body);
            }

            // 2. Karkastemperaturen (ook in het pitEntry-anker).
            if (envelope.Tyres != null && (envelope.Tyres.CarcassTempC != null
                || (envelope.Tyres.PitEntry != null && envelope.Tyres.PitEntry.CarcassTempC != null)))
            {
                envelope.Tyres.CarcassTempC = null;
                if (envelope.Tyres.PitEntry != null) envelope.Tyres.PitEntry.CarcassTempC = null;
                body = serialize(envelope);
                result.Stages.Add("karkas");
                if (Encoding.UTF8.GetByteCount(body) <= maxBytes)
                    return Finish(result, body);
            }

            // 3. Het pitEntry-anker als laatste redmiddel.
            if (envelope.Tyres != null && envelope.Tyres.PitEntry != null)
            {
                envelope.Tyres.PitEntry = null;
                body = serialize(envelope);
                result.Stages.Add("pitEntry");
            }
            return Finish(result, body);
        }

        private static V3PayloadBudgetResult Finish(V3PayloadBudgetResult result, string body)
        {
            result.Body = body;
            result.FinalBytes = Encoding.UTF8.GetByteCount(body);
            return result;
        }
    }
}
