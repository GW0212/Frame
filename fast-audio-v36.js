/* FRAME! v36 — predecoded, low-latency sound effects. No external API. */
(() => {
  'use strict';
  window.FRAME_FAST_AUDIO_V36 = function createFastAudio(soundPath, tracks) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    let context = null;
    const buffers = new Map();
    const loading = new Map();
    const ongoing = new Set();
    const fallbackBank = new Map();
    const fallbackPlaying = new Set();
    let stagePlayer = null;
    let enabled = true;

    function getContext() {
      if (!AudioContextClass) return null;
      if (!context) {
        try { context = new AudioContextClass({ latencyHint: 'interactive' }); }
        catch (error) { console.warn('FRAME: AudioContext unavailable', error); }
      }
      return context;
    }

    function fallback(name) {
      if (!fallbackBank.has(name)) {
        const [file, volume] = tracks[name];
        const element = new Audio(soundPath + file);
        element.preload = 'auto';
        element.volume = volume;
        fallbackBank.set(name, element);
      }
      return fallbackBank.get(name);
    }

    function warm() {
      const ctx = getContext();
      // An HTMLAudio fallback is retained for browsers without WebAudio and file:// testing.
      for (const [name, [file]] of Object.entries(tracks)) {
        if (!ctx) fallback(name);
        if (!ctx || loading.has(file)) continue;
        const job = fetch(soundPath + file, { cache: 'force-cache' })
          .then(response => {
            if (!response.ok) throw new Error('HTTP ' + response.status);
            return response.arrayBuffer();
          })
          .then(data => ctx.decodeAudioData(data))
          .then(buffer => { buffers.set(file, buffer); return buffer; })
          .catch(error => { console.warn('FRAME: sound preload fallback', file, error.message); return null; });
        loading.set(file, job);
      }
    }

    function unlock() {
      const ctx = getContext();
      if (ctx && ctx.state !== 'running') {
        try { const result = ctx.resume(); result?.catch?.(() => {}); } catch {}
      }
      if (!loading.size) warm();
    }

    function startBuffer(ref) {
      const ctx = getContext();
      if (!ctx || !ref.buffer || !enabled) return false;
      if (ref.offset >= ref.buffer.duration - 0.003) return false;
      const source = ctx.createBufferSource();
      const gain = ctx.createGain();
      source.buffer = ref.buffer;
      gain.gain.value = ref.volume;
      source.connect(gain);
      gain.connect(ctx.destination);
      ref.source = source;
      ref.startedAt = ctx.currentTime - ref.offset;
      ref.playing = true;
      ongoing.add(source);
      source.onended = () => {
        ongoing.delete(source);
        try { source.disconnect(); gain.disconnect(); } catch {}
        if (ref.source === source) {
          ref.playing = false;
          ref.source = null;
          ref.offset = ref.buffer.duration;
        }
      };
      try { source.start(0, ref.offset); return true; }
      catch (error) { ongoing.delete(source); ref.source = null; ref.playing = false; return false; }
    }

    function play(name) {
      if (!enabled || !tracks[name]) return;
      const [file, volume] = tracks[name];
      const stage = name === 'guess_timer' || name === 'answer_reveal';
      if (stage) stopStage();
      const buffer = buffers.get(file);
      const ctx = getContext();
      if (buffer && ctx) {
        if (ctx.state !== 'running') unlock();
        // A queued source will start as soon as Safari resolves a user-gesture resume().
        const ref = { kind: 'buffer', name, buffer, volume, offset: 0, source: null, playing: false };
        if (startBuffer(ref)) {
          if (stage) stagePlayer = ref;
          return;
        }
      }
      // Fallback for the very first interaction while audio downloads, or WebAudio is absent.
      const base = fallback(name);
      const element = (!base.paused && !stage) ? base.cloneNode(true) : base;
      element.volume = volume;
      try { element.currentTime = 0; } catch {}
      fallbackPlaying.add(element);
      const clear = () => { fallbackPlaying.delete(element); element.removeEventListener('ended', clear); };
      element.addEventListener('ended', clear, { once: true });
      if (stage) stagePlayer = { kind: 'media', name, element };
      try { element.play()?.catch?.(() => { clear(); }); } catch { clear(); }
    }

    function stopStage() {
      const ref = stagePlayer;
      if (!ref) return;
      if (ref.kind === 'buffer' && ref.source) {
        const source = ref.source;
        ref.source = null;
        try { source.stop(0); } catch {}
      } else if (ref.kind === 'media') {
        ref.element.pause();
        try { ref.element.currentTime = 0; } catch {}
      }
      stagePlayer = null;
    }

    function pauseStage() {
      const ref = stagePlayer;
      if (!ref) return;
      if (ref.kind === 'buffer' && ref.playing && ref.source) {
        ref.offset = Math.min(ref.buffer.duration, Math.max(0, context.currentTime - ref.startedAt));
        const source = ref.source;
        ref.source = null;
        ref.playing = false;
        try { source.stop(0); } catch {}
      } else if (ref.kind === 'media') {
        ref.element.pause();
      }
    }

    function resumeStage() {
      const ref = stagePlayer;
      if (!ref || !enabled) return;
      if (ref.kind === 'buffer' && !ref.playing && ref.offset < ref.buffer.duration - 0.003) {
        startBuffer(ref);
      } else if (ref.kind === 'media' && ref.element.paused) {
        try { ref.element.play()?.catch?.(() => {}); } catch {}
      }
    }

    function stopAll() {
      stopStage();
      for (const source of ongoing) {
        try { source.stop(0); } catch {}
      }
      ongoing.clear();
      for (const element of fallbackPlaying) {
        element.pause();
        try { element.currentTime = 0; } catch {}
      }
      fallbackPlaying.clear();
    }

    function setEnabled(value) {
      enabled = Boolean(value);
      if (!enabled) stopAll();
    }

    return { warm, unlock, play, stopStage, pauseStage, resumeStage, stopAll, setEnabled };
  };
})();
