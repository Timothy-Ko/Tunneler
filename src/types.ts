export type LatLng = { latitude: number; longitude: number };

export type TrackPoint = {
  lat: number;
  lng: number;
  t: number; // epoch ms
  acc?: number; // horizontal accuracy in meters
  alt?: number | null;
};

export type PinType = 'gate' | 'lock' | 'connection' | 'hotzone' | 'other';

export const PIN_TYPES: Record<PinType, { label: string; emoji: string; color: string }> = {
  gate: { label: 'Gate', emoji: '🚪', color: '#2563eb' },
  lock: { label: 'Lock', emoji: '🔒', color: '#7c3aed' },
  connection: { label: 'Connection', emoji: '🔌', color: '#059669' },
  hotzone: { label: 'Hot zone', emoji: '🔥', color: '#dc2626' },
  other: { label: 'Other', emoji: '📍', color: '#6b7280' },
};

export type Pin = {
  id: string;
  project_id: string;
  user_id: string;
  type: PinType;
  title: string;
  note: string;
  lat: number;
  lng: number;
  created_at: string;
  synced?: boolean; // local only: has this reached the server yet
};

export type Track = {
  id: string;
  project_id: string;
  user_id: string;
  name: string;
  points: TrackPoint[];
  distance_m: number;
  started_at: string;
  ended_at: string;
  synced?: boolean;
};

export type Project = {
  id: string;
  name: string;
  invite_code: string;
};

export type Member = {
  project_id: string;
  user_id: string;
  display_name: string;
  color: string;
};

// "muted" is a plain grey Apple map (iPhone can't show a fully blank map under tracks and pins).
export type MapLayer = 'street' | 'satellite' | 'muted';
