using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Globalization;

namespace ThreeSM.EnduranceConnector
{
    /// <summary>
    /// Welke baan een aangeboden ronde-rij heeft. De volledige aangeboden
    /// lapSummaries-lijst bevat legacy- en observatierijen door elkaar; de
    /// ACK-index verwijst altijd naar die volledige lijst, nooit naar een
    /// legacy-only of observatie-only deelverzameling.
    /// </summary>
    public enum ObservationAckLane
    {
        Legacy = 0,
        Observation = 1
    }

    /// <summary>
    /// De per-rij terminale uitkomst voor een observatierij. Alleen
    /// <see cref="Accepted"/>, <see cref="Duplicate"/> en
    /// <see cref="Superseded"/> kunnen — mits de bevestigde revisie hoog genoeg
    /// is — duurzame levering opleveren.
    /// </summary>
    public enum ObservationAckClass
    {
        None = 0,
        Accepted = 1,
        Duplicate = 2,
        Superseded = 3,
        Deferred = 4,
        Quarantined = 5,
        NotDelivered = 6
    }

    /// <summary>Bestaand legacy-gedrag, apart gehouden van de observatie-union.</summary>
    public enum ObservationLegacyAckClass
    {
        None = 0,
        Accepted = 1,
        Duplicate = 2,
        Superseded = 3,
        Rejected = 4
    }

    /// <summary>
    /// Eén onveranderlijke aangeboden ronde-rij. <see cref="RowJson"/> is de
    /// exacte tekst die in het frame stond; de resolver en de ledger vergelijken
    /// die byte-voor-byte en schrijven hem nooit opnieuw.
    /// </summary>
    public sealed class ObservationOfferedRow
    {
        private readonly string _uid;
        private readonly int _recordRevision;
        private readonly string _rowJson;
        private readonly ObservationAckLane _lane;
        private readonly ObservationPairingBinding _binding;

        private ObservationOfferedRow(string uid, int recordRevision, string rowJson,
            ObservationAckLane lane, ObservationPairingBinding binding)
        {
            _uid = uid;
            _recordRevision = recordRevision;
            _rowJson = rowJson;
            _lane = lane;
            _binding = binding;
        }

        public string Uid { get { return _uid; } }
        public int RecordRevision { get { return _recordRevision; } }
        public string RowJson { get { return _rowJson; } }
        public ObservationAckLane Lane { get { return _lane; } }
        public ObservationPairingBinding Binding { get { return _binding; } }

        /// <summary>
        /// Freezeert één aangeboden rij. De fabriek leest de identiteit uit de
        /// echte RowJson, zodat een caller geen andere UID/revisie kan veinzen
        /// dan wat er werkelijk is aangeboden. Een observatierij moet een
        /// complete binding en een echte observation hebben; een legacy-rij mag
        /// er juist geen hebben.
        /// </summary>
        public static ObservationOfferedRow TryCreate(string uid, int recordRevision, string rowJson,
            ObservationAckLane lane, ObservationPairingBinding binding, out string diagnostic)
        {
            diagnostic = null;
            if (!MeasurementIds.IsUid(uid)) { diagnostic = "uid_invalid"; return null; }
            if (recordRevision < 1 || recordRevision > MeasurementContract.MaxRecordRevision)
            {
                diagnostic = "record_revision_invalid";
                return null;
            }
            if (string.IsNullOrEmpty(rowJson)) { diagnostic = "row_json_empty"; return null; }
            if (lane == ObservationAckLane.Observation)
            {
                if (binding == null || !binding.IsComplete)
                {
                    diagnostic = "binding_incomplete";
                    return null;
                }
            }
            else if (binding != null)
            {
                diagnostic = "legacy_binding_not_allowed";
                return null;
            }

            Dictionary<string, object> row;
            try { row = MeasurementJson.DeserializeDictionary(rowJson); }
            catch (Exception) { diagnostic = "row_json_unreadable"; return null; }

            string rowUid;
            double rowRevision;
            if (!ObservationLedgerCandidate.TryString(row, "summaryUid", out rowUid)
                || !string.Equals(rowUid, uid, StringComparison.OrdinalIgnoreCase))
            {
                diagnostic = "row_uid_mismatch";
                return null;
            }
            if (!ObservationLedgerCandidate.TryNumber(row, "recordRevision", out rowRevision)
                || rowRevision != recordRevision)
            {
                diagnostic = "row_revision_mismatch";
                return null;
            }

            object observationObject;
            Dictionary<string, object> observation;
            row.TryGetValue("observation", out observationObject);
            observation = observationObject as Dictionary<string, object>;

            if (lane == ObservationAckLane.Observation)
            {
                if (observation == null) { diagnostic = "row_observation_missing"; return null; }
                double version;
                if (!ObservationLedgerCandidate.TryNumber(observation, "version", out version)
                    || version != 1)
                {
                    diagnostic = "row_observation_version_invalid";
                    return null;
                }
                object captureObject;
                Dictionary<string, object> capture;
                string device;
                if (!observation.TryGetValue("capture", out captureObject)
                    || (capture = captureObject as Dictionary<string, object>) == null
                    || !ObservationLedgerCandidate.TryString(capture, "deviceId", out device)
                    || !string.Equals(device, binding.CaptureDeviceId, StringComparison.OrdinalIgnoreCase))
                {
                    diagnostic = "row_observation_device_mismatch";
                    return null;
                }
            }
            else if (observation != null)
            {
                diagnostic = "legacy_row_has_observation";
                return null;
            }

            return new ObservationOfferedRow(uid, recordRevision, rowJson, lane, binding);
        }
    }

    /// <summary>
    /// De onveranderlijke, geordende lijst die precies zo is aangeboden:
    /// legacy- en observatierijen samen, in payloadvolgorde. Zonder deze lijst
    /// is een ACK-index niet ondubbelzinnig te vertalen.
    /// </summary>
    public sealed class ObservationOfferedBatch
    {
        private readonly ReadOnlyCollection<ObservationOfferedRow> _rows;

        private ObservationOfferedBatch(IList<ObservationOfferedRow> rows)
        {
            _rows = new ReadOnlyCollection<ObservationOfferedRow>(new List<ObservationOfferedRow>(rows));
        }

        public IList<ObservationOfferedRow> Rows { get { return _rows; } }
        public int Count { get { return _rows.Count; } }
        public int ObservationCount
        {
            get
            {
                var count = 0;
                for (var index = 0; index < _rows.Count; index++)
                    if (_rows[index].Lane == ObservationAckLane.Observation) count++;
                return count;
            }
        }

        public static ObservationOfferedBatch TryCreate(IList<ObservationOfferedRow> rows,
            out string diagnostic)
        {
            diagnostic = null;
            if (rows == null) { diagnostic = "rows_missing"; return null; }
            var copy = new List<ObservationOfferedRow>(rows.Count);
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            for (var index = 0; index < rows.Count; index++)
            {
                var row = rows[index];
                if (row == null) { diagnostic = "row_missing_at_" + index; return null; }
                // De server identificeert een rij met alleen de UID. Twee
                // dezelfde UID's in één batch maken id-resolutie ambigu.
                if (!seen.Add(row.Uid)) { diagnostic = "duplicate_batch_uid"; return null; }
                copy.Add(row);
            }
            return new ObservationOfferedBatch(copy);
        }
    }

    /// <summary>Eén rij uit de ACK-resolutie, in de oorspronkelijke aanbiedvolgorde.</summary>
    public sealed class ObservationAckRowResult
    {
        internal ObservationAckRowResult(ObservationOfferedRow offered, ObservationAckClass outcome,
            ObservationLegacyAckClass legacyOutcome, string reasonCode, string diagnostic,
            int? acknowledgedRevision)
        {
            Offered = offered;
            Outcome = outcome;
            LegacyOutcome = legacyOutcome;
            ReasonCode = reasonCode;
            Diagnostic = diagnostic;
            AcknowledgedRevision = acknowledgedRevision;
        }

        public ObservationOfferedRow Offered { get; private set; }
        public string Uid { get { return Offered.Uid; } }
        public int RecordRevision { get { return Offered.RecordRevision; } }
        public ObservationAckLane Lane { get { return Offered.Lane; } }
        public ObservationAckClass Outcome { get; private set; }
        public ObservationLegacyAckClass LegacyOutcome { get; private set; }
        public string ReasonCode { get; private set; }
        public string Diagnostic { get; private set; }
        public int? AcknowledgedRevision { get; private set; }

        public bool Delivered
        {
            get
            {
                return Lane == ObservationAckLane.Observation
                    && (Outcome == ObservationAckClass.Accepted
                        || Outcome == ObservationAckClass.Duplicate
                        || Outcome == ObservationAckClass.Superseded);
            }
        }
    }

    /// <summary>
    /// Het resultaat van classificatie vóór enige duurzame mutatie. De
    /// ledger-apply controleert deze uitkomst opnieuw tegen de actuele snapshot
    /// en de actuele <see cref="ObservationBindingFence"/>.
    /// </summary>
    public sealed class ObservationAckResolution
    {
        private readonly ReadOnlyCollection<ObservationAckRowResult> _rows;
        private readonly ReadOnlyCollection<string> _unknownUids;
        private readonly ReadOnlyCollection<string> _diagnostics;

        internal ObservationAckResolution(ObservationOfferedBatch batch,
            ObservationPairingBinding expectedBinding, IList<ObservationAckRowResult> rows,
            bool hasMeasurements, bool seriesStored, string blockErrorCode, string diagnostic,
            IList<string> unknownUids, IList<string> diagnostics)
        {
            Batch = batch;
            ExpectedBinding = expectedBinding;
            _rows = new ReadOnlyCollection<ObservationAckRowResult>(new List<ObservationAckRowResult>(rows));
            HasMeasurements = hasMeasurements;
            SeriesStored = seriesStored;
            BlockErrorCode = blockErrorCode;
            Diagnostic = diagnostic;
            _unknownUids = new ReadOnlyCollection<string>(new List<string>(unknownUids));
            _diagnostics = new ReadOnlyCollection<string>(new List<string>(diagnostics));
        }

        public ObservationOfferedBatch Batch { get; private set; }
        /// <summary>De pairing-epoch waaronder dit ACK is aangeboden en geldig is.</summary>
        public ObservationPairingBinding ExpectedBinding { get; private set; }
        public IList<ObservationAckRowResult> Rows { get { return _rows; } }
        public bool HasMeasurements { get; private set; }
        public bool SeriesStored { get; private set; }
        public string BlockErrorCode { get; private set; }
        public string Diagnostic { get; private set; }
        public IList<string> UnknownUids { get { return _unknownUids; } }
        public IList<string> Diagnostics { get { return _diagnostics; } }

        public bool HasObservationRows { get { return Batch != null && Batch.ObservationCount > 0; } }

        /// <summary>
        /// Alleen waar als élke aangeboden observatierij in dit ACK een
        /// revisie-voldoende accepted/duplicate/superseded is. Een lege
        /// observatiebatch levert bewust geen Stored-claim op.
        /// </summary>
        public bool AllObservationsDelivered
        {
            get
            {
                if (!HasObservationRows) return false;
                for (var index = 0; index < _rows.Count; index++)
                {
                    if (_rows[index].Lane != ObservationAckLane.Observation) continue;
                    if (!_rows[index].Delivered) return false;
                }
                return true;
            }
        }
    }

    /// <summary>
    /// Leest het echte ACK-antwoord (<c>measurements.laps</c>) en classificeert
    /// elke aangeboden rij. De id/index-vertaling gebeurt tegen de volledige
    /// batch, vóór er ook maar iets naar de ledger of de legacy-outbox gaat.
    /// </summary>
    public static class ObservationAckResolver
    {
        private const int MaxUnknownUids = 16;
        private const int MaxBlockCodeLength = 64;

        public static ObservationAckResolution Resolve(string ackJson, ObservationOfferedBatch batch,
            ObservationPairingBinding expectedBinding)
        {
            if (batch == null) throw new ArgumentNullException("batch");

            var cells = new Cell[batch.Count];
            for (var index = 0; index < cells.Length; index++) cells[index] = new Cell();

            var unknown = new List<string>();
            var diagnostics = new List<string>();

            if (expectedBinding == null || !expectedBinding.IsComplete)
                return FailAll(batch, expectedBinding, "ack_binding_incomplete");

            if (string.IsNullOrWhiteSpace(ackJson))
                return FailAll(batch, expectedBinding, "ack_invalid");

            Dictionary<string, object> root;
            try
            {
                root = MeasurementJson.DeserializeDictionary(ackJson);
            }
            catch (Exception)
            {
                return FailAll(batch, expectedBinding, "ack_invalid");
            }

            var measurements = Object(root, "measurements");
            if (measurements == null)
                return FailAll(batch, expectedBinding, "ack_without_measurements");

            var lapsObject = Object(measurements, "laps");
            if (lapsObject == null)
                return FailAll(batch, expectedBinding, "ack_without_measurements", true);

            bool stored;
            var storedRaw = lapsObject.ContainsKey("stored") ? lapsObject["stored"] : null;
            if (!(storedRaw is bool))
                return FailAll(batch, expectedBinding, "ack_store_unproven", true);
            stored = (bool)storedRaw;

            var blockError = BoundedBlockCode(Text(lapsObject, "block_error"));
            if (!stored)
                return FailAll(batch, expectedBinding, "ack_not_stored", true, blockError);
            if (blockError != null)
            {
                // Een geblokkeerde reeks kan nooit tegelijk een geslaagde
                // opslag zijn. De tegenstrijdigheid is geen leveringsbewijs.
                return FailAll(batch, expectedBinding, "ack_store_block_error", true, blockError);
            }

            List<object> accepted;
            List<object> duplicates;
            List<object> superseded;
            List<object> rejected;
            if (!TryArray(lapsObject, "accepted", out accepted)
                || !TryArray(lapsObject, "duplicates", out duplicates)
                || !TryArray(lapsObject, "superseded", out superseded)
                || !TryArray(lapsObject, "rejected", out rejected))
            {
                return FailAll(batch, expectedBinding, "ack_invalid", true, blockError);
            }

            object receivedRaw;
            if (lapsObject.TryGetValue("received", out receivedRaw))
            {
                int received;
                if (!StrictInteger(receivedRaw, 0, int.MaxValue, out received))
                    return FailAll(batch, expectedBinding, "ack_invalid", true, blockError);
                if (received < batch.Count)
                    AddDiagnostic(diagnostics, "ack_received_below_offer");
            }

            var byUid = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
            for (var index = 0; index < batch.Count; index++)
                byUid[batch.Rows[index].Uid] = index;

            ReadDelivered(accepted, ObservationAckClass.Accepted, batch, byUid, cells,
                unknown, diagnostics);
            ReadDelivered(duplicates, ObservationAckClass.Duplicate, batch, byUid, cells,
                unknown, diagnostics);
            ReadDelivered(superseded, ObservationAckClass.Superseded, batch, byUid, cells,
                unknown, diagnostics);
            ReadRejected(rejected, batch, byUid, cells, unknown, diagnostics);

            var rows = new List<ObservationAckRowResult>(batch.Count);
            for (var index = 0; index < batch.Count; index++)
            {
                rows.Add(BuildRow(batch.Rows[index], cells[index], expectedBinding));
            }

            return new ObservationAckResolution(batch, expectedBinding, rows, true, true,
                blockError, null, unknown, diagnostics);
        }

        private static void ReadDelivered(List<object> values, ObservationAckClass kind,
            ObservationOfferedBatch batch, Dictionary<string, int> byUid, Cell[] cells,
            List<string> unknown, List<string> diagnostics)
        {
            for (var position = 0; position < values.Count; position++)
            {
                var raw = values[position];
                if (raw is string)
                {
                    // Oudere database/Edge: kale UID zonder revisie. Nooit als
                    // revisie 1 lezen; voor een observatierij is dat onbewezen.
                    AddDelivered((string)raw, 0, false, kind, batch, byUid, cells,
                        unknown, diagnostics);
                    continue;
                }
                var record = raw as Dictionary<string, object>;
                if (record == null)
                {
                    AddDiagnostic(diagnostics, "ack_delivery_not_object");
                    continue;
                }
                string id;
                if (!ObservationLedgerCandidate.TryString(record, "id", out id)
                    || string.IsNullOrEmpty(id))
                {
                    AddDiagnostic(diagnostics, "ack_delivery_without_id");
                    continue;
                }
                var revision = ReadRevision(record);
                AddDelivered(id, revision.HasValue ? revision.Value : 0, revision.HasValue,
                    kind, batch, byUid, cells, unknown, diagnostics);
            }
        }

        private static void AddDelivered(string uid, int revision, bool revisionValid,
            ObservationAckClass kind, ObservationOfferedBatch batch, Dictionary<string, int> byUid,
            Cell[] cells, List<string> unknown, List<string> diagnostics)
        {
            if (!MeasurementIds.IsUid(uid))
            {
                AddDiagnostic(diagnostics, "ack_uid_invalid");
                return;
            }
            int index;
            if (!byUid.TryGetValue(uid, out index))
            {
                if (unknown.Count < MaxUnknownUids && !unknown.Contains(uid))
                    unknown.Add(uid);
                AddDiagnostic(diagnostics, "ack_unknown_uid");
                return;
            }
            var cell = cells[index];
            if (cell.Ambiguous) return;
            if (cell.RejectionSeen)
            {
                cell.Ambiguous = true;
                cell.Diagnostic = "ack_conflicting_decisions";
                AddDiagnostic(diagnostics, "ack_conflicting_decisions");
                return;
            }
            if (cell.DeliverySeen)
            {
                // Twee leveringsbesluiten voor dezelfde UID zijn geen
                // meerderheidsstem: ook dezelfde soort, een gelijke revisie of
                // een ongeldige tweede revisie maakt de rij ambigu.
                cell.Ambiguous = true;
                cell.Diagnostic = "ack_duplicate_delivery";
                AddDiagnostic(diagnostics, "ack_duplicate_delivery");
                return;
            }
            cell.DeliveryKind = kind;
            cell.DeliverySeen = true;
            if (revisionValid) cell.DeliveredRevision = revision;
        }

        private static void ReadRejected(List<object> values, ObservationOfferedBatch batch,
            Dictionary<string, int> byUid, Cell[] cells, List<string> unknown, List<string> diagnostics)
        {
            for (var position = 0; position < values.Count; position++)
            {
                var record = values[position] as Dictionary<string, object>;
                if (record == null)
                {
                    AddDiagnostic(diagnostics, "ack_rejection_not_object");
                    continue;
                }
                string id = null;
                var idRaw = record.ContainsKey("id") ? record["id"] : null;
                var idPresent = idRaw != null;
                if (idRaw != null)
                {
                    id = idRaw as string;
                    if (id != null) id = id.Trim();
                    if (string.IsNullOrEmpty(id)) id = null;
                }
                var indexRaw = record.ContainsKey("index") ? record["index"] : null;
                var indexPresent = indexRaw != null;
                var index = ReadIndex(record);
                if (indexPresent && !index.HasValue)
                    AddDiagnostic(diagnostics, "ack_index_invalid");
                var reason = Text(record, "reason") ?? "unknown";

                if (id != null && !MeasurementIds.IsUid(id))
                {
                    AddDiagnostic(diagnostics, "ack_uid_invalid");
                    id = null;
                }
                int idIndex = -1;
                var idKnown = id != null && byUid.TryGetValue(id, out idIndex);
                var indexKnown = index.HasValue && index.Value >= 0 && index.Value < batch.Count;

                if (!idKnown && id != null && unknown.Count < MaxUnknownUids
                    && !unknown.Contains(id))
                {
                    unknown.Add(id);
                }
                if (!idKnown && id != null) AddDiagnostic(diagnostics, "ack_unknown_uid");
                if (index.HasValue && !indexKnown) AddDiagnostic(diagnostics, "ack_index_out_of_range");

                if (idKnown && indexKnown)
                {
                    if (idIndex != index.Value)
                    {
                        // De twee identificaties wijzen naar verschillende rijen.
                        // Geen van beide is dan betrouwbaar; raak geen enkele rij aan.
                        MarkAmbiguous(cells[idIndex], "ack_index_id_conflict", diagnostics);
                        MarkAmbiguous(cells[index.Value], "ack_index_id_conflict", diagnostics);
                        continue;
                    }
                }
                else if (idKnown)
                {
                    // Een aanwezige maar ongeldige/buiten-bereik index mag niet
                    // stilzwijgend op de id terugvallen.
                    if (indexPresent)
                    {
                        MarkAmbiguous(cells[idIndex], "ack_ambiguous_identifier", diagnostics);
                        continue;
                    }
                }
                else if (indexKnown)
                {
                    // Een aanwezige maar onbekende/ongeldige id mag niet
                    // stilzwijgend op de index terugvallen.
                    if (idPresent)
                    {
                        MarkAmbiguous(cells[index.Value], "ack_ambiguous_identifier", diagnostics);
                        continue;
                    }
                }

                int target = -1;
                if (idKnown) target = idIndex;
                else if (indexKnown) target = index.Value;
                else
                {
                    if (!idPresent && !indexPresent)
                        AddDiagnostic(diagnostics, "ack_rejection_unattributed");
                    continue;
                }

                var cell = cells[target];
                if (cell.Ambiguous) continue;
                if (cell.DeliverySeen)
                {
                    cell.Ambiguous = true;
                    cell.Diagnostic = "ack_conflicting_decisions";
                    AddDiagnostic(diagnostics, "ack_conflicting_decisions");
                    continue;
                }

                var classified = ObservationAckReasons.Classify(reason);
                if (cell.RejectionSeen)
                {
                    if (cell.RejectionClass != classified.OutcomeReason
                        || !string.Equals(cell.ReasonCode, classified.ReasonCode,
                            StringComparison.Ordinal))
                    {
                        cell.Ambiguous = true;
                        cell.Diagnostic = "ack_conflicting_decisions";
                        AddDiagnostic(diagnostics, "ack_conflicting_decisions");
                    }
                    continue;
                }
                cell.RejectionSeen = true;
                cell.RejectionClass = classified.OutcomeReason;
                cell.ReasonCode = classified.ReasonCode;
                cell.LegacyReasonCode = LegacyReason(reason);
                cell.Diagnostic = classified.ReasonCode;
            }
        }

        private static ObservationAckRowResult BuildRow(ObservationOfferedRow offered, Cell cell,
            ObservationPairingBinding expectedBinding)
        {
            if (offered.Lane == ObservationAckLane.Legacy)
            {
                var legacy = ObservationLegacyAckClass.None;
                if (cell.Ambiguous)
                {
                    // Een tegenstrijdig ACK ruimt ook een legacy-rij niet op.
                    return new ObservationAckRowResult(offered, ObservationAckClass.None,
                        ObservationLegacyAckClass.None, cell.ReasonCode, cell.Diagnostic, null);
                }
                if (cell.DeliverySeen) legacy = ToLegacy(cell.DeliveryKind);
                else if (cell.RejectionSeen) legacy = ObservationLegacyAckClass.Rejected;
                return new ObservationAckRowResult(offered, ObservationAckClass.None, legacy,
                    cell.LegacyReasonCode ?? cell.ReasonCode, cell.Diagnostic,
                    cell.DeliveredRevision);
            }

            if (!ObservationBindingFence.SameBinding(offered.Binding, expectedBinding))
            {
                return new ObservationAckRowResult(offered, ObservationAckClass.NotDelivered,
                    ObservationLegacyAckClass.None, null, "ack_stale_offer_binding", null);
            }
            if (cell.Ambiguous)
            {
                return new ObservationAckRowResult(offered, ObservationAckClass.NotDelivered,
                    ObservationLegacyAckClass.None, null, cell.Diagnostic, cell.DeliveredRevision);
            }
            if (cell.DeliverySeen && cell.RejectionSeen)
            {
                return new ObservationAckRowResult(offered, ObservationAckClass.NotDelivered,
                    ObservationLegacyAckClass.None, null, "ack_conflicting_decisions", null);
            }
            if (cell.DeliverySeen)
            {
                if (!cell.DeliveredRevision.HasValue)
                {
                    return new ObservationAckRowResult(offered, ObservationAckClass.NotDelivered,
                        ObservationLegacyAckClass.None, null, "ack_revision_missing", null);
                }
                var revision = cell.DeliveredRevision.Value;
                if (revision < offered.RecordRevision)
                {
                    return new ObservationAckRowResult(offered, ObservationAckClass.NotDelivered,
                        ObservationLegacyAckClass.None, null, "ack_revision_lower", revision);
                }
                return new ObservationAckRowResult(offered, cell.DeliveryKind,
                    ObservationLegacyAckClass.None, null, null, revision);
            }
            if (cell.RejectionSeen)
            {
                return new ObservationAckRowResult(offered, cell.RejectionClass,
                    ObservationLegacyAckClass.None, cell.ReasonCode, cell.Diagnostic, null);
            }
            return new ObservationAckRowResult(offered, ObservationAckClass.NotDelivered,
                ObservationLegacyAckClass.None, null, "ack_row_not_mentioned", null);
        }

        /// <summary>
        /// De database levert <c>record_revision</c>; de Edge-ACK bouwt
        /// <c>AckId</c> met <c>recordRevision</c> en serialiseert dat veld zo.
        /// Beide echte vormen worden gelezen. Staan ze er samen met een
        /// verschillende of ongeldige waarde, dan is de revisie onbewezen.
        /// </summary>
        private static int? ReadRevision(Dictionary<string, object> record)
        {
            object snakeRaw;
            object camelRaw;
            var hasSnake = record.TryGetValue("record_revision", out snakeRaw) && snakeRaw != null;
            var hasCamel = record.TryGetValue("recordRevision", out camelRaw) && camelRaw != null;
            if (!hasSnake && !hasCamel) return null;

            var snake = 0;
            var camel = 0;
            if (hasSnake && !StrictInteger(snakeRaw, 1, MeasurementContract.MaxRecordRevision,
                    out snake))
            {
                return null;
            }
            if (hasCamel && !StrictInteger(camelRaw, 1, MeasurementContract.MaxRecordRevision,
                    out camel))
            {
                return null;
            }
            if (hasSnake && hasCamel && snake != camel) return null;
            return hasSnake ? snake : camel;
        }

        private static int? ReadIndex(Dictionary<string, object> record)
        {
            object raw;
            if (!record.TryGetValue("index", out raw) || raw == null) return null;
            int index;
            if (!StrictInteger(raw, 0, int.MaxValue, out index)) return null;
            return index;
        }

        private static Dictionary<string, object> Object(Dictionary<string, object> source,
            string key)
        {
            if (source == null) return null;
            object value;
            if (!source.TryGetValue(key, out value)) return null;
            return value as Dictionary<string, object>;
        }

        private static string Text(Dictionary<string, object> source, string key)
        {
            if (source == null) return null;
            object value;
            if (!source.TryGetValue(key, out value)) return null;
            var text = value as string;
            return string.IsNullOrEmpty(text) ? null : text;
        }

        private static bool TryArray(Dictionary<string, object> source, string key,
            out List<object> values)
        {
            values = null;
            if (!source.ContainsKey(key)) { values = new List<object>(); return true; }
            var raw = source[key];
            if (raw == null) { values = new List<object>(); return true; }
            values = raw as List<object>;
            return values != null;
        }

        internal static bool StrictInteger(object raw, int minimum, int maximum, out int value)
        {
            value = 0;
            double number;
            if (raw is double) number = (double)raw;
            else if (raw is int) number = (int)raw;
            else if (raw is long) number = (long)raw;
            else return false;
            if (double.IsNaN(number) || double.IsInfinity(number)) return false;
            if (Math.Floor(number) != number) return false;
            if (number < minimum || number > maximum) return false;
            value = (int)number;
            return true;
        }

        private static void AddDiagnostic(List<string> diagnostics, string code)
        {
            if (diagnostics.Count < 32) diagnostics.Add(code);
        }

        private static void MarkAmbiguous(Cell cell, string diagnostic, List<string> diagnostics)
        {
            cell.Ambiguous = true;
            cell.Diagnostic = diagnostic;
            if (!diagnostics.Contains(diagnostic)) AddDiagnostic(diagnostics, diagnostic);
        }

        /// <summary>
        /// Alleen voor de bestaande legacy-route: de bestaande outbox bewaart en
        /// toont zijn eigen reden. Hij wordt hier niet duurzaam opgeslagen en is
        /// begrensd tot een korte tokenvorm.
        /// </summary>
        private static string LegacyReason(string reason)
        {
            if (string.IsNullOrEmpty(reason)) return "unknown";
            var text = reason.Trim();
            if (text.Length > MaxBlockCodeLength) return "server_rejected_unknown";
            for (var index = 0; index < text.Length; index++)
            {
                var character = text[index];
                var allowed = (character >= 'a' && character <= 'z')
                    || (character >= 'A' && character <= 'Z')
                    || (character >= '0' && character <= '9')
                    || character == '_' || character == ':' || character == '.' || character == '-';
                if (!allowed) return "server_rejected_unknown";
            }
            return text;
        }

        private static ObservationLegacyAckClass ToLegacy(ObservationAckClass kind)
        {
            switch (kind)
            {
                case ObservationAckClass.Accepted: return ObservationLegacyAckClass.Accepted;
                case ObservationAckClass.Duplicate: return ObservationLegacyAckClass.Duplicate;
                case ObservationAckClass.Superseded: return ObservationLegacyAckClass.Superseded;
                default: return ObservationLegacyAckClass.None;
            }
        }

        /// <summary>
        /// Een diagnostische servercode mag nooit onbegrensd of met stuurtekens
        /// in bewijs belanden. Alleen een korte, stabiele tokenvorm blijft over.
        /// </summary>
        internal static string BoundedBlockCode(string raw)
        {
            if (string.IsNullOrEmpty(raw)) return null;
            if (raw.Length > MaxBlockCodeLength) return "ack_blocked";
            for (var index = 0; index < raw.Length; index++)
            {
                var character = raw[index];
                var allowed = (character >= 'a' && character <= 'z')
                    || (character >= '0' && character <= '9') || character == '_';
                if (!allowed) return "ack_blocked";
            }
            return raw;
        }

        private static ObservationAckResolution FailAll(ObservationOfferedBatch batch,
            ObservationPairingBinding expectedBinding, string diagnostic,
            bool hasMeasurements = false, string blockCode = null)
        {
            var rows = new List<ObservationAckRowResult>(batch.Count);
            for (var index = 0; index < batch.Count; index++)
            {
                rows.Add(new ObservationAckRowResult(batch.Rows[index],
                    ObservationAckClass.NotDelivered, ObservationLegacyAckClass.None,
                    null, diagnostic, null));
            }
            return new ObservationAckResolution(batch, expectedBinding, rows,
                hasMeasurements, false, blockCode, diagnostic,
                new List<string>(), new List<string>());
        }

        private sealed class Cell
        {
            public bool DeliverySeen;
            public ObservationAckClass DeliveryKind = ObservationAckClass.None;
            public int? DeliveredRevision;
            public bool RejectionSeen;
            public ObservationAckClass RejectionClass = ObservationAckClass.None;
            public string ReasonCode;
            public string LegacyReasonCode;
            public bool Ambiguous;
            public string Diagnostic;
        }
    }

    /// <summary>
    /// Vaste, lokale classificatie van serverredenen. Geen ruwe servertekst
    /// wordt als reden bewaard; een onbekende code wordt één vaste lokale code.
    /// </summary>
    public static class ObservationAckReasons
    {
        public sealed class Classification
        {
            internal Classification(ObservationAckClass outcome, ObservationLedgerReason reason)
            {
                OutcomeReason = outcome;
                Reason = reason;
            }

            public ObservationAckClass OutcomeReason { get; private set; }
            public ObservationLedgerReason Reason { get; private set; }
            public string ReasonCode
            {
                get
                {
                    return OutcomeReason == ObservationAckClass.Quarantined
                        || OutcomeReason == ObservationAckClass.Deferred
                        ? ObservationLedgerReasons.ToToken(Reason)
                        : null;
                }
            }
        }

        public static Classification Classify(string reason)
        {
            var text = NormalizePath(reason).ToLowerInvariant();

            if (text.IndexOf("contains unknown fields", StringComparison.Ordinal) >= 0)
                return Deferred(ObservationLedgerReason.ContainsUnknownFields);
            if (text == "observation_unavailable" || text == "unavailable"
                || text.IndexOf("is unavailable", StringComparison.Ordinal) >= 0)
                return Deferred(ObservationLedgerReason.ObservationUnavailable);

            if (text.StartsWith("observation is invalid", StringComparison.Ordinal))
            {
                var colon = text.IndexOf(':');
                var code = colon >= 0 ? text.Substring(colon + 1).Trim() : string.Empty;
                if (code.Length == 0) return Quarantine(ObservationLedgerReason.ObservationInvalid);
                return Quarantine(MapPermanent(code));
            }

            return Quarantine(MapPermanent(text));
        }

        private static Classification Deferred(ObservationLedgerReason reason)
        {
            return new Classification(ObservationAckClass.Deferred, reason);
        }

        private static Classification Quarantine(ObservationLedgerReason reason)
        {
            return new Classification(ObservationAckClass.Quarantined, reason);
        }

        private static ObservationLedgerReason MapPermanent(string code)
        {
            switch (code)
            {
                case "observation_device_mismatch": return ObservationLedgerReason.ObservationDeviceMismatch;
                case "observation_device_invalid": return ObservationLedgerReason.ObservationDeviceInvalid;
                case "auth_device_invalid": return ObservationLedgerReason.AuthDeviceInvalid;
                case "observation_null": return ObservationLedgerReason.ObservationNull;
                case "observation_invalid": return ObservationLedgerReason.ObservationInvalid;
                case "row_invalid": return ObservationLedgerReason.RowInvalid;
                case "revision_conflict": return ObservationLedgerReason.RevisionConflict;
                case "stale_revision": return ObservationLedgerReason.StaleRevision;
                case "observation_absent": return ObservationLedgerReason.ObservationAbsent;
                case "observation_invalid_version": return ObservationLedgerReason.ObservationInvalidVersion;
                case "observation_invalid_type": return ObservationLedgerReason.ObservationInvalidType;
                case "observation_invalid_integer": return ObservationLedgerReason.ObservationInvalidInteger;
                case "observation_invalid_number": return ObservationLedgerReason.ObservationInvalidNumber;
                case "observation_invalid_timestamp": return ObservationLedgerReason.ObservationInvalidTimestamp;
                case "observation_invalid_uuid": return ObservationLedgerReason.ObservationInvalidUuid;
                case "observation_invalid_text": return ObservationLedgerReason.ObservationInvalidText;
                case "observation_invalid_control": return ObservationLedgerReason.ObservationInvalidControl;
                case "observation_invalid_enum": return ObservationLedgerReason.ObservationInvalidEnum;
                default: return ObservationLedgerReason.ServerRejectedUnknown;
            }
        }

        /// <summary>
        /// Strip het echte Edge-pad <c>payload.lapSummaries[i].</c> of
        /// <c>lapSummaries[i].</c>. Alleen daarna wordt op de stabiele suffix
        /// geclassificeerd.
        /// </summary>
        internal static string NormalizePath(string reason)
        {
            if (reason == null) return string.Empty;
            var text = reason.Trim();
            var offset = 0;
            if (text.StartsWith("payload.", StringComparison.OrdinalIgnoreCase)) offset = 8;
            const string marker = "lapSummaries[";
            if (text.Length - offset <= marker.Length
                || string.Compare(text, offset, marker, 0, marker.Length,
                    StringComparison.OrdinalIgnoreCase) != 0)
            {
                return text;
            }
            var close = text.IndexOf(']', offset + marker.Length);
            if (close < 0) return text;
            var next = close + 1;
            if (next < text.Length && text[next] == '.') next++;
            return text.Substring(next).Trim();
        }
    }

    /// <summary>Wat de duurzame ledger met één geclassificeerde rij heeft gedaan.</summary>
    public enum ObservationAckDurableOutcome
    {
        NotDelivered = 0,
        DeliveredRemoved = 1,
        DeferredPersisted = 2,
        QuarantinedPersisted = 3,
        QuarantineTerminal = 4,
        UnknownUid = 5,
        IdentityConflict = 6,
        StaleEpoch = 7,
        NotPersisted = 8,
        Uncertain = 9
    }

    public enum ObservationAckApplyStatus
    {
        Applied = 0,
        NoChanges = 1,
        RefusedStaleEpoch = 2,
        RefusedCounterOverflow = 3,
        RefusedStoreFailedClosed = 4,
        RefusedQuota = 5,
        NotCommitted = 6,
        Uncertain = 7,
        RefusedInvalid = 8
    }

    public sealed class ObservationAckApplyRowResult
    {
        internal ObservationAckApplyRowResult(ObservationAckRowResult row,
            ObservationAckDurableOutcome durable, string diagnostic)
        {
            Row = row;
            Durable = durable;
            Diagnostic = diagnostic;
        }

        public ObservationAckRowResult Row { get; private set; }
        public string Uid { get { return Row.Uid; } }
        public int RecordRevision { get { return Row.RecordRevision; } }
        public ObservationAckLane Lane { get { return Row.Lane; } }
        public ObservationAckClass Outcome { get { return Row.Outcome; } }
        public ObservationLegacyAckClass LegacyOutcome { get { return Row.LegacyOutcome; } }
        public string ReasonCode { get { return Row.ReasonCode; } }
        public ObservationAckDurableOutcome Durable { get; private set; }
        public string Diagnostic { get; private set; }
        public bool DeliveredRemoved { get { return Durable == ObservationAckDurableOutcome.DeliveredRemoved; } }
    }

    /// <summary>
    /// Uitkomst van de atomaire ACK-toepassing. <see cref="Stored"/> is nooit
    /// afgeleid uit een lege wachtrij: hij waar is alleen als élke aangeboden
    /// observatierij in deze commit daadwerkelijk is verwijderd.
    /// </summary>
    public sealed class ObservationAckApplyResult
    {
        private readonly ReadOnlyCollection<ObservationAckApplyRowResult> _rows;

        internal ObservationAckApplyResult(ObservationAckApplyStatus status,
            IList<ObservationAckApplyRowResult> rows, int deliveredCount, int deferredCount,
            int quarantinedCount, int unknownUidCount, bool stored, string diagnostic,
            long actualBytes, long reservedBytes, int entryCount, int deliveredTotal,
            int quarantineTotal, string blockErrorCode)
        {
            Status = status;
            _rows = new ReadOnlyCollection<ObservationAckApplyRowResult>(
                new List<ObservationAckApplyRowResult>(rows));
            DeliveredCount = deliveredCount;
            DeferredCount = deferredCount;
            QuarantinedCount = quarantinedCount;
            UnknownUidCount = unknownUidCount;
            Stored = stored;
            Diagnostic = diagnostic;
            ActualBytes = actualBytes;
            ReservedBytes = reservedBytes;
            EntryCount = entryCount;
            DeliveredTotal = deliveredTotal;
            QuarantineTotal = quarantineTotal;
            BlockErrorCode = blockErrorCode;
        }

        public ObservationAckApplyStatus Status { get; private set; }
        public bool Committed { get { return Status == ObservationAckApplyStatus.Applied; } }
        public IList<ObservationAckApplyRowResult> Rows { get { return _rows; } }
        public int DeliveredCount { get; private set; }
        public int DeferredCount { get; private set; }
        public int QuarantinedCount { get; private set; }
        public int UnknownUidCount { get; private set; }
        public bool Stored { get; private set; }
        public string Diagnostic { get; private set; }
        public long ActualBytes { get; private set; }
        public long ReservedBytes { get; private set; }
        public int EntryCount { get; private set; }
        public int DeliveredTotal { get; private set; }
        public int QuarantineTotal { get; private set; }
        public string BlockErrorCode { get; private set; }
    }
}
