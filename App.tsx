import React, { useEffect, useState } from 'react';
import { ActivityIndicator, SafeAreaView, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import type { Session } from '@supabase/supabase-js';
import { isConfigured, supabase } from './src/lib/supabase';
import AuthScreen from './src/screens/AuthScreen';
import ProjectsScreen from './src/screens/ProjectsScreen';
import MapScreen from './src/screens/MapScreen';
import { Project } from './src/types';

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [current, setCurrent] = useState<{ project: Project; displayName: string } | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      if (!s) setCurrent(null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!isConfigured) {
    return (
      <SafeAreaView style={{ flex: 1, justifyContent: 'center', padding: 24 }}>
        <Text style={{ fontSize: 22, fontWeight: '800', marginBottom: 10 }}>Supabase not set up</Text>
        <Text style={{ fontSize: 16, lineHeight: 22 }}>
          Open src/lib/supabase.ts and paste in your Supabase project URL and anon key, then rebuild the app.
        </Text>
      </SafeAreaView>
    );
  }

  if (!ready) {
    return (
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!session) {
    return (
      <>
        <StatusBar style="dark" />
        <AuthScreen />
      </>
    );
  }

  if (!current) {
    return (
      <>
        <StatusBar style="dark" />
        <ProjectsScreen
          email={session.user.email ?? 'me'}
          onOpen={(project, displayName) => setCurrent({ project, displayName })}
        />
      </>
    );
  }

  return (
    <>
      <StatusBar style="dark" />
      <MapScreen
        userId={session.user.id}
        project={current.project}
        onBack={() => setCurrent(null)}
      />
    </>
  );
}
