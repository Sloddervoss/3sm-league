using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;

namespace ThreeSM.EnduranceConnector
{
    /// <summary>One memory-only authorization snapshot. Driver identity is never an account.</summary>
    public sealed class ObservationProducerIdentity
    {
        public ObservationProducerIdentity(string token, ObservationPairingBinding binding)
        {
            Token = token;
            Binding = binding ?? new ObservationPairingBinding(null, null, 0, false);
        }
        internal string Token { get; private set; }
        public ObservationPairingBinding Binding { get; private set; }
        public bool HasAuthorization { get { return !string.IsNullOrWhiteSpace(Token)
            && ObservationRules.IsUuid(Binding.CaptureDeviceId) && ObservationRules.IsUuid(Binding.CaptureOwnerUserId); } }
    }

    /// <summary>
    /// SDK-free producer owner used by the plugin, not a second sampling/send implementation.
    /// One coordinator, fence and lazy real store survive runtime kill/readiness changes.
    /// No storage is obtained by construction, pairing, disabled capture/send or disposal.
    /// </summary>
    public sealed class ObservationProducerHost : IDisposable
    {
        private readonly object _gate = new object();
        private readonly Func<bool> _optIn;
        private readonly Func<bool> _receiverReady;
        private readonly ObservationReadinessCache _readiness;
        private readonly Func<DateTime> _clock;
        private readonly MeasurementIdFactory _ids;
        private readonly SamplerOptions _samplerOptions = new SamplerOptions();
        private readonly CancellationTokenSource _shutdown = new CancellationTokenSource();
        private readonly HashSet<Task> _owned = new HashSet<Task>();
        private readonly TaskCompletionSource<bool> _settled = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        private ObservationProducerIdentity _identity;
        private ObservationLedgerCandidate _pending;
        private bool _captureBlocked;
        private bool _intakeStopped;
        private bool _ended;
        private bool _transitioning;
        private int _operations;

        public ObservationProducerHost(MeasurementOutbox legacy, MeasurementIdFactory ids,
            ObservationProducerIdentity identity, Func<bool> optIn, Func<bool> receiverReady,
            Func<ObservationBindingFence, ObservationLedgerStore> storeProvider,
            IObservationSendTransport transport, Func<string> capabilities, MeasurementLimits limits,
            Func<DateTime> clock, ObservationSendOptions bounds = null,
            ObservationReadinessCache readiness = null)
        {
            if (storeProvider == null) throw new ArgumentNullException("storeProvider");
            _ids = ids ?? throw new ArgumentNullException("ids");
            _identity = identity ?? new ObservationProducerIdentity(null, null);
            _optIn = optIn ?? delegate { return false; };
            _receiverReady = receiverReady ?? delegate { return false; };
            _readiness = readiness;
            _clock = clock ?? delegate { return DateTime.UtcNow; };
            var fence = new ObservationBindingFence(_identity.Binding);
            var options = (bounds ?? new ObservationSendOptions()).Normalized();
            // Immutable coordinator capability, NOT runtime activation. Host gates every operation.
            options.Enabled = true;
            Coordinator = ObservationSendCoordinator.CreateLazy(fence, () => storeProvider(fence),
                legacy, new OwnedTransport(this, transport), () => CurrentToken(), capabilities, options, limits);
            Pipeline = new MeasurementPipeline(legacy, ids, _samplerOptions, CaptureSummary);
            // Constructor-time identity is the first trusted binding; it arms nothing.
            PublishReadinessIdentity(ObservationReadinessReasons.IdentityChanged);
        }

        internal ObservationSendCoordinator Coordinator { get; private set; }
        public MeasurementPipeline Pipeline { get; private set; }
        public string LastCaptureDiagnostic { get; private set; }
        public Task Settlement { get { return _settled.Task; } }
        public ObservationLedgerCandidate PendingCandidate { get { lock (_gate) return _pending; } }
        public ObservationProducerIdentity Snapshot() { lock (_gate) return _identity; }
        private string CurrentToken() { lock (_gate) return _identity.Token; }

        private bool Eligible()
        {
            return !_ended && !_transitioning && _identity.HasAuthorization
                && _identity.Binding.IsComplete && _optIn() && ReceiverReady();
        }

        /// <summary>
        /// Binding-aware readiness predicate. Called with the host gate held; the
        /// cache lock is always taken below it (host gate -> cache), never above.
        /// Without an injected cache the historical provider stays authoritative.
        /// </summary>
        private bool ReceiverReady()
        {
            var cache = _readiness;
            if (cache == null) return _receiverReady();
            var identity = _identity;
            if (identity == null || !identity.HasAuthorization
                || identity.Binding == null || !identity.Binding.IsComplete) return false;
            try { return cache.IsReadyFor(identity.Binding, true); }
            catch (Exception) { return false; }
        }

        private void PublishReadinessIdentity(string reasonCode)
        {
            var cache = _readiness;
            if (cache == null) return;
            var identity = _identity;
            try
            {
                if (identity == null) cache.SetCurrentIdentity(null, false, reasonCode);
                else cache.SetCurrentIdentity(identity.Binding, identity.HasAuthorization, reasonCode);
            }
            catch (Exception)
            {
                // Readiness is an observer of the producer: it never alters it.
            }
        }

        private void InvalidateReadinessLifetime(string reasonCode)
        {
            var cache = _readiness;
            if (cache == null) return;
            try { cache.InvalidateLifetime(reasonCode); }
            catch (Exception) { }
        }

        // Only the fresh UTC once-per-tick caller is supported. No owner/context backfill.
        public void BindSample(TelemetrySample sample, ObservationLapContext sameTickContext)
        {
            if (sample == null) return;
            lock (_gate)
            {
                sample.ObservationPairingBinding = Eligible() ? _identity.Binding : null;
                sample.ObservationLapContext = sameTickContext;
            }
        }

        public void Observe(Func<TelemetrySample> freshSample)
        {
            lock (_gate)
            {
                if (_intakeStopped || _ended) return;
                Observe(freshSample()); // same tick construction/binding/offer under one short gate
            }
        }

        public void Observe(TelemetrySample sample)
        {
            lock (_gate)
            {
                if (_intakeStopped || _ended) return;
                _samplerOptions.ObservationCaptureEnabled = Eligible();
                RetryPending();
                Pipeline.Observe(sample);
            }
        }

        public void EndSession(string reason)
        {
            lock (_gate)
            {
                if (_ended) return;
                RetryPending();
                Pipeline.End(reason);
            }
        }

        // true consumes this aggregate without a v1 row; false asks the pipeline to
        // create a FRESH legacy summary from its source aggregate/normal ID factory.
        private bool CaptureSummary(LapAggregate aggregate)
        {
            if (!Eligible()) return false;
            if (aggregate.ObservationResult == null || !aggregate.ObservationResult.HasObservation) return false;
            if (_pending != null || _captureBlocked)
            {
                LastCaptureDiagnostic = "capture_closed_unresolved";
                return true; // no unbounded queue and no uncertain observation downgrade
            }
            var row = aggregate.ToObservationSummary(_ids.NewSummaryUid(), _ids.NextSummaryLabel(aggregate.LapNumber));
            string diagnostic;
            var candidate = ObservationLedgerCandidate.TryCreate(row, aggregate.ObservationPairingBinding, _clock(), out diagnostic);
            if (candidate == null)
            {
                LastCaptureDiagnostic = diagnostic;
                return false; // pre-candidate, provably unpublished; pipeline generates a new legacy UID
            }
            _pending = candidate;
            ObservationLedgerCaptureResult result;
            if (!Coordinator.TryCapture(candidate, out result, Eligible))
            {
                LastCaptureDiagnostic = "capture_waiting_for_lease_or_store";
                return true;
            }
            return ApplyCapture(result);
        }

        private bool ApplyCapture(ObservationLedgerCaptureResult result)
        {
            LastCaptureDiagnostic = result.Status.ToString(); // bounded category, never raw IO/credential text
            if (result.Captured)
            {
                _pending = null;
                return true;
            }
            // Only definitive nonpublication releases the provisional candidate. Never
            // strip its observation or reuse its UID/revision for the legacy fallback.
            if (result.Status == ObservationLedgerCaptureStatus.RefusedQuota
                || result.Status == ObservationLedgerCaptureStatus.RefusedBindingChanged)
            {
                _pending = null;
                return false;
            }
            if (result.Status != ObservationLedgerCaptureStatus.NotCommitted)
                _captureBlocked = true;
            return true;
        }

        private void RetryPending()
        {
            if (_pending == null || !Eligible() || _captureBlocked) return;
            ObservationLedgerCaptureResult result;
            if (Coordinator.TryCapture(_pending, out result, Eligible))
            {
                // This exact candidate already belongs to the OBS lane. A later refusal
                // has no retained source aggregate and cannot generate a legacy row.
                if (!ApplyCapture(result) && _pending == null)
                    LastCaptureDiagnostic = "pending_definitively_refused_no_legacy_copy";
            }
        }

        public async Task<ObservationPairTransitionResult> TransitionAsync(
            Func<CancellationToken, Task<ObservationProducerIdentity>> commit, CancellationToken cancel)
        {
            if (commit == null) throw new ArgumentNullException("commit");
            lock (_gate) { if (_ended) throw new ObjectDisposedException("ObservationProducerHost"); _operations++; }
            try
            {
                using (var linked = CancellationTokenSource.CreateLinkedTokenSource(cancel, _shutdown.Token))
                {
                    return await Coordinator.TransitionAsync(token =>
                    {
                        lock (_gate)
                        {
                            _transitioning = true;
                            // Unknown remote outcome/local rollback never restores old auth.
                            _identity = new ObservationProducerIdentity(null, null);
                            // Pair/Unpair invalidates readiness before any next HTTP.
                            PublishReadinessIdentity(ObservationReadinessReasons.IdentityChanged);
                        }
                        var callback = Task.Run(() => CommitIdentityAsync(commit, token));
                        Own(callback);
                        return callback;
                    }, linked.Token).ConfigureAwait(false);
                }
            }
            finally { lock (_gate) { _operations--; CompleteSettlement(); } }
        }

        private async Task<ObservationPairCommit> CommitIdentityAsync(
            Func<CancellationToken, Task<ObservationProducerIdentity>> commit, CancellationToken cancel)
        {
            try
            {
                var identity = await commit(cancel).ConfigureAwait(false);
                if (identity == null) return ObservationPairCommit.Failed("identity_unproven");
                lock (_gate)
                {
                    _identity = identity;
                    PublishReadinessIdentity(ObservationReadinessReasons.IdentityChanged);
                }
                return ObservationPairCommit.CommittedWith(identity.Binding);
            }
            finally { lock (_gate) _transitioning = false; }
        }

        /// <summary>One mixed attempt or one old branch, never a second POST after transport
        /// invocation. The legacy callback must synchronously invoke HTTP before its first
        /// await (the plugin's old branch does); snapshot validation and invocation are atomic
        /// relative to the first pairing callback side effect.</summary>
        public async Task<ObservationSendAttemptResult> SendAsync(Func<string> buildCore, Uri endpoint,
            ObservationProducerIdentity expected, DateTime nowUtc, Func<string, string> finalizeBody,
            Func<Task> legacySend, CancellationToken cancel)
        {
            lock (_gate) { if (_ended) return null; _operations++; }
            try
            {
                bool mixed;
                lock (_gate)
                {
                    if (!CanSend(expected)) return null;
                    mixed = Eligible();
                }
                ObservationSendAttemptResult result = null;
                if (mixed)
                {
                    result = await Coordinator.SendOnceAsync(buildCore(), endpoint, nowUtc, cancel,
                        () => { lock (_gate) return CanSend(expected) && Eligible(); }, finalizeBody).ConfigureAwait(false);
                    if (!result.SafeToBypass && result.Status != ObservationSendStatus.LeaseTimeout) return result;
                }
                Task send;
                lock (_gate)
                {
                    if (!CanSend(expected) || cancel.IsCancellationRequested) return result;
                    // No await under this Monitor. Pair's first callback must take this same
                    // short gate before any HTTP/DPAPI/save/clear. An old frame can launch
                    // before that boundary, never under a newer token/account afterwards.
                    send = legacySend();
                    Own(send);
                }
                await send.ConfigureAwait(false);
                return null; // old branch owns ACK/attempt/diagnostics
            }
            finally { lock (_gate) { _operations--; CompleteSettlement(); } }
        }

        private bool CanSend(ObservationProducerIdentity expected)
        {
            return !_ended && !_transitioning && expected != null && expected.HasAuthorization
                && object.ReferenceEquals(expected, _identity);
        }

        private void Own(Task task)
        {
            if (task == null) return;
            lock (_gate) _owned.Add(task);
            task.ContinueWith(completed =>
            {
                var ignored = completed.Exception;
                lock (_gate) { _owned.Remove(task); CompleteSettlement(); }
            }, CancellationToken.None, TaskContinuationOptions.ExecuteSynchronously, TaskScheduler.Default);
        }

        public void Stop()
        {
            lock (_gate)
            {
                if (_ended) return;
                _intakeStopped = true;
                // Stop/End invalidates readiness by lifetime before any next HTTP.
                InvalidateReadinessLifetime(ObservationReadinessReasons.HostStopped);
                Pipeline.End("plugin_stop"); // same post-pit sink, BEFORE closing capture
                _operations++; // Stop itself owns the source through cancellation/disposal.
                _ended = true;
                Own(Coordinator.Settlement);
            }
            try { _shutdown.Cancel(); }
            catch (AggregateException) { /* bounded cancellation outcome; no raw callback text */ }
            finally
            {
                Coordinator.Dispose(); // accepted coordinator retains late callback ownership
                lock (_gate) { _operations--; CompleteSettlement(); }
            }
        }

        private void CompleteSettlement()
        {
            if (_ended && _operations == 0 && _owned.Count == 0 && _settled.TrySetResult(true))
                _shutdown.Dispose();
        }

        public void Dispose() { Stop(); }

        private sealed class OwnedTransport : IObservationSendTransport
        {
            private readonly ObservationProducerHost _host;
            private readonly IObservationSendTransport _inner;
            public OwnedTransport(ObservationProducerHost host, IObservationSendTransport inner)
            { _host = host; _inner = inner ?? throw new ArgumentNullException("transport"); }
            public Task<ObservationTransportResponse> SendAsync(SendEnvelope envelope, Func<bool> guard, CancellationToken cancel)
            {
                var task = _inner.SendAsync(envelope, guard, cancel);
                _host.Own(task);
                return task;
            }
        }
    }
}
