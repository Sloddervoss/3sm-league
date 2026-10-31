using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.Serialization;

namespace ThreeSM.EnduranceConnector
{
    /// <summary>Welke reeks een wachtrij-item hoort bij.</summary>
    public enum OutboxSeries
    {
        Events = 0,
        Laps = 1
    }

    /// <summary>
    /// Eén wachtrij-item: de geserialiseerde rij plus de administratie die nodig is om
    /// hem na een herstart opnieuw aan te bieden. <see cref="Uid"/> is de identiteit;
    /// <see cref="RowJson"/> is de inhoud zoals hij over de draad gaat.
    /// </summary>
    public sealed class OutboxEntry
    {
        public string Uid { get; set; }
        public OutboxSeries Series { get; set; }
        public int RecordRevision { get; set; }
        public string RowJson { get; set; }
        public DateTime EnqueuedAtUtc { get; set; }
        public int Attempts { get; set; }
        public DateTime? NextAttemptUtc { get; set; }

        public bool Due(DateTime nowUtc)
        {
            return !NextAttemptUtc.HasValue || NextAttemptUtc.Value <= nowUtc;
        }
    }

    /// <summary>Grenzen en tempo van de wachtrij. Bewust klein: dit is geen archief.</summary>
    public sealed class OutboxLimits
    {
        public int MaxEvents = 64;
        public int MaxLaps = 32;
        public double BackoffBaseSeconds = 2.0;
        public double BackoffMaxSeconds = 60.0;
        /// <summary>Hoeveel pogingen één rij mag kosten voordat hij met reden vervalt. 0 = onbeperkt.</summary>
        public int MaxAttemptsPerEntry = 0;
        /// <summary>Bovengrens aan de hele bewaarde wachtrij in bytes (compacte JSON).</summary>
        public int MaxStoredBytes = 512 * 1024;
    }

    /// <summary>Uitslag van één ACK-antwoord, per reeks, zoals de Edge hem stuurt.</summary>
    public sealed class AckId
    {
        public string Uid { get; set; }
        /// <summary>De revisie die de server bevestigde; null = oudere server zonder revisie.</summary>
        public int? RecordRevision { get; set; }
    }

    public sealed class AckRejection
    {
        public string Uid { get; set; }
        public int? Index { get; set; }
        public string Reason { get; set; }
        public string Stage { get; set; }
    }

    public sealed class AckSeriesReport
    {
        public int Received { get; set; }
        public List<AckId> Accepted { get; set; }
        public List<AckId> Duplicates { get; set; }
        public List<AckId> Superseded { get; set; }
        public List<AckRejection> Rejected { get; set; }
        public string BlockError { get; set; }
        public bool Stored { get; set; }

        public AckSeriesReport()
        {
            Accepted = new List<AckId>();
            Duplicates = new List<AckId>();
            Superseded = new List<AckId>();
            Rejected = new List<AckRejection>();
        }
    }

    public sealed class MeasurementAckReport
    {
        public AckSeriesReport Events { get; set; }
        public AckSeriesReport Laps { get; set; }
        /// <summary>De reeksen die in dit frame zijn aangeboden; bepaalt de indexvertaling.</summary>
        public OutboxBatch Batch { get; set; }

        public MeasurementAckReport()
        {
            Events = new AckSeriesReport();
            Laps = new AckSeriesReport();
        }
    }

    /// <summary>Eén verzonden batch: de items in payloadvolgorde.</summary>
    public sealed class OutboxBatch
    {
        public List<OutboxEntry> Events { get; set; }
        public List<OutboxEntry> Laps { get; set; }

        public OutboxBatch()
        {
            Events = new List<OutboxEntry>();
            Laps = new List<OutboxEntry>();
        }

        public bool IsEmpty { get { return Events.Count == 0 && Laps.Count == 0; } }
    }

    /// <summary>Wat een ACK-verwerking heeft gedaan. Nooit stilzwijgend leeg.</summary>
    public sealed class AckOutcome
    {
        public int ConfirmedEvents { get; set; }
        public int ConfirmedLaps { get; set; }
        public int DuplicateEvents { get; set; }
        public int DuplicateLaps { get; set; }
        public int SupersededEvents { get; set; }
        public int SupersededLaps { get; set; }
        public int RejectedEvents { get; set; }
        public int RejectedLaps { get; set; }
        public int KeptForNewerRevision { get; set; }
        public bool Stored { get; set; }
        public string BlockError { get; set; }
        public string LastRejectionReason { get; set; }

        public int Removed { get { return ConfirmedEvents + ConfirmedLaps + DuplicateEvents + DuplicateLaps + SupersededEvents + SupersededLaps + RejectedEvents + RejectedLaps; } }
    }

    [DataContract]
    internal sealed class OutboxEntryDto
    {
        [DataMember(Name = "uid", Order = 1)] public string Uid { get; set; }
        [DataMember(Name = "series", Order = 2)] public int Series { get; set; }
        [DataMember(Name = "recordRevision", Order = 3)] public int RecordRevision { get; set; }
        [DataMember(Name = "row", Order = 4)] public string Row { get; set; }
        [DataMember(Name = "enqueuedAt", Order = 5)] public string EnqueuedAt { get; set; }
        [DataMember(Name = "attempts", Order = 6)] public int Attempts { get; set; }
        [DataMember(Name = "nextAttempt", Order = 7, EmitDefaultValue = false)] public string NextAttempt { get; set; }
    }

    [DataContract]
    internal sealed class OutboxFileDto
    {
        [DataMember(Name = "version", Order = 1)] public int Version { get; set; }
        [DataMember(Name = "droppedEvents", Order = 2)] public int DroppedEvents { get; set; }
        [DataMember(Name = "droppedLaps", Order = 3)] public int DroppedLaps { get; set; }
        [DataMember(Name = "rejectedEvents", Order = 4)] public int RejectedEvents { get; set; }
        [DataMember(Name = "rejectedLaps", Order = 5)] public int RejectedLaps { get; set; }
        [DataMember(Name = "lastDropReason", Order = 6, EmitDefaultValue = false)] public string LastDropReason { get; set; }
        [DataMember(Name = "events", Order = 7)] public OutboxEntryDto[] Events { get; set; }
        [DataMember(Name = "laps", Order = 8)] public OutboxEntryDto[] Laps { get; set; }
    }

    /// <summary>
    /// De begrensde, persistente wachtrij voor meetgebeurtenissen en rondeaggregaten.
    ///
    /// De regels die dit bestand afdwingt:
    ///   1. Een rij verdwijnt pas als de server hem PER RIJ heeft bevestigd
    ///      (accepted, duplicates of superseded met dezelfde of hogere revisie).
    ///      Een HTTP 202 zonder dat bewijs ruimt niets op.
    ///   2. <c>stored:false</c> betekent: niets opruimen, reden bewaren, later opnieuw.
    ///   3. Elke rij houdt zijn UUID, ook na een herstart. De wachtrij staat op schijf
    ///      en wordt bij het laden weer opgebouwd.
    ///   4. Overloop is expliciet verlies: de oudste rij vervalt en de teller gaat omhoog.
    ///      Er verdwijnt nooit iets zonder dat het geteld en benoemd is.
    ///   5. Herverzenden gebeurt met backoff, niet in een strakke lus.
    /// </summary>
    public sealed class MeasurementOutbox
    {
        private const int FileVersion = 1;
        private readonly object _gate = new object();
        private readonly List<OutboxEntry> _events = new List<OutboxEntry>();
        private readonly List<OutboxEntry> _laps = new List<OutboxEntry>();
        private readonly string _path;
        private readonly OutboxLimits _limits;

        public MeasurementOutbox(string path) : this(path, new OutboxLimits()) { }

        public MeasurementOutbox(string path, OutboxLimits limits)
        {
            if (string.IsNullOrEmpty(path)) throw new ArgumentException("pad ontbreekt", "path");
            _path = path;
            _limits = limits ?? new OutboxLimits();
        }

        public int EventCount { get { lock (_gate) return _events.Count; } }
        public int LapCount { get { lock (_gate) return _laps.Count; } }
        public int DroppedEvents { get; private set; }
        public int DroppedLaps { get; private set; }
        public int RejectedEvents { get; private set; }
        public int RejectedLaps { get; private set; }
        public string LastDropReason { get; private set; }
        public string LastBlockError { get; private set; }
        public string LastPersistenceError { get; private set; }
        public DateTime? LastConfirmedUtc { get; private set; }
        public string Path { get { return _path; } }

        // ------------------------------------------------------------- toevoegen

        /// <summary>
        /// Zet een meetgebeurtenis in de wachtrij. De rij wordt eerst gevalideerd: een
        /// rij die de Edge zeker weigert hoort hier niet in en wordt geteld als verlies.
        /// </summary>
        public bool Enqueue(MeasurementEventRecord record, out string reason)
        {
            if (record == null) { reason = "record_null"; return false; }
            var problems = record.Validate();
            if (problems.Count > 0) { reason = problems[0]; return false; }
            var entry = new OutboxEntry
            {
                Uid = record.EventUid,
                Series = OutboxSeries.Events,
                RecordRevision = record.RecordRevision,
                RowJson = record.ToJson(),
                EnqueuedAtUtc = DateTime.UtcNow
            };
            return Add(entry, _events, _limits.MaxEvents, true, out reason);
        }

        /// <summary>Zit deze UUID nog in de wachtrij? (Na een ACK kan hij al weg zijn.)</summary>
        public bool Contains(string uid)
        {
            if (string.IsNullOrEmpty(uid)) return false;
            lock (_gate) { return Find(_events, uid) != null || Find(_laps, uid) != null; }
        }

        /// <summary>Zet een rondeaggregaat in de wachtrij (zelfde regels).</summary>
        public bool EnqueueLap(MeasurementLapSummaryRecord record, out string reason)
        {
            if (record == null) { reason = "record_null"; return false; }
            var problems = record.Validate();
            if (problems.Count > 0) { reason = problems[0]; return false; }
            var entry = new OutboxEntry
            {
                Uid = record.SummaryUid,
                Series = OutboxSeries.Laps,
                RecordRevision = record.RecordRevision,
                RowJson = record.ToJson(),
                EnqueuedAtUtc = DateTime.UtcNow
            };
            return Add(entry, _laps, _limits.MaxLaps, false, out reason);
        }

        private bool Add(OutboxEntry entry, List<OutboxEntry> target, int capacity, bool isEvent, out string reason)
        {
            lock (_gate)
            {
                if (!MeasurementIds.IsUid(entry.Uid)) { reason = "uid_invalid"; return false; }
                if (string.IsNullOrEmpty(entry.RowJson)) { reason = "row_empty"; return false; }
                if (Find(target, entry.Uid) != null)
                {
                    // Dezelfde UUID twee keer aanbieden is geen tweede rij.
                    reason = "duplicate_uid";
                    return false;
                }
                if (target.Count >= capacity)
                {
                    // Expliciet verlies: de oudste vervalt en dat wordt geteld en benoemd.
                    var dropped = target[0];
                    target.RemoveAt(0);
                    if (isEvent) { DroppedEvents++; LastDropReason = "outbox_full:events:" + dropped.Uid; }
                    else { DroppedLaps++; LastDropReason = "outbox_full:laps:" + dropped.Uid; }
                }
                target.Add(entry);
                reason = null;
                SaveLocked();
                return true;
            }
        }

        // -------------------------------------------------------------- uitlezen

        /// <summary>
        /// De rijen die nu aangeboden mogen worden: nog niet aan de beurt zijn ze niet,
        /// en de volgorde is die van binnenkomst (oudste eerst).
        /// </summary>
        public OutboxBatch Due(DateTime nowUtc, int maxEvents, int maxLaps)
        {
            var batch = new OutboxBatch();
            lock (_gate)
            {
                Collect(_events, nowUtc, maxEvents, batch.Events);
                Collect(_laps, nowUtc, maxLaps, batch.Laps);
            }
            return batch;
        }

        private static void Collect(List<OutboxEntry> source, DateTime nowUtc, int max, List<OutboxEntry> target)
        {
            if (max <= 0) return;
            foreach (var entry in source)
            {
                if (target.Count >= max) return;
                if (entry.Due(nowUtc)) target.Add(entry);
            }
        }

        // ------------------------------------------------------------------- ACK

        /// <summary>
        /// Verwerkt het antwoord van de server. Alleen een bevestiging per rij haalt een
        /// rij weg; een afgewezen reeks (<c>stored:false</c>) laat alles staan met de
        /// reden erbij.
        /// </summary>
        public AckOutcome ApplyAck(MeasurementAckReport ack, DateTime nowUtc)
        {
            var outcome = new AckOutcome();
            if (ack == null)
            {
                outcome.Stored = false;
                outcome.BlockError = "ack_missing";
                LastBlockError = "ack_missing";
                return outcome;
            }
            lock (_gate)
            {
                var eventsStored = ApplySeries(ack.Events, ack.Batch == null ? null : ack.Batch.Events,
                    _events, true, outcome, nowUtc);
                var lapsStored = ApplySeries(ack.Laps, ack.Batch == null ? null : ack.Batch.Laps,
                    _laps, false, outcome, nowUtc);
                outcome.KeptForNewerRevision = _keptForNewerRevision;
                _keptForNewerRevision = 0;
                outcome.Stored = eventsStored && lapsStored;
                if (!outcome.Stored)
                {
                    var reason = ack.Events != null && !eventsStored && !string.IsNullOrEmpty(ack.Events.BlockError)
                        ? ack.Events.BlockError
                        : ack.Laps != null && !lapsStored && !string.IsNullOrEmpty(ack.Laps.BlockError)
                            ? ack.Laps.BlockError
                            : (ack.Events != null && !eventsStored) || (ack.Laps != null && !lapsStored)
                                ? "not_stored"
                                : "ack_incomplete";
                    outcome.BlockError = reason;
                    LastBlockError = reason;
                }
                else
                {
                    LastBlockError = null;
                    LastConfirmedUtc = nowUtc;
                }
                SaveLocked();
            }
            return outcome;
        }

        private bool ApplySeries(AckSeriesReport series, List<OutboxEntry> batchEntries, List<OutboxEntry> target,
            bool isEvent, AckOutcome outcome, DateTime nowUtc)
        {
            if (series == null) return true;
            var offered = batchEntries == null ? 0 : batchEntries.Count;
            // Niets aangeboden en niets ontvangen: deze reeks zegt niets over onze
            // wachtrij. Dat is geen "niet opgeslagen" en mag de rest niet besmetten.
            if (offered == 0 && series.Received == 0
                && series.Accepted.Count == 0 && series.Duplicates.Count == 0
                && series.Superseded.Count == 0 && series.Rejected.Count == 0)
            {
                return true;
            }
            if (!series.Stored)
            {
                // Niet duurzaam opgeslagen: niets opruimen. De reden blijft staan zodat
                // een volgende poging niet opnieuw "succes" hoeft te veinzen.
                if (!string.IsNullOrEmpty(series.BlockError)) LastBlockError = series.BlockError;
                return false;
            }

            foreach (var id in series.Accepted)
            {
                if (!RemoveConfirmed(target, id)) continue;
                if (isEvent) outcome.ConfirmedEvents++; else outcome.ConfirmedLaps++;
            }
            foreach (var id in series.Duplicates)
            {
                if (!RemoveConfirmed(target, id)) continue;
                if (isEvent) outcome.DuplicateEvents++; else outcome.DuplicateLaps++;
            }
            foreach (var id in series.Superseded)
            {
                if (!RemoveConfirmed(target, id)) continue;
                if (isEvent) outcome.SupersededEvents++; else outcome.SupersededLaps++;
            }

            foreach (var rejection in series.Rejected)
            {
                var entry = Resolve(target, batchEntries, rejection);
                if (entry == null) continue;
                // Een afgekeurde rij komt nooit meer door; hem laten staan zou de wachtrij
                // voor altijd blokkeren. Wel tellen en de reden bewaren.
                target.Remove(entry);
                outcome.LastRejectionReason = rejection.Reason;
                if (isEvent) { RejectedEvents++; outcome.RejectedEvents++; }
                else { RejectedLaps++; outcome.RejectedLaps++; }
            }
            return true;
        }

        /// <summary>
        /// Haalt een rij weg als de bevestigde revisie niet ouder is dan wat wij hebben.
        /// Een bevestiging van een oudere revisie laat onze nieuwere inhoud staan.
        /// </summary>
        private bool RemoveConfirmed(List<OutboxEntry> target, AckId id)
        {
            if (id == null || string.IsNullOrEmpty(id.Uid)) return false;
            var entry = Find(target, id.Uid);
            if (entry == null) return false;
            if (id.RecordRevision.HasValue && id.RecordRevision.Value < entry.RecordRevision)
            {
                _keptForNewerRevision++;
                return false;
            }
            target.Remove(entry);
            return true;
        }

        private int _keptForNewerRevision;

        private static OutboxEntry Resolve(List<OutboxEntry> target, List<OutboxEntry> batchEntries, AckRejection rejection)
        {
            if (rejection == null) return null;
            if (!string.IsNullOrEmpty(rejection.Uid))
            {
                var byId = Find(target, rejection.Uid);
                if (byId != null) return byId;
            }
            if (rejection.Index.HasValue && batchEntries != null
                && rejection.Index.Value >= 0 && rejection.Index.Value < batchEntries.Count)
            {
                // De index verwijst naar de oorspronkelijke payload; de batch is precies
                // die payload, dus dezelfde volgorde.
                var candidate = batchEntries[rejection.Index.Value];
                return Find(target, candidate.Uid);
            }
            return null;
        }

        // --------------------------------------------------------------- opnieuw

        /// <summary>
        /// Na een poging: bij falen de teller omhoog en de volgende poging uitstellen met
        /// exponentiele backoff (begrensd). Bij succes gaat de teller terug naar nul.
        /// </summary>
        public void MarkAttempt(IEnumerable<OutboxEntry> entries, DateTime nowUtc, bool failed)
        {
            if (entries == null) return;
            lock (_gate)
            {
                foreach (var entry in entries)
                {
                    if (entry == null) continue;
                    if (!failed)
                    {
                        entry.Attempts = 0;
                        entry.NextAttemptUtc = null;
                        continue;
                    }
                    entry.Attempts++;
                    if (_limits.MaxAttemptsPerEntry > 0 && entry.Attempts >= _limits.MaxAttemptsPerEntry)
                    {
                        // Opgegeven na het maximum: expliciet verlies met reden.
                        if (entry.Series == OutboxSeries.Events) { DroppedEvents++; LastDropReason = "max_attempts:" + entry.Uid; }
                        else { DroppedLaps++; LastDropReason = "max_attempts:" + entry.Uid; }
                        if (entry.Series == OutboxSeries.Events) _events.Remove(entry); else _laps.Remove(entry);
                        continue;
                    }
                    entry.NextAttemptUtc = nowUtc.AddSeconds(BackoffSeconds(entry.Attempts));
                }
                SaveLocked();
            }
        }

        public double BackoffSeconds(int attempts)
        {
            var exponent = Math.Max(0, attempts - 1);
            var seconds = _limits.BackoffBaseSeconds * Math.Pow(2, exponent);
            if (double.IsNaN(seconds) || double.IsInfinity(seconds)) return _limits.BackoffMaxSeconds;
            return Math.Min(seconds, _limits.BackoffMaxSeconds);
        }

        // ------------------------------------------------------------- persistentie

        /// <summary>
        /// Leest de wachtrij van schijf. Een onleesbaar bestand wordt apart gezet en telt
        /// als verlies; het mag nooit stil verdwijnen en ook nooit de plugin laten vallen.
        /// </summary>
        public void Load()
        {
            lock (_gate)
            {
                _events.Clear();
                _laps.Clear();
                DroppedEvents = 0;
                DroppedLaps = 0;
                RejectedEvents = 0;
                RejectedLaps = 0;
                if (!File.Exists(_path)) return;
                OutboxFileDto file = null;
                try
                {
                    file = MeasurementJson.Deserialize<OutboxFileDto>(File.ReadAllText(_path));
                }
                catch (Exception error)
                {
                    LastPersistenceError = "load_failed:" + error.GetType().Name;
                    Quarantine();
                    return;
                }
                if (file == null || file.Version != FileVersion)
                {
                    LastPersistenceError = "load_version";
                    Quarantine();
                    return;
                }
                DroppedEvents += file.DroppedEvents;
                DroppedLaps += file.DroppedLaps;
                RejectedEvents += file.RejectedEvents;
                RejectedLaps += file.RejectedLaps;
                if (!string.IsNullOrEmpty(file.LastDropReason)) LastDropReason = file.LastDropReason;
                Restore(file.Events, _events, _limits.MaxEvents, true);
                Restore(file.Laps, _laps, _limits.MaxLaps, false);
            }
        }

        private void Restore(OutboxEntryDto[] rows, List<OutboxEntry> target, int capacity, bool isEvent)
        {
            if (rows == null) return;
            foreach (var row in rows)
            {
                if (target.Count >= capacity)
                {
                    if (isEvent) { DroppedEvents++; LastDropReason = "outbox_full_on_load"; }
                    else { DroppedLaps++; LastDropReason = "outbox_full_on_load"; }
                    break;
                }
                if (row == null || !MeasurementIds.IsUid(row.Uid) || string.IsNullOrEmpty(row.Row)
                    || row.Row.TrimStart()[0] != '{')
                {
                    if (isEvent) DroppedEvents++; else DroppedLaps++;
                    LastDropReason = "corrupt_entry";
                    continue;
                }
                var entry = new OutboxEntry
                {
                    Uid = row.Uid,
                    Series = isEvent ? OutboxSeries.Events : OutboxSeries.Laps,
                    RecordRevision = row.RecordRevision < 1 ? 1 : row.RecordRevision,
                    RowJson = row.Row,
                    EnqueuedAtUtc = MeasurementTime.Parse(row.EnqueuedAt) ?? DateTime.UtcNow,
                    Attempts = row.Attempts < 0 ? 0 : row.Attempts,
                    NextAttemptUtc = MeasurementTime.Parse(row.NextAttempt)
                };
                target.Add(entry);
            }
        }

        /// <summary>Schrijft de wachtrij atomair weg. Fouten worden bewaard, niet gegooid.</summary>
        public void Save()
        {
            lock (_gate) { SaveLocked(); }
        }

        private void SaveLocked()
        {
            try
            {
                var directory = System.IO.Path.GetDirectoryName(_path);
                if (!string.IsNullOrEmpty(directory) && !Directory.Exists(directory)) Directory.CreateDirectory(directory);
                var file = new OutboxFileDto
                {
                    Version = FileVersion,
                    DroppedEvents = DroppedEvents,
                    DroppedLaps = DroppedLaps,
                    RejectedEvents = RejectedEvents,
                    RejectedLaps = RejectedLaps,
                    LastDropReason = LastDropReason,
                    Events = ToDtos(_events),
                    Laps = ToDtos(_laps)
                };
                var json = MeasurementJson.Serialize(file);
                if (json.Length > _limits.MaxStoredBytes)
                {
                    LastPersistenceError = "outbox_too_large";
                    return;
                }
                var temporary = _path + ".tmp";
                File.WriteAllText(temporary, json);
                if (File.Exists(_path))
                {
                    try
                    {
                        File.Replace(temporary, _path, _path + ".bak", true);
                    }
                    catch (Exception)
                    {
                        // File.Replace werkt niet op elk bestandssysteem; dan een kopie.
                        File.Copy(temporary, _path, true);
                        File.Delete(temporary);
                    }
                }
                else
                {
                    File.Move(temporary, _path);
                }
                LastPersistenceError = null;
            }
            catch (Exception error)
            {
                LastPersistenceError = "save_failed:" + error.GetType().Name;
            }
        }

        private static OutboxEntryDto[] ToDtos(List<OutboxEntry> entries)
        {
            var rows = new OutboxEntryDto[entries.Count];
            for (var index = 0; index < entries.Count; index++)
            {
                var entry = entries[index];
                rows[index] = new OutboxEntryDto
                {
                    Uid = entry.Uid,
                    Series = (int)entry.Series,
                    RecordRevision = entry.RecordRevision,
                    Row = entry.RowJson,
                    EnqueuedAt = MeasurementTime.Format(entry.EnqueuedAtUtc),
                    Attempts = entry.Attempts,
                    NextAttempt = MeasurementTime.Format(entry.NextAttemptUtc)
                };
            }
            return rows;
        }

        private void Quarantine()
        {
            try
            {
                var target = _path + ".corrupt-" + DateTime.UtcNow.ToString("yyyyMMddHHmmss");
                File.Copy(_path, target, true);
            }
            catch (Exception)
            {
                // Bewaren is een gunst, niet de hoofdzaak; het origineel blijft staan.
            }
        }

        private static OutboxEntry Find(List<OutboxEntry> source, string uid)
        {
            if (string.IsNullOrEmpty(uid)) return null;
            foreach (var entry in source)
                if (string.Equals(entry.Uid, uid, StringComparison.OrdinalIgnoreCase)) return entry;
            return null;
        }
    }

    /// <summary>
    /// Leest het ACK-antwoord. Tolerant voor de vormen die de Edge mag sturen: objecten
    /// met <c>{id, record_revision}</c>, kale strings (oudere database), ontbrekende
    /// reeksen en een frame dat als geheel geweigerd is.
    /// </summary>
    public static class MeasurementAckParser
    {
        public const string ReasonInvalidAck = "ack_invalid";
        public const string ReasonNoMeasurements = "ack_without_measurements";

        public static MeasurementAckReport Parse(string json, OutboxBatch batch)
        {
            var report = new MeasurementAckReport { Batch = batch };
            if (string.IsNullOrWhiteSpace(json))
            {
                report.Events.Stored = false;
                report.Events.BlockError = ReasonInvalidAck;
                report.Laps.Stored = false;
                report.Laps.BlockError = ReasonInvalidAck;
                return report;
            }
            Dictionary<string, object> root;
            try
            {
                root = MeasurementJson.DeserializeDictionary(json);
            }
            catch (Exception)
            {
                report.Events.Stored = false;
                report.Events.BlockError = ReasonInvalidAck;
                report.Laps.Stored = false;
                report.Laps.BlockError = ReasonInvalidAck;
                return report;
            }

            var measurements = Object(root, "measurements");
            var frameError = Text(root, "error");
            if (measurements == null)
            {
                // Een frame-ACK zonder rijbevestigingen is geen leveringsbewijs.
                var reason = string.IsNullOrEmpty(frameError) ? ReasonNoMeasurements : frameError;
                report.Events.Stored = false;
                report.Events.BlockError = reason;
                report.Laps.Stored = false;
                report.Laps.BlockError = reason;
                return report;
            }

            ReadSeries(Object(measurements, "events"), report.Events, frameError);
            ReadSeries(Object(measurements, "laps"), report.Laps, frameError);
            return report;
        }

        private static void ReadSeries(Dictionary<string, object> source, AckSeriesReport target, string frameError)
        {
            if (source == null)
            {
                target.Stored = false;
                target.BlockError = ReasonNoMeasurements;
                return;
            }
            target.Received = Integer(source, "received") ?? 0;
            target.Accepted = Ids(source, "accepted");
            target.Duplicates = Ids(source, "duplicates");
            target.Superseded = Ids(source, "superseded");
            target.Rejected = Rejections(source, "rejected");
            target.BlockError = Text(source, "block_error") ?? frameError;
            var stored = Bool(source, "stored");
            if (stored.HasValue)
            {
                target.Stored = stored.Value;
            }
            else
            {
                // Geen 'stored' in het antwoord. Alleen als er niets is aangeboden en
                // niets is afgekeurd, zegt deze reeks niets en is "niets op te ruimen"
                // de juiste uitkomst. Zodra er een rij in het spel is, geldt: onbewezen
                // is niet opgeslagen.
                target.Stored = target.Received == 0 && target.Accepted.Count == 0
                    && target.Duplicates.Count == 0 && target.Superseded.Count == 0
                    && target.Rejected.Count == 0 && target.BlockError == null;
            }
        }

        private static List<AckId> Ids(Dictionary<string, object> source, string key)
        {
            var result = new List<AckId>();
            var values = Array(source, key);
            if (values == null) return result;
            foreach (var value in values)
            {
                if (value is string)
                {
                    var text = (string)value;
                    if (!string.IsNullOrEmpty(text)) result.Add(new AckId { Uid = text, RecordRevision = null });
                    continue;
                }
                var record = value as Dictionary<string, object>;
                if (record == null) continue;
                var id = Text(record, "id");
                if (string.IsNullOrEmpty(id)) continue;
                result.Add(new AckId { Uid = id, RecordRevision = Integer(record, "record_revision") });
            }
            return result;
        }

        private static List<AckRejection> Rejections(Dictionary<string, object> source, string key)
        {
            var result = new List<AckRejection>();
            var values = Array(source, key);
            if (values == null) return result;
            foreach (var value in values)
            {
                var record = value as Dictionary<string, object>;
                if (record == null) continue;
                result.Add(new AckRejection
                {
                    Uid = Text(record, "id"),
                    Index = Integer(record, "index"),
                    Reason = Text(record, "reason") ?? "unknown",
                    Stage = Text(record, "stage")
                });
            }
            return result;
        }

        internal static Dictionary<string, object> Object(Dictionary<string, object> source, string key)
        {
            if (source == null) return null;
            object value;
            if (!source.TryGetValue(key, out value)) return null;
            return value as Dictionary<string, object>;
        }

        internal static List<object> Array(Dictionary<string, object> source, string key)
        {
            if (source == null) return null;
            object value;
            if (!source.TryGetValue(key, out value)) return null;
            return value as List<object>;
        }

        internal static string Text(Dictionary<string, object> source, string key)
        {
            if (source == null) return null;
            object value;
            if (!source.TryGetValue(key, out value)) return null;
            var text = value as string;
            return string.IsNullOrEmpty(text) ? null : text;
        }

        internal static int? Integer(Dictionary<string, object> source, string key)
        {
            if (source == null) return null;
            object value;
            if (!source.TryGetValue(key, out value)) return null;
            if (value == null) return null;
            if (value is int) return (int)value;
            if (value is long)
            {
                var number = (long)value;
                return number > int.MaxValue || number < int.MinValue ? (int?)null : (int)number;
            }
            if (value is double)
            {
                var number = (double)value;
                return Math.Abs(number - Math.Floor(number)) < 1e-9 && number >= int.MinValue && number <= int.MaxValue
                    ? (int?)number
                    : null;
            }
            if (value is decimal)
            {
                var number = (decimal)value;
                return number == Math.Floor(number) && number >= int.MinValue && number <= int.MaxValue
                    ? (int?)number
                    : null;
            }
            int parsed;
            if (value is string && int.TryParse((string)value, out parsed)) return parsed;
            return null;
        }

        internal static bool? Bool(Dictionary<string, object> source, string key)
        {
            if (source == null) return null;
            object value;
            if (!source.TryGetValue(key, out value)) return null;
            if (value is bool) return (bool)value;
            var text = value as string;
            if (text == null) return null;
            bool parsed;
            return bool.TryParse(text, out parsed) ? (bool?)parsed : null;
        }
    }

}
