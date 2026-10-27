using System;
using System.Collections.Generic;
using System.IO;
using System.IO.MemoryMappedFiles;
using System.Text;

namespace ThreeSM.EnduranceConnector
{
    /// <summary>
    /// Eén variabele uit de iRacing-varHeader-tabel. Publiek zodat de tests (die dit bestand
    /// meelinken) de parse kunnen controleren zonder de shared memory te openen.
    /// </summary>
    public struct IrSdkVariable
    {
        public int Type;
        public int Offset;
        public int Count;
        public bool CountAsTime;
        public string Name;
        public string Unit;
    }

    /// <summary>
    /// Eén leessnapshot van de iRacing-shared-memory, puur op bytes.
    ///
    /// Waarom een snapshot en geen losse reads: de sim roteert zijn databuffers. Header,
    /// varHeaders en waarden uit één kopie geeft één samenhangend beeld in plaats van drie
    /// lezingen op drie momenten. De kopie is ~116 kB en gebeurt op het verzend-/research-
    /// ritme (1 Hz), dus de kosten zijn verwaarloosbaar.
    ///
    /// Layout is die van irsdk_defines.h: header 104 bytes (10 × int32 + 4 × varBuf van
    /// 16 bytes), varHeader 144 bytes (type/offset/count/countAsTime + name[32] +
    /// desc[64] + unit[32]). Alles little-endian; dat is de enige architectuur waarop
    /// iRacing draait.
    ///
    /// Geen enkele fout gooit: onleesbaar of niet-verbonden betekent <c>null</c> per waarde
    /// en <see cref="Connected"/> = false.
    /// </summary>
    public sealed class IrSdkImage
    {
        public const int HeaderSize = 104;
        public const int VariableHeaderSize = 144;
        /// <summary>Minimaal leesbare header: 10 int32 + varBuf[0] (tickCount + bufOffset).</summary>
        public const int MinimumHeaderBytes = 56;

        public const int StatusConnected = 1;

        public const int TypeChar = 0;
        public const int TypeBool = 1;
        public const int TypeInt = 2;
        public const int TypeBitField = 3;
        public const int TypeFloat = 4;
        public const int TypeDouble = 5;

        private const int NameOffset = 16;
        private const int NameLength = 32;
        private const int UnitOffset = 112;
        private const int MaxVariables = 4096;
        private const int MaxBuffers = 4;

        private readonly byte[] _image;
        private readonly int _length;
        private readonly Dictionary<string, IrSdkVariable> _variables;
        private readonly int _dataOffset;
        private readonly int _dataLength;

        private IrSdkImage(byte[] image, int length, int headerVersion, int status, int tickRate,
            int tickCount, int dataOffset, int dataLength, Dictionary<string, IrSdkVariable> variables)
        {
            _image = image;
            _length = length;
            _variables = variables;
            _dataOffset = dataOffset;
            _dataLength = dataLength;
            HeaderVersion = headerVersion;
            Status = status;
            TickRate = tickRate;
            TickCount = tickCount;
            Connected = (status & StatusConnected) != 0 && tickRate > 0;
        }

        public bool Connected { get; private set; }
        public int HeaderVersion { get; private set; }
        public int Status { get; private set; }
        public int TickRate { get; private set; }
        public int TickCount { get; private set; }
        public int VariableCount { get { return _variables == null ? 0 : _variables.Count; } }

        /// <summary>
        /// Parseert een volledige kopie van de map. Null betekent: geen geldige iRacing-header
        /// (lege map, verkeerde versie, offsets buiten de kopie). Dat is een foutpad, geen meting.
        /// </summary>
        public static IrSdkImage Parse(byte[] image, int length)
        {
            if (image == null) return null;
            if (length <= 0 || length > image.Length) return null;
            if (length < MinimumHeaderBytes) return null;

            var headerVersion = ReadInt32(image, length, 0);
            // iRacing publiceert versie 1..3; alles daarbuiten is geen iRacing-header.
            if (headerVersion < 1 || headerVersion > 16) return null;
            var status = ReadInt32(image, length, 4);
            var tickRate = ReadInt32(image, length, 8);
            if (tickRate < 0 || tickRate > 1000) return null;
            var numVars = ReadInt32(image, length, 24);
            var varHeaderOffset = ReadInt32(image, length, 28);
            var numBuf = ReadInt32(image, length, 32);
            var bufLen = ReadInt32(image, length, 36);
            if (numVars < 0 || numVars > MaxVariables) return null;
            if (numBuf < 1 || numBuf > MaxBuffers) return null;
            if (bufLen <= 0 || bufLen > 8 * 1024 * 1024) return null;

            if (numVars > 0)
            {
                if (varHeaderOffset < HeaderSize) return null;
                if ((long)varHeaderOffset + (long)numVars * VariableHeaderSize > length) return null;
            }

            // varBuf[0] is de buffer die de sim voor lezers klaarzet; tickCount dient alleen
            // als bewijs dat er een frame is.
            var tickCount = ReadInt32(image, length, 48);
            var bufOffset = ReadInt32(image, length, 52);
            if (bufOffset < 0 || (long)bufOffset + bufLen > length) return null;

            var variables = new Dictionary<string, IrSdkVariable>(numVars, StringComparer.Ordinal);
            for (var index = 0; index < numVars; index++)
            {
                var baseOffset = varHeaderOffset + index * VariableHeaderSize;
                var name = ReadCString(image, baseOffset + NameOffset, NameLength, length);
                if (name == null) continue; // lege/onleesbare naam: overslaan, niet gokken
                var variable = new IrSdkVariable
                {
                    Type = ReadInt32(image, length, baseOffset),
                    Offset = ReadInt32(image, length, baseOffset + 4),
                    Count = ReadInt32(image, length, baseOffset + 8),
                    CountAsTime = image[baseOffset + 12] != 0,
                    Name = name,
                    Unit = ReadCString(image, baseOffset + UnitOffset, NameLength, length),
                };
                if (variable.Offset < 0 || variable.Count <= 0) continue;
                variables[name] = variable; // laatste wint: een dubbele naam is geen crash
            }

            return new IrSdkImage(image, length, headerVersion, status, tickRate, tickCount, bufOffset, bufLen, variables);
        }

        public bool HasVariable(string name)
        {
            return !string.IsNullOrEmpty(name) && _variables != null && _variables.ContainsKey(name);
        }

        /// <summary>
        /// Numerieke waarde van het kanaal, of null. Null betekent: niet verbonden, kanaal
        /// bestaat niet, type is geen getal, waarde valt buiten de buffer, of NaN/oneindig.
        /// Nooit 0 als "de sim zei niets" — 0 is een echte meting.
        /// </summary>
        public double? ReadNumber(string name)
        {
            if (!Connected || string.IsNullOrEmpty(name) || _variables == null) return null;
            IrSdkVariable variable;
            if (!_variables.TryGetValue(name, out variable)) return null;

            var size = SizeOf(variable.Type);
            if (size <= 0) return null;
            var position = _dataOffset + variable.Offset;
            if (variable.Offset < 0 || position < _dataOffset) return null;
            if ((long)position + size > (long)_dataOffset + _dataLength) return null;
            if ((long)position + size > _length) return null;

            double value;
            switch (variable.Type)
            {
                case TypeFloat:
                    value = BitConverter.ToSingle(_image, position);
                    break;
                case TypeDouble:
                    value = BitConverter.ToDouble(_image, position);
                    break;
                case TypeInt:
                    value = BitConverter.ToInt32(_image, position);
                    break;
                case TypeBitField:
                    value = BitConverter.ToUInt32(_image, position);
                    break;
                case TypeBool:
                    value = _image[position] != 0 ? 1d : 0d;
                    break;
                case TypeChar:
                    value = (sbyte)_image[position];
                    break;
                default:
                    return null;
            }
            if (double.IsNaN(value) || double.IsInfinity(value)) return null;
            return value;
        }

        /// <summary>Grootte in bytes van een iRacing-veldtype; 0 = geen numeriek type.</summary>
        public static int SizeOf(int type)
        {
            switch (type)
            {
                case TypeChar:
                case TypeBool:
                    return 1;
                case TypeInt:
                case TypeBitField:
                case TypeFloat:
                    return 4;
                case TypeDouble:
                    return 8;
                default:
                    return 0;
            }
        }

        private static int ReadInt32(byte[] buffer, int length, int offset)
        {
            if (offset < 0 || (long)offset + 4 > length) return int.MinValue;
            return BitConverter.ToInt32(buffer, offset);
        }

        private static string ReadCString(byte[] buffer, int offset, int maximum, int length)
        {
            if (buffer == null || offset < 0 || maximum <= 0) return null;
            var end = offset;
            var limit = Math.Min(offset + maximum, length);
            while (end < limit && buffer[end] != 0) end++;
            if (end == offset) return null;
            try { return Encoding.ASCII.GetString(buffer, offset, end - offset).Trim(); }
            catch { return null; }
        }
    }

    /// <summary>
    /// Directe lezer van de iRacing-shared-memory (<c>Local\IRSDKMemMapFileName</c>).
    ///
    /// Dit is bewust géén ReadProcessMemory, geen injectie en geen tweede proces: alleen het
    /// bestaande, door iRacing zelf aangemaakte memory-mapped bestand, read-only geopend.
    /// Daarmee blijven anti-cheat en de bestaande SimHub-koppeling buiten schot.
    ///
    /// Foutpaden — allemaal "waarde null, plugin blijft draaien":
    ///  - de map bestaat niet (sim nooit gestart): OpenExisting gooit, we wachten 2 s;
    ///  - geen leesrechten of een ander platform: dezelfde weg, met de fout in LastError;
    ///  - de map bestaat maar de sim draait niet (status-bit weg): we sluiten de map en
    ///    proberen het 2 s later opnieuw. Sluiten is nodig omdat een herstart van iRacing
    ///    een níeuw mapping-object maakt; een oude handle blijft anders voor altijd naar
    ///    het dode geheugen wijzen;
    ///  - kanaal ontbreekt of heeft een onverwacht type: null, nooit 0.
    ///
    /// De lezer is niet threadsafe-by-design maar wel thread-safe: elke publieke ingang
    /// werkt onder één slot, zodat de verzendtick en de researchtick elkaar niet kunnen
    /// interleaven tijdens een reconnect.
    /// </summary>
    public sealed class IrSdkMemoryReader : IDisposable
    {
        public const string MapName = @"Local\IRSDKMemMapFileName";

        private const int ReopenBackoffMilliseconds = 2000;
        private const int MaxMapBytes = 4 * 1024 * 1024;

        private readonly object _gate = new object();
        private MemoryMappedFile _map;
        private MemoryMappedViewAccessor _view;
        private byte[] _buffer;
        private long _nextOpenAttemptTicks;
        private string _lastError;
        private bool _disposed;

        /// <summary>Laatste foutreden (null zodra een lezing lukte). Alleen voor logging/status.</summary>
        public string LastError { get { lock (_gate) return _lastError; } }

        public bool IsOpen { get { lock (_gate) return _view != null; } }

        /// <summary>
        /// Leest de map in één keer en geeft een parsebare snapshot. Null als de map niet
        /// bestaat, de sim niet draait of de inhoud onleesbaar is. Gooit nooit.
        /// </summary>
        public IrSdkImage Snapshot()
        {
            lock (_gate)
            {
                if (_disposed) return null;
                if (_view == null && !TryOpenLocked()) return null;
                try
                {
                    var capacity = (int)_view.Capacity;
                    if (capacity < IrSdkImage.MinimumHeaderBytes || capacity > MaxMapBytes)
                    {
                        CloseLocked("onverwachte kaartgrootte: " + capacity.ToString(System.Globalization.CultureInfo.InvariantCulture));
                        return null;
                    }
                    if (_buffer == null || _buffer.Length < capacity) _buffer = new byte[capacity];
                    _view.ReadArray(0, _buffer, 0, capacity);
                }
                catch (Exception error)
                {
                    CloseLocked(Describe(error));
                    return null;
                }

                var image = IrSdkImage.Parse(_buffer, _buffer == null ? 0 : _buffer.Length);
                if (image == null)
                {
                    // Eén transparante lezing tijdens een bufferrotatie mag geen 2 s blind
                    // kosten: de map blijft open en de volgende tick leest opnieuw.
                    _lastError = "iRacing-header onleesbaar";
                    return null;
                }
                if (!image.Connected)
                {
                    // Sim gestart maar niet aan het rijden (of net afgesloten): geen waarden.
                    CloseLocked("sim niet verbonden");
                    return null;
                }
                _lastError = null;
                return image;
            }
        }

        /// <summary>Opent de map nu (met dezelfde 2 s-backoff als <see cref="Snapshot"/>).</summary>
        public bool TryOpen()
        {
            lock (_gate)
            {
                if (_disposed) return false;
                return TryOpenLocked();
            }
        }

        private bool TryOpenLocked()
        {
            if (_view != null) return true;
            var now = DateTime.UtcNow.Ticks;
            if (now < _nextOpenAttemptTicks) return false;
            _nextOpenAttemptTicks = now + ReopenBackoffMilliseconds * TimeSpan.TicksPerMillisecond;

            MemoryMappedFile map = null;
            try
            {
                map = MemoryMappedFile.OpenExisting(MapName, MemoryMappedFileRights.Read);
                var view = map.CreateViewAccessor(0, 0, MemoryMappedFileAccess.Read);
                _map = map;
                _view = view;
                _lastError = null;
                return true;
            }
            catch (Exception error)
            {
                // FileNotFoundException (map bestaat niet), UnauthorizedAccessException,
                // PlatformNotSupportedException (geen Windows), IOException bij een
                // half opgeruimde map: allemaal hetzelfde antwoord — geen waarden.
                if (map != null) { try { map.Dispose(); } catch { } }
                _lastError = Describe(error);
                return false;
            }
        }

        private void CloseLocked(string reason)
        {
            try { if (_view != null) _view.Dispose(); } catch { }
            try { if (_map != null) _map.Dispose(); } catch { }
            _view = null;
            _map = null;
            _lastError = reason;
            _nextOpenAttemptTicks = DateTime.UtcNow.Ticks + ReopenBackoffMilliseconds * TimeSpan.TicksPerMillisecond;
        }

        private static string Describe(Exception error)
        {
            if (error == null) return "onbekende fout";
            return error.GetType().Name + ": " + error.Message;
        }

        public void Dispose()
        {
            lock (_gate)
            {
                if (_disposed) return;
                _disposed = true;
                CloseLocked(null);
                _buffer = null;
            }
        }
    }
}
