import { useCallback, useEffect, useRef, useState } from 'react';
import { rpc } from '@/shared/extension/rpc-client';
import type {
  SavedCommand,
  TeachingContext,
  TeachingSession,
} from '@/shared/contracts/teaching';
import { createTeachingRecorder } from '../content/recorder';

export function useTeachingSession(pageUrl: string, conversationId?: string) {
  const [session, setSession] = useState<TeachingSession | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState<SavedCommand | null>(null);
  const recorderRef = useRef<ReturnType<typeof createTeachingRecorder> | undefined>(undefined);

  if (!recorderRef.current) {
    recorderRef.current = createTeachingRecorder((actions) => {
      void rpc('teaching.append', { actions }).catch(() => {});
    });
  }

  const refresh = useCallback(async () => {
    try {
      const context = await rpc('teaching.context', {}) as TeachingContext;
      setSession(context.session);
    } catch {
      // Content scripts may briefly lose the service worker during navigation.
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(refresh, document.hidden ? 5000 : 1200);
    const onVisible = () => void refresh();
    window.addEventListener('pageshow', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('pageshow', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);

  useEffect(() => {
    const recorder = recorderRef.current!;
    if (session?.status === 'recording') recorder.start();
    else recorder.stop();
    return () => recorder.stop();
  }, [session?.status]);

  useEffect(() => {
    if (!confirmed) return;
    const timer = window.setTimeout(() => setConfirmed(null), 5_000);
    return () => window.clearTimeout(timer);
  }, [confirmed]);

  const start = useCallback(async () => {
    setBusy(true);
    setConfirmed(null);
    try {
      const next = await rpc('teaching.start', { url: pageUrl, conversationId }) as TeachingSession;
      setSession(next);
    } finally {
      setBusy(false);
    }
  }, [pageUrl, conversationId]);

  const finish = useCallback(async () => {
    recorderRef.current?.flush();
    setBusy(true);
    setSession((current) => current ? { ...current, status: 'summarizing' } : current);
    try {
      const next = await rpc('teaching.finish', {}) as TeachingSession;
      setSession(next);
    } finally {
      setBusy(false);
    }
  }, []);

  const cancel = useCallback(async () => {
    await rpc('teaching.cancel', {});
    setSession(null);
    setConfirmed(null);
  }, []);

  const revise = useCallback(async (request: string) => {
    setBusy(true);
    try {
      const next = await rpc('teaching.revise', { request }) as TeachingSession;
      setSession(next);
    } finally {
      setBusy(false);
    }
  }, []);

  const confirm = useCallback(async () => {
    setBusy(true);
    try {
      const command = await rpc('teaching.confirm', {}) as SavedCommand;
      setConfirmed(command);
      setSession(null);
      return command;
    } finally {
      setBusy(false);
    }
  }, []);

  const addComment = useCallback((comment: string, element?: HTMLElement | null) => {
    recorderRef.current?.recordComment(comment, element);
  }, []);

  return {
    session,
    busy,
    confirmed,
    start,
    finish,
    cancel,
    revise,
    confirm,
    refresh,
    addComment,
  };
}
