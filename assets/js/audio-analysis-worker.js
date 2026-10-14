"use strict";

// Analyze real PCM off the UI thread. No synthetic waveform or estimated key.
self.onmessage = ({ data: { channels, sampleRate, duration } }) => {
  const length = channels[0].length;
  const windowSize = Math.max(1, Math.round(sampleRate / 100));
  const envelope = new Float32Array(Math.ceil(length / windowSize));
  const peaks = new Float32Array(192);
  let peak = 0,
    energy = 0;
  for (let i = 0; i < length; i++) {
    let square = 0,
      amplitude = 0;
    for (const channel of channels) {
      square += channel[i] * channel[i];
      amplitude = Math.max(amplitude, Math.abs(channel[i]));
    }
    square /= channels.length;
    energy += square;
    envelope[Math.floor(i / windowSize)] += square / windowSize;
    const bin = Math.min(
      peaks.length - 1,
      Math.floor((i * peaks.length) / length),
    );
    peaks[bin] = Math.max(peaks[bin], amplitude);
    peak = Math.max(peak, amplitude);
  }
  for (let i = 0; i < envelope.length; i++)
    envelope[i] = Math.sqrt(envelope[i]);
  const threshold = Math.max(0.003, peak * 0.008);
  let first = envelope.findIndex((v) => v > threshold),
    last = envelope.length - 1;
  while (last >= 0 && envelope[last] <= threshold) last--;
  const audible = first >= 0 && last > first;
  const contentStart = audible
    ? Math.max(0, (first * windowSize) / sampleRate - 0.04)
    : 0;
  const contentEnd = audible
    ? Math.min(duration, ((last + 1) * windowSize) / sampleRate + 0.08)
    : duration;
  let audibleEnergy = 0;
  if (audible)
    for (let i = first; i <= last; i++) audibleEnergy += envelope[i] ** 2;
  const rms = audible
    ? Math.sqrt(audibleEnergy / (last - first + 1))
    : Math.sqrt(energy / length);

  // Use onset autocorrelation only when there is clear rhythmic evidence.
  const offset = Math.min(1000, Math.floor(envelope.length / 4));
  const count = Math.min(6000, envelope.length - offset);
  const onsets = new Float32Array(count);
  let onsetEnergy = 0,
    envelopeEnergy = 0;
  for (let i = 1; i < count; i++) {
    onsets[i] = Math.max(0, envelope[offset + i] - envelope[offset + i - 1]);
    onsetEnergy += onsets[i] ** 2;
    envelopeEnergy += envelope[offset + i] ** 2;
  }
  let bestLag = 0,
    confidence = 0;
  if (
    count > 800 &&
    onsetEnergy > 0.0001 &&
    onsetEnergy / (envelopeEnergy || 1) > 0.001
  ) {
    for (let lag = 33; lag <= 77; lag++) {
      let product = 0,
        left = 0,
        right = 0;
      for (let i = lag; i < count; i++) {
        product += onsets[i] * onsets[i - lag];
        left += onsets[i] ** 2;
        right += onsets[i - lag] ** 2;
      }
      const correlation = product / Math.sqrt(left * right || 1);
      if (correlation > confidence) {
        confidence = correlation;
        bestLag = lag;
      }
    }
  }
  self.postMessage({
    version: 1,
    duration,
    contentStart,
    contentEnd,
    peaks: Array.from(
      peaks,
      (p) => Math.round((p / (peak || 1)) * 1000) / 1000,
    ),
    rms,
    peak,
    gain: rms > 0.001 ? Math.min(1.4, 0.14 / rms, 0.8 / (peak || 1)) : 1,
    bpm: confidence > 0.3 ? Math.round(6000 / bestLag) : null,
    confidence: Math.round(confidence * 100) / 100,
  });
};
