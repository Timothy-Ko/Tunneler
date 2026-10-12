import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Modal, Pressable, SafeAreaView, ScrollView, Share, StyleSheet,
  Text, TextInput, View,
} from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import * as Location from 'expo-location';
import * as Crypto from 'expo-crypto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { supabase } from '../lib/supabase';
import { useProjectData } from '../lib/useProjectData';
import { discardRecording, getActiveRecording, startRecording, stopRecording } from '../lib/recording';
import { formatDistance, formatDuration, pathDistance } from '../lib/geo';
import { shareGpx } from '../lib/gpx';
import { LatLng, MapLayer, PIN_TYPES, Pin, PinType, Project, TrackPoint } from '../types';

const LAYER_KEY = 'Wend_layer_v1';
const MAP_TYPES: Record<MapLayer, 'standard' | 'hybrid' | 'mutedStandard'> = {
  street: 'standard',
  satellite: 'hybrid',
  muted: 'mutedStandard',
};
const LAYER_LABELS: Record<MapLayer, string> = {
  street: 'Street',
  satellite: 'Satellite',
  muted: 'Muted',
};

type Props = { userId: string; project: Project; onBack: () => void };

export default function MapScreen({ userId, project, onBack }: Props) {
  const { pins, tracks, members, online, pendingCount, addPin, addTrack, deletePin, deleteTrack, refresh } =
    useProjectData(project.id);

  const mapRef = useRef<MapView>(null);
  const [layer, setLayer] = useState<MapLayer>('street');
  const [follow, setFollow] = useState(true);
  const [keepAwake, setKeepAwake] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  // Recording state
  const [recording, setRecording] = useState(false);
  const [livePoints, setLivePoints] = useState<TrackPoint[]>([]);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());

  // Pin editor state
  const [draftCoord, setDraftCoord] = useState<LatLng | null>(null);
  const [draftType, setDraftType] = useState<PinType>('gate');
  const [draftTitle, setDraftTitle] = useState('');
  const [draftNote, setDraftNote] = useState('');
  const [selectedPin, setSelectedPin] = useState<Pin | null>(null);

  const colorOf = useMemo(() => {
    const map = new Map(members.map((m) => [m.user_id, m.color]));
    return (uid: string) => map.get(uid) ?? '#6b7280';
  }, [members]);
  const nameOf = useMemo(() => {
    const map = new Map(members.map((m) => [m.user_id, m.display_name]));
    return (uid: string) => map.get(uid) ?? 'Someone';
  }, [members]);

  // Restore saved layer choice and ask for location permission once.
  useEffect(() => {
    (async () => {
      const saved = await AsyncStorage.getItem(LAYER_KEY);
      if (saved === 'street' || saved === 'satellite' || saved === 'muted') setLayer(saved);
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status === 'granted') {
        try {
          const here = await Location.getCurrentPositionAsync({});
          mapRef.current?.animateToRegion(
            { latitude: here.coords.latitude, longitude: here.coords.longitude, latitudeDelta: 0.003, longitudeDelta: 0.003 },
            600
          );
        } catch {
          // no fix yet; the blue dot will appear when one arrives
        }
      }
      // If the app was closed while recording, pick the recording back up.
      const active = await getActiveRecording();
      if (active && active.project_id === project.id) {
        setRecording(true);
        setStartedAt(active.startedAt);
        setLivePoints(active.points);
      }
    })();
  }, [project.id]);

  // While recording, read the points the background task has collected.
  useEffect(() => {
    if (!recording) return;
    const id = setInterval(async () => {
      const active = await getActiveRecording();
      if (active) setLivePoints(active.points);
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(id);
  }, [recording]);

  useEffect(() => {
    if (keepAwake) activateKeepAwakeAsync('Wend');
    else deactivateKeepAwake('Wend');
    return () => {
      deactivateKeepAwake('Wend');
    };
  }, [keepAwake]);

  const chooseLayer = useCallback((l: MapLayer) => {
    setLayer(l);
    AsyncStorage.setItem(LAYER_KEY, l).catch(() => {});
  }, []);

  async function toggleRecording() {
    if (!recording) {
      try {
        const res = await startRecording(project.id);
        if (!res.ok) return Alert.alert('Cannot record', res.message);
        setRecording(true);
        setStartedAt(Date.now());
        setLivePoints([]);
        setFollow(true);
        if (res.message) Alert.alert('Heads up', res.message);
      } catch (e: any) {
        Alert.alert('Could not start recording', e?.message ?? 'Unknown error');
      }
      return;
    }

    const defaultName = `Track ${new Date().toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`;
    Alert.prompt(
      'Save this track?',
      'Give it a name, or cancel to keep recording.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Discard',
          style: 'destructive',
          onPress: async () => {
            await discardRecording();
            setRecording(false);
            setLivePoints([]);
            setStartedAt(null);
          },
        },
        {
          text: 'Save',
          onPress: async (text?: string) => {
            const track = await stopRecording(userId, (text ?? '').trim() || defaultName);
            setRecording(false);
            setLivePoints([]);
            setStartedAt(null);
            if (!track) return Alert.alert('Nothing to save', 'The recording had fewer than two GPS points.');
            await addTrack({ ...track, project_id: project.id });
          },
        },
      ],
      'plain-text',
      defaultName
    );
  }

  async function pinHere() {
    try {
      const here = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.BestForNavigation });
      openDraft({ latitude: here.coords.latitude, longitude: here.coords.longitude });
    } catch {
      Alert.alert('No GPS fix yet', 'Wait a moment for your location, or long-press the map to place a pin.');
    }
  }

  function openDraft(c: LatLng) {
    setDraftCoord(c);
    setDraftType('gate');
    setDraftTitle('');
    setDraftNote('');
  }

  async function savePin() {
    if (!draftCoord) return;
    const pin: Pin = {
      id: Crypto.randomUUID(),
      project_id: project.id,
      user_id: userId,
      type: draftType,
      title: draftTitle.trim(),
      note: draftNote.trim(),
      lat: draftCoord.latitude,
      lng: draftCoord.longitude,
      created_at: new Date().toISOString(),
    };
    setDraftCoord(null);
    await addPin(pin);
  }

  async function removePin(p: Pin) {
    const ok = await deletePin(p.id);
    if (!ok) Alert.alert('Could not delete', 'Check your signal and try again. You can only delete your own pins.');
    setSelectedPin(null);
  }

  const liveDistance = useMemo(() => pathDistance(livePoints), [livePoints]);
  const myTracks = tracks.filter((t) => t.user_id === userId);

  return (
    <View style={styles.flex}>
      <MapView
        ref={mapRef}
        style={styles.flex}
        mapType={MAP_TYPES[layer]}
        showsUserLocation
        showsCompass
        showsScale
        followsUserLocation={follow}
        userLocationAnnotationTitle=""
        onPanDrag={() => follow && setFollow(false)}
        onLongPress={(e: { nativeEvent: { coordinate: LatLng } }) => openDraft(e.nativeEvent.coordinate)}
      >
        {tracks.map((t) => (
          <Polyline
            key={t.id}
            coordinates={t.points.map((p) => ({ latitude: p.lat, longitude: p.lng }))}
            strokeColor={colorOf(t.user_id)}
            strokeWidth={4}
            lineCap="round"
            lineJoin="round"
          />
        ))}
        {livePoints.length > 1 && (
          <Polyline
            coordinates={livePoints.map((p) => ({ latitude: p.lat, longitude: p.lng }))}
            strokeColor="#ef4444"
            strokeWidth={5}
            lineCap="round"
            lineJoin="round"
          />
        )}
        {pins.map((p) => (
          <Marker
            key={p.id}
            coordinate={{ latitude: p.lat, longitude: p.lng }}
            onPress={() => setSelectedPin(p)}
            tracksViewChanges={false}
          >
            <View style={[styles.pin, { backgroundColor: PIN_TYPES[p.type]?.color ?? '#6b7280', borderColor: colorOf(p.user_id) }]}>
              <Text style={styles.pinEmoji}>{PIN_TYPES[p.type]?.emoji ?? '📍'}</Text>
            </View>
          </Marker>
        ))}
      </MapView>

      {/* Top bar */}
      <SafeAreaView style={styles.topWrap} pointerEvents="box-none">
        <View style={styles.topBar}>
          <Pressable style={styles.chip} onPress={onBack}>
            <Text style={styles.chipText}>‹ Projects</Text>
          </Pressable>
          <View style={styles.chip}>
            <Text style={styles.chipText} numberOfLines={1}>
              {project.name}
              {!online ? '  · offline' : pendingCount > 0 ? `  · ${pendingCount} to sync` : ''}
            </Text>
          </View>
          <Pressable style={styles.chip} onPress={() => setMenuOpen(true)}>
            <Text style={styles.chipText}>Menu</Text>
          </Pressable>
        </View>
        {recording && (
          <View style={styles.recBanner}>
            <Text style={styles.recText}>
              ● REC  {formatDuration(startedAt ? now - startedAt : 0)}  ·  {formatDistance(liveDistance)}
            </Text>
          </View>
        )}
      </SafeAreaView>

      {/* Bottom controls */}
      <SafeAreaView style={styles.bottomWrap} pointerEvents="box-none">
        <View style={styles.bottomRow}>
          <Pressable style={[styles.roundBtn, follow && styles.roundBtnOn]} onPress={() => setFollow(!follow)}>
            <Text style={styles.roundEmoji}>🧭</Text>
            <Text style={styles.roundLabel}>{follow ? 'Following' : 'Follow'}</Text>
          </Pressable>

          <Pressable
            style={[styles.recBtn, recording && styles.recBtnOn]}
            onPress={toggleRecording}
          >
            <Text style={styles.recBtnText}>{recording ? '■ Stop' : '● Record'}</Text>
          </Pressable>

          <Pressable style={styles.roundBtn} onPress={pinHere}>
            <Text style={styles.roundEmoji}>📍</Text>
            <Text style={styles.roundLabel}>Pin here</Text>
          </Pressable>
        </View>
        <Text style={styles.hint}>Long-press the map to drop a pin anywhere</Text>
      </SafeAreaView>

      {/* New pin editor */}
      <Modal visible={!!draftCoord} animationType="slide" transparent onRequestClose={() => setDraftCoord(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>New pin</Text>
            <View style={styles.typeRow}>
              {(Object.keys(PIN_TYPES) as PinType[]).map((t) => (
                <Pressable
                  key={t}
                  style={[styles.typeChip, draftType === t && { backgroundColor: PIN_TYPES[t].color }]}
                  onPress={() => setDraftType(t)}
                >
                  <Text style={[styles.typeText, draftType === t && { color: '#fff' }]}>
                    {PIN_TYPES[t].emoji} {PIN_TYPES[t].label}
                  </Text>
                </Pressable>
              ))}
            </View>
            <TextInput style={styles.input} placeholder="Name (e.g. Gate 3)" value={draftTitle} onChangeText={setDraftTitle} />
            <TextInput
              style={[styles.input, { height: 80 }]}
              placeholder="Notes"
              multiline
              value={draftNote}
              onChangeText={setDraftNote}
            />
            <View style={styles.sheetButtons}>
              <Pressable style={[styles.sheetBtn, styles.sheetBtnGhost]} onPress={() => setDraftCoord(null)}>
                <Text style={styles.sheetBtnGhostText}>Cancel</Text>
              </Pressable>
              <Pressable style={styles.sheetBtn} onPress={savePin}>
                <Text style={styles.sheetBtnText}>Save pin</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Pin details */}
      <Modal visible={!!selectedPin} animationType="fade" transparent onRequestClose={() => setSelectedPin(null)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setSelectedPin(null)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            {selectedPin && (
              <>
                <Text style={styles.sheetTitle}>
                  {PIN_TYPES[selectedPin.type]?.emoji} {selectedPin.title || PIN_TYPES[selectedPin.type]?.label}
                </Text>
                <Text style={styles.meta}>
                  {PIN_TYPES[selectedPin.type]?.label} · added by {nameOf(selectedPin.user_id)} ·{' '}
                  {new Date(selectedPin.created_at).toLocaleDateString()}
                </Text>
                {!!selectedPin.note && <Text style={styles.note}>{selectedPin.note}</Text>}
                <Text style={styles.meta}>
                  {selectedPin.lat.toFixed(6)}, {selectedPin.lng.toFixed(6)}
                </Text>
                <View style={styles.sheetButtons}>
                  {selectedPin.user_id === userId && (
                    <Pressable style={[styles.sheetBtn, { backgroundColor: '#dc2626' }]} onPress={() => removePin(selectedPin)}>
                      <Text style={styles.sheetBtnText}>Delete</Text>
                    </Pressable>
                  )}
                  <Pressable style={[styles.sheetBtn, styles.sheetBtnGhost]} onPress={() => setSelectedPin(null)}>
                    <Text style={styles.sheetBtnGhostText}>Close</Text>
                  </Pressable>
                </View>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      {/* Menu */}
      <Modal visible={menuOpen} animationType="slide" onRequestClose={() => setMenuOpen(false)}>
        <SafeAreaView style={styles.menuWrap}>
          <ScrollView contentContainerStyle={{ padding: 20 }}>
            <Text style={styles.menuH}>Map layer</Text>
            <View style={styles.typeRow}>
              {(Object.keys(LAYER_LABELS) as MapLayer[]).map((l) => (
                <Pressable
                  key={l}
                  style={[styles.typeChip, layer === l && { backgroundColor: '#111827' }]}
                  onPress={() => chooseLayer(l)}
                >
                  <Text style={[styles.typeText, layer === l && { color: '#fff' }]}>{LAYER_LABELS[l]}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.menuH}>Keep screen on</Text>
            <Pressable style={[styles.typeChip, keepAwake && { backgroundColor: '#111827' }, { alignSelf: 'flex-start' }]} onPress={() => setKeepAwake(!keepAwake)}>
              <Text style={[styles.typeText, keepAwake && { color: '#fff' }]}>{keepAwake ? 'On' : 'Off'}</Text>
            </Pressable>

            <Text style={styles.menuH}>Crew</Text>
            {members.map((m) => (
              <View key={m.user_id} style={styles.memberRow}>
                <View style={[styles.dot, { backgroundColor: m.color }]} />
                <Text style={styles.memberText}>
                  {m.display_name}
                  {m.user_id === userId ? ' (you)' : ''}
                </Text>
              </View>
            ))}
            <Pressable
              style={[styles.sheetBtn, { marginTop: 10, alignSelf: 'flex-start' }]}
              onPress={() => Share.share({ message: `Join "${project.name}" in Wend. Invite code: ${project.invite_code}` })}
            >
              <Text style={styles.sheetBtnText}>Share invite code ({project.invite_code})</Text>
            </Pressable>

            <Text style={styles.menuH}>My tracks ({myTracks.length})</Text>
            {myTracks.length === 0 && <Text style={styles.meta}>No tracks saved yet.</Text>}
            {myTracks.map((t) => (
              <View key={t.id} style={styles.trackRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.memberText}>{t.name}</Text>
                  <Text style={styles.meta}>
                    {formatDistance(t.distance_m)} · {new Date(t.started_at).toLocaleDateString()}
                    {t.synced === false ? ' · not synced' : ''}
                  </Text>
                </View>
                <Pressable
                  onPress={() =>
                    Alert.alert('Delete track?', t.name, [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Delete',
                        style: 'destructive',
                        onPress: async () => {
                          if (!(await deleteTrack(t.id))) Alert.alert('Could not delete', 'Check your signal and try again.');
                        },
                      },
                    ])
                  }
                >
                  <Text style={{ color: '#dc2626', fontWeight: '600' }}>Delete</Text>
                </Pressable>
              </View>
            ))}

            <Text style={styles.menuH}>Data</Text>
            <Pressable style={[styles.sheetBtn, { alignSelf: 'flex-start' }]} onPress={() => shareGpx(project.name, tracks, pins)}>
              <Text style={styles.sheetBtnText}>Export all as GPX</Text>
            </Pressable>
            <Pressable style={[styles.sheetBtn, styles.sheetBtnGhost, { alignSelf: 'flex-start', marginTop: 10 }]} onPress={refresh}>
              <Text style={styles.sheetBtnGhostText}>Sync now</Text>
            </Pressable>

            <Pressable style={{ marginTop: 28 }} onPress={() => supabase.auth.signOut()}>
              <Text style={{ color: '#6b7280' }}>Sign out</Text>
            </Pressable>
            <Pressable style={[styles.sheetBtn, { marginTop: 24 }]} onPress={() => setMenuOpen(false)}>
              <Text style={styles.sheetBtnText}>Done</Text>
            </Pressable>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  topWrap: { position: 'absolute', top: 0, left: 0, right: 0 },
  topBar: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, paddingHorizontal: 12, paddingTop: 8 },
  chip: {
    backgroundColor: 'rgba(255,255,255,0.94)', borderRadius: 18, paddingHorizontal: 12, paddingVertical: 8,
    shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, flexShrink: 1,
  },
  chipText: { fontSize: 14, fontWeight: '600' },
  recBanner: {
    alignSelf: 'center', marginTop: 10, backgroundColor: '#ef4444', borderRadius: 16,
    paddingHorizontal: 14, paddingVertical: 6,
  },
  recText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  bottomWrap: { position: 'absolute', bottom: 0, left: 0, right: 0 },
  bottomRow: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', paddingHorizontal: 12, paddingBottom: 6 },
  roundBtn: {
    backgroundColor: 'rgba(255,255,255,0.95)', borderRadius: 16, width: 78, paddingVertical: 8, alignItems: 'center',
    shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 4, shadowOffset: { width: 0, height: 1 },
  },
  roundBtnOn: { backgroundColor: '#dbeafe' },
  roundEmoji: { fontSize: 22 },
  roundLabel: { fontSize: 11, fontWeight: '600', marginTop: 2 },
  recBtn: {
    backgroundColor: '#111827', borderRadius: 32, paddingHorizontal: 28, paddingVertical: 18,
    shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 6, shadowOffset: { width: 0, height: 2 },
  },
  recBtnOn: { backgroundColor: '#dc2626' },
  recBtnText: { color: '#fff', fontSize: 18, fontWeight: '800' },
  hint: { textAlign: 'center', fontSize: 11, color: '#374151', paddingBottom: 4, textShadowColor: '#fff', textShadowRadius: 3 },
  pin: {
    width: 34, height: 34, borderRadius: 17, borderWidth: 3, alignItems: 'center', justifyContent: 'center',
  },
  pinEmoji: { fontSize: 16 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 34 },
  sheetTitle: { fontSize: 22, fontWeight: '800', marginBottom: 10 },
  typeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  typeChip: { backgroundColor: '#f3f4f6', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8 },
  typeText: { fontSize: 14, fontWeight: '600', color: '#111827' },
  input: {
    borderWidth: 1, borderColor: '#d1d5db', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 16, marginBottom: 10,
  },
  sheetButtons: { flexDirection: 'row', gap: 10, marginTop: 8 },
  sheetBtn: { backgroundColor: '#111827', borderRadius: 10, paddingVertical: 12, paddingHorizontal: 18, alignItems: 'center' },
  sheetBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  sheetBtnGhost: { backgroundColor: '#f3f4f6' },
  sheetBtnGhostText: { color: '#111827', fontWeight: '700', fontSize: 15 },
  meta: { fontSize: 13, color: '#6b7280', marginVertical: 2 },
  note: { fontSize: 16, marginVertical: 8 },
  menuWrap: { flex: 1, backgroundColor: '#fff' },
  menuH: { fontSize: 13, fontWeight: '800', color: '#6b7280', textTransform: 'uppercase', marginTop: 22, marginBottom: 8 },
  memberRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  dot: { width: 14, height: 14, borderRadius: 7, marginRight: 10 },
  memberText: { fontSize: 16, fontWeight: '600' },
  trackRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
});
