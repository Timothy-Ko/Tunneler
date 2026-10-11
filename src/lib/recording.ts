import * as Location from 'expo-location';
import * as Crypto from 'expo-crypto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ACTIVE_KEY, ActiveRecording, LOCATION_TASK } from './backgroundTask';
import { pathDistance } from './geo';
import { Track } from '../types';

export async function getActiveRecording(): Promise<ActiveRecording | null> {
  const raw = await AsyncStorage.getItem(ACTIVE_KEY);
  return raw ? (JSON.parse(raw) as ActiveRecording) : null;
}

export type StartResult = { ok: boolean; backgroundGranted: boolean; message?: string };

export async function startRecording(projectId: string): Promise<StartResult> {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== 'granted') {
    return { ok: false, backgroundGranted: false, message: 'Location permission is needed to record.' };
  }
  // iOS asks for "Always" separately. Without it, recording stops when the screen locks.
  const bg = await Location.requestBackgroundPermissionsAsync();
  const backgroundGranted = bg.status === 'granted';

  const rec: ActiveRecording = {
    id: Crypto.randomUUID(),
    project_id: projectId,
    startedAt: Date.now(),
    points: [],
  };
  await AsyncStorage.setItem(ACTIVE_KEY, JSON.stringify(rec));

  // Seed with the current position so the line starts right where you pressed the button.
  try {
    const here = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.BestForNavigation });
    rec.points.push({
      lat: here.coords.latitude,
      lng: here.coords.longitude,
      t: here.timestamp,
      acc: here.coords.accuracy ?? undefined,
      alt: here.coords.altitude,
    });
    await AsyncStorage.setItem(ACTIVE_KEY, JSON.stringify(rec));
  } catch {
    // The background task will supply points anyway.
  }

  await Location.startLocationUpdatesAsync(LOCATION_TASK, {
    accuracy: Location.Accuracy.BestForNavigation,
    distanceInterval: 3,
    timeInterval: 2000,
    activityType: Location.ActivityType.Fitness,
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
  });

  return {
    ok: true,
    backgroundGranted,
    message: backgroundGranted
      ? undefined
      : 'Recording is on, but it will pause when the screen locks. In Settings > TrenchMap > Location, choose "Always".',
  };
}

// Stops recording and returns the finished track (not yet saved anywhere).
export async function stopRecording(userId: string, name: string): Promise<Track | null> {
  if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)) {
    await Location.stopLocationUpdatesAsync(LOCATION_TASK);
  }
  const rec = await getActiveRecording();
  await AsyncStorage.removeItem(ACTIVE_KEY);
  if (!rec || rec.points.length < 2) return null;

  return {
    id: rec.id,
    project_id: rec.project_id,
    user_id: userId,
    name,
    points: rec.points,
    distance_m: pathDistance(rec.points),
    started_at: new Date(rec.startedAt).toISOString(),
    ended_at: new Date().toISOString(),
    synced: false,
  };
}

export async function discardRecording(): Promise<void> {
  if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)) {
    await Location.stopLocationUpdatesAsync(LOCATION_TASK);
  }
  await AsyncStorage.removeItem(ACTIVE_KEY);
}
