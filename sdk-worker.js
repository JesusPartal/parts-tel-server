import { IRacingSDK } from 'irsdk-node';

console.log('SDK worker started');

const sdk = new IRacingSDK();
sdk.startSDK();

let consecutiveFails = 0;
const MAX_FAILS = 300;

function loop() {
  if (sdk.waitForData(100)) {
    consecutiveFails = 0;
    const telemetry = sdk.getTelemetry();

    if (telemetry && telemetry.Speed) {
      const speed = telemetry.Speed?.value[0] ?? 0;
      const rpm = telemetry.RPM?.value[0] ?? 0;
      const gear = telemetry.Gear?.value[0] ?? 0;
      const currentLap = telemetry.Lap?.value[0] ?? 1;
      const lapTimeCurrent = telemetry.LapCurrentLapTime?.value[0] ?? 0;
      const distancePercentage = (telemetry.LapDistPct?.value[0] ?? 0) * 100;
      const fuelLevel = telemetry.FuelLevel?.value[0] ?? undefined;
      const fuelLevelPct = telemetry.FuelLevelPct?.value[0] ?? undefined;
      const lastLapTime = telemetry.LapLastLapTime?.value[0] ?? undefined;
      const trackTemp = telemetry.TrackTemp?.value[0] ?? undefined;
      const airTemp = telemetry.AirTemp?.value[0] ?? undefined;
      const sessionTime = telemetry.SessionTime?.value[0] ?? undefined;
      const sessionTimeRemain = telemetry.SessionTimeRemain?.value[0] ?? undefined;

      try {
        process.send({
          timestamp: Date.now(),
          car: {
            speed: Math.floor(speed * 3.6),
            rpm: Math.floor(rpm),
            gear,
            fuelLevel,
            fuelLevelPct,
          },
          lapDetails: {
            currentLap,
            lapTimeCurrent,
            distancePercentage,
            lastLapTime,
            trackTemp,
            airTemp,
            sessionTime,
            sessionTimeRemain,
          }
        });
      } catch (err) {
        process.exit(0);
      }
    }
  } else {
    consecutiveFails++;
    if (consecutiveFails >= MAX_FAILS) {
      console.log('iRacing connection lost, restarting SDK...');
      consecutiveFails = 0;
      sdk.startSDK();
    }
  }

  setImmediate(loop);
}

loop();