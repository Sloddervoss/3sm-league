using System;
using System.Collections.Generic;

namespace ThreeSM.EnduranceConnector
{
    /// <summary>
    /// Toegang tot de paar kanalen die de bestaande capture níet al heeft (stuur, versnellingen,
    /// en als noodval gas/rem/snelheid). De plugin implementeert dit op de bestaande
    /// <see cref="RawChannelReader"/> plus de bestaande property-lezer; tests vullen een
    /// tellende fake.
    /// </summary>
    public interface IResearchChannelReader
    {
        /// <summary>Ruw iRacing-kanaal (DataCorePlugin.GameRawData.Telemetry.&lt;naam&gt;).</summary>
        double? ReadNumber(string channel, double minimum, double maximum);

        /// <summary>
        /// SimHub-property (geen ruw kanaal). Alleen gebruikt voor velden die de capture niet
        /// levert, zoals snelheid in km/u wanneer het vehicle-blok uit staat.
        /// </summary>
        double? ReadProperty(string property, double minimum, double maximum);
    }

    /// <summary>Vaste sleutels van de researchvelden (staan ook in de documentatie).</summary>
    public static class ResearchFieldKeys
    {
        public const string SteeringRad = "steeringWheelRad";
        public const string ThrottlePct = "throttlePct";
        public const string BrakePct = "brakePct";
        public const string LatAccelMps2 = "latAccelMps2";
        public const string LongAccelMps2 = "longAccelMps2";
        public const string SpeedKph = "speedKph";
        public const string Gear = "gear";
        public const string Rpm = "rpm";
        public const string FuelLitres = "fuelLitres";
        public const string FuelPerLapLitres = "fuelPerLapLitres";
        public const string LapsRemaining = "lapsRemaining";
        public const string Position = "position";
        public const string ClassPosition = "classPosition";
        public const string CompletedLaps = "completedLaps";
        public const string LastLapSeconds = "lastLapSeconds";
        public const string BestLapSeconds = "bestLapSeconds";
        public const string CurrentLapElapsedSeconds = "currentLapElapsedSeconds";
        public const string LapDistancePct = "lapDistancePct";
        public const string OnPitRoad = "onPitRoad";
        public const string Incidents = "incidents";
        public const string SessionTimeSeconds = "sessionTimeSeconds";
        public const string TyreSetsUsed = "tyre.setsUsed";
        public const string TyreCompoundId = "tyre.compoundId";
        public const string TrackTempC = "trackTempC";
        public const string AirTempC = "airTempC";
        public const string TrackRubberState = "trackRubberState";
        public const string TyreSnapshotFrozenAt = "tyreSnapshotFrozenAt";

        /// <summary>Het bevroren pit-entry-anker: eigen sleutels, altijd last_known.</summary>
        public const string PitEntrySetsUsed = "pitEntry.setsUsed";
        public const string PitEntryFrozenAt = "pitEntry.frozenAt";

        public static string Wear(int corner, int zone)
        {
            return "wearPercent." + Corner(corner) + "." + zone;
        }

        public static string Carcass(int corner, int zone)
        {
            return "carcassTempC." + Corner(corner) + "." + zone;
        }

        public static string PitEntryWear(int corner, int zone)
        {
            return "pitEntry.wearPercent." + Corner(corner) + "." + zone;
        }

        public static string PitEntryCarcass(int corner, int zone)
        {
            return "pitEntry.carcassTempC." + Corner(corner) + "." + zone;
        }

        /// <summary>Wielsnelheid per hoek (m/s), uit de directe iRacing-SDK-lezer.</summary>
        public static string WheelSpeedMps(int corner)
        {
            return "wheelSpeedMps." + Corner(corner);
        }

        /// <summary>Remleidingdruk per hoek (bar), uit de directe iRacing-SDK-lezer.</summary>
        public static string BrakeLinePressureBar(int corner)
        {
            return "brakeLinePressureBar." + Corner(corner);
        }

        public static string Corner(int corner)
        {
            switch (corner)
            {
                case 0: return "frontLeft";
                case 1: return "frontRight";
                case 2: return "rearLeft";
                case 3: return "rearRight";
                default: return "unknown";
            }
        }
    }

    /// <summary>SimHub-propertypaden die de researchlaag zelf leest (alleen als de capture ze niet heeft).</summary>
    public static class ResearchPropertyPaths
    {
        public const string SpeedProperty = "DataCorePlugin.GameData.NewData.SpeedKmh";
    }

    /// <summary>
    /// Bouwt de 1 Hz-contextsample. Twee bronnen, strikt gescheiden:
    ///
    ///   1. de bestaande capture (wat er al is): nooit opnieuw uit de SDK gelezen;
    ///   2. lokale kanalen die de capture niet levert: stuur, laterale en longitudinale
    ///      versnelling — en gas/rem alleen als het vehicle-blok niet meegaat.
    ///
    /// Elk veld houdt zijn eigen samplingtijdstip en sampleperiode, zodat een 1 Hz-sample
    /// niet suggereert dat een 0,2 Hz-bron elke seconde is gemeten.
    /// </summary>
    public sealed class ResearchContextSampler
    {
        public const int DefaultIntervalMs = 1000;
        public const double DefaultCaptureStaleAfterSeconds = 3.0;

        private readonly int _intervalMs;
        private readonly string _speedPropertyPath;
        private DateTime _lastSampleUtc = DateTime.MinValue;

        public ResearchContextSampler(int intervalMs, string speedPropertyPath)
        {
            _intervalMs = intervalMs > 0 ? intervalMs : DefaultIntervalMs;
            _speedPropertyPath = string.IsNullOrWhiteSpace(speedPropertyPath)
                ? ResearchPropertyPaths.SpeedProperty
                : speedPropertyPath.Trim();
        }

        public int IntervalMs { get { return _intervalMs; } }

        public void Reset()
        {
            _lastSampleUtc = DateTime.MinValue;
        }

        /// <summary>
        /// True als dit tick een sample mag opleveren; markeert het samplemoment. Bij een
        /// klok die terugspringt (systeemtijd aangepast) laten we bewust één sample toe.
        /// </summary>
        public bool ShouldSample(DateTime utcNow)
        {
            if (_lastSampleUtc == DateTime.MinValue)
            {
                _lastSampleUtc = utcNow;
                return true;
            }
            var elapsedMs = (utcNow.ToUniversalTime() - _lastSampleUtc.ToUniversalTime()).TotalMilliseconds;
            if (elapsedMs < 0)
            {
                _lastSampleUtc = utcNow;
                return true;
            }
            if (elapsedMs < _intervalMs) return false;
            _lastSampleUtc = utcNow;
            return true;
        }

        /// <summary>
        /// Bouwt de veldenlijst in vaste volgorde (stabiele JSONL, diffbaar tussen samples).
        /// </summary>
        public IList<KeyValuePair<string, ResearchField>> BuildFields(
            DateTime sampleAtUtc,
            ResearchCaptureView capture,
            int captureIntervalMs,
            IResearchChannelReader channels,
            double captureStaleAfterSeconds,
            double tyreFreshToleranceSeconds,
            out ResearchTyreClassifier tyreClassifier)
        {
            var view = capture ?? ResearchCaptureView.None();
            var captureFields = new ResearchCaptureClassifier(view, sampleAtUtc, captureIntervalMs, captureStaleAfterSeconds);
            var tyres = new ResearchTyreClassifier(view.Tyres, sampleAtUtc, tyreFreshToleranceSeconds);
            tyreClassifier = tyres;

            var fields = new List<KeyValuePair<string, ResearchField>>(64);

            // --- 1 Hz lokale context (bestaat niet in de capture) ---
            Add(fields, ResearchFieldKeys.SteeringRad,
                Channel(channels, "SteeringWheelAngle", ResearchLimits.SteeringRadMin, ResearchLimits.SteeringRadMax, sampleAtUtc));
            Add(fields, ResearchFieldKeys.ThrottlePct,
                Pedal(view, captureFields, channels, view.ThrottlePct, "Throttle", sampleAtUtc));
            Add(fields, ResearchFieldKeys.BrakePct,
                Pedal(view, captureFields, channels, view.BrakePct, "Brake", sampleAtUtc));
            Add(fields, ResearchFieldKeys.LatAccelMps2,
                Channel(channels, "LatAccel", ResearchLimits.AccelMps2Min, ResearchLimits.AccelMps2Max, sampleAtUtc));
            Add(fields, ResearchFieldKeys.LongAccelMps2,
                Channel(channels, "LongAccel", ResearchLimits.AccelMps2Min, ResearchLimits.AccelMps2Max, sampleAtUtc));
            // 0.8.0: wielsnelheid en remdruk per hoek. SimHub geeft deze kanalen niet door;
            // de plugin-adapter valt voor deze namen terug op de directe iRacing-SDK-lezer.
            for (var corner = 0; corner < 4; corner++)
            {
                Add(fields, ResearchFieldKeys.WheelSpeedMps(corner),
                    Channel(channels, IrSdkChannels.WheelSpeed[corner],
                        ResearchLimits.WheelSpeedMpsMin, ResearchLimits.WheelSpeedMpsMax, sampleAtUtc));
                Add(fields, ResearchFieldKeys.BrakeLinePressureBar(corner),
                    Channel(channels, IrSdkChannels.BrakeLinePressure[corner],
                        ResearchLimits.BrakePressureBarMin, ResearchLimits.BrakePressureBarMax, sampleAtUtc));
            }

            // --- uit de bestaande capture (nooit opnieuw uit de SDK) ---
            // Snelheid zit alleen in het optionele vehicle-blok; staat dat uit, dan lezen we
            // de bestaande SimHub-property één keer per seconde (zelfde regel als gas/rem).
            Add(fields, ResearchFieldKeys.SpeedKph, view.HasVehicle
                ? captureFields.Number(view.SpeedKph, ResearchLimits.SpeedKphMin, ResearchLimits.SpeedKphMax, "no_vehicle_block")
                : Property(channels, _speedPropertyPath, ResearchLimits.SpeedKphMin, ResearchLimits.SpeedKphMax, sampleAtUtc));
            Add(fields, ResearchFieldKeys.Gear, captureFields.TextValue(view.Gear, "no_vehicle_block"));
            Add(fields, ResearchFieldKeys.Rpm, captureFields.Number(view.Rpm, 0, 30000, "no_vehicle_block"));
            Add(fields, ResearchFieldKeys.FuelLitres, captureFields.Number(view.FuelLitres,
                ResearchLimits.FuelLitresMin, ResearchLimits.FuelLitresMax, "no_fuel"));
            Add(fields, ResearchFieldKeys.FuelPerLapLitres, captureFields.Number(view.FuelPerLapLitres, 0, 250, "no_fuel"));
            Add(fields, ResearchFieldKeys.LapsRemaining, captureFields.Number(view.LapsRemaining, 0, 10000, "no_fuel"));
            Add(fields, ResearchFieldKeys.Position, captureFields.Integer(view.Position,
                ResearchLimits.PositionMin, ResearchLimits.PositionMax, "no_position"));
            Add(fields, ResearchFieldKeys.ClassPosition, captureFields.Integer(view.ClassPosition,
                ResearchLimits.PositionMin, ResearchLimits.PositionMax, "no_position"));
            Add(fields, ResearchFieldKeys.CompletedLaps, captureFields.Integer(view.CompletedLaps, 0, 100000, "no_timing"));
            Add(fields, ResearchFieldKeys.LastLapSeconds, captureFields.Number(view.LastLapSeconds,
                ResearchLimits.LapTimeSecondsMin, ResearchLimits.LapTimeSecondsMax, "no_timing"));
            Add(fields, ResearchFieldKeys.BestLapSeconds, captureFields.Number(view.BestLapSeconds,
                ResearchLimits.LapTimeSecondsMin, ResearchLimits.LapTimeSecondsMax, "no_timing"));
            Add(fields, ResearchFieldKeys.CurrentLapElapsedSeconds, captureFields.Number(view.CurrentLapElapsedSeconds,
                ResearchLimits.LapTimeSecondsMin, ResearchLimits.LapTimeSecondsMax, "no_timing"));
            Add(fields, ResearchFieldKeys.LapDistancePct, captureFields.Number(view.LapDistancePct,
                ResearchLimits.LapDistancePctMin, ResearchLimits.LapDistancePctMax, "no_track"));
            Add(fields, ResearchFieldKeys.OnPitRoad, captureFields.Flag(view.OnPitRoad, "no_track"));
            Add(fields, ResearchFieldKeys.Incidents, captureFields.Integer(view.Incidents, 0, 10000, "no_race_state"));
            Add(fields, ResearchFieldKeys.SessionTimeSeconds, captureFields.Number(view.SessionTimeSeconds,
                ResearchLimits.SessionTimeSecondsMin, ResearchLimits.SessionTimeSecondsMax, "no_session"));

            // --- banden (herkomst per zone, frequentie = sim-refresh) ---
            for (var corner = 0; corner < 4; corner++)
            {
                for (var zone = 0; zone < 3; zone++)
                {
                    Add(fields, ResearchFieldKeys.Wear(corner, zone), tyres.Wear(corner, zone));
                    Add(fields, ResearchFieldKeys.Carcass(corner, zone), tyres.Carcass(corner, zone));
                }
            }
            Add(fields, ResearchFieldKeys.TyreSetsUsed, tyres.SetsUsed());
            Add(fields, ResearchFieldKeys.TyreCompoundId, tyres.CompoundId());
            Add(fields, ResearchFieldKeys.TrackTempC, tyres.TrackTempC());
            Add(fields, ResearchFieldKeys.AirTempC, tyres.AirTempC());
            Add(fields, ResearchFieldKeys.TrackRubberState, tyres.RubberState());
            if (tyres.FrozenAtUtc.HasValue)
            {
                Add(fields, ResearchFieldKeys.TyreSnapshotFrozenAt,
                    ResearchField.TextValue(ResearchFormat.Timestamp(tyres.FrozenAtUtc.Value),
                        ResearchProvenance.Measured, tyres.FrozenAtUtc.Value, ResearchRates.OnSimRefresh, "pit_entry_freeze"));
            }

            // --- het bevroren pit-entry-anker (de set die eraf ging) ---
            // Let op: dit blok komt uit de bestaande capture (V3Tyres.pitEntry) en is per
            // definitie een momentopname van vóór de bandenwissel. Het is nooit Measured:
            // de waarde is echt gemeten, maar niet op dit sample, en de tracker bewaart het
            // moment van bevriezen als laatste bekende leestijd.
            if (view.PitEntryTyres != null)
            {
                var frozen = new ResearchTyreClassifier(view.PitEntryTyres, sampleAtUtc, tyreFreshToleranceSeconds);
                for (var corner = 0; corner < 4; corner++)
                {
                    for (var zone = 0; zone < 3; zone++)
                    {
                        Add(fields, ResearchFieldKeys.PitEntryWear(corner, zone), frozen.Wear(corner, zone));
                        Add(fields, ResearchFieldKeys.PitEntryCarcass(corner, zone), frozen.Carcass(corner, zone));
                    }
                }
                Add(fields, ResearchFieldKeys.PitEntrySetsUsed, frozen.SetsUsed());
                if (frozen.FrozenAtUtc.HasValue)
                {
                    Add(fields, ResearchFieldKeys.PitEntryFrozenAt,
                        ResearchField.TextValue(ResearchFormat.Timestamp(frozen.FrozenAtUtc.Value),
                            ResearchProvenance.LastKnown, frozen.FrozenAtUtc.Value, ResearchRates.OnSimRefresh, "frozen_pit_snapshot"));
                }
            }

            return fields;
        }

        private ResearchField Channel(IResearchChannelReader channels, string channel, double minimum, double maximum, DateTime sampleAtUtc)
        {
            if (channels == null) return ResearchField.Unavailable("no_channel_reader");
            var value = channels.ReadNumber(channel, minimum, maximum);
            if (!value.HasValue) return ResearchField.Unavailable("channel_missing");
            // Het kanaal is op dít moment gelezen: measuredAt == sampleAt, dus geen aparte at.
            return ResearchField.Ranged(value, minimum, maximum, ResearchProvenance.Measured, sampleAtUtc, _intervalMs, null, "out_of_range");
        }

        private ResearchField Property(IResearchChannelReader channels, string property, double minimum, double maximum, DateTime sampleAtUtc)
        {
            if (channels == null) return ResearchField.Unavailable("no_channel_reader");
            var value = channels.ReadProperty(property, minimum, maximum);
            if (!value.HasValue) return ResearchField.Unavailable("property_missing");
            return ResearchField.Ranged(value, minimum, maximum, ResearchProvenance.Measured, sampleAtUtc, _intervalMs, "property_fallback", "out_of_range");
        }

        /// <summary>
        /// Gas/rem: komt uit de capture als het vehicle-blok meegaat. Pas als dat blok er niet
        /// is (uitgebreide Pitwall-telemetrie uit) lezen we het ruwe kanaal — dat is de enige
        /// plek waar we iets lezen dat de capture ook zou kunnen hebben.
        /// </summary>
        private ResearchField Pedal(ResearchCaptureView view, ResearchCaptureClassifier captureFields,
            IResearchChannelReader channels, double? captureValue, string channel, DateTime sampleAtUtc)
        {
            if (view.HasVehicle && captureValue.HasValue)
            {
                return captureFields.Number(captureValue, ResearchLimits.PedalPctMin, ResearchLimits.PedalPctMax, "no_vehicle_block");
            }
            if (channels == null) return ResearchField.Unavailable("no_channel_reader");
            // iRacing levert Throttle/Brake als fractie 0..1; percentage = ×100.
            var raw = channels.ReadNumber(channel, 0.0, 1.001);
            if (!raw.HasValue) return ResearchField.Unavailable("channel_missing");
            var percent = raw.Value * 100.0;
            return ResearchField.Ranged(percent, ResearchLimits.PedalPctMin, ResearchLimits.PedalPctMax,
                ResearchProvenance.Measured, sampleAtUtc, _intervalMs, "channel", "out_of_range");
        }

        private static void Add(IList<KeyValuePair<string, ResearchField>> fields, string key, ResearchField field)
        {
            fields.Add(new KeyValuePair<string, ResearchField>(key, field));
        }
    }
}
