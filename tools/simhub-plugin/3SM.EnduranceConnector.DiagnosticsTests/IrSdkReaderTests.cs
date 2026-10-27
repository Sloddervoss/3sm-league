using System;
using System.IO;
using System.Runtime.Serialization.Json;
using System.Text;
using ThreeSM.EnduranceConnector;

// 0.8.0: de directe iRacing-SDK-lezer is pure logica op bytes (geen SimHub-referentie),
// dus hier los te testen met een synthetische memory-image. Zelfde stijl als FaseDTests:
// elke regel is één PASS/FAIL met bewijs, geen testframework.
internal static class IrSdkReaderTests
{
    private const int VarHeaderOffset = IrSdkImage.HeaderSize;
    private const int VarCount = 9;
    private const int BufferOffset = VarHeaderOffset + VarCount * IrSdkImage.VariableHeaderSize;
    private const int BufferLength = 256;
    private const int ImageLength = BufferOffset + BufferLength;

    /// <summary>Draait de suite en geeft het aantal uitgevoerde controles terug.</summary>
    public static int Run(Action<string, bool, string> check)
    {
        var image = BuildImage();

        var parsed = IrSdkImage.Parse(image, image.Length);
        check("SDK-01 header and varHeaders parse",
            parsed != null && parsed.Connected && parsed.TickRate == 60 && parsed.TickCount == 4242
            && parsed.VariableCount == VarCount,
            parsed == null ? "null" : "tickRate=" + parsed.TickRate + " tick=" + parsed.TickCount + " vars=" + parsed.VariableCount);

        check("SDK-02 float channel reads as a number",
            parsed != null && Near(parsed.ReadNumber("LFspeed"), 12.5),
            Number(parsed, "LFspeed"));

        check("SDK-03 double channel reads as a number",
            parsed != null && Near(parsed.ReadNumber("SteeringWheelAngle"), 0.42),
            Number(parsed, "SteeringWheelAngle"));

        check("SDK-04 int and bool channels are converted, not reinterpreted",
            parsed != null && Near(parsed.ReadNumber("LatAccel"), -35) && Near(parsed.ReadNumber("LongAccel"), 1),
            Number(parsed, "LatAccel") + " / " + Number(parsed, "LongAccel"));

        // 0 is een meting ("ik rem niet"), geen ontbrekende waarde.
        check("SDK-05 a zero value stays zero instead of becoming null",
            parsed != null && parsed.ReadNumber("LFbrakeLinePress").HasValue && parsed.ReadNumber("LFbrakeLinePress").Value == 0d,
            Number(parsed, "LFbrakeLinePress"));

        check("SDK-06 NaN is not a measurement",
            parsed != null && !parsed.ReadNumber("RFspeed").HasValue,
            Number(parsed, "RFspeed"));

        check("SDK-07 unknown channel and unknown type yield null",
            parsed != null && !parsed.ReadNumber("NoSuchChannel").HasValue && !parsed.ReadNumber("WeirdType").HasValue,
            "unknown=" + parsed.ReadNumber("NoSuchChannel") + " type=" + parsed.ReadNumber("WeirdType"));

        check("SDK-08 field outside the current buffer yields null",
            parsed != null && !parsed.ReadNumber("OutsideBuffer").HasValue,
            Number(parsed, "OutsideBuffer"));

        check("SDK-09 the 31-character name is read without trailing NULs",
            parsed != null && parsed.HasVariable("ABCDEFGHIJKLMNOPQRSTUVWXYZABCDE") && Near(parsed.ReadNumber("ABCDEFGHIJKLMNOPQRSTUVWXYZABCDE"), 1.5),
            "has=" + parsed.HasVariable("ABCDEFGHIJKLMNOPQRSTUVWXYZABCDE"));

        var disconnected = IrSdkImage.Parse(SetStatus(image, 0), image.Length);
        check("SDK-10 a map without the connected bit yields no values",
            disconnected != null && !disconnected.Connected && !disconnected.ReadNumber("LFspeed").HasValue,
            disconnected == null ? "null" : "connected=" + disconnected.Connected);

        var badVarOffset = (byte[])image.Clone();
        WriteInt32(badVarOffset, 28, ImageLength - 10);
        check("SDK-11 varHeader table outside the image is rejected",
            IrSdkImage.Parse(badVarOffset, badVarOffset.Length) == null, "parse=null");

        var badBuffer = (byte[])image.Clone();
        WriteInt32(badBuffer, 52, ImageLength - 4);
        check("SDK-12 data buffer outside the image is rejected",
            IrSdkImage.Parse(badBuffer, badBuffer.Length) == null, "parse=null");

        check("SDK-13 a truncated image is rejected",
            IrSdkImage.Parse(image, IrSdkImage.MinimumHeaderBytes - 1) == null && IrSdkImage.Parse(null, 0) == null,
            "truncated=null empty=null");

        // Echte foutpad: op deze machine bestaat de iRacing-map niet (Linux/geen sim).
        // De lezer moet null geven, niet gooien, en de plugin dus niet meeslepen.
        var reader = new IrSdkMemoryReader();
        IrSdkImage snapshot = null;
        var threw = false;
        try { snapshot = reader.Snapshot(); }
        catch (Exception) { threw = true; }
        // Staat iRacing op de testmachine wél aan, dan is een geslaagde snapshot ook goed;
        // alleen "geen waarden én geen foutreden" is fout.
        var missingMapOk = snapshot == null ? reader.LastError != null : snapshot.Connected;
        check("SDK-14 missing shared memory never throws",
            !threw && missingMapOk,
            "threw=" + threw + " error=" + (reader.LastError ?? "none") + " snapshot=" + (snapshot == null ? "null" : "connected"));
        reader.Dispose();
        reader.Dispose();
        check("SDK-15 double dispose is safe", reader.Snapshot() == null, "snapshot=null");

        // Contract: de nieuwe velden zijn optioneel en verdwijnen als ze leeg zijn.
        var empty = Serialize(new V3Vehicle { SpeedKph = 100 });
        var filled = Serialize(new V3Vehicle
        {
            SpeedKph = 100,
            WheelSpeedKph = new V3WheelValues { FrontLeft = 208.6, RearRight = 207.4 },
            BrakeLinePressureBar = new V3WheelValues { FrontLeft = 0, FrontRight = 87.5 },
            SteeringWheelAngleDeg = -70.7,
            LatAccelG = 1.274,
            LongAccelG = -0.841,
        });
        check("SDK-16 null vehicle fields are omitted from the payload",
            empty != null && empty.IndexOf("wheelSpeedKph", StringComparison.Ordinal) < 0
            && empty.IndexOf("brakeLinePressureBar", StringComparison.Ordinal) < 0
            && empty.IndexOf("steeringWheelAngleDeg", StringComparison.Ordinal) < 0,
            empty ?? "null");
        check("SDK-17 populated vehicle fields are additive and keep the corner names",
            filled != null
            && filled.IndexOf("\"wheelSpeedKph\":{\"frontLeft\":208.6,\"rearRight\":207.4}", StringComparison.Ordinal) >= 0
            && filled.IndexOf("\"brakeLinePressureBar\":{\"frontLeft\":0,\"frontRight\":87.5}", StringComparison.Ordinal) >= 0
            && filled.IndexOf("\"steeringWheelAngleDeg\":-70.7", StringComparison.Ordinal) >= 0
            && filled.IndexOf("\"latAccelG\":1.274", StringComparison.Ordinal) >= 0
            && filled.IndexOf("\"longAccelG\":-0.841", StringComparison.Ordinal) >= 0,
            filled ?? "null");

        check("SDK-18 SDK units convert to the wire units (km/h, degrees, g)",
            Near(IrSdkUnits.MpsToKph(100), 360) && Near(IrSdkUnits.RadToDeg(Math.PI), 180)
            && Near(IrSdkUnits.Mps2ToG(9.80665), 1) && Near(IrSdkUnits.MpsToKph(0), 0),
            "100mps=" + IrSdkUnits.MpsToKph(100).ToString(System.Globalization.CultureInfo.InvariantCulture)
            + " pi=" + IrSdkUnits.RadToDeg(Math.PI).ToString(System.Globalization.CultureInfo.InvariantCulture)
            + " g=" + IrSdkUnits.Mps2ToG(9.80665).ToString(System.Globalization.CultureInfo.InvariantCulture));

        // De kanaalnamen zijn de naad met iRacing: een typefout hier is een stille null.
        check("SDK-19 channel names and corner order match the iRacing SDK",
            IrSdkChannels.WheelSpeed.Length == 4 && IrSdkChannels.BrakeLinePressure.Length == 4
            && IrSdkChannels.WheelSpeed[0] == "LFspeed" && IrSdkChannels.WheelSpeed[1] == "RFspeed"
            && IrSdkChannels.WheelSpeed[2] == "LRspeed" && IrSdkChannels.WheelSpeed[3] == "RRspeed"
            && IrSdkChannels.BrakeLinePressure[0] == "LFbrakeLinePress" && IrSdkChannels.BrakeLinePressure[3] == "RRbrakeLinePress"
            && IrSdkChannels.SteeringWheelAngle == "SteeringWheelAngle"
            && IrSdkChannels.LatAccel == "LatAccel" && IrSdkChannels.LongAccel == "LongAccel",
            string.Join(",", IrSdkChannels.WheelSpeed));

        return 19;
    }

    private static byte[] BuildImage()
    {
        var image = new byte[ImageLength];
        WriteInt32(image, 0, 2);                  // ver
        WriteInt32(image, 4, 1);                  // status = connected
        WriteInt32(image, 8, 60);                 // tickRate
        WriteInt32(image, 24, VarCount);          // numVars
        WriteInt32(image, 28, VarHeaderOffset);   // varHeaderOffset
        WriteInt32(image, 32, 1);                 // numBuf
        WriteInt32(image, 36, BufferLength);      // bufLen
        WriteInt32(image, 48, 4242);              // varBuf[0].tickCount
        WriteInt32(image, 52, BufferOffset);      // varBuf[0].bufOffset

        WriteVarHeader(image, 0, IrSdkImage.TypeFloat, 0, "LFspeed");
        WriteVarHeader(image, 1, IrSdkImage.TypeFloat, 4, "RFspeed");
        WriteVarHeader(image, 2, IrSdkImage.TypeFloat, 8, "LFbrakeLinePress");
        WriteVarHeader(image, 3, IrSdkImage.TypeDouble, 16, "SteeringWheelAngle");
        WriteVarHeader(image, 4, IrSdkImage.TypeInt, 24, "LatAccel");
        WriteVarHeader(image, 5, IrSdkImage.TypeBool, 28, "LongAccel");
        WriteVarHeader(image, 6, IrSdkImage.TypeFloat, 32, "ABCDEFGHIJKLMNOPQRSTUVWXYZABCDE");
        WriteVarHeader(image, 7, 9 /* onbekend type */, 36, "WeirdType");
        WriteVarHeader(image, 8, IrSdkImage.TypeFloat, 300, "OutsideBuffer");

        WriteFloat(image, BufferOffset + 0, 12.5f);
        WriteFloat(image, BufferOffset + 4, float.NaN);
        // BufferOffset + 8 blijft 0.0: een echte "geen remdruk"-meting.
        WriteDouble(image, BufferOffset + 16, 0.42);
        WriteInt32(image, BufferOffset + 24, -35);
        image[BufferOffset + 28] = 1;
        WriteFloat(image, BufferOffset + 32, 1.5f);
        return image;
    }

    private static byte[] SetStatus(byte[] image, int status)
    {
        var copy = (byte[])image.Clone();
        WriteInt32(copy, 4, status);
        return copy;
    }

    private static void WriteVarHeader(byte[] image, int index, int type, int offset, string name)
    {
        var baseOffset = VarHeaderOffset + index * IrSdkImage.VariableHeaderSize;
        WriteInt32(image, baseOffset, type);
        WriteInt32(image, baseOffset + 4, offset);
        WriteInt32(image, baseOffset + 8, 1);
        image[baseOffset + 12] = 0; // countAsTime
        var nameBytes = Encoding.ASCII.GetBytes(name);
        Array.Copy(nameBytes, 0, image, baseOffset + 16, Math.Min(nameBytes.Length, 31));
        var unitBytes = Encoding.ASCII.GetBytes("m/s");
        Array.Copy(unitBytes, 0, image, baseOffset + 112, unitBytes.Length);
    }

    private static void WriteInt32(byte[] image, int offset, int value)
    {
        var bytes = BitConverter.GetBytes(value);
        Array.Copy(bytes, 0, image, offset, 4);
    }

    private static void WriteFloat(byte[] image, int offset, float value)
    {
        var bytes = BitConverter.GetBytes(value);
        Array.Copy(bytes, 0, image, offset, 4);
    }

    private static void WriteDouble(byte[] image, int offset, double value)
    {
        var bytes = BitConverter.GetBytes(value);
        Array.Copy(bytes, 0, image, offset, 8);
    }

    private static bool Near(double? value, double expected)
    {
        return value.HasValue && Math.Abs(value.Value - expected) < 1e-6;
    }

    private static string Number(IrSdkImage image, string channel)
    {
        if (image == null) return "null-image";
        var value = image.ReadNumber(channel);
        return channel + "=" + (value.HasValue ? value.Value.ToString(System.Globalization.CultureInfo.InvariantCulture) : "null");
    }

    private static string Serialize(V3Vehicle vehicle)
    {
        try
        {
            var serializer = new DataContractJsonSerializer(typeof(V3Vehicle));
            using (var stream = new MemoryStream())
            {
                serializer.WriteObject(stream, vehicle);
                return Encoding.UTF8.GetString(stream.ToArray());
            }
        }
        catch (Exception error)
        {
            return "ERROR " + error.GetType().Name + ": " + error.Message;
        }
    }
}
