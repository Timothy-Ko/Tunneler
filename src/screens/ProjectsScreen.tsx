import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, Pressable, RefreshControl,
  SafeAreaView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { Project } from '../types';

type Props = {
  email: string;
  onOpen: (p: Project, displayName: string) => void;
};

export default function ProjectsScreen({ email, onOpen }: Props) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [displayName, setDisplayName] = useState(email.split('@')[0]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('projects').select('id,name,invite_code').order('created_at');
    if (!error && data) setProjects(data as Project[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function create() {
    if (!name.trim()) return;
    setBusy(true);
    const { data, error } = await supabase.rpc('create_project', {
      p_name: name.trim(),
      p_display_name: displayName.trim() || 'Me',
    });
    setBusy(false);
    if (error) return Alert.alert('Could not create project', error.message);
    setName('');
    await load();
    const p = data as Project;
    if (p?.id) onOpen(p, displayName.trim() || 'Me');
  }

  async function join() {
    if (!code.trim()) return;
    setBusy(true);
    const { data, error } = await supabase.rpc('join_project', {
      p_code: code.trim().toLowerCase(),
      p_display_name: displayName.trim() || 'Me',
    });
    setBusy(false);
    if (error) return Alert.alert('Could not join', error.message);
    setCode('');
    await load();
    const p = data as Project;
    if (p?.id) onOpen(p, displayName.trim() || 'Me');
  }

  return (
    <SafeAreaView style={styles.wrap}>
      <Text style={styles.h1}>Projects</Text>

      <Text style={styles.label}>Your name (shown to your crew)</Text>
      <TextInput style={styles.input} value={displayName} onChangeText={setDisplayName} />

      {loading ? (
        <ActivityIndicator style={{ marginVertical: 20 }} />
      ) : (
        <FlatList
          data={projects}
          keyExtractor={(p) => p.id}
          refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}
          ListEmptyComponent={<Text style={styles.empty}>No projects yet. Create one or join with an invite code.</Text>}
          renderItem={({ item }) => (
            <Pressable style={styles.row} onPress={() => onOpen(item, displayName.trim() || 'Me')}>
              <Text style={styles.rowTitle}>{item.name}</Text>
              <Text style={styles.rowSub}>Invite code: {item.invite_code}</Text>
            </Pressable>
          )}
          style={{ flexGrow: 0, maxHeight: 280 }}
        />
      )}

      <View style={styles.card}>
        <Text style={styles.label}>New project</Text>
        <TextInput style={styles.input} placeholder="e.g. North field trenches" value={name} onChangeText={setName} />
        <Pressable style={styles.btn} onPress={create} disabled={busy}>
          <Text style={styles.btnText}>Create</Text>
        </Pressable>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Join a friend's project</Text>
        <TextInput
          style={styles.input}
          placeholder="Invite code"
          autoCapitalize="none"
          value={code}
          onChangeText={setCode}
        />
        <Pressable style={styles.btn} onPress={join} disabled={busy}>
          <Text style={styles.btnText}>Join</Text>
        </Pressable>
      </View>

      <Pressable onPress={() => supabase.auth.signOut()}>
        <Text style={styles.signout}>Sign out ({email})</Text>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 20, backgroundColor: '#f9fafb' },
  h1: { fontSize: 30, fontWeight: '800', marginTop: 10, marginBottom: 14 },
  label: { fontSize: 13, fontWeight: '600', color: '#374151', marginBottom: 6 },
  input: {
    borderWidth: 1, borderColor: '#d1d5db', borderRadius: 10, backgroundColor: '#fff',
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, marginBottom: 10,
  },
  row: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: '#e5e7eb' },
  rowTitle: { fontSize: 17, fontWeight: '700' },
  rowSub: { fontSize: 13, color: '#6b7280', marginTop: 2 },
  empty: { color: '#6b7280', marginVertical: 14 },
  card: { marginTop: 14 },
  btn: { backgroundColor: '#111827', borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  signout: { color: '#6b7280', textAlign: 'center', marginTop: 24 },
});
