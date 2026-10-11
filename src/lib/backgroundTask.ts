import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { TrackPoint } from '../types';
import { haversine } from './geo';

export const LOCATION_TASK = 'trenchmap-location-task';
export const ACTIVE_KEY = 'trenchmap_active_recording_v1';

export type ActiveRecording = {
  id: string;
  project_id: string;
  startedAt: number;
  points: TrackPoint[];
};

const MAX_ACCURACY_M = 30; // ignore very poor fixes
const MIN_STEP_M = 2; // ignore GPS jitter when standing still

// Runs even when the app is in the background or the screen is locked.
TaskManager.defineTask(LOCATION_TASK, async ({ data, error }) => {
  if (error || !data) return;
  const { locations } = data as { locations: Location.LocationObject[] };
  const raw = await AsyncStorage.getItem(ACTIVE_KEY);
  if (!raw) return;

  const rec: ActiveRecording = JSON.parse(raw);
  for (const loc of locations) {
    const acc = loc.coords.accuracy ?? 999;
    if (acc > MAX_ACCURACY_M) continue;
    const pt: TrackPoint = {
      lat: loc.coords.latitude,
      lng: loc.coords.longitude,
      t: loc.timestamp,
      acc,
      alt: loc.coords.altitude,
    };
    const last = rec.points[rec.points.length - 1];
    if (last && haversine(last, pt) < MIN_STEP_M) continue;
    rec.points.push(pt);
  }
  await AsyncStorage.setItem(ACTIVE_KEY, JSON.stringify(rec));
});
