using System;
using System.Collections.Generic;

namespace ThreeSM.EnduranceConnector
{
    /// <summary>Wat de meetlaag op dit moment doet, voor de statusregel in SimHub.</summary>
    public sealed class MeasurementPipelineStatus
    {
        public string SegmentId { get; set; }
        public string ObservedSessionId { get; set; }
        public long AcceptedSamples { get; set; }
        public long DuplicateSamples { get; set; }
        public long ThrottledSamples { get; set; }
        public int QueuedEvents { get; set; }
        public int QueuedLaps { get; set; }
        public int DroppedEvents { get; set; }
        public int DroppedLaps { get; set; }
        public string LastEnqueueProblem { get; set; }
        public string LastAnchorKind { get; set; }
        public int PitVisits { get; set; }
        public int CompletedLaps { get; set; }

        public string Summary
        {
            get
            {
                return "samples=" + AcceptedSamples + " dubbel=" + DuplicateSamples + " begrensd=" + ThrottledSamples
                    + " wachtrij=" + QueuedEvents + "e/" + QueuedLaps + "l"
                    + " verloren=" + (DroppedEvents + DroppedLaps) + " pit=" + PitVisits + " rondes=" + CompletedLaps
                    + (string.IsNullOrEmpty(LastEnqueueProblem) ? "" : " | " + LastEnqueueProblem);
            }
        }
    }

    /// <summary>
    /// De bedrading van de meetlaag. Deze klasse is de enige plek die weet in welke
    /// volgorde sampler, pitdetectie, ankerdetectie en outbox samenwerken, en hoe een
    /// pitbezoek aan een ronde wordt toegeschreven.
    ///
    /// Waarom apart en niet in de plugin: de plugin heeft SimHub nodig, deze klasse niet.
    /// Zo is de hele keten — inclusief sessiewissel zonder procesherstart en tanken op de
    /// finishlijn — te testen zonder sim.
    ///
    /// De plugin hoeft per tick maar één ding te doen: <see cref="Observe"/> met een
    /// <see cref="TelemetrySample"/>. Of dat lukt hangt niet af van HTTP of pairing; dat
    /// is de eis uit de brief (Fase 3: netwerkvertraging verandert de meetuitkomst niet).
    /// </summary>
    public sealed class MeasurementPipeline
    {
        private readonly MeasurementOutbox _outbox;
        private readonly MeasurementIdFactory _ids;
        private readonly TelemetrySampler _sampler;
        private PitServiceTracker _pits;
        private TyreAnchorTracker _anchors;
        private string _segmentId;
        private string _observedSessionId;
        private string _lastEnqueueProblem;
        private string _lastAnchorKind;
        private int _completedLaps;

        public MeasurementPipeline(MeasurementOutbox outbox, MeasurementIdFactory ids)
            : this(outbox, ids, new SamplerOptions()) { }

        public MeasurementPipeline(MeasurementOutbox outbox, MeasurementIdFactory ids, SamplerOptions samplerOptions)
        {
            if (outbox == null) throw new ArgumentNullException("outbox");
            if (ids == null) throw new ArgumentNullException("ids");
            _outbox = outbox;
            _ids = ids;
            _sampler = new TelemetrySampler(samplerOptions);
        }

        public TelemetrySampler Sampler { get { return _sampler; } }
        public PitServiceTracker Pits { get { return _pits; } }
        public TyreAnchorTracker Anchors { get { return _anchors; } }
        public string SegmentId { get { return _segmentId; } }
        public string ObservedSessionId { get { return _observedSessionId; } }

        /// <summary>
        /// Begint een sessie. Een lopende sessie wordt eerst afgesloten, zodat een
        /// sessiewissel binnen dezelfde iRacing-run geen twee sessies door elkaar mengt.
        /// </summary>
        public void BeginSession(string observedSessionId)
        {
            if (_segmentId != null) End("session_changed");
            _segmentId = _ids.NewSegmentId();
            _observedSessionId = MeasurementIds.SanitizeObservedSessionId(observedSessionId);
            _pits = new PitServiceTracker(_segmentId);
            _anchors = new TyreAnchorTracker(_ids, _segmentId);
            _sampler.BeginSession(_segmentId, _observedSessionId);
        }

        /// <summary>Eén tick uit de SDK. Geen netwerk, geen pairing, geen verzendinterval.</summary>
        public void Observe(TelemetrySample sample)
        {
            if (sample == null || sample.ObservedAtUtc == default(DateTime)) return;
            EnsureSession(sample);

            _sampler.Offer(sample);
            var closed = _sampler.Drain();

            _pits.Update(sample);
            var visits = _pits.DrainCompleted();

            // Een bezoek is vanaf de intrede bekend. De lopende ronde krijgt het ID meteen,
            // zodat een bezoek dat over de finishlijn loopt niet alleen bij de ronde van
            // vertrek hoort. De brandstofdelta volgt pas bij het uittik.
            var openVisit = _pits.Current;
            var openLap = _sampler.Current;
            if (openVisit != null && openLap != null) openLap.NotePitVisit(openVisit.PitVisitId, null);

            var lastVisit = visits.Count > 0 ? visits[visits.Count - 1] : null;
            var serviceCompleted = lastVisit != null
                && lastVisit.Intent.PitServiceFlagsRaw.HasValue
                && lastVisit.Intent.PitServiceFlagsRaw.Value != 0;
            var pitVisitId = lastVisit != null
                ? lastVisit.PitVisitId
                : (_pits.Current != null ? _pits.Current.PitVisitId : null);

            _anchors.Observe(sample, pitVisitId, serviceCompleted);
            foreach (var anchor in _anchors.Drain())
            {
                string reason;
                if (!_outbox.Enqueue(anchor.Record, out reason)) _lastEnqueueProblem = "event_not_queued:" + reason;
                _lastAnchorKind = anchor.Kind;
                var current = _sampler.Current;
                if (current != null) current.NoteWearObservation(anchor.AnchorId);
            }

            AttributeVisits(visits, closed);

            foreach (var aggregate in closed) EnqueueSummary(aggregate);
        }

        /// <summary>
        /// Sluit de sessie af: open pitbezoek, lopende ronde en de laatste ankers gaan
        /// er met een expliciete reden uit. Niets blijft ongemerkt hangen.
        /// </summary>
        public IList<LapAggregate> End(string reason)
        {
            var code = string.IsNullOrEmpty(reason) ? "session_end" : reason;
            var visits = _pits == null ? new PitVisit[0] : _pits.Close(code);
            AttributeVisits(visits, new LapAggregate[0]);

            foreach (var anchor in _anchors == null ? new TyreAnchor[0] : _anchors.Drain())
            {
                string problem;
                if (!_outbox.Enqueue(anchor.Record, out problem)) _lastEnqueueProblem = "event_not_queued:" + problem;
                var current = _sampler.Current;
                if (current != null) current.NoteWearObservation(anchor.AnchorId);
            }

            var closed = _sampler.Close(code);
            foreach (var aggregate in closed) EnqueueSummary(aggregate);
            return closed;
        }

        public MeasurementPipelineStatus Status()
        {
            return new MeasurementPipelineStatus
            {
                SegmentId = _segmentId,
                ObservedSessionId = _observedSessionId,
                AcceptedSamples = _sampler.AcceptedCount,
                DuplicateSamples = _sampler.DuplicateTickCount,
                ThrottledSamples = _sampler.ThrottledCount,
                QueuedEvents = _outbox.EventCount,
                QueuedLaps = _outbox.LapCount,
                DroppedEvents = _outbox.DroppedEvents,
                DroppedLaps = _outbox.DroppedLaps,
                LastEnqueueProblem = _lastEnqueueProblem,
                LastAnchorKind = _lastAnchorKind,
                PitVisits = _pits == null ? 0 : _pits.VisitCount,
                CompletedLaps = _completedLaps
            };
        }

        private void EnsureSession(TelemetrySample sample)
        {
            if (_segmentId == null)
            {
                BeginSession(sample.ObservedSessionId);
            }
            else if (!string.IsNullOrEmpty(sample.ObservedSessionId)
                && !string.IsNullOrEmpty(_observedSessionId)
                && !string.Equals(sample.ObservedSessionId, _observedSessionId, StringComparison.Ordinal))
            {
                BeginSession(sample.ObservedSessionId);
            }
            sample.SegmentId = _segmentId;
            sample.ObservedSessionId = _observedSessionId;
        }

        /// <summary>
        /// Wijs elk afgerond pitbezoek toe aan de ronde(n) die het raakt. De brandstof-
        /// delta gaat naar de ronde waarin hij is waargenomen (het uittik), ook als het
        /// bezoek op de vorige ronde begon: tanken op de finishlijn is één meting, geen
        /// twee.
        /// </summary>
        private void AttributeVisits(IList<PitVisit> visits, IList<LapAggregate> closed)
        {
            if (visits == null || visits.Count == 0) return;
            foreach (var visit in visits)
            {
                var completionLap = visit.ExitLap ?? visit.EnterLap;
                var fuel = visit.Result.FuelAddedLitresObserved;
                if (closed != null)
                {
                    foreach (var aggregate in closed)
                    {
                        if (!Touches(aggregate.LapNumber, visit)) continue;
                        aggregate.NotePitVisit(visit.PitVisitId, aggregate.LapNumber == completionLap ? fuel : null);
                    }
                }
                var current = _sampler.Current;
                if (current != null && Touches(current.LapNumber, visit))
                {
                    current.NotePitVisit(visit.PitVisitId, current.LapNumber == completionLap ? fuel : null);
                }
            }
        }

        private static bool Touches(int lapNumber, PitVisit visit)
        {
            if (!visit.EnterLap.HasValue && !visit.ExitLap.HasValue) return false;
            if (visit.EnterLap.HasValue && visit.ExitLap.HasValue)
            {
                var low = Math.Min(visit.EnterLap.Value, visit.ExitLap.Value);
                var high = Math.Max(visit.EnterLap.Value, visit.ExitLap.Value);
                return lapNumber >= low && lapNumber <= high;
            }
            return lapNumber == (visit.EnterLap ?? visit.ExitLap).Value;
        }

        private void EnqueueSummary(LapAggregate aggregate)
        {
            if (aggregate == null) return;
            var record = aggregate.ToSummary(_ids.NewSummaryUid(), _ids.NextSummaryLabel(aggregate.LapNumber), _observedSessionId);
            string reason;
            if (!_outbox.EnqueueLap(record, out reason)) _lastEnqueueProblem = "lap_not_queued:" + reason;
            _completedLaps++;
        }
    }
}
