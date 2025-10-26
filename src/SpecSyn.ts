// Noise synthesizer kernel.

import {convertDbToAmplitude} from "dsp-collection/utils/DspUtils";

type UniFunction = (x: number) => number;

const PI2 = Math.PI * 2;

function convertDbToAmplitudeOr0 (x: number) : number {
   if (!Number.isFinite(x) || x < -200) {
      return 0; }
   const y = convertDbToAmplitude(x);
   return Number.isFinite(y) ? y : 0; }

export function synthesize (spectrumCurveFunction: UniFunction, amplitudeCurveFunction: UniFunction, frequencyCurveFunction: UniFunction, duration: number, sampleRate: number, agcRmsLevel: number) : Float64Array {
   const sampleCount = Math.round(duration * sampleRate);
   const signal = new Float64Array(sampleCount);
   let w = 0;                                                                  // angle of fundamental wave
   for (let position = 0; position < sampleCount; position++) {
      const time = position / sampleRate;
      const a0 = convertDbToAmplitudeOr0(amplitudeCurveFunction(time));        // overall amplitude
      const f0 = frequencyCurveFunction(time);                                 // fundamental frequency
      if (!Number.isFinite(f0) || f0 <= 50) {
         continue; }
      const harmonics = Math.floor((sampleRate / 2 - 1000) / f0);
      let amplAcc = 0;                                                         // signal amplitude accumulator
      let analAcc = 0;                                                         // accumulator for analytic signal amplitudes, used for power normalization
      for (let harmonic = 1; harmonic <= harmonics; harmonic++) {
         const f = f0 * harmonic;                                              // frequency of harmonic
         const a = convertDbToAmplitudeOr0(spectrumCurveFunction(f));          // spectral amplitude of harmonic
         analAcc += a;
         amplAcc += a * Math.sin(w * harmonic); }
      const amplitude = (analAcc > 0) ? a0 * amplAcc / analAcc : 0;            // resulting signal amplitude at current position
      signal[position] = amplitude;
      const deltaW = PI2 * f0 / sampleRate;
      w += deltaW;
      if (w >= PI2) {
         w -= PI2; }}
   if (agcRmsLevel > 0) {
      adjustSignalGain(signal, agcRmsLevel); }
   return signal; }

function adjustSignalGain (buf: Float64Array, targetRms: number) {
   const n = buf.length;
   if (!n) {
      return; }
   const rms = computeRms(buf);
   if (!rms) {
      return; }
   let r = targetRms / rms;
   const maxAbs = findMaxAbsValue(buf);
   if (r * maxAbs >= 1) {                                                      // prevent clipping
      r = 0.99 / maxAbs; }
   for (let i = 0; i < n; i++) {
      buf[i] *= r; }}

function computeRms (buf: Float64Array) : number {
   const n = buf.length;
   let acc = 0;
   for (let i = 0; i < n; i++) {
      acc += buf[i] ** 2; }
   return Math.sqrt(acc / n); }

function findMaxAbsValue (buf: Float64Array) : number {
   const n = buf.length;
   let maxAbs = 0;
   for (let i = 0; i < n; i++) {
      maxAbs = Math.max(maxAbs, Math.abs(buf[i])); }
   return maxAbs; }
