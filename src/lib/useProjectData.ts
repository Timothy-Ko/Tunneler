import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { Member, Pin, Track } from '../types';

const key = (kind: string, projectId: string) => `trenchmap_${kind}_${projectId}`;

async function readLocal<T>(kind: string, projectId: string): Promise<T[]> {
  try {
    const raw = await AsyncStorage.getItem(key(kind, projectId));
    return raw ? (JSON.parse(raw) as T[]) : [];
  } catch {
    return [];
  }
}

async function writeLocal<T>(kind: string, projectId: string, items: T[]) {
  await AsyncStorage.setItem(key(kind, projectId), JSON.stringify(items));
}

// Strip the local-only flag before sending to the server.
function toRow<T extends { synced?: boolean }>(item: T): Omit<T, 'synced'> {
  const { synced, ...rest } = item;
  return rest;
}

/**
 * Loads pins, tracks and members for a project. Everything is cached on the phone,
 * new items are saved locally first and pushed to Supabase when there is signal,
 * and other people's changes arrive live.
 */
export function useProjectData(projectId: string) {
  const [pins, setPins] = useState<Pin[]>([]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [online, setOnline] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);
  const busy = useRef(false);
  const rerun = useRef(false);
  const pinsRef = useRef<Pin[]>([]);
  const tracksRef = useRef<Track[]>([]);

  const commit = useCallback(
    async (nextPins: Pin[], nextTracks: Track[]) => {
      pinsRef.current = nextPins;
      tracksRef.current = nextTracks;
      setPins(nextPins);
      setTracks(nextTracks);
      setPendingCount(
        nextPins.filter((p) => p.synced === false).length +
          nextTracks.filter((t) => t.synced === false).length
      );
      await writeLocal('pins', projectId, nextPins);
      await writeLocal('tracks', projectId, nextTracks);
    },
    [projectId]
  );

  // Push anything created offline, then pull the latest from the server.
  // If something new is saved while a sync is running, the loop runs once more
  // so nothing is left behind and nothing is overwritten.
  const sync = useCallback(async () => {
    if (busy.current) {
      rerun.current = true;
      return;
    }
    busy.current = true;
    try {
      do {
        rerun.current = false;

        const unsyncedPins = pinsRef.current.filter((p) => p.synced === false);
        const unsyncedTracks = tracksRef.current.filter((t) => t.synced === false);

        if (unsyncedPins.length) {
          const { error } = await supabase.from('pins').upsert(unsyncedPins.map(toRow));
          if (error) throw error;
        }
        if (unsyncedTracks.length) {
          const { error } = await supabase.from('tracks').upsert(unsyncedTracks.map(toRow));
          if (error) throw error;
        }

        const [p, t, m] = await Promise.all([
          supabase.from('pins').select('*').eq('project_id', projectId),
          supabase.from('tracks').select('*').eq('project_id', projectId),
          supabase.from('project_members').select('*').eq('project_id', projectId),
        ]);
        if (p.error) throw p.error;
        if (t.error) throw t.error;
        if (m.error) throw m.error;

        const remotePins = (p.data as Pin[]).map((x) => ({ ...x, synced: true }));
        const remoteTracks = (t.data as Track[]).map((x) => ({ ...x, synced: true }));
        const pinIds = new Set(remotePins.map((x) => x.id));
        const trackIds = new Set(remoteTracks.map((x) => x.id));

        // Keep anything saved locally that the server has not seen yet (for example
        // a pin dropped while this sync was in flight).
        const keepPins = pinsRef.current.filter((x) => x.synced === false && !pinIds.has(x.id));
        const keepTracks = tracksRef.current.filter((x) => x.synced === false && !trackIds.has(x.id));

        await commit([...remotePins, ...keepPins], [...remoteTracks, ...keepTracks]);
        setMembers(m.data as Member[]);
        await writeLocal('members', projectId, m.data as Member[]);
        setOnline(true);
      } while (rerun.current);
    } catch {
      setOnline(false);
    } finally {
      busy.current = false;
    }
  }, [projectId, commit]);

  // Initial load from the phone's cache, then sync.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [lp, lt, lm] = await Promise.all([
        readLocal<Pin>('pins', projectId),
        readLocal<Track>('tracks', projectId),
        readLocal<Member>('members', projectId),
      ]);
      if (cancelled) return;
      await commit(lp, lt);
      setMembers(lm);
      sync();
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, commit, sync]);

  // Live updates from friends, plus a retry timer for when signal comes back.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const debounced = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(sync, 500);
    };
    const channel = supabase
      .channel(`project-${projectId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pins', filter: `project_id=eq.${projectId}` }, debounced)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tracks', filter: `project_id=eq.${projectId}` }, debounced)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'project_members', filter: `project_id=eq.${projectId}` }, debounced)
      .subscribe();
    const retry = setInterval(sync, 30000);
    return () => {
      if (timer) clearTimeout(timer);
      clearInterval(retry);
      supabase.removeChannel(channel);
    };
  }, [projectId, sync]);

  const addPin = useCallback(
    async (pin: Pin) => {
      await commit([...pinsRef.current, { ...pin, synced: false }], tracksRef.current);
      sync();
    },
    [commit, sync]
  );

  const addTrack = useCallback(
    async (track: Track) => {
      await commit(pinsRef.current, [...tracksRef.current, { ...track, synced: false }]);
      sync();
    },
    [commit, sync]
  );

  const deletePin = useCallback(
    async (id: string): Promise<boolean> => {
      const { error } = await supabase.from('pins').delete().eq('id', id);
      if (error) return false;
      await commit(pinsRef.current.filter((p) => p.id !== id), tracksRef.current);
      return true;
    },
    [commit]
  );

  const deleteTrack = useCallback(
    async (id: string): Promise<boolean> => {
      const { error } = await supabase.from('tracks').delete().eq('id', id);
      if (error) return false;
      await commit(pinsRef.current, tracksRef.current.filter((t) => t.id !== id));
      return true;
    },
    [commit]
  );

  return { pins, tracks, members, online, pendingCount, addPin, addTrack, deletePin, deleteTrack, refresh: sync };
}
